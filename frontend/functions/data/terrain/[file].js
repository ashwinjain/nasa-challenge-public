// /data/terrain/<file> (Cloudflare Pages Function). Landing-target files
// (land-*, 90 targets) live in R2, not in the static upload: every mesh
// (.bin), and the imagery (_albedo.bin, _wac.jpg) of targets #2-#10
// (land-<code>-<rank>). Everything else in /data/terrain/ is a normal static
// file, including the imagery of each region's #1 target (land-<code>_*).
// Bucket: lunar-navigator-terrain, keys terrain/<file>. Upload with
// scripts/upload_terrain_r2.sh after `precompute_landing.py` rebuilds them.
//
// Each file is also kept in Cloudflare's edge cache, so only the first
// visitor through a data centre waits on R2 (~2 s); after that it's served
// like a static file. Browsers keep it for a day. A rebuilt file with the
// same name shows up once the edge copy expires (7 days), or purge the cache.

const EDGE_TTL_S = 7 * 86400;

export async function onRequestGet({ request, params, env, next, waitUntil }) {
  const file = String(params.file);
  if (!/^land-[a-z0-9]+(\.bin|-\d+(\.bin|_albedo\.bin|_wac\.jpg))$/.test(file) || !env.TERRAIN) return next();

  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + `/data/terrain/${file}`);
  const hit = await cache.match(key);
  if (hit) {
    const out = new Response(hit.body, hit);
    out.headers.set("cache-control", "public, max-age=86400");   // browsers: a day, as on a miss
    return out;
  }

  const obj = await env.TERRAIN.get(`terrain/${file}`);
  if (!obj) return new Response("Not found", { status: 404 });
  const res = new Response(obj.body, {
    headers: {
      "content-type": file.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream",
      "cache-control": "public, max-age=86400",
      "cdn-cache-control": `public, max-age=${EDGE_TTL_S}`,
      etag: obj.httpEtag,
    },
  });
  // Store a copy at the edge without holding up this response.
  const copy = new Response(res.clone().body, res);
  copy.headers.set("cache-control", `public, max-age=${EDGE_TTL_S}`);
  waitUntil(cache.put(key, copy));
  return res;
}
