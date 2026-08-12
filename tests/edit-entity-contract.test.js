const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  declarativeActionsChanged,
  extractProviderResearchSources,
  register,
  normalizeRevisionRequest,
  mayRetryRevisionValidation,
  parseJsonObject,
  parseRevisionResponse,
  providerDocumentationDomains,
  providerRepairResearchContext,
  reconnectableRevisionJob,
  canonicalizeGeneratedProtectedIdentifiers,
  protectedFieldsFromActions,
  protectUnambiguousUndeclaredRequestField,
  synchronizeProtectedRequirementFields,
  repairRequiresImplementationChange,
  requestDescribesImplementationChange,
  revisionInput,
  pathSemanticContractChanged,
  validateRevisionSynchronization,
  validateRevisedEntity,
} = require('../app/routes/modules/editEntity');

test('a repeated revision request reconnects only to its own durable job', () => {
  const row = {
    editLock: 'resp_existing',
    editJobId: 'resp_existing',
    editJobHash: 'same-request-hash',
  };
  assert.equal(reconnectableRevisionJob(row, 'same-request-hash'), 'resp_existing');
  assert.equal(reconnectableRevisionJob(row, 'different-request-hash'), null);
  assert.equal(reconnectableRevisionJob({ ...row, editLock: 'resp_other' }, 'same-request-hash'), null);
  assert.equal(reconnectableRevisionJob({ editJobHash: 'same-request-hash' }, 'same-request-hash'), null);
});

test('protected requirement fields synchronize from the exact declarative placeholder', () => {
  const revisedEntity = {
    published: {
      data: { protectedAssetRequirements: [{ requirementId: 'provider_credentials', fields: [] }] },
      actions: [{
        target: '{|axios|}',
        chain: [{ access: 'get', params: ['https://api.example.com/data', {
          params: { appid: '{|protected=>provider_credentials.api_key|}' },
          headers: { Authorization: 'Bearer {|protected=>provider_credentials.access_token|}' },
        }] }],
        assign: '{|providerResponse|}',
      }],
    },
  };
  const revisedManifest = {
    operations: [{
      operationId: 'lookup',
      protectedAssetRequirements: [{ requirementId: 'provider_credentials' }],
    }],
  };
  const inferred = protectedFieldsFromActions(revisedEntity.published.actions);
  assert.deepEqual(inferred.get('provider_credentials'), [
    { name: 'api_key', required: true, injection: { location: 'query', parameter: 'appid', prefix: '' } },
    { name: 'access_token', required: true, injection: { location: 'header', parameter: 'Authorization', prefix: 'Bearer ' } },
  ]);
  synchronizeProtectedRequirementFields(revisedEntity, revisedManifest);
  assert.deepEqual(
    revisedEntity.published.data.protectedAssetRequirements[0].fields,
    inferred.get('provider_credentials')
  );
  assert.deepEqual(
    revisedManifest.operations[0].protectedAssetRequirements[0].fields,
    inferred.get('provider_credentials')
  );
  assert.equal(revisedManifest.operations[0].protectedAssetRequirements[0].operationId, 'lookup');
});

test('generated protected labels become canonical identifiers before contract validation', () => {
  const revisedEntity = {
    published: {
      data: {
        protectedAssetRequirements: [{
          requirementId: 'OpenWeatherMap API Key',
          providerId: 'Open Weather Map',
          fields: [{
            name: 'API Key',
            injection: { location: 'query', parameter: 'appid' },
          }],
        }],
      },
      actions: [{
        target: '{|axios|}',
        chain: [{ access: 'get', params: ['https://api.example.com/data', {
          params: { appid: '{|protected=>OpenWeatherMap API Key.API Key|}' },
        }] }],
      }],
    },
  };
  const revisedManifest = {
    operations: [{
      protectedAssetRequirements: [{
        requirementId: 'OpenWeatherMap API Key',
        providerId: 'Open Weather Map',
        fields: [{
          name: 'API Key',
          injection: { location: 'query', parameter: 'appid' },
        }],
      }],
    }],
  };
  canonicalizeGeneratedProtectedIdentifiers(revisedEntity, revisedManifest);
  assert.equal(
    revisedEntity.published.data.protectedAssetRequirements[0].requirementId,
    'openweathermap_api_key'
  );
  assert.equal(revisedManifest.operations[0].protectedAssetRequirements[0].providerId, 'open_weather_map');
  assert.equal(revisedManifest.operations[0].protectedAssetRequirements[0].fields[0].name, 'api_key');
  assert.equal(
    revisedEntity.published.actions[0].chain[0].params[1].params.appid,
    '{|protected=>openweathermap_api_key.api_key|}'
  );
});

