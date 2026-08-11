/**
 * Platform: Finds reusable authorized entities through bounded anchor candidates rather than scanning or loading every graph.
 * Technical: `search` embeds text, unions sharded-v2 and legacy candidates, reloads canonical rows, authorizes them, then ranks results.
 */
"use strict";

function canEditPermission(permission) {
  const value = String(permission || "").toLowerCase();
  return value === "o" || value === "w";
}

function entityRevisionFromRow(row) {
  if (!row || typeof row !== "object") return { entityVersion: null, entityUpdatedAt: null };
  // Edit revisions are independent from capability-manifest versions and the
  // entity graph's internal version fields. Existing entities begin at edit v0.
  const rawVersion = row.editVersion ?? 0;
  const numberVersion = Number(rawVersion);
  return {
    entityVersion: Number.isFinite(numberVersion) ? numberVersion : null,
    entityUpdatedAt: row.editUpdatedAt || null,
  };
}

function register({ on, use }) {
  const {
    getCanonicalPersistence,
    getCookie,            // reuse cookie -> user-id logic
    deps,                 // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // Keep knobs in lockstep with the positioner
  const anchorsUtil         = require("../anchors");
  const DEFAULT_SET_ID      = process.env.ANCHOR_SET_ID       || "anchors_v1";
  const EMB_MODEL_ID        = process.env.EMB_MODEL           || "text-embedding-3-large";
  const DEFAULT_BAND_SCALE  = Number(process.env.BAND_SCALE   || 2000);
  const DEFAULT_NUM_SHARDS  = Number(process.env.NUM_SHARDS   || 8);
  const persistence = getCanonicalPersistence();
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

  async function getUserIdFromReq(req, meta) {
    const authenticated = Number(meta?.cookie?.e);
    if (Number.isFinite(authenticated) && authenticated > 0) return authenticated;
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
      const q = text.toLowerCase().trim();
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

  async function queryOneWindow({ pk, bandCenter, delta, legacy = false, limitPerAssign = 500 }) {
    const bLo = Math.max(0, bandCenter - delta);
    const bHi = bandCenter + delta;
    const skLo = legacy ? `B=${padBand(bLo)}#S=00` : `B=${padBand(bLo)}`;
    const skHi = legacy ? `B=${padBand(bHi)}#S=99#\uffff` : `B=${padBand(bHi)}#\uffff`;
    const maximum = Math.max(1, Math.min(1000, Number(limitPerAssign) || 500));
    const items = [];
    let cursor;
    do {
      const page = await persistence.retrieval.queryWindow({
        partitionKey: pk,
        startKey: skLo,
        endKey: skHi,
        limit: maximum - items.length,
        cursor,
      });
      items.push(...(page?.Items || []));
      cursor = page?.LastEvaluatedKey;
    } while (cursor && items.length < maximum);
    return items;
  }

  async function batchGetSubdomains(keys) {
    const out = new Map();
    const rows = await persistence.foundation.addresses.batchGet(
      keys.map((key) => String(key.su))
    );
    for (const row of rows) out.set(String(row.su), row);
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

  on("search", async (ctx, meta) => {
    const { req, res } = ctx;

    // Accept both flattened req.body and legacy { body: {...} }
    const rawBody = (req && req.body) || {};
    const body = rawBody && typeof rawBody === "object" && rawBody.body && typeof rawBody.body === "object"
      ? rawBody.body
      : rawBody;

    let searchString = body.text;
    if (!searchString) searchString = body.query;

    if (typeof searchString === "string") {
      searchString = searchString.toLowerCase();
    }

    try {
      // ---- inputs / defaults
      const setId          = body.setId || DEFAULT_SET_ID;
      const bandScale      = Number.isFinite(+body.band_scale) ? +body.band_scale : DEFAULT_BAND_SCALE;
      const numShards      = Math.max(1, Math.min(64, DEFAULT_NUM_SHARDS));
      const topL0          = Number.isFinite(+body.topL0) ? Math.max(1, Math.min(4, +body.topL0)) : 3;
      const bandWindow     = Number.isFinite(+body.bandWindow) ? Math.max(0, Math.min(2000, +body.bandWindow)) : 96;
      const limitPerAssign = Number.isFinite(+body.limitPerAssign) ? Math.max(1, Math.min(1000, +body.limitPerAssign)) : 500;
      const topK           = Number.isFinite(+body.topK) ? Math.max(1, Math.min(500, +body.topK)) : 50;

      const e   = await getUserIdFromReq(req, meta);
      const eU  = await ensureQueryEmbedding({ embedding: body.embedding, text: searchString });

      // ---- compute query assignments (L0/L1 + band)
      const assigns = await anchorAssignments(eU, { setId, bandScale, topL0, numShards });

      // Query every v2 shard and legacy v1 partition. Tenant and global rows
      // are unioned because either scope may contain an authorized candidate.
      let anyTenantHit = false;
      const perAssignResults = [];
      const sourceLimit = Math.max(1, Math.ceil(limitPerAssign / ((2 * numShards) + 2)));
      for (const a of assigns) {
        const scopes = [
          ...(e > 0 ? [{ userId: e, type: "tenant" }] : []),
          { userId: null, type: "global" },
        ];
        for (const scope of scopes) {
          for (let shard = 0; shard < numShards; shard += 1) {
            const userScope = scope.userId == null ? "" : `#U=${scope.userId}`;
            const pk = `AB2#${setId}${userScope}#L0=${a.l0}#L1=${a.l1}#S=${pad2(shard)}`;
            let rows = [];
            try {
              rows = await queryOneWindow({
                pk,
                bandCenter: a.band,
                delta: bandWindow,
                limitPerAssign: sourceLimit,
              });
            } catch {/* a missing projection shard is an empty candidate source */}
            if (rows.length && scope.type === "tenant") anyTenantHit = true;
            perAssignResults.push({ a, rows, pkType: `${scope.type}-v2` });
          }
          const legacyScope = scope.userId == null ? "" : `#U=${scope.userId}`;
          const legacyPk = `AB#${setId}${legacyScope}#L0=${a.l0}#L1=${a.l1}`;
          let legacyRows = [];
          try {
            legacyRows = await queryOneWindow({
              pk: legacyPk,
              bandCenter: a.band,
              delta: bandWindow,
              legacy: true,
              limitPerAssign: sourceLimit,
            });
          } catch {/* legacy compatibility is best-effort during backfill */}
          if (legacyRows.length && scope.type === "tenant") anyTenantHit = true;
          perAssignResults.push({ a, rows: legacyRows, pkType: `${scope.type}-v1` });
        }
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
              projectionPolicy: typeof r?.policy_id === "string" ? r.policy_id : null,
            });
          }
        }
      }

      let candidates = Array.from(bySu.values()).sort((x, y) => x.bandDelta - y.bandDelta);

      // Reload canonical rows before trusting visibility, ownership, or policy.
      let subMap = new Map();
      if (candidates.length) {
        const keys = candidates.map(c => ({ su: String(c.su) }));
        subMap = await batchGetSubdomains(keys);
      }
      candidates = candidates.filter((candidate) => {
        const row = subMap.get(String(candidate.su));
        if (!row || row?.canonicalLifecycle?.tombstone === true) return false;
        candidate.policy_id = row.z === true ? "pub" : `entity:${candidate.su}`;
        candidate.isOwner = e > 0 && String(row.e) === String(e);
        return true;
      });

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
      for (const candidate of candidates) {
        if (candidate.isOwner) bestBySu.set(String(candidate.su), "o");
      }
      for (let i = 0; i < permKeys.length; i += 100) {
        const chunk = permKeys.slice(i, i + 100);
        if (!chunk.length) break;
        const rows = await persistence.authorization.batchGetGrants(chunk);
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
      if (candidates.length > topK) candidates = candidates.slice(0, topK);

      // ---- shape output (score + ownership boost)
      const enriched = candidates.map(c => {
        const row = subMap.get(String(c.su));
        const permChar = (c.policy_id === "pub") ? "r" : (bestBySu.get(String(c.su)) || null);
        const oWeight  = ownershipWeight(permChar);
        const revision = entityRevisionFromRow(row);
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
          // Advisory UI metadata only. Every eventual write must independently
          // re-authorize the caller and re-check the current entity version.
          canUse: permChar === "r" || canEditPermission(permChar),
          canEdit: canEditPermission(permChar),
          entityVersion: revision.entityVersion,
          entityUpdatedAt: revision.entityUpdatedAt,
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

module.exports = { register, canEditPermission, entityRevisionFromRow };
