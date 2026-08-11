/**
 * Platform: Applies the shared execution-envelope contract at the Compute/JPL trust boundary.
 * Technical: Implements the canonical v1 schema in Node and supplies helpers for governed Compute results.
 */
'use strict';

const PLANES = new Set(['browser-main', 'file-worker', 'compute-jpl']);
const EFFECTS = new Set(['read', 'write', 'network', 'communication', 'navigation', 'automation', 'governance', 'presentation']);
const FORBIDDEN_SOURCE_KEYS = new Set(['code', 'script', 'javascript', 'functionsource', 'sourcecode']);

function clean(value, max = 180) { return String(value ?? '').trim().slice(0, max); }
function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
function sourceFree(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.entries(value).every(([key, child]) => (
    !FORBIDDEN_SOURCE_KEYS.has(String(key).toLowerCase()) && sourceFree(child, seen)
  ));
}
function validateInvocation(value) {
  const errors = [];
  if (value?.contractVersion !== 1 || value?.recordType !== 'execution-invocation') errors.push('invalid contract identity');
  if (!clean(value?.invocationId)) errors.push('invocationId is required');
  if (!PLANES.has(clean(value?.plane))) errors.push('execution plane is invalid');
  if (!clean(value?.target?.kind) || !clean(value?.target?.id)) errors.push('target kind and id are required');
  if (!clean(value?.operation)) errors.push('operation is required');
  if (!sourceFree(value?.input)) errors.push('invocation input contains executable source');
  return { ok: errors.length === 0, errors };
}
function invocation({ invocationId = '', plane, target, operation, input = null, idempotencyKey = null, provenance = null } = {}) {
  const value = { contractVersion: 1, recordType: 'execution-invocation', invocationId: clean(invocationId) || id('invocation'), plane: clean(plane), target, operation: clean(operation), input, idempotencyKey, provenance };
  const validation = validateInvocation(value);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return value;
}
function effect({ effectId = '', type, action, target = null, payload = null, status = 'requested' } = {}) {
  if (!EFFECTS.has(clean(type)) || !clean(action)) throw new Error('invalid execution effect');
  return { contractVersion: 1, recordType: 'execution-effect', effectId: clean(effectId) || id('effect'), type: clean(type), action: clean(action), target, payload, status: clean(status) };
}
function result({ invocation: source, disposition = 'respond', output = null, error = null, effects = [], trace = null } = {}) {
  return { contractVersion: 1, recordType: 'execution-result', invocationId: clean(source?.invocationId), plane: clean(source?.plane), disposition, output, error, effects, trace };
}

function computeInvocation(value, { entityId, operationId } = {}) {
  const candidate = value || invocation({
    plane: 'compute-jpl',
    target: { kind: 'entity', id: String(entityId || 'unknown') },
    operation: String(operationId || 'execute'),
  });
  const validation = validateInvocation(candidate);
  const targetMatches = !entityId || (
    candidate?.target?.kind === 'entity' && String(candidate?.target?.id) === String(entityId)
  );
  if (!validation.ok || candidate.plane !== 'compute-jpl' || !targetMatches) {
    const error = new Error(`Invalid Compute execution invocation: ${validation.errors.join('; ')}`);
    error.code = 'EXECUTION_ENVELOPE_INVALID';
    throw error;
  }
  return candidate;
}

function attachResult(response, source, { effects = [] } = {}) {
  const ok = response?.ok !== false;
  return {
    ...response,
    execution: result({
      invocation: source,
      disposition: ok ? 'respond' : 'fail',
      output: ok ? { completed: true } : null,
      error: ok ? null : {
        code: clean(response?.error?.code || 'EXECUTION_FAILED'),
        message: clean(response?.error?.message || 'Compute entity execution failed.', 1000),
      },
      effects,
      trace: { owner: 'runEntity', trustBoundary: 'compute-jpl' },
    }),
  };
}

module.exports = { effect, invocation, result, validateInvocation, computeInvocation, attachResult };
