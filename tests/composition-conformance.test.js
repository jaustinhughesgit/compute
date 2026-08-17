"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCanonicalComposition } = require("../app/persistence/canonicalComposition");

function fakePersistence() {
  const addresses = new Map([
    ["source-su", { su: "source-su", e: "source", canonicalOwnerId: "owner", canonicalVersion: 2 }],
    ["target-su", { su: "target-su", e: "target", canonicalOwnerId: "target-owner", canonicalVersion: 1, z: true }],
  ]);
  const entities = new Map([
    ["source", { e: "source", canonicalOwnerId: "owner", canonicalVersion: 2, canonicalLifecycle: { state: "active", tombstone: false } }],
    ["target", { e: "target", canonicalOwnerId: "target-owner", canonicalVersion: 1, canonicalLifecycle: { state: "active", tombstone: false } }],
  ]);
  const relations = new Map();
  const audits = [];
  const identityReads = [];
  return {
    relations, audits, identityReads,
    foundation: {
      addresses: { byId: async (id, options) => {
        identityReads.push({ kind: "address", id, options });
        return { Items: addresses.has(id) ? [addresses.get(id)] : [] };
      } },
      entities: { byId: async (id, options) => {
        identityReads.push({ kind: "entity", id, options });
        return { Items: entities.has(id) ? [entities.get(id)] : [] };
      } },
      relations: {
        byId: async (id) => ({ Item: relations.get(id) }),
        put: async (row) => { relations.set(row.id, row); },
      },
    },
    authorization: { batchGetGrants: async (keys) => keys[0]?.entityID === "target" ? [{
      entityID: "target", principalID: "owner", canonicalActions: ["use"],
    }] : [] },
    governance: { enabled: true, appendAudit: async (event) => audits.push(event) },
  };
}

test("composition authorization checks source edit and target use before writing a canonical relation", async () => {
  const persistence = fakePersistence();
  const service = createCanonicalComposition({ persistence, now: () => new Date("2026-08-11T12:00:00.000Z") });
  const authorized = await service.authorizeRelation({
    primitive: "use", sourceAddressId: "source-su", targetAddressId: "target-su", context: { actorId: "owner" },
  });
  const row = await service.persist(authorized.edge, { actorId: "owner" });
  assert.equal(row.canonicalKind, "use");
  assert.equal(row.whole, "source");
  assert.equal(row.part, "target");
  assert.equal(row.canonicalVersion, 1);
  assert.equal(persistence.audits.length, 3);
  assert.equal(persistence.identityReads.length, 4);
  assert.ok(persistence.identityReads.every((read) => read.options?.consistentRead === true));
});

test("all active composition routes use the canonical conformance adapter", () => {
  const root = path.resolve(__dirname, "../app/routes/modules");
  for (const file of ["map.js", "extend.js", "links.js", "useGroup.js", "substituteGroup.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /getCanonicalComposition/);
    assert.match(source, /composition\.persist/);
    assert.match(source, /composition\.authorize(?:Relation|Endpoint)/);
  }
});
