// Browser stand-ins so the chat's own code (frontend/src/chat/) runs in Node:
// relative fetches go to the dev servers, .css imports are empty, and
// show_in_app's event goes nowhere. Import this before any app module.
//
// SITE: where /api/chat is served (Vite, which proxies it to
//       `npx wrangler pages dev`). Static data is read from frontend/public.
// DOCS: where /api/docs-search is answered. Default "local": this repo's own
//       functions/api/docs-search.js, with the index queried through
//       `wrangler ai-search search` (needs a wrangler login), so search
//       changes can be tested before they are deployed. Or a site's URL.
import { register } from "node:module";
import { readFile } from "node:fs/promises";

export const SITE = process.env.SITE || "http://localhost:5173";
export const DOCS = process.env.DOCS || "local";

register("data:text/javascript," + encodeURIComponent(
  `export async function load(url, ctx, next) {
     if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
     return next(url, ctx);
   }`));

const realFetch = globalThis.fetch;

// The Pages Function, run here against the real index.
async function localDocsSearch(opts) {
  const { execFile } = await import("node:child_process");
  const { onRequestPost } = await import("../../frontend/functions/api/docs-search.js");
  const index = {
    search: ({ query, max_num_results }) => new Promise((resolve, reject) => {
      execFile("npx", ["wrangler", "ai-search", "search", "lunar-lander", "-n", "lunar-navigator-search", "--json",
        "--query", query, "--max-num-results", String(max_num_results)],
        { cwd: new URL("../../frontend/", import.meta.url), maxBuffer: 1 << 24 },
        (err, stdout) => { try { if (err) throw err; resolve(JSON.parse(stdout.slice(stdout.indexOf("{")))); } catch (e) { reject(e); } });
    }),
  };
  return onRequestPost({ request: new Request("http://local/api/docs-search", opts), env: { DOCS: { get: () => index }, AI_SEARCH_NAME: "lunar-lander" } });
}
export const shown = [];   // show_in_app events, for the tests to read
globalThis.fetch = (url, opts) => {
  if (typeof url === "string" && url.startsWith("/")) {
    if (url.startsWith("/api/docs-search") && DOCS === "local") return localDocsSearch(opts);
    // The app's static data, straight from the repo (no server needed).
    if (url.startsWith("/data/")) {
      return readFile(new URL(`../../frontend/public${url}`, import.meta.url))
        .then((buf) => new Response(buf), () => new Response("not found", { status: 404 }));
    }
    url = (url.startsWith("/api/docs-search") ? DOCS : SITE) + url;
  }
  return realFetch(url, opts);
};
globalThis.window = {
  dispatchEvent: (e) => { shown.push(e.detail); return true; },
  addEventListener() {},
};
