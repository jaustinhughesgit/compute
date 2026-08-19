"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildConvertArtifacts } = require("../app/routes/modules/convert");

test("Convert returns ArrayLogic, compiled Shorthand, and materialized JPL as one inspection contract", () => {
  const arrayLogic = [{ computeEntity: { approved: true, capabilityId: "math.add" } }];
  const shorthand = [["NESTED", "004!!", "published", "actions", []]];
  const materializedEntity = {
    published: {
      modules: { math: "mathjs" },
      actions: [{ set: { left: "{|req=>body.left|}" } }],
      data: { presentationOnly: true },
    },
  };

  assert.deepEqual(buildConvertArtifacts({ arrayLogic, shorthand, materializedEntity }), {
    schemaVersion: 1,
    kind: "convertArtifacts",
    arrayLogic,
    shorthand,
    jpl: {
      modules: { math: "mathjs" },
      actions: materializedEntity.published.actions,
    },
  });
});

test("Convert retains accepted compute JPL when Shorthand returns only its summary row", () => {
  const published = {
    modules: {},
    actions: [{ target: "{|res|}!", chain: [{ access: "send", params: [{ status: "clean" }] }] }],
    data: { capabilityId: "state.transition" },
  };
  const arrayLogic = [{
    computeEntity: {
      capabilityId: "state.transition",
      approved: true,
      published,
    },
  }];

  assert.deepEqual(buildConvertArtifacts({
    arrayLogic,
    shorthand: [["ROWRESULT", "000", "023!!"]],
    materializedEntity: { conclusion: { ok: true } },
  }).jpl, {
    modules: {},
    actions: published.actions,
  });
});

test("Convert reuse and pending responses expose an empty artifact contract", () => {
  assert.deepEqual(buildConvertArtifacts(), {
    schemaVersion: 1,
    kind: "convertArtifacts",
    arrayLogic: null,
    shorthand: null,
    jpl: null,
  });
});
