"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateCapabilityBuildRequest,
  validateCapabilityManifest,
} = require("../app/routes/capabilityManifest");
const { buildComputeEntitySpec } = require("../app/routes/capabilityBlueprints");

function carwashBuildRequest() {
  return {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "vehicle.clean",
    name: "Vehicle cleaner",
    description: "Changes one resolved vehicle state from dirty to clean.",
    operations: [{
      operationId: "wash",
      description: "Wash the referenced vehicle.",
      inputs: [{
        name: "vehicle",
        type: "string",
        required: true,
        description: "The user's vehicle reference.",
        bindingHint: { source: "utterance", resolver: "entity_reference" },
        clarification: "Which vehicle should I wash?",
      }],
      outputs: [
        { name: "vehicle", type: "string", required: true, description: "The supplied vehicle reference." },
        { name: "state", type: "string", required: true, description: "The resulting clean state." },
      ],
      freshness: { mode: "none", ttlSeconds: 0 },
      answerTemplate: "Your {{vehicle}} is {{state}}",
      utteranceExamples: [
        { text: "wash my car", inputs: { vehicle: "car" } },
        { text: "wash my camry", inputs: { vehicle: "camry" } },
        { text: "wash my toyota", inputs: { vehicle: "toyota" } },
      ],
      calculation: null,
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "vehicle",
        currentValue: "dirty",
        valueOutput: "state",
      }],
    }],
  };
}

test("a ContextDB replacement effect is part of the validated capability contract", () => {
  const request = validateCapabilityBuildRequest(carwashBuildRequest());
  assert.deepEqual(request.operations[0].contextEffects, [{
    type: "contextdb.replace_object",
    subjectInput: "vehicle",
    currentValue: "dirty",
    valueOutput: "state",
  }]);
  assert.throws(() => validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "vehicle.clean",
    entityId: "entity-carwash",
    version: 1,
    status: "active",
    execution: { type: "remote", readOnly: true, timeoutMs: 15000 },
    operations: request.operations,
  }), /cannot be cached|read-only|context effect/i);
});

test("an effect subject repairs a model-generated spoken-string resolver", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].inputs[0].bindingHint.resolver = "literal";
  const request = validateCapabilityBuildRequest(generated);
  assert.equal(request.operations[0].inputs[0].bindingHint.resolver, "entity_reference");
});

test("a capability with ContextDB effects is built as non-read-only JPL", async () => {
  const spec = await buildComputeEntitySpec({
    capabilityRequest: carwashBuildRequest(),
    requestedBy: "u:test",
    originalUtterance: "Build a reusable vehicle cleaner.",
    generatedImplementation: {
      name: "Vehicle cleaner",
      provider: "local declarative state transition",
      published: {
        modules: {},
        actions: [{
          target: "{|res|}!",
          chain: [{ access: "send", params: [{
            vehicle: "{|req=>body.vehicle|}",
            state: "clean",
          }] }],
        }],
        data: {},
      },
    },
  });
  assert.equal(spec.computeEntity.manifest.execution.readOnly, false);
  assert.equal(spec.computeEntity.manifest.operations[0].contextEffects[0].currentValue, "dirty");
  assert.deepEqual(spec.computeEntity.published.actions[0].chain[0].params[0], {
    vehicle: "{|req=>body.vehicle|}",
    state: "clean",
  });
});
