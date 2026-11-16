// The chat box: a floating panel that asks /api/chat for each model turn and
// runs the tools it calls here in the page (tools.js), looping until the
// model answers in text. Mount with mountChat().

import "./chat.css";
import { toolSchemas, runTool } from "./tools.js";

const MAX_STEPS = 8;        // model turns per question (tool rounds + the answer)
const MAX_SEARCHES = 3;     // doc searches per question: more only repeats itself
const EXAMPLES = [
  "Which region is best for a year-long crewed base?",
  "When in 2027 should we land at Nobile Rim 1 for two weeks?",
  "How heavy is the power kit at Slater Plain if we add a crewed rover?",
  "Why put the panels on a 10 m mast?",
];

const TOOL_LABEL = {
  list_regions: "Listing the regions",
  region_conditions: "Checking Sun and Earth",
  compare: "Comparing",
  landing_targets: "Reading landing targets",
  size_power: "Sizing the power kit",
  dark_periods: "Finding nights and blackouts",
  water_ice: "Looking up water ice",
  assumptions: "Reading the assumptions",
  search_docs: "Searching the docs",
  show_in_app: "Flying there",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Just enough Markdown for model answers: bold, line breaks, bullet lines.
const fmt = (s) => esc(s.replace(/【[^】}\n]*[】}]/g, ""))   // gpt-oss's citation marks: 【…】 or 【…}
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/^\s*[-*] (.+)$/gm, "• $1")
  .replace(/\n/g, "<br>");

// What the person sees when the chat server is missing or broken; the
// technical detail goes to the console.
const OFFLINE = "Chat is offline right now — try again later.";
// Errors the chat function words for people (rate limits, a too-long
// conversation, the model not answering) are shown as they are.
const SHOWN_STATUSES = new Set([400, 429, 502]);

async function modelTurn(messages, model, fresh = false, withTools = true) {
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, tools: withTools ? toolSchemas() : [], model, ...(fresh && { fresh: true }) }),
    });
  } catch (e) {
    console.warn("Chat: no response from /api/chat", e);
    throw new Error(OFFLINE);
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    console.warn(`Chat: /api/chat answered HTTP ${res.status}`, body?.error ?? "");
    throw new Error(SHOWN_STATUSES.has(res.status) && body?.error ? body.error : OFFLINE);
  }
  return body;
}

/**
 * One question → answer. `onStep(label)` reports each tool as it runs.
 * Mutates `history` (the model-facing conversation) and returns the answer text.
 */
const KEEP_TURNS = 6;   // earlier questions and answers kept as context

