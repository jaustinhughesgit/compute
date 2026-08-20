"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { register, __test } = require("../app/routes/modules/contextGraph");
const { validateCapabilityManifest } = require("../app/routes/capabilityManifest");
const { createCanonicalPersistence } = require("../app/persistence/canonicalPersistence");
const { memoryClient } = require("./helpers/canonical-memory-client");

function memoryDocumentClient() {
  const items = new Map();
  const key = (item) => `${item.audienceId}\u001f${item.recordKey}`;
  return {
    items,
    put: ({ Item }) => ({ promise: async () => { items.set(key(Item), structuredClone(Item)); } }),
    get: ({ Key }) => ({ promise: async () => ({
      Item: structuredClone(Key.assetId
        ? items.get(`protected-asset\u001f${Key.assetId}`)
        : items.get(key(Key))),
    }) }),
    batchWrite: ({ RequestItems }) => ({
      promise: async () => {
        for (const requests of Object.values(RequestItems)) {
          for (const request of requests) {
            if (request.PutRequest) items.set(key(request.PutRequest.Item), structuredClone(request.PutRequest.Item));
          }
        }
        return { UnprocessedItems: {} };
      },
    }),
    query: (params) => ({
      promise: async () => {
        const all = Array.from(items.values());
        if (params.IndexName === "lookupKey-index") {
          const lookup = params.ExpressionAttributeValues[":lookup"];
          return { Items: all.filter((item) => item.lookupKey === lookup) };
        }
        const audience = params.ExpressionAttributeValues[":audience"];
        return { Items: all.filter((item) => item.audienceId === audience) };
      },
    }),
  };
}

function installRuntime(doc, profiles = [], canonicalPersistence = null, capabilityRegistry = null) {
  const handlers = new Map();
  for (const profile of profiles) {
    doc.items.set(`${profile.audienceId}\u001fprofile#self`, structuredClone(profile));
  }
  const workspaces = {
    "workspace-alice": { su: "workspace-alice", e: "1", output: "Alice", a: "word-alice", z: true },
    "workspace-amy": { su: "workspace-amy", e: "2", output: "Amy", a: "word-amy", z: true },
  };
  register({
    on: (name, handler) => handlers.set(name, handler),
    use: () => ({
      getDocClient: () => doc,
      ...(canonicalPersistence
        ? { getCanonicalPersistence: () => canonicalPersistence }
        : {}),
      ...(capabilityRegistry
        ? { getCapabilityRegistry: () => capabilityRegistry }
        : {}),
      getSub: async (value, field) => ({ Items: field === "su" && workspaces[value] ? [workspaces[value]] : [] }),
      getWord: async (value) => ({ Items: [{ r: value === "word-amy" ? "Amy" : "Alice" }] }),
    }),
  });
  return handlers;
}

function publicationBody() {
  return {
    schemaVersion: 1,
    idempotencyKey: "input-1",
    source: { sentence: "Amy had a good pass to Sarah." },
    userReferences: [{ localId: "ent_1", label: "Amy" }],
    nodes: [
      { localId: "ent_1", lemmas: ["amy"], names: ["Amy"] },
      { localId: "ent_2", lemmas: ["actor"] },
      { localId: "ent_3", lemmas: ["event_1"] },
      { localId: "ent_4", lemmas: ["pass"] },
      { localId: "ent_5", lemmas: ["type"] },
    ],
    relations: [
      { localId: "rel_1", subjectLocalId: "ent_3", predicateLocalId: "ent_2", objectLocalId: "ent_1" },
      { localId: "rel_2", subjectLocalId: "ent_3", predicateLocalId: "ent_5", objectLocalId: "ent_4" },
    ],
  };
}

function carwashManifest(ownerId = "u:1") {
  return validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "vehicle.wash",
    entityId: "compute-carwash",
    version: 1,
    status: "active",
    ownerId,
    execution: { type: "remote", readOnly: false, timeoutMs: 15000 },
    operations: [{
      operationId: "wash",
      inputs: [{
        name: "vehicle",
        type: "string",
        required: true,
        bindingHint: { source: "utterance", resolver: "entity_reference" },
      }],
      outputs: [{ name: "state", type: "string", required: true }],
      utteranceExamples: [{ text: "wash my car", inputs: { vehicle: "car" } }],
      answerTemplate: "Your {{vehicle}} is {{state}}",
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "vehicle",
        currentValue: "dirty",
        newValue: "clean",
      }],
    }],
  });
}

