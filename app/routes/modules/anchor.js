// routes/modules/anchor.js
"use strict";

/**
 * Anchor-based positioner:
 * - expects body.body: { domain, subdomain, entity, embedding? (number[]), text?, output?, path?, policy_id? }
 * - computes/normalizes embedding if needed (using OpenAI if `text` is provided)
 * - loads anchors (L0/L1) from S3
 * - assigns to top-L0 → nearest L1
 * - writes postings to `anchor_bands` (both global and user-scoped) WITH policy_id
 * - updates `subdomains` with { anchor: {...}, domain, subdomain, output, path }
 */

// PATH: use routes/anchors (your repo layout)
const anchorsUtil = require("../anchors");

const DEFAULT_SET_ID = process.env.ANCHOR_SET_ID || "anchors_v1";
const DEFAULT_BAND_SCALE = Number(process.env.BAND_SCALE || 2000);
const DEFAULT_NUM_SHARDS = Number(process.env.NUM_SHARDS || 8);
const ANCHOR_BANDS_TABLE = process.env.ANCHOR_BANDS_TABLE || "anchor_bands";
const EMB_MODEL_ID = process.env.EMB_MODEL || "text-embedding-3-large";

// default policy namespace for per-entity ACL
const PERM_DEFAULT_POLICY_PREFIX = "entity";

