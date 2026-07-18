"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WEATHER_CAPABILITY_ID,
  buildComputeEntitySpec,
  getCapabilityBlueprint,
  validateTrustedImplementation,
} = require("../app/routes/capabilityBlueprints");
const {
  discoverComputeCapability,
} = require("../app/routes/capabilityDiscovery");
const {
  stableHash,
  createCapabilityBuildCoordinator,
} = require("../app/routes/capabilityBuildCoordinator");
const { createCapabilityRegistry } = require("../app/routes/capabilityRegistry");
const capabilitiesModule = require("../app/routes/modules/capabilities");

class FakeDynamo {
  constructor(items = []) {
    this.items = new Map(items.map((item) => [String(item.su), structuredClone(item)]));
  }

  get({ Key }) {
    return { promise: async () => ({ Item: this.items.has(String(Key.su)) ? structuredClone(this.items.get(String(Key.su))) : undefined }) };
  }

  put({ Item, ExpressionAttributeValues }) {
    return {
      promise: async () => {
        const key = String(Item.su);
        const existing = this.items.get(key);
        const now = Number(ExpressionAttributeValues?.[":now"] || 0);
        if (existing && Number(existing.capabilityBuildLeaseExpiresAt || 0) >= now) {
          const error = new Error("conditional check failed");
          error.code = "ConditionalCheckFailedException";
          throw error;
        }
        this.items.set(key, structuredClone(Item));
        return {};
      },
    };
  }

  update({ Key, ExpressionAttributeValues }) {
    return {
      promise: async () => {
        const key = String(Key.su);
        const item = this.items.get(key) || { su: key };
        if (ExpressionAttributeValues[":manifest"]) {
          item.computeCapability = structuredClone(ExpressionAttributeValues[":manifest"]);
          item.capabilityId = ExpressionAttributeValues[":capabilityId"];
          item.capabilityVersion = ExpressionAttributeValues[":capabilityVersion"];
          item.capabilityStatus = ExpressionAttributeValues[":capabilityStatus"];
          item.capabilityOwnerId = ExpressionAttributeValues[":capabilityOwnerId"];
        }
        if (ExpressionAttributeValues[":status"]) item.capabilityBuildStatus = ExpressionAttributeValues[":status"];
        if (ExpressionAttributeValues[":entity"]) item.capabilityEntityId = ExpressionAttributeValues[":entity"];
        if (ExpressionAttributeValues[":version"]) item.capabilityVersion = ExpressionAttributeValues[":version"];
        if (ExpressionAttributeValues[":code"]) item.capabilityBuildErrorCode = ExpressionAttributeValues[":code"];
        if (ExpressionAttributeValues[":completed"]) item.capabilityBuildCompletedAt = ExpressionAttributeValues[":completed"];
        this.items.set(key, item);
        return {};
      },
    };
  }

  scan() {
    return { promise: async () => ({ Items: Array.from(this.items.values()).map((item) => structuredClone(item)) }) };
  }
}

test("an unanswered current-weather question becomes a declarative compute build", async () => {
  const discovery = await discoverComputeCapability({
    utterance: "What is the weather today?",
    requestedBy: "u:7",
    useModel: false,
  });
  assert.equal(discovery.decision, "build");
  assert.equal(discovery.essence.type, "compute");
  assert.equal(discovery.essence.capabilityId, WEATHER_CAPABILITY_ID);
  assert.equal(discovery.buildCommand.kind, "createComputeCapability");
  assert.equal(discovery.buildCommand.capabilityRequest.operations[0].inputs[0].name, "postal_code");
  assert.equal(JSON.stringify(discovery.buildCommand).includes("https://"), false);
  assert.equal(JSON.stringify(discovery.buildCommand).includes("function"), false);
});

test("future forecasts fail closed until their own blueprint exists", async () => {
  const discovery = await discoverComputeCapability({
    utterance: "Will it rain tomorrow?",
    requestedBy: "u:7",
    useModel: false,
  });
  assert.equal(discovery.decision, "unsupported");
  assert.equal(discovery.essence.capabilityId, "weather.forecast");
  assert.equal(discovery.buildCommand, null);
});

test("ordinary storage language is not misclassified as compute", async () => {
  const discovery = await discoverComputeCapability({
    utterance: "Remember that my boat is blue.",
    requestedBy: "u:7",
    useModel: false,
  });
  assert.equal(discovery.decision, "not_compute");
  assert.equal(discovery.essence, null);
});

