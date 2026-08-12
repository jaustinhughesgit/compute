"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const {
  createCapabilityBuildCoordinator,
  failureReason,
} = require("../app/routes/capabilityBuildCoordinator");
const {
  shorthandExecutionSource,
} = require("../app/routes/modules/convert");
const {
  shorthand,
  routeEnvelopeValue,
} = require("../app/routes/modules/shorthand");

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

test("route envelopes expose a named value through registered transport wrappers", () => {
  assert.equal(routeEnvelopeValue({ response: { file: "direct-file" } }, "file"), "direct-file");
  assert.equal(
    routeEnvelopeValue({ response: { oai: { html: { response: { file: "relayed-file" } } } } }, "file"),
    "relayed-file"
  );
  assert.equal(routeEnvelopeValue({ response: { entity: "entity-only" } }, "file"), undefined);
});

test("Shorthand reads a created entity id from the registered route envelope", async () => {
  const cookiesPath = require.resolve("../app/routes/cookies");
  const previousModule = require.cache[cookiesPath];
  const originalLoad = Module._load;
  Module._load = function loadWithMathStub(request, parent, isMain) {
    if (request === "mathjs") return { evaluate: Number };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.cache[cookiesPath] = {
    id: cookiesPath,
    filename: cookiesPath,
    loaded: true,
    exports: {
      route: async (...args) => {
        const action = args[18];
        if (action === "newGroup") {
          return { response: { oai: { html: { ok: true, response: { file: "entity-file" } } } } };
        }
        throw new Error(`unexpected route ${action}`);
      },
    },
  };
  try {
    const result = await shorthand(
      {
        input: [
          { physical: [[{ published: {} }]] },
          { virtual: [
            ["ROUTE", {}, {}, "newGroup", "group", "entity"],
            ["ROUTEGET", "001!!", "file"],
            ["ADDPROPERTY", "000!!", "conclusion", "002!!"],
            ["ROWRESULT", "000", "003!!"],
          ] },
        ],
      },
      { body: {}, headers: {} },
      {},
      undefined,
      undefined,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      "/cookies/convert/test",
      { body: {} },
      "POST",
      "cookies"
    );
    assert.equal(result.conclusion, "entity-file");
  } finally {
    Module._load = originalLoad;
    if (previousModule) require.cache[cookiesPath] = previousModule;
    else delete require.cache[cookiesPath];
  }
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
