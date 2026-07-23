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
