"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CapabilityError,
  validateCapabilityManifest,
  validateCapabilityBuildRequest,
  validateInvocationInputs,
  validateOperationResult,
} = require("../app/routes/capabilityManifest");

function manifest() {
  return validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "place.coordinates.lookup",
    entityId: "coordinates-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    description: "Returns coordinates for a named place.",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: [{
      operationId: "lookup",
      inputs: [{
        name: "place",
        type: "string",
        required: true,
        bindingHint: { source: "utterance", resolver: "place" },
        clarification: "Which place should I use?",
      }],
      outputs: [
        { name: "latitude", type: "number", required: true },
        { name: "longitude", type: "number", required: true },
      ],
      utteranceExamples: [{
        text: "What are the coordinates of Raleigh, NC?",
        inputs: { place: "Raleigh, NC" },
      }],
      answerTemplate: "{{latitude}}, {{longitude}}",
    }],
  });
}

test("capability manifests describe entity behavior without domain-specific server helpers", () => {
  const value = manifest();
  assert.equal(value.capabilityId, "place.coordinates.lookup");
  assert.equal(value.operations[0].inputs[0].bindingHint.source, "utterance");
});

test("build requests retain only validated semantic contracts", () => {
  const value = manifest();
  const request = validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: value.capabilityId,
    description: value.description,
    operations: value.operations,
  });
  assert.equal(request.operations[0].operationId, "lookup");
  assert.equal(JSON.stringify(request).includes("pattern"), false);
});

test("missing entity inputs return the manifest's typed clarification contract", () => {
  assert.throws(() => validateInvocationInputs(manifest(), "lookup", {}), (error) => {
    assert.equal(error instanceof CapabilityError, true);
    assert.equal(error.code, "MISSING_INPUT");
    assert.equal(error.details.field, "place");
    assert.match(error.details.clarification, /which place/i);
    return true;
  });
});

test("entity outputs are validated generically and strict numeric strings are normalized", () => {
  const operation = manifest().operations[0];
  const result = validateOperationResult(operation, { latitude: "35.7796", longitude: "-78.6382" });
  assert.equal(result.latitude, 35.7796);
  assert.equal(result.longitude, -78.6382);
  assert.throws(() => validateOperationResult(operation, { latitude: "north", longitude: -78.6 }), /latitude must be number/);
});
