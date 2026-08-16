/**
 * Platform: Gives compute contracts exact fingerprints and paraphrase-friendly Position documents without treating either as entity identity.
 * Technical: Canonicalizes semantic manifest fields, hashes the exact contract, and writes bounded anchor postings through canonical persistence.
 */
"use strict";

const crypto = require("node:crypto");
const anchors = require("./anchors");

const SIGNATURE_VERSION = 1;
const EMBEDDING_MODEL = process.env.EMB_MODEL || "text-embedding-3-large";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function exactContractDocument(manifest = {}) {
  return stableValue({
    schemaVersion: Number(manifest.schemaVersion || 1),
    capabilityId: String(manifest.capabilityId || ""),
    name: String(manifest.name || ""),
    description: String(manifest.description || ""),
    execution: manifest.execution || null,
    operations: Array.isArray(manifest.operations) ? manifest.operations : [],
    implementationPolicyVersion: Number(manifest.implementationPolicyVersion || 1),
  });
}

function fieldSemanticText(kind, field = {}) {
  const hint = field.bindingHint || {};
  return [
    kind,
    field.name,
    field.type,
    field.required === false ? "optional" : "required",
    field.description,
    hint.source,
    hint.resolver,
    hint.subject,
    hint.property,
  ].filter(Boolean).join(" ");
}

function semanticCapabilityText(manifest = {}) {
  const rows = [
    `capability ${String(manifest.name || manifest.capabilityId || "compute")}`,
    String(manifest.description || ""),
  ];
  for (const operation of Array.isArray(manifest.operations) ? manifest.operations : []) {
    rows.push(`operation ${String(operation.operationId || "")} ${String(operation.description || "")}`);
    for (const input of Array.isArray(operation.inputs) ? operation.inputs : []) {
      rows.push(fieldSemanticText("input", input));
    }
    for (const output of Array.isArray(operation.outputs) ? operation.outputs : []) {
      rows.push(fieldSemanticText("output", output));
    }
    if (operation.calculation?.operator) {
      rows.push(`deterministic calculation ${operation.calculation.operator}`);
    }
    if (operation.freshness?.mode) rows.push(`freshness ${operation.freshness.mode}`);
    for (const requirement of Array.isArray(operation.protectedAssetRequirements)
      ? operation.protectedAssetRequirements : []) {
      rows.push([
        "protected requirement",
        requirement.assetType,
        requirement.providerId,
        requirement.purpose,
        requirement.use,
      ].filter(Boolean).join(" "));
    }
  }
  return rows.join("\n").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
}

function createCapabilitySignature(manifest) {
  const contract = exactContractDocument(manifest);
  return Object.freeze({
    schemaVersion: SIGNATURE_VERSION,
    algorithm: "sha256",
    contractHash: crypto.createHash("sha256").update(JSON.stringify(contract)).digest("hex"),
    semanticText: semanticCapabilityText(manifest),
  });
}

async function indexCapabilityManifest({ manifest, signature, persistence, s3, openai } = {}) {
  if (!manifest?.entityId || !persistence?.retrieval?.batchPut || !persistence?.foundation?.addresses ||
      !s3 || !openai?.embeddings?.create) {
    return { indexed: false, reason: "INDEX_DEPENDENCIES_UNAVAILABLE" };
  }
  const currentSignature = signature || createCapabilitySignature(manifest);
  if (!currentSignature.semanticText) return { indexed: false, reason: "EMPTY_SEMANTIC_DOCUMENT" };
  const addressResult = await persistence.foundation.addresses.byId(String(manifest.entityId));
  const address = addressResult?.Item || addressResult?.Items?.[0] || null;
  if (!address) return { indexed: false, reason: "ADDRESS_NOT_FOUND" };

  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: currentSignature.semanticText,
  });
  const embedding = embeddingResponse?.data?.[0]?.embedding;
  const unit = anchors.unit(embedding);
  if (!unit) throw new Error("capability signature embedding was invalid");
  const anchorSet = await anchors.loadAnchors({ s3 });
  const assigns = anchors.assign(unit, anchorSet, {
    topL0: Math.max(1, Math.min(4, Number(process.env.ANCHORS_TOP_L0 || 3))),
  });
  const owner = String(manifest.ownerId || "").replace(/^u:/, "");
  const isPublic = address.z === true || address.z === "true";
  const scopes = [owner || null, ...(isPublic ? [null] : [])];
  const postings = [];
  for (const userId of new Set(scopes)) {
    for (const assign of assigns) {
      postings.push({
        ...anchors.makePostingV2({
          setId: anchorSet.setId,
          su: String(manifest.entityId),
          assign,
          type: "capability",
          shards: anchorSet.num_shards,
          userId,
        }),
        capabilityContractHash: currentSignature.contractHash,
        capabilityVersion: Number(manifest.version || 1),
      });
    }
  }
  await persistence.retrieval.batchPut(postings);
  const position = {
    setId: anchorSet.setId,
    band_scale: anchorSet.band_scale,
    num_shards: anchorSet.num_shards,
    signatureVersion: currentSignature.schemaVersion,
    contractHash: currentSignature.contractHash,
    assigns: assigns.map(({ l0, l1, band, dist_q16 }) => ({ l0, l1, band, dist_q16 })),
  };
  await persistence.foundation.addresses.setPosition(String(manifest.entityId), position);
  return { indexed: true, postings: postings.length, position };
}

module.exports = {
  SIGNATURE_VERSION,
  stableValue,
  exactContractDocument,
  semanticCapabilityText,
  createCapabilitySignature,
  indexCapabilityManifest,
};
