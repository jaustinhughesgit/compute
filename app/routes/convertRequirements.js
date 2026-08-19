/**
 * Platform: Preserves user-authored Convert requirements and bounded ordinary authoring context without importing protected data.
 * Technical: Validates the v1 Convert prompt envelope, recent-input summaries, and browser-proven Essence rows used by capability discovery.
 */
"use strict";

const MAX_REQUIREMENT_SEGMENTS = 12;
const MAX_REQUIREMENT_SEGMENT_LENGTH = 1_000;
const MAX_COMBINED_REQUIREMENT_LENGTH = 4_000;
const MAX_DECLARED_INVOCATION_EXAMPLES = 8;
const MAX_AUTHORING_RECENT_INPUTS = 20;
const MAX_AUTHORING_ESSENCE_ROWS = 120;

const DECLARED_LIST_CONJUNCTION = /\s*(?:,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)\s*/i;

function cleanRequirementText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRequirementSegments(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    const error = new TypeError("Convert requirementSegments must be an array");
    error.code = "INVALID_CONVERT_REQUIREMENTS";
    throw error;
  }
  if (value.length > MAX_REQUIREMENT_SEGMENTS) {
    const error = new RangeError(`Convert accepts at most ${MAX_REQUIREMENT_SEGMENTS} requirement segments`);
    error.code = "CONVERT_REQUIREMENTS_TOO_LARGE";
    throw error;
  }
  const segments = value.map((segment, index) => {
    const raw = typeof segment === "string" ? segment : segment?.text;
    const text = cleanRequirementText(raw);
    if (!text) {
      const error = new TypeError(`Convert requirement segment ${index + 1} is empty`);
      error.code = "INVALID_CONVERT_REQUIREMENTS";
      throw error;
    }
    if (text.length > MAX_REQUIREMENT_SEGMENT_LENGTH) {
      const error = new RangeError(`Convert requirement segment ${index + 1} is too long`);
      error.code = "CONVERT_REQUIREMENTS_TOO_LARGE";
      throw error;
    }
    return text;
  });
  if (segments.join("\n\n").length > MAX_COMBINED_REQUIREMENT_LENGTH) {
    const error = new RangeError("The combined Convert requirements are too long");
    error.code = "CONVERT_REQUIREMENTS_TOO_LARGE";
    throw error;
  }
  return segments;
}

function normalizeConvertAuthoringContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const recentInputs = (Array.isArray(value.recentInputs) ? value.recentInputs : [])
    .slice(-MAX_AUTHORING_RECENT_INPUTS)
    .map((entry) => {
      const text = cleanRequirementText(
        typeof entry === "string" ? entry : entry?.text
      ).slice(0, 500);
      if (!text) return null;
      const semanticEntity = entry?.semanticEntity
        && typeof entry.semanticEntity === "object"
        && !Array.isArray(entry.semanticEntity)
          ? {
              entityId: cleanRequirementText(entry.semanticEntity.entityId).slice(0, 160) || null,
              operationId: cleanRequirementText(entry.semanticEntity.operationId).slice(0, 120) || null,
            }
          : null;
      return {
        text,
        inputKind: cleanRequirementText(entry?.inputKind).slice(0, 40) || null,
        semanticEntity,
      };
    })
    .filter(Boolean);
  const essence = (Array.isArray(value.essence) ? value.essence : [])
    .slice(0, MAX_AUTHORING_ESSENCE_ROWS)
    .filter((row) => Array.isArray(row) && row.length === 4)
    .map((row) => row.map((cell) => cleanRequirementText(cell).slice(0, 300)));
  if (!recentInputs.length && !essence.length) return null;
  return {
    schemaVersion: 1,
    kind: "convertAuthoringContext",
    recentInputs,
    essence,
  };
}

