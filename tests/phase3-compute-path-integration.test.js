"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWeatherCapabilityManifest,
  validateCapabilityManifest,
} = require("../app/routes/capabilityManifest");
const { buildCapabilityPathDataset } = require("../app/routes/capabilityPaths");
const { __test: pathsTest } = require("../app/routes/modules/paths");

function approvedQuality() {
  return {
    schemaVersion: 1,
    score: 96,
    threshold: 75,
    approved: true,
    status: "approved",
    dimensions: {
      structuralNovelty: 100,
      semanticNovelty: 70,
      coverage: 75,
      composability: 70,
      collisionRisk: 100,
      slotReuse: 50,
      duplicateRisk: 100,
      offlineDeterminism: 100,
      testQuality: 100,
    },
    tests: {
      positive: { requested: 3, passed: 3 },
      negative: { requested: 3, passed: 3 },
    },
    collisions: { duplicates: [], conflicts: [] },
    blockers: [],
  };
}

test("weather manifest tells the front end how to bind inputs and build signatures", () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-entity", ownerId: "u:7", status: "active" });
  const operation = manifest.operations[0];
  assert.equal(operation.inputs.find((item) => item.name === "postal_code").bindingHint.property, "postal_code");
  assert.equal(operation.inputs.find((item) => item.name === "date").bindingHint.resolver, "relative_date");
  assert.equal(operation.pathContracts.length, 2);
  assert.equal(operation.pathContracts[0].pattern.operation, "invoke_compute_capability");
  assert.equal(operation.pathContracts[0].tests.positive.length, 3);
  assert.equal(operation.pathContracts[0].tests.negative.length, 3);
});

test("capability manifests reject executable Path fields", () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-entity", ownerId: "u:7", status: "active" });
  const unsafe = JSON.parse(JSON.stringify(manifest));
  unsafe.operations[0].pathContracts[0].handler = "window.open";
  assert.throws(
    () => validateCapabilityManifest(unsafe),
    /not allowed in a declarative Path contract/
  );
});

test("a registered manifest becomes deterministic post-classifier compute Paths", () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-entity", ownerId: "u:7", status: "active" });
  const dataset = buildCapabilityPathDataset(manifest);
  assert.equal(dataset.kind, "post-classifier-path-dataset");
  assert.equal(dataset.equations.length, 2);
  for (const path of dataset.equations) {
    assert.match(path.sig, /^pattern:v3:weather_/);
    assert.equal(path.right.lib, "computeCapability");
    assert.equal(path.right.state.compute.entityId, "weather-entity");
    assert.equal(path.right.state.compute.inputs[0].name, "postal_code");
    assert.deepEqual(path.right.state.rows, []);
    assert.deepEqual(path.right.state.levels, []);
  }
  assert.equal(/"(?:code|script|handler|eval|worker)"\s*:/.test(JSON.stringify(dataset)), false);
});

test("Compute Paths pass persistence validation only with an approved quality contract", () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-entity", ownerId: "u:7", status: "active" });
  const path = buildCapabilityPathDataset(manifest).equations[0];
  assert.throws(() => pathsTest.validatePathForPersistence(path), /require quality results/);
  path.quality = approvedQuality();
  assert.equal(pathsTest.validatePathForPersistence(path), true);
});

test("Compute Path persistence rejects identity changes and executable content", () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-entity", ownerId: "u:7", status: "active" });
  const path = buildCapabilityPathDataset(manifest).equations[0];
  path.quality = approvedQuality();
  path.right.state.compute.script = "fetch('https://evil.example')";
  assert.throws(() => pathsTest.validatePathForPersistence(path), /not allowed in a declarative command Path/);
});