test("component audiences carry every connected fact to a referenced user", () => {
  const audiences = __test.componentAudiences(
    publicationBody().relations,
    new Map([["ent_1", "2"]]),
    "u:1"
  );
  assert.deepEqual(audiences.get("ent_4"), ["u:1", "u:2"]);
});

test("dual-read hydration keeps the newest record while canonical data converges", () => {
  const merged = __test.mergeHydrationGraphs({
    nodes: [{ serverId: "ctx_item", lemmas: ["cat"], version: 2 }],
    relations: [{ serverId: "rel_item", object: "ctx_cat", version: 2 }],
  }, {
    nodes: [{ serverId: "ctx_item", lemmas: ["lantern"], version: 3 }],
    relations: [{ serverId: "rel_item", object: "ctx_lantern", version: 3 }],
  });

  assert.deepEqual(merged.nodes, [{ serverId: "ctx_item", lemmas: ["lantern"], version: 3 }]);
  assert.deepEqual(merged.relations, [{ serverId: "rel_item", object: "ctx_lantern", version: 3 }]);

  const canonicalTie = __test.mergeHydrationGraphs({
    nodes: [{ serverId: "ctx_item", lemmas: ["canonical"], version: 3 }],
  }, {
    nodes: [{ serverId: "ctx_item", lemmas: ["sidecar"], version: 3 }],
  });
  assert.deepEqual(canonicalTie.nodes[0].lemmas, ["canonical"]);
});

test("public profile publication is limited to components connected to the current speaker", () => {
  const body = publicationBody();
  const connectedToAmy = __test.selfConnectedNodeIds(
    body.relations,
    new Map([["ent_1", "2"]]),
    "1"
  );
  assert.deepEqual([...connectedToAmy], []);

  const connectedToSpeaker = __test.selfConnectedNodeIds(
    body.relations,
    new Map([["ent_1", "1"]]),
    "1"
  );
  assert.equal(connectedToSpeaker.has("ent_4"), true);
});

test("publication resolves a spoken user, acknowledges stable ids, and hydrates that participant", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc, [{
    audienceId: "u:2",
    recordKey: "profile#self",
    recordType: "profile",
    principalId: "2",
    serverEntityId: "usr_2",
    displayName: "Amy",
    lookupKey: "handle#amy",
  }]);

  const result = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: publicationBody() },
  }, { cookie: { e: "1" } });

  assert.equal(result.ok, true);
  assert.equal(result.response.nodes.find((node) => node.localId === "ent_1").serverId, "usr_2");
  assert.equal(result.response.relations.length, 2);

  const hydrated = await handlers.get("contextGraphHydrate")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1 } },
  }, { cookie: { e: "2" } });
  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.response.relations.length, 2);
  assert.ok(hydrated.response.nodes.some((node) => node.serverId === "usr_2"));
});

test("publication retries return the persisted acknowledgement without duplicate writes", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc);
  const request = { path: "/workspace-alice", req: { body: publicationBody() } };
  const meta = { cookie: { e: "1" } };
  const first = await handlers.get("contextGraphPublish")(request, meta);
  const count = doc.items.size;
  const second = await handlers.get("contextGraphPublish")(request, meta);
  assert.deepEqual(second.response, first.response);
  assert.equal(doc.items.size, count);
});

test("publication rejects a reused local id before it can merge unrelated entities", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc);
  const meta = { cookie: { e: "1" } };
  const first = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: publicationBody() },
  }, meta);
  assert.equal(first.ok, true);

  const collision = publicationBody();
  collision.idempotencyKey = "input-collision";
  collision.userReferences = [];
  collision.nodes = collision.nodes.map((node) => (
    node.localId === "ent_4"
      ? { localId: "ent_4", lemmas: ["2026-08-19T23:59:59-04:00"] }
      : node
  ));
  const result = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: collision },
  }, meta);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CONTEXT_LOCAL_ID_REUSED");
  const passNode = first.response.nodes.find((node) => node.localId === "ent_4");
  const stored = doc.items.get(`u:1\u001fnode#${passNode.serverId}`);
  assert.deepEqual(stored.lemmas, ["pass"]);
});

