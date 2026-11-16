"""Phase 6: landing targets inside an Artemis region.

A lander doesn't come down exactly on its target: it lands somewhere in a
circle (the landing ellipse, here 100 m radius) around it. A target is only
safe if most of that circle is gentle enough to touch down on.

How one region is searched (see docs/space-apps/navigator-plan.md, Phase 6):

1. **Pins.** One candidate target per pixel of NASA's average-sunlight map
   inside the region: 60 m apart where the 60 m map covers the whole region,
   else 120 m. Each pin is a point; its 100 m circle overlaps its neighbors'.
2. **Slope.** A slope map from the 20 m LOLA elevation map, read only for the
   region's bounding box. Slope is the steepness across one pixel either side
   (a 40 m baseline), in true ground meters (polar stereographic stretches
   the map a little away from the pole).
3. **Flat test.** Each pin passes if at least 95% of the 20 m slope pixels
   within 100 m are under 10° (NASA's touchdown limit). Missing pixels count
   as not flat.
4. **Rank.** Passing pins are ranked by NASA's average-sunlit fraction at the
   pin, a cheap stand-in for the full sunlight run that comes later.
5. **Spread out.** The top targets are picked greedily, each at least 500 m
   from the ones already picked, so they aren't ten copies of one ridge.

The full panel search (``lunarsky.panels``) then runs only on these targets.

Quick start::

    from lunarsky.landing import find_landing_targets
    res = find_landing_targets("Mons Mouton")
    res["targets"][0]
"""

from __future__ import annotations

import json
import math

import numpy as np

from .data import locate, open_raster
from .power import ANTENNA_HEIGHT_M    # the antenna on a 10 m mast, like the panels
from .terrain import FINE_MAP, R_M, _check_crs

REGIONS_FILE = "phase-3/artemis_regions.geojson"
SUN_60 = "phase-2/AVGVISIB_85S_060M_201608.TIF"    # 85°S–90°S
SUN_120 = "phase-3/AVGVISIB_75S_120M_201608.TIF"   # 75°S–90°S

ELLIPSE_M = 100.0       # landing-ellipse radius (NASA precision-landing goal)
LAND_MAX_DEG = 10.0     # NASA's touchdown slope limit
MIN_FLAT = 0.95         # share of the ellipse that must be under LAND_MAX_DEG
TOP_N = 10
MIN_SEP_M = 500.0


# ── Map geometry ─────────────────────────────────────────────────────────────

def scale_factor(x, y) -> np.ndarray:
    """Polar stereographic scale (map meters per ground meter) at map x, y.

    k = 2 / (1 + sin|lat|), which equals 1 + (ρ / 2R)² with ρ the distance
    from the pole on the map.
    """
    rho2 = np.asarray(x, float) ** 2 + np.asarray(y, float) ** 2
    return 1.0 + rho2 / (2.0 * R_M) ** 2


