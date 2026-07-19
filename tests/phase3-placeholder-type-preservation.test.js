"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  preserveExactPlaceholderValue,
} = require("../app/routes/placeholderTransport");

function preserve(template, expression, value) {
  return preserveExactPlaceholderValue({
    template,
    matchedPlaceholder: `{|${expression}|}`,
    expression,
    value,
  });
}

test("exact JSON-path placeholders preserve provider value types", () => {
  const cases = [
    ["weatherResponse=>data.current.temperature_2m", 92.8],
    ["weatherResponse=>data.current.is_day", false],
    ["weatherResponse=>data.current", { temperature_2m: 92.8 }],
    ["locationResponse=>data.results", [{ latitude: 35.82 }]],
  ];

  for (const [expression, value] of cases) {
    const result = preserve(`{|${expression}|}`, expression, value);
    assert.equal(result.preserved, true);
    assert.strictEqual(result.value, value);
  }
});

test("mixed templates remain strings and are not treated as typed values", () => {
  const expression = "weatherResponse=>data.current.weather_code";
  const result = preserve(`weather code {|${expression}|}`, expression, 3);
  assert.equal(result.preserved, false);
});

test("legacy math, entity lookup, and array literal expressions retain their evaluators", () => {
  for (const expression of ["=3+4", "entity-id>", "['a','b']=>[0]"]) {
    const result = preserve(`{|${expression}|}`, expression, 7);
    assert.equal(result.preserved, false);
  }
});

test("executed placeholders retain the existing function execution path", () => {
  const expression = "res";
  const result = preserve(`{|${expression}|}!`, expression, () => {});
  assert.equal(result.preserved, false);
});
