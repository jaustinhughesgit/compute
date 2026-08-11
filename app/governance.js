/**
 * Platform: Makes one action-grant and lifecycle decision for canonical resources across routes and execution.
 * Technical: Evaluates principals, canonical/legacy grants, state, expiry, optimistic versions, and safe audit evidence.
 */
"use strict";

const crypto = require("node:crypto");

const ACTIONS = Object.freeze([
  "find", "read", "aggregate", "use", "execute", "set", "edit", "delete", "delegate", "publish", "govern",
]);
const MUTATIONS = new Set(["set", "edit", "delete", "delegate", "publish", "govern"]);
const PUBLIC_ACTIONS = new Set(["find", "read", "aggregate"]);
const LEGACY_ACTIONS = Object.freeze({
  e: ["execute"],
  r: ["find", "read", "aggregate", "use"],
  w: ["set", "edit"],
  a: ["set"],
  d: ["delete"],
  p: ["delegate"],
  o: ["govern"],
});
const TRANSITIONS = Object.freeze({
  draft: new Set(["active", "deleted"]),
  active: new Set(["deprecated", "revoked", "deleted"]),
  deprecated: new Set(["active", "revoked", "deleted"]),
  revoked: new Set(["deleted"]),
  deleted: new Set(),
});

function principalId(value) {
  return String(value?.principalId ?? value?.id ?? value ?? "").trim();
}

function samePrincipal(left, right) {
  const a = principalId(left);
  const b = principalId(right);
  if (a === b) return true;
  return a.startsWith("u:") ? a.slice(2) === b : b.startsWith("u:") && b.slice(2) === a;
}

function lifecycle(resource) {
  return resource?.lifecycle || resource?.canonicalLifecycle || {
    state: resource?.tombstone ? "deleted" : "active", tombstone: resource?.tombstone === true,
  };
}

function grantActions(grant) {
  const actions = new Set(Array.isArray(grant?.actions) ? grant.actions : grant?.canonicalActions || []);
  for (const character of String(grant?.perms || "")) {
    for (const action of LEGACY_ACTIONS[character] || []) actions.add(action);
  }
  return actions;
}

function activeGrant(grant, actorId, resourceId, nowMs) {
  const grantee = principalId(grant?.principal || grant?.principalID);
  const target = String(grant?.resourceId || grant?.entityID || "");
  const state = lifecycle(grant).state;
  const expires = grant?.expiresAt ? Date.parse(grant.expiresAt) : Number(grant?.expires) * 1000;
  return samePrincipal(grantee, actorId) && target === resourceId
    && !["revoked", "deleted"].includes(state)
    && (!Number.isFinite(expires) || expires >= nowMs);
}

function authorize(input = {}) {
  const action = String(input.action || "").toLowerCase();
  const resource = input.resource || {};
  const resourceId = String(resource.id || resource.e || resource.su || resource.g || resource.entityID || "").trim();
  const actorId = principalId(input.actor);
  const result = (value) => ({
    contractVersion: 1, recordType: "governance-decision", resourceId, actorId, action, ...value,
  });
  if (!ACTIONS.includes(action)) return result({ allowed: false, code: "GOVERNANCE_ACTION_INVALID", source: "none" });
  if (!resourceId || !actorId) return result({ allowed: false, code: "GOVERNANCE_IDENTITY_REQUIRED", source: "none" });
  const state = lifecycle(resource);
  if (state.tombstone || ["revoked", "deleted"].includes(state.state)) {
    return result({ allowed: false, code: "GOVERNANCE_RESOURCE_INACTIVE", source: "none" });
  }
  const version = Number(resource.version || resource.canonicalVersion || 1);
  if (MUTATIONS.has(action) && input.expectedVersion != null && Number(input.expectedVersion) !== version) {
    return result({ allowed: false, code: "GOVERNANCE_VERSION_CONFLICT", source: "none", currentVersion: version });
  }
  const ownerId = principalId(resource.owner || resource.canonicalOwnerId || resource.ownerId);
  if (samePrincipal(actorId, ownerId)) return result({ allowed: true, code: "GOVERNANCE_OWNER", source: "owner" });
  const nowMs = input.now instanceof Date ? input.now.getTime() : Number(input.now || Date.now());
  const grant = (input.grants || []).find((item) => activeGrant(item, actorId, resourceId, nowMs)
    && grantActions(item).has(action));
  if (grant) return result({ allowed: true, code: "GOVERNANCE_GRANT", source: "grant", grantId: grant.id || null });
  if (resource.visibility === "public" && PUBLIC_ACTIONS.has(action)) {
    return result({ allowed: true, code: "GOVERNANCE_PUBLIC", source: "public" });
  }
  const evidence = input.compatibilityEvidence;
  if (evidence?.authority === "legacy-verifyThis"
    && evidence.resourceId === resourceId
    && Array.isArray(evidence.actions) && evidence.actions.includes(action)) {
    return result({ allowed: true, code: "GOVERNANCE_COMPATIBILITY", source: "compatibility" });
  }
  return result({ allowed: false, code: "GOVERNANCE_FORBIDDEN", source: "none" });
}

function transitionLifecycle(resource, targetState, expectedVersion) {
  const current = lifecycle(resource).state;
  const target = String(targetState || "").toLowerCase();
  const version = Number(resource?.version || resource?.canonicalVersion || 1);
  if (Number(expectedVersion) !== version) {
    const error = new Error("Lifecycle version conflict");
    error.code = "GOVERNANCE_VERSION_CONFLICT";
    throw error;
  }
  if (!TRANSITIONS[current]?.has(target)) {
    const error = new Error(`Lifecycle transition ${current} -> ${target} is not allowed`);
    error.code = "GOVERNANCE_TRANSITION_INVALID";
    throw error;
  }
  return Object.freeze({
    previousState: current, version: version + 1,
    lifecycle: { state: target, tombstone: target === "deleted", ...(target === "deleted" ? { deletedAt: new Date().toISOString() } : {}) },
  });
}

function auditEvent({ resourceId, resourceType, actor, action, decision, requestId, metadata = {}, now = new Date() }) {
  const eventId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const month = timestamp.slice(0, 7);
  const shard = crypto.createHash("sha256").update(eventId).digest()[0] % 16;
  const allowedMetadata = {};
  for (const key of ["primitive", "sourceEntityId", "targetEntityId", "fromState", "toState", "version"]) {
    if (metadata[key] != null) allowedMetadata[key] = String(metadata[key]).slice(0, 180);
  }
  return {
    auditPartition: `${resourceId}#${month}#${String(shard).padStart(2, "0")}`,
    eventKey: `${timestamp}#${eventId}`,
    schemaVersion: 1, recordType: "governance-audit", eventId, timestamp, resourceId: String(resourceId), resourceType: String(resourceType),
    actorId: principalId(actor) || "anonymous", action: String(action), allowed: decision?.allowed === true,
    decisionCode: String(decision?.code || "GOVERNANCE_UNKNOWN"), requestId: requestId ? String(requestId).slice(0, 180) : null,
    metadata: allowedMetadata,
  };
}

module.exports = { ACTIONS, LEGACY_ACTIONS, auditEvent, authorize, grantActions, transitionLifecycle };
