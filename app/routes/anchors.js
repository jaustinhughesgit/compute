// lib/anchors.js
const path = require('path');

// ------- config (can override via env) -------
const DEFAULT_BUCKET      = process.env.ANCHOR_S3_BUCKET || 'public.1var.com';
const DEFAULT_SET_ID      = process.env.ANCHOR_SET_ID     || 'anchors_v1';
const DEFAULT_BAND_SCALE  = Number(process.env.BAND_SCALE || 2000);
const DEFAULT_NUM_SHARDS  = Number(process.env.NUM_SHARDS || 8);

// ------- small math helpers -------
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function unit(v) {
  if (!Array.isArray(v) || !v.length) return null;
  let ss = 0; for (const x of v) { const f = +x; if (!Number.isFinite(f)) return null; ss += f*f; }
  const n = Math.sqrt(ss); if (n < 1e-12) return null;
  return v.map(x => x / n);
}
function clamp01(x){ return x < 0 ? 0 : (x > 1 ? 1 : x); }
function q16(dist){ return Math.round(clamp01(dist) * 65535); } // pack distance to 0..65535

// Simple DJB2 hash for shard
function shardOf(str, numShards = DEFAULT_NUM_SHARDS) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  if (h < 0) h = ~h + 1;
  return h % numShards;
}

// ------- S3 helpers (expects AWS.S3 instance passed in) -------
async function _getJSON(s3, Bucket, Key) {
  const { Body } = await s3.getObject({ Bucket, Key }).promise();
  return JSON.parse(Body.toString('utf8'));
}
async function _getF32(s3, Bucket, Key) {
  const { Body } = await s3.getObject({ Bucket, Key }).promise();
  const buf = Buffer.isBuffer(Body) ? Body : Buffer.from(Body);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ------- cache -------
const _cache = new Map();
/**
 * Load anchors from S3 (cached).
 * Returns:
 * {
 *   setId, bucket, d, K0, totalL1, band_scale, num_shards,
 *   L0: Float32Array (K0*d), L1: Float32Array (totalL1*d),
 *   index: { l1Index: { [k0]: { start, K1, count, sizes } }, K0, totalL1, d }
 * }
 */
async function loadAnchors({ s3, bucket = DEFAULT_BUCKET, setId = DEFAULT_SET_ID, band_scale = DEFAULT_BAND_SCALE, num_shards = DEFAULT_NUM_SHARDS } = {}) {
  const key = `${bucket}::${setId}`;
  if (_cache.has(key)) return _cache.get(key);

  // L0 meta has K0; L0 centroids are under /anchor_sets/<set>/L0/centroids.f32
  const l0MetaKey = `anchor_sets/${setId}/L0/meta.json`;
  const l0F32Key  = `anchor_sets/${setId}/L0/centroids.f32`;
  const l1IdxKey  = `anchor_sets/${setId}/L1/index.json`;
  const l1F32Key  = `anchor_sets/${setId}/L1/centroids.f32`;

  const [l0Meta, L0, index, L1] = await Promise.all([
    _getJSON(s3, bucket, l0MetaKey),
    _getF32(s3, bucket, l0F32Key),
    _getJSON(s3, bucket, l1IdxKey),
    _getF32(s3, bucket, l1F32Key)
  ]);

  const { K0, d } = l0Meta;
  if (L0.length !== K0 * d) throw new Error(`L0 size mismatch: L0=${L0.length}, K0*d=${K0*d}`);
  if (L1.length !== index.totalL1 * index.d) throw new Error(`L1 size mismatch: L1=${L1.length}, totalL1*d=${index.totalL1 * index.d}`);

  const payload = { setId, bucket, d, K0, totalL1: index.totalL1, band_scale, num_shards, L0, L1, index };
  _cache.set(key, payload);
  return payload;
}

/**
 * Assign a unit embedding to top-L0 and nearest L1 per L0.
 * Options:
 *  - topL0 (default 2)
 *  - band_scale (default from anchors)
 *  - num_shards (default from anchors)
 * Returns array of { l0, l1, band, dist, dist_q16, shard }
 */
function assign(eU, anchors, { topL0 = 2, band_scale, num_shards } = {}) {
  const { d, K0, L0, L1, index } = anchors;
  const bandScale = Number.isFinite(band_scale) ? band_scale : anchors.band_scale;
  const nshards   = Number.isFinite(num_shards) ? num_shards : anchors.num_shards;

  if (!eU || eU.length !== d) throw new Error(`Embedding dim ${eU?.length} != anchors.d ${d}`);

  // 1) rank L0 by dot (cosine sim since all unit)
  const l0Scores = new Array(K0);
  for (let k = 0; k < K0; k++) {
    l0Scores[k] = { k, score: dot(eU, L0.subarray(k*d, k*d + d)) };
  }
  l0Scores.sort((a, b) => b.score - a.score);
  const picks = l0Scores.slice(0, Math.max(1, Math.min(topL0, K0)));

  // 2) per L0, pick nearest L1
  const out = [];
  for (const { k: l0 } of picks) {
    const { start, K1 } = index.l1Index[String(l0)] || index.l1Index[l0] || {};
    if (!Number.isFinite(start) || !Number.isFinite(K1) || K1 <= 0) continue;

    let best = { l1: -1, score: -Infinity };
    for (let j = 0; j < K1; j++) {
      const cOff = (start + j) * d;
      const sc = dot(eU, L1.subarray(cOff, cOff + d));
      if (sc > best.score) best = { l1: start + j, score: sc };
    }
    if (best.l1 < 0) continue;

    const dist = 1 - best.score;                      // cosine distance
    const band = Math.floor(dist * bandScale);        // integer band
    const dist_q = q16(dist);

    out.push({ l0, l1: best.l1, band, dist, dist_q16: dist_q, shard: 0 /* set later */ });
  }
  return out;
}

/**
 * Build a posting (pk, sk, item) for anchor_bands.
 */
function makePosting({ setId, su, assign, type = 'su', shards = DEFAULT_NUM_SHARDS }) {
  const { l0, l1, band, dist_q16 } = assign;
  const shard = shardOf(su, shards);
  const pk = `AB#${setId}#L0=${l0}#L1=${l1}`;
  const sk = `B=${String(band).padStart(5,'0')}#S=${String(shard).padStart(2,'0')}#T=${type}#SU=${su}`;
  return {
    pk, sk,
    su, type,
    l0, l1, band, dist_q16
  };
}

module.exports = {
  loadAnchors,
  assign,
  unit,
  makePosting,
  shardOf,
  DEFAULT_BUCKET,
  DEFAULT_SET_ID,
  DEFAULT_BAND_SCALE,
  DEFAULT_NUM_SHARDS
};
