/**
 * Platform: Keeps data work, invocation, composition, capability repair, and capability expansion in their proper owning layers.
 * Technical: Produces a deterministic v1 jurisdiction/evolution decision from validated routing and manifest evidence.
 */
'use strict';

const EFFECT_CLASSES = new Set([
  'read.graph', 'write.fact', 'write.correction', 'invoke.local', 'invoke.external',
  'compose', 'define.capability', 'repair.path', 'repair.capability',
  'fork.capability', 'clarify',
]);

function text(value, max = 180) { return String(value ?? '').trim().slice(0, max); }

function speechAct(utterance, fallback = '') {
  const explicit = text(fallback).toLowerCase();
  if (['question', 'assertion', 'correction', 'command', 'clarification'].includes(explicit)) return explicit;
  const value = text(utterance, 2000).toLowerCase();
  if (/^(?:actually|correction|no[, ]|i meant\b)/.test(value)) return 'correction';
  if (/\?$/.test(value) || /^(?:how|what|who|when|where|why|which|do|does|did|can|could|would|is|are|was|were)\b/.test(value)) return 'question';
  return 'assertion';
}

function evolutionDecision({ legacyDecision, manifest = null, operationId = null, capabilityRequest = null } = {}) {
  const decision = text(legacyDecision).toLowerCase();
  if (decision === 'reuse') return { outcome: 'reuse', reasonCode: 'EXACT_ACTIVE_CONTRACT' };
  if (decision === 'build') return { outcome: 'build', reasonCode: 'NO_COMPATIBLE_CONTRACT' };
  if (decision !== 'extend') return { outcome: null, reasonCode: 'NOT_CAPABILITY_EVOLUTION' };

  const existingOperations = new Set((manifest?.operations || []).map((operation) => text(operation?.operationId).toLowerCase()));
  const requestedOperations = (capabilityRequest?.operations || []).map((operation) => text(operation?.operationId).toLowerCase()).filter(Boolean);
  const selectedOperation = text(operationId).toLowerCase();
  const introducesOperation = requestedOperations.some((operation) => !existingOperations.has(operation))
    || (!!selectedOperation && !existingOperations.has(selectedOperation));
  if (introducesOperation) return { outcome: 'fork', reasonCode: 'CONTRACT_OPERATION_ADDED' };
  return { outcome: 'repair', reasonCode: 'DECLARED_OPERATION_NOT_SATISFIED' };
}

function jurisdictionDecision({
  utterance = '', legacyDecision = 'not_compute', source = '', manifest = null,
  operationId = null, capabilityRequest = null, localGraph = false,
} = {}) {
  const act = speechAct(utterance);
  const evolution = evolutionDecision({ legacyDecision, manifest, operationId, capabilityRequest });
  let effectClass = 'clarify';
  let artifactDecision = 'clarify';

  if (localGraph || source === 'local-graph-router') {
    effectClass = act === 'question' ? 'read.graph' : act === 'correction' ? 'write.correction' : 'write.fact';
    artifactDecision = act === 'question' ? 'query_data' : 'mutate_data';
  } else if (evolution.outcome === 'reuse') {
    effectClass = manifest?.execution?.type === 'local' ? 'invoke.local' : 'invoke.external';
    artifactDecision = 'reuse_capability';
  } else if (evolution.outcome === 'repair') {
    effectClass = 'repair.capability';
    artifactDecision = 'repair_capability';
  } else if (evolution.outcome === 'fork') {
    effectClass = 'fork.capability';
    artifactDecision = 'fork_capability';
  } else if (evolution.outcome === 'build') {
    effectClass = 'define.capability';
    artifactDecision = 'build_capability';
  }
  if (!EFFECT_CLASSES.has(effectClass)) throw new Error(`Unsupported effect class ${effectClass}`);
  return {
    contractVersion: 1,
    recordType: 'intent-jurisdiction-decision',
    speechAct: act,
    effectClass,
    artifactDecision,
    evolutionOutcome: evolution.outcome,
    reasonCode: evolution.reasonCode,
    target: manifest ? {
      capabilityId: text(manifest.capabilityId) || null,
      entityId: text(manifest.entityId) || null,
      operationId: text(operationId) || null,
    } : null,
  };
}

module.exports = { EFFECT_CLASSES, evolutionDecision, jurisdictionDecision, speechAct };
