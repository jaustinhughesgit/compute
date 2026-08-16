/**
 * Platform: Preserves typed values while JPL invokes trusted runtime primitives.
 * Technical: Restricts the legacy Express numeric-send coercion to real HTTP responses instead of changing every method's first parameter.
 */
"use strict";

function prepareJplMethodParameters(values, { target = "", access = "", isFunction = false } = {}) {
  const params = Array.isArray(values) ? [...values] : [];
  const targetName = String(target).replace("{|", "").replace("|}!", "").replace("|}", "");
  if (
    targetName === "res"
    && String(access) === "send"
    && !isFunction
    && typeof params[0] === "number"
  ) {
    params[0] = String(params[0]);
  }
  return params;
}

module.exports = { prepareJplMethodParameters };
