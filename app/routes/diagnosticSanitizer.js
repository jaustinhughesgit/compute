/**
 * Platform: Keeps diagnostics actionable while preventing secret-bearing or unbounded data from crossing trust boundaries.
 * Technical: Recursively redacts sensitive keys and limits depth, collection size, and string length while preserving observed shapes.
 */
"use strict";

const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|passphrase|secret|token|api[_-]?key|apikey|private[_-]?key|protected[_-]?asset)/i;
const MAX_DEPTH = 5;
const MAX_ENTRIES = 30;
const MAX_ARRAY = 20;
const MAX_STRING = 1200;

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isNaN(value)) return "nan";
  return typeof value;
}

function sanitizeString(value) {
  let text = String(value);
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
    || /\bsk-[A-Za-z0-9_-]{12,}\b/.test(text)
    || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(text)
  ) return "[redacted]";
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bprotected_asset:[A-Za-z0-9_-]+/gi, "protected_asset:[redacted]")
    .replace(/([?&](?:appid|apikey|api_key|access_token|token|key)=)[^&#\s]*/gi, "$1[redacted]");
  return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…[truncated]` : text;
}

function sanitizeDiagnosticValue(
  value,
  depth = 0,
  seen = new WeakSet(),
  maxDepth = MAX_DEPTH,
  limits = {}
) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value !== "object") return sanitizeString(value);
  if (depth >= maxDepth) return "[depth limit]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const maxArray = Math.max(1, Number(limits.maxArray || MAX_ARRAY));
    const items = value.slice(0, maxArray)
      .map((item) => sanitizeDiagnosticValue(item, depth + 1, seen, maxDepth, limits));
    if (value.length > maxArray) items.push(`[${value.length - maxArray} more items]`);
    return items;
  }
  const maxEntries = Math.max(1, Number(limits.maxEntries || MAX_ENTRIES));
  const entries = Object.entries(value).slice(0, maxEntries);
  const result = {};
  for (const [key, item] of entries) {
    result[String(key).slice(0, 120)] = SENSITIVE_KEY.test(key)
      ? "[redacted]"
      : sanitizeDiagnosticValue(item, depth + 1, seen, maxDepth, limits);
  }
  if (Object.keys(value).length > maxEntries) result.__truncated = true;
  return result;
}

function observedShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return valueType(value);
  return Object.fromEntries(
    Object.entries(value).slice(0, MAX_ENTRIES).map(([key, item]) => [String(key).slice(0, 120), valueType(item)])
  );
}

module.exports = {
  SENSITIVE_KEY,
  observedShape,
  sanitizeDiagnosticValue,
  valueType,
};
