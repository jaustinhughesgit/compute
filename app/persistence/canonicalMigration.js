/**
 * Platform: Supplies the bounded backfill, parity, cutover, and rollback gates for retiring the Context sidecar.
 * Technical: Replays one audience page into canonical records and compares identity-bearing graph fields without deleting data.
 */
"use strict";

const crypto = require("node:crypto");

function normalizedGraph(graph = {}) {
  const normalize = (records, fields) => (Array.isArray(records) ? records : [])
    .map((record) => Object.fromEntries(fields.map((field) => [field, record?.[field] ?? null])))
    .sort((left, right) => String(left.serverId).localeCompare(String(right.serverId)));
  return {
    nodes: normalize(graph.nodes, ["serverId", "version"]),
    relations: normalize(graph.relations, ["serverId", "subject", "predicate", "object", "version", "tombstone"]),
  };
}

function graphParity(canonical, sidecar) {
  const left = normalizedGraph(canonical);
  const right = normalizedGraph(sidecar);
  const compare = (primary, compatibility) => {
    const p = new Map(primary.map((item) => [item.serverId, JSON.stringify(item)]));
    const c = new Map(compatibility.map((item) => [item.serverId, JSON.stringify(item)]));
    return {
      missingCanonical: [...c.keys()].filter((id) => !p.has(id)),
      missingSidecar: [...p.keys()].filter((id) => !c.has(id)),
      mismatched: [...p.keys()].filter((id) => c.has(id) && p.get(id) !== c.get(id)),
    };
  };
  const nodes = compare(left.nodes, right.nodes);
  const relations = compare(left.relations, right.relations);
  const mismatchCount = Object.values(nodes).concat(Object.values(relations))
    .reduce((total, values) => total + values.length, 0);
  return { schemaVersion: 1, equal: mismatchCount === 0, mismatchCount, nodes, relations };
}

function evaluateCutover(evidence = {}) {
  const gates = {
    backfillComplete: evidence.backfillComplete === true,
    parity: Number(evidence.parityMismatchCount) === 0 && Number(evidence.paritySamples) > 0,
    scale: evidence.scalePassed === true,
    security: evidence.securityPassed === true,
    rollback: evidence.rollbackTested === true,
  };
  return { schemaVersion: 1, ready: Object.values(gates).every(Boolean), gates };
}

function requireCutover(evidence) {
  const result = evaluateCutover(evidence);
  if (!result.ready) {
    const error = new Error("Canonical cutover gates have not passed");
    error.code = "CANONICAL_CUTOVER_BLOCKED";
    error.gates = result.gates;
    throw error;
  }
  return { ...result, readMode: "canonical", writeMode: "canonical", rollbackMode: "dual" };
}

function createCanonicalMigration({ persistence, canonicalStore } = {}) {
  if (!persistence?.context || !canonicalStore?.publish) throw new TypeError("migration requires sidecar and canonical stores");

  async function backfillAudiencePage({ audienceId, cursor = null, limit = 100 } = {}) {
    const page = await persistence.context.byAudience(audienceId, {
      cursor, limit: Math.max(1, Math.min(500, Number(limit) || 100)), consistentRead: true,
    });
    const byPublisher = new Map();
    for (const item of page?.Items || []) {
      if (!["node", "relation", "profile"].includes(item?.recordType)) continue;
      const publisherId = String(item.publisherId || item.principalId || "");
      if (!publisherId) continue;
      if (!byPublisher.has(publisherId)) byPublisher.set(publisherId, { nodes: [], relations: [], profile: null });
      const group = byPublisher.get(publisherId);
      if (item.recordType === "node") group.nodes.push({ ...item, localId: item.serverId });
      else if (item.recordType === "relation") group.relations.push({ ...item, localId: item.serverId });
      else group.profile = item;
    }
    let publications = 0;
    for (const [principalId, graph] of byPublisher) {
      const identity = crypto.createHash("sha256")
        .update(JSON.stringify([audienceId, principalId, graph.profile?.displayName || null,
          graph.nodes.map((item) => item.serverId), graph.relations.map((item) => item.serverId)]))
        .digest("hex").slice(0, 32);
      await canonicalStore.publish({
        principalId,
        workspaceSu: `legacy-context:${principalId}`,
        idempotencyKey: `backfill:${identity}`,
        nodes: graph.nodes,
        relations: graph.relations,
        profile: graph.profile ? {
          principalId,
          serverEntityId: graph.profile.serverEntityId,
          displayName: graph.profile.displayName,
        } : null,
      });
      publications += 1;
    }
    return {
      schemaVersion: 1,
      audienceId: String(audienceId),
      scanned: (page?.Items || []).length,
      publications,
      cursor: page?.LastEvaluatedKey || null,
      complete: !page?.LastEvaluatedKey,
    };
  }

  return { backfillAudiencePage };
}

module.exports = {
  createCanonicalMigration,
  evaluateCutover,
  graphParity,
  normalizedGraph,
  requireCutover,
};
