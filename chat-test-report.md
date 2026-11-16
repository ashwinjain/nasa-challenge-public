# Chat test report (2026-11-15)

Deep test of the "Ask the navigator" chat: its answers, its tools and its
docs search. This file sits at the repo root so it isn't uploaded with the
chat docs.

## Summary

- **Before:** of 125 test questions, about 44 got a wrong, missing or broken
  answer (18 wrong facts, 12 gave up or showed raw model text, 14 said "I
  don't have that" for things the app knows).
- **After:** on the last full run (133 questions) 111 passed the automatic
  check. Of the 22 flagged, 15 were harmless (the model turned hours into
  days or subtracted two tool numbers) and 7 were real. Six of those 7 were
  fixed afterwards and re-asked one by one; one kind remains (see "Still
  open").
- **Not done:** the code changes are **not deployed and not committed**. The
  live site still runs the old chat code. The docs index and its settings
  **are** live (they had to be, to test search). I did not repeat the full
  133-question run after the last round of fixes, only the affected
  questions.
- The 14 tool tests pass (`node --test tests/chat/tools.test.mjs`).

## How it was tested

- `tests/chat/ask.mjs` runs the chat's real loop (`frontend/src/chat/chat.js`
  and `tools.js`, unchanged) in Node against a local `wrangler pages dev`,
  and saves each answer with every tool call and result behind it.
- `tests/chat/questions.json`: 133 questions with what to expect (which tool,
  a fact that must appear, text that must not). Groups: the 16 spec
  questions, region facts and rankings, dates and edge years, power sizing,
  landing targets, how/why questions, out-of-scope and prompt-injection
  attempts, wording (night vs blackout), app help, and follow-up
  conversations.
- `tests/chat/check.mjs` flags an answer when the expected tool wasn't used,
  a required fact is missing, a number appears that no tool returned, or
  tool/prompt text leaked into it. I read every flagged answer.
- Expected values came from `landing.json` and a separate Python check of
  the Sun files (`data/sun/*.bin`) against `landing.json`: sunlight matches
  to 0.02 points and longest night to 1 hour at all 9 regions.
- Each tool was also called directly with about 90 normal and bad inputs.
- One check in the real page (local): "When does the longest night at
  Haworth start in 2026, and is there water ice nearby?" answered correctly
  using the two new tools and flew the 3D view there.

## Bugs found and fixed

### Chat loop and model output

| Bug | Example | Fix |
|---|---|---|
| Raw model text shown as the answer (`<|channel|>analysis…`, a tool call written as text) | "What is the Connecting Ridge site like?", "What do the timeline colors mean?" | `tidy()` in `functions/api/chat.js`: keeps the real answer, recovers the tool call if there is one, otherwise marks the reply broken so the page asks again |
| Source marks left in answers (`【docs/…†L10】`, `【list_regions】`) in 26 answers | most "why" answers | stripped on the server (the page's own filter missed the unclosed ones) |
| "That took too many steps" after 8 doc searches in a row (7 questions) | "How much does the mast weigh?", "Which region is closest to the south pole?" | 3 searches per question; on the last step the model gets no tools and must answer |
| Empty answers | long multi-tool questions | the model's hidden reasoning used the whole 1,024-token budget; raised to 3,000, and an empty reply is retried |
| "Answer came out garbled" for any answer with a table | "Show me the top 5 landing targets at Malapert Massif" (failed 3 of 3) | the repeated-character check matched the dashes in table lines; fixed, and the prompt now asks for bullet lists (the chat box doesn't draw tables) |
| The "use the tools" nudge fired on any digit | "How do I use this?" got a table of kit masses | fires only on a number with a unit (%, h, t, kW…) |

### Tools (`frontend/src/chat/tools.js`)

| Bug | Fix |
|---|---|
| Earth contact came from the region pin while sunlight, kit and landing targets used the #1 target, so one answer could say "Earth in view 90.6%" and "direct contact 97.2%" for Peak Near Cabeus B | Earth contact now comes from the `contact` layer of the Sun files (the #1 target's antenna mast), as the audit session also asked. Reported as direct contact % |
| Stays that ran past a year file had no Earth data (a 365-day stay had to start by 1 March) | covered by the Sun files to 2037; relay hours carry on into the next year's file |
| Dates outside the app's range were answered (2036, 2040) or leaked internals ("data runs to 2037-01-01") | all tools take 2026-01-01 to 2035-12-31 only, with one plain error |
| Impossible inputs were answered: 30 February, 0 or negative days, 1.5 days, crew of 0 or −2, target 99 | refused with a clear message (stay 1–365, crew 1–50, target 1–10, as the app's own controls) |
| `extras: "crewed rover"` added both rovers | one load per comma; the options are described to the model |
| Typos failed ("Malapart Masif"); an empty name matched every region | near-miss matching; empty asks which region |
| Kit masses differed by tool (21.68 vs 21.7) | 0.1 t everywhere |
| Region ids (`artemis-hw`) shown in answers | no tool returns them |
| "When should we land for a year?" gave a two-week best date as the answer for a year | `compare` with a long stay now returns the same stay from four dates and from every year 2026–2035, with a note that the date matters little |
| Ties in date ranking (weeks with no night) always returned 1 Jan, 15 Jan… | ties broken on the other Sun figure, then Earth contact; the tool says how many days tie |

### Docs search

| Bug | Fix |
|---|---|
| Every passage cut to 1,500 characters while chunks were about 3,500, so an answer in the second half of a chunk never reached the model | whole chunks returned (chunk size now 512 tokens), 5 passages |
| Plain questions returned nothing ("What battery energy density do you assume?", "How do you know where the Sun is?") | index settings: similarity cache off (it also served stale results for 48 h after a docs change), score threshold 0.4 → 0.3 |
| The index returns nothing for about 1 call in 3, then works on the next try | `docs-search.js` asks up to 4 times |
| The assumptions CSV ranked high for unrelated questions | removed from the index; replaced by the `assumptions` tool and a readable Assumptions doc |
| Answers quoted file paths (`docs/space-apps/navigator-plan.md`) | passages are labelled "the FAQ", "the Assumptions list" and so on |

### Wrong answers traced to the prompt or docs

- Kit masses 10 t too high (31.7 t for Mons Mouton) because the docs still
  included supplies. The audit session regenerated those tables; the prompt
  now sends region numbers to the data tools, never the docs.
- "NASA's maps use 2 m": the prompt now says NASA's height is unknown.
- "Does your tool beat NASA's?" → "Yes." Now answers that it isn't a
  competition, with the kit-weight numbers.
- "What is Artemis III?" was answered from memory with invented details
  (2026 launch, Gateway, a year on the surface). Now answered from a new FAQ
  entry that separates NASA's mission from the app's own scenario.
- Valid questions refused as off-topic (IM-1 and IM-2, a smooth Moon, crew
  oxygen) after I first made the off-topic rule too wide; narrowed.
- "10 m gets 1.5 points less sunlight than 2 m at Malapert": the 2 m figure
  is at a different spot. The tool result and the prompt now say so.

## New tools

- **`dark_periods`**: when the nights and comms blackouts fall in a stay
  (count, total hours, the first, the longest few with start and end).
  Before, "when does the longest night start?" got a wrong date.
- **`water_ice`**: nearest permanently shadowed area per region (size,
  distance, temperature, share cold enough). Information only. Before, the
  chat said it had no such data. No radiation or route figures.
- **`assumptions`**: the load list, battery, solar cells, margins, data rates
  and per-person supplies, with units and sources.
- Also: `landing_targets` now gives safe-zone counts, the saving against the
  target NASA's map rates best, one target by rank, or every region's #1
  target in one call; `size_power` gives data storage, sunlight and contact;
  `compare` can rank the worst dates; `list_regions` gives coordinates.

## Docs changed (`chat-docs/`, uploaded)

- **New `docs/faq.md`** (26 questions a user asks first): what the app is,
  how to use it, comparing stays, timeline colors, what the numbers mean,
  why two sunlight numbers, why a 10 m mast, what's in the kit, why the
  battery dominates, the power load, battery and solar assumptions,
  blackouts and battery, why Earth isn't always visible, relays, why nights
  aren't two weeks, why the south pole, Artemis III and the nine regions,
  comparison with NASA, when to land, accuracy, data sources, what isn't
  covered, where the assumptions are.
- **New `docs/assumptions.md`**, generated from the app's Assumptions page
  (`scripts/build_chat_assumptions.mjs`), without "team decision" notes.
- **New `docs/water-ice.md`**, cleaned from the Phase 7 notes (no radiation,
  no 2 km walking range, no 60-day stay).
- `docs/questions.md`: one heading per question so each is its own passage;
  "preparing for judges" wording removed.
- `docs/datasets.md`: no file path in the Phase 4 heading.
- Removed `data/phase-4/assumptions.csv` from the chat set.
- By the audit session, in the same files: supplies taken out of the kit
  everywhere, the Phase 6 results table regenerated from `landing.json`,
  relays at about 98% rather than 100%, and three new Q&As.

Nothing uploaded contains setup steps, bucket or API names, team names or
radiation figures. The out-of-scope and injection questions (system prompt,
R2 bucket, who built it, model name, radiation, cost, Starship, Shackleton,
Apollo 11, temperature) were all declined in the final run.

## Files

- Changed: `frontend/src/chat/tools.js`, `frontend/src/chat/chat.js`,
  `frontend/functions/api/chat.js`, `frontend/functions/api/docs-search.js`,
  `scripts/upload_chat_docs.sh`, `docs/space-apps/chat-tools.md`,
  `.claude/launch.json` (a `chat` server entry).
- New: `tests/chat/` (harness, questions, checker, tool tests, README),
  `scripts/build_chat_data.py`, `scripts/build_chat_assumptions.mjs`,
  `frontend/public/data/water_ice.json`, `frontend/public/data/assumptions.json`.
- Cloudflare AI Search instance `lunar-lander`: cache off, score threshold
  0.3, chunk size 512, overlap 15.

## Still open

1. **Deploy.** The live chat has the old code with the new docs. It works,
   but none of the fixes above are live until the Pages app is deployed.
2. **Invented reasons.** Asked "why a 25% margin?", the model gives the NASA
   rule correctly and then adds its own gloss ("to cover degradation and
   unforeseen demands"). The prompt forbids it; it still happens sometimes.
3. **Year-by-year questions.** "How does the longest night change from 2026
   to 2035?" still made seven separate calls and then said 2033–2035
   "aren't available" (it ran out of steps). `compare` now returns all ten
   years in one call, but the model didn't use it in the last check.
4. **Rounding.** The model sometimes writes "about 80%" for 79.5%.
5. **The index's dropped calls** are a Cloudflare-side fault; the retry
   hides most of it. Worth watching.
6. **Local Python API** on port 8000 wasn't answering during the browser
   check, so the timeline's custom window got a 500. Production answered the
   same request. Not a chat bug.
7. Answers vary from run to run. A question that passed once can fail the
   next time; the 133-question run is the thing to repeat after any prompt
   change (30–40 minutes).
