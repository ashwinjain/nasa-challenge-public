"""Precompute sun/Earth up-time runs for the planning views → frontend/public/data/windows/

For every site with a terrain skyline (frontend/public/data/skyline/{id}.json,
written by precompute_static.py), writes:

  - windows/{year}/{site_id}.json  runs for the smooth Moon and each eye
                                   height, hourly, from {year}-01-01 through
                                   EXTRA_DAYS into the next year (so a stay
                                   can start on Dec 31), plus when the
                                   site can reach Earth through one of
                                   two relay satellites (lunarsky/relay.py)
  - windows/{year}/dsn.json        when a Deep Space Network dish sees the
                                   Moon (same hours; shared by every site)
  - windows/{year}/index.json      that year's span and which sites have data
  - windows/index.json             the list of years

Reads the saved skylines, so it doesn't need the elevation maps. Takes a few
seconds per year.

Usage:
    .venv/bin/python scripts/precompute_windows.py            # YEARS below
    .venv/bin/python scripts/precompute_windows.py 2030 2031  # just these
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from lunarsky import load_kernels, load_sites, sky_track
from lunarsky.dsn import dsn_windows
from lunarsky.power import ANTENNA_HEIGHT_M
from lunarsky.relay import relay_tracks
from lunarsky.terrain import Skyline
from lunarsky.windows import visibility_windows

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "frontend" / "public" / "data"
SKYLINE_DIR = DATA / "skyline"
OUT_DIR = DATA / "windows"

YEARS = list(range(2026, 2036))   # the years the planning page offers
DEFAULT_YEAR = 2026   # the crewed mission lands in early 2026
EXTRA_DAYS = 60          # longest stay the views allow
STEP_HOURS = 1.0
# Relay runs only at the antenna height the app reads them at
# (plan/windows.js ANTENNA_HEIGHT_M, a 10 m mast), to keep the files small.
RELAY_HEIGHTS = (ANTENNA_HEIGHT_M,)


def precompute_year(k, sites, year: int) -> list[str]:
    out_dir = OUT_DIR / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    start = datetime(year, 1, 1, tzinfo=timezone.utc)
    days = (datetime(year + 1, 1, 1, tzinfo=timezone.utc) - start).days + EXTRA_DAYS

    relay = relay_tracks(k, start, days, STEP_HOURS)   # both relays; the same for every site
    done = []
    for s in sites:
        path = SKYLINE_DIR / f"{s.id}.json"
        if not path.exists():
            continue                      # no terrain: not part of the planning views
        skyline = Skyline.from_dict(json.loads(path.read_text()))
        track = sky_track(k, s.lat, s.lon, start, days, STEP_HOURS)
        w = visibility_windows(track, skyline, relay=relay, relay_heights=RELAY_HEIGHTS)
        out = {"site_id": s.id, "name": s.name, "lat": s.lat, "lon": s.lon, **w}
        (out_dir / f"{s.id}.json").write_text(json.dumps(out, separators=(",", ":")))
        done.append(s.id)

    dsn = dsn_windows(k, start, days, STEP_HOURS)
    (out_dir / "dsn.json").write_text(json.dumps(dsn, separators=(",", ":")))

    index = {
        "year": year,
        "start_utc": start.isoformat().replace("+00:00", "Z"),
        "end_utc": (start + timedelta(days=days)).isoformat().replace("+00:00", "Z"),
        "max_stay_days": EXTRA_DAYS,
        "step_hours": STEP_HOURS,
        "sites": done,
    }
    (out_dir / "index.json").write_text(json.dumps(index, indent=1))
    print(f"  {year}: {len(done)} sites")
    return done


def main():
    years = [int(a) for a in sys.argv[1:]] or YEARS
    k = load_kernels()
    sites = load_sites()
    for year in years:
        precompute_year(k, sites, year)

    # The list of years is whatever folders exist, so running one year at a
    # time adds to it.
    have = sorted(int(p.name) for p in OUT_DIR.iterdir() if p.is_dir() and p.name.isdigit())
    top = {"years": have, "default_year": DEFAULT_YEAR if DEFAULT_YEAR in have else have[0]}
    (OUT_DIR / "index.json").write_text(json.dumps(top, indent=1))
    print(f"Wrote {OUT_DIR.relative_to(ROOT)}/index.json: years {have[0]}-{have[-1]}")


if __name__ == "__main__":
    main()
