# Chat docs audit: handoff (2026-11-14)

## What we're doing

The AI chat (`frontend/functions/api/chat.js`, tools in `frontend/src/chat/tools.js`)
answers "why / how" questions with a `search_docs` tool. That calls
`/api/docs-search` → `frontend/docs-worker/` → Cloudflare AI Search instance
`lunar-lander` (namespace `lunar-navigator-search`) over the R2 bucket
`lunar-navigator-docs`. R2 keys are repo paths with `/` flattened to `_`.

Goal: make the docs the chat reads **consistent** (no contradictions) and free of
anything an end user shouldn't see. We're going through a question list one at a
time with Ashwin, then we'll make the changes.

**Indexed today** (found by probing the live `/api/docs-search`; `wrangler` can't
list the bucket):
`README.md`, `docs/questions.md`, `docs/datasets.md`, `docs/nasa-comparison.md`,
`docs/moon-surface-broken-down.md`, `docs/space-apps/navigator-plan.md`,
`data/phase-1/README.md`, `data/phase-2/README.md`, `data/phase-3/README.md`,
`data/phase-7/README.md`, `data/phase-4/assumptions.csv`.
Not seen in results: `docs/deploy.md`, `tech-debt.md`, `firebase-data.md`,
`phase-2-plan.md`, `full-moon-walkthrough-chunking.md`, `space-apps/chat-tools.md`,
`data/phase-4/README.md`.

Source of truth for numbers: `frontend/public/data/landing.json` (2026, 365 days,
crew, 100 m ellipse, 10° / 95%, panels within 200 m, panels at 10 m) and
`lunarsky/power.py`.

This file sits at the repo root on purpose, so it isn't uploaded with `docs/`.

## Decisions so far

1. **Dev content:** build a **separate, cleaned set of chat docs**; the repo files stay
   as they are. Strip Quick Start, make/gcloud commands, git URL, Cloud Run / Firebase
   bucket names, `data-gathering` branch, SHA-256s, commit hashes, build-log material
   (`moon-surface-broken-down.md` is mostly this), debug flags (`?sundebug`, `?sites=all`).