test('a canonicalized generated placeholder supplies omitted protected fields', () => {
  const revisedEntity = {
    published: {
      data: {
        protectedAssetRequirements: [{
          requirementId: 'Provider API Key',
          providerId: 'Provider',
          fields: [],
        }],
      },
      actions: [{
        target: '{|axios|}',
        chain: [{ access: 'get', params: ['https://api.example.com/data', {
          params: { appid: '{|protected=>Provider API Key.API Key|}' },
        }] }],
      }],
    },
  };
  const revisedManifest = {
    operations: [{
      operationId: 'lookup',
      protectedAssetRequirements: [{
        requirementId: 'Provider API Key',
        providerId: 'Provider',
        fields: [],
      }],
    }],
  };
  canonicalizeGeneratedProtectedIdentifiers(revisedEntity, revisedManifest);
  synchronizeProtectedRequirementFields(revisedEntity, revisedManifest);
  const expected = [{
    name: 'api_key',
    required: true,
    injection: { location: 'query', parameter: 'appid', prefix: '' },
  }];
  assert.deepEqual(revisedEntity.published.data.protectedAssetRequirements[0].fields, expected);
  assert.deepEqual(revisedManifest.operations[0].protectedAssetRequirements[0].fields, expected);
});

test('one undeclared provider request input moves into one incomplete protected requirement', () => {
  const revisedEntity = {
    published: {
      data: { protectedAssetRequirements: [{ requirementId: 'provider_credentials' }] },
      actions: [{
        target: '{|axios|}',
        chain: [{ access: 'get', params: ['https://api.example.com/data', {
          params: {
            q: '{|req=>body.location|}',
            appid: '{|req=>body.api_key|}',
          },
        }] }],
        assign: '{|providerResponse|}',
      }],
    },
  };
  const revisedManifest = {
    operations: [{
      operationId: 'lookup',
      inputs: [{ name: 'location' }],
      protectedAssetRequirements: [{ requirementId: 'provider_credentials', fields: [] }],
    }],
  };
  assert.deepEqual(
    protectUnambiguousUndeclaredRequestField(revisedEntity, revisedManifest, 'provider_credentials'),
    [{ name: 'api_key', required: true, injection: { location: 'query', parameter: 'appid', prefix: '' } }]
  );
  assert.equal(
    revisedEntity.published.actions[0].chain[0].params[1].params.appid,
    '{|protected=>provider_credentials.api_key|}'
  );

  const ambiguousEntity = structuredClone(revisedEntity);
  ambiguousEntity.published.actions[0].chain[0].params[1].params.appid = '{|req=>body.api_key|}';
  ambiguousEntity.published.actions[0].chain[0].params[1].params.token = '{|req=>body.access_token|}';
  assert.deepEqual(
    protectUnambiguousUndeclaredRequestField(ambiguousEntity, revisedManifest, 'provider_credentials'),
    []
  );
});

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

function jsonNode(value) {
  const base = {
    kind: 'null',
    stringValue: null,
    numberValue: null,
    booleanValue: null,
    arrayValue: null,
    objectValue: null,
  };
  if (value === null) return base;
  if (typeof value === 'string') return { ...base, kind: 'string', stringValue: value };
  if (typeof value === 'number') return { ...base, kind: 'number', numberValue: value };
  if (typeof value === 'boolean') return { ...base, kind: 'boolean', booleanValue: value };
  if (Array.isArray(value)) {
    return { ...base, kind: 'array', arrayValue: value.map(jsonNode) };
  }
  return {
    ...base,
    kind: 'object',
    objectValue: Object.entries(value).map(([key, child]) => ({ key, value: jsonNode(child) })),
  };
}

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
      intent: 'revise-entity',
      checkOnly: false,
      pollOnly: false,
      statusOnly: false,
      finalizeOnly: false,
      cancelOnly: false,
      jobId: null,
      entityId: 'entity-1',
      explanation: 'Apply the requested feature.',
      requestedChanges: ['Add battery monitoring.'],
      baseVersion: 0,
      convertEssence: [],
      repairContext: null,
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

