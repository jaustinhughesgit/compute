// modules/users.js
"use strict";
const crypto = require("crypto");

function register({ on, use }) {
  const { getDocClient, incrementCounterAndGetNewValue /* , getS3, deps */ } = use();

  // Helper: preserve legacy body flattening semantics
  function unwrapBody(b) {
    if (!b || typeof b !== "object") return b;
    if (b.body && typeof b.body === "object") return b.body; // legacy { body: { ... } }
    return b; // already flattened
  }

  // ────────────────────────────────────────────────────────────────────────────
  // createUser
  // Legacy behavior:
  // - Writes a new item to the "users" table with user-provided fields.
  // - Uses ConditionExpression "attribute_not_exists(e)" (kept verbatim).
  // - Swallows ConditionalCheckFailedException (user already exists) like before.
  // - No specific response payload was set in the old monolith (returned empty object).
  // ────────────────────────────────────────────────────────────────────────────
  on("createUser", async (ctx /* , meta */) => {
    const { req /* , res, path, type, signer */ } = ctx;
    const body = unwrapBody(req.body) || {};

    const now = Date.now();

    // Allow callers to pass either { emailHash } or { email }.
    const email = body.email ? String(body.email) : "";
    const emailHash =
      body.emailHash ??
      (email ? crypto.createHash("sha256").update(email).digest("hex") : undefined);

    // Auto-generate a userID if not provided.
    const userID =
      body.userID != null
        ? parseInt(body.userID, 10)
        : await incrementCounterAndGetNewValue("userCounter", getDocClient());

    const newUser = {
      userID,
      emailHash,
      pubEnc: body.pubEnc || "",
      pubSig: body.pubSig || "",
      created: now,
      revoked: !!body.revoked,
      latestKeyVersion: body.latestKeyVersion ?? 1,
    };

    const params = {
      TableName: "users",
      Item: newUser,
      // NOTE: preserved exactly as in legacy (even though 'e' is not part of this item).
      ConditionExpression: "attribute_not_exists(e)",
    };

    try {
      await getDocClient().put(params).promise();
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        // Legacy: log and continue (do not throw)
        console.error("User already exists");
      } else {
        // Preserve legacy: rethrow other errors
        throw err;
      }
    }

    // Legacy branch returned an (effectively) empty payload that later got wrapped.
    // Here we return an empty object to maintain parity of direct action response.
    return {};
  });

  // ────────────────────────────────────────────────────────────────────────────
  // getUserPubKeys
  // Legacy behavior:
  // - Requires userID in body; returns {statusCode, body: JSON.stringify({error})} on errors.
  // - Fetches pubEnc, pubSig, latestKeyVersion via ProjectionExpression.
  // - Returns those fields plus echoed requestId when found.
  // ────────────────────────────────────────────────────────────────────────────
  on("getUserPubKeys", async (ctx /* , meta */) => {
    const { req /* , res, path, type, signer */ } = ctx;
    const body = unwrapBody(req.body) || {};

    const userID = String(body.userID ?? "").trim();
    if (!userID) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "userID required" }),
      };
    }

    const params = {
      TableName: "users",
      Key: { userID: parseInt(userID, 10) },
      ProjectionExpression: "pubEnc, pubSig, latestKeyVersion",
    };

    const { Item } = await getDocClient().get(params).promise();

    if (!Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "user not found" }),
      };
    }

    return {
      pubEnc: Item.pubEnc,
      pubSig: Item.pubSig,
      latestKeyVersion: Item.latestKeyVersion,
      requestId: body.requestId,
    };
  });

  return { name: "users" };
}

module.exports = { register };
