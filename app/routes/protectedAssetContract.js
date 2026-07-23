"use strict";

const crypto = require("node:crypto");

const PROTECTED_ASSET_SCHEMA_VERSION = 1;
const ASSET_TYPES = new Set([
  "credential",
  "identity_data",
  "contact_data",
  "location",
  "private_document",
  "private_note",
  "access_token",
  "encryption_key",
  "arbitrary_secret",
]);
const ALLOWED_USES = new Set([
  "authenticate",
  "inject",
  "reveal",
  "compare",
  "send",
  "share",
  "derive",
]);
const APPROVAL_MODES = new Set(["every_use", "session", "preapproved"]);
const ENVELOPE_ALGORITHMS = new Set(["A256GCM"]);
const WRAP_ALGORITHMS = new Set(["ECDH-ES+A256KW", "RSA-OAEP-256"]);
const SAFE_ID = /^[a-z][a-z0-9_.-]{1,127}$/;
const ASSET_ID = /^pa_[a-zA-Z0-9_-]{16,160}$/;
const FORBIDDEN_METADATA_KEYS = /^(?:value|plaintext|plain|secret|password|token|api[_-]?key|private[_-]?key|ciphertext|wrappedkey)$/i;

class ProtectedAssetError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ProtectedAssetError";
    this.code = code || "PROTECTED_ASSET_ERROR";
    this.details = details;
  }
}

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function canonicalId(value, label) {
  const id = String(value || "").trim().toLowerCase();
  if (!SAFE_ID.test(id)) {
    throw new ProtectedAssetError("INVALID_ASSET_CONTRACT", `${label} is invalid`);
  }
  return id;
}

function stringList(value, { max = 100, lower = false } = {}) {
  const list = Array.isArray(value) ? value : [];
  return Array.from(new Set(list
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => lower ? item.toLowerCase() : item)))
    .slice(0, max);
}

function assertSafeMetadata(value, path = "metadata", depth = 0) {
  if (depth > 8) throw new ProtectedAssetError("INVALID_ASSET_METADATA", `${path} is too deeply nested`);
  if (value == null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ProtectedAssetError("INVALID_ASSET_METADATA", `${path} contains an invalid number`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > 2000) throw new ProtectedAssetError("INVALID_ASSET_METADATA", `${path} contains an oversized value`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new ProtectedAssetError("INVALID_ASSET_METADATA", `${path} contains too many values`);
    value.forEach((item, index) => assertSafeMetadata(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isObject(value)) throw new ProtectedAssetError("INVALID_ASSET_METADATA", `${path} contains a non-JSON value`);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_METADATA_KEYS.test(key)) {
      throw new ProtectedAssetError("PLAINTEXT_METADATA_REJECTED", `${path}.${key} is not safe metadata`);
    }
    assertSafeMetadata(child, `${path}.${key}`, depth + 1);
  }
}

function normalizeDestination(raw, label = "destination") {
  const destination = isObject(raw) ? raw : {};
  const host = String(destination.host || destination.domain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || !/^[a-z0-9.-]+$/.test(host) || host === "localhost" || host.endsWith(".local")) {
    throw new ProtectedAssetError("INVALID_ASSET_POLICY", `${label} host is invalid`);
  }
  const methods = stringList(destination.methods || ["GET"], { max: 10, lower: false })
    .map((method) => method.toUpperCase());
  if (methods.some((method) => !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))) {
    throw new ProtectedAssetError("INVALID_ASSET_POLICY", `${label} contains an unsupported method`);
  }
  const pathPrefixes = stringList(destination.pathPrefixes || ["/"], { max: 25 });
  if (pathPrefixes.some((path) => !path.startsWith("/") || path.includes(".."))) {
    throw new ProtectedAssetError("INVALID_ASSET_POLICY", `${label} pathPrefixes are invalid`);
  }
  return { host, methods, pathPrefixes };
}