test('revision requests preserve sanitized Entity and Path repair evidence', () => {
  const request = normalizeRevisionRequest({
    target: { entityId: 'entity-1', baseVersion: 0 },
    explanation: 'Correct the behavior that contradicted the captured date.',
    repairContext: {
      target: 'both',
      pathSignature: 'pattern:v3:generic_lookup',
      originalUtterance: 'look up tomorrow',
      pathMatch: {
        structuralMatch: {
          captures: { date: { text: 'tomorrow', type: 'date' } },
        },
        apiKey: 'must-not-escape',
      },
      diagnosis: { target: 'both', reason: 'The capture and implementation need revision.' },
      semanticBundle: {
        linkedPaths: [{ signature: 'pattern:v3:generic_lookup', apiKey: 'must-not-escape' }],
        currentEssence: [['present', 'it', 'lookup', 'tomorrow']],
        contextDbEvidence: { graph: { entities: { ent_1: { lemmas: ['speaker'] } } } },
      },
    },
  }, 'entity-1');
  assert.equal(request.repairContext.target, 'both');
  assert.equal(request.repairContext.pathSignature, 'pattern:v3:generic_lookup');
  assert.equal(request.repairContext.pathMatch.structuralMatch.captures.date.text, 'tomorrow');
  assert.equal(request.repairContext.pathMatch.apiKey, '[redacted]');
  assert.equal(request.repairContext.semanticBundle.linkedPaths[0].apiKey, '[redacted]');
  assert.equal(request.repairContext.semanticBundle.currentEssence[0][3], 'tomorrow');
  assert.doesNotMatch(JSON.stringify(request), /must-not-escape/);
});

test('Path repairs must revise semantic source fields without changing JPL', () => {
  const currentManifest = {
    operations: [{
      operationId: 'lookup',
      inputs: [{ name: 'location', type: 'string', required: true, bindingHint: { source: 'utterance', resolver: 'location' } }],
      outputs: [{ name: 'result', required: true }],
      utteranceExamples: [{ text: 'Lookup Raleigh', inputs: { location: 'Raleigh' } }],
    }],
  };
  const revisedManifest = structuredClone(currentManifest);
  revisedManifest.operations[0].utteranceExamples.push({
    text: 'Lookup New York City',
    inputs: { location: 'New York City' },
  });
  assert.equal(pathSemanticContractChanged(currentManifest, revisedManifest), true);

  const current = {
    published: {
      actions: [{
        target: '{|axios|}',
        chain: [{ access: 'get', params: ['https://api.example.dev/current', { params: { q: '{|location|}' } }] }],
        assign: '{|response|}',
      }, {
        target: '{|res|}!',
        chain: [{ access: 'send', params: [{ result: '{|response=>data.result|}' }] }],
      }],
    },
  };
  const request = {
    repairContext: { target: 'path' },
    currentManifest,
  };
  assert.doesNotThrow(() =>
    validateRevisionSynchronization(current, structuredClone(current), revisedManifest, request)
  );
  assert.throws(() =>
    validateRevisionSynchronization(current, structuredClone(current), currentManifest, request),
    /diagnosed Path repair did not revise/
  );
  const changedEntity = structuredClone(current);
  changedEntity.published.actions[0].chain[0].params[1].params.q = '{|location|},US';
  assert.throws(() =>
    validateRevisionSynchronization(current, changedEntity, revisedManifest, request),
    /Path-only repair cannot modify/
  );
});

test('provider-request repairs cannot publish a manifest-only Entity revision', () => {
  const current = {
    published: {
      actions: [{
        target: '{|axios|}',
        chain: [{ access: 'get', params: ['https://api.example.dev/current', { params: { q: '{|location|}' } }] }],
        assign: '{|response|}',
      }, {
        target: '{|res|}!',
        chain: [{ access: 'send', params: [{ result: '{|response=>data.result|}' }] }],
      }],
    },
  };
  const revised = structuredClone(current);
  const manifest = {
    operations: [{
      operationId: 'lookup',
      inputs: [{ name: 'location', required: true }],
      outputs: [{ name: 'result', required: true }],
    }],
  };
  const request = {
    explanation: 'Normalize the provider request.',
    requestedChanges: [],
    repairContext: {
      target: 'entity',
      diagnosis: { requiresImplementationChange: true },
    },
  };
  assert.equal(repairRequiresImplementationChange(request), true);
  assert.equal(declarativeActionsChanged(current, revised), false);
  assert.throws(
    () => validateRevisionSynchronization(current, revised, manifest, request),
    /manifest-only revision is incomplete/
  );
  revised.published.actions[0].chain[0].params[1].params.q = '{|location|},US';
  assert.doesNotThrow(
    () => validateRevisionSynchronization(current, revised, manifest, request)
  );
});

