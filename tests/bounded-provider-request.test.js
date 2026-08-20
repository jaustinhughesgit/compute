"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBoundedAxios } = require("../app/routes/boundedAxios");
const {
  legacyEntityOriginalHost,
  normalizeEntityTransportResult,
  normalizeProviderExecutionError,
  providerRequestTimeoutMs,
  register,
  validateEntityResult,
} = require("../app/routes/modules/runEntity");
const { resolveComputeInputPlaceholder } = require("../app/routes/inputPlaceholderTransport");
const { copyRuntimeContext, useBundledRuntimeModule } = require("../app/routes/runtimeModules");
const {
  IMPLEMENTATION_POLICY_VERSION,
  validateCapabilityManifest,
} = require("../app/routes/capabilityManifest");

function fakeAxios(calls) {
  const client = {
    constructor: function Axios() {},
    request: async (config) => { calls.push(["request", config]); },
    _request: async (...args) => { calls.push(["_request", ...args]); },
    getUri: () => "",
    create: () => client,
    isCancel: () => false,
    toFormData: () => ({}),
    all: Promise.all.bind(Promise),
    spread: (callback) => callback,
    isAxiosError: () => false,
    mergeConfig: Object.assign,
    defaults: {},
    interceptors: {},
  };
  for (const method of ["delete", "get", "head", "options"]) {
    client[method] = async (url, config) => { calls.push([method, url, config]); };
  }
  for (const method of ["post", "postForm", "put", "putForm", "patch", "patchForm"]) {
    client[method] = async (url, data, config) => { calls.push([method, url, data, config]); };
  }
  return client;
}

test("entity execution canonicalizes the public action path to the legacy internal route", () => {
  assert.equal(
    legacyEntityOriginalHost(
      "https://1var.com/runEntity/entity-123",
      "entity-123"
    ),
    "https://1var.com/cookies/runEntity/entity-123"
  );
  assert.equal(
    legacyEntityOriginalHost("", "entity with space"),
    "https://1var.com/cookies/runEntity/entity%20with%20space"
  );
});

test("generated provider requests receive a bounded Axios timeout", async () => {
  const calls = [];
  const client = createBoundedAxios(fakeAxios(calls), 10000);
  await client.get("https://provider.example/data");
  await client.get("https://provider.example/data", { timeout: 30000, params: { q: "Raleigh" } });
  await client.post("https://provider.example/data", { q: "Raleigh" }, { timeout: 5000 });

  assert.equal(calls[0][2].timeout, 10000);
  assert.equal(calls[0][2].signal instanceof AbortSignal, true);
  assert.equal(calls[1][2].timeout, 10000);
  assert.deepEqual(calls[1][2].params, { q: "Raleigh" });
  assert.equal(calls[2][3].timeout, 5000);
});

test("generated Axios declarations reuse the bundled execution client", () => {
  const executionAxios = { get: async () => ({ data: {} }) };
  const context = { axios: { value: executionAxios, context: {} } };
  const lib = { modules: {} };

  assert.equal(useBundledRuntimeModule({
    moduleName: "axios",
    contextKey: "axios",
    context,
    lib,
  }), true);
  assert.equal(context.axios.value, executionAxios);
  assert.deepEqual(lib.modules.axios, { value: "axios", context: {} });
  assert.equal(useBundledRuntimeModule({
    moduleName: "other-package",
    contextKey: "other",
    context,
    lib,
  }), false);
});

test("runtime context cloning preserves protected bindings without serializing them", () => {
  const initial = { body: { value: { location: "New York" }, context: {} } };
  const bindings = Object.create(null);
  bindings.openweather_api_key = Object.assign(Object.create(null), {
    apikey: "test-only-openweather-key",
  });
  Object.defineProperty(initial, "protected", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: { value: bindings, context: Object.create(null) },
  });

  const copied = copyRuntimeContext(initial);
  const resolved = resolveComputeInputPlaceholder({
    path: "protected=>openweather_api_key.apikey",
    rootContext: copied,
  });

  assert.equal(resolved.matched, true);
  assert.equal(resolved.value, "test-only-openweather-key");
  assert.equal(Object.getOwnPropertyDescriptor(copied, "protected").enumerable, false);
  assert.equal(JSON.stringify(copied).includes("test-only-openweather-key"), false);
});