def map_to_latlon(x, y) -> tuple[np.ndarray, np.ndarray]:
    """Inverse of ``terrain.latlon_to_map`` for the south polar maps."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    rho = np.hypot(x, y)
    lat = -(90.0 - 2.0 * np.degrees(np.arctan(rho / (2.0 * R_M))))
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


def latlon_xy(lat, lon) -> tuple[np.ndarray, np.ndarray]:
    lat, lon = np.radians(np.asarray(lat, float)), np.radians(np.asarray(lon, float))
    rho = 2.0 * R_M * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


# ── Regions ──────────────────────────────────────────────────────────────────

def load_regions() -> dict[str, dict]:
    """Artemis III regions by name: ``code``, ``area_km2`` and the outline in map x, y."""
    with open(locate(REGIONS_FILE, source="local").path) as f:
        gj = json.load(f)
    out = {}
    for feat in gj["features"]:
        p = feat["properties"]
        ring = np.asarray(feat["geometry"]["coordinates"][0], float)   # lon, lat
        x, y = latlon_xy(ring[:, 1], ring[:, 0])
        out[p["Region"]] = {"code": p["RegionCode"], "area_km2": float(p["Area_km2"]),
                            "x": x, "y": y}
    return out


def _inside(px: np.ndarray, py: np.ndarray, x, y) -> np.ndarray:
    """Even-odd point-in-polygon test for points x, y against outline px, py."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    inside = np.zeros(x.shape, bool)
    n = len(px)
    for i in range(n - 1 if px[0] == px[-1] and py[0] == py[-1] else n):
        x1, y1, x2, y2 = px[i], py[i], px[(i + 1) % n], py[(i + 1) % n]
        crosses = (y1 > y) != (y2 > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        inside ^= crosses & (x < xi)
    return inside


# ── Slope ────────────────────────────────────────────────────────────────────

def _read_window(name: str, minx, miny, maxx, maxy, source=None):
    """Pixels of a map inside a map-coordinate box, with pixel-center x, y."""
    from rasterio.windows import Window, from_bounds

    with open_raster(name, source=source) as src:
        _check_crs(src.crs, name)
        win = from_bounds(minx, miny, maxx, maxy, transform=src.transform)
        win = win.round_offsets().round_lengths()
        win = win.intersection(Window(0, 0, src.width, src.height))
        a = src.read(1, window=win).astype(np.float64)
        if src.nodata is not None and not np.isnan(src.nodata):
            a[a == src.nodata] = np.nan
        a *= src.scales[0]
        t = src.window_transform(win)
    xs = t.c + (np.arange(a.shape[1]) + 0.5) * t.a
    ys = t.f + (np.arange(a.shape[0]) + 0.5) * t.e
    return a, xs, ys, t


def slope_map(heights: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Slope in degrees at every pixel, from neighbors one pixel either side.

    ``xs``, ``ys`` are the pixel-center map coordinates. Edge pixels and
    pixels next to missing data are NaN.
    """
    dx = float(xs[1] - xs[0])
    dy = float(ys[1] - ys[0])
    k = scale_factor(xs[None, :], ys[:, None])
    gx = np.full(heights.shape, np.nan)
    gy = np.full(heights.shape, np.nan)
    gx[:, 1:-1] = (heights[:, 2:] - heights[:, :-2]) / (2 * dx)
    gy[1:-1, :] = (heights[2:, :] - heights[:-2, :]) / (2 * dy)
    # map gradient × k = gradient per ground meter
    return np.degrees(np.arctan(np.hypot(gx, gy) * k))


def _disk_offsets(radius_px: float) -> list[tuple[int, int]]:
    r = int(math.floor(radius_px))
    return [(i, j) for i in range(-r, r + 1) for j in range(-r, r + 1) if i * i + j * j <= radius_px ** 2]


def disk_stats(slope: np.ndarray, radius_px: float, limit_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Share of pixels under ``limit_deg`` and the steepest pixel, within ``radius_px`` of each pixel.

    Missing (NaN) pixels count as not flat. Pixels whose disk runs off the
    array get NaN.
    """
    offs = _disk_offsets(radius_px)
    r = max(max(abs(i), abs(j)) for i, j in offs)
    rows, cols = slope.shape
    ok = (slope < limit_deg).astype(np.float32)          # NaN < x is False
    filled = np.where(np.isnan(slope), np.inf, slope)
    count = np.zeros((rows - 2 * r, cols - 2 * r), np.float32)
    steep = np.full(count.shape, -np.inf)
    for i, j in offs:
        count += ok[r + i: rows - r + i, r + j: cols - r + j]
        np.maximum(steep, filled[r + i: rows - r + i, r + j: cols - r + j], out=steep)
    frac = np.full(slope.shape, np.nan)
    mx = np.full(slope.shape, np.nan)
    frac[r: rows - r, r: cols - r] = count / len(offs)
    mx[r: rows - r, r: cols - r] = steep
    return frac, mx


# ── The search ───────────────────────────────────────────────────────────────

def _pick_sun_map(minx, miny, maxx, maxy, source=None) -> tuple[str, str]:
    """60 m map if it covers the whole box, else 120 m (same rule as Phase 3)."""
    with open_raster(SUN_60, source=source) as src:
        b = src.bounds
    if b.left <= minx and maxx <= b.right and b.bottom <= miny and maxy <= b.top:
        return SUN_60, "60m"
    return SUN_120, "120m"


def spread_out(order: np.ndarray, x: np.ndarray, y: np.ndarray, n: int, min_sep_m: float) -> list[int]:
    """Walk ``order`` (best first) and keep up to ``n`` indices at least ``min_sep_m`` apart (ground)."""
    kept: list[int] = []
    for i in order:
        if len(kept) >= n:
            break
        if kept:
            k = scale_factor(x[i], y[i])
            d = np.hypot(x[kept] - x[i], y[kept] - y[i]) / k
            if np.any(d < min_sep_m):
                continue
        kept.append(int(i))
    return kept


def find_landing_targets(region: str, ellipse_m: float = ELLIPSE_M, max_slope_deg: float = LAND_MAX_DEG,
                         min_flat: float = MIN_FLAT, top_n: int = TOP_N, min_sep_m: float = MIN_SEP_M,
                         source: str | None = None, regions: dict | None = None) -> dict:
    """Best landing targets in one Artemis region. Returns a JSON-ready dict."""
    regions = regions or load_regions()
    if region not in regions:
        raise KeyError(f"unknown region {region!r}; known: {sorted(regions)}")
    reg = regions[region]
    px, py = reg["x"], reg["y"]
    minx, maxx, miny, maxy = px.min(), px.max(), py.min(), py.max()

    # 1. Pins: sunlight-map pixels inside the outline.
    sun_name, sun_label = _pick_sun_map(minx, miny, maxx, maxy, source)
    sun, sxs, sys_, _ = _read_window(sun_name, minx, miny, maxx, maxy, source)
    SX, SY = np.meshgrid(sxs, sys_)
    pin = _inside(px, py, SX, SY) & np.isfinite(sun)
    pin_x, pin_y, pin_sun = SX[pin], SY[pin], sun[pin]

    # 2. Slope over the box, padded so every pin's circle is covered.
    pad = ellipse_m * 1.1 + 60.0
    h, hxs, hys, _ = _read_window(FINE_MAP, minx - pad, miny - pad, maxx + pad, maxy + pad, source)
    slope = slope_map(h, hxs, hys)

    # 3. Flat share and steepest pixel within the ellipse of every 20 m pixel.
    pixel_m = abs(float(hxs[1] - hxs[0]))
    k_mid = float(scale_factor((minx + maxx) / 2, (miny + maxy) / 2))
    radius_px = ellipse_m * k_mid / pixel_m
    frac, steepest = disk_stats(slope, radius_px, max_slope_deg)

    col = np.clip(np.floor((pin_x - hxs[0]) / (hxs[1] - hxs[0]) + 0.5).astype(int), 0, len(hxs) - 1)
    row = np.clip(np.floor((pin_y - hys[0]) / (hys[1] - hys[0]) + 0.5).astype(int), 0, len(hys) - 1)
    pin_frac = frac[row, col]
    pin_steep = steepest[row, col]
    pin_slope = slope[row, col]
    passing = np.isfinite(pin_frac) & (pin_frac >= min_flat)

    # 4–5. Rank the passing pins by sunlight and spread them out.
    idx = np.flatnonzero(passing)
    order = idx[np.argsort(-pin_sun[idx], kind="stable")]
    picks = spread_out(order, pin_x, pin_y, top_n, min_sep_m)

    lat, lon = map_to_latlon(pin_x[picks], pin_y[picks])
    targets = [{
        "rank": r + 1,
        "lat": round(float(lat[r]), 5), "lon": round(float(lon[r]), 5),
        "avg_sunlit": round(float(pin_sun[i]), 3),
        "flat_share": round(float(pin_frac[i]), 3),
        "steepest_deg": round(float(pin_steep[i]), 1),
        "slope_at_pin_deg": round(float(pin_slope[i]), 1),
    } for r, i in enumerate(picks)]

    return {
        "region": region, "code": reg["code"], "area_km2": reg["area_km2"],
        "pins": int(pin.sum()), "passing": int(passing.sum()),
        "best_sunlit_any": round(float(np.nanmax(pin_sun)), 3) if pin_sun.size else None,
        "targets": targets,
        "settings": {"ellipse_m": ellipse_m, "max_slope_deg": max_slope_deg, "min_flat": min_flat,
                     "top_n": top_n, "min_sep_m": min_sep_m, "sun_map": sun_label,
                     "slope_map": "20m", "slope_baseline_m": 2 * pixel_m},
    }


# ── Earth contact across the landing ellipse ─────────────────────────────────

CONTACT_SPACING_M = 40.0     # grid of possible touchdown points inside the ellipse


def ellipse_contact(k, lat: float, lon: float, start, days: float, dems, dsn_any, relay,
                    ellipse_m: float = ELLIPSE_M, spacing_m: float = CONTACT_SPACING_M,
                    height_m: float = ANTENNA_HEIGHT_M, step_hours: float = 1.0) -> dict:
    """Contact with Earth from every possible touchdown point in the ellipse.

    The radio is on the lander, and the lander can come down anywhere in the
    ellipse, so each point on a ``spacing_m`` grid gets its own skyline.
    Direct = Earth above that point's skyline **and** a DSN dish sees the Moon
    (``dsn_any``, from ``dsn.dsn_visible``). With relay = direct, or one of
    the ``relay`` satellites is usable from that point while a DSN dish sees
    the Moon (the relay talks to Earth through the DSN too). Reports the target
    itself and the worst point.
    """
    from .metrics import longest_run_hours
    from .panels import _offset, ring_offsets
    from .relay import relay_usable
    from .sky import sky_track
    from .terrain import compute_skyline, latlon_to_map

    track = sky_track(k, lat, lon, start, days, step_hours)
    if len(dsn_any) != len(track):
        raise ValueError(f"DSN has {len(dsn_any)} samples, sky track {len(track)}")
    x, y = latlon_to_map(lat, lon)
    near = dems.with_fine_window(float(x), float(y), 10.0 + ellipse_m / 1000.0)

    points = []
    for e, n in zip(*ring_offsets(0.0, ellipse_m, spacing_m)):
        la, lo = (float(v) for v in _offset(lat, lon, e, n))
        try:
            sky = compute_skyline(la, lo, heights_m=(height_m,), dems=near, fine_km=0)
        except ValueError:
            continue
        _, earth_hz = track.horizons(0.0, sky, height_m)
        direct = (track.earth_margin_deg(earth_hz, "any") > 0.0) & dsn_any
        # The relay still has to reach Earth through a DSN dish.
        both = direct | (relay_usable(relay, la, lo, sky, height_m) & dsn_any)
        points.append({
            "east_m": float(e), "north_m": float(n),
            "direct": round(float(direct.mean()), 4),
            "direct_longest_gap_hours": longest_run_hours(~direct, step_hours),
            "with_relay": round(float(both.mean()), 4),
            "with_relay_longest_gap_hours": longest_run_hours(~both, step_hours),
        })
    if not points:
        raise ValueError("no terrain data in the landing ellipse")
    center = min(points, key=lambda p: math.hypot(p["east_m"], p["north_m"]))
    worst_direct = min(points, key=lambda p: (p["direct"], -p["direct_longest_gap_hours"]))
    worst_relay = min(points, key=lambda p: (p["with_relay"], -p["with_relay_longest_gap_hours"]))
    return {
        "points": len(points), "spacing_m": spacing_m, "antenna_height_m": height_m,
        "at_target": {kk: v for kk, v in center.items() if kk not in ("east_m", "north_m")},
        "worst_direct": worst_direct,
        "worst_with_relay": worst_relay,
        "spread_direct": [min(p["direct"] for p in points), max(p["direct"] for p in points)],
    }