test('provider contract failures receive one constrained official-doc research attempt', () => {
  const request = {
    explanation: 'Fix the provider request for the captured location.',
    requestedChanges: [],
    repairContext: {
      target: 'entity',
      diagnosis: {
        classification: 'entity_or_path',
        target: 'entity',
        requiresImplementationChange: true,
      },
      semanticBundle: {
        observedExecution: {
          stage: 'provider-request',
          provider: 'OpenWeather',
          providerHost: 'api.openweathermap.org',
          status: 404,
        },
      },
    },
  };
  assert.deepEqual(providerDocumentationDomains('api.openweathermap.org'), [
    'api.openweathermap.org',
    'openweathermap.org',
  ]);
  const research = providerRepairResearchContext(request);
  assert.equal(research.providerHost, 'api.openweathermap.org');
  assert.deepEqual(research.allowedDomains, ['api.openweathermap.org', 'openweathermap.org']);

  const input = revisionInput({
    model: 'gpt-5.6-luna',
    currentEntity: entity,
    currentManifest: null,
    request,
    entityId: 'entity-1',
    providerResearch: research,
  });
  assert.deepEqual(input.reasoning, { effort: 'high' });
  assert.deepEqual(input.tools, [{
    type: 'web_search',
    search_context_size: 'high',
    filters: { allowed_domains: ['api.openweathermap.org', 'openweathermap.org'] },
  }]);
  assert.equal(input.tool_choice, 'required');
  assert.equal(input.max_tool_calls, 4);
  assert.deepEqual(input.include, ['web_search_call.action.sources']);
  assert.match(input.input[0].content, /one authorized provider-contract repair attempt/);
  assert.match(input.input[0].content, /JPL is the JSON array at published\.actions/);
  assert.match(input.input[0].content, /typed JSON-node schema/);
  assert.match(input.input[0].content, /Use exactly query, header, or body/);
  assert.match(input.input[0].content, /synchronize operation\.protectedAssetRequirements/);
  assert.equal(input.text.format.strict, true);
  assert.ok(input.text.format.schema.properties.entityPatches);

  assert.deepEqual(extractProviderResearchSources({
    output: [{
      type: 'web_search_call',
      action: {
        sources: [
          { type: 'url', url: 'https://openweathermap.org/api/current' },
          { type: 'url', url: 'https://attacker.example/provider-advice' },
        ],
      },
    }],
  }, research.allowedDomains), ['https://openweathermap.org/api/current']);
});

test('provider research excludes credentials, transient failures, and Path-only defects', () => {
  const base = {
    repairContext: {
      target: 'entity',
      diagnosis: {
        classification: 'entity_or_path',
        target: 'entity',
        requiresImplementationChange: true,
      },
      semanticBundle: {
        observedExecution: {
          stage: 'provider-request',
          providerHost: 'api.example.com',
          status: 404,
        },
      },
    },
  };
  for (const status of [401, 403, 408, 429, 500, 503]) {
    const request = structuredClone(base);
    request.repairContext.semanticBundle.observedExecution.status = status;
    assert.equal(providerRepairResearchContext(request), null);
  }
  const pathRequest = structuredClone(base);
  pathRequest.repairContext.target = 'path';
  pathRequest.repairContext.diagnosis.target = 'path';
  assert.equal(providerRepairResearchContext(pathRequest), null);
  assert.equal(mayRetryRevisionValidation({
    providerResearch: { attempted: true },
    originalObject: entity,
    repairAttempt: 2,
  }), true);
  assert.equal(mayRetryRevisionValidation({
    providerResearch: { attempted: true },
    originalObject: entity,
    repairAttempt: 3,
  }), false);
  assert.equal(mayRetryRevisionValidation({
    originalObject: entity,
    repairAttempt: 1,
    error: new Error("updatedEntity is invalid JSON: Expected ',' or '}'"),
  }), true);
  assert.equal(mayRetryRevisionValidation({
    originalObject: entity,
    repairAttempt: 2,
    error: new Error("updatedEntity is invalid JSON: Expected ',' or '}'"),
  }), false);
  assert.equal(mayRetryRevisionValidation({
    originalObject: entity,
    repairAttempt: 3,
    error: new Error("the proposed revision did not materially apply the requested change"),
  }), false);
  assert.equal(mayRetryRevisionValidation({
    providerResearch: { attempted: true },
    originalObject: entity,
    repairAttempt: 0,
  }), true);
  assert.equal(mayRetryRevisionValidation({
    providerResearch: null,
    originalObject: entity,
    repairAttempt: 0,
  }), true);
});

