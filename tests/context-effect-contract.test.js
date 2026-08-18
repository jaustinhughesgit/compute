"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateCapabilityBuildRequest,
  validateCapabilityManifest,
} = require("../app/routes/capabilityManifest");
const { buildComputeEntitySpec } = require("../app/routes/capabilityBlueprints");
const { applyGeneratedAnswerPlan } = require("../app/routes/capabilityInputSemantics");
const { normalizeGeneratedConvertOwnerBindings } = require("../app/routes/capabilityInputSemantics");
const {
  DISCOVERY_RESPONSE_SCHEMA,
  normalizeGeneratedBuildRequest,
  repairGeneratedContextEffectTransitions,
  repairGeneratedEffectResponseTemplates,
  repairGeneratedEffectSpokenInputs,
  finalizeGeneratedBuildRequest,
} = require("../app/routes/capabilityDiscovery");

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
        newValue: "clean",
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
    newValue: "clean",
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
  generated.operations[0].inputs[0].bindingHint = {
    source: "contextdb",
    subject: "speaker",
    property: "car",
    resolver: null,
  };
  const request = validateCapabilityBuildRequest(generated);
  assert.equal(request.operations[0].inputs[0].bindingHint.source, "utterance");
  assert.equal(request.operations[0].inputs[0].bindingHint.resolver, "entity_reference");
  assert.equal(request.operations[0].inputs[0].bindingHint.property, undefined);
});

test("a fixed transition result has a literal semantic answer source", () => {
  const request = applyGeneratedAnswerPlan(carwashBuildRequest(), {
    source: "literal",
    operationId: "wash",
    subject: null,
    property: null,
    inputName: null,
    outputName: "state",
    statement: "The requested resulting state is clean.",
  });
  assert.equal(request.answerPlan.source, "literal");
  assert.equal(request.operations[0].inputs[0].bindingHint.source, "utterance");
  assert.ok(
    DISCOVERY_RESPONSE_SCHEMA.properties.answerPlan.anyOf[0]
      .properties.source.enum.includes("literal")
  );
});

test("deictic input repair remaps the ContextDB effect subject with the input", () => {
  const generated = carwashBuildRequest();
  const operation = generated.operations[0];
  operation.inputs[0].name = "user";
  operation.inputs[0].bindingHint = {
    source: "contextdb",
    subject: "speaker",
    property: "car",
  };
  operation.utteranceExamples = operation.utteranceExamples.map((example) => ({
    ...example,
    inputs: { user: example.inputs.vehicle },
  }));
  operation.contextEffects[0].subjectInput = "user";

  const repaired = normalizeGeneratedConvertOwnerBindings(generated, [
    "Build an app that changes my car from dirty to clean.",
  ]);
  assert.equal(repaired.operations[0].inputs[0].name, "car");
  assert.equal(repaired.operations[0].contextEffects[0].subjectInput, "car");
});

test("a dangling generated effect reference uses the sole compatible spoken subject", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].inputs[0].name = "car";
  generated.operations[0].utteranceExamples = generated.operations[0].utteranceExamples.map((example) => ({
    ...example,
    inputs: { car: example.inputs.vehicle },
  }));
  generated.operations[0].contextEffects[0].subjectInput = "my_car";
  const request = validateCapabilityBuildRequest(generated);
  assert.equal(request.operations[0].contextEffects[0].subjectInput, "car");
  assert.deepEqual(request.operations[0].inputs[0].bindingHint, {
    source: "utterance",
    resolver: "entity_reference",
  });
});

test("an effect current value cannot masquerade as its annotated spoken subject", () => {
  const generated = carwashBuildRequest();
  const operation = generated.operations[0];
  operation.inputs.push({
    name: "dirty_state",
    type: "string",
    required: true,
    description: "The prior state.",
    bindingHint: { source: "utterance", resolver: "string" },
    clarification: "What is the prior state?",
  });
  operation.utteranceExamples = operation.utteranceExamples.map((example) => ({
    ...example,
    inputs: { ...example.inputs, dirty_state: "dirty" },
  }));
  operation.contextEffects[0].subjectInput = "dirty";
  const request = validateCapabilityBuildRequest(generated);
  assert.equal(request.operations[0].contextEffects[0].subjectInput, "vehicle");
});

test("an effect precondition removes a redundant defaulted ContextDB input", () => {
  const generated = carwashBuildRequest();
  generated.answerPlan = {
    source: "literal",
    operationId: "wash",
    subject: null,
    property: null,
    inputName: null,
    outputName: "state",
    statement: "The resulting state is clean.",
  };
  generated.operations[0].inputs.push({
    name: "current_status",
    type: "string",
    required: true,
    description: "The current locally stored status.",
    defaultValue: "dirty",
    bindingHint: { source: "contextdb", subject: "speaker", property: "condition" },
    clarification: "What is the current status?",
  });
  generated.operations[0].utteranceExamples[0].inputs.current_status = "dirty";
  const request = validateCapabilityBuildRequest(generated);
  assert.deepEqual(request.operations[0].inputs.map((input) => input.name), ["vehicle"]);
  assert.equal(request.operations[0].utteranceExamples[0].inputs.current_status, undefined);
});

