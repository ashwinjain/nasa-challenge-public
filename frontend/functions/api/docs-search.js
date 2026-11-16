// POST /api/docs-search — the chat's search_docs tool (Cloudflare Pages Function).
// Searches the project docs (docs/ and the phase READMEs, uploaded to R2 and
// indexed by Cloudflare AI Search). Returns passages and their source file;
// the chat model writes the answer from them.
//
// Bindings: DOCS_WORKER (docs-worker/, which holds the AI Search namespace
// binding Pages can't), else DOCS or AI. Var: AI_SEARCH_NAME (the instance).

const MAX_PASSAGES = 5;
const MAX_PASSAGE_CHARS = 2600;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// The words of a question that name its subject: no question words, articles
// or "stand for / mean".
const FILLER = new Set(("a an the is are was were do does did what whats which who whom when where why how can could should would will "
  + "i you we it its this that these those there here of for to in on at by with about from and or as be me my your our "
  + "stand stands mean means meaning define definition tell explain please").split(" "));
const keyTerms = (q) => String(q).replace(/[’']s\b/g, "").split(/[^\p{L}\p{N}°%-]+/u).filter((w) => w && !FILLER.has(w.toLowerCase()));

export async function onRequestPost({ request, env }) {
  if (!env.DOCS_WORKER && (!(env.DOCS || env.AI) || !env.AI_SEARCH_NAME)) return json({ error: "Document search isn't configured on this deployment." }, 503);
  let question;
  try { ({ question } = await request.json()); } catch { return json({ error: "Bad JSON" }, 400); }
  if (!question || String(question).length > 500) return json({ error: "Ask a question under 500 characters." }, 400);
  try {
    // An instance in a named namespace (DOCS binding), else the default namespace.
    const search = async (text = String(question)) => {
      const query = { query: text, max_num_results: MAX_PASSAGES };
      if (env.DOCS_WORKER) {
        const r = await env.DOCS_WORKER.fetch("https://docs/search", { method: "POST", body: JSON.stringify(query) });
        if (!r.ok) throw new Error(`docs worker HTTP ${r.status}`);
        return r.json();
      }
      const index = env.DOCS ? env.DOCS.get(env.AI_SEARCH_NAME) : env.AI.autorag(env.AI_SEARCH_NAME);
      return index.search(query);
    };
    // The index now and then answers with nothing, or with keyword matches
    // only, for a question it answers in full a moment later (its meaning
    // search drops out). So ask again, up to four times, until that part
    // has answered; keep the fullest reply.
    const n = (x) => (x?.chunks ?? x?.data ?? []).length;
    // A short question ("What does PSR stand for?") finds nothing as it is:
    // the index's keyword search needs every word to be in the passage, and
    // its meaning search scores a short question too low. So also search
    // just its key terms ("PSR"), which the keyword search does match.
    const terms = keyTerms(question);
    let byTerms = null;
    if (terms.length && terms.length <= 4 && terms.join(" ").toLowerCase() !== String(question).trim().toLowerCase()) {
      try { byTerms = await search(terms.join(" ")); } catch { /* the full question may still answer */ }
    }
    let res = null;
    for (let attempt = 0; attempt < (n(byTerms) ? 1 : 4); attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 500 * attempt));
      let next;
      try { next = await search(); } catch (e) { if (!res && attempt === 3) throw e; continue; }
      if (!res || n(next) > n(res)) res = next;
      const methods = next?.hybrid_meta?.search_methods;
      if (n(next) && (!methods || methods.includes("vector"))) break;
    }
    res ||= {};
    if (n(byTerms)) {
      // Both sets, best score first, each passage once.
      const key = res.chunks || byTerms.chunks ? "chunks" : "data";
      const seen = new Set();
      res = { ...res, [key]: [...(byTerms[key] || []), ...(res[key] || [])]
        .filter((c) => { const id = `${c.item?.key ?? c.filename}|${String(c.text ?? c.content?.[0]?.text ?? "").slice(0, 80)}`; return !seen.has(id) && seen.add(id); })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) };
    }
    // Namespace instances return { chunks: [{ text, score, item: { key } }] };
    // the older AutoRAG binding { data: [{ filename, score, content }] }.
    // R2 keys are the repo paths with "/" flattened to "_".
    const passages = res.chunks
      ? res.chunks.map((c) => ({ source: c.item?.key?.replace(/_/g, "/"), score: c.score, text: c.text }))
      : (res.data || []).map((d) => ({ source: d.filename, score: d.score, text: (d.content || []).map((c) => c.text).join("\n") }));
    return json({
      // Whole chunks (about 500 tokens each): a cut-off chunk loses the answer
      // whenever it sits in the second half.
      passages: passages.slice(0, MAX_PASSAGES).map((p) => ({ ...p, score: Math.round((p.score ?? 0) * 100) / 100, text: String(p.text || "").slice(0, MAX_PASSAGE_CHARS) })),
    });
  } catch (e) {
    return json({ error: `Search failed: ${e.message}` }, 502);
  }
}
