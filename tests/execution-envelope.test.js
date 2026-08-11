'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const envelope = require('../app/executionEnvelope');

test('Compute accepts only compute-jpl invocations', () => {
  const invocation = envelope.computeInvocation(null, { entityId: '42', operationId: 'lookup' });
  assert.equal(invocation.plane, 'compute-jpl');
  assert.throws(() => envelope.computeInvocation(envelope.invocation({
    plane: 'file-worker', target: { kind: 'entity', id: '42' }, operation: 'lookup',
  })), /Invalid Compute execution invocation/);
  assert.throws(() => envelope.invocation({
    plane: 'compute-jpl', target: { kind: 'entity', id: '42' }, operation: 'lookup',
    input: { sourceCode: 'return 1' },
  }), /executable source/);
});