test("the approved weather blueprint owns provider code and manifest fields", () => {
  const blueprint = getCapabilityBlueprint(WEATHER_CAPABILITY_ID, { requestedBy: "u:7" });
  assert.equal(blueprint.approved, true);
  assert.equal(blueprint.manifest.status, "active");
  assert.equal(blueprint.manifest.operations[0].inputs[0].bindingHint.property, "postal_code");
  assert.deepEqual(blueprint.published.modules, { axios: "axios" });
  assert.match(JSON.stringify(blueprint.published.actions), /open-meteo\.com/);
});

test("blueprint validation rejects arbitrary provider hosts", () => {
  assert.throws(
    () => validateTrustedImplementation({
      published: {
        modules: { axios: "axios" },
        actions: [{ target: "{|axios|}", chain: [{ access: "get", params: ["https://evil.example/steal"] }] }],
      },
    }),
    /unapproved provider host/
  );
});

test("compute entity specs contain data, never executable JavaScript", () => {
  const spec = buildComputeEntitySpec({
    capabilityId: WEATHER_CAPABILITY_ID,
    requestedBy: "u:7",
    originalUtterance: "What is the weather today?",
  });
  assert.equal(spec.computeEntity.approved, true);
  assert.equal(typeof spec.computeEntity.published.actions, "object");
  assert.equal(Object.prototype.hasOwnProperty.call(spec.computeEntity, "code"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(spec.computeEntity, "function"), false);
});

test("build coordination allows one creator and makes concurrent misses wait", async () => {
  const dynamodb = new FakeDynamo();
  const coordinator = createCapabilityBuildCoordinator({ dynamodb });
  const first = await coordinator.claim({
    ownerId: "u:7",
    capabilityId: WEATHER_CAPABILITY_ID,
    requestHash: stableHash("weather request"),
  });
  const second = await coordinator.claim({
    ownerId: "u:7",
    capabilityId: WEATHER_CAPABILITY_ID,
    requestHash: stableHash("weather request"),
  });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.buildId, first.buildId);
  assert.equal(second.record.capabilityBuildStatus, "building");
});

test("completed builds retain only coordination metadata and the entity id", async () => {
  const dynamodb = new FakeDynamo();
  const coordinator = createCapabilityBuildCoordinator({ dynamodb });
  const claim = await coordinator.claim({ ownerId: "u:7", capabilityId: WEATHER_CAPABILITY_ID, requestHash: stableHash("request") });
  await coordinator.complete(claim, { entityId: "weather-su", version: 1 });
  const record = await coordinator.get(claim);
  assert.equal(record.capabilityBuildStatus, "completed");
  assert.equal(record.capabilityEntityId, "weather-su");
  assert.equal(Object.prototype.hasOwnProperty.call(record, "originalUtterance"), false);
});

test("capability reuse is isolated by owner unless the capability is system-owned", async () => {
  const privateBlueprint = getCapabilityBlueprint(WEATHER_CAPABILITY_ID, { requestedBy: "u:7" });
  const systemBlueprint = getCapabilityBlueprint(WEATHER_CAPABILITY_ID, { requestedBy: "system" });
  const privateManifest = { ...privateBlueprint.manifest, entityId: "weather-private" };
  const systemManifest = { ...systemBlueprint.manifest, entityId: "weather-system", version: 2 };
  const dynamodb = new FakeDynamo([
    { su: "weather-private", capabilityId: WEATHER_CAPABILITY_ID, computeCapability: privateManifest },
    { su: "weather-system", capabilityId: WEATHER_CAPABILITY_ID, computeCapability: systemManifest },
  ]);
  const registry = createCapabilityRegistry({ dynamodb });
  const userSeven = await registry.findByCapability(WEATHER_CAPABILITY_ID, { ownerId: "u:7" });
  const userEight = await registry.findByCapability(WEATHER_CAPABILITY_ID, { ownerId: "u:8" });
  assert.deepEqual(userSeven.map((item) => item.entityId).sort(), ["weather-private", "weather-system"]);
  assert.deepEqual(userEight.map((item) => item.entityId), ["weather-system"]);
});

test("the capabilities route exposes discovery without creating an entity", async () => {
  const dynamodb = new FakeDynamo();
  let handler;
  capabilitiesModule.register({
    on(name, fn) { if (name === "capabilities") handler = fn; },
    use() { return { deps: { dynamodb } }; },
  });
  const response = await handler({
    path: "/discover",
    cookie: { e: 7 },
    req: { body: { utterance: "What is the weather today?", deterministicOnly: true } },
  });
  assert.equal(response.ok, true);
  assert.equal(response.discovery.decision, "build");
  assert.equal(dynamodb.items.size, 0);
});