test("authoritative ids remain stable when a later local mutation reuses acknowledged nodes", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc, [{
    audienceId: "u:2",
    recordKey: "profile#self",
    recordType: "profile",
    principalId: "2",
    serverEntityId: "usr_2",
    displayName: "Amy",
    lookupKey: "handle#amy",
  }]);
  const first = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: publicationBody() },
  }, { cookie: { e: "1" } });
  const ids = Object.fromEntries(first.response.nodes.map((node) => [node.localId, node.serverId]));
  const secondBody = {
    schemaVersion: 1,
    idempotencyKey: "input-2",
    userReferences: [{ localId: ids.ent_1, label: "Amy" }],
    nodes: [
      { localId: ids.ent_1, lemmas: ["amy"], names: ["Amy"] },
      { localId: ids.ent_2, lemmas: ["actor"], names: [] },
      { localId: ids.ent_3, lemmas: ["event_1"], names: [] },
    ],
    relations: [{
      localId: "rel_3",
      subjectLocalId: ids.ent_3,
      predicateLocalId: ids.ent_2,
      objectLocalId: ids.ent_1,
      tombstone: false,
    }],
  };
  const second = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: secondBody },
  }, { cookie: { e: "1" } });
  assert.deepEqual(
    second.response.nodes.map((node) => node.serverId).sort(),
    [ids.ent_1, ids.ent_2, ids.ent_3].sort()
  );
  assert.ok(second.response.nodes.every((node) => node.resolution === "previously-acknowledged"));
});

test("a later relation rewire preserves its acknowledged canonical relation identity", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc);
  const meta = { cookie: { e: "1" } };
  const first = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: publicationBody() },
  }, meta);
  assert.equal(first.ok, true);
  const nodeIds = Object.fromEntries(first.response.nodes.map((node) => [node.localId, node.serverId]));
  const relationId = first.response.relations.find((relation) => relation.localId === "rel_1").serverId;
  const rewired = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "input-rewire",
      source: { sentence: "Update the relation." },
      userReferences: [],
      nodes: [
        { localId: nodeIds.ent_3, lemmas: ["event_1"] },
        { localId: nodeIds.ent_2, lemmas: ["actor"] },
        { localId: nodeIds.ent_4, lemmas: ["pass"] },
      ],
      relations: [{
        localId: relationId,
        subjectLocalId: nodeIds.ent_3,
        predicateLocalId: nodeIds.ent_2,
        objectLocalId: nodeIds.ent_4,
        tombstone: false,
      }],
    } },
  }, meta);
  assert.equal(rewired.ok, true);
  assert.equal(rewired.response.relations[0].serverId, relationId);
  assert.equal(rewired.response.relations[0].version, 2);

  const hydrated = await handlers.get("contextGraphHydrate")({
    path: "/workspace-alice",
    req: { body: { schemaVersion: 1 } },
  }, meta);
  const relation = hydrated.response.relations.find((item) => item.serverId === relationId);
  assert.equal(relation.object, nodeIds.ent_4);
  assert.equal(hydrated.response.relations.filter((item) => item.serverId === relationId).length, 1);
});

test("workspace ownership and ambiguous user handles fail closed", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc, [
    { audienceId: "u:2", recordKey: "profile#self", principalId: "2", serverEntityId: "usr_2", displayName: "Amy", lookupKey: "handle#amy" },
    { audienceId: "u:3", recordKey: "profile#self", principalId: "3", serverEntityId: "usr_3", displayName: "Amy", lookupKey: "handle#amy" },
  ]);
  const forbidden = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: publicationBody() },
  }, { cookie: { e: "9" } });
  assert.equal(forbidden.error.code, "CONTEXT_WORKSPACE_FORBIDDEN");

  const result = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: publicationBody() },
  }, { cookie: { e: "1" } });
  const amy = result.response.nodes.find((node) => node.localId === "ent_1");
  assert.equal(amy.resolution, "ambiguous-user-handle");
  assert.equal(result.response.warnings.length, 1);
});

test("an ordinary noun is not resolved as a user without an explicit voice person reference", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc, [{
    audienceId: "u:4",
    recordKey: "profile#self",
    principalId: "4",
    serverEntityId: "usr_4",
    displayName: "Pass",
    lookupKey: "handle#pass",
  }]);
  const body = publicationBody();
  body.nodes.find((node) => node.localId === "ent_4").names = ["Pass"];
  const result = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body },
  }, { cookie: { e: "1" } });
  const pass = result.response.nodes.find((node) => node.localId === "ent_4");
  assert.equal(pass.resolution, "publisher-entity");
  assert.notEqual(pass.serverId, "usr_4");
});

