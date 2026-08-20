"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchors = require("../app/routes/anchors");
const {
  createCapabilitySignature,
  semanticCapabilityText,
  semanticCapabilityDocuments,
  semanticUtterancePatterns,
  indexCapabilityManifest,
} = require("../app/routes/capabilitySignature");
const { loadCapabilityCandidates } = require("../app/routes/capabilityCandidates");
const { createCapabilityRegistry } = require("../app/routes/capabilityRegistry");
const { seedCreatedComputePublicUseGrant } = require("../app/routes/modules/convert");
const { IMPLEMENTATION_POLICY_VERSION } = require("../app/routes/capabilityManifest");

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    capabilityId: "math.addition",
    entityId: "entity-add",
    version: 1,
    status: "active",
    ownerId: "u:10",
    name: "Add two numbers",
    description: "Returns the sum of two supplied numbers.",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    implementationPolicyVersion: IMPLEMENTATION_POLICY_VERSION,
    operations: [{
      operationId: "add",
      description: "Add two numbers.",
      inputs: [
        { name: "left", type: "number", required: true, bindingHint: { source: "utterance", resolver: "number" } },
        { name: "right", type: "number", required: true, bindingHint: { source: "utterance", resolver: "number" } },
      ],
      outputs: [{ name: "sum", type: "number", required: true }],
      utteranceExamples: [{ text: "What is 8 plus 13?", inputs: { left: 8, right: 13 } }],
      answerTemplate: "{{sum}}",
    }],
    ...overrides,
  };
}

test("capability fingerprints ignore ownership/revision metadata but change with the semantic contract", () => {
  const first = createCapabilitySignature(manifest());
  const moved = createCapabilitySignature(manifest({
    entityId: "another-entity",
    ownerId: "u:99",
    version: 8,
    status: "disabled",
    createdAt: "yesterday",
    updatedAt: "today",
  }));
  assert.equal(first.contractHash, moved.contractHash);
  const multiplied = manifest();
  multiplied.operations[0].description = "Multiply two numbers.";
  assert.notEqual(first.contractHash, createCapabilitySignature(multiplied).contractHash);
  assert.equal(first.schemaVersion, 3);
  assert.deepEqual(semanticUtterancePatterns(manifest().operations[0]), ["What is {left} plus {right}?"]);
  assert.doesNotMatch(semanticCapabilityText(manifest()), /8|13/);
  assert.match(semanticCapabilityText(manifest()), /utterance pattern What is \{left\} plus \{right\}\?/);
  assert.deepEqual(semanticCapabilityDocuments(manifest()), [
    { kind: "contract", text: semanticCapabilityText(manifest()) },
    { kind: "utterance-pattern", text: "What is left plus right?" },
  ]);
});

test("public capability positioning writes tenant and global v2 postings", async (t) => {
  const originalLoad = anchors.loadAnchors;
  const originalAssign = anchors.assign;
  t.after(() => { anchors.loadAnchors = originalLoad; anchors.assign = originalAssign; });
  anchors.loadAnchors = async () => ({ setId: "anchors_v1", d: 2, band_scale: 2000, num_shards: 8 });
  anchors.assign = (unit) => [{
    l0: unit[0] > unit[1] ? 2 : 3,
    l1: 7,
    band: unit[0] > unit[1] ? 31 : 42,
    dist_q16: 100,
  }];
  const writes = [];
  let position = null;
  const result = await indexCapabilityManifest({
    manifest: manifest(),
    persistence: {
      foundation: { addresses: {
        byId: async () => ({ Items: [{ su: "entity-add", z: true }] }),
        setPosition: async (_id, value) => { position = value; },
      } },
      retrieval: { batchPut: async (items) => writes.push(...items) },
    },
    s3: {},
    openai: { embeddings: { create: async ({ input }) => ({
      data: input.map((_value, index) => ({ embedding: index === 0 ? [1, 0] : [0, 1] })),
    }) } },
  });
  assert.equal(result.indexed, true);
  assert.equal(writes.length, 4);
  assert.ok(writes.some((row) => row.pk.includes("#U=10#")));
  assert.ok(writes.some((row) => !row.pk.includes("#U=")));
  assert.equal(result.position.semanticProjectionCount, 2);
  assert.equal(result.position.assigns.length, 2);
  assert.equal(position.contractHash, createCapabilitySignature(manifest()).contractHash);
});

