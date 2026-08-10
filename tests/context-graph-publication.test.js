"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { register, __test } = require("../app/routes/modules/contextGraph");

function memoryDocumentClient() {
  const items = new Map();
  const key = (item) => `${item.audienceId}\u001f${item.recordKey}`;
  return {
    items,
    put: ({ Item }) => ({ promise: async () => { items.set(key(Item), structuredClone(Item)); } }),
    get: ({ Key }) => ({ promise: async () => ({ Item: structuredClone(items.get(key(Key))) }) }),
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

function installRuntime(doc, profiles = []) {
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

test("component audiences carry every connected fact to a referenced user", () => {
  const audiences = __test.componentAudiences(
    publicationBody().relations,
    new Map([["ent_1", "2"]]),
    "u:1"
  );
  assert.deepEqual(audiences.get("ent_4"), ["u:1", "u:2"]);
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

  await handlers.get("contextGraphHydrate")({
    path: "/workspace-alice",
    req: { body: { schemaVersion: 1 } },
  }, aliceMeta);
  assert.equal(doc.items.get("u:1\u001fprofile#self").displayName, "Austin");
});
