"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCanonicalMigration,
  evaluateCutover,
  graphParity,
  requireCutover,
} = require("../app/persistence/canonicalMigration");
const { evaluateScaleProof, partitionDistribution } = require("../app/persistence/canonicalScaleProof");

const graph = {
  nodes: [{ serverId: "n1", version: 1 }],
  relations: [{ serverId: "r1", subject: "n1", predicate: "p1", object: "n2", version: 1, tombstone: false }],
};

test("phase-13 parity detects identity and relationship drift", () => {
  assert.equal(graphParity(graph, structuredClone(graph)).equal, true);
  const changed = structuredClone(graph);
  changed.relations[0].object = "n3";
  const result = graphParity(graph, changed);
  assert.equal(result.equal, false);
  assert.deepEqual(result.relations.mismatched, ["r1"]);
});

test("cutover fails closed until backfill, parity, scale, security, and rollback gates pass", () => {
  const evidence = {
    backfillComplete: true, parityMismatchCount: 0, paritySamples: 1000,
    scalePassed: true, securityPassed: true, rollbackTested: false,
  };
  assert.equal(evaluateCutover(evidence).ready, false);
  assert.throws(() => requireCutover(evidence), (error) => error.code === "CANONICAL_CUTOVER_BLOCKED");
  assert.deepEqual(requireCutover({ ...evidence, rollbackTested: true }), {
    schemaVersion: 1,
    ready: true,
    gates: { backfillComplete: true, parity: true, scale: true, security: true, rollback: true },
    readMode: "canonical",
    writeMode: "canonical",
    rollbackMode: "dual",
  });
});

test("sidecar backfill processes one bounded page and uses deterministic publication identities", async () => {
  const publications = [];
  const migration = createCanonicalMigration({
    persistence: { context: { byAudience: async () => ({ Items: [
      { recordType: "node", publisherId: "1", serverId: "n1", audienceIds: ["u:1"], version: 1 },
      { recordType: "relation", publisherId: "1", serverId: "r1", subject: "n1", predicate: "p1", object: "n2", audienceIds: ["u:1"], version: 1 },
      { recordType: "profile", principalId: "1", serverEntityId: "n1", displayName: "Austin" },
    ], LastEvaluatedKey: { audienceId: "u:1", recordKey: "relation#r1" } }) } },
    canonicalStore: { publish: async (input) => publications.push(input) },
  });
  const result = await migration.backfillAudiencePage({ audienceId: "u:1", limit: 2 });
  assert.equal(result.scanned, 3);
  assert.equal(result.complete, false);
  assert.equal(publications.length, 1);
  assert.match(publications[0].idempotencyKey, /^backfill:[a-f0-9]{32}$/);
  assert.equal(publications[0].profile.displayName, "Austin");
});

test("phase-14 proof rejects hot partitions and accepts bounded distributed evidence", () => {
  const hot = partitionDistribution(Array.from({ length: 1000 }, () => "one"));
  assert.equal(hot.partitions, 1);
  const keys = Array.from({ length: 10_000 }, (_, index) => `S=${String(index % 32).padStart(2, "0")}`);
  const result = evaluateScaleProof({
    partitionKeys: keys,
    latencyMs: Array.from({ length: 1000 }, (_, index) => 100 + (index % 20)),
    maximumObservedFanout: 32,
    crossPrincipalLeakCount: 0,
    protectedPlaintextLeakCount: 0,
    regressionCount: 0,
    unclassifiedFailureCount: 0,
  });
  assert.equal(result.passed, true);
  assert.equal(result.evidence.distribution.partitions, 32);
});
