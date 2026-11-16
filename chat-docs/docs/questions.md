# How the navigator works: questions and answers

Questions about how the navigator works and why it was built this way, with
answers.

---

**Landing targets and panel spots**

## 1. Why do the top 10 landing targets in each region have to be at least 500 m apart?

Otherwise all ten would land on the same sunny ridge, a few meters from each
other, and we'd learn nothing new. Spreading them out gives ten genuinely
different options.

## 2. Why isn't a 20 × 20 m flat patch a valid landing spot, even if it's perfectly flat?

- **The main reason:** a lander can't hit an exact spot. It comes down
  somewhere within about 100 m of the target, so the whole circle has to be
  safe. Our rule is that at least 95% of the 100 m circle is under 10°.
- **The IM-2 lesson:** 20 m pixels hide small bumps and craters, so one flat
  pixel doesn't prove the ground is flat.

## 3. Panels can go anywhere within 200 m of the landing target. Why 200 m, not the 300 m walking limit?

Panels and comms gear go at most 300 m from the lander, carried and cabled
on foot. Worst case, the lander touches down 100 m one way and the panels are
200 m the other way. That adds up to 300 m.

## 4. Why draw the walking path from the center of the landing zone instead of from where the lander actually lands?

We don't know where the lander will touch down, and panel spots have to be
chosen ahead of time. The center is a meeting point every landing spot can
reach: 95% of the zone is under 10°, so the crew walks across the flat zone to
the center, then follows the checked path out to the panels. The few steeper
spots, up to 5% of the zone, they walk around.

## 5. NASA's sunlight map already says how sunny each spot is. Why run our own full calculation for the panel spots?

- **The biggest reason:** NASA's map gives one number, the average share of
  time in sunlight over many years. It doesn't give the longest night, and the
  longest night sets the battery size. Two spots can both be 70% sunny on
  average, but one has a 4-day night and the other a 9-day night.
- **Detail:** NASA's map is coarser (60 m pixels, and no stated height). Our
  run uses 20 m detail with the panels on a 10 m mast.
- **Timing:** our run uses the specific year you'd be there, not a long-term
  average.

## 6. The radio is on the lander. Why does it matter where in the landing zone it touches down, for talking to Earth?

Ridges and terrain. From the south pole, Earth sits just a few degrees above
the horizon and wobbles a bit over the month. A ridge on one side of the
landing zone can block Earth from that side while the other side still sees
it, even from the antenna's 10 m mast. We don't know where the lander ends
up, so we report the worst case. The relay satellites can fill those gaps,
which is why we show direct and with-relay contact side by side.

## 7. IM-2 tipped over, but our slope map says its spot was flat (about 3°). Is the method wrong?

The method isn't wrong. It has a resolution limit, and we state it.

- Each pixel is 20 m wide and stores one average height. Athena (IM-2) came
  down in a crater smaller than a pixel, so the map smooths it out to look
  flat.
- IM-1 (Odysseus) shows we catch slopes the map can see: 13.2° at its spot,
  against a reported ~12°. It tipped over too.
- IM-2 shows what the map can't see. That's why real landers also scan for
  hazards on the way down.

These two landers are only the check on our slope method; the app itself
covers the nine Artemis regions.

## 8. Why shortlist landing targets by NASA's sunlight map instead of running our full calculation on every target?

Hundreds of thousands of possible targets, each with thousands of panel
spots to check, would be hundreds of computer hours.

**Follow-up: what's the risk of the shortcut, and how do we reduce it?** NASA's
map only gives the average, not the longest night. A target with a slightly
lower average could have a much shorter longest night and get cut before we
ever check it. We reduce the risk by keeping ten targets per region instead of
one and doing the full calculation on all ten. The final ranking comes from our
own numbers, not NASA's average.

It matters: in 8 of 9 regions, the target NASA's sunlight map rates best wasn't the lightest kit once we measured. Ranking by kit weight rather than average sunlight saves mass in 8 of 9 regions, up to 10.1 t (de Gerlache Rim 2), but 0.2 t or less in three of them. In Nobile Rim 1, the target NASA's sunlight map rates best is also the lightest kit.

---

**Sun, Earth, terrain and power**

## 9. (Phase 1) Earth is yes-or-no visible, but the Sun is a share of its disk, and we only call it dark below 50%. Why treat them differently?

- **The Sun is continuous.** Half the disk showing means roughly half the
  power.
- **Earth is a radio link.** It works or it doesn't.
- Near the pole, the Sun often sits right on the horizon, half-hidden for
  hours. A simple yes or no would badly misjudge the power.

## 10. (Phase 2) What height are the skylines computed from, and why not ground level?

Every skyline is worked out at 0, 2, 10 and 20 m. The app uses two:

- **10 m for the solar panels and the comms antenna,** which sit on a 10 m
  mast. Every power number and every Earth-contact number is at 10 m.
- **2 m for a person standing,** the eye height of the 3D view. It's also
  the height we check against NASA's sunlight maps.

Ground level (0 m) isn't used, because tiny bumps dominate there: a small bump
in the map just 40 m away blocks about 3° of sky, and near the pole the Sun
never climbs much higher than that. A ground-level eye mostly measures small
bumps.

