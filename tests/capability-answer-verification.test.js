"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANSWER_VERIFICATION_SCHEMA,
  cleanReviewContext,
  entityExecutionEvidence,
  verifyCapabilityAnswer,
} = require("../app/routes/capabilityAnswerVerification");

const manifest = {
  capabilityId: "weather",
  entityId: "entity-weather",
  name: "Weather",
  description: "Fetch weather for a place.",
  operations: [{
    operationId: "get_weather",
    description: "Fetch weather.",
    inputs: [{ name: "location", type: "string", bindingHint: { source: "utterance" } }],
    outputs: [{ name: "temperature", type: "number" }],
    utteranceExamples: ["Weather in New York"],
  }],
};

test("answer verification redacts protected bindings and entity secrets", () => {
  const context = cleanReviewContext({
    question: "weather in New York",
    answer: "83 degrees",
    computePlan: {
      inputBindings: [
        { name: "location", source: "utterance", value: "New York" },
        { name: "apikey", source: "protected_asset", value: "protected_asset:pa_secret" },
      ],
    },
  });
  const evidence = entityExecutionEvidence({
    published: {
      actions: [{ set: { apiKey: "must-not-escape", location: "London" } }],
    },
  });
  assert.equal(context.execution.inputBindings[0].value, "New York");
  assert.equal(context.execution.inputBindings[1].value, "[protected]");
  assert.equal(evidence.actions[0].set.apiKey, "[redacted]");
  assert.doesNotMatch(JSON.stringify({ context, evidence }), /pa_secret|must-not-escape/);
});

test("answer verification gives the strict reviewer the question, answer, JPL, and contract", async () => {
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
                  verdict: "entity_or_path",
                  target: "entity",
                  confidence: 0.99,
                  reason: "The question bound New York but the JPL provider request hard-coded London.",
                  recommendedChange: "Add location to the operation contract and pass the resolved location into the provider request.",
                  userMessage: "The answer was withheld because the entity ignored New York. May I prepare the entity repair in Edit?",
                  requiresImplementationChange: true,
                }),
              },
            }],
          };
        },
      },
    },
  };
  const verification = await verifyCapabilityAnswer({
    openai,
    manifest,
    entity: {
      published: {
        actions: [{
          target: "{|axios|}",
          chain: [{ access: "get", params: ["https://api.example.test/weather", { params: { q: "London" } }] }],
        }],
      },
    },
    reviewContext: {
      question: "What is the weather in New York?",
      answer: "83 degrees",
      pathMatch: {
        canonicalSig: "pattern:v3:weather",
        computeCapability: { operationId: "get_weather" },
        structuralMatch: { captures: { location: { text: "New York", type: "location" } } },
      },
      computePlan: {
        inputBindings: [{ name: "location", source: "utterance", value: "New York" }],
      },
      computeResult: { ok: true, output: { temperature: 83 } },
      pathRuntime: { source: "browser-capability-cache", cached: true },
    },
  });
  assert.equal(verification.verdict, "entity_or_path");
  assert.equal(verification.target, "entity");
  assert.equal(verification.requiresImplementationChange, true);
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.schema, ANSWER_VERIFICATION_SCHEMA);
  assert.match(request.messages[0].content, /declarative JPL actions/i);
  assert.match(request.messages[0].content, /covered by a Path but absent from operation inputs/i);
  assert.match(request.messages[1].content, /What is the weather in New York/);
  assert.match(request.messages[1].content, /83 degrees/);
  assert.match(request.messages[1].content, /London/);
  assert.match(request.messages[1].content, /browser-capability-cache/);
});

test("answer verification reports a platform problem when the model is unavailable", async () => {
  const verification = await verifyCapabilityAnswer({
    openai: null,
    manifest,
    entity: {},
    reviewContext: {},
  });
  assert.equal(verification.source, "model-unavailable");
  assert.equal(verification.verdict, "platform_logic");
  assert.equal(verification.target, "none");
});
