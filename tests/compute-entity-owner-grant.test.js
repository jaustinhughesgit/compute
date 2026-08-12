"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCreatedEntityId,
  seedCreatedComputeOwnerGrant,
} = require("../app/routes/modules/convert");

test("compute build entity references normalize legacy nested result shapes", () => {
  assert.equal(normalizeCreatedEntityId("entity-plain"), "entity-plain");
  assert.equal(normalizeCreatedEntityId({ entity: "entity-row" }), "entity-row");
  assert.equal(normalizeCreatedEntityId({ entity: { id: "entity-nested" } }), "entity-nested");
  assert.equal(normalizeCreatedEntityId({ entityId: { S: "entity-ddb" } }), "entity-ddb");
  assert.equal(normalizeCreatedEntityId({ unrelated: "value" }), "");
});

test("compute creation grants canonical use to the authenticated creator", async () => {
  const written = [];
  const persistence = { authorization: { putGrant: async (item) => written.push(item) } };
  assert.equal(await seedCreatedComputeOwnerGrant({
    persistence,
    entityId: "entity-new",
    ownerId: "u:7",
    createdEntities: [{ entity: "entity-new", type: "compute" }],
  }), true);
  assert.equal(written[0].principalID, "u:7");
  assert.equal(written[0].entityID, "entity-new");
  assert.ok(written[0].canonicalActions.includes("use"));
});

test("owner grant accepts the nested entity result returned by legacy Shorthand", async () => {
  const written = [];
  const persistence = { authorization: { putGrant: async (item) => written.push(item) } };
  assert.equal(await seedCreatedComputeOwnerGrant({
    persistence,
    entityId: { entity: { id: "entity-new" } },
    ownerId: "u:7",
    createdEntities: [{ entity: { id: "entity-new" }, type: "compute" }],
  }), true);
  assert.equal(written[0].entityID, "entity-new");
});

test("owner grant cannot be attached to an entity outside this creation result", async () => {
  const persistence = { authorization: { putGrant: async () => assert.fail("must not write") } };
  assert.equal(await seedCreatedComputeOwnerGrant({
    persistence,
    entityId: "entity-existing",
    ownerId: "u:7",
    createdEntities: [{ entity: "entity-new" }],
  }), false);
});
