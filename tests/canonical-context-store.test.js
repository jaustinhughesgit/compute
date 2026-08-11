"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCanonicalPersistence } = require("../app/persistence/canonicalPersistence");
const {
  compileContextRecords,
  createCanonicalContextStore,
} = require("../app/persistence/canonicalContextStore");
const { wordIdentifier } = require("../app/persistence/canonicalIdentifiers");
const { memoryClient } = require("./helpers/canonical-memory-client");

function examplePublication() {
  return {
    principalId: "1",
    workspaceSu: "workspace-1",
    idempotencyKey: "spoken-input-1",
    profile: { principalId: "1", serverEntityId: "usr_1", displayName: "Austin" },
    nodes: [
      { localId: "speaker", serverId: "usr_1", lemmas: ["speaker"], names: ["Austin"], version: 1, visibility: "public-workspace", audienceIds: ["u:1", "public:1"] },
      { localId: "cats", serverId: "ctx_cats", lemmas: ["cat"], names: ["Cats"], version: 1, visibility: "public-workspace", audienceIds: ["u:1", "public:1"] },
      { localId: "three", serverId: "ctx_three", lemmas: ["3"], names: [], version: 1, visibility: "public-workspace", audienceIds: ["u:1", "public:1"] },
    ],
    relations: [{
      localId: "has-cats",
      serverId: "rel_has_cats",
      subject: "usr_1",
      predicate: "term_has",
      object: "ctx_cats",
      version: 1,
      visibility: "public-workspace",
      audienceIds: ["u:1", "public:1"],
      source: { sentence: "I have three cats." },
      tombstone: false,
    }],
  };
}

test("Context compilation emits established canonical records without counter allocation", () => {
  const records = compileContextRecords(examplePublication());
  assert.ok(records.words.some((row) => row.s === "cat"));
  assert.ok(records.entities.some((row) => (
    row.e === "ctx_cats" && row.wordIds.includes(wordIdentifier("cat"))
  )));
  assert.ok(records.addresses.some((row) => row.e === "ctx_cats"));
  assert.ok(records.groups.some((row) => row.canonicalKind === "context" && row.e === "usr_1"));
  assert.ok(records.entities.every((row) => row.g === records.groups[0].g));
  assert.ok(records.relations.some((row) => row.id === "rel_has_cats"));
  assert.ok(records.versions.length >= records.entities.length + records.relations.length);
  assert.ok(records.grants.some((row) => row.entityID === "ctx_cats" && row.principalID === "pub"));
  assert.ok(records.projections.every((row) => row.pk && row.sk));
  assert.equal(JSON.stringify(records).includes("Counter"), false);
});

test("canonical publication hydrates authorized facts and supports profile and word candidates", async () => {
  const client = memoryClient();
  const persistence = createCanonicalPersistence({
    documentClient: client,
    tableNames: { canonicalProjections: "canonical_projection" },
  });
  const store = createCanonicalContextStore({ persistence });
  const result = await store.publish(examplePublication());
  assert.ok(result.written > 0);

  const hydrated = await store.hydrateAudience("public:1");
  assert.ok(hydrated.nodes.some((row) => row.serverId === "ctx_cats"));
  assert.ok(hydrated.relations.some((row) => row.serverId === "rel_has_cats"));

  const profiles = await store.findProfiles("AUSTIN");
  assert.deepEqual(profiles, [{ principalId: "1", serverEntityId: "usr_1", displayName: "Austin" }]);

  const candidates = await store.findEntityIdsByWord(wordIdentifier("cats"));
  assert.deepEqual(candidates.entityIds, ["ctx_cats"]);
});

test("hydration reloads grants instead of trusting an audience projection", async () => {
  const client = memoryClient();
  const persistence = createCanonicalPersistence({
    documentClient: client,
    tableNames: { canonicalProjections: "canonical_projection" },
  });
  const store = createCanonicalContextStore({ persistence });
  await store.publish(examplePublication());
  client.tables.get("perm_grants").delete("ctx_cats\u001fpub");

  const hydrated = await store.hydrateAudience("public:1");
  assert.equal(hydrated.nodes.some((row) => row.serverId === "ctx_cats"), false);
});

test("audience projections distribute identifiers across partition keys", () => {
  const input = examplePublication();
  input.nodes = Array.from({ length: 512 }, (_, index) => ({
    localId: `node-${index}`,
    serverId: `ctx_${index}`,
    lemmas: [`item ${index}`],
    version: 1,
    audienceIds: ["u:1"],
  }));
  input.relations = [];
  const records = compileContextRecords(input);
  const partitions = new Set(records.projections
    .filter((row) => row.recordType === "audience-node" && row.audienceId === "u:1")
    .map((row) => row.pk));
  assert.ok(partitions.size >= 24, `expected broad shard use, saw ${partitions.size}`);
});
