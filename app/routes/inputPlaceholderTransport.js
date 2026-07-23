"use strict";

function unwrapContextSlot(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    return value.value;
  }
  return value;
}

function walkOwnPath(root, path) {
  let current = root;
  for (const token of String(path || "").split(".").filter(Boolean)) {
    if (
      current == null
      || (typeof current !== "object" && typeof current !== "function")
      || !Object.prototype.hasOwnProperty.call(current, token)
    ) return "";
    current = unwrapContextSlot(current[token]);
  }
  return current;
}

// Ordinary capability inputs are read from the canonical body slot. Protected
// values are held in a separate, in-memory execution-boundary slot and can only
// be addressed with {|protected=>requirement.field|}. They never enter req.body.
function resolveComputeInputPlaceholder({ path, rootContext, nestedPath = "" } = {}) {
  if (nestedPath) return { matched: false, value: undefined };
  const expression = String(path || "").trim();
  if (expression.startsWith("protected=>")) {
    const protectedPath = expression.slice("protected=>".length);
    if (!protectedPath || protectedPath.includes("__proto__") || protectedPath.includes("constructor")) {
      return { matched: true, value: "" };
    }
    const protectedSlot = rootContext && rootContext.protected;
    return { matched: true, value: walkOwnPath(unwrapContextSlot(protectedSlot), protectedPath) };
  }

  let bodyPath = null;
  if (expression.startsWith("req=>body.")) bodyPath = expression.slice("req=>body.".length);
  else if (expression.startsWith("body=>")) bodyPath = expression.slice("body=>".length);
  if (bodyPath === null || !bodyPath) return { matched: false, value: undefined };
  const bodySlot = rootContext && rootContext.body;
  return { matched: true, value: walkOwnPath(unwrapContextSlot(bodySlot), bodyPath) };
}

module.exports = { resolveComputeInputPlaceholder };
