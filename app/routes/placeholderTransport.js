"use strict";

// Returns a typed value only when the entire template is one ordinary
// placeholder. Math expressions, entity lookups, and legacy array literals
// retain their existing evaluation paths.
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
    source &&
    match &&
    source === match &&
    inner &&
    !inner.startsWith("=") &&
    !inner.endsWith(">") &&
    !inner.startsWith("[")
  );

  return { preserved, value };
}

module.exports = { preserveExactPlaceholderValue };