## 11. (Phase 3) What does the "pick a site, when?" view answer, compared with the "pick a date, where?" view?

- **"Pick a site, when?"** For a fixed site: when are the good times (sunlight,
  Earth contact)?
- **"Pick a date, where?"** For a fixed date: which sites are best then?

## 12. (Phase 4) The battery is sized mainly by one number. Which one, and why not the average sunlight?

The **longest night**, the longest stretch without usable sunlight. Average
sunlight helps size the panels, but the battery has to carry you through the
worst night.

## 13. (Phase 5) For a site to talk directly to Earth, two things must both be true. What are they?

1. Earth is above the skyline seen from the 10 m antenna mast.
2. One of NASA's Deep Space Network dishes (California, Spain or Australia)
   sees the Moon at least 10° above its own horizon.

Earth spins, so each dish sees the Moon only part of the day. The three dishes
together mostly cover it, but not always.

---

**Harder questions**

## 14. Two panel spots 20 m apart both get about 70% sunlight, but one has a 4-day longest night and the other 9 days. How?

The total dark time is about the same, but how it's chopped up differs. The Sun
skims along the horizon. One spot may see through a gap between two hills, so
the Sun peeks through for a few hours in the middle of the dark stretch. That
splits one long night into two shorter ones. The other spot, slightly lower,
can't see through the gap.

The result is the same total darkness, a very different longest night, and so
a very different battery. That's why we check every panel spot, every 20 m out
to 200 m, instead of taking a shortcut.

## 15. In Malapert, the safe target is nearly as sunny as the sunniest spot (81% vs 82% on NASA's map). In Nobile Rim 1, it loses 6 points (77% vs 83%). What does that tell a mission planner?

- **Malapert:** landing safely costs almost no sunlight.
- **Nobile Rim 1:** landing safely costs a lot of sunlight.

On NASA's sunlight map alone, Nobile Rim 1 has the sunniest spot of any region. Once landing safety is added, its sunniest safe target falls behind Malapert's, so the ranking by sunlight changes. That's the point of Phase 6: the sunniest spot on the map isn't always one you can actually use.

Sunlight isn't the whole story, though. Ranked by kit weight, with the panels on a 10 m mast within 200 m of the target, Nobile Rim 1 (22.1 t) comes out ahead of Malapert Massif (25.3 t): the longest night and the recharge time matter as much as the average.

## 16. Does a long gap in Earth contact cost extra battery, to store the data and send the backlog?

No. The data backlog costs no extra battery:

- **During a blackout the radio is off.** The 300 W transmitter only runs
  while there's direct contact with Earth, so when there's no Earth link that
  power isn't used, and that saved power covers storing the data on board.
- **Sending the backlog is already paid for.** The power model runs the
  transmitter at full power for every hour of contact, so catching up on the
  stored data adds nothing.

What a blackout does cost is **storage**: the base makes about 600 Gb of data
a day and sends it at 110 Mbps while in contact, and the app sizes the
on-board storage to hold the largest pile that builds up between contacts.

## 17. We rank targets by the weight of the power kit (solar array and battery) instead of by longest night. Why might those rankings differ?

The kit is the power kit the mission lands: the solar array and the
battery. Air, water and food aren't counted, because with a fixed crew and
stay they weigh the same at every site. Two things make the rankings
differ:

1. **The panels matter too.** A spot with a slightly longer night but much more
   sunlight overall needs a smaller array. That can save more weight than the
   extra battery costs.
2. **Recharging.** If a long night is followed by only a short sunny stretch,
   the battery can't fully refill before the next night, so it has to be even
   bigger. The longest night alone doesn't see that, but the hour-by-hour
   sizing does.

Weight is the more honest number for a planner. Ranking by kit weight rather than average sunlight saves mass in 8 of 9 regions, up to 10.1 t (de Gerlache Rim 2), but 0.2 t or less in three of them. In Nobile Rim 1, the target NASA's sunlight map rates best is also the lightest kit.

## 18. NASA's map says a target is 73% sunny, but the app says 87% at its panels. Didn't you say you're within 2 points of NASA?

Both are right; they measure different things.

- **The 2-point check** compares like with like: the same spot, an eye 2 m
  up, averaged over the same 18.6 years NASA's maps cover.
- **The panel number** is for a panel on a **10 m mast**, at the best spot
  within 200 m of the target, over **one year (2027)**. A taller mast sees
  over nearby bumps, the panel spot is chosen for its light, and a single
  year can be sunnier or darker than the 18.6-year average.

## 19. The battery is 20–35 t at every #1 target. Why not nuclear power or fuel cells?

The app sizes solar plus battery because that's the option sunlight and
night length decide, and the challenge is about comparing sites by their
sunlight and Earth contact. Mass is the common yardstick that lets the nine
regions be compared fairly. The numbers also make the case for alternatives:
the battery is over 90% of every kit, so for a year-round base a fission
power unit would likely be lighter. That's outside what the app models.

## 20. With two relay satellites, why isn't contact 100%?

The relays fill every gap the terrain causes, but a relay still has to talk
to Earth through a Deep Space Network dish. When no dish has the Moon above
10°, nothing gets through, so contact with relays is about 98% and the
longest blackout is about 2 hours.
