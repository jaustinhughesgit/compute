"use strict";

const {
  ProtectedAssetError,
  normalizeProtectedAssetRequirement,
} = require("./protectedAssetContract");

const CAPABILITY_SCHEMA_VERSION = 1;
const IMPLEMENTATION_POLICY_VERSION = 7;
const CAPABILITY_STATUSES = new Set(["testing", "active", "disabled", "failed"]);
const EXECUTION_TYPES = new Set(["remote", "local"]);
const VALUE_TYPES = new Set([
  "string", "number", "integer", "boolean", "date", "datetime",
  "object", "array", "file", "any",
]);
const BINDING_SOURCES = new Set(["utterance", "contextdb", "environment", "default"]);

class CapabilityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "CapabilityError";
    this.code = code || "CAPABILITY_ERROR";
    this.details = details;
  }
}

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function requireObject(value, name) {
  if (!isObject(value)) throw new CapabilityError("INVALID_MANIFEST", `${name} must be an object`);
  return value;
}

function normalizeId(value, name) {
  const id = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(id)) {
    throw new CapabilityError("INVALID_MANIFEST", `${name} is invalid`);
  }
  return id;
}

function canonicalizeGeneratedIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_ .-]+|[_ .-]+$/g, "");
}

function normalizeBindingHint(raw, inputName) {
  if (raw == null) return null;
  const hint = requireObject(raw, `input ${inputName} bindingHint`);
  const source = String(hint.source || "").trim().toLowerCase();
  if (!BINDING_SOURCES.has(source)) {
    throw new CapabilityError("INVALID_MANIFEST", `input ${inputName} has unsupported binding source ${source || "(blank)"}`);
  }
  const normalized = { source };
  if (hint.subject != null) normalized.subject = String(hint.subject).trim();
  if (hint.property != null) normalized.property = String(hint.property).trim();
  if (hint.resolver != null) normalized.resolver = String(hint.resolver).trim();
  if (hint.value != null) normalized.value = clone(hint.value);
  if (Array.isArray(hint.aliases)) normalized.aliases = hint.aliases.map(String).filter(Boolean).slice(0, 25);
  if (source === "contextdb" && (!normalized.subject || !normalized.property)) {
    throw new CapabilityError("INVALID_MANIFEST", `input ${inputName} contextdb binding requires subject and property`);
  }
  return normalized;
}

function normalizeValueField(raw, kind) {
  const field = requireObject(raw, `${kind} field`);
  const name = normalizeId(field.name, `${kind} name`);
  const type = String(field.type || "").trim().toLowerCase();
  if (!VALUE_TYPES.has(type)) {
    throw new CapabilityError("INVALID_MANIFEST", `${kind} ${name} has unsupported type ${type || "(blank)"}`);
  }
  const normalized = { name, type, required: field.required !== false };
  if (field.description != null) normalized.description = String(field.description).trim().slice(0, 1000);
  if (Object.prototype.hasOwnProperty.call(field, "defaultValue")) normalized.defaultValue = clone(field.defaultValue);
  if (field.validation != null) normalized.validation = clone(requireObject(field.validation, `${kind} ${name} validation`));
  if (kind === "input") {
    if (field.sensitive === true || field.credential != null) {
      throw new CapabilityError(
        "PLAINTEXT_ASSET_INPUT_FORBIDDEN",
        `input ${name} may not carry a credential or protected value; declare protectedAssetRequirements instead`
      );
    }
    normalized.bindingHint = normalizeBindingHint(field.bindingHint, name);
    if (field.clarification != null) normalized.clarification = String(field.clarification).trim().slice(0, 500);
  }
  return normalized;
}

