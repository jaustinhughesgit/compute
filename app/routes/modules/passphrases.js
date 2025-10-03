// modules/passphrases.js
"use strict";

// put this near the top, inside the module file (outside register)
async function nextPpId(dynamodb) {
  // assumes a "counters" table keyed by { name: string }
  const { Attributes } = await dynamodb.update({
    TableName: "counters",
    Key: { name: "ppCounter" },
    // ADD is atomic; if the item/attr doesn't exist, it starts at :inc
    UpdateExpression: "ADD #v :inc SET #u = :now",
    ExpressionAttributeNames: { "#v": "value", "#u": "updatedAt" },
    ExpressionAttributeValues: { ":inc": 1, ":now": new Date().toISOString() },
    ReturnValues: "UPDATED_NEW",
  }).promise();

  const pp = Attributes?.value;            // the new integer value
  return `pp-${pp}`;                       // no padding per your note
  // If you ever want zero-padding: return `pp-${String(pp).padStart(3, "0")}`;
}

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
    let { passphraseID, keyVersion, wrapped } = body || {};

    // normalize and allow blank (server will mint)
    if (typeof passphraseID === "string") passphraseID = passphraseID.trim();
    if (!passphraseID) passphraseID = null;

    // Validation (keyVersion optional; wrapped required)
    if (!wrapped || typeof wrapped !== "object") {
      return { error: "Invalid payload" };
    }
    if (Object.keys(wrapped).length === 0) {
      return { error: "Invalid payload: wrapped map is empty" };
    }
    // Mint a new ID iff missing
    if (!passphraseID) {
      passphraseID = await nextPpId(dynamodb);
    }

    const now = new Date().toISOString();

    // Branch 1: auto-minted ID → version is always 1 (create only)
    if (body.keyVersion == null || body.keyVersion === "") {
      if (!body.passphraseID) {
        await dynamodb.put({
          TableName: "passphrases",
          Item: {
            passphraseID,
            keyVersion: 1,
            wrapped,
            created: now,
            updated: now,
          },
          ConditionExpression: "attribute_not_exists(passphraseID)",
        }).promise();
        return { success: true, passphraseID, keyVersion: 1 };
      }
    }

    // Branch 2: user supplied an existing passphraseID and left keyVersion blank → increment atomically
    if (body.keyVersion == null || body.keyVersion === "") {
      try {
        const { Attributes } = await dynamodb.update({
          TableName: "passphrases",
          Key: { passphraseID },
          UpdateExpression: "ADD #kv :one SET #wr = :wrapped, #upd = :now",
          ExpressionAttributeNames: { "#kv": "keyVersion", "#wr": "wrapped", "#upd": "updated" },
          ExpressionAttributeValues: { ":one": 1, ":wrapped": wrapped, ":now": now },
          ConditionExpression: "attribute_exists(passphraseID)",
          ReturnValues: "UPDATED_NEW",
        }).promise();
        const newVersion = Number(Attributes?.keyVersion);
        return { success: true, passphraseID, keyVersion: newVersion };
      } catch (err) {
        if (err && err.code === "ConditionalCheckFailedException") {
          // Passphrase doesn't exist yet → create as v1
          await dynamodb.put({
            TableName: "passphrases",
            Item: {
              passphraseID,
              keyVersion: 1,
              wrapped,
              created: now,
              updated: now,
            },
            ConditionExpression: "attribute_not_exists(passphraseID)",
          }).promise();
          return { success: true, passphraseID, keyVersion: 1 };
        }
        throw err;
      }
    }

    // Branch 3: explicit keyVersion provided → set to that value
    const kv = Number(keyVersion);
    if (!Number.isFinite(kv) || kv < 1) return { error: "Invalid keyVersion" };

    // Try update-if-exists; otherwise create
    try {
      await dynamodb.update({
        TableName: "passphrases",
        Key: { passphraseID },
        UpdateExpression: "SET #kv = :kv, #wr = :wrapped, #upd = :now",
        ExpressionAttributeNames: { "#kv": "keyVersion", "#wr": "wrapped", "#upd": "updated" },
        ExpressionAttributeValues: { ":kv": kv, ":wrapped": wrapped, ":now": now },
        ConditionExpression: "attribute_exists(passphraseID)",
      }).promise();
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        await dynamodb.put({
          TableName: "passphrases",
          Item: {
            passphraseID,
            keyVersion: kv,
            wrapped,
            created: now,
            updated: now,
          },
          ConditionExpression: "attribute_not_exists(passphraseID)",
        }).promise();
      } else {
        throw err;
      }
    }

    return { success: true, passphraseID, keyVersion: kv };
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
      return { statusCode: 403, requestId, body: JSON.stringify({ error: "passphrase access denied" }) };
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