function normalizePolicy(raw = {}) {
  const policy = isObject(raw) ? raw : {};
  const allowedUses = stringList(policy.allowedUses || [], { max: 20, lower: true });
  if (!allowedUses.length || allowedUses.some((use) => !ALLOWED_USES.has(use))) {
    throw new ProtectedAssetError("INVALID_ASSET_POLICY", "policy.allowedUses is invalid");
  }
  const approvalMode = String(policy.approvalMode || "every_use").trim().toLowerCase();
  if (!APPROVAL_MODES.has(approvalMode)) {
    throw new ProtectedAssetError("INVALID_ASSET_POLICY", "policy.approvalMode is invalid");
  }
  return {
    allowedUses,
    destinations: (Array.isArray(policy.destinations) ? policy.destinations : [])
      .map((item, index) => normalizeDestination(item, `destination ${index}`)),
    capabilityIds: stringList(policy.capabilityIds, { max: 100, lower: true }),
    moduleIds: stringList(policy.moduleIds, { max: 100, lower: true }),
    approvalMode,
    unattendedAutomation: policy.unattendedAutomation === true,
    expiresAt: policy.expiresAt ? new Date(policy.expiresAt).toISOString() : null,
    maxUses: Number.isInteger(Number(policy.maxUses)) && Number(policy.maxUses) > 0
      ? Number(policy.maxUses)
      : null,
    redaction: {
      revealLast: Math.max(0, Math.min(8, Number(policy.redaction?.revealLast || 0))),
      label: String(policy.redaction?.label || "Protected").trim().slice(0, 80),
    },
  };
}

function normalizeFields(rawFields) {
  const fields = Array.isArray(rawFields) ? rawFields : [];
  if (!fields.length || fields.length > 32) {
    throw new ProtectedAssetError("INVALID_ASSET_CONTRACT", "asset fields must contain 1 to 32 entries");
  }
  const seen = new Set();
  return fields.map((raw, index) => {
    const field = isObject(raw) ? raw : {};
    const name = canonicalId(field.name, `field ${index} name`);
    if (seen.has(name)) throw new ProtectedAssetError("INVALID_ASSET_CONTRACT", `duplicate asset field ${name}`);
    seen.add(name);
    return {
      name,
      type: String(field.type || "string").trim().toLowerCase(),
      required: field.required !== false,
      validation: isObject(field.validation) ? clone(field.validation) : null,
      displayLabel: String(field.displayLabel || name.replace(/[_.-]+/g, " ")).trim().slice(0, 120),
    };
  });
}

function normalizeProtectedAssetMetadata(raw, { ownerId } = {}) {
  if (!isObject(raw)) throw new ProtectedAssetError("INVALID_ASSET_METADATA", "metadata must be an object");
  assertSafeMetadata(raw);
  const assetType = String(raw.assetType || "arbitrary_secret").trim().toLowerCase();
  if (!ASSET_TYPES.has(assetType)) {
    throw new ProtectedAssetError("INVALID_ASSET_CONTRACT", `unsupported asset type ${assetType}`);
  }
  const normalizedOwner = String(ownerId || raw.ownerId || "").trim();
  if (!normalizedOwner) throw new ProtectedAssetError("INVALID_ASSET_CONTRACT", "asset owner is required");
  return {
    schemaVersion: PROTECTED_ASSET_SCHEMA_VERSION,
    label: String(raw.label || "Protected asset").trim().slice(0, 160),
    assetType,
    ownerId: normalizedOwner,
    subjectId: String(raw.subjectId || normalizedOwner).trim().slice(0, 160),
    providerId: raw.providerId ? canonicalId(raw.providerId, "providerId") : null,
    providerHost: raw.providerHost ? String(raw.providerHost).trim().toLowerCase().slice(0, 255) : null,
    fields: normalizeFields(raw.fields),
    policy: normalizePolicy(raw.policy),
    lifecycle: {
      expiresAt: raw.lifecycle?.expiresAt ? new Date(raw.lifecycle.expiresAt).toISOString() : null,
      rotationDays: Number.isInteger(Number(raw.lifecycle?.rotationDays)) && Number(raw.lifecycle.rotationDays) > 0
        ? Number(raw.lifecycle.rotationDays)
        : null,
      recoverable: raw.lifecycle?.recoverable === true,
    },
    tags: stringList(raw.tags, { max: 50, lower: true }),
  };
}

