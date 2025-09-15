// modules/users.js
"use strict";

function register({ on, use }) {
  const { getDocClient /* , getS3, deps */ } = use();

  function unwrapBody(b) {
    if (!b || typeof b !== "object") return b;
    if (b.body && typeof b.body === "object") return b.body; // legacy { body: { ... } }
    return b; 
  }


  on("createUser", async (ctx /* , meta */) => {
    const { req /* , res, path, type, signer */ } = ctx;
    const body = unwrapBody(req.body) || {};

    const now = Date.now();
    const newUser = {
      userID: parseInt(body.userID, 10),
      emailHash: body.emailHash,
      pubEnc: body.pubEnc,
      pubSig: body.pubSig,
      created: now,
      revoked: !!body.revoked,
      latestKeyVersion: body.latestKeyVersion ?? 1,
    };

    const params = {
      TableName: "users",
      Item: newUser,
      ConditionExpression: "attribute_not_exists(e)",
    };

    try {
      await getDocClient().put(params).promise();
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        console.error("User already exists");
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
