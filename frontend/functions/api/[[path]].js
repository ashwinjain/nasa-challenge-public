// /api/* catch-all (Cloudflare Pages Function). /api/chat and
// /api/docs-search have their own files and win over this one.
//
// Everything else (/api/sky, /api/skyline, /api/jobs/panel-site, /api/power) is
// the live Python backend, needed only for custom coordinates or data that
// isn't precomputed. It runs in a Cloudflare Container (api-worker/), reached
// through the API service binding; API_ORIGIN (any URL) is the fallback.
// Without either, the page gets a clear JSON answer instead of index.html,
// which the single-page fallback would serve.

// Successful GET answers are kept in Cloudflare's edge cache: the same point
// and dates always give the same answer, and a repeat then skips the
// Container entirely. The key carries API_CACHE_VERSION (a Pages variable):
// change it after a backend change (new maps, a new power model) and old
// answers are no longer used. They expire on their own after a day.
// Only 200s are kept: /api/jobs/* answers 202 while a job is still running.
//
// The version also goes to the API Worker (x-api-version), which keys its
// queued jobs on it (api-worker/src/jobs.js), so one change resets both.
const API_TTL_S = 86400;

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  if (!env.API && !env.API_ORIGIN) return notConnected();

  const cacheable = request.method === "GET";
  const key = new Request(`${url.origin}/__api-cache/${env.API_CACHE_VERSION || "v1"}${url.pathname}${url.search}`);
  if (cacheable) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }

  const fwd = new Request(request);
  fwd.headers.set("x-api-version", env.API_CACHE_VERSION || "v1");
  const res = env.API
    ? await env.API.fetch(fwd)
    : await fetch(new Request(new URL(url.pathname + url.search, env.API_ORIGIN), fwd));

  if (cacheable && res.status === 200) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set("cache-control", `public, max-age=${API_TTL_S}`);
    waitUntil(caches.default.put(key, copy));
  }
  return res;
}

function notConnected() {
  return new Response(
    JSON.stringify({ detail: "Custom points need the live backend, which isn't connected to this deployment. The 9 Artemis regions all work without it." }),
    // 404, not 5xx: the page shows `detail` only for a client-side error.
    { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
