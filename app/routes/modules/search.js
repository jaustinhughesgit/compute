// modules/search.js
"use strict";

function register({ on, use }) {
  const {
    getDocClient,
    getCookie,            // <-- we'll reuse the cookie->user-id logic you already have elsewhere
    deps,                 // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // Reuse the same knobs as your positioner so search + position stay in lockstep
  const anchorsUtil         = require("../anchors");
  const ANCHOR_BANDS_TABLE  = process.env.ANCHOR_BANDS_TABLE || "anchor_bands";
  const DEFAULT_SET_ID      = process.env.ANCHOR_SET_ID     || "anchors_v1";
  const EMB_MODEL_ID        = process.env.EMB_MODEL         || "text-embedding-3-large";
  const DEFAULT_BAND_SCALE  = Number(process.env.BAND_SCALE || 2000);
  const DEFAULT_NUM_SHARDS  = Number(process.env.NUM_SHARDS || 8);

  const doc   = getDocClient();
  const s3    = deps.s3;
  const openai= deps.openai;

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
    console.log("QQ : text",text)
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

  on("search", async (ctx) => {
    const { req, res } = ctx;

    // Accept both flattened req.body and legacy { body: {...} }
    const rawBody = (req && req.body) || {};
    const body = rawBody && typeof rawBody === "object" && rawBody.body && typeof rawBody.body === "object"
      ? rawBody.body
      : rawBody;

    console.log("QQ : body", body)
    console.log("QQ : body.text", body.text)

    try {
      // ---- inputs / defaults
      const setId          = body.setId || DEFAULT_SET_ID;
      const bandScale      = Number.isFinite(+body.band_scale) ? +body.band_scale : DEFAULT_BAND_SCALE;
      const numShards      = Number.isFinite(+body.num_shards) ? +body.num_shards : DEFAULT_NUM_SHARDS;
      const topL0          = Number.isFinite(+body.topL0) ? Math.max(1, +body.topL0) : 2;
      const bandWindow     = Number.isFinite(+body.bandWindow) ? +body.bandWindow : 12; // in band units
      const limitPerAssign = Number.isFinite(+body.limitPerAssign) ? +body.limitPerAssign : 500;
      const topK           = Number.isFinite(+body.topK) ? +body.topK : 50;

      const e              = await getUserIdFromReq(req, body);
      const eU             = await ensureQueryEmbedding({ embedding: body.embedding, text: body.text });

      // ---- compute query assignments (L0/L1 + band)
      const assigns = await anchorAssignments(eU, { setId, bandScale, topL0, numShards });

      // ---- query: prefer tenant PK if your postings already carry U=<e>, else fallback to global PK
      // PK forms (must match what makePosting writes):
      //  - tenant: AB#<setId>#U=<e>#L0=<l0>#L1=<l1>
      //  - global: AB#<setId>#L0=<l0>#L1=<l1>
      const makePkTenant = (a) => `AB#${setId}#U=${e}#L0=${pad2(a.l0)}#L1=${pad2(a.l1)}`;
      const makePkGlobal = (a) => `AB#${setId}#L0=${pad2(a.l0)}#L1=${pad2(a.l1)}`;

      let anyTenantHit = false;
      const perAssignResults = [];

      for (const a of assigns) {
        // try tenant key
        let rows = [];
        try {
          rows = await queryOneWindow({
            pk: makePkTenant(a),
            bandCenter: a.band,
            delta: bandWindow,
            numShards,
            limitPerAssign
          });
        } catch {/* swallow */}

        if (rows && rows.length) {
          anyTenantHit = true;
          perAssignResults.push({ a, rows, pkType: "tenant" });
          continue;
        }

        // fallback to global
        let rows2 = [];
        try {
          rows2 = await queryOneWindow({
            pk: makePkGlobal(a),
            bandCenter: a.band,
            delta: bandWindow,
            numShards,
            limitPerAssign
          });
        } catch {/* swallow */}

        perAssignResults.push({ a, rows: rows2 || [], pkType: "global" });
      }

      // ---- merge, dedupe by su, keep best (min bandDelta)
      const bySu = new Map();

      for (const { a, rows, pkType } of perAssignResults) {
        for (const r of rows) {
          const su = r.su || parseSuFromSk(r.sk);
          if (!su) continue;

          const itemBand = isNum(r.band) ? r.band : parseBandFromSk(r.sk);
          if (!isNum(itemBand)) continue;

          const bandDelta = Math.abs(itemBand - a.band);
          const cur = bySu.get(su);
          if (!cur || bandDelta < cur.bandDelta) {
            bySu.set(su, {
              su,
              l0: a.l0,
              l1: a.l1,
              queryBand: a.band,
              itemBand,
              bandDelta,
              pkType,
              pk: r.pk,
              sk: r.sk
            });
          }
        }
      }

      let candidates = Array.from(bySu.values()).sort((x, y) => x.bandDelta - y.bandDelta);
      if (candidates.length > topK) candidates = candidates.slice(0, topK);

      // ---- when we had to use GLOBAL PK for some/all assignments, filter by user e post-join
      const needUserFilter = !anyTenantHit;
      let subMap = new Map();

      if (candidates.length) {
        // batch get subdomain rows (also lets you optional-filter by domain/subdomain)
        const keys = candidates.map(c => ({ su: String(c.su) }));
        subMap = await batchGetSubdomains(keys);

        // optional domain/subdomain filtering if caller provided
        const wantDomain    = body.domain || null;
        const wantSubdomain = body.subdomain || null;

        candidates = candidates.filter(c => {
          const row = subMap.get(String(c.su));
          if (!row) return false;

          if (needUserFilter) {
            // only keep matches owned by this user when we couldn't scope by tenant key
            if (row.e != null && String(row.e) !== String(e)) return false;
          }

          if (wantDomain && String(row.domain) !== String(wantDomain)) return false;
          if (wantSubdomain && String(row.subdomain) !== String(wantSubdomain)) return false;

          return true;
        });
      }

      // shape output
      const enriched = candidates.map(c => {
        const row = subMap.get(String(c.su));
        return {
          su: c.su,
          score: 1 / (1 + c.bandDelta),   // simple monotone transform for readability
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
            text: body.text ?? null,
            hasEmbedding: Array.isArray(body.embedding),
            e
          },
          results: enriched
        }
      };
    } catch (err) {
      console.error("search (anchors) error:", err);
      // keep legacy error shape
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