test('invalid provider revision output gets one continuation without another web search', () => {
  const input = revisionInput({
    model: 'gpt-5.6-luna',
    currentEntity: entity,
    currentManifest: null,
    request: {
      requestId: 'repair-1',
      requestedChanges: [],
      explanation: 'Repair malformed output.',
      convertEssence: [],
      repairContext: { target: 'entity' },
    },
    entityId: 'entity-1',
    repairFeedback: ["updatedEntity is invalid JSON: Expected ',' or '}'"],
    providerResearchEvidence: {
      schemaVersion: 1,
      provider: 'OpenWeather',
      providerHost: 'api.openweathermap.org',
      sources: ['https://openweathermap.org/api/current'],
    },
    previousResponseId: 'resp_provider_research',
  });
  assert.equal(input.previous_response_id, 'resp_provider_research');
  assert.equal(input.tools, undefined);
  assert.equal(input.tool_choice, undefined);
  assert.match(input.input[0].content, /Do not repeat web research/);
  assert.match(input.input[0].content, /preceding response failed deterministic server validation/);
  assert.match(input.input[0].content, /return a new minimal typed patch set/);
  assert.match(input.input[1].content, /updatedEntity is invalid JSON/);
  assert.match(input.input[1].content, /https:\/\/openweathermap\.org\/api\/current/);
});

test('natural-language provider format requests cannot pass as Path-only changes', () => {
  const request = {
    explanation: 'Support a combined city state with no comma.',
    requestedChanges: [],
    repairContext: { target: 'path', diagnosis: {} },
  };
  assert.equal(requestDescribesImplementationChange(request), true);
  assert.throws(
    () => validateRevisionSynchronization(
      { published: { actions: [] } },
      { published: { actions: [] } },
      { operations: [] },
      { ...request, currentManifest: { operations: [] } }
    ),
    /cannot be repaired as a Path-only revision/
  );
});

test('LLM JSON parsing accepts JSON fences but rejects non-object output', () => {
  assert.deepEqual(parseJsonObject('```json\n{"summary":"ok"}\n```'), { summary: 'ok' });
  assert.throws(() => parseJsonObject('[]'), /must be an object/);
  assert.throws(
    () => parseJsonObject('{"broken":true', 'updatedEntity'),
    /updatedEntity is invalid JSON/
  );
});

test('semantic repair plans cannot authorize ContextDB fact mutation', () => {
  const response = {
    status: 'completed',
    output_text: JSON.stringify({
      summary: 'Unsafe plan.',
      entityPatches: [],
      capabilityManifestPatches: [],
      semanticRepairPlan: {
        schemaVersion: 1,
        target: 'entity',
        summary: 'Rewrite a fact.',
        entityChanges: [],
        pathChanges: [],
        contextBindingChanges: [],
        contextDbFactsChanged: true,
      },
    }),
  };
  assert.throws(
    () => parseRevisionResponse(response, { currentEntity: entity }),
    /cannot mutate ContextDB facts/
  );
});

