"use strict";

function sanitizeOpenAiUsageTrace(response, step) {
  const usage = response?.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {};
  const outputDetails = usage.output_tokens_details || usage.completion_tokens_details || {};
  const number = (...values) => {
    const value = values.find((candidate) => Number.isFinite(Number(candidate)));
    return value === undefined ? 0 : Math.max(0, Number(value));
  };
  return {
    schemaVersion: 1,
    provider: "openai",
    step: String(step || "model-call"),
    model: String(response?.model || ""),
    responseId: String(response?.id || ""),
    serviceTier: String(response?.service_tier || response?.serviceTier || "standard"),
    usage: {
      inputTokens: number(usage.input_tokens, usage.prompt_tokens),
      cachedInputTokens: number(inputDetails.cached_tokens, inputDetails.cachedTokens),
      cacheWriteTokens: number(inputDetails.cache_write_tokens, inputDetails.cache_creation_tokens, inputDetails.cacheWriteTokens),
      outputTokens: number(usage.output_tokens, usage.completion_tokens),
      reasoningTokens: number(outputDetails.reasoning_tokens, outputDetails.reasoningTokens),
      totalTokens: number(usage.total_tokens, usage.totalTokens),
    },
  };
}

module.exports = { sanitizeOpenAiUsageTrace };