test("provider timeout leaves cleanup and response headroom inside the entity deadline", () => {
  assert.equal(providerRequestTimeoutMs(15000), 10000);
  assert.equal(providerRequestTimeoutMs(10000), 7500);
  assert.equal(providerRequestTimeoutMs(2000), 250);
});

test("entity transport unwraps a legacy result envelope that contains declared outputs", () => {
  const operation = {
    outputs: [
      { name: "temperature", type: "number", required: true },
      { name: "condition", type: "string", required: true },
    ],
  };
  assert.deepEqual(
    normalizeEntityTransportResult(operation, {
      result: { temperature: "28.98", condition: "scattered clouds" },
    }),
    { temperature: 28.98, condition: "scattered clouds" }
  );
});

test("entity transport preserves result when it is a declared output", () => {
  const operation = {
    outputs: [{ name: "result", type: "object", required: true }],
  };
  const response = { result: { temperature: 28.98, condition: "scattered clouds" } };
  assert.deepEqual(normalizeEntityTransportResult(operation, response), response);
});

test("entity output mismatch preserves a sanitized actionable diagnostic", () => {
  const operation = {
    operationId: "lookup",
    outputs: [
      { name: "measurement", type: "string", required: true },
      { name: "summary", type: "string", required: true },
    ],
    protectedAssetRequirements: [{
      providerName: "Example Provider",
      providerHost: "api.provider.example",
    }],
  };
  assert.throws(
    () => validateEntityResult(operation, {
      measurement: 300.59,
      summary: "available",
      apiKey: "must-not-escape",
    }),
    (error) => {
      assert.equal(error.code, "PROVIDER_RESPONSE_INVALID");
      assert.match(error.message, /declared output contract/);
      assert.equal(error.details.stage, "output-contract-validation");
      assert.deepEqual(error.details.validation, {
        code: "INVALID_RESULT",
        message: "output measurement must be string",
        field: "measurement",
        expectedType: "string",
        actualType: "number",
      });
      assert.deepEqual(error.details.observedShape, {
        measurement: "number",
        summary: "string",
        apiKey: "string",
      });
      assert.equal(error.details.observedResult.measurement, 300.59);
      assert.equal(error.details.observedResult.apiKey, "[redacted]");
      assert.doesNotMatch(JSON.stringify(error.details), /must-not-escape/);
      return true;
    }
  );
});

test("provider request errors preserve sanitized response evidence", () => {
  const operation = {
    protectedAssetRequirements: [{
      providerName: "Example Provider",
      providerHost: "api.provider.example",
    }],
  };
  const error = normalizeProviderExecutionError({
    isAxiosError: true,
    response: {
      status: 422,
      statusText: "Unprocessable Entity",
      data: {
        message: "invalid location",
        api_key: "must-not-escape",
        help: "https://provider.example/help?appid=must-not-escape",
      },
    },
  }, operation);
  assert.equal(error.code, "PROVIDER_REQUEST_REJECTED");
  assert.equal(error.details.stage, "provider-request");
  assert.equal(error.details.status, 422);
  assert.equal(error.details.providerResponse.message, "invalid location");
  assert.equal(error.details.providerResponse.api_key, "[redacted]");
  assert.match(error.details.providerResponse.help, /appid=\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(error.details), /must-not-escape/);
});

test("declared calculations return a sanitized actionable runtime diagnostic", () => {
  const error = normalizeProviderExecutionError(new TypeError("Cannot read calculation slot"), {
    calculation: {
      operator: "add",
      operands: [],
      outputName: "sum",
    },
    protectedAssetRequirements: [],
  });

  assert.equal(error.code, "CALCULATION_RUNTIME_FAILED");
  assert.equal(error.details.stage, "entity-runtime");
  assert.deepEqual(error.details.cause, {
    name: "TypeError",
    code: null,
    message: "Cannot read calculation slot",
  });
});

