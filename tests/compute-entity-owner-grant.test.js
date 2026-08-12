"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  describeEntityReferenceShape,
  normalizeCreatedEntityId,
  resolveCreatedCapabilityEntityId,
  seedCreatedComputeOwnerGrant,
} = require("../app/routes/modules/convert");

test("compute build entity references normalize legacy nested result shapes", () => {
  assert.equal(normalizeCreatedEntityId("entity-plain"), "entity-plain");
  assert.equal(normalizeCreatedEntityId({ entity: "entity-row" }), "entity-row");
  assert.equal(normalizeCreatedEntityId({ entity: { id: "entity-nested" } }), "entity-nested");
  assert.equal(normalizeCreatedEntityId({ entityId: { S: "entity-ddb" } }), "entity-ddb");
  assert.equal(normalizeCreatedEntityId({ response: { file: "entity-route" } }), "entity-route");
  assert.equal(normalizeCreatedEntityId({ response: { oai: { html: { response: {
    response: { file: "entity-deep-route", entity: "not-the-subdomain-id" },
  } } } } }), "entity-deep-route");
  assert.equal(normalizeCreatedEntityId({ unrelated: "value" }), "");
  assert.equal(
    describeEntityReferenceShape({ route: { opaque: true } }),
    "{route:{opaque:boolean}}"
  );
});

test("capability registration recovers the created id from its manifest reference", () => {
  assert.equal(resolveCreatedCapabilityEntityId({
    conclusion: { entity: { unrelated: "shape" } },
    createdEntities: [],
    manifest: { entityId: { response: { file: "entity-from-manifest" } } },
  }), "entity-from-manifest");
  assert.equal(resolveCreatedCapabilityEntityId({
    conclusion: {},
    createdEntities: [],
    manifest: { entityId: "pending-capability-entity" },
  }), "");
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