function invocationComparisonKey(value) {
  return cleanRequirementText(value)
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unquotedDeclaredList(value, { stop = () => false } = {}) {
  const source = cleanRequirementText(value)
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!source || /["“”‘’']/.test(source)) return [];
  const parts = source.split(DECLARED_LIST_CONJUNCTION).map(cleanRequirementText).filter(Boolean);
  if (parts.length < 2) return source ? [source] : [];
  const retained = [];
  for (const part of parts) {
    if (stop(part)) break;
    retained.push(part);
  }
  return retained;
}

function declaredInvocationExamples(requirementSegments = []) {
  const segments = Array.isArray(requirementSegments)
    ? requirementSegments.map(cleanRequirementText).filter(Boolean)
    : [];
  const examples = [];
  const seen = new Set();
  const add = (value) => {
    const text = cleanRequirementText(value)
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
    const key = invocationComparisonKey(text);
    if (!text || !key || seen.has(key) || text.length > 300) return;
    seen.add(key);
    examples.push(text);
  };

  for (const segment of segments) {
    const quoted = segment.match(
      /\bwhen\s+i\s+(?:ask|say|type|enter|request)\s*[,,:-]?\s*["“‘']([^"”’']+)["”’']/i
    );
    if (quoted?.[1]) add(quoted[1]);

    const clause = segment.match(
      /\bwhen\s+i\s+(?:ask|say|type|enter|request)\s*[,,:-]?\s*(.+?)(?=\s*,\s*(?:then\s+)?(?:return|respond|answer|show|display|provide|run|execute)\b|\s+then\s+(?:return|respond|answer|show|display|provide|run|execute)\b|$)/i
    );
    if (clause?.[1]) add(clause[1]);

    if (/\bi\s+can\s+(?:ask|say|type|enter|request)\b/i.test(segment)) {
      for (const match of segment.matchAll(/["“‘']([^"”’']+)["”’']/g)) add(match[1]);
      const unquoted = segment.match(
        /\bi\s+can\s+(?:ask|say|type|enter|request)\b\s*[,,:-]?\s*(.+)$/i
      );
      if (unquoted?.[1]) {
        for (const example of unquotedDeclaredList(unquoted[1])) add(example);
      }
    }
    if (examples.length >= MAX_DECLARED_INVOCATION_EXAMPLES) break;
  }
  return examples.slice(0, MAX_DECLARED_INVOCATION_EXAMPLES);
}

function declaredResponseExamples(requirementSegments = []) {
  const segments = Array.isArray(requirementSegments)
    ? requirementSegments.map(cleanRequirementText).filter(Boolean)
    : [];
  const examples = [];
  const seen = new Set();
  const add = (value) => {
    const text = cleanRequirementText(value)
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
    const key = invocationComparisonKey(text);
    if (!text || !key || seen.has(key) || text.length > 300) return;
    seen.add(key);
    examples.push(text);
  };

  for (const segment of segments) {
    if (!/\b(?:respond|return|answer|reply)\b/i.test(segment)) continue;
    for (const match of segment.matchAll(/["“‘']([^"”’']+)["”’']/g)) add(match[1]);
    const unquoted = segment.match(
      /\b(?:respond|return|answer|reply)\b\s*[,,:-]?\s*(.+)$/i
    );
    if (unquoted?.[1]) {
      for (const example of unquotedDeclaredList(unquoted[1], {
        stop: (part) => /^(?:whichever|whatever|depending\b|as appropriate\b)/i.test(part),
      })) add(example);
    }
    if (examples.length >= MAX_DECLARED_INVOCATION_EXAMPLES) break;
  }
  return examples.slice(0, MAX_DECLARED_INVOCATION_EXAMPLES);
}

function preserveDeclaredInvocationExamples(buildRequest, requirementSegments = [], operationId = "") {
  if (!buildRequest || typeof buildRequest !== "object") return buildRequest;
  const declared = declaredInvocationExamples(requirementSegments);
  if (!declared.length || !Array.isArray(buildRequest.operations) || !buildRequest.operations.length) {
    return buildRequest;
  }
  const requestedOperation = String(operationId || "").trim().toLowerCase();
  const target = buildRequest.operations.find((operation) =>
    String(operation?.operationId || "").trim().toLowerCase() === requestedOperation
  ) || (buildRequest.operations.length === 1 ? buildRequest.operations[0] : null);
  if (!target) return buildRequest;
  target.utteranceExamples = Array.isArray(target.utteranceExamples)
    ? [...target.utteranceExamples]
    : [];
  const existing = new Set(target.utteranceExamples.map((example) => invocationComparisonKey(
    typeof example === "string" ? example : example?.text || example?.utterance
  )).filter(Boolean));
  for (const example of declared) {
    const key = invocationComparisonKey(example);
    if (!key || existing.has(key)) continue;
    target.utteranceExamples.push(example);
    existing.add(key);
  }
  return buildRequest;
}

function normalizeConvertPrompt(value) {
  let prompt;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    prompt = { ...value };
  } else {
    const text = cleanRequirementText(value);
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      prompt = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...parsed }
        : { userRequest: text };
    } catch {
      prompt = { userRequest: text };
    }
  }

  if (typeof prompt.userRequest !== "string" && typeof prompt.prompt === "string") {
    prompt.userRequest = prompt.prompt;
  }
  const requirementSegments = normalizeRequirementSegments(prompt.requirementSegments);
  if (requirementSegments.length) {
    const authoringContext = normalizeConvertAuthoringContext(prompt.authoringContext);
    return {
      ...prompt,
      schemaVersion: 1,
      kind: "convertRequirements",
      userRequest: requirementSegments.join("\n\n"),
      requirementSegments,
      relevantItems: [],
      ...(authoringContext ? { authoringContext } : {}),
    };
  }
  return {
    ...prompt,
    userRequest: cleanRequirementText(prompt.userRequest),
    relevantItems: Array.isArray(prompt.relevantItems) ? prompt.relevantItems : [],
  };
}

module.exports = {
  MAX_REQUIREMENT_SEGMENTS,
  declaredInvocationExamples,
  declaredResponseExamples,
  normalizeConvertAuthoringContext,
  normalizeRequirementSegments,
  normalizeConvertPrompt,
  preserveDeclaredInvocationExamples,
};