export async function ask(history, question, onStep = () => {}, { model } = {}) {
  // Earlier questions keep only the question and the final answer: their
  // tool calls and results (a doc search alone is ~6 KB) would soon make the
  // conversation too long to send. The current question keeps everything.
  const past = history.filter((m) => m.q || m.final).slice(-2 * KEEP_TURNS);
  history.splice(0, history.length, ...past);
  history.push({ role: "user", content: question, q: true });
  // A model sometimes substitutes a 365-day calculation after correctly
  // saying that a longer requested stay is unsupported. Stop before sizing.
  const requestedDays = [...question.matchAll(/\b(\d[\d,]*)\s*[- ]?\s*days?\b/gi)]
    .map((m) => Number(m[1].replaceAll(",", ""))).find((days) => days > 365);
  if (requestedDays) {
    const answer = `The app supports stays of 1–365 days. ${requestedDays} days is outside that range.`;
    history.push({ role: "assistant", content: answer, final: true });
    return answer;
  }
  let nudged = false, searches = 0;
  // Unusable replies: one repeated character ("!!!!…"), or the model's own
  // wire format with nothing left once it's removed (the server sets `broken`).
  // (A long run of dashes is just a rule or a table line, not garbage.)
  // An empty reply with no tool call is no answer either.
  const bad = (out) => out.broken || (!out.text?.trim() && !out.tool_calls?.length) || /([^\s\-=_.|*#~:])\1{24,}/.test(out.text || "");
  // A Moon number: digits with a unit the app reports. ("The 9 regions" isn't one.)
  const MOON_NUMBER = /\d(?:[\d.,]*\d)?\s*(?:%|h\b|hours?\b|t\b|tonnes?\b|kW|kWh|m²|km|°|days?\b)/i;
  // An answer that turns the question away, and questions about the chat
  // itself (those are declined without a search).
  const DECLINE = /^(?:I(?:'|’)m (?:here|set up|focused|sorry|the (?:guide|Lunar)|not able|only able)|I(?:'|’)m sorry|Sorry|I can(?:'|’)t|I can (?:only )?help|I don(?:'|’)t have|I(?:'|’)m not (?:sure|able))/i;
  // Plainly off-topic requests and noise: declined without a search.
  const OFF_TOPIC = /\b(?:poem|poetry|joke|story|song|lyrics|haiku|essay|homework|script|code|program(?:me)?|python|javascript|sql|translate|invest(?:ing|ment)?|stocks?|crypto|bitcoin|recipe|weather|sports?|movie)\b|\d+\s*[-+*/x×]\s*\d+\s*[=?]?\s*$/i;
  const ABOUT_THE_CHAT = /\b(?:instructions?|prompt|rules|tools?|functions?|api|endpoint|model|bucket|hosted|who (?:built|made|makes)|developer|verbatim|ignore|DAN)\b/i;
  for (let step = 0; step < MAX_STEPS; step++) {
    // On the last step the model gets no tools, so it has to answer with what it has.
    const last = step === MAX_STEPS - 1;
    let out = await modelTurn(history, model, false, !last);
    for (let retry = 0; retry < 2 && bad(out); retry++) out = await modelTurn(history, model, true, !last);
    if (bad(out)) out = { text: "Sorry, the model's answer came out garbled. Please ask again.", tool_calls: [] };
    // Push back once if the model answers without the tools: numbers with no
    // tool result behind them, or a tool call written out as text.
    const usedTools = history.some((m) => m.role === "tool");   // this question's tools only
    const fakeCall = /\[\s*\w+\(|<tools?>|"name"\s*:\s*"\w+"/.test(out.text || "");
    // A decline with no tool used: have it search the docs once first. Short
    // questions about a term or a place ("What does PSR stand for?") were
    // being turned away as off-topic. Not for questions about the chat itself.
    if (!out.tool_calls?.length && !nudged && !last && !usedTools && !fakeCall
        && DECLINE.test((out.text || "").trim()) && !/\?\s*$/.test(out.text || "") && /\p{L}{2,}\s+\p{L}{2,}/u.test(question) && !ABOUT_THE_CHAT.test(question) && !OFF_TOPIC.test(question)) {
      nudged = true;
      history.push({ role: "assistant", content: out.text || "" });
      history.push({ role: "user", content: "Before declining, search the docs once with my question and answer from what they say. If my question is plainly unrelated to the Moon, spaceflight or this app, or the docs don't cover it, give your short reply again." });
      continue;
    }
    if (!out.tool_calls?.length && !nudged && !last && (fakeCall || (!usedTools && MOON_NUMBER.test(out.text || "")))) {
      nudged = true;
      history.push({ role: "assistant", content: out.text || "" });
      history.push({ role: "user", content: fakeCall
        ? "Make that tool call with the tool-calling interface, not as text."
        : "Get those numbers from the tools first; don't answer from memory." });
      continue;
    }
    if (!out.tool_calls?.length) {
      const text = out.text?.trim() || "I couldn't find an answer to that.";
      history.push({ role: "assistant", content: text, final: true });
      return text;
    }
    history.push({
      role: "assistant", content: out.text || "",
      tool_calls: out.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
    });
    for (const c of out.tool_calls) {
      let result;
      if (c.name === "search_docs" && ++searches > MAX_SEARCHES) {
        result = { error: "You have searched the docs three times for this question. Answer now with what you found, or say the docs don't cover it." };
      } else {
        // The first doc search uses the person's own words: the model's
        // rewordings ("PSR abbreviation meaning in lunar context") miss
        // passages the plain question finds.
        if (c.name === "search_docs" && searches === 1) c.arguments = { ...c.arguments, question };
        onStep(TOOL_LABEL[c.name] || c.name);
        result = await runTool(c.name, c.arguments);
      }
      history.push({ role: "tool", tool_call_id: c.id, name: c.name, content: JSON.stringify(result) });
    }
  }
  const text = "I couldn't put an answer together for that. Try asking about one region or one thing at a time.";
  history.push({ role: "assistant", content: text, final: true });
  return text;
}

// Region names in an answer become chips that fly the 3D view there.
let regionNames = [];   // [{ id, name }], longest names first
fetch("/data/sites.json").then((r) => r.ok ? r.json() : [])
  .then((list) => { regionNames = list.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => b.name.length - a.name.length); })
  .catch(() => {});

function withChips(html) {
  if (!regionNames.length) return html;
  // Any whitespace between words: the model often writes non-breaking spaces.
  const pattern = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s\\u00a0\\u202f]+");
  const re = new RegExp(`\\b(${regionNames.map((r) => pattern(r.name)).join("|")})\\b`, "g");
  const norm = (t) => t.replace(/[\s\u00a0\u202f]+/g, " ");
  // Only outside tags, so attributes and markup aren't touched.
  return html.split(/(<[^>]+>)/).map((part) => part.startsWith("<") ? part : part.replace(re, (name) => {
    const r = regionNames.find((x) => x.name === norm(name));
    return `<button type="button" class="chat-chip" data-site="${r.id}">${name}</button>`;
  })).join("");
}

export function mountChat(root = document.body) {
  const history = [];
  const el = document.createElement("div");
  el.id = "chat";
  el.innerHTML = `
    <section class="chat-panel" hidden aria-label="Ask the navigator">
      <header class="chat-head"><span>Ask the navigator</span><button type="button" class="chat-close" aria-label="Close (Esc)" title="Close (Esc)">×</button></header>
      <div class="chat-log" role="log" aria-live="polite">
        <div class="chat-intro">Ask about the 9 Artemis regions: sunlight, nights, Earth contact, landing targets and the power kit. Numbers come from the app's own data.</div>
        <div class="chat-examples">${EXAMPLES.map((q) => `<button type="button">${esc(q)}</button>`).join("")}</div>
      </div>
    </section>
    <form class="chat-bar">
      <span class="chat-spark" aria-hidden="true">✦</span>
      <input type="text" placeholder="Ask about these sites…" maxlength="400" autocomplete="off" aria-label="Ask a question">
      <kbd class="chat-kbd">${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl "}K</kbd>
      <button type="submit" class="chat-send" aria-label="Send" title="Send">↑</button>
    </form>`;
  root.appendChild(el);

  const panel = el.querySelector(".chat-panel");
  const log = el.querySelector(".chat-log");
  const form = el.querySelector(".chat-bar");
  const input = form.querySelector("input");
  const sendBtn = form.querySelector(".chat-send");
  let busy = false;

  const toggle = (open) => {
    panel.hidden = !open;
    el.classList.toggle("open", open);
    if (open) { input.focus(); log.scrollTop = log.scrollHeight; }
  };
  input.addEventListener("focus", () => toggle(true));
  el.querySelector(".chat-close").addEventListener("click", () => { toggle(false); input.blur(); });
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggle(true); }
    else if (e.key === "Escape" && !panel.hidden) { toggle(false); input.blur(); }
  });
  // Keep the app's own keys (Space, F, WASD…) from firing while typing.
  input.addEventListener("keydown", (e) => e.stopPropagation());

  const add = (cls, html) => {
    const d = document.createElement("div");
    d.className = `chat-msg ${cls}`;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };

  async function send(q) {
    if (busy || !q.trim()) return;
    busy = true;
    sendBtn.disabled = true;
    toggle(true);
    el.querySelector(".chat-examples")?.remove();
    el.querySelector(".chat-intro")?.remove();
    add("user", esc(q));
    const pending = add("bot pending", "Thinking…");
    try {
      const text = await ask(history, q, (label) => {
        const step = document.createElement("div");
        step.className = "chat-tool";
        step.textContent = label;
        log.insertBefore(step, pending);
        log.scrollTop = log.scrollHeight;
      });
      pending.className = "chat-msg bot";
      pending.innerHTML = withChips(fmt(text));
    } catch (e) {
      history.pop();   // drop the unanswered question
      pending.className = "chat-msg bot error";
      pending.textContent = e.message;
    }
    log.scrollTop = log.scrollHeight;
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value; input.value = ""; send(q); });
  log.addEventListener("click", (e) => {
    const chip = e.target.closest(".chat-chip");
    if (chip) { window.dispatchEvent(new CustomEvent("chat:show", { detail: { siteId: chip.dataset.site } })); return; }
    if (e.target.closest(".chat-examples button")) send(e.target.textContent);
  });
  return { open: () => toggle(true), ask: send };
}
