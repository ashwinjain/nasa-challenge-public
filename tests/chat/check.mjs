// Check a run from ask.mjs against the expectations in questions.json.
//
//   node tests/chat/check.mjs questions.json out.json [--full]
//
// For each question: were the expected tools called, does the answer match
// `must` and avoid `mustnot`, and is every number in it one a tool returned
// (or in the question)? It flags; a person still reads the flagged answers.
import { readFileSync } from "node:fs";

const [, , qFile, outFile, flag] = process.argv;
const qs = new Map(JSON.parse(readFileSync(qFile, "utf8")).map((q) => [q.id, q]));
const runs = JSON.parse(readFileSync(outFile, "utf8"));

const nums = (t) => (String(t).replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) || []).map(Number);
// Numbers that need no source: small counts, the app's fixed figures, years.
const FREE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 20, 24, 30, 60, 95, 100, 200, 300, 365, 500]);
const LEAK = /<\|[a-z_]+\|>|【|to=functions\.|"name"\s*:\s*"\w+"|```json|\b(system prompt|ALLOWED_TOOLS)\b/i;

let fails = 0;
const tally = {};
for (const run of runs) {
  const q = qs.get(run.id) || {};
  const last = run.turns.at(-1);
  // The model likes non-breaking spaces and hyphens; compare on plain ones.
  const answer = run.turns.map((t) => t.answer || "").join("\n---\n")
    .replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[\u2010\u2011]/g, "-").replace(/(\d) (\d{3})\b/g, "$1$2");
  const called = run.turns.flatMap((t) => t.calls.map((c) => c.name));
  const source = JSON.stringify(run.turns.map((t) => [t.q, t.results]));
  const known = new Set(nums(source));
  const problems = [];
  if (run.turns.some((t) => t.error)) problems.push(`error: ${run.turns.find((t) => t.error).error}`);
  if (q.tools && !q.tools.some((t) => called.includes(t))) problems.push(`tools: wanted one of ${q.tools.join("|")}, got ${called.join(",") || "none"}`);
  if (q.must && !new RegExp(q.must, "is").test(answer)) problems.push(`missing /${q.must}/`);
  if (q.mustnot && new RegExp(q.mustnot, "i").test(answer)) problems.push(`has /${q.mustnot}/`);
  if (LEAK.test(answer)) problems.push("tool-call or prompt text leaked into the answer");
  if (/took too many steps|couldn't find an answer|garbled/.test(answer)) problems.push("gave up");
  const loose = [...new Set(nums(answer))].filter((n) => !known.has(n) && !FREE.has(n) && !(n >= 2024 && n <= 2040));
  if (loose.length) problems.push(`numbers not in any tool result: ${loose.join(", ")}`);
  if (run.turns.some((t) => t.nudged)) problems.push("(needed a nudge)");
  const bad = problems.filter((p) => !p.startsWith("(")).length;
  if (bad) fails++;
  for (const p of problems) { const k = p.split(":")[0].replace(/\/.*/, ""); tally[k] = (tally[k] || 0) + 1; }
  if (bad || flag === "--full") {
    console.log(`\n${bad ? "✗" : "✓"} ${run.id}  ${[].concat(q.q).join(" → ")}`);
    console.log(`   tools: ${called.join(", ") || "none"}   ${Math.round(run.turns.reduce((s, t) => s + t.ms, 0) / 1000)} s`);
    for (const p of problems) console.log(`   ! ${p}`);
    if (q.note) console.log(`   expect: ${q.note}`);
    console.log(`   answer: ${answer.replace(/\n/g, "\n           ")}`);
  }
}
console.log(`\n${runs.length - fails} of ${runs.length} clean, ${fails} flagged`, tally);
