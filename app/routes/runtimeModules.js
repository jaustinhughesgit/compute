"use strict";

function useBundledRuntimeModule({ moduleName, contextKey, context, lib }) {
  if (moduleName !== "axios" || contextKey !== "axios") return false;
  const bundled = context?.axios?.value;
  if (!bundled) return false;
  lib.modules.axios = { value: "axios", context: {} };
  return true;
}

module.exports = { useBundledRuntimeModule };
