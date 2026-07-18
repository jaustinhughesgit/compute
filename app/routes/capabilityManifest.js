// routes/capabilityManifest.js
"use strict";

const CAPABILITY_SCHEMA_VERSION = 1;
const CAPABILITY_STATUSES = new Set(["testing", "active", "disabled", "failed"]);
const EXECUTION_TYPES = new Set(["remote", "local"]);
const VALUE_TYPES = new Set([
  "string", "number", "integer", "boolean", "date", "datetime",
  "object", "array", "file", "any",
]);
const BINDING_SOURCES = new Set(["utterance", "contextdb", "environment", "default"]);
const PATH_SEGMENT_KINDS = new Set(["literal", "lemma", "normal", "tag", "slot"]);
const EXECUTABLE_FIELDS = new Set(["function", "fn", "custom", "code", "script", "handler", "eval", "worker"]);

class CapabilityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "CapabilityError";
    this.code = code || "CAPABILITY_ERROR";
    this.details = details;
  }
}

const clone = (value) => {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
};

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function requireObject(value, name) {
  if (!isObject(value)) {
    throw new CapabilityError("INVALID_MANIFEST", `${name} must be an object`);
  }
  return value;
}

function normalizeId(value, name) {
  const id = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(id)) {
    throw new CapabilityError(
      "INVALID_MANIFEST",
      `${name} must start with a letter and contain only lowercase letters, numbers, dots, underscores, or hyphens`
    );
  }
  return id;
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

  if (source === "contextdb" && (!normalized.subject || !normalized.property)) {
    throw new CapabilityError(
      "INVALID_MANIFEST",
      `input ${inputName} contextdb binding requires subject and property`
    );
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

  const normalized = {
    name,
    type,
    required: field.required !== false,
  };
  if (field.description != null) normalized.description = String(field.description).trim();
  if (field.sensitive === true) normalized.sensitive = true;
  if (Object.prototype.hasOwnProperty.call(field, "defaultValue")) {
    normalized.defaultValue = clone(field.defaultValue);
  }
  if (field.validation != null) {
    normalized.validation = clone(requireObject(field.validation, `${kind} ${name} validation`));
  }
  if (kind === "input") {
    normalized.bindingHint = normalizeBindingHint(field.bindingHint, name);
    if (field.clarification != null) normalized.clarification = String(field.clarification).trim();
  }
  return normalized;
}

