// modules/position.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();
  const doc = getDocClient(); // DocumentClient (JSON in/out)

  // Keep legacy body handling parity: support both flattened req.body and legacy req.body.body
  const getLegacyBody = (req) => {
    const b = req?.body;
    if (!b || typeof b !== "object") return {};
    if (b.body && typeof b.body === "object") return b.body;
    return b;
  };

  on("position", async (ctx, meta) => {
    const { req, res } = ctx;

    const body = getLegacyBody(req);
    const { entity, anchor } = body || {};

    // Basic validation: we need an entity (key) and an anchor payload to store
    if (!entity || !anchor) {
      res.status(400).json({ error: "entity and anchor are required" });
      return { __handled: true };
    }

    try {
      // Just set the anchor attribute on the subdomains row keyed by su = entity
      await doc.update({
        TableName: "subdomains",
        Key: { su: String(entity) },
        UpdateExpression: "SET #anchor = :anchor",
        ExpressionAttributeNames: {
          "#anchor": "anchor",
        },
        ExpressionAttributeValues: {
          ":anchor": anchor, // e.g. { setId, band_scale, num_shards, assigns:[{l0,l1,band,dist_q16}] }
        },
        ReturnValues: "NONE",
      }).promise();
    } catch (err) {
      console.error("Failed to update subdomains table (anchor):", err);
      res.status(502).json({ error: "failed to save anchor" });
      return { __handled: true };
    }

    // Keep a simple, legacy-style ok/response wrapper
    const existing = meta?.cookie?.existing;
    const response = {
      action: "position",
      entity,
      anchor,
      existing,
      file: "", // unchanged placeholder if something else appends later
    };

    return { ok: true, response };
  });

  return { name: "position" };
}

module.exports = { register };
