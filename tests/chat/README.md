# Chat tests

Two layers, both in Node (`env.mjs` stands in for the browser so the chat's
own code in `frontend/src/chat/` runs unchanged).

## The tools, no server

```
node --test tests/chat/tools.test.mjs
```

Runs every tool on the static data in `frontend/public/data/` and checks it
against `landing.json`: kit masses, nights, rankings, best and worst dates,
name matching, and that bad inputs are refused instead of answered.

## The whole chat

Needs the chat's Pages Function (`cd frontend && npx wrangler pages dev`,
port 8788), Vite (`npm run dev`, which proxies `/api/chat` to it) and a
wrangler login for the docs search.

```
node tests/chat/ask.mjs tests/chat/questions.json out.json 3
node tests/chat/check.mjs tests/chat/questions.json out.json          # flagged answers only
node tests/chat/check.mjs tests/chat/questions.json out.json --full   # every answer
```

`ask.mjs` puts each question through the real loop (model turn, tools,
answer) and saves the answer with every tool call and result. A `q` that is
a list is one conversation of follow-ups. `check.mjs` flags an answer when:

- none of the expected `tools` was called,
- it doesn't match `must`, or matches `mustnot` (regular expressions),
- it contains a number that is in no tool result and not in the question,
- tool-call text, source marks or the prompt leaked into it, or it gave up.

A flag means "read this one", not "wrong": the model may round, convert
hours to days or subtract two tool numbers. About 125 questions use real
model calls, so a full run takes 30–40 minutes.

By default the docs search runs this repo's `functions/api/docs-search.js`
against the live index through `wrangler ai-search search`, so search
changes can be tested before deploying. `DOCS=https://…` uses a deployed
site's `/api/docs-search` instead.