function assertB64Url(value, label, { min = 16, max = 2_000_000 } = {}) {
  const text = String(value || "");
  if (text.length < min || text.length > max || !/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new ProtectedAssetError("INVALID_ASSET_ENVELOPE", `${label} is invalid`);
  }
  return text;
}

function normalizeWrap(raw, label) {
  if (!isObject(raw)) throw new ProtectedAssetError("INVALID_ASSET_ENVELOPE", `${label} must be an object`);
  const algorithm = String(raw.algorithm || "").trim();
  if (!WRAP_ALGORITHMS.has(algorithm)) {
    throw new ProtectedAssetError("INVALID_ASSET_ENVELOPE", `${label} algorithm is unsupported`);
  }
  return {
    algorithm,
    keyId: String(raw.keyId || "").trim().slice(0, 512),
    ephemeralPublicKey: raw.ephemeralPublicKey
      ? assertB64Url(raw.ephemeralPublicKey, `${label}.ephemeralPublicKey`, { min: 40, max: 2048 })
      : null,
    iv: raw.iv ? assertB64Url(raw.iv, `${label}.iv`, { min: 12, max: 64 }) : null,
    salt: raw.salt ? assertB64Url(raw.salt, `${label}.salt`, { min: 20, max: 128 }) : null,
    wrappedKey: assertB64Url(raw.wrappedKey, `${label}.wrappedKey`, { min: 16, max: 8192 }),
  };
}

function normalizeProtectedAssetEnvelope(raw) {
  if (!isObject(raw)) throw new ProtectedAssetError("INVALID_ASSET_ENVELOPE", "envelope must be an object");
  const algorithm = String(raw.algorithm || "").trim();
  if (!ENVELOPE_ALGORITHMS.has(algorithm)) {
    throw new ProtectedAssetError("INVALID_ASSET_ENVELOPE", "envelope algorithm is unsupported");
  }
  const wraps = isObject(raw.keyWraps) ? raw.keyWraps : {};
  const user = isObject(wraps.user)
    ? Object.fromEntries(Object.entries(wraps.user).slice(0, 100).map(([id, wrap]) => [String(id), normalizeWrap(wrap, `user wrap ${id}`)]))
    : {};
  const executor = wraps.executor ? normalizeWrap(wraps.executor, "executor wrap") : null;
  if (!Object.keys(user).length && !executor) {
    throw new ProtectedAssetError("INVALID_ASSET_ENVELOPE", "at least one key wrap is required");
  }
  return {
    schemaVersion: PROTECTED_ASSET_SCHEMA_VERSION,
    algorithm,
    iv: assertB64Url(raw.iv, "envelope.iv", { min: 12, max: 64 }),
    ciphertext: assertB64Url(raw.ciphertext, "envelope.ciphertext"),
    aad: assertB64Url(raw.aad, "envelope.aad", { min: 8, max: 8192 }),
    keyWraps: { user, executor },
  };
}

