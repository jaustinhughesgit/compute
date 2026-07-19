"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveComputeInputPlaceholder,
} = require("../app/routes/inputPlaceholderTransport");
const {
  getCapabilityBlueprint,
} = require("../app/routes/capabilityBlueprints");

const rootContext = {
  body: {
    value: {
      postal_code: "27560",
      country_code: "US",
      unit_system: "imperial",
    },
    context: {},
  },
  req: {
    value: { body: {} },
    context: {},
  },
};

test("legacy req=>body compute selectors resolve from the canonical body slot", () => {
  assert.deepEqual(
    resolveComputeInputPlaceholder({
      path: "req=>body.postal_code",
      rootContext,
    }),
    { matched: true, value: "27560" }
  );
  assert.equal(
    resolveComputeInputPlaceholder({
      path: "req=>body.country_code",
      rootContext,
    }).value,
    "US"
  );
});

test("new weather entities use canonical body selectors", () => {
  const blueprint = getCapabilityBlueprint("weather.current_conditions", {
    requestedBy: "test-owner",
  });
  const initialSet = blueprint.published.actions[0].set;

  assert.equal(initialSet.postalCode, "{|body=>postal_code|}");
  assert.equal(initialSet.countryCode, "{|body=>country_code|}");
  assert.equal(initialSet.unitSystem, "{|body=>unit_system|}");

  const geocodingParams = blueprint.published.actions[2].chain[0].params[1].params;
  assert.equal(geocodingParams.name, "{|postalCode|}");
  assert.equal(geocodingParams.countryCode, "{|countryCode|}");
});

test("unrelated placeholders retain the existing resolver path", () => {
  assert.deepEqual(
    resolveComputeInputPlaceholder({
      path: "weatherResponse=>data.current.temperature_2m",
      rootContext,
    }),
    { matched: false, value: undefined }
  );
});
