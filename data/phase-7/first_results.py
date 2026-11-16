"""Phase 7 first results: nearest shadowed area, its temperature and ice, and the drive there.

For each polar site in data/phase-3/sites.csv:
  - nearest permanently shadowed area of at least 1 km2 (PGDA LPSR list),
  - Diviner temperatures and ice depth inside that area,
  - a straight-line drive from the site to its edge, with slopes from the
    Phase 2 80 m elevation map.

Run from the repo root:  .venv/bin/python -I data/phase-7/first_results.py
Writes data/phase-7/site_resources.csv.
"""
import csv
import sys
from pathlib import Path

import numpy as np
import rasterio
import shapely
from pyproj import Transformer
from shapely import wkt
from shapely.ops import nearest_points

ROOT = Path(__file__).resolve().parents[2]
P7 = ROOT / "data/phase-7"
STERE = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
to_xy = Transformer.from_crs("+proj=longlat +R=1737400 +no_defs", STERE, always_xy=True)
ICE_TMAX = 110.0     # K, assumptions.csv ice_stable_tmax
SLOPE_DRIVE = 20.0   # deg, assumptions.csv slope_drive


def load_psrs():
    csv.field_size_limit(10**9)
    polys, names, areas = [], [], []
    with open(P7 / "LPSR_80S_20MPP_ADJ_1km2.CSV") as f:
        for row in csv.DictReader(f, skipinitialspace=True):
            polys.append(wkt.loads(row["WKT"]))
            names.append(row["name"].strip().strip('"'))
            areas.append(float(row["area_km2"]))
    return polys, names, areas


def load_diviner():
    cache = P7 / "dlre_prp_south_xy.npz"
    if cache.exists():
        d = np.load(cache)
        return d["x"], d["y"], d["tmax"], d["tavg"], d["ice"]
    # columns: 9 lon, 10 lat, 12 temp_avg, 13 temp_max, 14 ice_depth
    a = np.loadtxt(P7 / "dlre_prp_south.tab", delimiter=",", skiprows=1,
                   usecols=(9, 10, 12, 13, 14), dtype=np.float64)
    x, y = to_xy.transform(a[:, 0], a[:, 1])
    out = dict(x=x.astype(np.float32), y=y.astype(np.float32), tavg=a[:, 2].astype(np.float32),
               tmax=a[:, 3].astype(np.float32), ice=a[:, 4].astype(np.float32))
    np.savez(cache, **out)
    return out["x"], out["y"], out["tmax"], out["tavg"], out["ice"]


def inside(poly, x, y):
    minx, miny, maxx, maxy = poly.bounds
    sel = np.nonzero((x >= minx) & (x <= maxx) & (y >= miny) & (y <= maxy))[0]
    return sel[shapely.contains_xy(poly, x[sel], y[sel])]


def drive(dem, x0, y0, x1, y1, step=80.0):
    n = max(int(np.hypot(x1 - x0, y1 - y0) // step), 1)
    xs, ys = np.linspace(x0, x1, n + 1), np.linspace(y0, y1, n + 1)
    z = np.array([v[0] for v in dem.sample(zip(xs, ys))], dtype=np.float64)
    grade = np.degrees(np.arctan(np.abs(np.diff(z)) / (np.hypot(x1 - x0, y1 - y0) / n)))
    return float(np.nanmax(grade)), float(np.mean(grade > SLOPE_DRIVE)), float(z[-1] - z[0])


def main():
    sites = [r for r in csv.DictReader(open(ROOT / "data/phase-3/sites.csv")) if float(r["lat"]) <= -80]
    polys, names, areas = load_psrs()
    tree = shapely.STRtree(polys)
    x, y, tmax, tavg, ice = load_diviner()
    dem = rasterio.open(ROOT / "data/phase-2/LDEM_80S_80MPP_ADJ.TIF")

    rows = []
    for s in sites:
        sx, sy = to_xy.transform(float(s["lon"]), float(s["lat"]))
        pt = shapely.Point(sx, sy)
        i = int(tree.nearest(pt))
        poly = polys[i]
        edge = nearest_points(pt, poly)[1]
        dist_km = pt.distance(poly) / 1000
        k = inside(poly, x, y)
        # ice_depth: 0 = stable at the surface; -1 (undocumented) appears only in the
        # coldest cells, so we treat it as surface too; -999 = no stable ice within 2.87 m.
        depth = np.where(ice[k] == -1, 0.0, ice[k])
        reach = depth[depth != -999]
        max_g, steep, dz = drive(dem, sx, sy, edge.x, edge.y)
        rows.append(dict(
            id=s["id"], name=s["name"], psr_id=names[i], psr_area_km2=round(areas[i], 1),
            dist_km=round(dist_km, 2), diviner_cells=len(k),
            tmax_median_K=round(float(np.median(tmax[k])), 1) if len(k) else "",
            share_tmax_below_110K=round(float(np.mean(tmax[k] < ICE_TMAX)), 2) if len(k) else "",
            share_ice_at_surface=round(float(np.mean(depth == 0)), 2) if len(k) else "",
            share_ice_within_2_87m=round(len(reach) / len(k), 2) if len(k) else "",
            ice_depth_median_m=round(float(np.median(reach)), 2) if len(reach) else "",
            route_max_grade_deg=round(max_g, 1), route_share_over_20deg=round(steep, 2),
            route_drop_m=round(dz),
        ))
        print(rows[-1], file=sys.stderr)

    with open(P7 / "site_resources.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
