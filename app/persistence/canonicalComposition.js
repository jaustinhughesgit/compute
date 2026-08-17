/**
 * Platform: Adapts legacy composition routes to canonical action checks, typed relations, versions, and audit.
 * Technical: Resolves addresses/entities through the persistence port and dual-writes relation conformance records.
 */
"use strict";

const crypto = require("node:crypto");
const { createEdge, relationId } = require("../entityComposition");
const { auditEvent, authorize } = require("../governance");

class CompositionAuthorizationError extends Error {
  constructor(decision) {
    super("Composition action is not authorized");
    this.name = "CompositionAuthorizationError";
    this.code = decision?.code || "GOVERNANCE_FORBIDDEN";
    this.statusCode = 403;
    this.decision = decision;
  }
}

function item(result) {
  return result?.Item || result?.Items?.[0] || null;
}

function canonicalRelationId(edge) {
  return edge.primitive === "link" && !edge.scopeId
    ? `lnk#${edge.sourceEntityId}#${edge.targetEntityId}`
    : relationId(edge.primitive, edge.sourceEntityId, edge.targetEntityId, edge.scopeId || "");
}

function createCanonicalComposition({ persistence, verifyLegacy, now = () => new Date() }) {
  if (!persistence?.foundation || !persistence?.authorization) {
    throw new TypeError("canonical persistence foundation and authorization are required");
  }

  async function endpoint(addressId, action, context = {}) {
    const address = item(await persistence.foundation.addresses.byId(addressId, { consistentRead: true }));
    if (!address) throw Object.assign(new Error(`Address '${addressId}' was not found`), { code: "COMPOSITION_ADDRESS_NOT_FOUND" });
    const entity = item(await persistence.foundation.entities.byId(address.e, { consistentRead: true }));
    if (!entity) throw Object.assign(new Error(`Entity '${address.e}' was not found`), { code: "COMPOSITION_ENTITY_NOT_FOUND" });
    const actorId = String(context.actorId || "").trim();
    const principalIds = actorId
      ? [actorId, ...(!actorId.startsWith("u:") ? [`u:${actorId}`] : []), "pub"] : [];
    const grants = principalIds.length ? await persistence.authorization.batchGetGrants(
      [String(entity.e), String(address.su)].flatMap((entityID) => (
        principalIds.map((principalID) => ({ entityID, principalID }))
      ))
    ) : [];
    const normalizedGrants = grants.map((grant) => (
      String(grant.entityID) === String(address.su)
        ? { ...grant, entityID: String(entity.e), compatibilityResourceId: String(address.su) }
        : grant
    ));
    let compatibilityEvidence = null;
    if (!entity.canonicalOwnerId && typeof verifyLegacy === "function") {
      const verified = await verifyLegacy(addressId, { ...context, action });
      if (verified) compatibilityEvidence = {
        authority: "legacy-verifyThis", resourceId: String(entity.e), actions: [action],
      };
    }
    const resource = {
      id: String(entity.e), canonicalOwnerId: entity.canonicalOwnerId || address.canonicalOwnerId,
      canonicalVersion: Number(entity.canonicalVersion || address.canonicalVersion || 1),
      canonicalLifecycle: entity.canonicalLifecycle || { state: "active", tombstone: false },
      visibility: address.z === true || address.z === "true" ? "public" : "private",
    };
    const decision = authorize({ actor: actorId, resource, action, grants: normalizedGrants, compatibilityEvidence, expectedVersion: context.expectedVersion });
    if (persistence.governance?.enabled) {
      await persistence.governance.appendAudit(auditEvent({
        resourceId: resource.id, resourceType: "entity", actor: actorId, action, decision,
        requestId: context.requestId, metadata: context.metadata, now: now(),
      }));
    }
    if (!decision.allowed) throw new CompositionAuthorizationError(decision);
    return { address, entity, resource, decision };
  }

  async function authorizeRelation({ primitive, sourceAddressId, targetAddressId, context = {} }) {
    const source = await endpoint(sourceAddressId, "edit", { ...context, metadata: { ...context.metadata, primitive } });
    const target = await endpoint(targetAddressId, "use", { ...context, metadata: { ...context.metadata, primitive } });
    const edge = createEdge({
      primitive, sourceEntityId: source.entity.e, targetEntityId: target.entity.e,
      scopeId: context.scopeId, parameters: context.parameters,
    });
    const existingRelation = item(await persistence.foundation.relations.byId(canonicalRelationId(edge)));
    return { source, target, edge, existingRelation };
  }

  async function persist(edgeInput, context = {}) {
    const edge = edgeInput?.contractVersion ? edgeInput : createEdge(edgeInput);
    const id = canonicalRelationId(edge);
    const existing = context.previous || item(await persistence.foundation.relations.byId(id));
    const version = Math.max(1, Number(existing?.canonicalVersion || 0) + 1);
    const timestamp = now().toISOString();
    const lifecycle = context.tombstone
      ? { state: "deleted", tombstone: true, deletedAt: timestamp }
      : { state: "active", tombstone: false };
    const row = {
      ...(existing || {}), id, whole: edge.sourceEntityId, part: edge.targetEntityId,
      ckey: `${edge.sourceEntityId}|${edge.targetEntityId}`, type: edge.primitive,
      scopeId: edge.scopeId, parameters: edge.parameters, by: String(context.actorId || existing?.by || ""),
      canonicalSchemaVersion: 1, canonicalRecordType: "relation", canonicalKind: edge.primitive,
      canonicalVersion: version, canonicalOwnerId: String(context.actorId || existing?.canonicalOwnerId || ""),
      canonicalLifecycle: lifecycle, tombstone: context.tombstone === true, updatedAt: timestamp,
    };
    const snapshotHash = crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
    const versionRecord = {
      v: `ver#${id}#${String(version).padStart(12, "0")}`, d: now().getTime(), e: id,
      c: String(version), s: "1", canonicalSchemaVersion: 1, canonicalRecordType: "version",
      canonicalResourceType: "relation", canonicalVersion: version,
      canonicalChangeType: context.tombstone ? "tombstone" : (version === 1 ? "create" : "replace"),
      canonicalSnapshotHash: snapshotHash, canonicalOwnerId: row.canonicalOwnerId,
      canonicalLifecycle: { state: "active", tombstone: false }, updatedAt: timestamp,
    };
    const audit = auditEvent({
      resourceId: id, resourceType: "relation", actor: context.actorId,
      action: context.tombstone ? "delete" : "edit", decision: { allowed: true, code: "GOVERNANCE_COMPOSITION_WRITE" },
      requestId: context.requestId, metadata: {
        primitive: edge.primitive, sourceEntityId: edge.sourceEntityId,
        targetEntityId: edge.targetEntityId, version,
      }, now: now(),
    });
    if (typeof persistence.governance?.writeRelation === "function") {
      await persistence.governance.writeRelation({
        relation: row, expectedVersion: Number(existing?.canonicalVersion || 0), versionRecord, audit,
      });
    } else {
      await persistence.foundation.relations.put(row);
      await persistence.foundation.versions?.put?.(versionRecord);
      if (persistence.governance?.enabled) await persistence.governance.appendAudit(audit);
    }
    return row;
  }

  return Object.freeze({ authorizeEndpoint: endpoint, authorizeRelation, persist });
}

module.exports = { CompositionAuthorizationError, createCanonicalComposition };
