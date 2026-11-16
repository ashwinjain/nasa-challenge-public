// The panel-search job queue (src/jobs.js) against fake R2, queue and API.
// Run: node --test test/   (from api-worker/; no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { consume, handleJobRequest, KINDS, MAX_ATTEMPTS } from "../src/jobs.js";

const PARTS = KINDS["panel-site"].parts;

function fakeBucket() {
  const m = new Map();
  const obj = (k) => ({ key: k, body: m.get(k), text: async () => m.get(k), json: async () => JSON.parse(m.get(k)) });
  return {
    m,
    get: async (k) => (m.has(k) ? obj(k) : null),
    head: async (k) => (m.has(k) ? { key: k } : null),
    put: async (k, v) => { m.set(k, typeof v === "string" ? v : String(v)); },
    delete: async (ks) => { for (const k of [].concat(ks)) m.delete(k); },
    list: async ({ prefix }) => ({ objects: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  };
}

function fakeEnv() {
  const sent = [];
  return { JOBS: fakeBucket(), JOB_QUEUE: { send: async (b) => { sent.push(b); } }, sent };
}

// A fake API: each part answers its slice; merge concatenates them.
function fakeApi({ failPart = null, status = 503 } = {}) {
  const calls = [];
  const api = async (name, path, init = {}) => {
    calls.push({ name, path });
    const u = new URL(path, "http://x");
    if (u.pathname.endsWith("/merge")) {
      const parts = JSON.parse(init.body);
      return Response.json({ merged: parts.map((p) => p.part).sort() });
    }
    const part = Number(u.searchParams.get("part"));
    if (part === failPart) return Response.json({ detail: "nope" }, { status });
    return Response.json({ part, lat: u.searchParams.get("lat") });
  };
  api.calls = calls;
  return api;
}

const ask = (env, q = "lat=-86&lon=2&start=2026-01-01", version = "v9") =>
  handleJobRequest(new Request(`http://w/api/jobs/panel-site?${q}`, { headers: { "x-api-version": version } }), env, "panel-site");

function message(body, attempts = 1) {
  const m = { body, attempts, acked: false, retried: null };
  m.ack = () => { m.acked = true; };
  m.retry = (o) => { m.retried = o; };
  return m;
}

test("first ask queues one job; asking again doesn't queue it twice", async () => {
  const env = fakeEnv();
  const a = await ask(env);
  assert.equal(a.status, 202);
  const body = await a.json();
  assert.equal(body.state, "queued");
  assert.equal(body.parts, PARTS);
  const b = await ask(env);
  assert.equal(b.status, 202);
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].id, body.id);
  assert.equal(b.headers.get("cache-control"), "no-store");
});

test("the job id ignores parameter order and unknown parameters, but not the version", async () => {
  const env = fakeEnv();
  const id1 = (await (await ask(env, "lon=2&lat=-86&junk=1")).json()).id;
  const id2 = (await (await ask(env, "lat=-86&lon=2")).json()).id;
  const id3 = (await (await ask(env, "lat=-86&lon=2", "v10")).json()).id;
  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
});

test("bad coordinates are refused without queueing", async () => {
  const env = fakeEnv();
  assert.equal((await ask(env, "lat=abc&lon=2")).status, 422);
  assert.equal((await handleJobRequest(new Request("http://w/api/jobs/nope?lat=1&lon=1"), env, "nope")).status, 404);
  assert.equal(env.sent.length, 0);
});

test("the consumer runs every part on its own instance, merges, and then the answer is served", async () => {
  const env = fakeEnv();
  await ask(env);
  const api = fakeApi();
  const msg = message(env.sent[0]);
  await consume({ messages: [msg] }, env, api);
  assert.ok(msg.acked);
  const names = api.calls.filter((c) => !c.path.endsWith("/merge")).map((c) => c.name).sort();
  assert.deepEqual(names, [...Array(PARTS).keys()].map((i) => `jobs-${i}`).sort());
  assert.ok(api.calls.every((c) => c.path.endsWith("/merge") || c.path.includes(`parts=${PARTS}`)));

  const done = await ask(env);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { merged: [...Array(PARTS).keys()] });
  // Only the answer is left in R2.
  assert.deepEqual([...env.JOBS.m.keys()].filter((k) => !k.endsWith("result.json")), []);
  assert.equal(env.sent.length, 1);
});

test("a failed part is retried, and the retry only reruns that part", async () => {
  const env = fakeEnv();
  await ask(env);
  const msg = message(env.sent[0]);
  await consume({ messages: [msg] }, env, fakeApi({ failPart: 3 }));
  assert.ok(!msg.acked);
  assert.ok(msg.retried);

  const mid = await (await ask(env)).json();
  assert.equal(mid.state, "running");
  assert.equal(mid.done, PARTS - 1);

  const api = fakeApi();
  const again = message(env.sent[0], 2);
  await consume({ messages: [again] }, env, api);
  assert.ok(again.acked);
  assert.deepEqual(api.calls.map((c) => c.name), ["jobs-3", "jobs-0"]);   // part 3, then the merge
  assert.equal((await ask(env)).status, 200);
});

test("a 4xx from the API (no terrain there) fails the job for good", async () => {
  const env = fakeEnv();
  await ask(env);
  const msg = message(env.sent[0]);
  await consume({ messages: [msg] }, env, fakeApi({ failPart: 0, status: 404 }));
  assert.ok(msg.acked);
  const r = await ask(env);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).detail, "nope");
  assert.equal((await ask(env)).status, 404);   // still failed: not queued again
  assert.equal(env.sent.length, 1);
});

test("after the last attempt the job reports 502 once, then a new ask queues it again", async () => {
  const env = fakeEnv();
  await ask(env);
  const msg = message(env.sent[0], MAX_ATTEMPTS);
  await consume({ messages: [msg] }, env, fakeApi({ failPart: 1 }));
  assert.ok(msg.acked);
  assert.equal((await ask(env)).status, 502);
  assert.equal((await ask(env)).status, 202);
  assert.equal(env.sent.length, 2);
});

test("a job left untouched for 20 minutes is queued again", async () => {
  const env = fakeEnv();
  const { id } = await (await ask(env)).json();
  const key = `jobs/${id}/status.json`;
  const st = JSON.parse(env.JOBS.m.get(key));
  env.JOBS.m.set(key, JSON.stringify({ ...st, updated: Date.now() - 21 * 60 * 1000 }));
  await ask(env);
  assert.equal(env.sent.length, 2);
});

test("429 (too many containers starting at once) is retried, not a failed job", async () => {
  const env = fakeEnv();
  await ask(env);
  const msg = message(env.sent[0]);
  await consume({ messages: [msg] }, env, fakeApi({ failPart: 5, status: 429 }));
  assert.ok(!msg.acked && msg.retried);
  assert.equal((await ask(env)).status, 202);
  const again = message(env.sent[0], 2);
  await consume({ messages: [again] }, env, fakeApi());
  assert.equal((await ask(env)).status, 200);
});

test("a job stored as failed with a 429 is queued again on the next ask", async () => {
  const env = fakeEnv();
  const { id } = await (await ask(env)).json();
  env.JOBS.m.set(`jobs/${id}/status.json`, JSON.stringify({ state: "failed", code: 429, detail: "busy", updated: Date.now() }));
  assert.equal((await ask(env)).status, 429);
  assert.equal((await ask(env)).status, 202);
  assert.equal(env.sent.length, 2);
});
