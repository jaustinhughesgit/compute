// modules/users.js
"use strict";

function register({ on, use }) {
const { getDocClient, hashEmail /* , getS3, deps */ } = use();

  function unwrapBody(b) {
    if (!b || typeof b !== "object") return b;
    if (b.body && typeof b.body === "object") return b.body; // legacy { body: { ... } }
    return b; 
  }


  on("createUser", async (ctx /* , meta */) => {
    const { req /* , res, path, type, signer */ } = ctx;
    const body = unwrapBody(req.body) || {};

    // Validate and normalize inputs
    const userIDNum = parseInt(body.userID, 10);
    if (!Number.isFinite(userIDNum)) {
      return {
       statusCode: 400,
       body: JSON.stringify({ error: "userID must be a number" }),
      };
    }

    // Accept a pre-hashed value (internal path) or hash a provided email (external path)
    const derivedEmailHash =
      body.emailHash ||
      (body.email ? hashEmail(body.email) : undefined);
   if (!derivedEmailHash) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "emailHash (or email) is required" }),
      };
    }

    const now = Date.now();
    const newUser = {
      userID: userIDNum,
      emailHash: derivedEmailHash,
      pubEnc: body.pubEnc ?? null,
      pubSig: body.pubSig ?? null,
      created: now,
      revoked: !!body.revoked,
      latestKeyVersion: body.latestKeyVersion ?? 1,
    };

    const params = {
      TableName: "users",
      Item: newUser,
      ConditionExpression: "attribute_not_exists(userID)",
    };

    try {
      await getDocClient().put(params).promise();
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        // Fine: user already created (e.g., concurrent calls from manageCookie)
        console.warn("createUser: user already exists (no-op)", { userID: userIDNum });
      } else {
        throw err;
      }
    }

    return {};
  });


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