test("a public self-name assertion makes earlier facts available to an exact named hydration", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc);
  const aliceMeta = { cookie: { e: "1" } };

  const quantity = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "cats-1",
      source: { sentence: "I have three cats." },
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "observe_quantity", lemmas: ["observe_quantity"] },
        { localId: "cat_record", lemmas: ["cat observation"] },
        { localId: "item", lemmas: ["item"] },
        { localId: "cat", lemmas: ["cat"] },
        { localId: "quantity_delta", lemmas: ["quantity_delta"] },
        { localId: "three", lemmas: ["3"] },
      ],
      relations: [
        { localId: "cats-observed", subjectLocalId: "speaker", predicateLocalId: "observe_quantity", objectLocalId: "cat_record" },
        { localId: "cats-item", subjectLocalId: "cat_record", predicateLocalId: "item", objectLocalId: "cat" },
        { localId: "cats-delta", subjectLocalId: "cat_record", predicateLocalId: "quantity_delta", objectLocalId: "three" },
      ],
    } },
  }, aliceMeta);
  assert.equal(quantity.ok, true);
  assert.ok(Array.from(doc.items.values()).some((item) => item.audienceId === "public:1"));

  const named = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "name-1",
      source: { sentence: "My name is Austin." },
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "name", lemmas: ["name"] },
        { localId: "austin", lemmas: ["austin"], names: ["Austin"] },
      ],
      relations: [
        { localId: "name-assertion", subjectLocalId: "speaker", predicateLocalId: "name", objectLocalId: "austin" },
      ],
    } },
  }, aliceMeta);
  assert.equal(named.ok, true);
  const profile = doc.items.get("u:1\u001fprofile#self");
  assert.equal(profile.displayName, "Austin");
  assert.equal(profile.profileSource, "context-graph");

  const hydrated = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin" } },
  }, { cookie: { e: "2" } });
  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.response.found, true);
  assert.equal(hydrated.response.namedServerId, "usr_1");
  assert.ok(hydrated.response.nodes.some((node) => (
    node.serverId === "usr_1" && node.names.includes("Austin")
  )));
  assert.ok(hydrated.response.relations.some((relation) => relation.serverId));

  doc.items.set("u:3\u001fprofile#self", {
    audienceId: "u:3",
    recordKey: "profile#self",
    recordType: "profile",
    principalId: "3",
    serverEntityId: "usr_3",
    displayName: "Austin",
    lookupKey: "handle#austin",
  });
  const ambiguous = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin" } },
  }, { cookie: { e: "2" } });
  assert.equal(ambiguous.ok, true);
  assert.equal(ambiguous.response.found, false);
  assert.equal(ambiguous.response.ambiguous, true);

  const remembered = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin", entityId: "usr_1" } },
  }, { cookie: { e: "2" } });
  assert.equal(remembered.ok, true);
  assert.equal(remembered.response.found, true);
  assert.equal(remembered.response.namedServerId, "usr_1");

  await handlers.get("contextGraphHydrate")({
    path: "/workspace-alice",
    req: { body: { schemaVersion: 1 } },
  }, aliceMeta);
  assert.equal(doc.items.get("u:1\u001fprofile#self").displayName, "Austin");
});

