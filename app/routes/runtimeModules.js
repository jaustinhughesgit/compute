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
