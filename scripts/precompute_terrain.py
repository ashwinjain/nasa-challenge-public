"""Precompute per-site terrain for the first-person moon surface view.

Each site gets one mesh that is fine underfoot and coarse at the horizon,
built as a polar grid centered on the site:

  - 720 spokes, 0.5° apart (the same azimuths as the skyline);
  - rings every 20 m out to ~2.3 km, then each ring 0.87% farther out than
    the last, so cells stay roughly square (arc length = ring spacing);
  - out to 300 km, the same reach as ``compute_skyline``.

Cells are ~20 m near you, ~90 m at 10 km and ~2.6 km at 300 km: about as
detailed as you can see from eye height at each distance.

Heights come from the finest map that covers each point, exactly as the
skyline reads them: the 20 m map (a ±10 km window), then the 80 m map,
then the 240 m map. So the mountains you see on the horizon are the same
ones that decide when the site is sunlit.

Writes:
  - frontend/public/data/terrain/<site_id>.bin   heights (m above the 1737.4 km
    sphere): the site point first, then ring by ring, each ring 720 values
    starting at azimuth 0 (north) and going east. Encoded by encode_heights
    (see there), decoded by frontend/src/terrainFile.js.
  - frontend/public/data/terrain/index.json      layout (n_az, ring radii) and
    per-site ground height / relief.

The GB-sized LDEM maps stay out of git; only these baked heights ship.

Usage:
    .venv/bin/python scripts/precompute_terrain.py
"""
import json
import struct
from pathlib import Path

import numpy as np

from lunarsky import load_sites
from lunarsky.terrain import (DEFAULT_FINE_KM, DEFAULT_MAX_KM, R_M, _local_axes,
                              _project, latlon_to_map, load_dems)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "data" / "terrain"

N_AZ = 720                # spokes, 0.5° apart
FINE_STEP_M = 20.0        # ring spacing near the site (the 20 m map's pixel)
MAX_KM = DEFAULT_MAX_KM   # 300 km, as far as the skyline looks
NEAR_KM = 12.0            # coverage is judged over this radius
MIN_COVERAGE = 0.5        # skip sites the DEMs barely cover (equatorial)

# Heights are rounded before they're stored, by a step that follows the
# mesh: each ring's step is the narrowest side of its cells × tan(0.01°), so
# rounding tilts no cell by more than 0.01°. That's ~0.03 mm at the first
# ring, where spokes are 17 cm apart, and ~0.3 m at 300 km. A fixed step
# can't work: 1 cm tilts the thin cells near the site by degrees, which
# shows as streaks under a low Sun. The float bits below the step are
# interpolation noise that doesn't compress, so this halves the download.
SLOPE_TOLERANCE_DEG = 0.01
FILE_MAGIC = b"LNT1"


def ring_steps(radii, n_az=N_AZ, tolerance_deg=SLOPE_TOLERANCE_DEG) -> np.ndarray:
    """The rounding step (m) for each ring, as float32 (it's stored that way)."""
    radii = np.asarray(radii, dtype=np.float64)
    cell = np.minimum(radii * 2.0 * np.pi / n_az, np.diff(radii, prepend=0.0))
    return (cell * np.tan(np.radians(tolerance_deg))).astype("<f4")


def encode_heights(h0: float, h, radii, n_az=N_AZ, tolerance_deg=SLOPE_TOLERANCE_DEG) -> bytes:
    """A site's heights as a compact, compressible .bin file.

    ``h0`` is the site point, ``h`` the (rings, n_az) grid. Layout
    (little-endian): the magic "LNT1"; the number of heights, n_az and the
    number of rings (uint32 each); each ring's step (float32; the site point
    uses the first ring's); then the heights in whole steps. On a ring each
    is stored minus the one before it (neighbours differ little), a ring's
    first one and the site point whole. Those numbers are zigzag-coded so
    small negatives stay small, and split into four byte planes (byte 0 of
    every value, then byte 1, …) so the mostly-zero high bytes sit together.
    Hosting compresses the result (Brotli or gzip).
    """
    steps = ring_steps(radii, n_az, tolerance_deg)
    s = steps.astype(np.float64)[:, None]
    rings = np.round(np.asarray(h, dtype=np.float64).reshape(len(steps), n_az) / s).astype(np.int64)
    seq = np.concatenate([[round(float(h0) / float(steps[0]))], np.diff(rings, axis=1, prepend=0).ravel()])
    z = (seq << 1) ^ (seq >> 63)
    if z.max() >= 2**32:
        raise ValueError("a height doesn't fit the file's 32-bit steps")
    planes = z.astype("<u4").view(np.uint8).reshape(-1, 4).T
    header = FILE_MAGIC + struct.pack("<III", len(seq), n_az, len(steps))
    return header + steps.tobytes() + planes.tobytes()


