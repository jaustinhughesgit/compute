"use strict";

const crypto = require("node:crypto");
const {
  ProtectedAssetError,
  newProtectedAssetId,
  normalizeProtectedAssetEnvelope,
  normalizeProtectedAssetMetadata,
  normalizeProtectedAssetReference,
  policyAllowsUse,
} = require("../protectedAssetContract");
const { createProtectedAssetBroker } = require("../protectedAssetBroker");

const ASSET_TABLE = process.env.PROTECTED_ASSETS_TABLE || "protectedAssets";
const AUDIT_TABLE = process.env.PROTECTED_ASSET_AUDIT_TABLE || "protectedAssetAudit";

function bodyObject(req) {
  const body = req?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body.body && typeof body.body === "object" && !Array.isArray(body.body)
    ? body.body
    : body;
}

function principalFor(ctx) {
  const value = ctx?.cookie?.e ?? ctx?.req?.cookies?.e ?? null;
  if (value == null || String(value) === "0") {
    throw new ProtectedAssetError("AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  return `u:${String(value)}`;
}

function publicAsset(asset) {
  return {
    assetId: asset.assetId,
    reference: `protected_asset:${asset.assetId}`,
    metadata: asset.metadata,
    status: asset.revokedAt ? "revoked" : asset.deletedAt ? "deleted" : "active",
    version: asset.version,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    revokedAt: asset.revokedAt || null,
  };
}

function routeError(error) {
  const known = error instanceof ProtectedAssetError;
  return {
    ok: false,
    kind: "protectedAssetError",
    error: {
      code: known ? error.code : "PROTECTED_ASSET_FAILED",
      message: known ? error.message : "Protected asset operation failed.",
      details: known ? error.details : null,
    },
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparablePolicy(raw = {}) {
  return {
    allowedUses: raw.allowedUses || [],
    destinations: raw.destinations || [],
    capabilityIds: raw.capabilityIds || [],
    moduleIds: raw.moduleIds || [],
    approvalMode: raw.approvalMode || "every_use",
    unattendedAutomation: raw.unattendedAutomation === true,
    expiresAt: raw.expiresAt || null,
    maxUses: raw.maxUses || null,
    redaction: {
      revealLast: Number(raw.redaction?.revealLast || 0),
      label: String(raw.redaction?.label || "Protected"),
    },
  };
}

function assertEnvelopeBinding({ assetId, metadata, envelope }) {
  let aad;
  try {
    aad = JSON.parse(Buffer.from(envelope.aad, "base64url").toString("utf8"));
  } catch {
    throw new ProtectedAssetError("INVALID_ASSET_ENVELOPE", "envelope AAD is not valid protected-asset metadata");
  }
  if (
    aad?.assetId !== assetId
    || aad?.assetType !== metadata.assetType
    || (aad?.providerId || null) !== (metadata.providerId || null)
    || stableJson(comparablePolicy(aad?.policy)) !== stableJson(comparablePolicy(metadata.policy))
  ) {
    throw new ProtectedAssetError("ASSET_AAD_MISMATCH", "envelope AAD does not match the protected asset contract");
  }
  const requiresExecutor = metadata.policy.allowedUses.some((use) =>
    ["authenticate", "inject", "compare", "send", "derive"].includes(use)
  );
  if (requiresExecutor && !envelope.keyWraps.executor) {
    throw new ProtectedAssetError("EXECUTOR_WRAP_REQUIRED", "This protected asset policy requires a secure-executor key wrap");
  }
}

function kmsClient(shared) {
  if (shared?.deps?.kms) return shared.deps.kms;
  const AWS = shared?.deps?.AWS;
  return AWS?.KMS ? new AWS.KMS({ region: process.env.AWS_REGION || "us-east-1" }) : null;
}

function requestedAction(ctx, forcedAction = "") {
  const forced = String(forcedAction || "").trim();
  if (forced) return forced.toLowerCase();

  const pathAction = String(ctx?.path || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)[0];
  if (pathAction) return decodeURIComponent(pathAction).toLowerCase();

  const originalHost = (
    ctx?.req?.get?.("X-Original-Host")
    || ctx?.req?.headers?.["x-original-host"]
    || ctx?.req?.headers?.["X-Original-Host"]
    || ""
  );
  const segments = String(originalHost)
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const moduleIndex = segments.findIndex((segment) => segment.toLowerCase() === "protectedassets");
  if (moduleIndex >= 0 && segments[moduleIndex + 1]) {
    return String(segments[moduleIndex + 1]).toLowerCase();
  }
  const direct = segments.find((segment) => /^protectedasset:/i.test(segment));
  return direct ? direct.slice(direct.indexOf(":") + 1).toLowerCase() : "help";
}

function register({ on, use }) {
  const shared = use();
  const dynamodb = shared?.deps?.dynamodb || shared?.getDocClient?.();
  const kms = kmsClient(shared);
  const kmsKeyId = process.env.PROTECTED_ASSET_KMS_KEY_ID || "";
  const broker = createProtectedAssetBroker({ dynamodb, kms, kmsKeyId });
  shared.expose?.("protectedAssetBroker", broker);

  async function route(ctx, forcedAction = "") {
    try {
      const segments = String(ctx?.path || "")
        .split("?")[0]
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      const action = requestedAction(ctx, forcedAction || segments.shift() || "");
      const body = bodyObject(ctx?.req);
      const ownerId = principalFor(ctx);

      if (action === "executor-key") {
        if (!kms?.getPublicKey || !kmsKeyId) {
          throw new ProtectedAssetError("SECURE_EXECUTOR_UNAVAILABLE", "Protected execution key is not configured");
        }
        const result = await kms.getPublicKey({ KeyId: kmsKeyId }).promise();
        const publicKey = Buffer.from(result.PublicKey || []);
        if (publicKey.byteLength < 64) {
          throw new ProtectedAssetError(
            "SECURE_EXECUTOR_INVALID_KEY",
            "Protected execution key did not return a valid public key"
          );
        }
        return {
          ok: true,
          kind: "protectedAssetExecutorKey",
          keyId: result.KeyId || kmsKeyId,
          algorithm: "RSA-OAEP-256",
          publicKeySpki: publicKey.toString("base64url"),
        };
      }

      if (action === "create") {
        const assetId = body.assetId
          ? normalizeProtectedAssetReference(body.assetId).assetId
          : newProtectedAssetId();
        const metadata = normalizeProtectedAssetMetadata(body.metadata, { ownerId });
        const envelope = normalizeProtectedAssetEnvelope(body.envelope);
        assertEnvelopeBinding({ assetId, metadata, envelope });
        const now = new Date().toISOString();
        const item = {
          assetId,
          ownerId,
          metadata,
          envelope,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await dynamodb.put({
          TableName: ASSET_TABLE,
          Item: item,
          ConditionExpression: "attribute_not_exists(assetId)",
        }).promise();
        await broker.audit({
          eventType: "asset_created",
          assetId,
          ownerId,
          assetType: metadata.assetType,
          providerId: metadata.providerId,
        });
        return { ok: true, kind: "protectedAssetCreated", asset: publicAsset(item) };
      }

      if (action === "get") {
        const reference = body.reference || body.assetId || segments[0];
        const asset = await broker.getAsset(reference, ownerId);
        return { ok: true, kind: "protectedAssetMetadata", asset: publicAsset(asset) };
      }

      if (action === "envelope") {
        const reference = body.reference || body.assetId || segments[0];
        const asset = await broker.getAsset(reference, ownerId);
        if (body.purpose !== "local_reveal" || body.approved !== true) {
          throw new ProtectedAssetError("ASSET_APPROVAL_REQUIRED", "Local reveal requires explicit approval");
        }
        const decision = policyAllowsUse(asset.metadata, {
          use: "reveal",
          moduleId: "surface",
          approved: true,
          unattended: false,
        });
        if (!decision.allowed) {
          throw new ProtectedAssetError("ASSET_POLICY_DENIED", "Protected asset policy does not allow local reveal", {
            reason: decision.reason,
          });
        }
        await broker.audit({
          eventType: "asset_envelope_retrieved",
          assetId: asset.assetId,
          ownerId,
          purpose: "local_reveal",
        });
        return {
          ok: true,
          kind: "protectedAssetEnvelope",
          asset: publicAsset(asset),
          envelope: asset.envelope,
        };
      }

      if (action === "list") {
        const data = await dynamodb.query({
          TableName: ASSET_TABLE,
          IndexName: "ownerId-updatedAt-index",
          KeyConditionExpression: "#owner = :owner",
          FilterExpression: "attribute_not_exists(#deleted)",
          ExpressionAttributeNames: { "#owner": "ownerId", "#deleted": "deletedAt" },
          ExpressionAttributeValues: { ":owner": ownerId },
          ScanIndexForward: false,
          Limit: Math.max(1, Math.min(100, Number(body.limit || 50))),
        }).promise();
        return {
          ok: true,
          kind: "protectedAssetList",
          assets: (data?.Items || []).map(publicAsset),
        };
      }

      if (action === "rotate") {
        const { assetId } = normalizeProtectedAssetReference(body.reference || body.assetId || segments[0]);
        const existing = await broker.getAsset(assetId, ownerId);
        const envelope = normalizeProtectedAssetEnvelope(body.envelope);
        assertEnvelopeBinding({ assetId, metadata: existing.metadata, envelope });
        const expectedVersion = Number(body.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          throw new ProtectedAssetError("INVALID_ASSET_VERSION", "expectedVersion is required");
        }
        const now = new Date().toISOString();
        const result = await dynamodb.update({
          TableName: ASSET_TABLE,
          Key: { assetId },
          UpdateExpression: "SET #envelope = :envelope, #version = #version + :one, #updated = :now",
          ConditionExpression: "#owner = :owner AND #version = :expected AND attribute_not_exists(#revoked)",
          ExpressionAttributeNames: {
            "#envelope": "envelope", "#version": "version", "#updated": "updatedAt",
            "#owner": "ownerId", "#revoked": "revokedAt",
          },
          ExpressionAttributeValues: {
            ":envelope": envelope, ":one": 1, ":now": now,
            ":owner": ownerId, ":expected": expectedVersion,
          },
          ReturnValues: "ALL_NEW",
        }).promise();
        await broker.audit({ eventType: "asset_rotated", assetId, ownerId, version: expectedVersion + 1 });
        return { ok: true, kind: "protectedAssetRotated", asset: publicAsset(result.Attributes) };
      }

      if (action === "revoke") {
        const { assetId } = normalizeProtectedAssetReference(body.reference || body.assetId || segments[0]);
        const now = new Date().toISOString();
        await dynamodb.update({
          TableName: ASSET_TABLE,
          Key: { assetId },
          UpdateExpression: "SET #revoked = :now, #updated = :now",
          ConditionExpression: "#owner = :owner AND attribute_not_exists(#deleted)",
          ExpressionAttributeNames: {
            "#revoked": "revokedAt", "#updated": "updatedAt",
            "#owner": "ownerId", "#deleted": "deletedAt",
          },
          ExpressionAttributeValues: { ":now": now, ":owner": ownerId },
        }).promise();
        await broker.audit({ eventType: "asset_revoked", assetId, ownerId, reason: String(body.reason || "").slice(0, 300) });
        return { ok: true, kind: "protectedAssetRevoked", assetId };
      }

      if (action === "delete") {
        const { assetId } = normalizeProtectedAssetReference(body.reference || body.assetId || segments[0]);
        const now = new Date().toISOString();
        await dynamodb.update({
          TableName: ASSET_TABLE,
          Key: { assetId },
          UpdateExpression: "REMOVE #envelope SET #deleted = :now, #updated = :now",
          ConditionExpression: "#owner = :owner",
          ExpressionAttributeNames: {
            "#envelope": "envelope", "#deleted": "deletedAt",
            "#updated": "updatedAt", "#owner": "ownerId",
          },
          ExpressionAttributeValues: { ":now": now, ":owner": ownerId },
        }).promise();
        await broker.audit({ eventType: "asset_deleted", assetId, ownerId });
        return { ok: true, kind: "protectedAssetDeleted", assetId };
      }

      if (action === "audit") {
        const reference = body.reference || body.assetId || segments[0];
        const asset = await broker.getAsset(reference, ownerId);
        const data = await dynamodb.query({
          TableName: AUDIT_TABLE,
          KeyConditionExpression: "#asset = :asset",
          ExpressionAttributeNames: { "#asset": "assetId" },
          ExpressionAttributeValues: { ":asset": asset.assetId },
          ScanIndexForward: false,
          Limit: Math.max(1, Math.min(200, Number(body.limit || 100))),
        }).promise();
        return {
          ok: true,
          kind: "protectedAssetAudit",
          assetId: asset.assetId,
          events: (data?.Items || []).filter((event) => String(event.ownerId) === ownerId),
        };
      }

      return {
        ok: true,
        kind: "protectedAssetHelp",
        actions: ["executor-key", "create", "get", "envelope", "list", "rotate", "revoke", "delete", "audit"],
      };
    } catch (error) {
      if (!(error instanceof ProtectedAssetError)) {
        console.error("protected asset route failed", { code: error?.code || "PROTECTED_ASSET_FAILED" });
      }
      return routeError(error);
    }
  }

  on("protectedAssets", route);
  for (const action of ["executor-key", "create", "get", "envelope", "list", "rotate", "revoke", "delete", "audit"]) {
    on(`protectedAsset:${action}`, (ctx) => route(ctx, action));
  }
  return { name: "protectedAssets" };
}

module.exports = { register };
