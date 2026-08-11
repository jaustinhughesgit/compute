/**
 * Platform: Reuses approved bundled runtime modules without mutating the caller's entity execution context.
 * Technical: Copies property descriptors and injects one named library capability into an isolated context object.
 */
"use strict";

function copyRuntimeContext(context) {
  const source = context && typeof context === "object" ? context : {};
  return Object.defineProperties(
    Object.create(Object.getPrototypeOf(source)),
    Object.getOwnPropertyDescriptors(source)
  );
}

function useBundledRuntimeModule({ moduleName, contextKey, context, lib }) {
  if (moduleName !== "axios" || contextKey !== "axios") return false;
  const bundled = context?.axios?.value;
  if (!bundled) return false;
  lib.modules.axios = { value: "axios", context: {} };
  return true;
}

module.exports = { copyRuntimeContext, useBundledRuntimeModule };