test('a typed object replacement may safely converge on a missing member before full validation', () => {
  const response = {
    status: 'completed',
    output_text: JSON.stringify({
      summary: 'Add a protected contract.',
      entityPatches: [{
        operation: 'replace',
        path: '/published/menu/protected',
        value: jsonNode({ _name: 'Protected' }),
      }],
      capabilityManifestPatches: [],
      semanticRepairPlan: {
        schemaVersion: 1,
        target: 'entity',
        summary: 'Add one missing object member.',
        entityChanges: ['Add the member.'],
        pathChanges: [],
        contextBindingChanges: [],
        contextDbFactsChanged: false,
      },
    }),
  };
  const parsed = parseRevisionResponse(response, { currentEntity: entity });
  assert.deepEqual(parsed.updatedEntity.published.menu.protected, { _name: 'Protected' });
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
          if (params.UpdateExpression.includes('SET #editLock =') && !params.UpdateExpression.includes('#editJobId')) {
            row.editLock = params.ExpressionAttributeValues[':lock'];
            row.editLockExpires = params.ExpressionAttributeValues[':expires'];
          } else if (params.UpdateExpression.includes('SET #editLock =') && params.UpdateExpression.includes('#editJobId')) {
            row.editLock = params.ExpressionAttributeValues[':jobId'];
            row.editLockExpires = params.ExpressionAttributeValues[':expires'];
            row.editJobId = params.ExpressionAttributeValues[':jobId'];
            row.editJobHash = params.ExpressionAttributeValues[':hash'];
            row.editJobAttempt = params.ExpressionAttributeValues[':attempt'];
          } else if (params.UpdateExpression.includes('SET #editVersion =')) {
            assert.equal(row.editLock, params.ExpressionAttributeValues[':lock']);
            row.editVersion = params.ExpressionAttributeValues[':version'];
            row.editUpdatedAt = params.ExpressionAttributeValues[':updatedAt'];
            delete row.editLock;
            delete row.editLockExpires;
            delete row.editJobId;
            delete row.editJobHash;
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
  const updated = JSON.parse(JSON.stringify(entity));
  updated.published.menu.battery = { _name: 'Battery' };
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-key';
  global.fetch = async (_url, options = {}) => {
    if (options.method === 'POST') return {
      ok: true,
      json: async () => ({ id: 'resp_revision_job', status: 'queued' }),
    };
    return {
      ok: true,
      json: async () => ({
        id: 'resp_revision_job',
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'Added battery status.',
          entityPatches: [{
            operation: 'add',
            path: '/published/menu/battery',
            value: jsonNode({ _name: 'Battery' }),
          }],
          capabilityManifestPatches: [],
          semanticRepairPlan: {
            schemaVersion: 1,
            target: 'entity',
            summary: 'Update the Entity menu.',
            entityChanges: ['Add battery status.'],
            pathChanges: [],
            contextBindingChanges: [],
            contextDbFactsChanged: false,
          },
        }),
      }),
    };
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
        deps: { dynamodb, uuidv4: () => 'uuid', s3 },
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
    deps: { dynamodb, uuidv4: () => 'uuid', s3 },
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
  assert.equal(result.response.action, 'editEntityQueued');
  const prepared = await handler({
    path: '/entity-1',
    xAccessToken: 'token',
    deps: { dynamodb, uuidv4: () => 'uuid', s3 },
    req: {
      body: {
        requestId: 'request-2',
        intent: 'revision-status',
        jobId: result.response.jobId,
        target: { entityId: 'entity-1', baseVersion: 0 },
        requestedChanges: ['Add battery status.'],
        explanation: 'Apply this revision.',
      },
    },
    res,
  });
  assert.equal(prepared.response.action, 'editEntityPrepared');
  assert.equal(writes.length, 0);

  const finalized = await handler({
    path: '/entity-1',
    xAccessToken: 'token',
    deps: { dynamodb, uuidv4: () => 'uuid', s3 },
    req: {
      body: {
        requestId: 'request-2',
        intent: 'revision-finalize',
        jobId: result.response.jobId,
        target: { entityId: 'entity-1', baseVersion: 0 },
        requestedChanges: ['Add battery status.'],
        explanation: 'Apply this revision.',
      },
    },
    res,
  });
  global.fetch = originalFetch;
  if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;

  assert.equal(finalized.ok, true);
  assert.equal(finalized.response.action, 'editEntity');
  assert.equal(finalized.response.version, 1);
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
  assert.match(source, /type:\s*"json_schema"/);
  assert.match(source, /REVISION_RESPONSE_SCHEMA/);
  assert.match(source, /editEntityPrepared/);
  assert.match(source, /revision-finalize/);
  assert.match(source, /Avoid publishing a file whose revision metadata was not committed/);
});
