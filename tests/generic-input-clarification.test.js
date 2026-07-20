"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAX_ATTEMPTS,
  INPUT_INTERPRETATION_SCHEMA,
  interpretCapabilityInput,
} = require("../app/routes/capabilityInputInterpretation");

function modelReturning(value, capture = null) {
  return {
    chat: { completions: { create: async (request) => {
      if (capture) capture.request = request;
      return { choices: [{ message: { content: JSON.stringify(value) } }] };
    } } },
  };
}

const locationField = {
  name: "location",
  type: "string",
  required: true,
  description: "A city and region or postal code used to locate the user.",
  bindingHint: { source: "utterance" },
  clarification: "What city and state or ZIP code should I use? For example, Raleigh, NC.",
};

test("clarification interpretation accepts and validates a normalized response", async () => {
  const capture = {};
  const result = await interpretCapabilityInput({
    openai: modelReturning({
      decision: "accept",
      normalizedValueJson: JSON.stringify("27560"),
      question: null,
      reason: "A five-digit postal code is an unambiguous location.",
      confidence: 0.99,
    }, capture),
    field: locationField,
    originalQuestion: "What is the weather today?",
    previousQuestion: "What city and state or ZIP code should I use?",
    userResponse: "My ZIP is 27560.",
    attempt: 1,
  });
  assert.equal(result.decision, "accept");
  assert.equal(result.normalizedValue, "27560");
  assert.equal(capture.request.response_format.type, "json_schema");
  assert.equal(capture.request.response_format.json_schema.strict, true);
  assert.equal(capture.request.response_format.json_schema.schema, INPUT_INTERPRETATION_SCHEMA);
});

test("ambiguous responses receive one more specific model-authored question", async () => {
  const result = await interpretCapabilityInput({
    openai: modelReturning({
      decision: "retry",
      normalizedValueJson: null,
      question: "What city in North Carolina should I use, or what is the ZIP code?",
      reason: "A state alone is not specific enough.",
      confidence: 0.97,
    }),
    field: locationField,
    originalQuestion: "What is the weather today?",
    previousQuestion: "What location should I use?",
    userResponse: "North Carolina",
    attempt: 2,
  });
  assert.equal(result.decision, "retry");
  assert.match(result.question, /city in North Carolina|ZIP code/);
  assert.equal(result.attempt, 2);
  assert.equal(result.maxAttempts, MAX_ATTEMPTS);
});

test("model acceptance cannot bypass deterministic type validation", async () => {
  const result = await interpretCapabilityInput({
    openai: modelReturning({
      decision: "accept",
      normalizedValueJson: JSON.stringify("many"),
      question: null,
      reason: "Accepted.",
      confidence: 0.9,
    }),
    field: { name: "count", type: "integer", required: true, clarification: "What whole number should I use?" },
    userResponse: "many",
    attempt: 1,
  });
  assert.equal(result.decision, "retry");
  assert.equal(result.normalizedValue, null);
});

test("explicit cancellation does not call the model", async () => {
  let calls = 0;
  const result = await interpretCapabilityInput({
    openai: { chat: { completions: { create: async () => { calls += 1; } } } },
    field: locationField,
    userResponse: "never mind",
  });
  assert.equal(result.decision, "cancel");
  assert.equal(calls, 0);
});

test("the capabilities route exposes the bounded interpretation action", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/capabilities.js"), "utf8");
  assert.match(source, /action === "interpret-input"/);
  assert.match(source, /interpretCapabilityInput/);
  assert.match(source, /body\.attempt/);
});