function normalizeProtectedAssetRequirement(raw, { capabilityId = null, operationId = null } = {}) {
  if (!isObject(raw)) throw new ProtectedAssetError("INVALID_ASSET_REQUIREMENT", "protected asset requirement must be an object");
  const use = String(raw.use || "inject").trim().toLowerCase();
  if (!ALLOWED_USES.has(use)) throw new ProtectedAssetError("INVALID_ASSET_REQUIREMENT", `unsupported asset use ${use}`);
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).map((field, index) => {
    if (!isObject(field)) throw new ProtectedAssetError("INVALID_ASSET_REQUIREMENT", `requirement field ${index} must be an object`);
    const location = String(field.injection?.location || "").trim().toLowerCase();
    if (!["query", "header", "body"].includes(location)) {
      throw new ProtectedAssetError("INVALID_ASSET_REQUIREMENT", `requirement field ${index} injection location is invalid`);
    }
    const parameter = String(field.injection?.parameter || "").trim();
    if (!parameter || parameter.length > 128 || /[\r\n]/.test(parameter)) {
      throw new ProtectedAssetError("INVALID_ASSET_REQUIREMENT", `requirement field ${index} injection parameter is invalid`);
    }
    return {
      name: canonicalId(field.name, `requirement field ${index} name`),
      required: field.required !== false,
      injection: {
        location,
        parameter,
        prefix: String(field.injection?.prefix || "").slice(0, 80),
      },
    };
  });
  if (!fields.length) throw new ProtectedAssetError("INVALID_ASSET_REQUIREMENT", "protected asset requirement must declare fields");
  return {
    schemaVersion: PROTECTED_ASSET_SCHEMA_VERSION,
    requirementId: canonicalId(raw.requirementId, "requirementId"),
    assetType: String(raw.assetType || "credential").trim().toLowerCase(),
    providerId: raw.providerId ? canonicalId(raw.providerId, "providerId") : null,
    providerName: String(raw.providerName || raw.providerId || "provider").trim().slice(0, 160),
    providerHost: String(raw.providerHost || "").trim().toLowerCase().slice(0, 255),
    purpose: String(raw.purpose || `${capabilityId || "capability"}.${operationId || "operation"}`).trim().slice(0, 300),
    use,
    approvalMode: String(raw.approvalMode || "every_use").trim().toLowerCase(),
    acquisition: isObject(raw.acquisition) ? clone(raw.acquisition) : null,
    fields,
  };
}

function newProtectedAssetId() {
  return `pa_${crypto.randomUUID().replace(/-/g, "")}`;
}

function normalizeProtectedAssetReference(value) {
  const raw = String(value || "").trim();
  const id = raw.startsWith("protected_asset:") ? raw.slice("protected_asset:".length) : raw;
  if (!ASSET_ID.test(id)) {
    throw new ProtectedAssetError("INVALID_ASSET_REFERENCE", "protected asset reference is invalid");
  }
  return { assetId: id, reference: `protected_asset:${id}` };
}

function policyAllowsUse(metadata, request, now = Date.now()) {
  const policy = metadata?.policy || {};
  const use = String(request?.use || "").toLowerCase();
  if (!policy.allowedUses?.includes(use)) return { allowed: false, reason: "use_not_allowed" };
  if (policy.expiresAt && Date.parse(policy.expiresAt) <= now) return { allowed: false, reason: "policy_expired" };
  if (metadata?.lifecycle?.expiresAt && Date.parse(metadata.lifecycle.expiresAt) <= now) return { allowed: false, reason: "asset_expired" };
  if (request?.unattended === true && policy.unattendedAutomation !== true) {
    return { allowed: false, reason: "unattended_not_allowed" };
  }
  if (policy.capabilityIds?.length && !policy.capabilityIds.includes(String(request?.capabilityId || "").toLowerCase())) {
    return { allowed: false, reason: "capability_not_allowed" };
  }
  if (policy.moduleIds?.length && !policy.moduleIds.includes(String(request?.moduleId || "").toLowerCase())) {
    return { allowed: false, reason: "module_not_allowed" };
  }
  if (request?.destinationHost && policy.destinations?.length) {
    const host = String(request.destinationHost).toLowerCase();
    const method = String(request.method || "GET").toUpperCase();
    const path = String(request.path || "/");
    const destination = policy.destinations.find((item) =>
      item.host === host &&
      item.methods.includes(method) &&
      item.pathPrefixes.some((prefix) => path.startsWith(prefix))
    );
    if (!destination) return { allowed: false, reason: "destination_not_allowed" };
  }
  if (policy.approvalMode === "every_use" && request?.approved !== true) {
    return { allowed: false, reason: "approval_required" };
  }
  return { allowed: true, reason: "allowed" };
}

module.exports = {
  PROTECTED_ASSET_SCHEMA_VERSION,
  ProtectedAssetError,
  normalizeProtectedAssetMetadata,
  normalizeProtectedAssetEnvelope,
  normalizeProtectedAssetRequirement,
  normalizeProtectedAssetReference,
  newProtectedAssetId,
  policyAllowsUse,
  assertSafeMetadata,
};
