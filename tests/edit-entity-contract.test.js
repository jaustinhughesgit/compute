const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  register,
  normalizeRevisionRequest,
  parseJsonObject,
  validateRevisedEntity,
} = require('../app/routes/modules/editEntity');

const entity = {
  input: [],
  published: {
    name: 'Freezer Monitor',
    blocks: [{ entity: 'entity-1', name: 'Primary' }],
    menu: { ready: { _name: 'Ready' } },
  },
  skip: [],
  sweeps: 1,
  expected: [],
};

test('revision requests require an explicit matching target and user changes', () => {
  assert.deepEqual(
    normalizeRevisionRequest({
      requestId: 'request-1',
      target: { entityId: 'entity-1', baseVersion: 0 },
      requestedChanges: ['Add battery monitoring.'],
      explanation: 'Apply the requested feature.',
    }, 'entity-1'),
    {
      schemaVersion: 1,
      requestId: 'request-1',
      checkOnly: false,
      entityId: 'entity-1',
      explanation: 'Apply the requested feature.',
      requestedChanges: ['Add battery monitoring.'],
      baseVersion: 0,
      convertEssence: [],
    }
  );
  assert.throws(() => normalizeRevisionRequest({
    target: { entityId: 'other' },
    explanation: 'Change it.',
  }, 'entity-1'), /does not match/);
  assert.throws(() => normalizeRevisionRequest({ target: { entityId: 'entity-1' } }, 'entity-1'), /requested change is required/);
  assert.equal(normalizeRevisionRequest({
    intent: 'check-edit-access',
    target: { entityId: 'entity-1' },
  }, 'entity-1').checkOnly, true);
});

test('LLM JSON parsing accepts JSON fences but rejects non-object output', () => {
  assert.deepEqual(parseJsonObject('```json\n{"summary":"ok"}\n```'), { summary: 'ok' });
  assert.throws(() => parseJsonObject('[]'), /must be an object/);
});

test('revisions preserve top-level structure and primary entity identity', () => {
  const revised = JSON.parse(JSON.stringify(entity));
  revised.published.menu.status = { _name: 'Battery status' };
  assert.equal(validateRevisedEntity(entity, revised, 'entity-1'), revised);

  const changedIdentity = JSON.parse(JSON.stringify(revised));
  changedIdentity.published.blocks[0].entity = 'entity-2';
  assert.throws(() => validateRevisedEntity(entity, changedIdentity, 'entity-1'), /primary block identity/);

  const removedRoot = JSON.parse(JSON.stringify(revised));
  delete removedRoot.expected;
  assert.throws(() => validateRevisedEntity(entity, removedRoot, 'entity-1'), /removed required top-level field/);

  const wrongMenuType = JSON.parse(JSON.stringify(revised));
  wrongMenuType.published.menu = [];
  assert.throws(() => validateRevisedEntity(entity, wrongMenuType, 'entity-1'), /changed the type of published field menu/);

  const renamed = JSON.parse(JSON.stringify(revised));
  renamed.published.name = 'Something Else';
  assert.throws(() => validateRevisedEntity(entity, renamed, 'entity-1'), /cannot rename/);
});

test('edit access can be checked without locking, loading, or revising the entity', async () => {
  let handler = null;
  let verifiedPath = null;
  let updateCalls = 0;
  let s3Reads = 0;
  let modelCalls = 0;
  const dynamodb = {
    update() {
      updateCalls += 1;
      return { promise: async () => ({}) };
    },
  };
  register({
    on(name, fn) { if (name === 'editEntity') handler = fn; },
    use() {
      return {
        manageCookie: async () => ({ gi: 7 }),
        getVerified: async () => ({ Items: [{}] }),
        verifyPath: async (parts) => { verifiedPath = parts.join('/'); return [true]; },
        allVerified: () => true,
        getSub: async () => ({ Items: [{ su: 'entity-1', editVersion: 4, editUpdatedAt: '2026-07-20T10:00:00.000Z' }] }),
        deps: {
          dynamodb,
          uuidv4: () => 'uuid',
          s3: { getObject() { s3Reads += 1; return { promise: async () => ({}) }; } },
          openai: { chat: { completions: { create: async () => { modelCalls += 1; } } } },
        },
      };
    },
  });

  const result = await handler({
    path: '/entity-1',
    xAccessToken: 'token',
    req: { body: { intent: 'check-edit-access', target: { entityId: 'entity-1' } } },
    res: { status() { return this; }, json() {} },
  });

  assert.equal(verifiedPath, '/cookies/saveFile/entity-1');
  assert.deepEqual(result, {
    ok: true,
    response: {
      action: 'editEntityCheck',
      entityId: 'entity-1',
      version: 4,
      updatedAt: '2026-07-20T10:00:00.000Z',
    },
  });
  assert.equal(updateCalls, 0);
  assert.equal(s3Reads, 0);
  assert.equal(modelCalls, 0);
});

