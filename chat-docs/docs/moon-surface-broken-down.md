# Moon surface, broken down

How the app models the ground, the sky and the light. There are **three
independent pieces**, and only one step couples them.

---

## 1. Terrain: the actual floor

**What it is:** ground height, and nothing else. Each pixel of NASA's LOLA
elevation maps is meters above or below a 1737.4 km reference sphere. This is
the surface you'd stand on.

**Source:** LOLA maps at 20 m (within 10 km of a spot), 80 m (nearby) and
240 m (distant mountains, out to 300 km), from NASA's PGDA product 90.

**Standalone.** It knows nothing about the Sun, Earth or time.

### One dataset, two products

The same heights are read two ways:

```
             ┌─ as a HORIZON  → skyline (#3) → is the Sun or Earth up?   (the numbers)
LOLA heights ┤
             └─ as GEOMETRY   → 3D mesh      → the ground you see        (the 3D view)
```

- **As a horizon:** reduced to a skyline and compared with the Sun's and
  Earth's elevation. This gives every sunlight and Earth number.
- **As geometry:** a 3D mesh around each site, 20 m cells underfoot growing
  to ~2.6 km at the 300 km horizon. Its horizon matches the skylines to
  within 0.1°.

### The 3D surface view

Three layers stack to make the ground look real:

| Layer | What it gives | Source |
|---|---|---|
| Shape | where the ground rises and falls | LOLA heights |
| Image (large scale) | what the ground looks like, where | NASA LROC WAC South Pole Summer Mosaic (100 m pixels) |
| Grain (close up) | fine texture underfoot | a real Apollo regolith photo, tiled |

Each pixel of ground is lit from its own skyline: the shader looks toward
the Sun and lights the pixel by the share of the Sun's disk above that
skyline, the same rule as the sunlight numbers. So shadows move correctly
as the Sun moves, and distant peaks can stay sunlit while the site is dark.

**Eye height in 3D: 2 m**, a person standing. You can walk around the
region with WASD or the arrow keys. The Sun and Earth are drawn at their
true size and distance.

---

## 2. Sun and Earth: the sky

**What it is:** where the Sun and Earth are, as azimuth and elevation from
a site over time.

**Source:** JPL's DE421 ephemeris and the Moon's orientation, with
libration. Checked against JPL Horizons to about 0.00001°.

**Standalone.** It knows nothing about terrain.

---

## 3. Skyline: terrain, reduced

**What it is:** the terrain collapsed into a horizon profile: from this
point, how high the ground rises in each of 720 compass directions (every
0.5°), out to 300 km, at heights of 0, 2, 10 and 20 m above the ground.

**How:** 720 rays walk outward along the curved surface and keep the
highest elevation angle in each direction, including the drop from the
Moon's curvature.

**Which height the app uses:**

- **10 m** for solar panels and the comms antenna, which sit on a 10 m
  mast. Every power number and every Earth-contact number is at 10 m.
- **2 m** for a person standing: the 3D view, the timeline, tiles and sky
  chart. It's also the height we check against NASA's sunlight maps.
- **Not 0 m:** an eye lying on the ground. With 20 m pixels, a 2 m bump
  40 m away blocks ~3° of sky, more than the polar Sun ever climbs, so 0 m
  mostly measures small bumps in the map.

**Checked against NASA:** over the 9 Artemis regions and 18.6 years, our
sunlight at 2 m is within 2.0 percentage points of NASA's maps on
average (worst 7.0, Mons Mouton Plateau), against 19.7 points
for a smooth Moon. See [nasa-comparison.md](nasa-comparison.md).

---

## Where they couple

The three pieces meet at exactly **one** question: *is the Sun above the
terrain right now?*

```
sunlit share  =  how much of the Sun's disk (#2) is above the skyline at the Sun's azimuth (#3)
```

Earth is the same comparison with Earth's position, except Earth counts as
in view when any part of its disk is above the skyline (a radio link either
works or it doesn't). Everything upstream, building the floor, reducing it
to a skyline and computing Sun positions, is independent.

NASA's sunlight and Earth maps are pre-baked answers to this question,
averaged over 18.6 years. We never feed them into the model; they're the
answer key we check against.

## Limits

- **Nothing smaller than 20 m.** Boulders and small crater rims aren't in
  the maps.
- **Far from the site the 3D ground is soft.** The 20 m detail ends about
  2.3 km from the landing point and the image is 100 m per pixel.
- **The sky chart and the numbers stay at the landing point** while you walk
  around in 3D.
