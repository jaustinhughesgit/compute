"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { __test: pathsTest } = require("../app/routes/modules/paths");

function approvedQuality() {
  return {
    schemaVersion: 1,
    score: 95,
    threshold: 75,
    approved: true,
    status: "approved",
    dimensions: { contractSafety: 100 },
    blockers: [],
    collisions: { conflicts: [] },
  };
}

function computePath(answerTemplate) {
  return {
    sig: "pattern:v3:generic_template_contract",
    left: {
      lib: "tokens",
      state: {
        pattern: {
          schemaVersion: 3,
          patternId: "generic_template_contract",
          kind: "question",
          operation: "invoke_compute_capability",
          core: [{ kind: "lemma", value: "conditions" }],
          modifiers: [],
          projection: null,
          slotDefinitions: [],
          tokenizerAliases: [],
        },
      },
    },
    right: {
      lib: "computeCapability",
      state: {
        schemaVersion: 3,
        mode: "question",
        familyId: "generic_template_contract",
        operation: "invoke_compute_capability",
        rows: [],
        levels: [],
        compute: {
          schemaVersion: 1,
          capabilityId: "place.conditions",
          entityId: "entity-1",
          version: 1,
          operationId: "lookup",
          inputs: [{
            name: "place",
            type: "string",
            required: true,
            bindingHint: { source: "utterance" },
          }],
          outputs: [{ name: "conditions", type: "string", required: true }],
          answerTemplate,
        },
      },
    },
    tests: {
      schemaVersion: 1,
      positive: [{ input: "Conditions in Raleigh?" }, { input: "Conditions in Durham?" }],
      negative: [{ input: "Open Raleigh" }, { input: "Save Durham" }],
    },
    quality: approvedQuality(),
  };
}

test("compute Path persistence accepts answer templates using declared inputs and outputs", () => {
  assert.equal(
    pathsTest.validatePathForPersistence(
      computePath("The conditions in {{place}} are {{conditions}}.")
    ),
    true
  );
});

test("compute Path persistence rejects answer templates using unknown values", () => {
  assert.throws(
    () => pathsTest.validatePathForPersistence(computePath("{{place}}: {{forecast}}")),
    /answerTemplate references an undeclared input or output/
  );
});
