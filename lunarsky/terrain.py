"""Phase 2: a site's skyline from the LOLA south-pole elevation maps.

The skyline is the terrain's elevation angle in every compass direction, as
seen from a point on the Moon. The Sun (or Earth) is up when it clears the
skyline at its own azimuth, not just the flat 0° horizon of Phase 1.

How one skyline is built (see docs/phase-2-plan.md, step 2):

1. Look up the ground height at the site. The eye sits at
   ``r0 = R + ground + eye_height`` from the Moon's center.
2. In each azimuth (0 = north, 90 = east, same as ``SkyTrack.sun_az``) walk
   outward along the great circle from the site. Distances are measured on
   the sphere; the map is only used to look up heights, because polar
   stereographic stretches distances away from the pole.
3. At each sample, at central angle ``θ`` and height ``h`` (``r = R + h``)::

       elev = atan2(r·cos θ − r0, r·sin θ)

   exact on a sphere, so the drop from curvature is built in.
4. The highest angle along the ray is the skyline in that direction.

Samples start ~2 pixels out (so the site's own blurry pixel can't shadow
itself), begin one pixel apart and get 0.5% longer each step, out to 300 km.
Each sample takes its height from the finest map that covers it:

- the 20 m map, read only for a ±10 km window around the site (the whole
  file is 2.7 GB), because nearby terrain blocks the most sky;
- the 80 m map out to its edge, ~304 km from the pole;
- the 240 m map beyond that.

If the 20 m file isn't available, the skyline uses the 80 m and 240 m maps.

Quick start::

    from lunarsky.terrain import load_dems, compute_skyline

    dems = load_dems()                                 # both maps, ~400 MB, once
    sky = compute_skyline(-86.00114, 2.05502, dems=dems)   # Malapert
    sky.horizon_at([0, 90, 180], height_m=2)           # degrees
"""

from __future__ import annotations

import functools
import math
from dataclasses import dataclass, field

import numpy as np

from .kernels import MOON_RADIUS_KM

R_M = MOON_RADIUS_KM * 1000.0           # reference sphere the maps use (1737.4 km)

NEAR_MAP = "phase-2/LDEM_80S_80MPP_ADJ.TIF"   # 80 m pixels, to ~80°S
FAR_MAP = "phase-2/LDEM_60S_240MPP_ADJ.TIF"   # 240 m pixels, to ~59°S
FINE_MAP = "phase-6/LDEM_80S_20MPP_ADJ.TIF"   # 20 m pixels, to ~80°S; read in windows
DEFAULT_FINE_KM = 10.0                  # half-width of the 20 m window around a site

DEFAULT_HEIGHTS_M = (0.0, 2.0, 10.0, 20.0)   # ground, eye, panel and antenna mast, VSAT-style mast
# What the app shows first. 0 m is an eye lying on the ground: with 20 m
# pixels, a 2 m bump 40 m away blocks ~3° of sky, more than the polar Sun
# ever climbs, so 0 m mostly measures small bumps in the map. A person's
# eye is at 2 m; panels and the antenna are on a 10 m mast
# (power.PANEL_HEIGHT_M).
DEFAULT_EYE_M = 2.0
DEFAULT_N_AZ = 720                      # 0.5° apart
DEFAULT_MAX_KM = 300.0


# ── Projection ───────────────────────────────────────────────────────────────
# All four Phase 2 maps: +proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400.
# For a unit vector p on the sphere (x toward lon 0, z toward the north pole):
#   map x = 2R·p_y / (1 − p_z),   map y = 2R·p_x / (1 − p_z)
# which is the usual ρ = 2R·tan(45° + lat/2), x = ρ·sin(lon), y = ρ·cos(lon),
# written without trig. tests/test_terrain.py checks it against pyproj.

def _unit_vector(lat_deg, lon_deg) -> np.ndarray:
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def _project(p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unit vectors (..., 3) → polar stereographic map x, y in meters."""
    k = 2.0 * R_M / (1.0 - p[..., 2])
    return k * p[..., 1], k * p[..., 0]


def latlon_to_map(lat_deg, lon_deg) -> tuple[np.ndarray, np.ndarray]:
    """Site lat/lon (MOON_ME, degrees) → map x, y in meters."""
    return _project(_unit_vector(lat_deg, lon_deg))


def _local_axes(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Up, north and east unit vectors at a site."""
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    north = np.array([-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)])
    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    return up, north, east


