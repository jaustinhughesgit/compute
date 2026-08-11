/**
 * Platform: Places entities into anchor-search bands so discovery can query a bounded candidate set.
 * Technical: `anchor` authorizes the addressed subdomain, resolves anchor artifacts, and writes sharded v2 global/owner projections.
 */
"use strict";

const crypto = require("node:crypto");

/**
 * Input accepts `entity`/`su` plus either a numeric embedding or text. Caller
 * identity and visibility policy always come from authenticated server state.
 */

const anchorsUtil = require("../anchors");

const DEFAULT_SET_ID = process.env.ANCHOR_SET_ID || "anchors_v1";
const DEFAULT_BAND_SCALE = Number(process.env.BAND_SCALE || 2000);
const DEFAULT_NUM_SHARDS = Number(process.env.NUM_SHARDS || 8);
const EMB_MODEL_ID = process.env.EMB_MODEL || "text-embedding-3-large";

// default policy namespace for per-entity ACL
const PERM_DEFAULT_POLICY_PREFIX = "entity";

function register({ on, use }) {
  const { getCanonicalPersistence, getSub, deps } = use();
  const persistence = getCanonicalPersistence();
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
    return arr.map((v) => +v / n);
  };

  on("anchor", async (ctx, meta) => {
    const { req, res } = ctx;
    const body = getBody(req);

    // entity id (your su)
    const su = body.entity || body.su;
    const output = body.output ?? null;

    if (!su) {
      res
        .status(400)
        .json({ ok: false, error: "entity (su) is required" });
      return { __handled: true };
    }

    const callerId = String(meta?.cookie?.e || "").trim();
    if (!callerId || callerId === "0") {
      res.status(401).json({ ok: false, error: "authenticated identity is required" });
      return { __handled: true };
    }
    const subdomain = (await getSub(String(su), "su"))?.Items?.[0] || null;
    if (!subdomain) {
      res.status(404).json({ ok: false, error: "entity was not found" });
      return { __handled: true };
    }
    const ownerId = String(subdomain.e || "");
    let canPosition = ownerId === callerId;
    if (!canPosition) {
      const grants = await persistence.authorization.batchGetGrants([
        { entityID: String(su), principalID: `u:${callerId}` },
      ]);
      canPosition = grants.some((grant) => /[wo]/.test(String(grant?.perms || "")));
    }
    if (!canPosition) {
      res.status(403).json({ ok: false, error: "entity positioning is not authorized" });
      return { __handled: true };
    }

    // 1) Prepare embedding (prefer provided; else compute if text given)
    let eU = null;
    if (Array.isArray(body.embedding) && body.embedding.every(isNum)) {
      eU = asUnit(body.embedding);
    } else if (typeof body.text === "string" && body.text.trim()) {
      const q = body.text.trim();
      const {
        data: [{ embedding }],
      } = await openai.embeddings.create({
        model: EMB_MODEL_ID,
        input: q,
      });
      eU = asUnit(embedding);
    }

    if (!eU) {
      res.status(400).json({
        ok: false,
        error: "embedding (number[]) or text is required",
      });
      return { __handled: true };
    }

    // 2) Load anchors
    const setId = body.anchor_set_id || DEFAULT_SET_ID;
    const bandScale = Number.isFinite(+body.band_scale)
      ? +body.band_scale
      : DEFAULT_BAND_SCALE;
    const topL0 = Number.isFinite(+body.topL0)
      ? Math.max(1, Math.min(4, +body.topL0))
      : 2;
    const numShards = Math.max(1, Math.min(64, DEFAULT_NUM_SHARDS));

    const anchors = await anchorsUtil.loadAnchors({
      s3,
      setId,
      band_scale: bandScale,
      num_shards: numShards,
    });

    if (eU.length !== anchors.d) {
      res.status(400).json({
        ok: false,
        error: `embedding dim ${eU.length} != anchors.d ${anchors.d}`,
      });
      return { __handled: true };
    }

    // 3) Assign to anchors
    const assigns = anchorsUtil
      .assign(eU, anchors, {
        topL0,
        band_scale: bandScale,
        num_shards: numShards,
      })
      .map((a) => ({
        ...a,
        shard: anchorsUtil.shardOf(String(su), numShards),
      }));

    if (!assigns.length) {
      res.status(500).json({
        ok: false,
        error: "no anchor assignments (unexpected)",
      });
      return { __handled: true };
    }

    // 4) Write postings to anchor_bands (global + user-scoped)
    const nowIso = new Date().toISOString();

    const userId = ownerId || null;
    const policyId = subdomain.z === true
      ? "pub"
      : `${PERM_DEFAULT_POLICY_PREFIX}:${String(su)}`;
    const entityVersion = Number(subdomain.editVersion || subdomain.canonicalVersion || 0);
    const contentHash = crypto.createHash("sha256")
      .update(JSON.stringify({ su: String(su), output: subdomain.output || output, entityVersion }))
      .digest("hex");

    // Build the postings (global)
    const postingsGlobal = assigns.map((a) => {
      const post = anchorsUtil.makePostingV2({
        setId,
        su: String(su),
        assign: a,
        type: "su",
        shards: numShards,
      });
      return {
        ...post,
        setId,
        updatedAt: nowIso,
        policy_id: policyId,
        entityVersion,
        contentHash,
      };
    });

    // And user-scoped duplicates (if we have userId)
    const postingsUser = userId
      ? assigns.map((a) => {
          const post = anchorsUtil.makePostingV2({
            setId,
            su: String(su),
            assign: a,
            type: "su",
            shards: numShards,
            userId,
          });
          return {
            ...post,
            setId,
            updatedAt: nowIso,
            u: userId,
            policy_id: policyId,
            entityVersion,
            contentHash,
          };
        })
      : [];

    // batch write
    const written = await persistence.retrieval.batchPut(postingsGlobal.concat(postingsUser));

    // anchor metadata object (not persisted here; just returned)
    const anchorObj = {
      setId,
      emb_model: EMB_MODEL_ID,
      dim: anchors.d,
      topL0,
      band_scale: bandScale,
      num_shards: numShards,
      assigns: assigns.map(({ l0, l1, band, dist_q16 }) => ({
        l0,
        l1,
        band,
        dist_q16,
      })),
      updatedAt: nowIso,
    };

    // pick a sample row for debugging in response
    const sample = postingsGlobal[0] || postingsUser[0] || null;

    return {
      ok: true,
      response: {
        action: "anchor",
        entity: su,
        output,
        policy_id: policyId,
        anchor: anchorObj,
        postingsWritten: written,
        samplePK: sample?.pk || null,
        sampleSK: sample?.sk || null,
      },
    };
  });

  return { name: "anchor" };
}

module.exports = { register };