function validateFieldValue(field, value, label) {
  const type = field.type;
  const matches = type === "any"
    || (["string", "date", "datetime", "file"].includes(type) && typeof value === "string")
    || (type === "number" && typeof value === "number" && Number.isFinite(value))
    || (type === "integer" && Number.isInteger(value))
    || (type === "boolean" && typeof value === "boolean")
    || (type === "array" && Array.isArray(value))
    || (type === "object" && isObject(value));
  if (!matches) {
    throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} must be ${type}`, {
      field: field.name,
      expectedType: type,
    });
  }
  const rules = field.validation || {};
  if (typeof value === "string") {
    if (rules.minLength != null && value.length < Number(rules.minLength)) {
      throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} is too short`, { field: field.name });
    }
    if (rules.maxLength != null && value.length > Number(rules.maxLength)) {
      throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} is too long`, { field: field.name });
    }
    if (rules.pattern) {
      let pattern;
      try { pattern = new RegExp(String(rules.pattern)); } catch (_) {
        throw new CapabilityError("INVALID_MANIFEST", `${label} ${field.name} has an invalid validation pattern`);
      }
      if (!pattern.test(value)) throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} has an invalid format`);
    }
  }
}

function canonicalizeGeneratedOperations(rawOperations) {
  const typeAliases = new Map([
    ["text", "string"], ["enum", "string"], ["location", "string"],
    ["float", "number"], ["double", "number"], ["decimal", "number"],
    ["int", "integer"], ["bool", "boolean"], ["json", "object"],
    ["map", "object"], ["list", "array"], ["timestamp", "datetime"],
  ]);
  const sourceAliases = new Map([
    ["context", "contextdb"], ["context_db", "contextdb"], ["memory", "contextdb"],
    ["speech", "utterance"], ["query", "utterance"], ["user_input", "utterance"],
    ["env", "environment"], ["constant", "default"], ["literal", "default"],
  ]);
  return (Array.isArray(rawOperations) ? rawOperations : []).map((rawOperation, operationIndex) => {
    const operation = clone(rawOperation || {});
    operation.operationId = canonicalizeGeneratedIdentifier(operation.operationId || operation.id || operation.name);
    if (operation.operationId.length < 2) operation.operationId = `operation_${operationIndex + 1}`;
    const names = new Map();
    for (const collection of ["inputs", "outputs"]) {
      operation[collection] = (Array.isArray(operation[collection]) ? operation[collection] : []).map((raw, index) => {
        const field = clone(raw || {});
        const original = String(field.name || field.id || field.key || field.label || "").trim();
        field.name = canonicalizeGeneratedIdentifier(original) || `${collection === "inputs" ? "input" : "output"}_${index + 1}`;
        if (original) {
          names.set(original, field.name);
          names.set(original.toLowerCase(), field.name);
        }
        const type = String(field.type || "").toLowerCase();
        field.type = typeAliases.get(type) || type;
        if (isObject(field.bindingHint)) {
          const source = String(field.bindingHint.source || "").toLowerCase();
          field.bindingHint.source = sourceAliases.get(source) || source;
        }
        return field;
      });
    }
    operation.utteranceExamples = (operation.utteranceExamples || []).map((example) => {
      if (!isObject(example) || !isObject(example.inputs)) return example;
      return {
        ...example,
        inputs: Object.fromEntries(Object.entries(example.inputs).map(([name, value]) => [
          names.get(name) || names.get(name.toLowerCase()) || canonicalizeGeneratedIdentifier(name),
          value,
        ])),
      };
    });
    if (operation.answerTemplate != null) {
      operation.answerTemplate = String(operation.answerTemplate).replace(
        /{{\s*([^}|]+)([^}]*)}}/g,
        (whole, rawName, suffix) => {
          const name = String(rawName).trim();
          const canonical = names.get(name) || names.get(name.toLowerCase());
          return canonical ? `{{${canonical}${suffix}}}` : whole;
        }
      ).replace(
        /\{(?!\{)\s*([a-zA-Z0-9_.-]+)\s*\}(?!\})/g,
        (whole, rawName) => {
          const name = String(rawName).trim();
          const canonical = names.get(name) || names.get(name.toLowerCase());
          return canonical ? `{{${canonical}}}` : whole;
        }
      );
    }
    return operation;
  });
}

