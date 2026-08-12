"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCapabilityBuildCoordinator,
  failureReason,
} = require("../app/routes/capabilityBuildCoordinator");
const {
  shorthandExecutionSource,
} = require("../app/routes/modules/convert");

function recordingClient() {
  const updates = [];
  return {
    updates,
    update(params) {
      updates.push(params);
      return { promise: async () => ({}) };
    },
    get() {
      return { promise: async () => ({ Item: null }) };
    },
  };
}

test("a generated capability can execute without a readable parent workspace file", () => {
  assert.deepEqual(shorthandExecutionSource(null, { claim: {} }), { published: {} });
  assert.equal(shorthandExecutionSource(null, null), null);
  const existing = { published: { content: "workspace" } };
  assert.equal(shorthandExecutionSource(existing, { claim: {} }), existing);
});

test("completed background output has one leased finalizer", async () => {
  const dynamodb = recordingClient();
  const coordinator = createCapabilityBuildCoordinator({ dynamodb });
  const claim = {
    key: "capbuild#one",
    buildId: "build_one",
    record: { capabilityBuildStatus: "building" },
  };
  const finalization = await coordinator.beginFinalization(claim, { jobId: "resp_one" });

  assert.equal(finalization.acquired, true);
  assert.match(finalization.finalizeToken, /^[0-9a-f-]{36}$/i);
  assert.match(dynamodb.updates[0].ConditionExpression, /attribute_not_exists\(#finalizeLease\)/);
  assert.equal(dynamodb.updates[0].ExpressionAttributeValues[":jobId"], "resp_one");

  await coordinator.complete(
    { ...claim, finalizeToken: finalization.finalizeToken },
    { entityId: "entity_one", version: 1 }
  );
  assert.match(dynamodb.updates[1].ConditionExpression, /#finalizeToken = :finalizeToken/);
});

test("a validation retry releases its finalization lease", async () => {
  const dynamodb = recordingClient();
  const coordinator = createCapabilityBuildCoordinator({ dynamodb });
  await coordinator.releaseFinalization({
    key: "capbuild#retry",
    buildId: "build_retry",
    record: { capabilityBuildStatus: "building" },
    finalizeToken: "finalizer-retry",
  });
  assert.match(dynamodb.updates[0].UpdateExpression, /REMOVE #token, #finalizeLease/);
  assert.match(dynamodb.updates[0].ConditionExpression, /#token = :token/);
});

test("terminal build failures retain bounded diagnostics for a later poll", async () => {
  const dynamodb = recordingClient();
  const coordinator = createCapabilityBuildCoordinator({ dynamodb });
  const claim = {
    key: "capbuild#two",
    buildId: "build_two",
    record: { capabilityBuildStatus: "building" },
    finalizeToken: "finalizer-two",
  };
  await coordinator.fail(claim, "MANIFEST_MISSING", "Generated entity\nreturned no manifest.");

  const values = dynamodb.updates[0].ExpressionAttributeValues;
  assert.equal(values[":code"], "MANIFEST_MISSING");
  assert.equal(values[":message"], "Generated entity returned no manifest.");
  assert.match(dynamodb.updates[0].ConditionExpression, /#finalizeToken = :finalizeToken/);
  assert.equal(
    failureReason({
      capabilityBuildErrorCode: values[":code"],
      capabilityBuildErrorMessage: values[":message"],
    }),
    "The capability build failed (MANIFEST_MISSING): Generated entity returned no manifest."
  );
});
