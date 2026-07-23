"use strict";

const crypto = require("node:crypto");
const {
  ProtectedAssetError,
  normalizeProtectedAssetReference,
  policyAllowsUse,
} = require("./protectedAssetContract");

const ASSET_TABLE = process.env.PROTECTED_ASSETS_TABLE || "protectedAssets";
const AUDIT_TABLE = process.env.PROTECTED_ASSET_AUDIT_TABLE || "protectedAssetAudit";

const fromB64Url = (value) => Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const zeroObject = (value) => {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (Buffer.isBuffer(value[key])) value[key].fill(0);
    else if (typeof value[key] === "string") value[key] = "";
    else zeroObject(value[key]);
  }
};

function createProtectedAssetBroker({ dynamodb, kms, kmsKeyId } = {}) {
  if (!dynamodb) throw new Error("protected asset broker requires DynamoDB");

  async function audit(event) {
    try {
      const observedAt = new Date().toISOString();
      const eventId = `pae_${crypto.randomUUID().replace(/-/g, "")}`;
      if (!event?.assetId) throw new Error("assetId is required for protected asset audit");
      await dynamodb.put({
        TableName: AUDIT_TABLE,
        Item: {
          assetId: String(event.assetId),
          eventKey: `${observedAt}#${eventId}`,
          eventId,
          observedAt,
          ...event,
        },
      }).promise();
    } catch (error) {
      console.error("protected asset audit write failed", {
        code: error?.code || "AUDIT_WRITE_FAILED",
        eventType: event?.eventType || null,
        assetId: event?.assetId || null,
      });
    }
  }

  async function getAsset(reference, ownerId) {
    const { assetId } = normalizeProtectedAssetReference(reference);
    const result = await dynamodb.get({ TableName: ASSET_TABLE, Key: { assetId } }).promise();
    const asset = result?.Item;
    if (!asset || asset.deletedAt || asset.revokedAt) {
      throw new ProtectedAssetError("ASSET_UNAVAILABLE", "Protected asset is unavailable");
    }
    if (String(asset.ownerId) !== String(ownerId)) {
      throw new ProtectedAssetError("ASSET_ACCESS_DENIED", "Protected asset access denied");
    }
    return asset;
  }

  async function decryptAtBoundary(asset) {
    const wrap = asset?.envelope?.keyWraps?.executor;
    if (!wrap) throw new ProtectedAssetError("EXECUTOR_WRAP_REQUIRED", "Protected asset has no secure-executor key wrap");
    if (!kms?.decrypt) throw new ProtectedAssetError("SECURE_EXECUTOR_UNAVAILABLE", "Protected execution boundary is unavailable");
    if (wrap.algorithm !== "RSA-OAEP-256") {
      throw new ProtectedAssetError("UNSUPPORTED_EXECUTOR_WRAP", "Protected asset executor wrap is unsupported");
    }

    const decrypted = await kms.decrypt({
      CiphertextBlob: fromB64Url(wrap.wrappedKey),
      KeyId: wrap.keyId || kmsKeyId || undefined,
      EncryptionAlgorithm: "RSAES_OAEP_SHA_256",
    }).promise();
    const key = Buffer.from(decrypted?.Plaintext || []);
    if (key.length !== 32) {
      key.fill(0);
      throw new ProtectedAssetError("ASSET_DECRYPT_FAILED", "Protected asset content key is invalid");
    }
    try {
      const iv = fromB64Url(asset.envelope.iv);
      const packed = fromB64Url(asset.envelope.ciphertext);
      if (packed.length < 17) throw new Error("ciphertext malformed");
      const tag = packed.subarray(packed.length - 16);
      const ciphertext = packed.subarray(0, packed.length - 16);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(fromB64Url(asset.envelope.aad));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      try {
        const parsed = JSON.parse(plaintext.toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload must be an object");
        return parsed;
      } finally {
        plaintext.fill(0);
      }
    } catch (_) {
      throw new ProtectedAssetError("ASSET_DECRYPT_FAILED", "Protected asset could not be decrypted");
    } finally {
      key.fill(0);
    }
  }

  async function authorizeAndResolve({
    reference,
    ownerId,
    capabilityId,
    operationId,
    moduleId = "compute",
    use = "inject",
    destinationHost,
    method = "GET",
    path = "/",
    approved = false,
    unattended = false,
  }) {
    const asset = await getAsset(reference, ownerId);
    const decision = policyAllowsUse(asset.metadata, {
      capabilityId,
      operationId,
      moduleId,
      use,
      destinationHost,
      method,
      path,
      approved,
      unattended,
    });
    await audit({
      eventType: decision.allowed ? "asset_use_authorized" : "asset_use_denied",
      assetId: asset.assetId,
      ownerId: String(ownerId),
      capabilityId: String(capabilityId || ""),
      operationId: String(operationId || ""),
      purpose: `${capabilityId}.${operationId}`,
      use,
      destinationHost: destinationHost || null,
      decision: decision.reason,
    });
    if (!decision.allowed) {
      throw new ProtectedAssetError(
        decision.reason === "approval_required" ? "ASSET_APPROVAL_REQUIRED" : "ASSET_POLICY_DENIED",
        decision.reason === "approval_required"
          ? "This protected asset requires approval for this use"
          : "Protected asset policy denied this use",
        { reason: decision.reason, assetId: asset.assetId }
      );
    }
    try {
      const maxUses = Number(asset.metadata?.policy?.maxUses || 0);
      await dynamodb.update({
        TableName: ASSET_TABLE,
        Key: { assetId: asset.assetId },
        UpdateExpression: "ADD #useCount :one SET #lastUsed = :now",
        ConditionExpression: maxUses > 0
          ? "#owner = :owner AND attribute_not_exists(#revoked) AND (attribute_not_exists(#useCount) OR #useCount < :maxUses)"
          : "#owner = :owner AND attribute_not_exists(#revoked)",
        ExpressionAttributeNames: {
          "#useCount": "useCount",
          "#lastUsed": "lastUsedAt",
          "#owner": "ownerId",
          "#revoked": "revokedAt",
        },
        ExpressionAttributeValues: {
          ":one": 1,
          ":now": new Date().toISOString(),
          ":owner": String(ownerId),
          ...(maxUses > 0 ? { ":maxUses": maxUses } : {}),
        },
      }).promise();
    } catch (error) {
      if (error?.code === "ConditionalCheckFailedException") {
        await audit({
          eventType: "asset_use_denied",
          assetId: asset.assetId,
          ownerId: String(ownerId),
          capabilityId: String(capabilityId || ""),
          operationId: String(operationId || ""),
          use,
          destinationHost: destinationHost || null,
          decision: "use_limit_reached",
        });
        throw new ProtectedAssetError("ASSET_USE_LIMIT_REACHED", "Protected asset use limit has been reached");
      }
      throw error;
    }
    return { asset, values: await decryptAtBoundary(asset) };
  }

  async function resolveCapabilityBindings({
    manifest,
    operation,
    references,
    ownerId,
    approvedRequirements = [],
    unattended = false,
  }) {
    const requirements = operation.protectedAssetRequirements || [];
    const supplied = references && typeof references === "object" ? references : {};
    const bindings = Object.create(null);
    const resolved = [];
    try {
      for (const requirement of requirements) {
        const reference = supplied[requirement.requirementId];
        if (!reference) {
          if (requirement.required !== false) {
            throw new ProtectedAssetError("MISSING_ASSET_REFERENCE", `Protected asset ${requirement.requirementId} is required`, {
              requirementId: requirement.requirementId,
            });
          }
          continue;
        }
        const outcome = await authorizeAndResolve({
          reference,
          ownerId,
          capabilityId: manifest.capabilityId,
          operationId: operation.operationId,
          moduleId: "compute",
          use: requirement.use,
          destinationHost: requirement.providerHost,
          method: "GET",
          path: "/",
          approved: approvedRequirements.includes(requirement.requirementId),
          unattended,
        });
        const selected = Object.create(null);
        for (const field of requirement.fields) {
          const value = outcome.values[field.name];
          if (value == null && field.required !== false) {
            throw new ProtectedAssetError("ASSET_FIELD_MISSING", `Protected asset is missing field ${field.name}`);
          }
          if (value != null) selected[field.name] = value;
        }
        bindings[requirement.requirementId] = selected;
        resolved.push(outcome.values);
      }
      return {
        bindings,
        dispose() {
          zeroObject(bindings);
          resolved.forEach(zeroObject);
        },
      };
    } catch (error) {
      zeroObject(bindings);
      resolved.forEach(zeroObject);
      throw error;
    }
  }

  return { getAsset, authorizeAndResolve, resolveCapabilityBindings, audit };
}

module.exports = { createProtectedAssetBroker, zeroObject };