function normalizeOperation(raw, capabilityId = null) {
  const operation = requireObject(raw, "operation");
  const operationId = normalizeId(operation.operationId, "operationId");
  const inputs = Array.isArray(operation.inputs) ? operation.inputs.map((field) => normalizeValueField(field, "input")) : [];
  const outputs = Array.isArray(operation.outputs) ? operation.outputs.map((field) => normalizeValueField(field, "output")) : [];
  const protectedAssetRequirements = (Array.isArray(operation.protectedAssetRequirements)
    ? operation.protectedAssetRequirements
    : []).map((requirement) => {
      try {
        return {
          ...normalizeProtectedAssetRequirement(requirement, { capabilityId, operationId }),
          required: requirement.required !== false,
        };
      } catch (error) {
        if (error instanceof ProtectedAssetError) {
          throw new CapabilityError("INVALID_MANIFEST", error.message, error.details);
        }
        throw error;
      }
    });
  const ensureUnique = (items, label, key = "name") => {
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item[key])) throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} contains duplicate ${label} ${item[key]}`);
      seen.add(item[key]);
    }
  };
  ensureUnique(inputs, "input");
  ensureUnique(outputs, "output");
  ensureUnique(protectedAssetRequirements, "protected asset requirement", "requirementId");
  if (!outputs.length) throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} must declare at least one output`);

  const normalized = {
    operationId,
    description: String(operation.description || "").trim(),
    inputs,
    outputs,
    protectedAssetRequirements,
  };
  if (isObject(operation.freshness)) {
    const ttlSeconds = Number(operation.freshness.ttlSeconds || 0);
    normalized.freshness = {
      mode: String(operation.freshness.mode || (ttlSeconds > 0 ? "cache" : "none")),
      ttlSeconds: Number.isFinite(ttlSeconds) && ttlSeconds >= 0 ? Math.floor(ttlSeconds) : 0,
    };
  }
  if (Array.isArray(operation.utteranceExamples)) {
    normalized.utteranceExamples = operation.utteranceExamples.map((example) => {
      if (typeof example === "string") return example.trim();
      if (!isObject(example)) return null;
      const text = String(example.text || example.utterance || "").trim();
      const sampleInputs = isObject(example.inputs) ? example.inputs : {};
      const inputMap = new Map(inputs.map((input) => [input.name, input]));
      const values = {};
      for (const [name, value] of Object.entries(sampleInputs)) {
        const input = inputMap.get(String(name).toLowerCase());
        if (!input) throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} example references unknown input ${name}`);
        validateFieldValue(input, value, "example input");
        values[input.name] = clone(value);
      }
      return text ? { text, inputs: values } : null;
    }).filter(Boolean).slice(0, 40);
  }
  if (operation.pathContracts != null || operation.pattern != null || operation.signatureSlots != null) {
    throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} contains browser-owned Path fields`);
  }
  if (operation.answerTemplate != null) {
    const template = String(operation.answerTemplate).trim();
    if (!template || template.length > 1500) throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} has an invalid answerTemplate`);
    const declared = new Set([...inputs, ...outputs].map((field) => field.name));
    for (const match of template.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
      if (!declared.has(match[1])) throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} answerTemplate references undeclared value ${match[1]}`);
    }
    normalized.answerTemplate = template;
  }
  return normalized;
}

