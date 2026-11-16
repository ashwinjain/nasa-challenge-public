// Starts the Python API container and forwards /api/* to it.
//
// The container reads the 20 m LOLA map from R2 at http://maps.internal/<name>:
// that host never leaves Cloudflare, it's answered here by outboundByHost
// (range reads straight from the MAPS bucket). A request from the container
// back to this Worker's public workers.dev URL doesn't get through.
// /_maps/* (reads) and /_maps-upload/* (multipart uploads, see
// scripts/upload_map_r2.py) stay on the public URL behind MAPS_KEY.
//
// /api/jobs/<kind> (the panel search) runs as a background job on the
// JOB_QUEUE queue, split across several container instances: see jobs.js.
import { Container, ContainerProxy, getContainer } from "@cloudflare/containers";
import { consume, handleJobRequest } from "./jobs.js";

export { ContainerProxy };

export class ApiContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30m";            // stay warm while people use the page
  envVars = { LUNAR_DATA_BASE_URL: "http://maps.internal" };
}

// Assigned, not a `static outboundByHost = ...` field: in plain JS a static
// field defines its own property and skips Container's setter, so the proxy
// never finds the handler and the request leaves for the internet (530).
ApiContainer.outboundByHost = {
  "maps.internal": (request, env) =>
    serveMap(request, env, decodeURIComponent(new URL(request.url).pathname.slice(1))),
};

const authed = (request, env) => env.MAPS_KEY && request.headers.get("x-maps-key") === env.MAPS_KEY;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/_maps")) {
      if (!authed(request, env)) return new Response("Forbidden", { status: 403 });
      const key = decodeURIComponent(url.pathname.replace(/^\/_maps(-upload)?\//, ""));
      if (url.pathname.startsWith("/_maps-upload/")) return upload(request, env, key, url);
      return serveMap(request, env, key);
    }

    const job = url.pathname.match(/^\/api\/jobs\/([a-z-]+)$/);
    if (job) return handleJobRequest(request, env, job[1]);

    if (url.pathname.startsWith("/api/")) {
      if (env.API_ORIGIN) return fetch(new Request(new URL(url.pathname + url.search, env.API_ORIGIN), request));
      return getContainer(env.API_CONTAINER).fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },

  async queue(batch, env) {
    await consume(batch, env, (name, path, init) => callApi(env, name, path, init));
  },
};

// The API, from a job: a named container instance (each name is its own
// container, so the slices of one search run side by side), or API_ORIGIN
// when it's set (local runs: `wrangler dev` against `make dev-backend`).
function callApi(env, name, path, init = {}) {
  if (env.API_ORIGIN) return fetch(new URL(path, env.API_ORIGIN), init);
  return getContainer(env.API_CONTAINER, name).fetch(new Request(`http://container${path}`, init));
}

// A map object from R2, with HEAD and Range support (what GDAL's /vsicurl/ needs).
async function serveMap(request, env, key) {
  if (request.method === "HEAD") {
    const o = await env.MAPS.head(key);
    return o ? new Response(null, { headers: { "content-length": String(o.size), "accept-ranges": "bytes", etag: o.httpEtag } }) : new Response("Not found", { status: 404 });
  }
  const o = await env.MAPS.get(key, { range: request.headers });
  if (!o) return new Response("Not found", { status: 404 });
  const headers = new Headers({ "accept-ranges": "bytes", etag: o.httpEtag, "content-type": "application/octet-stream" });
  let status = 200;
  if (o.range) {
    const { offset = 0, length = o.size - offset } = o.range;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${o.size}`);
    headers.set("content-length", String(length));
    status = 206;
  } else headers.set("content-length", String(o.size));
  return new Response(o.body, { status, headers });
}

// POST create, PUT ?upload=<id>&part=<n>, POST ?upload=<id>&complete (JSON body: parts)
async function upload(request, env, key, url) {
  const id = url.searchParams.get("upload");
  if (!id) {
    const mp = await env.MAPS.createMultipartUpload(key);
    return Response.json({ uploadId: mp.uploadId });
  }
  const mp = env.MAPS.resumeMultipartUpload(key, id);
  if (url.searchParams.has("complete")) {
    const obj = await mp.complete(await request.json());
    return Response.json({ key: obj.key, size: obj.size });
  }
  const part = await mp.uploadPart(Number(url.searchParams.get("part")), request.body);
  return Response.json(part);
}