function rejectExecutableFields(value, location = "pathContract") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExecutableFields(entry, `${location}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (EXECUTABLE_FIELDS.has(String(key).toLowerCase())) {
      throw new CapabilityError("INVALID_MANIFEST", `${location}.${key} is not allowed in a declarative Path contract`);
    }
    rejectExecutableFields(entry, `${location}.${key}`);
  }
}

function normalizePathTests(raw, patternIdValue) {
  const tests = requireObject(raw, `path contract ${patternIdValue} tests`);
  const normalizeList = (value, kind) => {
    if (!Array.isArray(value) || value.length < 2) {
      throw new CapabilityError("INVALID_MANIFEST", `path contract ${patternIdValue} requires at least two ${kind} tests`);
    }
    return value.slice(0, 20).map((entry, index) => {
      const source = typeof entry === "string" ? { input: entry } : requireObject(entry, `${kind} test ${index + 1}`);
      const input = String(source.input || source.text || "").trim();
      if (!input || input.length > 500) {
        throw new CapabilityError("INVALID_MANIFEST", `${kind} test ${index + 1} requires input of at most 500 characters`);
      }
      return {
        id: String(source.id || `${kind}_${index + 1}`).trim().slice(0, 100),
        input,
        ...(source.expectedMode ? { expectedMode: String(source.expectedMode).trim().toLowerCase() } : {}),
      };
    });
  };
  return {
    schemaVersion: 1,
    positive: normalizeList(tests.positive, "positive"),
    negative: normalizeList(tests.negative, "negative"),
    expectedBehavior: isObject(tests.expectedBehavior) ? clone(tests.expectedBehavior) : {},
  };
}

function normalizePathContract(raw) {
  const contract = requireObject(raw, "operation pathContract");
  if (Number(contract.schemaVersion || 1) !== 1) {
    throw new CapabilityError("INVALID_MANIFEST", "pathContract.schemaVersion must be 1");
  }
  rejectExecutableFields(contract);
  const pattern = requireObject(contract.pattern, "pathContract.pattern");
  const patternIdValue = normalizeId(pattern.patternId, "pathContract patternId").replace(/[.-]/g, "_");
  if (Number(pattern.schemaVersion || 0) !== 3) {
    throw new CapabilityError("INVALID_MANIFEST", `path contract ${patternIdValue} pattern schemaVersion must be 3`);
  }
  if (String(pattern.kind || "").toLowerCase() !== "question") {
    throw new CapabilityError("INVALID_MANIFEST", `path contract ${patternIdValue} must identify a question`);
  }
  if (String(pattern.operation || "") !== "invoke_compute_capability") {
    throw new CapabilityError("INVALID_MANIFEST", `path contract ${patternIdValue} must use invoke_compute_capability`);
  }
  const validateSyntax = (syntax, label) => {
    if (!Array.isArray(syntax) || !syntax.length) {
      throw new CapabilityError("INVALID_MANIFEST", `${label} must contain syntax segments`);
    }
    for (const [index, segment] of syntax.entries()) {
      const kind = String(segment?.kind || "");
      if (!PATH_SEGMENT_KINDS.has(kind)) {
        throw new CapabilityError("INVALID_MANIFEST", `${label}[${index}] has an unsupported kind`);
      }
      if (kind === "slot") {
        if (!String(segment?.slot || "").trim()) throw new CapabilityError("INVALID_MANIFEST", `${label}[${index}] requires slot`);
      } else if (!String(segment?.value || "").trim()) {
        throw new CapabilityError("INVALID_MANIFEST", `${label}[${index}] requires value`);
      }
    }
  };
  validateSyntax(pattern.core, `path contract ${patternIdValue} core`);
  for (const [index, modifier] of (Array.isArray(pattern.modifiers) ? pattern.modifiers : []).entries()) {
    validateSyntax(modifier?.syntax, `path contract ${patternIdValue} modifier ${index + 1}`);
  }
  const answerTemplate = String(contract.answerTemplate || "").trim();
  if (!answerTemplate || answerTemplate.length > 1500) {
    throw new CapabilityError("INVALID_MANIFEST", `path contract ${patternIdValue} requires an answerTemplate of at most 1500 characters`);
  }
  return {
    schemaVersion: 1,
    familyId: normalizeId(contract.familyId || patternIdValue, "pathContract familyId").replace(/[.-]/g, "_"),
    pattern: clone({
      ...pattern,
      patternId: patternIdValue,
      kind: "question",
      operation: "invoke_compute_capability",
      modifiers: Array.isArray(pattern.modifiers) ? pattern.modifiers : [],
      projection: pattern.projection || null,
      slotDefinitions: Array.isArray(pattern.slotDefinitions) ? pattern.slotDefinitions : [],
      tokenizerAliases: Array.isArray(pattern.tokenizerAliases) ? pattern.tokenizerAliases : [],
    }),
    tests: normalizePathTests(contract.tests, patternIdValue),
    answerTemplate,
  };
}

function normalizeOperation(raw) {
  const operation = requireObject(raw, "operation");
  const operationId = normalizeId(operation.operationId, "operationId");
  const inputs = Array.isArray(operation.inputs) ? operation.inputs.map((item) => normalizeValueField(item, "input")) : [];
  const outputs = Array.isArray(operation.outputs) ? operation.outputs.map((item) => normalizeValueField(item, "output")) : [];

  const unique = (items, label) => {
    const names = new Set();
    for (const item of items) {
      if (names.has(item.name)) {
        throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} contains duplicate ${label} ${item.name}`);
      }
      names.add(item.name);
    }
  };
  unique(inputs, "input");
  unique(outputs, "output");
  if (!outputs.length) {
    throw new CapabilityError("INVALID_MANIFEST", `operation ${operationId} must declare at least one output`);
  }

  const normalized = {
    operationId,
    description: String(operation.description || "").trim(),
    inputs,
    outputs,
  };
  if (isObject(operation.freshness)) {
    const ttlSeconds = Number(operation.freshness.ttlSeconds || 0);
    normalized.freshness = {
      mode: String(operation.freshness.mode || (ttlSeconds > 0 ? "cache" : "none")),
      ttlSeconds: Number.isFinite(ttlSeconds) && ttlSeconds >= 0 ? Math.floor(ttlSeconds) : 0,
    };
  }
  if (Array.isArray(operation.utteranceExamples)) {
    normalized.utteranceExamples = operation.utteranceExamples
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 40);
  }
  if (Array.isArray(operation.pathContracts)) {
    normalized.pathContracts = operation.pathContracts.map(normalizePathContract);
  }
  return normalized;
}

