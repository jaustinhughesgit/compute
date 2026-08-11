/**
 * Platform: Defines the five reusable ways entities compose without assigning domain meaning to them.
 * Technical: Normalizes legacy entity/link fields into typed edges and resolves deterministic owning lineage.
 */
"use strict";

const crypto = require("node:crypto");

const PRIMITIVES = Object.freeze({
  map: Object.freeze({ owns: false, meaning: "route a source member to a replacement member within a scope" }),
  extend: Object.freeze({ owns: true, meaning: "add a derived child while retaining the parent contract" }),
  link: Object.freeze({ owns: false, meaning: "reference another entity without transferring ownership" }),
  use: Object.freeze({ owns: false, meaning: "compose another entity's exposed behavior or members" }),
  substitute: Object.freeze({ owns: false, meaning: "replace a selected binding within the caller's scope" }),
});

class CompositionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CompositionError";
    this.code = code;
    this.details = details;
  }
}

function text(value, name) {
  const result = String(value == null ? "" : value).trim();
  if (!result) throw new CompositionError("COMPOSITION_FIELD_REQUIRED", `${name} is required`, { field: name });
  return result;
}

function relationId(primitive, sourceEntityId, targetEntityId, scopeId = "") {
  const raw = [primitive, sourceEntityId, targetEntityId, scopeId].join("\u001f");
  return `cmp_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function createEdge(input) {
  const primitive = text(input?.primitive, "primitive").toLowerCase();
  if (!Object.hasOwn(PRIMITIVES, primitive)) {
    throw new CompositionError("COMPOSITION_PRIMITIVE_INVALID", `Unknown composition primitive '${primitive}'`);
  }
  const sourceEntityId = text(input?.sourceEntityId, "sourceEntityId");
  const targetEntityId = text(input?.targetEntityId, "targetEntityId");
  if (sourceEntityId === targetEntityId) {
    throw new CompositionError("COMPOSITION_SELF_REFERENCE", "A composition edge cannot target itself");
  }
  const scopeId = String(input?.scopeId || "").trim() || null;
  return Object.freeze({
    contractVersion: 1,
    relationId: String(input?.relationId || relationId(primitive, sourceEntityId, targetEntityId, scopeId || "")),
    primitive,
    sourceEntityId,
    targetEntityId,
    scopeId,
    ownsTarget: PRIMITIVES[primitive].owns,
    parameters: input?.parameters && typeof input.parameters === "object" ? { ...input.parameters } : {},
  });
}

function normalizeLegacyEntity(entity = {}) {
  const sourceEntityId = String(entity.e || "").trim();
  if (!sourceEntityId) return [];
  const out = [];
  const addMany = (primitive, values, parameters) => {
    for (const value of Array.isArray(values) ? values : []) {
      if (String(value || "").trim() && String(value) !== sourceEntityId) {
        out.push(createEdge({ primitive, sourceEntityId, targetEntityId: value, parameters }));
      }
    }
  };
  if (entity.parentEntityId && String(entity.parentEntityId) !== sourceEntityId) {
    out.push(createEdge({ primitive: "extend", sourceEntityId: entity.parentEntityId, targetEntityId: sourceEntityId }));
  }
  addMany("extend", entity.t);
  addMany("link", entity.l);
  if (entity.u) out.push(createEdge({ primitive: "use", sourceEntityId, targetEntityId: entity.u }));
  if (entity.z) out.push(createEdge({ primitive: "substitute", sourceEntityId, targetEntityId: entity.z }));
  for (const [mappedSource, targets] of Object.entries(entity.m || {})) {
    addMany("map", Array.isArray(targets) ? targets : [targets], { mappedSource });
  }
  return out;
}

function normalizeRelation(row = {}) {
  const relationKind = String(row.canonicalKind || row.type || "link").toLowerCase();
  const primitive = relationKind === "lineage" ? "extend" : relationKind;
  return createEdge({
    relationId: row.id,
    primitive: Object.hasOwn(PRIMITIVES, primitive) ? primitive : "link",
    sourceEntityId: row.whole,
    targetEntityId: row.part,
    scopeId: row.scopeId,
    parameters: row.parameters || (relationKind === "lineage"
      ? { relationKind: "lineage" } : row.prop ? { propertyEntityId: row.prop } : {}),
  });
}

function resolveOwningLineage(targetEntityId, edges, { maxDepth = 64 } = {}) {
  const target = text(targetEntityId, "targetEntityId");
  const parents = new Map();
  for (const edge of (edges || []).map((item) => item?.contractVersion ? item : createEdge(item))) {
    if (!edge.ownsTarget) continue;
    if (!parents.has(edge.targetEntityId)) parents.set(edge.targetEntityId, new Set());
    parents.get(edge.targetEntityId).add(edge.sourceEntityId);
  }
  const lineage = [target];
  const seen = new Set(lineage);
  let current = target;
  while (parents.has(current)) {
    const candidates = [...parents.get(current)].sort();
    if (candidates.length !== 1) {
      throw new CompositionError("COMPOSITION_LINEAGE_AMBIGUOUS", "Owning lineage has multiple parents", {
        entityId: current, parentEntityIds: candidates,
      });
    }
    current = candidates[0];
    if (seen.has(current)) throw new CompositionError("COMPOSITION_CYCLE", "Owning lineage contains a cycle");
    if (lineage.length >= maxDepth) throw new CompositionError("COMPOSITION_DEPTH_EXCEEDED", "Owning lineage is too deep");
    seen.add(current);
    lineage.unshift(current);
  }
  return Object.freeze(lineage);
}

module.exports = {
  CompositionError,
  PRIMITIVES,
  createEdge,
  normalizeLegacyEntity,
  normalizeRelation,
  relationId,
  resolveOwningLineage,
};
