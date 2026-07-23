"use strict";

const { CapabilityError, validateCapabilityManifest } = require("./capabilityManifest");
const DEFAULT_TABLE = process.env.SUBDOMAINS_TABLE || "subdomains";

const promiseOf = (request) => request && typeof request.promise === "function" ? request.promise() : request;

function migrateStoredManifest(raw) {
  const manifest = JSON.parse(JSON.stringify(raw || {}));
  manifest.operations = (Array.isArray(manifest.operations) ? manifest.operations : []).map((operation) => {
    const next = { ...operation };
    const legacyContracts = Array.isArray(next.pathContracts) ? next.pathContracts : [];
    if (!next.answerTemplate) {
      next.answerTemplate = String(legacyContracts.find((item) => item?.answerTemplate)?.answerTemplate || "").trim() || undefined;
    }
    delete next.pathContracts;
    delete next.pattern;
    delete next.signatureSlots;
    delete next.expectedLocalSignature;

    // Legacy credential inputs are intentionally not migrated as plaintext
    // inputs. Convert their metadata into purpose-bound asset requirements.
    const ordinaryInputs = [];
    const requirements = Array.isArray(next.protectedAssetRequirements)
      ? [...next.protectedAssetRequirements]
      : [];
    for (const input of Array.isArray(next.inputs) ? next.inputs : []) {
      if (!input?.credential) {
        ordinaryInputs.push(input);
        continue;
      }
      const credential = input.credential;
      const requirementId = credential.requirementId || `${credential.providerId || "provider"}_credentials`;
      let requirement = requirements.find((item) => item.requirementId === requirementId);
      if (!requirement) {
        requirement = {
          schemaVersion: 1,
          requirementId,
          assetType: "credential",
          providerId: credential.providerId,
          providerName: credential.providerName,
          providerHost: credential.providerHost,
          purpose: `${manifest.capabilityId || "capability"}.${next.operationId || "operation"}`,
          use: "inject",
          approvalMode: credential.consentRequired ? "every_use" : "session",
          required: input.required !== false,
          acquisition: credential.acquisition || null,
          fields: [],
        };
        requirements.push(requirement);
      }
      requirement.fields.push({
        name: input.name,
        required: input.required !== false,
        injection: credential.injection,
      });
    }
    next.inputs = ordinaryInputs;
    next.protectedAssetRequirements = requirements;
    return next;
  });
  return manifest;
}

