// Read a site's terrain heights file (data/terrain/<id>.bin), as written by
// encode_heights in scripts/precompute_terrain.py: the magic "LNT1"; the
// number of heights, spokes per ring and rings; each ring's rounding step;
// then the heights in whole steps (on a ring, each minus the one before it;
// a ring's first one and the site point whole), zigzag-coded and split into
// four byte planes.
//
// Files from before that encoding are plain float32 heights. Both are
// accepted, so a copy cached from an older deploy still reads correctly.

const MAGIC = 0x31544e4c;   // "LNT1" read as a little-endian uint32

// Heights (m above the 1737.4 km sphere) as a Float32Array: the site point,
// then ring by ring. Null if the file is neither format.
export function decodeTerrainHeights(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16 || view.getUint32(0, true) !== MAGIC) {
    return buffer.byteLength % 4 === 0 ? new Float32Array(buffer) : null;
  }
  const n = view.getUint32(4, true);
  const nAz = view.getUint32(8, true);
  const nRings = view.getUint32(12, true);
  const head = 16 + nRings * 4;
  if (!nAz || n !== 1 + nRings * nAz || buffer.byteLength !== head + n * 4) return null;
  const steps = new Float32Array(buffer, 16, nRings);
  const b = new Uint8Array(buffer, head);
  const h = new Float32Array(n);
  let q = 0;
  for (let k = 0; k < n; k++) {
    const z = b[k] | (b[n + k] << 8) | (b[2 * n + k] << 16) | (b[3 * n + k] << 24);
    const v = (z >>> 1) ^ -(z & 1);           // undo the zigzag
    const ring = k === 0 ? 0 : ((k - 1) / nAz) | 0;
    q = k === 0 || (k - 1) % nAz === 0 ? v : q + v;
    h[k] = q * steps[ring];
  }
  return h;
}
