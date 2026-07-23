"use strict";

// Compatibility adapter for legacy {!passphrase!} tokens. New protected data
// should use Protected Assets. This route accepts ciphertext only, binds each
// record to its authenticated owner, and never decrypts server-side.

async function nextPpId(dynamodb) {
  const result = await dynamodb.update({
    TableName: "ppCounter",
    Key: { pk: "ppCounter" },
    UpdateExpression: "ADD #x :one SET #updated = :now",
    ExpressionAttributeNames: { "#x": "x", "#updated": "updatedAt" },
    ExpressionAttributeValues: { ":one": 1, ":now": new Date().toISOString() },
    ReturnValues: "UPDATED_NEW",
  }).promise();
  const value = Number(result?.Attributes?.x);
  if (!Number.isFinite(value)) throw new Error("ppCounter.x is invalid");
  return `pp-${value}`;
}

function bodyObject(req) {
  const body = req?.body;
  if (!body || typeof body !== "object") return {};
  return body.body && typeof body.body === "object" ? body.body : body;
}

function userFor(ctx) {
  const value = ctx?.cookie?.e ?? ctx?.req?.cookies?.e;
  return value != null && String(value) !== "0" ? String(value) : null;
}

function validateWrapped(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("wrapped map is required");
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > 100) throw new Error("wrapped map size is invalid");
  return Object.fromEntries(entries.map(([userID, cipher]) => {
    const text = String(cipher || "");
    if (!/^[A-Za-z0-9+/=_-]{32,100000}$/.test(text)) throw new Error(`wrapped cipher for ${userID} is invalid`);
    return [String(userID), text];
  }));
}

function register({ on, use }) {
  const shared = use();
  const dynamodb = shared?.getDocClient?.() || shared?.deps?.dynamodb;

  const upsert = async (ctx) => {
    const ownerId = userFor(ctx);
    if (!ownerId) return { statusCode: 401, body: JSON.stringify({ error: "authentication required" }) };
    const body = bodyObject(ctx.req);
    const wrapped = validateWrapped(body.wrapped);
    const suppliedId = String(body.passphraseID || "").trim();
    const passphraseID = suppliedId || await nextPpId(dynamodb);
    const now = new Date().toISOString();

    if (!suppliedId) {
      await dynamodb.put({
        TableName: "passphrases",
        Item: { passphraseID, ownerId, keyVersion: 1, wrapped, created: now, updated: now },
        ConditionExpression: "attribute_not_exists(passphraseID)",
      }).promise();
      return { success: true, passphraseID, keyVersion: 1 };
    }

    const explicit = body.keyVersion == null || body.keyVersion === "" ? null : Number(body.keyVersion);
    if (explicit != null && (!Number.isInteger(explicit) || explicit < 1)) return { error: "Invalid keyVersion" };
    try {
      const result = await dynamodb.update({
        TableName: "passphrases",
        Key: { passphraseID },
        UpdateExpression: explicit == null
          ? "ADD #version :one SET #wrapped = :wrapped, #updated = :now"
          : "SET #version = :version, #wrapped = :wrapped, #updated = :now",
        ConditionExpression: "#owner = :owner",
        ExpressionAttributeNames: {
          "#version": "keyVersion", "#wrapped": "wrapped",
          "#updated": "updated", "#owner": "ownerId",
        },
        ExpressionAttributeValues: {
          ...(explicit == null ? { ":one": 1 } : { ":version": explicit }),
          ":wrapped": wrapped, ":now": now, ":owner": ownerId,
        },
        ReturnValues: "ALL_NEW",
      }).promise();
      return {
        success: true,
        passphraseID,
        keyVersion: Number(result.Attributes?.keyVersion || explicit || 1),
      };
    } catch (error) {
      if (error?.code !== "ConditionalCheckFailedException") throw error;
      await dynamodb.put({
        TableName: "passphrases",
        Item: { passphraseID, ownerId, keyVersion: explicit || 1, wrapped, created: now, updated: now },
        ConditionExpression: "attribute_not_exists(passphraseID)",
      }).promise();
      return { success: true, passphraseID, keyVersion: explicit || 1 };
    }
  };
  on("addPassphrase", upsert);
  on("wrapPassphrase", upsert);

  on("decryptPassphrase", async (ctx) => {
    const ownerId = userFor(ctx);
    if (!ownerId) return { statusCode: 401, body: JSON.stringify({ error: "authentication required" }) };
    const { passphraseID, userID, requestId } = bodyObject(ctx.req);
    if (!passphraseID || !userID || String(userID) !== ownerId) {
      return { statusCode: 403, body: JSON.stringify({ error: "passphrase access denied" }) };
    }
    const result = await dynamodb.get({
      TableName: "passphrases",
      Key: { passphraseID: String(passphraseID) },
      ProjectionExpression: "#owner, #version, #wrapped",
      ExpressionAttributeNames: {
        "#owner": "ownerId", "#version": "keyVersion", "#wrapped": "wrapped",
      },
    }).promise();
    const item = result?.Item;
    if (!item) return { statusCode: 404, body: JSON.stringify({ error: "passphrase not found" }) };
    if (String(item.ownerId) !== ownerId || !item.wrapped?.[ownerId]) {
      return { statusCode: 403, body: JSON.stringify({ error: "passphrase access denied" }) };
    }
    return {
      passphraseID: String(passphraseID),
      userID: ownerId,
      cipherB64: item.wrapped[ownerId],
      keyVersion: item.keyVersion,
      requestId,
    };
  });
  return { name: "passphrases" };
}

module.exports = { register };
