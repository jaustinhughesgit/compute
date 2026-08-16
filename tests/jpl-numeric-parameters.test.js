"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareJplMethodParameters } = require("../app/routes/jplMethodParameters");

test("JPL preserves numeric method parameters for bundled calculation primitives", async () => {
  const params = prepareJplMethodParameters([8, 13], {
    target: "{|math|}",
    access: "add",
    isFunction: true,
  });

  assert.deepEqual(params, [8, 13]);
  assert.equal(typeof params[0], "number");
});

test("only a real Express numeric response retains the legacy string coercion", () => {
  assert.deepEqual(prepareJplMethodParameters([204], {
    target: "{|res|}!",
    access: "send",
    isFunction: false,
  }), ["204"]);
  assert.deepEqual(prepareJplMethodParameters([21], {
    target: "{|res|}!",
    access: "send",
    isFunction: true,
  }), [21]);
});
