"""Command-line check for lunarsky.

    python -m lunarsky --list
    python -m lunarsky --site artemis-ma --start 2027-01-01 --days 30
    python -m lunarsky --latlon=-89.5,0 --start 2027-01-01T06:00 --days 14 --step 0.5 --json

Write ``--latlon=-89.5,0`` with the ``=`` so the leading minus is not read
as an option.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from . import (
    DISK_RULES,
    horizon_dip_deg,
    load_kernels,
    load_sites,
    phase1_metrics,
    site_by_id,
    sky_track,
)


def _fmt_hours(h) -> str:
    if h is None:
        return "not in window"
    return f"{h:8.1f} h  ({h / 24:5.2f} d)"


def _print_report(name: str, m: dict) -> None:
    s, e, w = m["sun"], m["earth"], m["window"]
    print(f"{name}  ({m['site']['lat']:.4f}, {m['site']['lon']:.4f})  height {m['site']['height_m']:g} m")
    print(f"window     {w['start_utc']} to {w['end_utc']}  ({w['hours'] / 24:.1f} d, {w['step_hours']:g} h steps)")
    print(f"horizon    smooth Moon at {m['horizon']['elevation_deg']:+.2f} deg, disk rule '{m['horizon']['disk_rule']}'")
    print()
    print("SUN")
    print(f"  sunlit                {s['sunlit_fraction'] * 100:6.1f} %   ({s['sunlit_hours']:.0f} h)")
    print(f"  longest dark stretch  {_fmt_hours(s['longest_dark_hours'])}")
    print(f"  longest sunlit        {_fmt_hours(s['longest_sunlit_hours'])}")
    print(f"  at start              {'sunlit' if s['sunlit_at_start'] else 'dark'}, elevation {s['elevation_at_start_deg']:+.2f} deg")
    print(f"  next sunset in        {_fmt_hours(s['hours_to_next_set'])}")
    print(f"  next sunrise in       {_fmt_hours(s['hours_to_next_rise'])}")
    print(f"  elevation range       {s['min_elevation_deg']:+.2f} to {s['max_elevation_deg']:+.2f} deg")
    print("EARTH")
    print(f"  in view               {e['visible_fraction'] * 100:6.1f} %   ({e['visible_hours']:.0f} h)")
    print(f"  longest blackout      {_fmt_hours(e['longest_blackout_hours'])}")
    print(f"  longest in view       {_fmt_hours(e['longest_visible_hours'])}")
    print(f"  at start              {'in view' if e['visible_at_start'] else 'blacked out'}, elevation {e['elevation_at_start_deg']:+.2f} deg")
    print(f"  next Earthset in      {_fmt_hours(e['hours_to_next_set'])}")
    print(f"  next Earthrise in     {_fmt_hours(e['hours_to_next_rise'])}")
    print(f"  elevation range       {e['min_elevation_deg']:+.2f} to {e['max_elevation_deg']:+.2f} deg")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m lunarsky", description="Sun and Earth visibility from a lunar site (Phase 1, smooth Moon).")
    where = ap.add_mutually_exclusive_group()
    where.add_argument("--site", help="site id from data/phase-3/sites.csv (see --list)")
    where.add_argument("--latlon", help="custom LAT,LON in degrees, east positive; write --latlon=-89.5,0")
    ap.add_argument("--start", help="UTC start, e.g. 2027-01-01 or 2027-01-01T06:00")
    ap.add_argument("--days", type=float, default=29.53, help="window length in days (default: one lunar day, 29.53)")
    ap.add_argument("--step", type=float, default=1.0, help="hours between samples (default 1)")
    ap.add_argument("--height", type=float, default=0.0, help="observer height above ground, m (default 0)")
    ap.add_argument("--horizon", type=float, default=None, help="horizon elevation, deg (default: 0 minus the dip for --height)")
    ap.add_argument("--rule", choices=DISK_RULES, default="any", help="what counts as 'up' for a disk (default any)")
    ap.add_argument("--json", action="store_true", help="print metrics as JSON")
    ap.add_argument("--track", action="store_true", help="with --json: include the per-sample arrays too")
    ap.add_argument("--list", action="store_true", help="list the known sites and exit")
    ap.add_argument("--data-dir", default=None, help="folder holding phase-1/ and phase-3/ (default: repo data/)")
    args = ap.parse_args(argv)

    sites = load_sites(data_dir=args.data_dir)

    if args.list:
        print(f"{'id':16s} {'lat':>9s} {'lon':>10s} {'avg sun':>8s}  name")
        for s in sites:
            avg = f"{s.avg_sunlit * 100:6.1f} %" if s.avg_sunlit is not None else "      --"
            print(f"{s.id:16s} {s.lat:9.4f} {s.lon:10.4f} {avg:>8s}  {s.name}")
        return 0

    if not (args.site or args.latlon) or not args.start:
        ap.error("need --site ID or --latlon=LAT,LON, plus --start (or use --list)")

    if args.site:
        try:
            site = site_by_id(sites, args.site)
        except KeyError as exc:
            ap.error(str(exc))
        lat, lon, name = site.lat, site.lon, site.name
    else:
        try:
            lat_s, lon_s = args.latlon.split(",")
            lat, lon = float(lat_s), float(lon_s)
        except ValueError:
            ap.error(f"--latlon must be LAT,LON, got {args.latlon!r}")
        name = "custom site"

    try:
        start = datetime.fromisoformat(args.start.replace("Z", "+00:00"))
    except ValueError:
        ap.error(f"--start must be ISO 8601 like 2027-01-01T06:00, got {args.start!r}")
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)

    if args.horizon is not None:
        horizon = args.horizon
    else:
        horizon = -horizon_dip_deg(args.height) if args.height > 0 else 0.0

    k = load_kernels(args.data_dir)
    track = sky_track(k, lat, lon, start, args.days, args.step, args.height)
    metrics = phase1_metrics(track, horizon, args.rule)
    metrics["site"]["name"] = name

    if args.json:
        if args.track:
            metrics["track"] = track.to_dict(horizon, args.rule)
        json.dump(metrics, sys.stdout, indent=2)
        print()
    else:
        _print_report(name, metrics)
    return 0


if __name__ == "__main__":
    sys.exit(main())