test("a repeated exact named hydration returns facts published after the first hydration", async () => {
  const doc = memoryDocumentClient();
  const handlers = installRuntime(doc);
  const owner = { cookie: { e: "1" } };
  const reader = { cookie: { e: "2" } };

  await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "refresh-name-1",
      source: { sentence: "My name is Austin." },
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "name", lemmas: ["name"] },
        { localId: "austin", lemmas: ["austin"], names: ["Austin"] },
      ],
      relations: [
        { localId: "name-assertion", subjectLocalId: "speaker", predicateLocalId: "name", objectLocalId: "austin" },
      ],
    } },
  }, owner);

  const first = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin" } },
  }, reader);
  assert.equal(first.response.namedServerId, "usr_1");
  assert.equal(first.response.nodes.some((node) => node.lemmas.includes("cat observation")), false);

  const published = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "refresh-cats-1",
      source: { sentence: "I have three cats." },
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "observe_quantity", lemmas: ["observe_quantity"] },
        { localId: "cat_record", lemmas: ["cat observation"] },
        { localId: "item", lemmas: ["item"] },
        { localId: "cat", lemmas: ["cat"] },
        { localId: "quantity_delta", lemmas: ["quantity_delta"] },
        { localId: "three", lemmas: ["3"] },
      ],
      relations: [
        { localId: "cats-observed", subjectLocalId: "speaker", predicateLocalId: "observe_quantity", objectLocalId: "cat_record" },
        { localId: "cats-item", subjectLocalId: "cat_record", predicateLocalId: "item", objectLocalId: "cat" },
        { localId: "cats-delta", subjectLocalId: "cat_record", predicateLocalId: "quantity_delta", objectLocalId: "three" },
      ],
    } },
  }, owner);
  assert.equal(published.ok, true);

  const refreshed = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin", entityId: "usr_1" } },
  }, reader);
  assert.equal(refreshed.response.namedServerId, "usr_1");
  const catObservation = refreshed.response.nodes.find((node) => node.lemmas.includes("cat observation"));
  assert.ok(catObservation);
  assert.ok(refreshed.response.relations.some((relation) => (
    relation.subject === "usr_1" && relation.object === catObservation.serverId
  )));
});

test("a public relation rewire publishes its new value node with the established audience", async () => {
  const doc = memoryDocumentClient();
  const canonicalPersistence = createCanonicalPersistence({
    documentClient: memoryClient(),
    tableNames: { canonicalProjections: "canonical_projection" },
  });
  const handlers = installRuntime(doc, [], canonicalPersistence);
  const owner = { cookie: { e: "1" } };
  const reader = { cookie: { e: "2" } };

  const initial = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "public-car-dirty-1",
      source: { sentence: "My car is dirty and my name is Austin." },
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "have", lemmas: ["have"] },
        { localId: "car", lemmas: ["car"], names: ["Toyota Camry"] },
        { localId: "condition", lemmas: ["condition"] },
        { localId: "dirty", lemmas: ["dirty"] },
        { localId: "name", lemmas: ["name"] },
        { localId: "austin", lemmas: ["austin"], names: ["Austin"] },
      ],
      relations: [
        { localId: "speaker-car", subjectLocalId: "speaker", predicateLocalId: "have", objectLocalId: "car" },
        { localId: "car-condition", subjectLocalId: "car", predicateLocalId: "condition", objectLocalId: "dirty" },
        { localId: "speaker-name", subjectLocalId: "speaker", predicateLocalId: "name", objectLocalId: "austin" },
      ],
    } },
  }, owner);
  assert.equal(initial.ok, true);
  const nodeIds = Object.fromEntries(initial.response.nodes.map((node) => [node.localId, node.serverId]));
  const relationIds = Object.fromEntries(initial.response.relations.map((relation) => [relation.localId, relation.serverId]));

  const rewired = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "public-car-clean-1",
      source: { sentence: "Wash my car." },
      nodes: [
        { localId: nodeIds.car, lemmas: ["car"], names: ["Toyota Camry"] },
        { localId: nodeIds.condition, lemmas: ["condition"] },
        { localId: "clean", lemmas: ["clean"] },
      ],
      relations: [
        {
          localId: relationIds["car-condition"],
          subjectLocalId: nodeIds.car,
          predicateLocalId: nodeIds.condition,
          objectLocalId: "clean",
        },
      ],
    } },
  }, owner);
  assert.equal(rewired.ok, true);
  const cleanId = rewired.response.nodes.find((node) => node.localId === "clean").serverId;

  const hydrated = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin" } },
  }, reader);
  assert.equal(hydrated.ok, true);
  const condition = hydrated.response.relations.find((relation) => (
    relation.serverId === relationIds["car-condition"]
  ));
  assert.equal(condition.object, cleanId);
  assert.deepEqual(
    hydrated.response.nodes.find((node) => node.serverId === cleanId)?.lemmas,
    ["clean"]
  );
  const hydratedNodeIds = new Set(hydrated.response.nodes.map((node) => node.serverId));
  assert.equal(hydratedNodeIds.has(condition.subject), true);
  assert.equal(hydratedNodeIds.has(condition.predicate), true);
  assert.equal(hydratedNodeIds.has(condition.object), true);

  const changedScope = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "private-car-state-1",
      source: { sentence: "Change the relation scope." },
      nodes: [
        { localId: nodeIds.car, lemmas: ["car"], names: ["Toyota Camry"] },
        { localId: "private-state", lemmas: ["private state"] },
        { localId: cleanId, lemmas: ["clean"] },
      ],
      relations: [
        {
          localId: relationIds["car-condition"],
          subjectLocalId: nodeIds.car,
          predicateLocalId: "private-state",
          objectLocalId: cleanId,
        },
      ],
    } },
  }, owner);
  assert.equal(changedScope.ok, true);

  const afterScopeChange = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin" } },
  }, reader);
  assert.equal(afterScopeChange.response.relations.some((relation) => (
    relation.serverId === relationIds["car-condition"] && relation.tombstone !== true
  )), false);
});