2. **Teammate's name** ("Josepher's terrain work" in navigator-plan): remove from the chat copy.
3. **Internal references** (`world_sim`, `PROJECT_SPEC.md`, decision 002, the "Lander in a
   jar" Pi heat-lamp add-on, the `navigator/` package plan, "Where do we host the demo?"):
   cut from the chat copy.
4. **Phase 4 README "filled in from memory / VERIFY" status:** stale (no row says VERIFY);
   drop it.
5. **Sites outside the 9 Artemis regions:** remove from the chat copy (validation rows for
   im-1, im-2, change-7, blue-moon-mk1, apex-1, viper, griffin-1; "17 more sites", "26
   predetermined sites", "17 skylines"). **Exception:** IM-1 and IM-2 stay only as the
   historical story of what happened (IM-1 tipped on ~12° slope, we measure 13.2°; IM-2
   tipped in a sub-pixel crater), not as sites in the app.
6. **"Beats NASA" wording:** drop it. Use numbers from landing.json, phrased like
   "ranking by kit weight instead of average sunlight saves mass in 8 of 9 regions, up to
   9.5 t (de Gerlache Rim 2), half a tonne or less in four of them". The "NASA top pick"
   is just NASA's average-sunlight map used naively, not a pick NASA made. Fixes
   questions.md Q8 ("7 of 9") and Q17 ("about 8 t"), and README line 175 (unchecked
   "needs a rerun", which landing.json shows is done).

## Remaining questions

7. **Phase 6 results table in navigator-plan.md is stale.** E.g. Mons Mouton 40.0 t there vs
   31.8 t in landing.json; Peak Near Cabeus B contact 49–83% there vs ~97% now; Malapert
   night 7.9 d vs 7.0 d; the "Malapert landing point 20-day night, panel 83 m away 7.9 d"
   bullet. Step 5 says "both panel picks" (two), not three. Regenerate the table and
   bullets from landing.json?
8. **Heights.** System prompt: panels 10 m, Earth antenna 10 m, person in 3D at 2 m.
   questions.md Q5: "panel up on a 2 m mast"; Q10: skylines at 2 m because "two meters is
   roughly the height of a solar panel". moon-surface: surface camera / horizon line at
   10 m. README Phase 3 limit: "2 m eye height". What's the one story? (Likely: accuracy
   check at 2 m, Phase 3 views at 2 m, panels and antenna at 10 m.)
9. **Accuracy numbers.** README + nasa-comparison: mean 2.2 pp, worst 7.0 (artemis-mp),
   14 sites, smooth Moon 18.8. moon-surface: 1.7 pp, worst 5.7 (artemis-ma), 16 sites,
   smooth 19.9, and 0 m given as both 3.9 pp and 18.5 pp. Which is current? And once
   non-Artemis sites are cut (decision 5), recompute the averages over the 9 regions only?
10. **Earth validation height.** nasa-comparison: Earth checked at 2 m. moon-surface:
    "~2.5 pp (Earth, 0 m)". Which?
11. **Power load.** assumptions.csv `load_base` = 20 kW "habitat only" (Csank 2023), but
    `lunarsky/power.py` sizes from the load list: 6.0 + 1.5 + 0.3 + 1.0 + 1.2 ≈ 10 kW.
    Is `load_base` dead (remove from the chat copy)? navigator-plan Phase 5 still
    describes the load list as to-do.
12. **Data backlog and power.** questions.md Q16: sending the backlog costs battery and is
    in tech-debt. power.py: no extra battery, since the radio already draws full power
    every contact hour; on-board storage is modelled. Rewrite Q16 to match the code?
13. **Kit contents.** questions.md Q17: "total weight (solar array plus battery)". Everywhere
    else: array + battery + supplies. Fix to include supplies?
14. **Walking range.** phase-7 README: "within the 2 km moonwalk range". Everywhere else:
    300 m on-foot reach (carrying panels). Is 2 km a separate moonwalk limit, or should it
    read 300 m?
15. **Default stay.** phase-7 README: "a 60-day crewed stay (Phase 4 default)", ~82 mSv.
    Default is now 365 days (~500 mSv at 1.37 mSv/day, ~83% of the 600 mSv career limit).
    Update to a year?
16. **Oxygen.** phase-7 README: crew of 4 breathes ~3.6 kg/day. assumptions.csv:
    0.84 × 4 = 3.36 kg/day. Use 3.4?
17. **Mission year text.** navigator-plan: "moved back from 2026 to 2026" (garbled) and
    "early 2026", vs system prompt "2026 or later". Fix to "from 2028 to 2026", and say
    "2026 by default, editable"?
18. **Stale to-do text.** phase-2 README: 20 m map as "upgrade later", "5 m site maps
    planned for Phase 6", code sketch "not yet run, rasterio not installed". phase-3 README:
    "per-date values Phase 3 will compute". README says dates to 2049, phase-1 says 2050.
    Clean these up in the chat copy?
19. **questions.md Q15 numbers** (Malapert 81% vs 82%, Nobile Rim 1 77% vs 83%) come from the
    old 2 m, two-pick run. Recheck against landing.json and update?

## Also to decide when building

- **Format of the chat set:** a new folder (e.g. `chat-docs/`) of cleaned copies, uploaded
  to `lunar-navigator-docs` in place of the current files, plus a script to rebuild and
  upload it. Old R2 objects need deleting so AI Search stops returning them.
- **System prompt** (`chat.js` `SYSTEM`) should match whatever we settle on for heights,
  year and kit contents.
- After upload: re-run the probe queries and the 16 test questions in
  `docs/space-apps/chat-tools.md`.