function validateCapabilityManifest(raw, options = {}) {
  const manifest = requireObject(raw, "capability manifest");
  const schemaVersion = Number(manifest.schemaVersion);
  if (schemaVersion !== CAPABILITY_SCHEMA_VERSION) {
    throw new CapabilityError(
      "UNSUPPORTED_MANIFEST_VERSION",
      `capability manifest schemaVersion must be ${CAPABILITY_SCHEMA_VERSION}`
    );
  }

  const entityId = String(options.entityId || manifest.entityId || "").trim();
  if (!entityId) throw new CapabilityError("INVALID_MANIFEST", "entityId is required");
  const version = Number(manifest.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new CapabilityError("INVALID_MANIFEST", "version must be a positive integer");
  }
  const status = String(manifest.status || "testing").trim().toLowerCase();
  if (!CAPABILITY_STATUSES.has(status)) {
    throw new CapabilityError("INVALID_MANIFEST", `unsupported capability status ${status}`);
  }

  const executionRaw = isObject(manifest.execution) ? manifest.execution : {};
  const executionType = String(executionRaw.type || "remote").trim().toLowerCase();
  if (!EXECUTION_TYPES.has(executionType)) {
    throw new CapabilityError("INVALID_MANIFEST", `unsupported execution type ${executionType}`);
  }
  const timeoutMs = Number(executionRaw.timeoutMs || 10000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 250 || timeoutMs > 120000) {
    throw new CapabilityError("INVALID_MANIFEST", "execution.timeoutMs must be between 250 and 120000");
  }

  const operations = Array.isArray(manifest.operations)
    ? manifest.operations.map(normalizeOperation)
    : [];
  if (!operations.length) {
    throw new CapabilityError("INVALID_MANIFEST", "capability must declare at least one operation");
  }
  const operationIds = new Set();
  for (const operation of operations) {
    if (operationIds.has(operation.operationId)) {
      throw new CapabilityError("INVALID_MANIFEST", `duplicate operation ${operation.operationId}`);
    }
    operationIds.add(operation.operationId);
  }

  const normalized = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    capabilityId: normalizeId(manifest.capabilityId, "capabilityId"),
    entityId,
    version,
    status,
    description: String(manifest.description || "").trim(),
    ownerId: String(options.ownerId || manifest.ownerId || "system"),
    execution: {
      type: executionType,
      readOnly: executionRaw.readOnly !== false,
      timeoutMs: Math.floor(timeoutMs),
    },
    operations,
  };
  if (manifest.createdAt) normalized.createdAt = String(manifest.createdAt);
  if (manifest.updatedAt) normalized.updatedAt = String(manifest.updatedAt);
  return normalized;
}

function validateCapabilityBuildRequest(raw) {
  const request = requireObject(raw, "capability build request");
  const schemaVersion = Number(request.schemaVersion || CAPABILITY_SCHEMA_VERSION);
  if (schemaVersion !== CAPABILITY_SCHEMA_VERSION) {
    throw new CapabilityError(
      "UNSUPPORTED_MANIFEST_VERSION",
      `capability build request schemaVersion must be ${CAPABILITY_SCHEMA_VERSION}`
    );
  }
  const kind = String(request.kind || "computeCapabilityBuild").trim();
  if (kind !== "computeCapabilityBuild") {
    throw new CapabilityError("INVALID_BUILD_REQUEST", "kind must be computeCapabilityBuild");
  }
  const description = String(request.description || "").trim();
  if (!description) {
    throw new CapabilityError("INVALID_BUILD_REQUEST", "capability build request description is required");
  }
  const operations = Array.isArray(request.operations)
    ? request.operations.map(normalizeOperation)
    : [];
  if (!operations.length) {
    throw new CapabilityError("INVALID_BUILD_REQUEST", "capability build request must declare at least one operation");
  }
  const normalized = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    kind,
    description,
    operations,
  };
  if (request.capabilityIdHint) {
    normalized.capabilityIdHint = normalizeId(request.capabilityIdHint, "capabilityIdHint");
  }
  if (request.requestedBy != null) normalized.requestedBy = String(request.requestedBy);
  return normalized;
}

function getCapabilityOperation(manifest, operationId) {
  const id = String(operationId || "").trim().toLowerCase();
  const operation = manifest.operations.find((item) => item.operationId === id);
  if (!operation) {
    throw new CapabilityError("UNKNOWN_OPERATION", `capability ${manifest.capabilityId} has no operation ${id || "(blank)"}`);
  }
  return operation;
}

