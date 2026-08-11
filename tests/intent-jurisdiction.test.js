'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evolutionDecision, jurisdictionDecision } = require('../app/intentJurisdiction');

const manifest = {
  capabilityId: 'conditions.lookup', entityId: 'entity-1', execution: { type: 'remote' },
  operations: [{ operationId: 'lookup' }],
};

test('a local question remains a graph read', () => {
  const decision = jurisdictionDecision({
    utterance: 'How many dogs do Austin and I have?',
    legacyDecision: 'not_compute', source: 'local-graph-router', localGraph: true,
  });
  assert.equal(decision.effectClass, 'read.graph');
  assert.equal(decision.artifactDecision, 'query_data');
});

test('same-operation failure is repair while a new operation is a fork', () => {
  assert.equal(evolutionDecision({ legacyDecision: 'extend', manifest, operationId: 'lookup' }).outcome, 'repair');
  assert.equal(evolutionDecision({ legacyDecision: 'extend', manifest, operationId: 'forecast' }).outcome, 'fork');
});