# ── Height maps ──────────────────────────────────────────────────────────────

@dataclass
class HeightMap:
    """One elevation map in memory: heights in meters above the 1737.4 km sphere.

    ``x0, y0`` is the outer corner of the top-left pixel, ``dx > 0`` and
    ``dy < 0`` the pixel size (a north-up GeoTIFF). Missing pixels are NaN.
    """

    heights: np.ndarray
    x0: float
    y0: float
    dx: float
    dy: float
    name: str = ""

    @property
    def pixel_m(self) -> float:
        return abs(self.dx)

    def sample(self, x, y) -> np.ndarray:
        """Bilinear height at map x, y (meters). NaN outside the map or near missing data."""
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)
        rows, cols = self.heights.shape
        # Fractional pixel index, measured from the first pixel's center.
        fc = (x - self.x0) / self.dx - 0.5
        fr = (y - self.y0) / self.dy - 0.5
        inside = (fc >= 0) & (fc <= cols - 1) & (fr >= 0) & (fr <= rows - 1)
        out = np.full(np.shape(fc), np.nan)
        if not inside.any():
            return out
        fc, fr = fc[inside], fr[inside]      # interpolate only the points this map covers
        c0 = np.minimum(np.floor(fc).astype(np.intp), cols - 2)
        r0 = np.minimum(np.floor(fr).astype(np.intp), rows - 2)
        tc, tr = fc - c0, fr - r0
        flat = self.heights.ravel()
        i = r0 * cols + c0
        out[inside] = ((1 - tr) * ((1 - tc) * flat[i] + tc * flat[i + 1])
                       + tr * ((1 - tc) * flat[i + cols] + tc * flat[i + cols + 1]))
        return out

    @classmethod
    def from_raster(cls, name: str, source: str | None = None) -> "HeightMap":
        """Read a whole LDEM map into memory (via ``data.open_raster``)."""
        from .data import open_raster

        with open_raster(name, source=source) as src:
            _check_crs(src.crs, name)
            heights = src.read(1).astype(np.float32, copy=False)
            if src.nodata is not None and not np.isnan(src.nodata):
                heights[heights == src.nodata] = np.nan
            t = src.transform
            if t.b != 0 or t.d != 0:
                raise ValueError(f"{name}: rotated map grids aren't supported")
            return cls(heights, x0=t.c, y0=t.f, dx=t.a, dy=t.e, name=name)

    @classmethod
    def window_from_raster(cls, name: str, x: float, y: float, half_m: float,
                           source: str | None = None) -> "HeightMap | None":
        """Read only the square ``x, y ± half_m`` (map meters) of a map.

        ``None`` if the square misses the map entirely.
        """
        from rasterio.windows import Window, from_bounds

        from .data import open_raster

        with open_raster(name, source=source) as src:
            _check_crs(src.crs, name)
            win = from_bounds(x - half_m, y - half_m, x + half_m, y + half_m, transform=src.transform)
            win = win.round_offsets().round_lengths()
            try:
                win = win.intersection(Window(0, 0, src.width, src.height))
            except Exception:       # rasterio raises WindowError when they don't overlap
                return None
            if win.width < 2 or win.height < 2:
                return None
            heights = src.read(1, window=win).astype(np.float32, copy=False)
            if src.nodata is not None and not np.isnan(src.nodata):
                heights[heights == src.nodata] = np.nan
            t = src.window_transform(win)
            return cls(heights, x0=t.c, y0=t.f, dx=t.a, dy=t.e,
                       name=f"{name} (±{half_m / 1000:g} km)")


def _check_crs(crs, name: str) -> None:
    """Refuse a map whose projection isn't the one ``_project`` assumes."""
    p = crs.to_dict() if crs is not None else {}
    want = {"proj": "stere", "lat_0": -90, "lat_ts": -90, "lon_0": 0, "R": R_M}
    for key, val in want.items():
        got = p.get(key)
        if got is None or (isinstance(val, (int, float)) and not math.isclose(float(got), val)) \
                or (isinstance(val, str) and got != val):
            raise ValueError(f"{name}: expected {key}={val} in the map projection, got {got!r}")