test('authorized edits run the LLM, back up the old JSON, save the revision, and advance the version', async () => {
  let handler = null;
  const row = { su: 'entity-1', z: false, editVersion: 0 };
  const stored = JSON.parse(JSON.stringify(entity));
  const writes = [];
  const dynamodb = {
    update(params) {
      return {
        promise: async () => {
          if (params.UpdateExpression.includes('SET #editLock =')) {
            row.editLock = params.ExpressionAttributeValues[':lock'];
            row.editLockExpires = params.ExpressionAttributeValues[':expires'];
          } else if (params.UpdateExpression.includes('SET #editVersion =')) {
            assert.equal(row.editLock, params.ExpressionAttributeValues[':lock']);
            row.editVersion = params.ExpressionAttributeValues[':version'];
            row.editUpdatedAt = params.ExpressionAttributeValues[':updatedAt'];
            delete row.editLock;
            delete row.editLockExpires;
          } else {
            delete row.editLock;
            delete row.editLockExpires;
          }
          return {};
        },
      };
    },
  };
  const s3 = {
    getObject() {
      return { promise: async () => ({ Body: Buffer.from(JSON.stringify(stored)), ContentType: 'application/json' }) };
    },
    putObject(params) {
      writes.push(params);
      return { promise: async () => ({}) };
    },
  };
  const openai = {
    chat: {
      completions: {
        create: async () => {
          const updated = JSON.parse(JSON.stringify(entity));
          updated.published.menu.battery = { _name: 'Battery' };
          return {
            choices: [{ message: { content: JSON.stringify({ summary: 'Added battery status.', updatedEntity: updated }) } }],
          };
        },
      },
    },
  };
  register({
    on(name, fn) { if (name === 'editEntity') handler = fn; },
    use() {
      return {
        manageCookie: async () => ({ gi: 1 }),
        getVerified: async () => ({ Items: [{}] }),
        verifyPath: async () => [true],
        allVerified: () => true,
        getSub: async () => ({ Items: [{ ...row }] }),
        deps: { dynamodb, uuidv4: () => 'uuid', s3, openai },
      };
    },
  });
  assert.equal(typeof handler, 'function');

  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.headersSent = true; this.value = value; return value; },
  };
  const result = await handler({
    path: '/entity-1',
    xAccessToken: 'token',
    deps: { dynamodb, uuidv4: () => 'uuid', s3, openai },
    req: {
      body: {
        requestId: 'request-2',
        target: { entityId: 'entity-1', baseVersion: 0 },
        requestedChanges: ['Add battery status.'],
        explanation: 'Apply this revision.',
      },
    },
    res,
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.action, 'editEntity');
  assert.equal(result.response.version, 1);
  assert.equal(row.editVersion, 1);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].Bucket, 'private.1var.com');
  assert.match(writes[0].Key, /^entity-revisions\/entity-1\//);
  assert.equal(writes[1].Key, 'entity-1');
  assert.equal(JSON.parse(writes[1].Body).published.menu.battery._name, 'Battery');
});

test('server contract retains authorization, lock, private backup, model validation, and rollback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/routes/modules/editEntity.js'), 'utf8');
  assert.match(source, /verifyPath/);
  assert.match(source, /\/cookies\/saveFile\/\$\{request\.entityId\}/);
  assert.match(source, /ConditionExpression:\s*"attribute_not_exists\(#editLock\)/);
  assert.match(source, /Bucket:\s*"private\.1var\.com"/);
  assert.match(source, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/);
  assert.match(source, /Avoid publishing a file whose revision metadata was not committed/);
});