test("using an owner-published app applies only its declared transition to the owner's exact public relation", async () => {
  const doc = memoryDocumentClient();
  const manifest = carwashManifest("u:1");
  const registry = {
    listAvailableByEntityIds: async (ids, options) => (
      ids.includes(manifest.entityId) && options.ownerId === "u:2" ? [manifest] : []
    ),
  };
  const handlers = installRuntime(doc, [], null, registry);
  const owner = { cookie: { e: "1" } };
  const caller = { cookie: { e: "2" } };
  const published = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "delegated-car-dirty",
      source: { sentence: "My car is dirty and my name is Austin." },
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "have", lemmas: ["have"] },
        { localId: "car", lemmas: ["car"], names: ["Toyota Camry"] },
        { localId: "condition", lemmas: ["condition"] },
        { localId: "dirty", lemmas: ["dirty"] },
        { localId: "name", lemmas: ["name"] },
        { localId: "austin", lemmas: ["austin"], names: ["Austin"] },
      ],
      relations: [
        { localId: "speaker-car", subjectLocalId: "speaker", predicateLocalId: "have", objectLocalId: "car" },
        { localId: "car-condition", subjectLocalId: "car", predicateLocalId: "condition", objectLocalId: "dirty" },
        { localId: "speaker-name", subjectLocalId: "speaker", predicateLocalId: "name", objectLocalId: "austin" },
      ],
    } },
  }, owner);
  assert.equal(published.ok, true);
  const nodes = Object.fromEntries(published.response.nodes.map((node) => [node.localId, node.serverId]));
  const relation = published.response.relations.find((item) => item.localId === "car-condition");
  const dependency = manifest.operations[0].entityDependencies[0];
  const request = {
    schemaVersion: 1,
    idempotencyKey: "wash-austins-car",
    capabilityId: manifest.capabilityId,
    entityId: manifest.entityId,
    version: manifest.version,
    operationId: "wash",
    source: { sentence: "Wash Austin's car." },
    effects: [{
      status: "requested",
      authority: "owner-published-capability",
      sourceDependencyId: dependency.dependencyId,
      relationId: relation.serverId,
      subjectEntityId: nodes.car,
      targetEntityId: nodes.condition,
      targetPublisherId: "1",
      targetRelationVersion: relation.version,
    }],
  };
  const applied = await handlers.get("contextGraphApplyCapabilityEffects")({
    path: "/workspace-amy",
    req: { body: request },
  }, caller);
  assert.equal(applied.ok, true);
  assert.equal(applied.response.actorId, "2");
  assert.equal(applied.response.ownerId, "1");
  assert.equal(applied.response.effects[0].value, "clean");
  assert.equal(applied.response.effects[0].relationVersion, 2);

  const ownerRelation = doc.items.get(`u:1\u001frelation#${relation.serverId}`);
  const publicRelation = doc.items.get(`public:1\u001frelation#${relation.serverId}`);
  assert.equal(ownerRelation.object, applied.response.effects[0].valueEntityId);
  assert.equal(publicRelation.object, applied.response.effects[0].valueEntityId);
  assert.equal(ownerRelation.source.actorId, "2");
  assert.equal(ownerRelation.source.capabilityEntityId, manifest.entityId);
  assert.deepEqual(
    await handlers.get("contextGraphApplyCapabilityEffects")({
      path: "/workspace-amy",
      req: { body: request },
    }, caller),
    applied
  );
});

