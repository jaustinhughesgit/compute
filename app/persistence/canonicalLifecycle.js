/**
 * Platform: Applies governed lifecycle changes as one versioned, audited persistence transaction.
 * Technical: Rechecks action grants, builds the next immutable version, then conditionally updates canonical state.
 */
"use strict";

const crypto = require("node:crypto");
const { auditEvent, authorize, transitionLifecycle } = require("../governance");

function createCanonicalLifecycle({ persistence, now = () => new Date() }) {
  if (!persistence?.governance?.enabled) {
    throw new TypeError("canonical governance persistence and audit are required");
  }

  async function transition(input = {}) {
    const resource = input.resource || {};
    const resourceId = String(input.resourceId || resource.id || resource.e || resource.su || resource.g || "").trim();
    if (!resourceId) throw new TypeError("resourceId is required");
    const action = ["deleted", "revoked"].includes(String(input.targetState)) ? "delete" : "govern";
    const decision = authorize({
      actor: input.actor, resource: { ...resource, id: resourceId }, action,
      grants: input.grants || [], expectedVersion: input.expectedVersion,
    });
    if (!decision.allowed) {
      const error = new Error("Lifecycle transition is not authorized");
      error.code = decision.code;
      error.decision = decision;
      throw error;
    }
    const next = transitionLifecycle(resource, input.targetState, input.expectedVersion);
    const timestamp = now();
    const changedAt = timestamp.toISOString();
    const snapshotHash = crypto.createHash("sha256").update(JSON.stringify({
      resourceId, version: next.version, lifecycle: next.lifecycle,
    })).digest("hex");
    const versionRecord = {
      v: `ver#${resourceId}#${String(next.version).padStart(12, "0")}`,
      d: timestamp.getTime(), e: resourceId, c: String(next.version), s: "1",
      canonicalSchemaVersion: 1, canonicalRecordType: "version",
      canonicalResourceType: String(input.resourceType), canonicalVersion: next.version,
      canonicalChangeType: ({ active: "restore", deprecated: "deprecate", revoked: "revoke", deleted: "tombstone" })[next.lifecycle.state],
      canonicalSnapshotHash: snapshotHash, canonicalOwnerId: String(input.actor?.principalId || input.actor || ""),
      canonicalLifecycle: { state: "active", tombstone: false }, updatedAt: changedAt,
    };
    const audit = auditEvent({
      resourceId, resourceType: input.resourceType, actor: input.actor, action, decision,
      requestId: input.requestId, now: timestamp, metadata: {
        fromState: next.previousState, toState: next.lifecycle.state, version: next.version,
      },
    });
    await persistence.governance.transition({
      resourceType: input.resourceType, key: input.key || resourceId,
      expectedVersion: input.expectedVersion, nextVersion: next.version,
      lifecycle: next.lifecycle, updatedAt: changedAt, versionRecord, audit,
    });
    return {
      contractVersion: 1, recordType: "lifecycle-transition", resourceId,
      resourceType: input.resourceType, expectedVersion: Number(input.expectedVersion),
      nextVersion: next.version, fromState: next.previousState, toState: next.lifecycle.state,
      tombstone: next.lifecycle.tombstone, lifecycle: next.lifecycle,
      decision, auditEventId: audit.eventId,
    };
  }

  return Object.freeze({ transition });
}

module.exports = { createCanonicalLifecycle };