test("reusable registration retries Position and cannot acknowledge an unindexed manifest", async () => {
  const dynamodb = {
    get: () => ({ promise: async () => ({ Item: { su: "entity-add", z: true } }) }),
    update: () => ({ promise: async () => ({}) }),
  };
  let attempts = 0;
  const registry = createCapabilityRegistry({
    dynamodb,
    indexCapability: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary embedding failure");
      return { indexed: true, postings: 2 };
    },
  });
  const registered = await registry.register(manifest(), {
    ownerId: "u:10",
    requireIndex: true,
    indexAttempts: 3,
    indexRetryDelayMs: 0,
  });
  assert.equal(registered.entityId, "entity-add");
  assert.equal(attempts, 2);

  const unavailable = createCapabilityRegistry({
    dynamodb,
    indexCapability: async () => ({ indexed: false, reason: "ADDRESS_NOT_FOUND" }),
  });
  await assert.rejects(
    unavailable.register(manifest(), {
      ownerId: "u:10",
      requireIndex: true,
      indexAttempts: 2,
      indexRetryDelayMs: 0,
    }),
    (error) => error?.code === "CAPABILITY_INDEX_UNAVAILABLE" && error?.retryable === true
  );
});

test("indexed discovery reloads only Search candidates and never scans after an empty indexed result", async () => {
  let scans = 0;
  let ids = null;
  let searchRequest = null;
  const registry = {
    listAvailableByEntityIds: async (value) => { ids = value; return [manifest()]; },
    listAvailable: async () => { scans += 1; return []; },
  };
  const found = await loadCapabilityCandidates({
    searchEntities: async (request) => {
      searchRequest = request;
      return [{ su: "denied", canUse: false }, { su: "entity-add", canUse: true }];
    },
    registry,
    utterance: "Combine five with nine.",
    requirementSegments: ["Return the total."],
    ownerId: "u:12",
  });
  assert.deepEqual(ids, ["entity-add"]);
  assert.equal(found[0].entityId, "entity-add");
  assert.equal(searchRequest.bandWindow, 512);
  assert.equal(searchRequest.topK, 60);
  await loadCapabilityCandidates({ searchEntities: async () => [], registry, utterance: "unmatched", ownerId: "u:12" });
  assert.equal(scans, 0);
});

test("an explicit public use grant makes a public definition reusable by another account", async () => {
  const item = { su: "entity-add", z: true, computeCapability: manifest() };
  const dynamodb = { scan: () => ({ promise: async () => ({ Items: [item] }) }) };
  const persistence = { authorization: { batchGetGrants: async (keys) => keys
    .filter((key) => key.principalID === "pub")
    .map(() => ({
      entityID: "entity-add",
      principalID: "pub",
      canonicalActions: ["find", "read", "aggregate", "use"],
      canonicalLifecycle: { state: "active", tombstone: false },
    })) } };
  const registry = createCapabilityRegistry({ dynamodb, persistence });
  const available = await registry.listAvailable({ ownerId: "u:12" });
  assert.deepEqual(available.map((value) => value.entityId), ["entity-add"]);
});

test("Convert seeds public use only for a newly-created public compute address", async () => {
  const grants = [];
  const persistence = {
    foundation: { addresses: { byId: async () => ({ Items: [{ su: "entity-add", z: true }] }) } },
    authorization: { putGrant: async (grant) => grants.push(grant) },
  };
  assert.equal(await seedCreatedComputePublicUseGrant({
    persistence,
    entityId: "entity-add",
    ownerId: "u:10",
    createdEntities: [{ entity: "entity-add" }],
  }), true);
  assert.equal(grants[0].principalID, "pub");
  assert.deepEqual(grants[0].canonicalActions, ["find", "read", "aggregate", "use"]);
});