test("a reusable app cannot delegate a write to data published by a different owner", async () => {
  const doc = memoryDocumentClient();
  const manifest = carwashManifest("u:2");
  const handlers = installRuntime(doc, [], null, {
    listAvailableByEntityIds: async () => [manifest],
  });
  const published = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "owner-bound-dirty",
      nodes: [
        { localId: "car", lemmas: ["car"] },
        { localId: "condition", lemmas: ["condition"] },
        { localId: "dirty", lemmas: ["dirty"] },
      ],
      relations: [{ localId: "condition-relation", subjectLocalId: "car", predicateLocalId: "condition", objectLocalId: "dirty" }],
    } },
  }, { cookie: { e: "1" } });
  const nodes = Object.fromEntries(published.response.nodes.map((node) => [node.localId, node.serverId]));
  const relation = published.response.relations[0];
  const result = await handlers.get("contextGraphApplyCapabilityEffects")({
    path: "/workspace-amy",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "foreign-owner-rejected",
      capabilityId: manifest.capabilityId,
      entityId: manifest.entityId,
      version: manifest.version,
      operationId: "wash",
      effects: [{
        sourceDependencyId: manifest.operations[0].entityDependencies[0].dependencyId,
        relationId: relation.serverId,
        subjectEntityId: nodes.car,
        targetEntityId: nodes.condition,
        targetPublisherId: "1",
        targetRelationVersion: 1,
      }],
    } },
  }, { cookie: { e: "2" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CONTEXT_CAPABILITY_TARGET_MISMATCH");
});

test("owned protected placeholders hydrate by name without publishing plaintext", async () => {
  const doc = memoryDocumentClient();
  const reference = "protected_asset:pa_1234567890abcdef";
  doc.items.set("protected-asset\u001fpa_1234567890abcdef", {
    assetId: "pa_1234567890abcdef",
    ownerId: "u:1",
    version: 1,
  });
  const handlers = installRuntime(doc);
  const owner = { cookie: { e: "1" } };
  const protectedFact = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "protected-dogs-1",
      source: { sentence: "I have *** dogs." },
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "observe_quantity", lemmas: ["observe_quantity"] },
        { localId: "dog_record", lemmas: ["dog observation"] },
        { localId: "item", lemmas: ["item"] },
        { localId: "dog", lemmas: ["dog"] },
        { localId: "quantity_delta", lemmas: ["quantity_delta"] },
        {
          localId: "protected_value",
          lemmas: ["protected_asset"],
          protectedAssetReference: reference,
        },
      ],
      relations: [
        { localId: "dogs-observed", subjectLocalId: "speaker", predicateLocalId: "observe_quantity", objectLocalId: "dog_record" },
        { localId: "dogs-item", subjectLocalId: "dog_record", predicateLocalId: "item", objectLocalId: "dog" },
        { localId: "dogs-delta", subjectLocalId: "dog_record", predicateLocalId: "quantity_delta", objectLocalId: "protected_value" },
      ],
    } },
  }, owner);
  assert.equal(protectedFact.ok, true);

  await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "protected-name-1",
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "name", lemmas: ["name"] },
        { localId: "austin", lemmas: ["austin"], names: ["Austin"] },
      ],
      relations: [
        { localId: "name-assertion", subjectLocalId: "speaker", predicateLocalId: "name", objectLocalId: "austin" },
      ],
    } },
  }, owner);

  const hydrated = await handlers.get("contextGraphHydrateNamed")({
    path: "/workspace-amy",
    req: { body: { schemaVersion: 1, query: "Austin" } },
  }, { cookie: { e: "2" } });
  const placeholder = hydrated.response.nodes.find((node) => (
    node.protectedAssetReference === reference
  ));
  assert.ok(placeholder);
  assert.deepEqual(placeholder.lemmas, ["protected_asset"]);
  assert.equal(JSON.stringify(hydrated.response).includes('"2"'), false);
  assert.ok(hydrated.response.relations.some((relation) => relation.object === placeholder.serverId));
});

test("protected Context references must belong to the authenticated publisher", async () => {
  const doc = memoryDocumentClient();
  doc.items.set("protected-asset\u001fpa_1234567890abcdef", {
    assetId: "pa_1234567890abcdef",
    ownerId: "u:2",
    version: 1,
  });
  const handlers = installRuntime(doc);
  const body = publicationBody();
  body.nodes[0].protectedAssetReference = "protected_asset:pa_1234567890abcdef";
  const result = await handlers.get("contextGraphPublish")({
    path: "/workspace-alice",
    req: { body },
  }, { cookie: { e: "1" } });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.error.code, "CONTEXT_PROTECTED_REFERENCE_FORBIDDEN");
});
