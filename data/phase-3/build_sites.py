"""Build data/phase-3/sites.csv: one coordinate per Artemis III region.

Rule (see README.md): the sunniest pixel inside the region, from NASA's
average-sunlight maps. Uses the most detailed map that covers the whole
region: 60 m (85°S–90°S) if it fits, otherwise 120 m (75°S–90°S). Ties go
to the pixel nearest the region's center.

Run from the repo root:
    .venv/bin/python data/phase-3/build_sites.py
Needs data/phase-3/AVGVISIB_75S_120M_201608.TIF,
data/phase-2/AVGVISIB_85S_060M_201608.TIF and
data/phase-3/artemis_regions.geojson.
"""

import csv
import json
import math
from pathlib import Path

import numpy as np
import rasterio
import shapely
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, shape

HERE = Path(__file__).parent
MAP_120 = HERE / "AVGVISIB_75S_120M_201608.TIF"
MAP_60 = HERE.parent / "phase-2" / "AVGVISIB_85S_060M_201608.TIF"
REGIONS = HERE / "artemis_regions.geojson"
OUT = HERE / "sites.csv"

MOON_LONLAT = CRS.from_proj4("+proj=longlat +R=1737400 +no_defs")


def main():
    m120 = rasterio.open(MAP_120)
    m60 = rasterio.open(MAP_60)
    to_map = Transformer.from_crs(MOON_LONLAT, m120.crs, always_xy=True)
    to_ll = Transformer.from_crs(m120.crs, MOON_LONLAT, always_xy=True)

    def project_polygon(geom_ll):
        ring = geom_ll.exterior.coords
        xs, ys = to_map.transform([p[0] for p in ring], [p[1] for p in ring])
        return Polygon(zip(xs, ys))

    def pick_map(poly_xy):
        """Most detailed sunlight map that covers the whole polygon."""
        b = m60.bounds
        minx, miny, maxx, maxy = poly_xy.bounds
        if b.left <= minx and maxx <= b.right and b.bottom <= miny and maxy <= b.top:
            return m60, "60m"
        return m120, "120m"

    def sunniest(poly_xy):
        """Sunniest pixel inside a map-coordinate polygon."""
        m, label = pick_map(poly_xy)
        minx, miny, maxx, maxy = poly_xy.bounds
        win = rasterio.windows.from_bounds(minx, miny, maxx, maxy, m.transform)
        win = win.round_offsets().round_lengths()
        a = m.read(1, window=win).astype(float)
        a[a == m.nodata] = np.nan
        t = m.window_transform(win)
        rows, cols = np.indices(a.shape)
        xs, ys = rasterio.transform.xy(t, rows.ravel(), cols.ravel())
        xs, ys = np.asarray(xs), np.asarray(ys)
        inside = shapely.contains_xy(poly_xy, xs, ys)
        vals = np.where(inside, a.ravel(), np.nan)
        best = np.nanmax(vals)
        cand = np.flatnonzero(vals == best)
        c = poly_xy.centroid
        pick = cand[np.argmin((xs[cand] - c.x) ** 2 + (ys[cand] - c.y) ** 2)]
        lon, lat = to_ll.transform(xs[pick], ys[pick])
        return lat, lon, label, int(inside.sum())

    def sunlit_at(lat, lon, prefer=None):
        """Average sunlit fraction at a point, from the most detailed map
        covering it (or the one named in `prefer`). Returns (value, label)."""
        x, y = to_map.transform(lon, lat)
        maps = [(m60, "60m"), (m120, "120m")]
        if prefer:
            maps = [mm for mm in maps if mm[1] == prefer]
        for m, label in maps:
            b = m.bounds
            if b.left <= x <= b.right and b.bottom <= y <= b.top:
                v = next(m.sample([(x, y)]))[0]
                if v != m.nodata:
                    return v * m.scales[0], label
        return None, ""

    rows = []

    def add(id_, name, group, kind, lat, lon, method, source, notes="", map_used=None):
        val, label = sunlit_at(lat, lon, map_used)
        rows.append({
            "id": id_, "name": name, "group": group, "kind": kind,
            "lat": round(lat, 5), "lon": round(lon, 5), "method": method,
            "avg_sunlit": "" if val is None else round(val, 3),
            "sunlit_map": label,
            "source": source, "notes": notes,
        })

    # Artemis III regions -------------------------------------------------
    regions = json.loads(REGIONS.read_text())
    for f in sorted(regions["features"], key=lambda f: f["properties"]["Region"]):
        name = f["properties"]["Region"]
        poly = project_polygon(shape(f["geometry"]))
        lat, lon, lab, n = sunniest(poly)
        add("artemis-" + f["properties"]["RegionCode"].lower(), name, "core",
            "artemis_region", lat, lon, "sunniest_in_region",
            "USGS Artemis III region outline (2024) + Mazarico et al. 2011 sunlight map",
            f"{f['properties']['Area_km2']:.0f} km2 region, {n} pixels searched", lab)


    with OUT.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} sites to {OUT}")


if __name__ == "__main__":
    main()