test("the entity boundary passes its provider deadline into existing entity execution", async () => {
  let handler;
  let execution;
  const manifest = {
    schemaVersion: 1,
    capabilityId: "conditions",
    entityId: "conditions-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    name: "Vehicle cleaner",
    description: "Changes one resolved vehicle state from dirty to clean.",
    execution: { type: "remote", readOnly: true, timeoutMs: 15000 },
    operations: [{
      operationId: "lookup",
      inputs: [],
      outputs: [{ name: "summary", type: "string", required: true }],
    }],
    implementationPolicyVersion: IMPLEMENTATION_POLICY_VERSION,
  };
  const dynamodb = {
    get: () => ({ promise: async () => ({ Item: { su: manifest.entityId, computeCapability: manifest } }) }),
  };
  const shared = {
    getSub: async () => ({ Items: [] }),
    deps: { dynamodb },
    runComputeEntity: async (args) => {
      execution = args;
      return { summary: "Clear" };
    },
  };
  register({
    on: (name, callback) => {
      assert.equal(name, "runEntity");
      handler = callback;
    },
    use: () => shared,
  });

  const response = await handler({
    path: manifest.entityId,
    req: { body: { capabilityId: manifest.capabilityId, operationId: "lookup", inputs: {} }, cookies: { e: "7" } },
    res: {},
    next: () => {},
  });

  assert.equal(response.ok, true);
  assert.equal(execution.providerRequestTimeoutMs, 10000);
});

test("the entity boundary applies canonical use governance before capability execution", async () => {
  let handler;
  let executed = false;
  let governedAction = null;
  const shared = {
    deps: { dynamodb: {} },
    getCanonicalComposition: () => ({ authorizeEndpoint: async (_id, action) => {
      governedAction = action;
      const error = new Error("denied");
      error.code = "GOVERNANCE_FORBIDDEN";
      throw error;
    } }),
    runComputeEntity: async () => { executed = true; },
  };
  register({ on: (_name, callback) => { handler = callback; }, use: () => shared });
  const response = await handler({
    path: "private-entity", cookie: { e: "2" }, req: { body: {}, cookies: { e: "2" } }, res: {},
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "GOVERNANCE_FORBIDDEN");
  assert.equal(governedAction, "use");
  assert.equal(executed, false);
});

test("the entity boundary executes an unambiguous fixed ContextDB transition from its contract", async () => {
  let handler;
  let entityRuntimeCalled = false;
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "vehicle.clean",
    entityId: "vehicle-clean-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    name: "Vehicle cleaner",
    description: "Changes one resolved vehicle state from dirty to clean.",
    execution: { type: "remote", readOnly: false, timeoutMs: 15000 },
    operations: [{
      operationId: "wash",
      description: "Wash the referenced vehicle.",
      inputs: [{
        name: "vehicle",
        type: "string",
        required: true,
        description: "The referenced vehicle.",
        bindingHint: { source: "utterance", resolver: "entity_reference" },
        clarification: "Which vehicle should be washed?",
      }],
      outputs: [
        { name: "vehicle", type: "string", required: true, description: "The vehicle." },
        { name: "state", type: "string", required: true, description: "The clean state." },
      ],
      freshness: { mode: "none", ttlSeconds: 0 },
      answerTemplate: "Your {{vehicle}} is {{state}}.",
      utteranceExamples: [{ text: "Wash my car.", inputs: { vehicle: "car" } }],
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "vehicle",
        currentValue: "dirty",
        newValue: "clean",
      }],
    }],
    implementationPolicyVersion: IMPLEMENTATION_POLICY_VERSION,
  });
  const dynamodb = {
    get: () => ({ promise: async () => ({ Item: { su: manifest.entityId, computeCapability: manifest } }) }),
  };
  register({
    on: (_name, callback) => { handler = callback; },
    use: () => ({
      deps: { dynamodb },
      runComputeEntity: async () => { entityRuntimeCalled = true; throw new Error("must not run"); },
    }),
  });

  const response = await handler({
    path: manifest.entityId,
    req: {
      body: {
        capabilityId: manifest.capabilityId,
        operationId: "wash",
        inputs: { vehicle: "Camry" },
      },
      cookies: { e: "7" },
    },
    res: {},
    next: () => {},
  });

  assert.equal(response.ok, true);
  assert.equal(response.source, "compute-contract");
  assert.deepEqual(response.result, { vehicle: "Camry", state: "clean" });
  assert.equal(entityRuntimeCalled, false);
});