function register({ on, use }) {
  const { getDocClient, deps } = use();
  const doc = getDocClient();       // AWS.DynamoDB.DocumentClient
  const s3 = deps.s3;
  const openai = deps.openai;

  const getBody = (req) => {
    const b = req?.body;
    if (!b || typeof b !== "object") return {};
    return b.body && typeof b.body === "object" ? b.body : b;
  };

  const isNum = (x) => typeof x === "number" && Number.isFinite(x);

  const asUnit = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    let ss = 0;
    for (const v of arr) {
      const f = +v;
      if (!Number.isFinite(f)) return null;
      ss += f * f;
    }
    const n = Math.sqrt(ss);
    if (n < 1e-12) return null;
    return arr.map(v => +v / n);
  };

  const batchWriteAll = async (table, puts) => {
    if (!puts || !puts.length) return 0;
    let i = 0, total = 0;
    while (i < puts.length) {
      const chunk = puts.slice(i, i + 25);
      const params = { RequestItems: { [table]: chunk.map(Item => ({ PutRequest: { Item } })) } };
      // retry any unprocessed items with backoff
      let backoff = 100;
      /* eslint no-constant-condition: 0 */
      while (true) {
        const rsp = await doc.batchWrite(params).promise();
        const un = (rsp.UnprocessedItems && rsp.UnprocessedItems[table]) || [];
        total += chunk.length - un.length;
        if (!un.length) break;
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(2000, backoff * 2);
        params.RequestItems = { [table]: un };
      }
      i += 25;
    }
    return total;
  };

  on("anchor", async (ctx) => {
    const { req, res } = ctx;
    const body = getBody(req);

    const domain = body.domain;
    const subdomain = body.subdomain;
    const su = body.entity; // required (your subdomains.su)
    const output = body.output ?? null;
    const pathStr = (typeof body.path === "string" && body.path.trim())
      ? body.path
      : `/${domain}/${subdomain}`;

    if (!domain || !subdomain || !su) {
      res.status(400).json({ ok: false, error: "domain, subdomain, and entity (su) are required" });
      return { __handled: true };
    }

    // 1) Prepare embedding (prefer provided; else compute if text given)
    let eU = null;
    if (Array.isArray(body.embedding) && body.embedding.every(isNum)) {
      eU = asUnit(body.embedding);
    } else if (typeof body.text === "string" && body.text.trim()) {
      const q = body.text.trim();
      const { data: [{ embedding }] } = await openai.embeddings.create({
        model: EMB_MODEL_ID,
        input: q
      });
      eU = asUnit(embedding);
    }
    if (!eU) {
      res.status(400).json({ ok: false, error: "embedding (number[]) or text is required" });
      return { __handled: true };
    }

    // 2) Load anchors
    const setId = body.anchor_set_id || DEFAULT_SET_ID;
    const bandScale = Number.isFinite(+body.band_scale) ? +body.band_scale : DEFAULT_BAND_SCALE;
    const topL0 = Number.isFinite(+body.topL0) ? Math.max(1, +body.topL0) : 2;
    const numShards = Number.isFinite(+body.num_shards) ? +body.num_shards : DEFAULT_NUM_SHARDS;

    const anchors = await anchorsUtil.loadAnchors({ s3, setId, band_scale: bandScale, num_shards: numShards });
    if (eU.length !== anchors.d) {
      res.status(400).json({ ok: false, error: `embedding dim ${eU.length} != anchors.d ${anchors.d}` });
      return { __handled: true };
    }

    // 3) Assign to anchors
    const assigns = anchorsUtil
      .assign(eU, anchors, { topL0, band_scale: bandScale, num_shards: numShards })
      .map(a => ({ ...a, shard: anchorsUtil.shardOf(String(su), numShards) }));

    if (!assigns.length) {
      res.status(500).json({ ok: false, error: "no anchor assignments (unexpected)" });
      return { __handled: true };
    }

    // 4) Write postings to anchor_bands (global + user-scoped)
    const nowIso = new Date().toISOString();

    const ownerId =
      (typeof body.e === "number" || typeof body.e === "string") ? String(body.e)
        : (typeof req?.body?.e === "number" || typeof req?.body?.e === "string") ? String(req.body.e)
          : null;

    // If the subdomains row already has `e`, prefer that (so callers needn't pass e)
    let ownerFromSub = null;
    try {
      const { Item } = await doc.get({
        TableName: "subdomains",
        Key: { su: String(su) },
        ProjectionExpression: "e"
      }).promise();
      if (Item && (typeof Item.e === "number" || typeof Item.e === "string")) {
        ownerFromSub = String(Item.e);
      }
    } catch (_) { /* best-effort */ }

    const userId = ownerId || ownerFromSub || null;

    // policy_id (for ACL): allow override, else default to entity:<su>
    const policyId = (typeof body.policy_id === "string" && body.policy_id.trim())
      ? body.policy_id.trim()
      : `${PERM_DEFAULT_POLICY_PREFIX}:${String(su)}`;

    // Build the postings (global)
    const postingsGlobal = assigns.map(a => {
      const post = anchorsUtil.makePosting({ setId, su: String(su), assign: a, type: "su", shards: numShards });
      return {
        ...post,
        setId,
        updatedAt: nowIso,
        policy_id: policyId
      };
    });

    // And user-scoped duplicates (if we have userId)
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const postingsUser = userId
      ? assigns.map(a => {
          const pk = `AB#${setId}#U=${userId}#L0=${a.l0}#L1=${a.l1}`;
          const sk = `B=${String(a.band).padStart(5, "0")}#S=${pad(anchorsUtil.shardOf(String(su), numShards))}#T=su#SU=${su}`;
          return {
            pk,
            sk,
            su: String(su),
            type: "su",
            setId,
            l0: a.l0,
            l1: a.l1,
            band: a.band,
            dist_q16: a.dist_q16,
            updatedAt: nowIso,
            u: userId,
            policy_id: policyId
          };
        })
      : [];

    // batch write
    const written = await batchWriteAll(ANCHOR_BANDS_TABLE, postingsGlobal.concat(postingsUser));

    // 5) Update subdomains row with anchor metadata (+ labels)
    const anchorObj = {
      setId,
      emb_model: EMB_MODEL_ID,
      dim: anchors.d,
      topL0,
      band_scale: bandScale,
      num_shards: numShards,
      assigns: assigns.map(({ l0, l1, band, dist_q16 }) => ({ l0, l1, band, dist_q16 })),
      updatedAt: nowIso
    };

    await doc.update({
      TableName: "subdomains",
      Key: { su: String(su) },
      UpdateExpression: `
        SET #anchor = :anchor,
            #domain = :domain,
            #subdomain = :subdomain,
            #path = :path,
            #output = :output
      `,
      ExpressionAttributeNames: {
        "#anchor": "anchor",
        "#domain": "domain",
        "#subdomain": "subdomain",
        "#path": "path",
        "#output": "output"
      },
      ExpressionAttributeValues: {
        ":anchor": anchorObj,
        ":domain": domain,
        ":subdomain": subdomain,
        ":path": pathStr,
        ":output": output
      }
    }).promise();

    // pick a sample row for debugging in response
    const sample = (postingsGlobal[0] || postingsUser[0]) || null;

    return {
      ok: true,
      response: {
        action: "anchor",
        entity: su,
        domain,
        subdomain,
        path: pathStr,
        output,
        policy_id: policyId,
        anchor: anchorObj,
        postingsWritten: written,
        samplePK: sample?.pk || null,
        sampleSK: sample?.sk || null
      }
    };
  });

  return { name: "anchor" };
}

module.exports = { register };
