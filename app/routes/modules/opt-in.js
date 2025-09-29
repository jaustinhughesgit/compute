// modules/opt-in.js
"use strict";

/**
 * This handler intentionally ignores req.path/ctx.path.
 * It reads ONLY from the X-Original-Host header, which your router promotes:
 *   - router.all("*") and route() both do:
 *       req.get("X-Original-Host") || req.headers["x-original-host"] || body.headers["X-Original-Host"]
 *   - Then they strip scheme/host and keep the path.
 *
 * Expected header examples:
 *   https://abc.api.1var.com/cookies/opt-in/<recipientHash>/<senderHash?>
 *   /cookies/opt-in/<recipientHash>/<senderHash?>
 *   /url/opt-in/<recipientHash>/<senderHash?>
 */

function register({ on, use }) {
  const { getDocClient } = use();

  function parseFromOriginalHost(req) {
    // Header may be accessible via req.get() or req.headers (lowercased by Node).
    const rawHeader =
      (req?.get && req.get("X-Original-Host")) ||
      req?.headers?.["x-original-host"] ||
      req?.headers?.["X-Original-Host"];

    if (!rawHeader) {
      return { recipientHash: "", senderHash: "" };
    }

    // Normalize to a path (strip scheme+host if present, drop query)
    const withoutOrigin = String(rawHeader).replace(/^https?:\/\/[^/]+/, "");
    const pathOnly = withoutOrigin.split("?")[0];

    // Split and locate 'opt-in' regardless of any prefix like 'cookies' or 'url'
    const segs = pathOnly.split("/").filter(Boolean);
    const optIdx = segs.findIndex((s) => s.toLowerCase() === "opt-in");
    if (optIdx < 0) return { recipientHash: "", senderHash: "" };

    const recipientHash = decodeURIComponent(segs[optIdx + 1] || "");
    const senderHash = decodeURIComponent(segs[optIdx + 2] || "");

    return { recipientHash, senderHash };
  }

  on("opt-in", async (ctx) => {
    const { req } = ctx;

    // Derive hashes strictly from X-Original-Host
    const { recipientHash, senderHash } = parseFromOriginalHost(req);

    if (!recipientHash) {
      // Keep the same contract your client expects
      return { ok: false, error: "recipientHash required" };
    }

    // No cookie / no X-accessToken required for this operation.
    // We only talk to DynamoDB with the recipientHash (and optional senderHash).
    const docClient = getDocClient();

    if (senderHash) {
      // Allow a specific sender for this recipient
      const params = {
        TableName: "users",
        Key: { emailHash: recipientHash },
        UpdateExpression: "ADD whitelist :s",
        ExpressionAttributeValues: {
          ":s": docClient.createSet([senderHash]),
        },
        ReturnValues: "UPDATED_NEW",
      };
      await docClient.update(params).promise();
      return {
        ok: true,
        message: `Sender ${senderHash} allowed for ${recipientHash}`,
      };
    } else {
      // Opt-in for all senders (toggle a simple flag)
      const params = {
        TableName: "users",
        Key: { emailHash: recipientHash },
        UpdateExpression: "SET whitelistAll = :true",
        ExpressionAttributeValues: {
          ":true": true,
        },
        ReturnValues: "UPDATED_NEW",
      };
      await docClient.update(params).promise();
      return {
        ok: true,
        message: `All senders allowed for ${recipientHash}`,
      };
    }
  });

  return { name: "opt-in" };
}

module.exports = { register };
