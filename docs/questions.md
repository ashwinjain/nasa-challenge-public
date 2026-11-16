# Practice questions

Questions from the Phase 6 voice sessions, with answers. Useful
for preparing for judges' questions.

---

## Phase 6: landing

### 1. Why do the top 10 landing targets in each region have to be at least 500 m apart?

Otherwise all ten would land on the same sunny ridge, a few meters from each
other, and we'd learn nothing new. Spreading them out gives ten genuinely
different options.

### 2. Why isn't a 20 × 20 m flat patch a valid landing spot, even if it's perfectly flat?

- **The main reason:** a lander can't hit an exact spot. It comes down
  somewhere within about 100 m of the target, so the whole circle has to be
  safe. Our rule is that at least 95% of the 100 m circle is under 10°.
- **The IM-2 lesson:** 20 m pixels hide small bumps and craters, so one flat
  pixel doesn't prove the ground is flat.

### 3. Panels can go anywhere within 200 m of the landing target. Why 200 m, not the 300 m walking limit?

Worst case, the lander touches down 100 m one way and the panels are 200 m the
other way. That adds up to 300 m, the on-foot limit.

### 4. Why draw the walking path from the center of the landing zone instead of from where the lander actually lands?

We don't know where the lander will touch down, and panel spots have to be
chosen ahead of time. The center is a meeting point every landing spot can
reach: 95% of the zone is under 10°, so the crew walks across the flat zone to
the center, then follows the checked path out to the panels. The few steeper
spots, up to 5% of the zone, they walk around.

### 5. NASA's sunlight map already says how sunny each spot is. Why run our own full calculation for the panel spots?

- **The biggest reason:** NASA's map gives one number, the average share of
  time in sunlight over many years. It doesn't give the longest night, and the
  longest night sets the battery size. Two spots can both be 70% sunny on
  average, but one has a 4-day night and the other a 9-day night.
- **Detail:** NASA's map is coarser (60 m pixels, at ground level). Our run
  uses 20 m detail with the panel up on a 2 m mast.
- **Timing:** our run uses the specific year you'd be there, not a long-term
  average.

### 6. The radio is on the lander. Why does it matter where in the landing zone it touches down, for talking to Earth?

Ridges and terrain. From the south pole, Earth sits just a few degrees above
the horizon and wobbles a bit over the month. A ridge on one side of the
landing zone can block Earth from that side while the other side still sees
it. We don't know where the lander ends up, so we report the worst case. The
relay satellites can fill those gaps, which is why we show direct and
with-relay contact side by side.

### 7. IM-2 tipped over, but our slope map says its spot was flat (about 3°). Is our method wrong? How would you explain it to a judge?

The method isn't wrong. It has a resolution limit, and we state it.

- Each pixel is 20 m wide and stores one average height. Athena (IM-2) came
  down in a crater smaller than a pixel, so the map smooths it out to look
  flat.
- IM-1 (Odysseus) shows we catch slopes the map can see: 13° at its pin,
  against a reported ~12°.
- IM-2 shows what the map can't see. That's why real landers also scan for
  hazards on the way down.

### 8. Why rank landing targets by NASA's sunlight map instead of running our full calculation on every target?

Hundreds of thousands of possible targets at about 20 s each would be hundreds
of computer hours.

**Follow-up: what's the risk of the shortcut, and how do we reduce it?** NASA's
map only gives the average, not the longest night. A target with a slightly
lower average could have a much shorter longest night and get cut before we
ever check it. We reduce the risk by keeping ten targets per region instead of
one and doing the full calculation on all ten. The final ranking comes from our
own numbers, not NASA's average.

It paid off: in 7 of 9 regions, NASA's top pick wasn't the best once we
measured.

---

## Earlier phases

### 9. (Phase 1) Earth is yes-or-no visible, but the Sun is a share of its disk, and we only call it dark below 50%. Why treat them differently?

- **The Sun is continuous.** Half the disk showing means roughly half the
  power.
- **Earth is a radio link.** It works or it doesn't.
- Near the pole, the Sun often sits right on the horizon, half-hidden for
  hours. A simple yes or no would badly misjudge the power.

### 10. (Phase 2) Why are skylines computed from 2 m above the ground, not ground level?

- **It's not about people.** Two meters is roughly the height of a solar panel
  on its mast, and what matters is what the panel sees.
- **At ground level, tiny bumps dominate.** A small bump in the map just 40 m
  away blocks about 3° of sky, and near the pole the Sun never climbs much
  higher than that. A ground-level eye mostly measures small bumps.
- **It matches NASA.** At 2 m, our results match NASA's sunlight map within
  about 2 percentage points.

### 11. (Phase 3) What does the "pick a site, when?" view answer, compared with the "pick a date, where?" view?

- **"Pick a site, when?"** For a fixed site: when are the good times (sunlight,
  Earth contact)?
- **"Pick a date, where?"** For a fixed date: which sites are best then?

### 12. (Phase 4) The battery is sized mainly by one number. Which one, and why not the average sunlight?

The **longest night**, the longest stretch without usable sunlight. Average
sunlight helps size the panels, but the battery has to carry you through the
worst night.

### 13. (Phase 5) For a site to talk directly to Earth, two things must both be true. What are they?

1. Earth is above the site's skyline.
2. One of NASA's Deep Space Network dishes (California, Spain or Australia)
   sees the Moon at least 10° above its own horizon.

Earth spins, so each dish sees the Moon only part of the day. The three dishes
together mostly cover it, but not always.

---

## Harder ones

### 14. Two panel spots 20 m apart both get about 70% sunlight, but one has a 4-day longest night and the other 9 days. How?

The total dark time is about the same, but how it's chopped up differs. The Sun
skims along the horizon. One spot may see through a gap between two hills, so
the Sun peeks through for a few hours in the middle of the dark stretch. That
splits one long night into two shorter ones. The other spot, slightly lower,
can't see through the gap.

The result is the same total darkness, a very different longest night, and so
a very different battery. That's why we check every panel spot instead of
taking a shortcut. At Mons Mouton, spots close together had 166 h and 224 h
longest nights.

### 15. In Malapert, the safe target is nearly as sunny as the sunniest spot (81% vs 82%). In Nobile Rim 1, it loses six points (77% vs 83%). What does that tell a mission planner?

- **Malapert:** landing safely costs almost no sunlight.
- **Nobile Rim 1:** landing safely costs a lot of sunlight.

On NASA's sunlight map alone, Nobile Rim 1 looks like the sunniest region of
all. Once landing safety is added, it falls behind Malapert, so the ranking of
regions changes. That's the point of Phase 6: the sunniest spot on the map
isn't always one you can actually use.

### 16. Phase 5 said a long gap in Earth contact might need more battery, not just more data storage. Why would a gap cost power?

Storing data takes little power. The cost comes after the gap, when the radio
runs at full power for longer to send the backlog. It's a small effect, and
it's listed in `docs/tech-debt.md`.

### 17. We rank targets by total weight (solar array plus battery) instead of by longest night. Why might those rankings differ?

1. **The panels matter too.** A spot with a slightly longer night but much more
   sunlight overall needs a smaller array. That can save more weight than the
   extra battery costs.
2. **Recharging.** If a long night is followed by only a short sunny stretch,
   the battery can't fully refill before the next night, so it has to be even
   bigger. The longest night alone doesn't see that, but the hour-by-hour
   sizing does.

Weight is the more honest number for a planner. Ranking by weight saved up to
about 8 t over NASA's top pick in some regions.