@dataclass
class Dems:
    """The elevation maps a skyline reads, finest first.

    ``fine_name`` is a map too big to hold in memory (the 20 m one); if set,
    ``compute_skyline`` reads a window of it around each site and puts that
    in front of ``maps``.
    """

    maps: list[HeightMap]
    fine_name: str | None = None
    fine_source: str | None = None

    def with_fine_window(self, x: float, y: float, half_km: float = DEFAULT_FINE_KM) -> "Dems":
        """These maps with a window of the fine map around ``x, y`` in front."""
        if not self.fine_name:
            return self
        try:
            win = HeightMap.window_from_raster(self.fine_name, x, y, half_km * 1000.0, self.fine_source)
        except Exception:
            return self             # 20 m file missing or unreadable: fall back to the 80 m map
        if win is None:
            return self
        return Dems([win, *self.maps])

    def sample(self, x, y) -> np.ndarray:
        """Height from the finest map that covers each point; NaN where none does."""
        h = self.maps[0].sample(x, y)
        for m in self.maps[1:]:
            gap = np.isnan(h)
            if not gap.any():
                break
            h[gap] = m.sample(np.asarray(x)[gap], np.asarray(y)[gap])
        return h

    @property
    def finest_pixel_m(self) -> float:
        return self.maps[0].pixel_m


@functools.lru_cache(maxsize=2)
def load_dems(source: str | None = None) -> Dems:
    """Load the 80 m and 240 m maps into memory, once per process (~400 MB).

    Reads whole files, so prefer local copies; from the bucket this downloads
    them both. The 20 m map is not loaded here: each skyline reads a small
    window of it (see ``Dems.with_fine_window``).
    """
    return Dems([HeightMap.from_raster(NEAR_MAP, source), HeightMap.from_raster(FAR_MAP, source)],
                fine_name=FINE_MAP, fine_source=source)


# ── Skyline ──────────────────────────────────────────────────────────────────

