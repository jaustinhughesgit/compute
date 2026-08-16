/**
 * Platform: Lets users reuse and evolve capability definitions without merging their installations or data.
 * Technical: DynamoDB registry for validated manifests, owner-scoped lookup, status changes, pagination, and legacy-record migration.
 */
"use strict";

const { CapabilityError, validateCapabilityManifest } = require("./capabilityManifest");
const { authorize } = require("../governance");
const { createCapabilitySignature, indexCapabilityManifest } = require("./capabilitySignature");
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
        const hint = input?.bindingHint && typeof input.bindingHint === "object"
          ? input.bindingHint
          : null;
        if (
          hint
          && String(hint.source || "").toLowerCase() !== "default"
          && Object.prototype.hasOwnProperty.call(hint, "value")
          && hint.value != null
        ) {
          const values = [
            hint.value,
            ...(Array.isArray(next.utteranceExamples) ? next.utteranceExamples : [])
              .map((example) => example && typeof example === "object" && !Array.isArray(example)
                ? example?.inputs?.[input.name]
                : null),
          ]
            .filter((value) => ["string", "number", "boolean"].includes(typeof value))
            .map((value) => String(value).trim())
            .filter(Boolean);
          if (values.length && !input?.validation?.pattern) {
            const alternatives = [...new Set(values)]
              .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            input.validation = {
              ...(input.validation && typeof input.validation === "object" ? input.validation : {}),
              pattern: `^(?:${alternatives.join("|")})$`,
            };
          }
          delete hint.value;
        }
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

function createCapabilityRegistry({ dynamodb, persistence = null, s3 = null, openai = null, tableName = DEFAULT_TABLE } = {}) {
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
    const signature = createCapabilitySignature(normalized);
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: entityId },
      UpdateExpression: [
        "SET #manifest = :manifest", "#capabilityId = :capabilityId",
        "#capabilityVersion = :capabilityVersion", "#capabilityStatus = :capabilityStatus",
        "#capabilityOwnerId = :capabilityOwnerId", "#capabilityUpdatedAt = :capabilityUpdatedAt",
        "#capabilitySignatureVersion = :capabilitySignatureVersion",
        "#capabilityContractHash = :capabilityContractHash",
      ].join(", "),
      ExpressionAttributeNames: {
        "#manifest": "computeCapability", "#capabilityId": "capabilityId",
        "#capabilityVersion": "capabilityVersion", "#capabilityStatus": "capabilityStatus",
        "#capabilityOwnerId": "capabilityOwnerId", "#capabilityUpdatedAt": "capabilityUpdatedAt",
        "#capabilitySignatureVersion": "capabilitySignatureVersion",
        "#capabilityContractHash": "capabilityContractHash",
      },
      ExpressionAttributeValues: {
        ":manifest": normalized, ":capabilityId": normalized.capabilityId,
        ":capabilityVersion": normalized.version, ":capabilityStatus": normalized.status,
        ":capabilityOwnerId": normalized.ownerId, ":capabilityUpdatedAt": now,
        ":capabilitySignatureVersion": signature.schemaVersion,
        ":capabilityContractHash": signature.contractHash,
      },
    }));
    try {
      await indexCapabilityManifest({ manifest: normalized, signature, persistence, s3, openai });
    } catch (error) {
      // Position is a rebuildable projection. Preserve the canonical manifest
      // and surface the indexing failure in logs for backfill/repair.
      console.warn("capability semantic indexing failed", {
        entityId,
        code: error?.code || "CAPABILITY_INDEX_FAILED",
        message: String(error?.message || error).slice(0, 300),
      });
    }
    return normalized;
  }

  async function filterAvailable(records, {
    ownerId = null,
    includeSystem = true,
  } = {}) {
    if (!ownerId) return records.map((record) => record.manifest);
    const actorId = String(ownerId);
    const owned = [];
    const governed = [];
    for (const record of records) {
      const manifest = record.manifest;
      if (manifest.ownerId === actorId || (includeSystem && manifest.ownerId === "system")) owned.push(manifest);
      else if (manifest.status === "active") governed.push(record);
    }
    const batchGetGrants = persistence?.authorization?.batchGetGrants;
    const grants = typeof batchGetGrants === "function" && governed.length
      ? await batchGetGrants(governed.flatMap(({ manifest }) => ([
          { entityID: String(manifest.entityId), principalID: actorId },
          { entityID: String(manifest.entityId), principalID: "pub" },
        ])))
      : [];
    const grantsByEntity = new Map();
    for (const grant of Array.isArray(grants) ? grants : []) {
      const entityId = String(grant?.entityID || grant?.resourceId || "");
      if (!entityId) continue;
      if (!grantsByEntity.has(entityId)) grantsByEntity.set(entityId, []);
      grantsByEntity.get(entityId).push(grant);
    }
    return owned.concat(governed.filter(({ manifest }) => authorize({
      actor: actorId,
      action: "use",
      resource: {
        id: manifest.entityId,
        ownerId: manifest.ownerId,
        version: manifest.version,
      },
      grants: grantsByEntity.get(String(manifest.entityId)) || [],
    }).allowed).map(({ manifest }) => manifest));
  }

  async function listAvailableByEntityIds(entityIds, options = {}) {
    const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [])
      .map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 500);
    if (!ids.length) return [];
    let rows;
    if (persistence?.foundation?.addresses?.batchGet) {
      rows = await persistence.foundation.addresses.batchGet(ids);
    } else {
      rows = await Promise.all(ids.map(getEntityRecord));
    }
    const byId = new Map((rows || []).filter(Boolean).map((row) => [String(row.su), row]));
    const records = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row?.computeCapability) continue;
      try {
        const manifest = validateCapabilityManifest(migrateStoredManifest(row.computeCapability), { entityId: row.su });
        if (options.activeOnly !== false && manifest.status !== "active") continue;
        if (Number(manifest.implementationPolicyVersion || 1) < Number(options.minimumImplementationPolicyVersion || 1)) continue;
        records.push({ manifest, row });
      } catch (_) {}
    }
    const available = await filterAvailable(records, options);
    return available.sort((a, b) => ids.indexOf(String(a.entityId)) - ids.indexOf(String(b.entityId)))
      .slice(0, Math.max(1, Math.min(500, Number(options.limit || ids.length))));
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
    const candidates = [];
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
          if (Number(manifest.implementationPolicyVersion || 1) < Number(minimumImplementationPolicyVersion)) continue;
          if (!activeOnly || manifest.status === "active") candidates.push({ manifest, row: item });
        } catch (_) {}
        if (!ownerId && candidates.length >= limit) break;
      }
      ExclusiveStartKey = !ownerId && candidates.length >= limit ? null : data?.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    const matches = await filterAvailable(candidates, { ownerId, includeSystem });
    return matches.sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || b.version - a.version
    ).slice(0, limit);
  }

  return {
    getEntityRecord,
    getByEntity,
    register,
    setStatus,
    listAvailableByEntityIds,
    findByCapability: (capabilityId, options = {}) => scanManifests({ ...options, capabilityId, limit: Number(options.limit || 25) }),
    listAvailable: (options = {}) => scanManifests(options),
  };
}

module.exports = { createCapabilityRegistry, migrateStoredManifest };