test("a literal fixed-effect plan removes an unreferenced ContextDB precondition input", () => {
  const generated = carwashBuildRequest();
  generated.answerPlan = {
    source: "literal",
    operationId: "wash",
    subject: null,
    property: null,
    inputName: null,
    outputName: "state",
    statement: "The resulting state is clean.",
  };
  generated.operations[0].inputs.push({
    name: "condition",
    type: "string",
    required: true,
    description: "The locally stored condition.",
    bindingHint: { source: "contextdb", subject: "speaker", property: "condition" },
    clarification: "What is the condition?",
  });
  const request = validateCapabilityBuildRequest(generated);
  assert.deepEqual(request.operations[0].inputs.map((input) => input.name), ["vehicle"]);
});

test("a subject sample hard-coded in the answer becomes the invocation placeholder", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].answerTemplate = "Your car is clean";
  generated.operations[0].utteranceExamples = generated.operations[0].utteranceExamples.map((example) => ({
    ...example,
    inputs: { vehicle: "car" },
  }));
  const request = validateCapabilityBuildRequest(generated);
  assert.equal(request.operations[0].answerTemplate, "Your {{vehicle}} is clean");
  assert.deepEqual(
    request.operations[0].utteranceExamples.map((example) => example.inputs.vehicle),
    ["car", "camry", "toyota"]
  );
});

test("an explicit hard-stop transition repairs a missing generated new value", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].contextEffects[0].newValue = "";
  const repaired = repairGeneratedContextEffectTransitions(generated, [
    "Switch the selected object from dirty to clean.",
    "Update its status from dirty to clean.",
  ]);
  assert.equal(repaired.operations[0].contextEffects[0].newValue, "clean");
});

test("a unique operation and output complete omitted answer-plan identifiers", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].outputs = generated.operations[0].outputs.filter((output) => output.name === "state");
  const request = normalizeGeneratedBuildRequest({
    decision: "build_compute",
    operationId: "wash",
    answerPlan: {
      source: "literal",
      operationId: null,
      subject: null,
      property: null,
      inputName: null,
      outputName: null,
      statement: "The resulting state is clean.",
    },
    capabilityRequest: generated,
  }, "Build a vehicle cleaner.", "u:test", [
    "Switch the selected object from dirty to clean.",
  ]);
  assert.equal(request.answerPlan.operationId, "wash");
  assert.equal(request.answerPlan.outputName, "state");
});

test("declared response variants own the exact effect answer template", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].answerTemplate = "Your {{{vehicle}}} is clean.";
  const repaired = repairGeneratedEffectResponseTemplates(generated, [
    "It will respond \"Your car is clean\", \"Your Camry is clean\" or \"Your Toyota is clean\".",
  ]);
  assert.equal(repaired.operations[0].answerTemplate, "Your {{vehicle}} is clean");
});

test("a one-slot declared command family removes invented required spoken inputs", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].answerTemplate = "Your {{vehicle}} is clean";
  generated.operations[0].inputs.push(
    {
      name: "make",
      type: "string",
      required: true,
      bindingHint: { source: "utterance", subject: "speaker", property: "make" },
    },
    {
      name: "model",
      type: "string",
      required: true,
      bindingHint: { source: "utterance", subject: "speaker", property: "model" },
    }
  );
  generated.operations[0].utteranceExamples = generated.operations[0].utteranceExamples.map((example) => ({
    ...example,
    inputs: { ...example.inputs, make: "Toyota", model: "Camry" },
  }));
  const repaired = repairGeneratedEffectSpokenInputs(generated, [
    "I can say, \"wash my car\", \"wash my camry\" or \"wash my toyota\".",
  ]);
  assert.deepEqual(repaired.operations[0].inputs.map((input) => input.name), ["vehicle"]);
  assert.deepEqual(
    repaired.operations[0].utteranceExamples.map((example) => Object.keys(example.inputs)),
    [["vehicle"], ["vehicle"], ["vehicle"]]
  );
});

test("validated effect semantics make declared responses authoritative before publication", () => {
  const generated = carwashBuildRequest();
  generated.operations[0].answerTemplate = "Your {{vehicle}} is clean.";
  generated.operations[0].inputs.push(
    {
      name: "make",
      type: "string",
      required: true,
      bindingHint: { source: "utterance" },
      clarification: "Which make?",
    },
    {
      name: "model",
      type: "string",
      required: true,
      bindingHint: { source: "utterance" },
      clarification: "Which model?",
    }
  );
  generated.operations[0].utteranceExamples = generated.operations[0].utteranceExamples.map((example) => ({
    ...example,
    inputs: { vehicle: "car", make: "Toyota", model: "Camry" },
  }));
  const repaired = finalizeGeneratedBuildRequest(generated, [
    "I can say, \"wash my car\", \"wash my camry\" or \"wash my toyota\".",
    "It will respond \"Your car is clean\", \"Your Camry is clean\" or \"Your Toyota is clean\".",
  ]);
  assert.deepEqual(repaired.operations[0].inputs.map((input) => input.name), ["vehicle"]);
  assert.equal(repaired.operations[0].answerTemplate, "Your {{vehicle}} is clean");
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
