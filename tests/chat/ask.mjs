// Ask the chat a list of questions through its real tool loop and save every
// answer with the tool calls and results behind it.
//
//   node tests/chat/ask.mjs questions.json out.json [concurrency]
//
// questions.json: [{ id, q }] where q is a question or a list of follow-ups
// asked in one conversation. Needs the dev servers (see env.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import "./env.mjs";

const { ask } = await import("../../frontend/src/chat/chat.js");
const [, , inFile, outFile, conc = "2"] = process.argv;
const items = JSON.parse(readFileSync(inFile, "utf8"));
const out = [];

async function one(item) {
  const history = [];
  const turns = [];
  for (const q of [].concat(item.q)) {
    const t0 = Date.now();
    let answer, error;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { answer = await ask(history, q); error = undefined; break; }
      catch (e) {
        error = e.message;
        if (history.at(-1)?.role !== "assistant") while (history.length && !history.at(-1).final) history.pop();
        if (!/right now|minute|429/.test(error)) break;
        await new Promise((r) => setTimeout(r, 30000));   // rate limited: wait and retry
      }
    }
    // After ask(), history holds this question's whole tool exchange.
    const at = history.findLastIndex((m) => m.q);
    const steps = history.slice(at + 1);
    turns.push({
      q, answer, error, ms: Date.now() - t0,
      nudged: steps.some((m) => m.role === "user"),
      calls: steps.filter((m) => m.tool_calls).flatMap((m) => m.tool_calls.map((c) => ({ name: c.function.name, args: JSON.parse(c.function.arguments) }))),
      results: steps.filter((m) => m.role === "tool").map((m) => ({ name: m.name, result: JSON.parse(m.content) })),
    });
  }
  out.push({ id: item.id, turns });
  const last = turns.at(-1);
  console.error(`${item.id}  ${last.calls.map((c) => c.name).join(",") || "-"}  ${last.error ? "ERROR " + last.error : ""}`);
  writeFileSync(outFile, JSON.stringify(out.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })), null, 1));
}

const queue = [...items];
await Promise.all(Array.from({ length: Number(conc) }, async () => { while (queue.length) await one(queue.shift()); }));
