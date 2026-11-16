# Spare textures

Textures the page doesn't load, kept here so they aren't copied into every
build and deploy (everything in `frontend/public/` is).

- `moon_color_16k.jpg`: the full-size LROC color map. The page uses the 4k
  and 8k ones (`scripts/build_textures.py` writes all three).
- `2k_sun.jpg`: the source of `frontend/public/textures/sun_512.jpg`, which is
  this image resized to 512×256 (Lanczos, JPEG quality 90).
- `lroc_color_2k.jpg`: a 2k LROC color map (see `docs/moon-surface-broken-down.md`).

To use one in the page, move it into `frontend/public/textures/`.
