"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeOpenAiUsageTrace } = require("../app/modelUsage");

test("OpenAI Responses usage is reduced to cost-safe metadata", () => {
  const trace = sanitizeOpenAiUsageTrace({
    id: "resp_123",
    model: "gpt-5.6-terra",
    service_tier: "default",
    usage: {
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
      output_tokens: 250,
      output_tokens_details: { reasoning_tokens: 50 },
      total_tokens: 1450,
    },
    output_text: "must not be copied",
  }, "Entity generation");
  assert.deepEqual(trace, {
    schemaVersion: 1,
    provider: "openai",
    step: "Entity generation",
    model: "gpt-5.6-terra",
    responseId: "resp_123",
    serviceTier: "default",
    usage: {
      inputTokens: 1200,
      cachedInputTokens: 800,
      cacheWriteTokens: 100,
      outputTokens: 250,
      reasoningTokens: 50,
      totalTokens: 1450,
    },
  });
  assert.equal(JSON.stringify(trace).includes("must not be copied"), false);
});

test("Chat Completions token names normalize to the same contract", () => {
  const trace = sanitizeOpenAiUsageTrace({
    id: "chatcmpl_123",
    model: "gpt-4o-mini",
    usage: {
      prompt_tokens: 400,
      prompt_tokens_details: { cached_tokens: 100 },
      completion_tokens: 75,
      completion_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 475,
    },
  }, "Discovery");
  assert.equal(trace.usage.inputTokens, 400);
  assert.equal(trace.usage.cachedInputTokens, 100);
  assert.equal(trace.usage.outputTokens, 75);
  assert.equal(trace.usage.reasoningTokens, 5);
});
