// routes/capabilityRegistry.js
"use strict";

const {
  CapabilityError,
  validateCapabilityManifest,
} = require("./capabilityManifest");

const DEFAULT_TABLE = process.env.SUBDOMAINS_TABLE || "subdomains";

function promiseOf(request) {
  return request && typeof request.promise === "function" ? request.promise() : request;
}

function createCapabilityRegistry({ dynamodb, tableName = DEFAULT_TABLE } = {}) {
  if (!dynamodb) throw new Error("capability registry requires a DynamoDB DocumentClient");

  async function getEntityRecord(entityId) {
    const id = String(entityId || "").trim();
    if (!id) return null;
    const data = await promiseOf(dynamodb.get({ TableName: tableName, Key: { su: id } }));
    return data?.Item || null;
  }

  async function getByEntity(entityId, { includeInactive = true } = {}) {
    const item = await getEntityRecord(entityId);
    if (!item?.computeCapability) return null;
    const manifest = validateCapabilityManifest(item.computeCapability, { entityId: item.su });
    if (!includeInactive && manifest.status !== "active") return null;
    return manifest;
  }

  async function register(rawManifest, { ownerId = "system", allowOwnerOverride = false } = {}) {
    const requestedEntityId = String(rawManifest?.entityId || "").trim();
    const existing = await getEntityRecord(requestedEntityId);
    if (!existing) {
      throw new CapabilityError("ENTITY_NOT_FOUND", `Compute entity ${requestedEntityId || "(blank)"} does not exist`);
    }

    const existingOwner = existing.capabilityOwnerId != null
      ? String(existing.capabilityOwnerId)
      : null;
    const callerOwner = String(ownerId || "system");
    if (existingOwner && existingOwner !== callerOwner && !allowOwnerOverride) {
      throw new CapabilityError("PERMISSION_DENIED", "Only the capability owner may replace its manifest");
    }

    const now = new Date().toISOString();
    const normalized = validateCapabilityManifest(rawManifest, {
      entityId: requestedEntityId,
      ownerId: existingOwner || callerOwner,
    });
    normalized.createdAt = String(existing.computeCapability?.createdAt || normalized.createdAt || now);
    normalized.updatedAt = now;

    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: normalized.entityId },
      UpdateExpression: [
        "SET #manifest = :manifest",
        "#capabilityId = :capabilityId",
        "#capabilityVersion = :capabilityVersion",
        "#capabilityStatus = :capabilityStatus",
        "#capabilityOwnerId = :capabilityOwnerId",
        "#capabilityUpdatedAt = :capabilityUpdatedAt",
      ].join(", "),
      ExpressionAttributeNames: {
        "#manifest": "computeCapability",
        "#capabilityId": "capabilityId",
        "#capabilityVersion": "capabilityVersion",
        "#capabilityStatus": "capabilityStatus",
        "#capabilityOwnerId": "capabilityOwnerId",
        "#capabilityUpdatedAt": "capabilityUpdatedAt",
      },
      ExpressionAttributeValues: {
        ":manifest": normalized,
        ":capabilityId": normalized.capabilityId,
        ":capabilityVersion": normalized.version,
        ":capabilityStatus": normalized.status,
        ":capabilityOwnerId": normalized.ownerId,
        ":capabilityUpdatedAt": now,
      },
    }));

    return normalized;
  }

  async function setStatus(entityId, status, { ownerId = "system", allowOwnerOverride = false } = {}) {
    const item = await getEntityRecord(entityId);
    if (!item?.computeCapability) {
      throw new CapabilityError("CAPABILITY_NOT_FOUND", `No capability is registered for entity ${entityId}`);
    }
    const existingOwner = String(item.capabilityOwnerId || item.computeCapability.ownerId || "system");
    const callerOwner = String(ownerId || "system");
    if (existingOwner !== callerOwner && !allowOwnerOverride) {
      throw new CapabilityError("PERMISSION_DENIED", "Only the capability owner may change its status");
    }
    const manifest = validateCapabilityManifest({ ...item.computeCapability, status }, { entityId: item.su, ownerId: existingOwner });
    return register(manifest, { ownerId: callerOwner, allowOwnerOverride });
  }

  async function findByCapability(capabilityId, { activeOnly = true, limit = 25, ownerId = null, includeSystem = true } = {}) {
    const id = String(capabilityId || "").trim().toLowerCase();
    if (!id) return [];
    const requestedOwner = ownerId == null ? null : String(ownerId);
    const matches = [];
    let ExclusiveStartKey;
    do {
      const data = await promiseOf(dynamodb.scan({
        TableName: tableName,
        FilterExpression: "#capabilityId = :capabilityId",
        ExpressionAttributeNames: { "#capabilityId": "capabilityId" },
        ExpressionAttributeValues: { ":capabilityId": id },
        ExclusiveStartKey,
      }));
      for (const item of data?.Items || []) {
        if (!item?.computeCapability) continue;
        try {
          const manifest = validateCapabilityManifest(item.computeCapability, { entityId: item.su });
          if (
            requestedOwner &&
            manifest.ownerId !== requestedOwner &&
            !(includeSystem && manifest.ownerId === "system")
          ) continue;
          if (!activeOnly || manifest.status === "active") matches.push(manifest);
        } catch (_) {
          // Ignore invalid legacy rows; registration is the repair path.
        }
        if (matches.length >= limit) break;
      }
      ExclusiveStartKey = matches.length >= limit ? null : data?.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    return matches
      .sort((a, b) => b.version - a.version || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, limit);
  }

  return {
    getEntityRecord,
    getByEntity,
    register,
    setStatus,
    findByCapability,
  };
}

module.exports = { createCapabilityRegistry };