def ring_radii(n_az=N_AZ, fine_m=FINE_STEP_M, max_km=MAX_KM) -> np.ndarray:
    """Ring distances (m), excluding the center: fixed steps, then geometric."""
    arc = 2.0 * np.pi / n_az               # cell width / radius
    out, r = [], 0.0
    while r < max_km * 1000.0:
        r += max(fine_m, r * arc)
        out.append(min(r, max_km * 1000.0))
    return np.array(out)


def build_heights(lat, lon, dems, radii, n_az=N_AZ):
    """Heights (m) at the site and at every ring × spoke; plus near-field coverage."""
    up, north, east = _local_axes(lat, lon)
    az = np.radians(np.arange(n_az) * 360.0 / n_az)          # 0 = north, 90° = east
    dirv = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east   # (n_az, 3)
    ang = radii / R_M                                          # central angle per ring
    u = (np.cos(ang)[:, None, None] * up
         + np.sin(ang)[:, None, None] * dirv[None, :, :])      # (n_rings, n_az, 3)
    mx, my = _project(u)
    h = dems.sample(mx, my)
    near = radii <= NEAR_KM * 1000.0
    coverage = float(np.isfinite(h[near]).mean())

    cx, cy = latlon_to_map(lat, lon)
    h0 = float(dems.sample(np.array([cx]), np.array([cy]))[0])
    # Holes (off every map) fall back to the reference sphere.
    h = np.nan_to_num(h, nan=0.0)
    h0 = 0.0 if not np.isfinite(h0) else h0
    return h0, h, coverage


def imagery_places():
    """(id, name, lat, lon) of every terrain mesh that gets surface imagery:
    the sites, then the landing targets the surface view actually stands on
    (land-*, from landing.json). Used by precompute_albedo.py and
    precompute_wac_tiles.py."""
    places = [(s.id, s.name, s.lat, s.lon) for s in load_sites()
              if (OUT_DIR / f"{s.id}.bin").exists()]
    landing = OUT_DIR.parent / "landing.json"
    if landing.exists():
        for r in json.loads(landing.read_text())["regions"]:
            for t in r["targets"]:
                if t.get("terrain_id"):
                    places.append((t["terrain_id"], f"{r['region']} #{t['rank']}", t["lat"], t["lon"]))
    return places


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Loading LDEM maps (~400 MB)...")
    dems = load_dems()
    sites = load_sites()
    radii = ring_radii()
    print(f"Polar grid: {N_AZ} spokes × {len(radii)} rings = {N_AZ * len(radii) + 1:,} points/site")

    index = {
        "layout": "polar",
        "n_az": N_AZ,
        "radii_m": [round(float(r), 2) for r in radii],
        "max_km": MAX_KM,
        "sites": {},
    }
    # Landing targets' meshes (land-*.bin) are baked by precompute_landing.py
    # --terrain on the same grid: keep their files and index entries.
    prev = OUT_DIR / "index.json"
    if prev.exists():
        index["sites"].update({k: v for k, v in json.loads(prev.read_text()).get("sites", {}).items()
                               if k.startswith("land-")})
    for old in OUT_DIR.glob("*.bin"):
        if not old.name.startswith("land-"):
            old.unlink()
    for s in sites:
        x, y = latlon_to_map(s.lat, s.lon)
        site_dems = dems.with_fine_window(float(x), float(y), DEFAULT_FINE_KM)
        h0, h, cov = build_heights(s.lat, s.lon, site_dems, radii)
        if cov < MIN_COVERAGE:
            print(f"  {s.name:38s} coverage {cov*100:4.0f}%  — skipped (outside DEM)")
            continue
        (OUT_DIR / f"{s.id}.bin").write_bytes(encode_heights(h0, h, radii))
        # Which map the ground under the site comes from (20, 80 or 240 m).
        cx, cy = latlon_to_map(s.lat, s.lon)
        near_m = next((m.pixel_m for m in site_dems.maps
                       if np.isfinite(m.sample(np.array([cx]), np.array([cy]))[0])), None)
        index["sites"][s.id] = {
            "coverage": round(cov, 3),
            "ground_m": round(h0, 1),   # terrain height at the site (eye sits above this)
            "h_min": round(float(min(h0, h.min())), 1),
            "h_max": round(float(max(h0, h.max())), 1),
            "near_pixel_m": near_m,
        }
        print(f"  {s.name:38s} coverage {cov*100:4.0f}%  relief {h.max()-h.min():6.0f} m"
              f"  {near_m:g} m underfoot  ✓")

    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=1))
    print(f"\n✓ {len(index['sites'])} terrain meshes → {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
