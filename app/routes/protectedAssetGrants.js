/**
 * Platform: Indexes who may use an encrypted asset without confusing use with ownership.
 * Technical: Stores principal-first, versioned grants; recipient and provider delivery remain separate scopes.
 */
"use strict";

const { ProtectedAssetError, normalizeProtectedAssetReference } = require("./protectedAssetContract");

const GRANT_TABLE = process.env.PROTECTED_ASSET_GRANTS_TABLE || "protectedAssetGrants";
const DELIVERIES = new Set(["provider", "recipient"]);

function principalId(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "0") throw new ProtectedAssetError("INVALID_ASSET_GRANT", "recipient is required");
  return raw.startsWith("u:") ? raw : `u:${raw}`;
}

function normalizeDeliveries(value) {
  const values = Array.isArray(value) ? value : [value || "provider"];
  const deliveries = [...new Set(values.map((item) => String(item).trim().toLowerCase()))];
  if (!deliveries.length || deliveries.some((item) => !DELIVERIES.has(item))) {
    throw new ProtectedAssetError("INVALID_ASSET_GRANT", "grant delivery must be provider or recipient");
  }
  return deliveries;
}

function normalizeGrantRequests(raw, { ownerId, envelope } = {}) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 99) {
    throw new ProtectedAssetError("INVALID_ASSET_GRANT", "recipientGrants must contain at most 99 recipients");
  }
  const unique = new Map();
  for (const item of raw) {
    const userID = String(item?.userID ?? item?.principalId ?? "").replace(/^u:/, "").trim();
    const recipient = principalId(userID);
    if (recipient === principalId(ownerId)) continue;
    const wrap = envelope?.keyWraps?.user?.[userID];
    if (!wrap) {
      throw new ProtectedAssetError("ASSET_RECIPIENT_WRAP_REQUIRED", `recipient ${userID} has no encrypted key wrap`);
    }
    if (![userID, `u:${userID}`].includes(String(wrap.keyId))
      && !new RegExp(`^${userID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:v[1-9][0-9]*$`).test(String(wrap.keyId))) {
      throw new ProtectedAssetError("ASSET_RECIPIENT_KEY_MISMATCH", `recipient ${userID} wrap has the wrong public-key identity`);
    }
    unique.set(recipient, { principalId: recipient, userID, deliveries: normalizeDeliveries(item?.deliveries || item?.delivery) });
  }
  return [...unique.values()];
}

function createGrantItems({ asset, requests, now = new Date().toISOString() }) {
  return requests.map((request) => ({
    principalId: request.principalId,
    assetId: asset.assetId,
    ownerId: asset.ownerId,
    schemaVersion: 1,
    recordType: "protected-asset-grant",
    canonicalActions: ["use"],
    deliveries: request.deliveries,
    keyId: String(asset.envelope.keyWraps.user[request.userID]?.keyId || request.userID),
    assetVersion: Number(asset.version || 1),
    lifecycle: { state: "active", tombstone: false },
    createdAt: now,
    updatedAt: now,
  }));
}

function createProtectedAssetGrantStore({ dynamodb } = {}) {
  if (!dynamodb) throw new Error("protected asset grant store requires DynamoDB");

  async function get(assetIdValue, actorId) {
    const { assetId } = normalizeProtectedAssetReference(assetIdValue);
    const result = await dynamodb.get({
      TableName: GRANT_TABLE,
      Key: { principalId: principalId(actorId), assetId },
    }).promise();
    const grant = result?.Item;
    return grant && grant.lifecycle?.state === "active" && grant.lifecycle?.tombstone !== true ? grant : null;
  }

  async function requireUse(asset, actorId, delivery) {
    if (principalId(actorId) === principalId(asset.ownerId)) return { source: "owner", grant: null };
    const grant = await get(asset.assetId, actorId);
    if (!grant || Number(grant.assetVersion) !== Number(asset.version)
      || !grant.canonicalActions?.includes("use") || !grant.deliveries?.includes(delivery)) {
      throw new ProtectedAssetError("ASSET_ACCESS_DENIED", "Protected asset use is not granted for this delivery");
    }
    return { source: "grant", grant };
  }

  async function listForPrincipal(actorId, limit = 50) {
    const result = await dynamodb.query({
      TableName: GRANT_TABLE,
      KeyConditionExpression: "#principal = :principal",
      FilterExpression: "#lifecycle.#state = :active",
      ExpressionAttributeNames: { "#principal": "principalId", "#lifecycle": "lifecycle", "#state": "state" },
      ExpressionAttributeValues: { ":principal": principalId(actorId), ":active": "active" },
      Limit: Math.max(1, Math.min(100, Number(limit || 50))),
    }).promise();
    return result?.Items || [];
  }

  async function revoke(assetIdValue, recipient, ownerId, now = new Date().toISOString()) {
    const { assetId } = normalizeProtectedAssetReference(assetIdValue);
    await dynamodb.update({
      TableName: GRANT_TABLE,
      Key: { principalId: principalId(recipient), assetId },
      UpdateExpression: "SET #lifecycle = :lifecycle, #updated = :updated",
      ConditionExpression: "#owner = :owner",
      ExpressionAttributeNames: { "#lifecycle": "lifecycle", "#updated": "updatedAt", "#owner": "ownerId" },
      ExpressionAttributeValues: {
        ":lifecycle": { state: "revoked", tombstone: false, revokedAt: now },
        ":updated": now,
        ":owner": principalId(ownerId),
      },
    }).promise();
  }

  return { get, listForPrincipal, requireUse, revoke };
}

module.exports = {
  GRANT_TABLE,
  createGrantItems,
  createProtectedAssetGrantStore,
  normalizeGrantRequests,
};