function createCapabilityRegistry({ dynamodb, tableName = DEFAULT_TABLE } = {}) {
  if (!dynamodb) throw new Error("capability registry requires a DynamoDB DocumentClient");

  async function getEntityRecord(entityId) {
    const id = String(entityId || "").trim();
    if (!id) return null;
    return (await promiseOf(dynamodb.get({ TableName: tableName, Key: { su: id } })))?.Item || null;
  }

  async function getByEntity(entityId, { includeInactive = true } = {}) {
    const item = await getEntityRecord(entityId);
    if (!item?.computeCapability) return null;
    const manifest = validateCapabilityManifest(migrateStoredManifest(item.computeCapability), { entityId: item.su });
    return !includeInactive && manifest.status !== "active" ? null : manifest;
  }

  async function register(rawManifest, { ownerId = "system", allowOwnerOverride = false } = {}) {
    const entityId = String(rawManifest?.entityId || "").trim();
    const existing = await getEntityRecord(entityId);
    if (!existing) throw new CapabilityError("ENTITY_NOT_FOUND", `Compute entity ${entityId || "(blank)"} does not exist`);
    const existingOwner = existing.capabilityOwnerId != null ? String(existing.capabilityOwnerId) : null;
    const caller = String(ownerId || "system");
    if (existingOwner && existingOwner !== caller && !allowOwnerOverride) {
      throw new CapabilityError("PERMISSION_DENIED", "Only the capability owner may replace its manifest");
    }
    const now = new Date().toISOString();
    const normalized = validateCapabilityManifest(rawManifest, {
      entityId,
      ownerId: existingOwner || caller,
    });
    normalized.createdAt = String(existing.computeCapability?.createdAt || normalized.createdAt || now);
    normalized.updatedAt = now;
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: entityId },
      UpdateExpression: [
        "SET #manifest = :manifest", "#capabilityId = :capabilityId",
        "#capabilityVersion = :capabilityVersion", "#capabilityStatus = :capabilityStatus",
        "#capabilityOwnerId = :capabilityOwnerId", "#capabilityUpdatedAt = :capabilityUpdatedAt",
      ].join(", "),
      ExpressionAttributeNames: {
        "#manifest": "computeCapability", "#capabilityId": "capabilityId",
        "#capabilityVersion": "capabilityVersion", "#capabilityStatus": "capabilityStatus",
        "#capabilityOwnerId": "capabilityOwnerId", "#capabilityUpdatedAt": "capabilityUpdatedAt",
      },
      ExpressionAttributeValues: {
        ":manifest": normalized, ":capabilityId": normalized.capabilityId,
        ":capabilityVersion": normalized.version, ":capabilityStatus": normalized.status,
        ":capabilityOwnerId": normalized.ownerId, ":capabilityUpdatedAt": now,
      },
    }));
    return normalized;
  }

  async function setStatus(entityId, status, { ownerId = "system", allowOwnerOverride = false } = {}) {
    const item = await getEntityRecord(entityId);
    if (!item?.computeCapability) throw new CapabilityError("CAPABILITY_NOT_FOUND", `No capability is registered for entity ${entityId}`);
    const existingOwner = String(item.capabilityOwnerId || item.computeCapability.ownerId || "system");
    if (existingOwner !== String(ownerId) && !allowOwnerOverride) {
      throw new CapabilityError("PERMISSION_DENIED", "Only the capability owner may change its status");
    }
    const manifest = validateCapabilityManifest({ ...migrateStoredManifest(item.computeCapability), status }, {
      entityId: item.su,
      ownerId: existingOwner,
    });
    return register(manifest, { ownerId, allowOwnerOverride });
  }

  async function scanManifests({
    capabilityId = null,
    activeOnly = true,
    limit = 100,
    ownerId = null,
    includeSystem = true,
    minimumImplementationPolicyVersion = 1,
  } = {}) {
    const matches = [];
    let ExclusiveStartKey;
    do {
      const names = { "#capabilityId": "capabilityId" };
      const params = capabilityId ? {
        TableName: tableName,
        FilterExpression: "#capabilityId = :capabilityId",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ":capabilityId": String(capabilityId).toLowerCase() },
        ExclusiveStartKey,
      } : {
        TableName: tableName,
        FilterExpression: "attribute_exists(#capabilityId)",
        ExpressionAttributeNames: names,
        ExclusiveStartKey,
      };
      const data = await promiseOf(dynamodb.scan(params));
      for (const item of data?.Items || []) {
        if (!item?.computeCapability) continue;
        try {
          const manifest = validateCapabilityManifest(migrateStoredManifest(item.computeCapability), { entityId: item.su });
          if (ownerId && manifest.ownerId !== String(ownerId) && !(includeSystem && manifest.ownerId === "system")) continue;
          if (Number(manifest.implementationPolicyVersion || 1) < Number(minimumImplementationPolicyVersion)) continue;
          if (!activeOnly || manifest.status === "active") matches.push(manifest);
        } catch (_) {}
        if (matches.length >= limit) break;
      }
      ExclusiveStartKey = matches.length >= limit ? null : data?.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return matches.sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || b.version - a.version
    ).slice(0, limit);
  }

  return {
    getEntityRecord,
    getByEntity,
    register,
    setStatus,
    findByCapability: (capabilityId, options = {}) => scanManifests({ ...options, capabilityId, limit: Number(options.limit || 25) }),
    listAvailable: (options = {}) => scanManifests(options),
  };
}

module.exports = { createCapabilityRegistry, migrateStoredManifest };