function validateCapabilityManifest(raw, options = {}) {
  const manifest = requireObject(raw, "capability manifest");
  if (Number(manifest.schemaVersion) !== CAPABILITY_SCHEMA_VERSION) {
    throw new CapabilityError("UNSUPPORTED_MANIFEST_VERSION", `capability manifest schemaVersion must be ${CAPABILITY_SCHEMA_VERSION}`);
  }
  const capabilityId = normalizeId(manifest.capabilityId, "capabilityId");
  const entityId = String(options.entityId || manifest.entityId || "").trim();
  if (!entityId) throw new CapabilityError("INVALID_MANIFEST", "entityId is required");
  const version = Number(manifest.version);
  if (!Number.isInteger(version) || version < 1) throw new CapabilityError("INVALID_MANIFEST", "version must be a positive integer");
  const status = String(manifest.status || "testing").toLowerCase();
  if (!CAPABILITY_STATUSES.has(status)) throw new CapabilityError("INVALID_MANIFEST", `unsupported capability status ${status}`);
  const execution = isObject(manifest.execution) ? manifest.execution : {};
  const type = String(execution.type || "remote").toLowerCase();
  const timeoutMs = Number(execution.timeoutMs || 10000);
  if (!EXECUTION_TYPES.has(type) || !Number.isFinite(timeoutMs) || timeoutMs < 250 || timeoutMs > 120000) {
    throw new CapabilityError("INVALID_MANIFEST", "execution contract is invalid");
  }
  const operations = (Array.isArray(manifest.operations) ? manifest.operations : [])
    .map((operation) => normalizeOperation(operation, capabilityId));
  if (!operations.length) throw new CapabilityError("INVALID_MANIFEST", "capability must declare at least one operation");
  const ids = new Set();
  operations.forEach((operation) => {
    if (ids.has(operation.operationId)) throw new CapabilityError("INVALID_MANIFEST", `duplicate operation ${operation.operationId}`);
    ids.add(operation.operationId);
  });
  const normalized = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    capabilityId,
    entityId,
    version,
    status,
    description: String(manifest.description || "").trim(),
    ownerId: String(options.ownerId || manifest.ownerId || "system"),
    execution: { type, readOnly: execution.readOnly !== false, timeoutMs: Math.floor(timeoutMs) },
    operations,
    implementationPolicyVersion: Math.max(1, Number(manifest.implementationPolicyVersion || 1)),
  };
  if (manifest.name != null) normalized.name = String(manifest.name).trim().slice(0, 160);
  if (manifest.createdAt) normalized.createdAt = String(manifest.createdAt);
  if (manifest.updatedAt) normalized.updatedAt = String(manifest.updatedAt);
  return normalized;
}

function validateCapabilityBuildRequest(raw) {
  const request = requireObject(raw, "capability build request");
  const kind = String(request.kind || "computeCapabilityBuild");
  if (kind !== "computeCapabilityBuild") throw new CapabilityError("INVALID_BUILD_REQUEST", "kind must be computeCapabilityBuild");
  const description = String(request.description || request.summary || request.purpose || request.name || "").trim();
  if (!description) throw new CapabilityError("INVALID_BUILD_REQUEST", "capability build request description is required");
  const capabilityIdHint = request.capabilityIdHint || request.capabilityId || request.name;
  const canonicalId = capabilityIdHint ? normalizeId(canonicalizeGeneratedIdentifier(capabilityIdHint), "capabilityIdHint") : null;
  const operations = canonicalizeGeneratedOperations(request.operations)
    .map((operation) => normalizeOperation(operation, canonicalId));
  if (!operations.length) throw new CapabilityError("INVALID_BUILD_REQUEST", "capability build request must declare at least one operation");
  return {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    kind,
    description,
    operations,
    ...(request.name != null ? { name: String(request.name).trim().slice(0, 160) } : {}),
    ...(canonicalId ? { capabilityIdHint: canonicalId } : {}),
    ...(request.requestedBy != null ? { requestedBy: String(request.requestedBy) } : {}),
  };
}

function getCapabilityOperation(manifest, operationId) {
  const id = String(operationId || "").trim().toLowerCase();
  const operation = manifest.operations.find((item) => item.operationId === id);
  if (!operation) throw new CapabilityError("UNKNOWN_OPERATION", `capability ${manifest.capabilityId} has no operation ${id || "(blank)"}`);
  return operation;
}

function validateInvocationInputs(manifest, operationId, rawInputs) {
  const operation = getCapabilityOperation(manifest, operationId);
  const supplied = isObject(rawInputs) ? rawInputs : {};
  const declared = new Set(operation.inputs.map((field) => field.name));
  const suspicious = Object.keys(supplied).find((name) =>
    !declared.has(name) && /(?:secret|password|token|credential|api[_-]?key|private[_-]?key)/i.test(name)
  );
  if (suspicious) {
    throw new CapabilityError("PLAINTEXT_ASSET_INPUT_FORBIDDEN", `protected value ${suspicious} may not be supplied as an ordinary input`);
  }
  const resolved = {};
  for (const field of operation.inputs) {
    let value = supplied[field.name];
    if (value == null && Object.prototype.hasOwnProperty.call(field, "defaultValue")) value = clone(field.defaultValue);
    if (value == null) {
      if (field.required) {
        throw new CapabilityError("MISSING_INPUT", `required input ${field.name} is missing`, {
          field: field.name,
          clarification: field.clarification || null,
          bindingHint: field.bindingHint || null,
        });
      }
      continue;
    }
    validateFieldValue(field, value, "input");
    resolved[field.name] = clone(value);
  }
  return { operation, inputs: resolved };
}

