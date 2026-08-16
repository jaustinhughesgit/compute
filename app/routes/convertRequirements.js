/**
 * Platform: Preserves user-authored Convert requirements as ordered hard-stop segments without importing Essence or ContextDB evidence.
 * Technical: Validates the v1 Convert prompt envelope and derives the bounded combined request used by capability discovery.
 */
"use strict";

const MAX_REQUIREMENT_SEGMENTS = 12;
const MAX_REQUIREMENT_SEGMENT_LENGTH = 1_000;
const MAX_COMBINED_REQUIREMENT_LENGTH = 4_000;

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
    return {
      ...prompt,
      schemaVersion: 1,
      kind: "convertRequirements",
      userRequest: requirementSegments.join("\n\n"),
      requirementSegments,
      // Convert requirements are authoring instructions. Context is attached
      // only through a future explicit reference contract, never implicitly.
      relevantItems: [],
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
  normalizeRequirementSegments,
  normalizeConvertPrompt,
};
