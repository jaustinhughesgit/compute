// modules/users.js
"use strict";

function register({ on, use }) {
const { getDocClient, hashEmail /* , getS3, deps */ } = use();

  function unwrapBody(b) {
  if (!b) return b;
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return b; }
  }
  if (typeof b === "object" && b.body && typeof b.body === "object") return b.body; // legacy
  return b;
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // NEW: update an existing user's encryption + emailHash
  on("createEncryption", async (ctx /* , meta */) => {
    const { req /* , res, path, type, signer */ } = ctx;
    const outer = req?.body || {};
    const body  = unwrapBody(outer) || {};

    // locate the userID
    let userIDNum;
    if (body.userID != null) {
      const n = parseInt(body.userID, 10);
      if (Number.isFinite(n)) userIDNum = n;
    }
    if (!userIDNum) {
      const su = String(req?.entity || outer?.entity || body?.entity || body?.su || "").trim();
      if (!su) {
        return { statusCode: 400, body: JSON.stringify({ error: "entity (su) or userID required" }) };
      }
      const sub = await getSub(su, "su"); // subdomains PK = su
      const foundE = sub?.Items?.[0]?.e;
      if (!foundE) {
        return { statusCode: 404, body: JSON.stringify({ error: "subdomain not found for supplied entity (su)" }) };
      }
      userIDNum = parseInt(foundE, 10);
      if (!Number.isFinite(userIDNum)) {
        return { statusCode: 500, body: JSON.stringify({ error: "invalid entity mapping to userID" }) };
      }
    }

    // inputs to set
    const pubEnc = body.pubEnc ?? null;
    const pubSig = body.pubSig ?? null;

    if (!pubEnc || !pubSig) {
      return { statusCode: 400, body: JSON.stringify({ error: "pubEnc and pubSig are required" }) };
    }

    // hash plaintext email using shared hashEmail (with possible pepper)
    const derivedEmailHash =
      body.emailHash ||
      (body.email ? hashEmail(body.email) : undefined);

    if (!derivedEmailHash) {
      return { statusCode: 400, body: JSON.stringify({ error: "email (plaintext) or emailHash is required" }) };
    }

    const now = Date.now();

    const params = {
      TableName: "users",
      Key: { userID: userIDNum },
      UpdateExpression: "SET pubEnc = :pe, pubSig = :ps, emailHash = :eh, #upd = :now",
      ExpressionAttributeNames: { "#upd": "updated" },
      ExpressionAttributeValues: {
        ":pe": pubEnc,
        ":ps": pubSig,
        ":eh": derivedEmailHash,
        ":now": now
      },
      ConditionExpression: "attribute_exists(userID)",
      ReturnValues: "ALL_NEW"
    };

    try {
      const res = await getDocClient().update(params).promise();
      // return a compact, helpful payload
      return {
        ok: true,
        userID: res.Attributes?.userID,
        latestKeyVersion: res.Attributes?.latestKeyVersion ?? 1,
        updated: res.Attributes?.updated || now
      };
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        return { statusCode: 404, body: JSON.stringify({ error: "user not found" }) };
      }
      throw err;
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────



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
