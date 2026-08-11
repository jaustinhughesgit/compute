"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRIMITIVES, createEdge, normalizeLegacyEntity, normalizeRelation, resolveOwningLineage,
} = require("../app/entityComposition");
const { runEntityMiddleware } = require("../app/entityMiddleware");

test("the five composition primitives remain typed rather than sentence or domain patterns", () => {
  assert.deepEqual(Object.keys(PRIMITIVES), ["map", "extend", "link", "use", "substitute"]);
  const edges = normalizeLegacyEntity({
    e: "parent", parentEntityId: "root", t: ["child"], l: ["reference"], u: "library", z: "replacement",
    m: { source: ["mapped"] },
  });
  assert.deepEqual(edges.map((edge) => edge.primitive).sort(), ["extend", "extend", "link", "map", "substitute", "use"]);
  assert.equal(edges.find((edge) => edge.primitive === "extend").ownsTarget, true);
  assert.equal(edges.filter((edge) => edge.primitive !== "extend").every((edge) => !edge.ownsTarget), true);
  assert.equal(normalizeRelation({ id: "1", whole: "a", part: "b", type: "use" }).primitive, "use");
  assert.equal(normalizeRelation({ id: "2", whole: "a", part: "b", type: "lineage" }).ownsTarget, true);
});

test("owning lineage is deterministic root-to-target and fails closed on invalid graphs", () => {
  const edges = [
    createEdge({ primitive: "extend", sourceEntityId: "root", targetEntityId: "middle" }),
    createEdge({ primitive: "extend", sourceEntityId: "middle", targetEntityId: "target" }),
    createEdge({ primitive: "link", sourceEntityId: "other", targetEntityId: "target" }),
  ];
  assert.deepEqual(resolveOwningLineage("target", edges), ["root", "middle", "target"]);
  assert.throws(() => resolveOwningLineage("target", [...edges,
    createEdge({ primitive: "extend", sourceEntityId: "other", targetEntityId: "target" }),
  ]), (error) => error.code === "COMPOSITION_LINEAGE_AMBIGUOUS");
  assert.throws(() => resolveOwningLineage("root", [...edges,
    createEdge({ primitive: "extend", sourceEntityId: "target", targetEntityId: "root" }),
  ]), (error) => error.code === "COMPOSITION_CYCLE");
});

test("middleware checks every node and the first response terminates the lineage", async () => {
  const calls = [];
  const lineage = ["root", "middle", "target"].map((entityId) => ({ entityId, entityVersion: 1 }));
  const result = await runEntityMiddleware({
    invocation: { contractVersion: 1, recordType: "entity-middleware-invocation", invocationId: "i-1", principal: { principalId: "u1" }, targetEntityId: "target", input: { value: 3 } },
    lineage,
    authorize: async ({ entityId }) => ({ allowed: entityId !== "blocked" }),
    invoke: async ({ entityId }) => {
      calls.push(entityId);
      if (entityId === "middle") return { contractVersion: 1, recordType: "entity-middleware-decision", disposition: "respond", result: { answer: 6 }, effects: [{ type: "read" }] };
      return { contractVersion: 1, recordType: "entity-middleware-decision", disposition: "pass", effects: [] };
    },
  });
  assert.deepEqual(calls, ["root", "middle"]);
  assert.equal(result.disposition, "respond");
  assert.deepEqual(result.result, { answer: 6 });
  assert.deepEqual(result.trace.map((event) => event.entityId), ["root", "middle"]);
});

test("middleware denies before invoking an unauthorized node", async () => {
  const calls = [];
  const lineage = ["root", "blocked", "target"].map((entityId) => ({ entityId, entityVersion: 1 }));
  const result = await runEntityMiddleware({
    invocation: { contractVersion: 1, recordType: "entity-middleware-invocation", invocationId: "i-2", principal: { principalId: "u1" }, targetEntityId: "target", input: {} },
    lineage,
    authorize: async ({ entityId }) => ({ allowed: entityId !== "blocked", code: "GOVERNANCE_FORBIDDEN" }),
    invoke: async ({ entityId }) => { calls.push(entityId); return { contractVersion: 1, recordType: "entity-middleware-decision", disposition: "pass", effects: [] }; },
  });
  assert.deepEqual(calls, ["root"]);
  assert.equal(result.disposition, "fail");
  assert.equal(result.error.code, "GOVERNANCE_FORBIDDEN");
});

test("middleware rejects undeclared effects instead of granting them authority", async () => {
  await assert.rejects(() => runEntityMiddleware({
    invocation: { contractVersion: 1, recordType: "entity-middleware-invocation", invocationId: "i-3", principal: { principalId: "u1" }, targetEntityId: "target", input: {} },
    lineage: [{ entityId: "target", entityVersion: 1 }],
    authorize: async () => ({ allowed: true }),
    invoke: async () => ({ contractVersion: 1, recordType: "entity-middleware-decision", disposition: "pass", effects: [{ type: "filesystem-root" }] }),
  }), (error) => error.code === "MIDDLEWARE_EFFECT_INVALID");
});