function validateCapabilityInputResponse(rawField, rawValue) {
  const field = normalizeValueField(rawField, "input");
  let value = clone(rawValue);
  if (typeof value === "string") value = value.trim();
  if (field.type === "number" && typeof value === "string" && value !== "" && Number.isFinite(Number(value))) value = Number(value);
  if (field.type === "integer" && typeof value === "string" && /^[-+]?\d+$/.test(value)) value = Number(value);
  if (field.type === "boolean" && typeof value === "string") {
    if (/^(?:true|yes|1)$/i.test(value)) value = true;
    else if (/^(?:false|no|0)$/i.test(value)) value = false;
  }
  validateFieldValue(field, value, "input");
  return { field, value: clone(value) };
}

function validateOperationResult(operation, rawResult) {
  let result = rawResult;
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch (_) {}
  }
  if (!isObject(result)) {
    if (operation.outputs.length === 1) result = { [operation.outputs[0].name]: result };
    else throw new CapabilityError("INVALID_RESULT", `operation ${operation.operationId} must return an object`);
  }
  result = clone(result);
  for (const field of operation.outputs) {
    let value = result[field.name];
    if (field.type === "number" && typeof value === "string" && Number.isFinite(Number(value))) value = Number(value);
    if (field.type === "integer" && typeof value === "string" && /^[-+]?\d+$/.test(value)) value = Number(value);
    result[field.name] = value;
    if (value == null) {
      if (field.required) throw new CapabilityError("INVALID_RESULT", `required output ${field.name} is missing`);
      continue;
    }
    try { validateFieldValue(field, value, "output"); } catch (error) {
      if (error instanceof CapabilityError && error.code === "INVALID_INPUT") {
        throw new CapabilityError("INVALID_RESULT", error.message, error.details);
      }
      throw error;
    }
  }
  return result;
}

function buildExecutionSuccess({ manifest, operation, result, source = "compute-entity", observedAt = null, cached = false }) {
  const observed = observedAt ? new Date(observedAt) : new Date();
  const ttl = Number(operation?.freshness?.ttlSeconds || 0);
  return {
    ok: true,
    kind: "computeResult",
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    capabilityId: manifest.capabilityId,
    operationId: operation.operationId,
    entityId: manifest.entityId,
    version: manifest.version,
    result,
    observedAt: observed.toISOString(),
    expiresAt: ttl > 0 ? new Date(observed.getTime() + ttl * 1000).toISOString() : null,
    source,
    cached: !!cached,
  };
}

function buildExecutionError(error, context = {}) {
  const known = error instanceof CapabilityError || error instanceof ProtectedAssetError;
  return {
    ok: false,
    kind: "computeError",
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    capabilityId: context.capabilityId || null,
    operationId: context.operationId || null,
    entityId: context.entityId || null,
    version: context.version || null,
    error: {
      code: known ? error.code : "EXECUTION_FAILED",
      message: known ? error.message : "Compute entity execution failed.",
      details: known ? error.details : null,
      retryable: ["PROVIDER_UNAVAILABLE", "RATE_LIMITED", "EXECUTION_TIMEOUT"].includes(known ? error.code : ""),
    },
  };
}

module.exports = {
  CAPABILITY_SCHEMA_VERSION,
  IMPLEMENTATION_POLICY_VERSION,
  CapabilityError,
  validateCapabilityBuildRequest,
  canonicalizeGeneratedIdentifier,
  canonicalizeGeneratedOperations,
  validateCapabilityManifest,
  getCapabilityOperation,
  validateCapabilityInputResponse,
  validateInvocationInputs,
  validateOperationResult,
  buildExecutionSuccess,
  buildExecutionError,
};
