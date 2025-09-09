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