function valueMatchesType(value, type) {
  if (type === "any") return true;
  if (type === "string" || type === "date" || type === "datetime" || type === "file") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  return false;
}

function validateFieldValue(field, value, label) {
  if (!valueMatchesType(value, field.type)) {
    throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} must be ${field.type}`, {
      field: field.name,
      expectedType: field.type,
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
      let re;
      try { re = new RegExp(String(rules.pattern)); } catch (_) {
        throw new CapabilityError("INVALID_MANIFEST", `${label} ${field.name} has an invalid validation pattern`);
      }
      if (!re.test(value)) {
        throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} has an invalid format`, { field: field.name });
      }
    }
    if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} must use YYYY-MM-DD`, { field: field.name });
    }
    if (field.type === "datetime" && !Number.isFinite(Date.parse(value))) {
      throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} must be an ISO datetime`, { field: field.name });
    }
  }
  if (typeof value === "number") {
    if (rules.minimum != null && value < Number(rules.minimum)) {
      throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} is below its minimum`, { field: field.name });
    }
    if (rules.maximum != null && value > Number(rules.maximum)) {
      throw new CapabilityError("INVALID_INPUT", `${label} ${field.name} exceeds its maximum`, { field: field.name });
    }
  }
}

function validateInvocationInputs(manifest, operationId, rawInputs) {
  const operation = getCapabilityOperation(manifest, operationId);
  const supplied = isObject(rawInputs) ? rawInputs : {};
  const resolved = {};
  for (const field of operation.inputs) {
    let value = supplied[field.name];
    if (value == null && Object.prototype.hasOwnProperty.call(field, "defaultValue")) {
      value = clone(field.defaultValue);
    }
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

function validateOperationResult(operation, rawResult) {
  let result = rawResult;
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch (_) {}
  }
  if (!isObject(result)) {
    if (operation.outputs.length === 1) result = { [operation.outputs[0].name]: result };
    else throw new CapabilityError("INVALID_RESULT", `operation ${operation.operationId} must return an object`);
  }
  for (const field of operation.outputs) {
    const value = result[field.name];
    if (value == null) {
      if (field.required) {
        throw new CapabilityError("INVALID_RESULT", `required output ${field.name} is missing`, { field: field.name });
      }
      continue;
    }
    try {
      validateFieldValue(field, value, "output");
    } catch (error) {
      if (error instanceof CapabilityError && error.code === "INVALID_INPUT") {
        throw new CapabilityError("INVALID_RESULT", error.message.replace(/^input /, "output "), error.details);
      }
      throw error;
    }
  }
  return clone(result);
}

function buildExecutionSuccess({ manifest, operation, result, source = "compute-entity", observedAt = null, cached = false }) {
  const observed = observedAt ? new Date(observedAt) : new Date();
  const ttlSeconds = Number(operation?.freshness?.ttlSeconds || 0);
  const expires = ttlSeconds > 0 ? new Date(observed.getTime() + ttlSeconds * 1000).toISOString() : null;
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
    expiresAt: expires,
    source,
    cached: !!cached,
  };
}

function buildExecutionError(error, context = {}) {
  const known = error instanceof CapabilityError;
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

function createWeatherCapabilityManifest({ entityId, ownerId = "system", status = "testing" } = {}) {
  return validateCapabilityManifest({
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    capabilityId: "weather.current_conditions",
    entityId,
    version: 1,
    status,
    ownerId,
    description: "Returns current weather conditions for a postal code and date.",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: [{
      operationId: "current_conditions",
      description: "Get current weather conditions.",
      inputs: [
        {
          name: "postal_code",
          type: "string",
          required: true,
          sensitive: true,
          bindingHint: { source: "contextdb", subject: "speaker", property: "postal_code" },
          clarification: "What ZIP or postal code should I use?",
          validation: { minLength: 3, maxLength: 12, pattern: "^[A-Za-z0-9 -]+$" },
        },
        {
          name: "date",
          type: "date",
          required: true,
          bindingHint: { source: "environment", resolver: "relative_date" },
        },
        {
          name: "country_code",
          type: "string",
          required: false,
          defaultValue: "US",
          bindingHint: { source: "contextdb", subject: "speaker", property: "country_code" },
          validation: { minLength: 2, maxLength: 2, pattern: "^[A-Za-z]{2}$" },
        },
        {
          name: "unit_system",
          type: "string",
          required: false,
          defaultValue: "imperial",
          bindingHint: { source: "contextdb", subject: "speaker", property: "unit_preference" },
        },
      ],
      outputs: [
        { name: "temperature", type: "number", required: true },
        { name: "temperature_unit", type: "string", required: true },
        { name: "conditions", type: "string", required: true },
        { name: "precipitation_probability", type: "number", required: false, validation: { minimum: 0, maximum: 100 } },
      ],
      freshness: { mode: "cache", ttlSeconds: 900 },
      utteranceExamples: [
        "What is the weather today?",
        "How warm is it outside today?",
        "What are the current weather conditions?",
      ],
      pathContracts: [
        {
          schemaVersion: 1,
          familyId: "weather_current_query",
          pattern: {
            schemaVersion: 3,
            patternId: "weather_current_query",
            kind: "question",
            operation: "invoke_compute_capability",
            core: [
              { kind: "lemma", value: "what", slot: null, aliases: [] },
              { kind: "lemma", value: "be", slot: null, aliases: [] },
              { kind: "lemma", value: "weather", slot: null, aliases: [] }
            ],
            modifiers: [{
              modifierId: "today",
              position: "after",
              optional: true,
              repeatable: false,
              syntax: [{ kind: "lemma", value: "today", slot: null, aliases: ["now"] }]
            }],
            projection: null,
            slotDefinitions: [],
            tokenizerAliases: []
          },
          tests: {
            positive: [
              { id: "weather_today", input: "What is the weather today?", expectedMode: "question" },
              { id: "weather_now", input: "What is the weather now?", expectedMode: "question" },
              { id: "weather_current", input: "What is the weather?", expectedMode: "question" }
            ],
            negative: [
              { id: "weather_tomorrow", input: "What is the weather tomorrow?" },
              { id: "weather_yesterday", input: "What was the weather yesterday?" },
              { id: "stored_weather", input: "I recorded the weather today" }
            ],
            expectedBehavior: { operation: "invoke_compute_capability", offline: false, graphMutation: false }
          },
          answerTemplate: "{{conditions}}. It is {{temperature}} {{temperature_unit}}, with a {{precipitation_probability}}% chance of precipitation."
        },
        {
          schemaVersion: 1,
          familyId: "weather_temperature_query",
          pattern: {
            schemaVersion: 3,
            patternId: "weather_temperature_query",
            kind: "question",
            operation: "invoke_compute_capability",
            core: [
              { kind: "lemma", value: "how", slot: null, aliases: [] },
              { kind: "lemma", value: "warm", slot: null, aliases: ["hot", "cold"] },
              { kind: "lemma", value: "be", slot: null, aliases: [] },
              { kind: "lemma", value: "it", slot: null, aliases: [] }
            ],
            modifiers: [
              {
                modifierId: "outside",
                position: "after",
                optional: true,
                repeatable: false,
                syntax: [{ kind: "lemma", value: "outside", slot: null, aliases: [] }]
              },
              {
                modifierId: "today",
                position: "after",
                optional: true,
                repeatable: false,
                syntax: [{ kind: "lemma", value: "today", slot: null, aliases: ["now"] }]
              }
            ],
            projection: null,
            slotDefinitions: [],
            tokenizerAliases: []
          },
          tests: {
            positive: [
              { id: "warm_outside", input: "How warm is it outside today?", expectedMode: "question" },
              { id: "hot_now", input: "How hot is it now?", expectedMode: "question" },
              { id: "cold_outside", input: "How cold is it outside?", expectedMode: "question" }
            ],
            negative: [
              { id: "warm_tomorrow", input: "How warm will it be tomorrow?" },
              { id: "indoor_temperature", input: "How warm is the oven?" },
              { id: "temperature_statement", input: "It is warm outside today" }
            ],
            expectedBehavior: { operation: "invoke_compute_capability", offline: false, graphMutation: false }
          },
          answerTemplate: "It is {{temperature}} {{temperature_unit}} with {{conditions}}."
        }
      ],
    }],
  });
}

module.exports = {
  CAPABILITY_SCHEMA_VERSION,
  CapabilityError,
  validateCapabilityBuildRequest,
  validateCapabilityManifest,
  getCapabilityOperation,
  validateInvocationInputs,
  validateOperationResult,
  buildExecutionSuccess,
  buildExecutionError,
  createWeatherCapabilityManifest,
};
