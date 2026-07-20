"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCapabilityManifest } = require("../app/routes/capabilityManifest");

test("input bindings are declared by each entity rather than a server domain table", () => {
  const value = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "terrain.elevation.lookup",
    entityId: "elevation-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: [{
      operationId: "lookup",
      inputs: [{
        name: "location_code",
        type: "string",
        required: true,
        bindingHint: {
          source: "contextdb",
          subject: "speaker",
          property: "location_code",
          aliases: ["home location", "mailing area"],
        },
        clarification: "What location code should I use?",
      }],
      outputs: [{ name: "elevation", type: "number", required: true }],
      utteranceExamples: ["What is my elevation?"],
      answerTemplate: "{{elevation}} feet",
    }],
  });
  const hint = value.operations[0].inputs[0].bindingHint;
  assert.equal(hint.source, "contextdb");
  assert.deepEqual(hint.aliases, ["home location", "mailing area"]);
});
