// Slow API requests as background jobs, on a Cloudflare Queue.
//
// The panel search scores a skyline for every 20 m spot in the ring around
// the lander, which takes tens of seconds to minutes on one container (more
// for a wider ring), too long to hold a browser request open. So the page
// asks GET /api/jobs/panel-site?<the /api/panel-site query> instead:
//
//   200  the finished answer (the same body /api/panel-site gives)
//   202  {id, state, parts, done}: queued or running; ask again in a few seconds
//   4xx  the search can't run there (e.g. no terrain); 502 if it kept failing
//
// The first ask queues one message. The consumer (queue() in index.js)
// splits the ring into PARTS slices and runs them side by side, one per
// container instance (jobs-0 … jobs-7), so the search takes about an
// eighth of the time. Each finished slice is saved to R2, so a retry only
// redoes the slices that failed. When all are in, the container joins them
// (POST /api/panel-site/merge) and the answer is saved; every later ask,
// from anyone, reads it straight from R2.
//
// R2 layout (JOBS bucket):  jobs/<id>/status.json, part-<i>.json, result.json
// <id> hashes the API version (x-api-version, from the Pages Function's
// API_CACHE_VERSION), the kind and the query, so a backend change starts
// fresh jobs instead of reusing old answers.

export const KINDS = {
  "panel-site": {
    path: "/api/panel-site",
    params: ["lat", "lon", "start", "height_m", "min_m", "max_m"],
    required: ["lat", "lon"],
    parts: 8,
  },
};

export const MAX_ATTEMPTS = 4;       // matches max_retries = 3 in wrangler.toml
const STALE_MS = 20 * 60 * 1000;     // a job untouched this long was lost: queue it again
const RETRY_S = 30;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });

/** The query the job runs with: only the kind's own parameters, in a fixed order. */
export function canonicalQuery(kind, url) {
  const q = new URLSearchParams();
  for (const p of KINDS[kind].params) {
    const v = url.searchParams.get(p);
    if (v !== null && v !== "") q.set(p, v);
  }
  return q.toString();
}

