"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createWeatherCapabilityManifest,
  validateCapabilityManifest,
} = require("../app/routes/capabilityManifest");
const { createCapabilityRegistry } = require("../app/routes/capabilityRegistry");

function containsBrowserPathFields(value) {
  if (Array.isArray(value)) return value.some(containsBrowserPathFields);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => (
    ["pathcontracts", "signatureslots", "expectedlocalsignature"]
      .includes(String(key).toLowerCase()) || containsBrowserPathFields(child)
  ));
}

test("weather manifest describes meaning, bindings, and examples without browser Path grammar", () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-entity", ownerId: "u:7", status: "active" });
  const operation = manifest.operations[0];
  assert.equal(operation.inputs.find((item) => item.name === "postal_code").bindingHint.property, "postal_code");
  assert.equal(operation.inputs.find((item) => item.name === "date").bindingHint.resolver, "relative_date");
  assert.deepEqual(operation.utteranceExamples, [
    "What is the weather today?",
    "How warm is it outside today?",
  ]);
  assert.equal(typeof operation.answerTemplate, "string");
  assert.equal(containsBrowserPathFields(manifest), false);
});

test("Compute rejects browser-owned Path fields in a capability manifest", () => {
  const manifest = createWeatherCapabilityManifest({ entityId: "weather-entity", ownerId: "u:7", status: "active" });
  manifest.operations[0].pathContracts = [{ pattern: { core: [{ kind: "lemma", value: "weather" }] } }];
  assert.throws(
    () => validateCapabilityManifest(manifest),
    /browser-owned Path fields/
  );
});

test("Convert returns the manifest and does not construct a capability Path dataset", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  assert.doesNotMatch(source, /buildCapabilityPathDataset/);
  assert.doesNotMatch(source, /capabilityPathDataset\s*:/);
  assert.match(source, /capabilityManifest/);
});

test("registry reuse migrates an already-stored Phase 3 Path contract without rebuilding the entity", async () => {
  const stored = createWeatherCapabilityManifest({ entityId: "existing-weather", ownerId: "u:7", status: "active" });
  delete stored.operations[0].answerTemplate;
  stored.operations[0].pathContracts = [{
    pattern: { core: [{ kind: "lemma", value: "be" }] },
    answerTemplate: "It is {{temperature}} {{temperature_unit}}.",
  }];
  const registry = createCapabilityRegistry({
    dynamodb: {
      scan: () => ({ promise: async () => ({ Items: [{ su: "existing-weather", computeCapability: stored }] }) }),
    },
  });
  const [manifest] = await registry.findByCapability("weather.current_conditions", { ownerId: "u:7" });
  assert.equal(manifest.entityId, "existing-weather");
  assert.equal(manifest.operations[0].pathContracts, undefined);
  assert.equal(manifest.operations[0].answerTemplate, "It is {{temperature}} {{temperature_unit}}.");
});
