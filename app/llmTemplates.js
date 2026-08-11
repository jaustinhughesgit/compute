/**
 * Platform: Resolves stable LLM treatment IDs under server policy instead of trusting client-supplied model names.
 * Technical: Applies route-specific model/reasoning fields to Chat Completions and Responses requests.
 */
"use strict";

const ORIGINAL_TEMPLATE_ID = "original-v1";
const NEW_TEMPLATE_ID = "new-v1";

function normalizeLlmTemplateId(value) {
  return String(value || "").trim().toLowerCase() === NEW_TEMPLATE_ID
    ? NEW_TEMPLATE_ID
    : ORIGINAL_TEMPLATE_ID;
}

function nonempty(value, fallback) {
  const result = String(value || "").trim();
  return result || fallback;
}

function originalModel(route, env) {
  if (route === "discovery") return nonempty(env.COMPUTE_DISCOVERY_MODEL, "gpt-4o-mini");
  if (route === "builder") return nonempty(env.COMPUTE_BUILDER_MODEL, "gpt-5.6-terra");
  if (route === "input-interpretation") {
    return nonempty(env.COMPUTE_CLARIFICATION_MODEL || env.COMPUTE_DISCOVERY_MODEL, "gpt-4o-mini");
  }
  if (route === "failure-diagnosis") {
    return nonempty(env.COMPUTE_DIAGNOSIS_MODEL || env.COMPUTE_DISCOVERY_MODEL, "gpt-4o-mini");
  }
  if (route === "answer-verification") {
    return nonempty(
      env.COMPUTE_ANSWER_VERIFICATION_MODEL || env.COMPUTE_DIAGNOSIS_MODEL || env.COMPUTE_DISCOVERY_MODEL,
      "gpt-4o-mini"
    );
  }
  throw new Error(`Unknown compute LLM route: ${String(route || "")}`);
}

function resolveComputeLlmRoute(templateId, route, options = {}) {
  const id = normalizeLlmTemplateId(templateId);
  const env = options.env || process.env;
  if (id === ORIGINAL_TEMPLATE_ID) {
    return { templateId: id, model: originalModel(route, env), reasoningEffort: null };
  }
  if (route === "input-interpretation") {
    return {
      templateId: id,
      model: nonempty(env.COMPUTE_CLARIFICATION_NEW_MODEL, "gpt-5.6-luna"),
      reasoningEffort: "none",
    };
  }
  const envByRoute = {
    discovery: "COMPUTE_DISCOVERY_NEW_MODEL",
    builder: "COMPUTE_BUILDER_NEW_MODEL",
    "failure-diagnosis": "COMPUTE_DIAGNOSIS_NEW_MODEL",
    "answer-verification": "COMPUTE_ANSWER_VERIFICATION_NEW_MODEL",
  };
  const envName = envByRoute[route];
  if (!envName) throw new Error(`Unknown compute LLM route: ${String(route || "")}`);
  return {
    templateId: id,
    model: nonempty(env[envName], "gpt-5.6-terra"),
    reasoningEffort: "low",
  };
}

function withChatTemplate(request, templateId, route, options = {}) {
  const selection = resolveComputeLlmRoute(templateId, route, options);
  const result = { ...request, model: selection.model };
  if (selection.reasoningEffort) result.reasoning_effort = selection.reasoningEffort;
  return result;
}

function withResponsesTemplate(request, templateId, route, options = {}) {
  const selection = resolveComputeLlmRoute(templateId, route, options);
  const result = { ...request, model: selection.model };
  if (selection.reasoningEffort) result.reasoning = { effort: selection.reasoningEffort };
  return result;
}

module.exports = {
  ORIGINAL_TEMPLATE_ID,
  NEW_TEMPLATE_ID,
  normalizeLlmTemplateId,
  resolveComputeLlmRoute,
  withChatTemplate,
  withResponsesTemplate,
};
