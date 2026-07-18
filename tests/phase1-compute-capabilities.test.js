"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CapabilityError,
  createWeatherCapabilityManifest,
  validateCapabilityBuildRequest,
  validateInvocationInputs,
  validateOperationResult,
} = require("../app/routes/capabilityManifest");
const { createCapabilityRegistry } = require("../app/routes/capabilityRegistry");
const runEntityModule = require("../app/routes/modules/runEntity");
const capabilitiesModule = require("../app/routes/modules/capabilities");

class FakeDynamo {
  constructor(items = []) {
    this.items = new Map(items.map((item) => [String(item.su), structuredClone(item)]));
  }

  get({ Key }) {
    return { promise: async () => ({ Item: this.items.has(String(Key.su)) ? structuredClone(this.items.get(String(Key.su))) : undefined }) };
  }

  update({ Key, ExpressionAttributeValues }) {
    return {
      promise: async () => {
        const key = String(Key.su);
        const item = this.items.get(key) || { su: key };
        item.computeCapability = structuredClone(ExpressionAttributeValues[":manifest"]);
        item.capabilityId = ExpressionAttributeValues[":capabilityId"];
        item.capabilityVersion = ExpressionAttributeValues[":capabilityVersion"];
        item.capabilityStatus = ExpressionAttributeValues[":capabilityStatus"];
        item.capabilityOwnerId = ExpressionAttributeValues[":capabilityOwnerId"];
        item.capabilityUpdatedAt = ExpressionAttributeValues[":capabilityUpdatedAt"];
        this.items.set(key, item);
        return {};
      },
    };
  }

  scan({ ExpressionAttributeValues }) {
    return {
      promise: async () => ({
        Items: Array.from(this.items.values())
          .filter((item) => item.capabilityId === ExpressionAttributeValues[":capabilityId"])
          .map(structuredClone),
      }),
    };
  }
}

function activeWeather(entityId = "weather-su", ownerId = "u:7") {
  return createWeatherCapabilityManifest({ entityId, ownerId, status: "active" });
}

test("weather manifest declares background bindings and a freshness contract", () => {
  const manifest = activeWeather();
  const operation = manifest.operations[0];
  assert.equal(manifest.capabilityId, "weather.current_conditions");
  assert.equal(operation.inputs[0].bindingHint.source, "contextdb");
  assert.equal(operation.inputs[0].bindingHint.property, "postal_code");
  assert.equal(operation.inputs[1].bindingHint.resolver, "relative_date");
  assert.equal(operation.freshness.ttlSeconds, 900);
});

test("capability build requests are declarative and schema validated", () => {
  const request = validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "weather.current_conditions",
    description: "Return current weather for a supplied postal code.",
    operations: activeWeather().operations,
  });
  assert.equal(request.kind, "computeCapabilityBuild");
  assert.equal(request.operations[0].operationId, "current_conditions");
});

test("missing background inputs return a controlled clarification contract", () => {
  const manifest = activeWeather();
  assert.throws(
    () => validateInvocationInputs(manifest, "current_conditions", { date: "2026-07-17" }),
    (error) => {
      assert.equal(error instanceof CapabilityError, true);
      assert.equal(error.code, "MISSING_INPUT");
      assert.equal(error.details.field, "postal_code");
      assert.match(error.details.clarification, /postal code/i);
      return true;
    }
  );
});

test("weather output must satisfy the declared result schema", () => {
  const operation = activeWeather().operations[0];
  assert.throws(
    () => validateOperationResult(operation, { temperature: 80, temperature_unit: "F" }),
    (error) => error.code === "INVALID_RESULT" && error.details.field === "conditions"
  );
});

test("strict numeric transport strings are normalized before output validation", () => {
  const operation = activeWeather().operations[0];
  const result = validateOperationResult(operation, {
    temperature: "78.4",
    temperature_unit: "°F",
    conditions: "clear",
    precipitation_probability: "10",
  });
  assert.equal(result.temperature, 78.4);
  assert.equal(result.precipitation_probability, 10);
  assert.throws(
    () => validateOperationResult(operation, {
      temperature: "warm",
      temperature_unit: "°F",
      conditions: "clear",
    }),
    (error) => error.code === "INVALID_RESULT" && error.details.field === "temperature"
  );
});