export async function jobId(version, kind, query) {
  const bytes = new TextEncoder().encode(`${version}|${kind}|${query}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const prefix = (id) => `jobs/${id}/`;

async function readJson(bucket, key) {
  const o = await bucket.get(key);
  return o ? o.json() : null;
}

async function partsDone(env, id) {
  const listed = await env.JOBS.list({ prefix: `${prefix(id)}part-` });
  return listed.objects.length;
}

/** GET /api/jobs/<kind>: the answer if it's ready, else queue it (once) and report progress. */
export async function handleJobRequest(request, env, kind) {
  const spec = KINDS[kind];
  if (!spec) return json({ detail: `no job kind '${kind}'` }, 404);
  if (request.method !== "GET") return json({ detail: "use GET" }, 405);
  const url = new URL(request.url);
  for (const p of spec.required) {
    if (!Number.isFinite(Number(url.searchParams.get(p) ?? NaN))) return json({ detail: `${p} must be a number` }, 422);
  }
  const query = canonicalQuery(kind, url);
  const version = request.headers.get("x-api-version") || "v1";
  const id = await jobId(version, kind, query);

  const result = await env.JOBS.get(`${prefix(id)}result.json`);
  if (result) {
    return new Response(result.body, {
      headers: { "content-type": "application/json", "x-job-id": id, "x-job-state": "done" },
    });
  }

  const status = await readJson(env.JOBS, `${prefix(id)}status.json`);
  if (status?.state === "failed") {
    // A search that can't run (no terrain there) stays failed; one that broke
    // on our side is cleared, so the next ask tries again.
    if (!permanent(status.code)) await env.JOBS.delete(`${prefix(id)}status.json`);
    return json({ detail: status.detail, id }, status.code);
  }
  if (status && Date.now() - status.updated < STALE_MS) {
    return json({ id, state: status.state, parts: spec.parts, done: await partsDone(env, id) }, 202);
  }

  const now = Date.now();
  await env.JOBS.put(`${prefix(id)}status.json`,
    JSON.stringify({ state: "queued", kind, query, version, created: status?.created ?? now, updated: now }));
  await env.JOB_QUEUE.send({ id, kind, query });
  return json({ id, state: "queued", parts: spec.parts, done: await partsDone(env, id) }, 202);
}

// A 4xx means the search can't run there (no terrain, bad input), except
// 408 and 429: those are Cloudflare's "try again", e.g. "You are requesting
// too many containers per second" when the 8 job containers start together.
const permanent = (code) => code >= 400 && code < 500 && code !== 408 && code !== 429;
const STAGGER_MS = 300;   // between starting the parts' containers

class Permanent extends Error {
  constructor(code, detail) { super(detail); this.code = code; this.detail = detail; }
}

async function detailOf(res) {
  const text = await res.text();
  try { return JSON.parse(text).detail ?? text; } catch { return text || `HTTP ${res.status}`; }
}

/** Run one queued job to the end, or throw to have the queue retry it. */
export async function runJob({ id, kind, query }, env, callApi) {
  const spec = KINDS[kind];
  const p = prefix(id);
  if (await env.JOBS.head(`${p}result.json`)) return "done";

  const status = (await readJson(env.JOBS, `${p}status.json`)) ?? { kind, query, created: Date.now() };
  const setState = (extra) =>
    env.JOBS.put(`${p}status.json`, JSON.stringify({ ...status, ...extra, updated: Date.now() }));
  await setState({ state: "running" });

  const have = new Set((await env.JOBS.list({ prefix: `${p}part-` })).objects.map((o) => o.key));
  const missing = [...Array(spec.parts).keys()].filter((i) => !have.has(`${p}part-${i}.json`));

  // The slices, side by side: each on its own container instance.
  const runs = await Promise.allSettled(missing.map(async (i, n) => {
    if (n) await new Promise((r) => setTimeout(r, n * STAGGER_MS));
    const res = await callApi(`jobs-${i}`, `${spec.path}?${query}&part=${i}&parts=${spec.parts}`);
    if (permanent(res.status)) throw new Permanent(res.status, await detailOf(res));
    if (!res.ok) throw new Error(`part ${i}: HTTP ${res.status} ${await detailOf(res)}`);
    await env.JOBS.put(`${p}part-${i}.json`, await res.text());
  }));
  const hard = runs.find((r) => r.status === "rejected" && r.reason instanceof Permanent);
  if (hard) {
    await setState({ state: "failed", code: hard.reason.code, detail: hard.reason.detail });
    return "failed";
  }
  const failed = runs.filter((r) => r.status === "rejected");
  if (failed.length) {
    await setState({ state: "running" });   // keeps the job from looking lost between retries
    throw new Error(failed.map((r) => r.reason?.message ?? String(r.reason)).join("; "));
  }

  // Every slice is in: the container joins them into the one answer.
  const texts = await Promise.all([...Array(spec.parts).keys()].map(async (i) =>
    (await env.JOBS.get(`${p}part-${i}.json`)).text()));
  const res = await callApi("jobs-0", `${spec.path}/merge`, {
    method: "POST", headers: { "content-type": "application/json" }, body: `[${texts.join(",")}]`,
  });
  if (!res.ok) throw new Error(`merge: HTTP ${res.status} ${await detailOf(res)}`);
  await env.JOBS.put(`${p}result.json`, await res.text(), { httpMetadata: { contentType: "application/json" } });
  await env.JOBS.delete([...Array(spec.parts).keys()].map((i) => `${p}part-${i}.json`).concat(`${p}status.json`));
  return "done";
}

/** The queue consumer: one job per message (max_batch_size = 1). */
export async function consume(batch, env, callApi) {
  for (const msg of batch.messages) {
    try {
      await runJob(msg.body, env, callApi);
      msg.ack();
    } catch (e) {
      console.error(`job ${msg.body?.id} attempt ${msg.attempts}: ${e?.message ?? e}`);
      if (msg.attempts >= MAX_ATTEMPTS) {
        const key = `${prefix(msg.body.id)}status.json`;
        const status = (await readJson(env.JOBS, key)) ?? {};
        await env.JOBS.put(key, JSON.stringify({
          ...status, state: "failed", code: 502, updated: Date.now(),
          detail: "The panel search kept failing on the server. Try again in a few minutes.",
        }));
        msg.ack();
      } else {
        msg.retry({ delaySeconds: RETRY_S });
      }
    }
  }
}
