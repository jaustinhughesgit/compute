/**
 * Platform: Prevents typed Path inputs from being stringified while substituting runtime placeholders.
 * Technical: Returns the original value when a template is exactly one matched placeholder; otherwise performs text replacement.
 */
"use strict";

function preserveExactPlaceholderValue({
  template,
  matchedPlaceholder,
  expression,
  value,
} = {}) {
  const source = typeof template === "string" ? template : "";
  const match = typeof matchedPlaceholder === "string" ? matchedPlaceholder : "";
  const inner = typeof expression === "string" ? expression.trim() : "";
  const preserved = !!(
    source
    && match
    && source === match
    && inner
    && !inner.startsWith("=")
    && !inner.endsWith(">")
    && !inner.startsWith("[")
  );
  return { preserved, value };
}

module.exports = { preserveExactPlaceholderValue };