test("registry persists capability metadata on the existing entity record", async () => {
  const dynamodb = new FakeDynamo([{ su: "weather-su", output: "Weather" }]);
  const registry = createCapabilityRegistry({ dynamodb });
  const saved = await registry.register(activeWeather(), { ownerId: "u:7" });
  assert.equal(saved.status, "active");
  const loaded = await registry.getByEntity("weather-su");
  assert.equal(loaded.capabilityId, "weather.current_conditions");
  assert.equal(dynamodb.items.get("weather-su").capabilityOwnerId, "u:7");
});

test("capabilities route can register the manual weather contract", async () => {
  const dynamodb = new FakeDynamo([{ su: "weather-su", output: "Weather" }]);
  let handler;
  capabilitiesModule.register({
    on(name, fn) { if (name === "capabilities") handler = fn; },
    use() { return { deps: { dynamodb } }; },
  });
  const response = await handler({
    path: "/register-weather/weather-su",
    cookie: { e: 7 },
    req: { body: { status: "active" } },
  });
  assert.equal(response.ok, true);
  assert.equal(response.manifest.ownerId, "u:7");
  assert.equal(response.manifest.status, "active");
});

test("runEntity returns a standardized, schema-valid compute result", async () => {
  const manifest = activeWeather();
  const dynamodb = new FakeDynamo([{ su: "weather-su", output: "Weather", computeCapability: manifest }]);
  let handler;
  runEntityModule.register({
    on(name, fn) { if (name === "runEntity") handler = fn; },
    use() {
      return {
        deps: { dynamodb },
        getSub: async (value) => ({ Items: [structuredClone(dynamodb.items.get(String(value)) || {})] }),
        runComputeEntity: async ({ inputs }) => ({
          temperature: 82,
          temperature_unit: inputs.unit_system === "metric" ? "C" : "F",
          conditions: "partly cloudy",
          precipitation_probability: 10,
        }),
      };
    },
  });

  const response = await handler({
    path: "/weather-su",
    req: {
      body: {
        capabilityId: "weather.current_conditions",
        operationId: "current_conditions",
        inputs: { postal_code: "27560", date: "2026-07-17" },
      },
      headers: {},
    },
    res: {},
  });

  assert.equal(response.ok, true);
  assert.equal(response.kind, "computeResult");
  assert.equal(response.result.temperature, 82);
  assert.equal(response.source, "compute-entity");
  assert.ok(Date.parse(response.observedAt));
  assert.ok(Date.parse(response.expiresAt) > Date.parse(response.observedAt));
});

test("inactive capabilities fail closed before execution", async () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-su", ownerId: "u:7", status: "testing" });
  const dynamodb = new FakeDynamo([{ su: "weather-su", computeCapability: manifest }]);
  let handler;
  let executions = 0;
  runEntityModule.register({
    on(name, fn) { if (name === "runEntity") handler = fn; },
    use() {
      return {
        deps: { dynamodb },
        getSub: async () => ({ Items: [{}] }),
        runComputeEntity: async () => { executions += 1; return {}; },
      };
    },
  });
  const response = await handler({
    path: "/weather-su",
    req: { body: { operationId: "current_conditions", inputs: { postal_code: "27560", date: "2026-07-17" } } },
    res: {},
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "ENTITY_DISABLED");
  assert.equal(executions, 0);
});

test("legacy runEntity callers retain precomputed-output behavior", async () => {
  const dynamodb = new FakeDynamo([{ su: "legacy-su", output: "legacy result" }]);
  let handler;
  runEntityModule.register({
    on(name, fn) { if (name === "runEntity") handler = fn; },
    use() {
      return {
        deps: { dynamodb },
        getSub: async () => ({ Items: [{ su: "legacy-su", output: "legacy result" }] }),
      };
    },
  });
  const response = await handler({ path: "/legacy-su", req: { body: {} }, res: {} });
  assert.equal(response, "legacy result");
});
