"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeLlmTemplateId,
  resolveComputeLlmRoute,
  withChatTemplate,
  withResponsesTemplate,
} = require("../app/llmTemplates");

test("unknown compute template ids fall back to Original", () => {
  assert.equal(normalizeLlmTemplateId("gpt-5.6-sol"), "original-v1");
  assert.equal(normalizeLlmTemplateId("new-v1"), "new-v1");
});

test("Original preserves legacy models and omitted reasoning", () => {
  const env = {
    COMPUTE_DISCOVERY_MODEL: "legacy-discovery",
    COMPUTE_BUILDER_MODEL: "legacy-builder",
  };
  assert.deepEqual(resolveComputeLlmRoute("original-v1", "discovery", { env }), {
    templateId: "original-v1",
    model: "legacy-discovery",
    reasoningEffort: null,
  });
  assert.deepEqual(withChatTemplate({ temperature: 0 }, "original-v1", "builder", { env }), {
    temperature: 0,
    model: "legacy-builder",
  });
});

test("New maps simple interpretation to Luna none and complex work to Terra low", () => {
  assert.deepEqual(resolveComputeLlmRoute("new-v1", "input-interpretation", { env: {} }), {
    templateId: "new-v1",
    model: "gpt-5.6-luna",
    reasoningEffort: "none",
  });
  for (const route of ["discovery", "builder", "failure-diagnosis", "answer-verification"]) {
    assert.deepEqual(resolveComputeLlmRoute("new-v1", route, { env: {} }), {
      templateId: "new-v1",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    });
  }
});

test("endpoint helpers use the correct GPT-5.6 reasoning field", () => {
  assert.deepEqual(withChatTemplate({ messages: [] }, "new-v1", "discovery", { env: {} }), {
    messages: [],
    model: "gpt-5.6-terra",
    reasoning_effort: "low",
  });
  assert.deepEqual(withResponsesTemplate({ input: [] }, "new-v1", "builder", { env: {} }), {
    input: [],
    model: "gpt-5.6-terra",
    reasoning: { effort: "low" },
  });
});
