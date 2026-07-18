// routes/capabilityPaths.js
"use strict";

const { validateCapabilityManifest } = require("./capabilityManifest");

const clone = (value) => JSON.parse(JSON.stringify(value));

function buildCapabilityPathDataset(rawManifest) {
  const manifest = validateCapabilityManifest(rawManifest, {
    entityId: rawManifest?.entityId,
    ownerId: rawManifest?.ownerId,
  });
  const equations = [];

  for (const operation of manifest.operations) {
    for (const contract of Array.isArray(operation.pathContracts) ? operation.pathContracts : []) {
      const patternId = String(contract.pattern?.patternId || "").trim();
      const familyId = String(contract.familyId || patternId).trim();
      const sig = `pattern:v3:${patternId}`;
      equations.push({
        id: `${manifest.capabilityId}.${operation.operationId}.${patternId}`,
        sig,
        signature: sig,
        left: {
          lib: "tokens",
          state: {
            slots: [],
            pattern: clone(contract.pattern),
          },
        },
        right: {
          lib: "computeCapability",
          state: {
            schemaVersion: 3,
            familyId,
            operation: "invoke_compute_capability",
            mode: "question",
            bindings: [],
            compute: {
              schemaVersion: 1,
              capabilityId: manifest.capabilityId,
              entityId: manifest.entityId,
              version: manifest.version,
              operationId: operation.operationId,
              inputs: clone(operation.inputs),
              outputs: clone(operation.outputs),
              freshness: clone(operation.freshness || { mode: "none", ttlSeconds: 0 }),
              answerTemplate: contract.answerTemplate,
            },
            rows: [],
            conditionalRows: [],
            forEach: [],
            levels: [],
            metadata: {
              inputKind: "question",
              processingStage: "post-classifier",
              source: "compute-capability-manifest-v1",
            },
          },
        },
        family: {
          id: familyId,
          canonicalSig: sig,
          role: "canonical",
          active: true,
          aliases: [],
          observedPlans: [],
          versions: [{
            version: manifest.version,
            status: "active",
            source: "compute-capability-manifest-v1",
            at: manifest.updatedAt || manifest.createdAt || new Date().toISOString(),
          }],
        },
        tests: clone(contract.tests),
        repair: {
          source: "compute-capability-manifest-v1",
          structural: true,
          capabilityId: manifest.capabilityId,
          capabilityVersion: manifest.version,
          entityId: manifest.entityId,
        },
      });
    }
  }

  if (!equations.length) return null;
  return {
    schemaVersion: 1,
    kind: "post-classifier-path-dataset",
    name: `${manifest.capabilityId} generated compute Paths v${manifest.version}`,
    requireLocalClassifier: true,
    capabilityId: manifest.capabilityId,
    entityId: manifest.entityId,
    capabilityVersion: manifest.version,
    equations,
  };
}

module.exports = { buildCapabilityPathDataset };
