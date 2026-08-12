"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { seedCreatedComputeOwnerGrant } = require("../app/routes/modules/convert");

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

test("owner grant cannot be attached to an entity outside this creation result", async () => {
  const persistence = { authorization: { putGrant: async () => assert.fail("must not write") } };
  assert.equal(await seedCreatedComputeOwnerGrant({
    persistence,
    entityId: "entity-existing",
    ownerId: "u:7",
    createdEntities: [{ entity: "entity-new" }],
  }), false);
});
