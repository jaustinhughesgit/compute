"use strict";

function unwrapContextSlot(value) {
  if (
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "value")
  ) {
    return value.value;
  }
  return value;
}

function walkOwnPath(root, path) {
  let current = root;
  const tokens = String(path || "").split(".").filter(Boolean);

  for (const token of tokens) {
    if (
      current == null ||
      (typeof current !== "object" && typeof current !== "function") ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      return "";
    }
    current = unwrapContextSlot(current[token]);
  }

  return current;
}

// Compute invocations expose validated inputs through the root `body` slot.
// Older generated entities addressed the same values through `req=>body.*`.
// Resolve both spellings from the canonical slot so an Express request wrapper
// cannot hide or replace capability inputs.
function resolveComputeInputPlaceholder({ path, rootContext, nestedPath = "" } = {}) {
  if (nestedPath) return { matched: false, value: undefined };

  const expression = String(path || "").trim();
  let bodyPath = null;

  if (expression.startsWith("req=>body.")) {
    bodyPath = expression.slice("req=>body.".length);
  } else if (expression.startsWith("body=>")) {
    bodyPath = expression.slice("body=>".length);
  }

  if (bodyPath === null || !bodyPath) {
    return { matched: false, value: undefined };
  }

  const bodySlot = rootContext && rootContext.body;
  const body = unwrapContextSlot(bodySlot);
  return { matched: true, value: walkOwnPath(body, bodyPath) };
}

module.exports = { resolveComputeInputPlaceholder };
