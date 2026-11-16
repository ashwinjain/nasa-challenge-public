#!/bin/sh
# Upload the landing-target terrain files to R2 (served by
# frontend/functions/data/terrain/[file].js): the meshes (land-*.bin) and
# their surface imagery (land-*_albedo.bin, land-*_wac.jpg). Run from the
# repo root after precompute_landing.py --terrain, precompute_albedo.py and
# precompute_wac_tiles.py.
set -e
cd frontend
for f in public/data/terrain/land-*; do
  case "$f" in
    *.jpg) type=image/jpeg ;;
    *) type=application/octet-stream ;;
  esac
  npx wrangler r2 object put "lunar-navigator-terrain/terrain/$(basename "$f")" \
    --file "$f" --content-type "$type" --remote
done
