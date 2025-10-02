// modules/passphrases.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();
  const dynamodb = getDocClient();

  // Support both flattened req.body and legacy body.body
  const pickBody = (req) => {
    const b = req?.body;
    if (!b || typeof b !== "object") return b || {};
    if (b.body && typeof b.body === "object") return b.body; // legacy
    return b; // flattened
  };

  // addPassphrase / wrapPassphrase
  const upsertWrappedPassphrase = async (ctx) => {
    const { req } = ctx;
    const body = pickBody(req);
    const { passphraseID, keyVersion, wrapped } = body || {};

    // Legacy validation + response shape
    if (!passphraseID || !keyVersion || !wrapped || typeof wrapped !== "object") {
      return { error: "Invalid payload" };
    }

    const params = {
      TableName: "passphrases",
      Item: {
        passphraseID,
        keyVersion: Number(keyVersion),
        wrapped,
        created: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(passphraseID)",
    };

    await dynamodb.put(params).promise(); // errors bubble to router (legacy behavior)
    return { success: true };
  };

  on("addPassphrase", upsertWrappedPassphrase);
  on("wrapPassphrase", upsertWrappedPassphrase);

  // decryptPassphrase
  on("decryptPassphrase", async (ctx) => {
    const { req } = ctx;
    const body = pickBody(req);
    const { passphraseID, userID, requestId } = body || {};

    if (!passphraseID || !userID) {
      return { statusCode: 400, body: JSON.stringify({ error: "passphraseID and userID required" }) };
    }

    // --- NEW: enforce cookie.e === userID before proceeding ---
    // Prefer what the router middleware already looked up via akIndex:
    // ctx.cookie is the cookies-row (ci, gi, ex, ak, e)
    let cookieE = ctx?.cookie?.e;

    // Fallback: if for some reason ctx.cookie isn't present, try to locate by ak manually.
    const getAccessToken = () =>
      ctx?.xAccessToken ||
      req?.get?.("X-accessToken") ||
      req?.headers?.["x-accesstoken"] ||
      req?.headers?.["x-accessToken"] ||
      req?.cookies?.accessToken ||
      req?.cookies?.ak ||
      null;

    if (!cookieE) {
      const ak = getAccessToken();
      if (ak) {
        const q = await dynamodb
          .query({
            TableName: "cookies",
            IndexName: "akIndex",
            KeyConditionExpression: "ak = :ak",
            ExpressionAttributeValues: { ":ak": ak },
            ProjectionExpression: "e",
          })
          .promise();
        cookieE = q.Items?.[0]?.e;
      }
    }

    // No cookie or mismatch => deny
    if (!cookieE) {
      return { statusCode: 401, body: JSON.stringify({ error: "missing or invalid session" }) };
    }
    if (String(cookieE) !== String(userID)) {
      return { statusCode: 403, body: JSON.stringify({ error: "passphrase access denied" }) };
    }
    // --- END NEW CHECK ---

    const params = {
      TableName: "passphrases",
      Key: { passphraseID },
      ProjectionExpression: "#kv, #wr",
      ExpressionAttributeNames: { "#kv": "keyVersion", "#wr": "wrapped" },
    };

    const { Item } = await dynamodb.get(params).promise();
    if (!Item) {
      return { statusCode: 404, body: JSON.stringify({ error: "passphrase not found" }) };
    }

    const cipherB64 = Item.wrapped?.[userID];
    if (!cipherB64) {
      return { statusCode: 403, body: JSON.stringify({ error: "no wrapped data for this user" }) };
    }

    return {
      passphraseID,
      userID,
      cipherB64,             // BASE64 string: [ephemeralPub||IV||ciphertext]
      keyVersion: Item.keyVersion,
      requestId,             // echo for caller correlation
    };
  });

  return { name: "passphrases" };
}

module.exports = { register };
