// modules/search.js
"use strict";

function register({ on, use }) {
  const {
    getDocClient,
    getCookie,            // reuse cookie -> user-id logic
    deps,                 // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // Keep knobs in lockstep with the positioner
  const anchorsUtil         = require("../anchors");
  const ANCHOR_BANDS_TABLE  = process.env.ANCHOR_BANDS_TABLE || "anchor_bands";
  const DEFAULT_SET_ID      = process.env.ANCHOR_SET_ID       || "anchors_v1";
  const EMB_MODEL_ID        = process.env.EMB_MODEL           || "text-embedding-3-large";
  const DEFAULT_BAND_SCALE  = Number(process.env.BAND_SCALE   || 2000);
  const DEFAULT_NUM_SHARDS  = Number(process.env.NUM_SHARDS   || 8);
  const PERM_GRANTS_TABLE   = process.env.PERM_GRANTS_TABLE   || "perm_grants"; // <— new

  const doc    = getDocClient();
  const s3     = deps.s3;
  const openai = deps.openai;

  // ---------- helpers ----------
  const isNum   = (x) => typeof x === "number" && Number.isFinite(x);
  const pad2    = (n) => String(n).padStart(2, "0");
  const padBand = (b) => String(b).padStart(5, "0");

  const asUnit = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    let ss = 0;
    for (const v of arr) { const f = +v; if (!Number.isFinite(f)) return null; ss += f*f; }
    const n = Math.sqrt(ss);
    if (n < 1e-12) return null;
    return arr.map(v => +v / n);
  };

  const parseSuFromSk = (sk) => {
    // expected like: "B=01348#S=03#SU=1v4r....."
    if (typeof sk !== "string") return null;
    const m = /(?:^|#)SU=([^#]+)/.exec(sk);
    return m ? m[1] : null;
  };
  const parseBandFromSk = (sk) => {
    const m = /(?:^|#)B=(\d{1,6})/.exec(sk);
    return m ? Number(m[1]) : null;
  };

  async function getUserIdFromReq(req, body) {
    // precedence: explicit body.e → cookie token → default 0
    if (body && Number.isFinite(Number(body.e))) return Number(body.e);

    try {
      const hdrs = req?.body?.headers || req?.headers || {};
      const tok = hdrs["X-accessToken"] || hdrs["x-accesstoken"] || hdrs["x-access-token"];
      if (tok) {
        const cookie = await getCookie(tok, "ak");
        const maybeE = cookie?.Items?.[0]?.e;
        if (Number.isFinite(Number(maybeE))) return Number(maybeE);
      }
    } catch {/* ignore */}
    return 0;
  }

  async function ensureQueryEmbedding({ embedding, text }) {
    if (Array.isArray(embedding) && embedding.every(isNum)) {
      const u = asUnit(embedding);
      if (u) return u;
    }
    if (typeof text === "string" && text.trim()) {
      const q = text.trim();
      const { data: [{ embedding: e }] } = await openai.embeddings.create({
        model: EMB_MODEL_ID,
        input: q
      });
      const u = asUnit(e);
      if (u) return u;
    }
    throw new Error("embedding (number[]) or text is required for search");
  }

  async function anchorAssignments(eU, { setId, bandScale, topL0, numShards }) {
    const anchors = await anchorsUtil.loadAnchors({ s3, setId, band_scale: bandScale, num_shards: numShards });
    if (anchors.d !== eU.length) {
      throw new Error(`Query embedding dim ${eU.length} != anchors.d ${anchors.d}`);
    }
    return anchorsUtil.assign(eU, anchors, { topL0, band_scale: bandScale, num_shards: numShards });
  }

  async function queryOneWindow({ pk, bandCenter, delta, numShards, limitPerAssign = 500 }) {
    const bLo = Math.max(0, bandCenter - delta);
    const bHi = bandCenter + delta;

    const skLo = `B=${padBand(bLo)}#S=00`;
    const skHi = `B=${padBand(bHi)}#S=${pad2(numShards - 1)}`;

    const { Items } = await doc.query({
      TableName: ANCHOR_BANDS_TABLE,
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :lo AND :hi",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": pk, ":lo": skLo, ":hi": skHi },
      Limit: Number(limitPerAssign || 500)
    }).promise();

    return Items || [];
  }

  async function batchGetSubdomains(keys /* [{su}] */) {
    if (!keys.length) return new Map();
    const out = new Map();
    const TableName = "subdomains";

    let i = 0;
    while (i < keys.length) {
      const chunk = keys.slice(i, i + 100); // BatchGet limit
      const rsp = await doc.batchGet({ RequestItems: { [TableName]: { Keys: chunk } } }).promise();
      const rows = rsp.Responses?.[TableName] || [];
      for (const r of rows) out.set(String(r.su), r);
      i += 100;
    }
    return out;
  }

  // --------- permissions helpers ----------
  async function getEffectivePrincipals(e) {
    // Expand here later with team/household groups, e.g. t:<id>, h:<id>, etc.
    const set = new Set();
    set.add("pub");           // conceptual, for policy_id === "pub"
    if (e && String(e) !== "0") set.add(`u:${e}`);
    return Array.from(set);
  }
  function bestPermChar(perms) {
    if (!perms || typeof perms !== "string") return null;
    if (perms.includes("o")) return "o";
    if (perms.includes("w")) return "w";
    if (perms.includes("r")) return "r";
    return null;
  }
  function ownershipWeight(permChar) {
    if (permChar === "o") return 0.50;
    if (permChar === "w") return 0.25;
    if (permChar === "r") return 0.05;
    return 0.0;
  }

  on("search", async (ctx) => {
    const { req, res } = ctx;

    // Accept both flattened req.body and legacy { body: {...} }
    const rawBody = (req && req.body) || {};
    const body = rawBody && typeof rawBody === "object" && rawBody.body && typeof rawBody.body === "object"
      ? rawBody.body
      : rawBody;

    let searchString = body.text;
    if (!searchString) searchString = body.query;

    try {
      // ---- inputs / defaults
      const setId          = body.setId || DEFAULT_SET_ID;
      const bandScale      = Number.isFinite(+body.band_scale) ? +body.band_scale : DEFAULT_BAND_SCALE;
      const numShards      = Number.isFinite(+body.num_shards) ? +body.num_shards : DEFAULT_NUM_SHARDS;
      const topL0          = Number.isFinite(+body.topL0) ? Math.max(1, +body.topL0) : 3;
      const bandWindow     = Number.isFinite(+body.bandWindow) ? +body.bandWindow : 96; // conservative
      const limitPerAssign = Number.isFinite(+body.limitPerAssign) ? +body.limitPerAssign : 500;
      const topK           = Number.isFinite(+body.topK) ? +body.topK : 50;

      const e   = await getUserIdFromReq(req, body);
      const eU  = await ensureQueryEmbedding({ embedding: body.embedding, text: searchString });

      // ---- compute query assignments (L0/L1 + band)
      const assigns = await anchorAssignments(eU, { setId, bandScale, topL0, numShards });

      // ---- query: prefer tenant PK, fallback to global
      const makePkTenant = (a) => `AB#${setId}#U=${e}#L0=${a.l0}#L1=${a.l1}`;
      const makePkGlobal = (a) => `AB#${setId}#L0=${a.l0}#L1=${a.l1}`;

      let anyTenantHit = false;
      const perAssignResults = [];

      for (const a of assigns) {
        // 1) tenant
        let rows = [];
        try {
          rows = await queryOneWindow({
            pk: makePkTenant(a),
            bandCenter: a.band,
            delta: bandWindow,
            numShards,
            limitPerAssign
          });
        } catch {/* ignore */}
        if (rows && rows.length) {
          anyTenantHit = true;
          perAssignResults.push({ a, rows, pkType: "tenant" });
          continue;
        }

        // 2) global
        let rows2 = [];
        try {
          rows2 = await queryOneWindow({
            pk: makePkGlobal(a),
            bandCenter: a.band,
            delta: bandWindow,
            numShards,
            limitPerAssign
          });
        } catch {/* ignore */}
        perAssignResults.push({ a, rows: rows2 || [], pkType: "global" });
      }

      // ---- merge, dedupe by su (min bandDelta), carry policy_id if present
      const bySu = new Map();
      for (const { a, rows, pkType } of perAssignResults) {
        for (const r of rows) {
          const su = r?.su || parseSuFromSk(r?.sk);
          const itemBand = isNum(r?.band) ? r.band : parseBandFromSk(r?.sk);
          if (!su || !isNum(itemBand)) continue;

          const bandDelta = Math.abs(itemBand - a.band);
          const prev = bySu.get(su);
          if (!prev || bandDelta < prev.bandDelta) {
            bySu.set(su, {
              su,
              l0: a.l0,
              l1: a.l1,
              queryBand: a.band,
              itemBand,
              bandDelta,
              pkType,
              pk: r.pk,
              sk: r.sk,
              policy_id: (typeof r?.policy_id === "string" && r.policy_id) ? r.policy_id : `entity:${su}`
            });
          }
        }
      }

      let candidates = Array.from(bySu.values()).sort((x, y) => x.bandDelta - y.bandDelta);
      if (candidates.length > topK) candidates = candidates.slice(0, topK);

      // ---- join subdomains (best-effort)
      let subMap = new Map();
      if (candidates.length) {
        const keys = candidates.map(c => ({ su: String(c.su) }));
        subMap = await batchGetSubdomains(keys);
      }

      // ---- PERMISSION ENFORCEMENT
      // Build effective principals for the caller
      const principals = await getEffectivePrincipals(e);
      const nowSec = Math.floor(Date.now() / 1000);

      // Map entityID -> su (policy "entity:<su>" points to the su)
      const entityToSu = {};
      const permKeys = [];

      for (const c of candidates) {
        const pol = c.policy_id || `entity:${c.su}`;
        if (pol === "pub") continue; // globally readable

        // For now we only expect entity:<su>
        let entityID = null;
        if (pol.startsWith("entity:")) {
          entityID = pol.slice("entity:".length);
        } else if (pol.startsWith("edge:")) {
          // If you later store edge policies, resolve to an entity id here
          entityID = pol.slice("edge:".length);
        } else {
          entityID = String(c.su);
        }
        entityToSu[entityID] = c.su;

        for (const p of principals) {
          // perm_grants PK=(entityID), SK=(principalID)
          permKeys.push({ entityID: String(entityID), principalID: p });
        }
      }

      // Batch-get grants
      const bestBySu = new Map(); // su -> 'o'|'w'|'r'|null (best seen)
      for (let i = 0; i < permKeys.length; i += 100) {
        const chunk = permKeys.slice(i, i + 100);
        if (!chunk.length) break;
        const rsp = await doc.batchGet({
          RequestItems: { [PERM_GRANTS_TABLE]: { Keys: chunk } }
        }).promise();
        const rows = (rsp.Responses && rsp.Responses[PERM_GRANTS_TABLE]) || [];
        for (const row of rows) {
          if (!row) continue;
          if (Number.isFinite(row.expires) && row.expires < nowSec) continue;
          const ch = bestPermChar(row.perms);
          if (!ch) continue;
          const su = entityToSu[row.entityID] || row.entityID;
          const prev = bestBySu.get(su);
          const ord = { r: 1, w: 2, o: 3 };
          if (!prev || ord[ch] > ord[prev]) bestBySu.set(su, ch);
        }
      }

      // Filter: allow if policy is "pub" OR caller has at least 'r'
      candidates = candidates.filter(c => {
        const pol = c.policy_id || `entity:${c.su}`;
        if (pol === "pub") return true;
        const ch = bestBySu.get(String(c.su));
        return ch === "r" || ch === "w" || ch === "o";
      });

      // ---- shape output (score + ownership boost)
      const enriched = candidates.map(c => {
        const row = subMap.get(String(c.su));
        const permChar = (c.policy_id === "pub") ? "r" : (bestBySu.get(String(c.su)) || null);
        const oWeight  = ownershipWeight(permChar);
        return {
          su: c.su,
          score: (1 / (1 + c.bandDelta)) + oWeight,
          bandDelta: c.bandDelta,
          l0: c.l0,
          l1: c.l1,
          queryBand: c.queryBand,
          itemBand: c.itemBand,
          domain: row?.domain || null,
          subdomain: row?.subdomain || null,
          output: row?.output || null,
          path: row?.path || null,
          e: row?.e ?? null,
          policy_id: c.policy_id || null,
          perm: permChar || null,
          ownership_weight: oWeight
        };
      });

      return {
        ok: true,
        response: {
          action: "search",
          setId,
          usedTenantPK: anyTenantHit,
          params: {
            bandScale, topL0, bandWindow, numShards, topK
          },
          query: {
            text: searchString ?? null,
            hasEmbedding: Array.isArray(body.embedding),
            e
          },
          results: enriched
        }
      };
    } catch (err) {
      console.error("search (anchors) error:", err);
      // legacy error shape
      if (res && res.status && res.json) {
        res.status(400).json({ error: err?.message || "bad-request" });
        return { __handled: true };
      }
      return { ok: false, error: err?.message || "bad-request" };
    }
  });

  return { name: "search" };
}

module.exports = { register };
