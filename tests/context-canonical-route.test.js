"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCanonicalPersistence } = require("../app/persistence/canonicalPersistence");
const { register } = require("../app/routes/modules/contextGraph");
const { memoryClient } = require("./helpers/canonical-memory-client");

test("Context route dual-writes and hydrates from canonical records with its API unchanged", async () => {
  const client = memoryClient();
  const persistence = createCanonicalPersistence({
    documentClient: client,
    tableNames: { canonicalProjections: "canonical_projection" },
  });
  const handlers = new Map();
  register({
    on: (name, handler) => handlers.set(name, handler),
    use: () => ({
      getDocClient: () => client,
      getCanonicalPersistence: () => persistence,
      getSub: async (value, key) => ({
        Items: key === "su" && value === "workspace-1"
          ? [{ su: "workspace-1", e: "1", output: "Austin", z: true }] : [],
      }),
      getWord: async () => ({ Items: [] }),
    }),
  });
  const body = {
    schemaVersion: 1,
    idempotencyKey: "route-cats-1",
    source: { sentence: "I have three cats." },
    nodes: [
      { localId: "speaker", lemmas: ["speaker"] },
      { localId: "has", lemmas: ["has"] },
      { localId: "cats", lemmas: ["cat"], names: ["Cats"] },
    ],
    relations: [{
      localId: "has-cats", subjectLocalId: "speaker", predicateLocalId: "has", objectLocalId: "cats",
    }],
  };
  const published = await handlers.get("contextGraphPublish")({
    path: "/workspace-1", req: { body },
  }, { cookie: { e: "1" } });
  assert.equal(published.ok, true);
  assert.ok(client.tables.get("entities").size >= 3);
  assert.ok(client.tables.get("links").size >= 1);

  const entityCount = client.tables.get("entities").size;
  const retried = await handlers.get("contextGraphPublish")({
    path: "/workspace-1", req: { body },
  }, { cookie: { e: "1" } });
  assert.deepEqual(retried.response, published.response);
  assert.equal(client.tables.get("entities").size, entityCount);

  // Remove sidecar graph rows to prove canonical hydration is independently usable.
  for (const [key, item] of client.tables.get("context_graph")) {
    if (item.recordType === "node" || item.recordType === "relation") {
      client.tables.get("context_graph").delete(key);
    }
  }
  const hydrated = await handlers.get("contextGraphHydrate")({
    path: "/workspace-1", req: { body: { schemaVersion: 1 } },
  }, { cookie: { e: "1" } });
  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.response.kind, "context-hydration-page");
  assert.ok(hydrated.response.nodes.some((node) => node.names.includes("Cats")));
  assert.equal(hydrated.response.relations.length, 1);
});

test("a failed canonical batch is retryable and never acknowledges the sidecar", async () => {
  const client = memoryClient();
  const batchWrite = client.batchWrite;
  client.batchWrite = (params) => Object.hasOwn(params.RequestItems, "entities")
    ? { promise: async () => { throw new Error("simulated canonical failure"); } }
    : batchWrite(params);
  const persistence = createCanonicalPersistence({
    documentClient: client,
    tableNames: { canonicalProjections: "canonical_projection" },
  });
  const handlers = new Map();
  register({
    on: (name, handler) => handlers.set(name, handler),
    use: () => ({
      getDocClient: () => client,
      getCanonicalPersistence: () => persistence,
      getSub: async () => ({ Items: [{ su: "workspace-1", e: "1", output: "Austin", z: true }] }),
      getWord: async () => ({ Items: [] }),
    }),
  });
  const result = await handlers.get("contextGraphPublish")({
    path: "/workspace-1",
    req: { body: {
      schemaVersion: 1,
      idempotencyKey: "failed-input",
      nodes: [
        { localId: "speaker", lemmas: ["speaker"] },
        { localId: "has", lemmas: ["has"] },
        { localId: "cats", lemmas: ["cat"] },
      ],
      relations: [{
        localId: "has-cats", subjectLocalId: "speaker", predicateLocalId: "has", objectLocalId: "cats",
      }],
    } },
  }, { cookie: { e: "1" } });
  assert.equal(result.error.code, "CONTEXT_CANONICAL_PERSIST_FAILED");
  assert.equal(client.tables.get("context_graph").size, 0);
  assert.equal([...client.tables.get("canonical_projection").values()]
    .some((item) => item.recordType === "canonical-publication"), false);
});
