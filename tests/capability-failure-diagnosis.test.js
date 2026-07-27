"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FAILURE_DIAGNOSIS_SCHEMA,
  cleanFailureContext,
  diagnoseCapabilityFailure,
} = require("../app/routes/capabilityFailureDiagnosis");

const manifest = {
  capabilityId: "weather_today",
  entityId: "entity-weather",
  name: "Weather today",
  description: "Fetch current weather.",
  operations: [{
    operationId: "get_weather_today",
    description: "Fetch current weather for a location.",
    inputs: [{
      name: "location",
      type: "string",
      description: "A requested place.",
      bindingHint: { source: "utterance" },
    }],
    outputs: [{ name: "condition", type: "string" }],
    utteranceExamples: ["What is the weather in New York?"],
  }],
};

test("failure diagnosis redacts protected bindings before model use", () => {
  const cleaned = cleanFailureContext({
    utterance: "weather in Raleigh",
    path: { captures: { location: { text: "Raleigh", type: "string" } } },
    execution: {
      inputBindings: [
        { name: "location", source: "utterance", value: "Raleigh" },
        { name: "apikey", source: "protected_asset", value: "protected_asset:pa_secret" },
      ],
    },
  });
  assert.equal(cleaned.execution.inputBindings[0].value, "Raleigh");
  assert.equal(cleaned.execution.inputBindings[1].value, "[protected]");
  assert.doesNotMatch(JSON.stringify(cleaned), /pa_secret/);
});

test("failure diagnosis uses a strict read-only model contract", async () => {
  let request = null;
  const openai = {
    chat: {
      completions: {
        create: async (value) => {
          request = value;
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  classification: "entity_or_path",
                  target: "entity",
                  confidence: 0.96,
                  reason: "The Path captured the complete location, but the entity sent a provider-incompatible representation.",
                  recommendedChange: "Normalize region names to provider-compatible location parameters before lookup.",
                  userQuestion: "May I prepare this entity revision in Edit?",
                }),
              },
            }],
          };
        },
      },
    },
  };
  const diagnosis = await diagnoseCapabilityFailure({
    openai,
    manifest,
    failureContext: {
      utterance: "what is the weather in Raleigh North Carolina",
      failure: { code: "PROVIDER_REQUEST_REJECTED", message: "OpenWeather could not find data." },
      path: { captures: { location: { text: "raleigh north carolina", type: "string" } } },
      execution: { operationId: "get_weather_today" },
    },
  });
  assert.equal(diagnosis.classification, "entity_or_path");
  assert.equal(diagnosis.target, "entity");
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.schema, FAILURE_DIAGNOSIS_SCHEMA);
  assert.match(request.messages[0].content, /read-only/i);
  assert.match(diagnosis.userQuestion, /Edit/);
});

test("failure diagnosis fails closed when the model is unavailable", async () => {
  const diagnosis = await diagnoseCapabilityFailure({ openai: null, manifest, failureContext: {} });
  assert.equal(diagnosis.source, "model-unavailable");
  assert.equal(diagnosis.classification, "platform_logic");
  assert.equal(diagnosis.target, "none");
});
