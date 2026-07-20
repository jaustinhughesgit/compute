const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canEditPermission,
  entityRevisionFromRow,
} = require('../app/routes/modules/search');

test('search editability metadata distinguishes use from modification authority', () => {
  assert.equal(canEditPermission('o'), true);
  assert.equal(canEditPermission('w'), true);
  assert.equal(canEditPermission('r'), false);
  assert.equal(canEditPermission(null), false);
});

test('search returns a stable revision hint when one is present', () => {
  assert.deepEqual(
    entityRevisionFromRow({ editVersion: 4, editUpdatedAt: '2026-07-19T12:00:00.000Z', capabilityVersion: 9 }),
    { entityVersion: 4, entityUpdatedAt: '2026-07-19T12:00:00.000Z' }
  );
  assert.deepEqual(
    entityRevisionFromRow({}),
    { entityVersion: 0, entityUpdatedAt: null }
  );
});