@dataclass
class Skyline:
    """Terrain elevation angle in every direction around one site."""

    lat: float
    lon: float
    heights_m: tuple[float, ...]    # eye heights above the ground
    az_deg: np.ndarray              # (n_az,) 0, 0.5, … ; 0 = north, 90 = east
    el_deg: np.ndarray              # (len(heights_m), n_az) skyline elevation, degrees
    ground_m: float                 # site height above the 1737.4 km sphere
    reach_km: np.ndarray            # (n_az,) farthest distance each ray had map data for
    max_km: float                   # how far the rays were meant to go
    source: str = ""
    blocker_km: np.ndarray = field(default=None)   # (len(heights_m), n_az) distance of the highest point

    @property
    def partial(self) -> bool:
        """True if any ray ran off the maps before ``max_km``."""
        return bool(np.any(self.reach_km < self.max_km - 1.0))

    def horizon_at(self, az_deg, height_m: float = 0.0) -> np.ndarray:
        """Skyline elevation (degrees) at the given azimuths, for one eye height."""
        try:
            i = [float(h) for h in self.heights_m].index(float(height_m))
        except ValueError:
            raise ValueError(f"no skyline at {height_m} m; have {self.heights_m}") from None
        return np.interp(np.asarray(az_deg, dtype=float) % 360.0, self.az_deg, self.el_deg[i], period=360.0)

    def to_dict(self, ndigits: int = 4) -> dict:
        return {
            "lat": self.lat,
            "lon": self.lon,
            "ground_m": round(self.ground_m, 1),
            "heights_m": list(self.heights_m),
            "az_deg": [round(float(a), 3) for a in self.az_deg],
            "el_deg": {f"{h:g}": [round(float(e), ndigits) for e in row]
                       for h, row in zip(self.heights_m, self.el_deg)},
            "blocker_km": None if self.blocker_km is None else {
                f"{h:g}": [round(float(d), 2) for d in row] for h, row in zip(self.heights_m, self.blocker_km)},
            "reach_km": [round(float(r), 1) for r in self.reach_km],
            "max_km": self.max_km,
            "partial": self.partial,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Skyline":
        heights = tuple(float(h) for h in d["heights_m"])
        el = np.array([d["el_deg"][f"{h:g}"] for h in heights], dtype=float)
        blk = d.get("blocker_km")
        return cls(
            lat=d["lat"], lon=d["lon"], heights_m=heights,
            az_deg=np.array(d["az_deg"], dtype=float), el_deg=el,
            ground_m=d["ground_m"], reach_km=np.array(d["reach_km"], dtype=float),
            max_km=d["max_km"], source=d.get("source", ""),
            blocker_km=None if blk is None else np.array([blk[f"{h:g}"] for h in heights], dtype=float),
        )


def sample_distances(pixel_m: float, max_km: float = DEFAULT_MAX_KM,
                     start_px: float = 2.0, growth: float = 0.005) -> np.ndarray:
    """Distances (meters) to sample along each ray.

    Starts ``start_px`` pixels out, then steps one pixel at first and 0.5%
    longer each time: fine nearby where small bumps matter, coarse far away
    where only big terrain can reach above eye level.
    """
    max_m = max_km * 1000.0
    d, step, out = start_px * pixel_m, pixel_m, []
    while d < max_m:
        out.append(d)
        d += step
        step *= 1.0 + growth
    out.append(max_m)
    return np.array(out)


def compute_skyline(lat: float, lon: float, heights_m=DEFAULT_HEIGHTS_M,
                    n_az: int = DEFAULT_N_AZ, max_km: float = DEFAULT_MAX_KM,
                    dems: Dems | None = None, fine_km: float = DEFAULT_FINE_KM) -> Skyline:
    """The skyline around ``lat, lon`` (MOON_ME degrees) at each eye height.

    Raises ``ValueError`` if the maps have no height at the site itself
    (north of ~59°S). Rays that run off the maps early are kept and show up
    in ``reach_km`` / ``partial``. ``fine_km`` is the half-width of the
    20 m window (0 = don't use the 20 m map).
    """
    dems = dems or load_dems()
    heights_m = tuple(float(h) for h in heights_m)

    x, y = latlon_to_map(lat, lon)
    if fine_km > 0:
        dems = dems.with_fine_window(float(x), float(y), fine_km)
    ground = float(dems.sample(np.atleast_1d(x), np.atleast_1d(y))[0])
    if not np.isfinite(ground):
        raise ValueError(f"no terrain data at lat {lat}, lon {lon} (the maps cover ~59°S to the pole)")

    az = np.arange(n_az) * (360.0 / n_az)
    dist = sample_distances(dems.finest_pixel_m, max_km)
    theta = dist / R_M                                            # central angle of each sample

    # Points along every ray: p = cos θ·up + sin θ·(cos az·north + sin az·east)
    up, north, east = _local_axes(lat, lon)
    a = np.radians(az)[:, None, None]
    heading = np.cos(a) * north + np.sin(a) * east                # (n_az, 1, 3)
    pts = np.cos(theta)[None, :, None] * up + np.sin(theta)[None, :, None] * heading
    px, py = _project(pts)                                        # (n_az, n_samples)
    h = dems.sample(px.ravel(), py.ravel()).reshape(px.shape)

    have = np.isfinite(h)
    reach_km = np.where(have.any(axis=1), np.max(np.where(have, dist, 0.0), axis=1), 0.0) / 1000.0

    r = R_M + h                                                   # NaN where no data
    rcos, rsin = r * np.cos(theta), r * np.sin(theta)
    el = np.empty((len(heights_m), n_az))
    blk = np.empty((len(heights_m), n_az))
    for k, eye in enumerate(heights_m):
        r0 = R_M + ground + eye
        e = np.degrees(np.arctan2(rcos - r0, rsin))
        e = np.where(have, e, -np.inf)
        j = np.argmax(e, axis=1)
        el[k] = e[np.arange(n_az), j]
        blk[k] = dist[j] / 1000.0
    el[np.isinf(el)] = np.nan                                     # a ray with no data at all

    return Skyline(
        lat=float(lat), lon=float(lon), heights_m=heights_m, az_deg=az, el_deg=el,
        ground_m=ground, reach_km=reach_km, max_km=float(max_km),
        source=" + ".join(m.name or f"{m.pixel_m:g} m map" for m in dems.maps),
        blocker_km=blk,
    )
