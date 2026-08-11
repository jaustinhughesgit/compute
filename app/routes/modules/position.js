/**
 * Platform: Stores entity position descriptions used by reusable browser presentation and interaction.
 * Technical: `position` authorizes a canonical address, writes its anchor through the persistence port, and preserves the response envelope.
 */
"use strict";

function register({ on, use }) {
  const { getCanonicalPersistence, getSub } = use();
  const persistence = getCanonicalPersistence();

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

    const callerId = String(meta?.cookie?.e || "").trim();
    if (!callerId || callerId === "0") {
      res.status(401).json({ error: "authenticated identity is required" });
      return { __handled: true };
    }
    const row = (await getSub(String(entity), "su"))?.Items?.[0] || null;
    if (!row) {
      res.status(404).json({ error: "entity was not found" });
      return { __handled: true };
    }
    let canPosition = String(row.e || "") === callerId;
    if (!canPosition) {
      const grants = await persistence.authorization.batchGetGrants([
        { entityID: String(entity), principalID: `u:${callerId}` },
      ]);
      canPosition = grants.some((grant) => /[wo]/.test(String(grant?.perms || "")));
    }
    if (!canPosition) {
      res.status(403).json({ error: "entity positioning is not authorized" });
      return { __handled: true };
    }

    try {
      await persistence.foundation.addresses.setPosition(String(entity), anchor);
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
