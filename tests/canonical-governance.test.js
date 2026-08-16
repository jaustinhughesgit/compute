"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditEvent, authorize, transitionLifecycle } = require("../app/governance");
const { createCanonicalLifecycle } = require("../app/persistence/canonicalLifecycle");

const resource = {
  id: "entity-1", canonicalOwnerId: "owner", canonicalVersion: 3,
  canonicalLifecycle: { state: "active", tombstone: false }, visibility: "private",
};

test("one governance decision covers owner, action grant, expiry, public visibility, and optimistic version", () => {
  assert.equal(authorize({ actor: "owner", resource, action: "edit", expectedVersion: 3 }).allowed, true);
  assert.equal(authorize({ actor: "owner", resource, action: "edit", expectedVersion: 2 }).code, "GOVERNANCE_VERSION_CONFLICT");
  const grant = { entityID: "entity-1", principalID: "reader", canonicalActions: ["read"], perms: "r" };
  assert.equal(authorize({ actor: "reader", resource, action: "read", grants: [grant] }).allowed, true);
  assert.equal(authorize({ actor: "reader", resource, action: "read", grants: [{ ...grant, principalID: "u:reader" }] }).allowed, true);
  assert.equal(authorize({ actor: "reader", resource, action: "edit", grants: [grant] }).allowed, false);
  assert.equal(authorize({ actor: "reader", resource, action: "read", grants: [{ ...grant, expires: 1 }], now: Date.now() }).allowed, false);
  assert.equal(authorize({ actor: "anyone", resource: { ...resource, visibility: "public" }, action: "aggregate" }).allowed, true);
  assert.equal(authorize({ actor: "anyone", resource: { ...resource, visibility: "public" }, action: "edit" }).allowed, false);
  assert.equal(authorize({ actor: "anyone", resource, action: "use", grants: [{
    entityID: "entity-1", principalID: "pub", canonicalActions: ["use"],
  }] }).allowed, true);
  const legacyExecution = authorize({ actor: "runner", resource, action: "execute", grants: [{ entityID: "entity-1", principalID: "runner", perms: "e" }] });
  assert.equal(legacyExecution.allowed, true);
  assert.equal(legacyExecution.action, "use");
  assert.equal(legacyExecution.requestedAction, "execute");
  assert.equal(authorize({ actor: "runner", resource, action: "use", grants: [{ entityID: "entity-1", principalID: "runner", canonicalActions: ["execute"] }] }).allowed, true);
  assert.equal(authorize({ actor: "permit", resource, action: "delegate", grants: [{ entityID: "entity-1", principalID: "permit", perms: "p" }] }).allowed, true);
});

test("legacy verification is accepted only for the exact resource and action", () => {
  const compatibilityEvidence = {
    authority: "legacy-verifyThis", resourceId: "entity-1", actions: ["use"],
  };
  assert.equal(authorize({ actor: "legacy", resource, action: "use", compatibilityEvidence }).allowed, true);
  assert.equal(authorize({ actor: "legacy", resource, action: "edit", compatibilityEvidence }).allowed, false);
  assert.equal(authorize({ actor: "legacy", resource: { ...resource, id: "entity-2" }, action: "use", compatibilityEvidence }).allowed, false);
});

test("lifecycle transitions are versioned and terminal states fail closed", () => {
  const next = transitionLifecycle(resource, "deprecated", 3);
  assert.equal(next.version, 4);
  assert.equal(next.lifecycle.state, "deprecated");
  assert.throws(() => transitionLifecycle(resource, "draft", 3), (error) => error.code === "GOVERNANCE_TRANSITION_INVALID");
  assert.throws(() => transitionLifecycle(resource, "deleted", 2), (error) => error.code === "GOVERNANCE_VERSION_CONFLICT");
  assert.equal(authorize({ actor: "owner", resource: { ...resource, canonicalLifecycle: { state: "revoked", tombstone: false } }, action: "read" }).allowed, false);
});

test("audit evidence excludes payloads and lifecycle service writes state, version, and audit atomically", async () => {
  assert.throws(
    () => createCanonicalLifecycle({ persistence: { governance: { enabled: false } } }),
    /audit are required/
  );
  const event = auditEvent({
    resourceId: "entity-1", resourceType: "entity", actor: "owner", action: "edit",
    decision: { allowed: true, code: "GOVERNANCE_OWNER" }, metadata: { primitive: "use", plaintext: "secret" },
    now: new Date("2026-08-11T12:00:00.000Z"),
  });
  assert.equal(event.metadata.primitive, "use");
  assert.equal(Object.hasOwn(event.metadata, "plaintext"), false);
  assert.match(event.auditPartition, /^entity-1#2026-08#\d{2}$/);

  const calls = [];
  const lifecycle = createCanonicalLifecycle({
    persistence: { governance: { enabled: true, transition: async (input) => calls.push(input) } },
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });
  const result = await lifecycle.transition({
    resourceType: "entity", resourceId: "entity-1", resource, targetState: "deprecated",
    expectedVersion: 3, actor: "owner", requestId: "request-1",
  });
  assert.equal(result.nextVersion, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].versionRecord.canonicalVersion, 4);
  assert.equal(calls[0].versionRecord.canonicalChangeType, "deprecate");
  assert.equal(calls[0].audit.resourceId, "entity-1");
});
