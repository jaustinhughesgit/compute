"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCanonicalPersistence,
  resolvedTables,
} = require("../app/persistence/canonicalPersistence");

function recordingClient(responses = {}) {
  const calls = [];
  const client = { calls };
  for (const method of ["query", "get", "put", "update", "delete", "scan", "batchGet", "batchWrite"]) {
    client[method] = (params) => ({
      promise: async () => {
        calls.push({ method, params });
        const response = responses[method];
        return typeof response === "function" ? response(params, calls) : (response || {});
      },
    });
  }
  return client;
}

test("table resolution keeps physical names inside the persistence port", () => {
  const tables = resolvedTables(
    { words: "WordsV2" },
    {
      CONTEXT_GRAPH_TABLE: "ContextCompatibility",
      PERM_GRANTS_TABLE: "ActionGrants",
      ANCHOR_BANDS_TABLE: "PositionPostings",
    }
  );
  assert.equal(tables.words, "WordsV2");
  assert.equal(tables.contextSidecar, "ContextCompatibility");
  assert.equal(tables.grants, "ActionGrants");
  assert.equal(tables.retrievalPostings, "PositionPostings");
  assert.equal(Object.isFrozen(tables), true);
});

test("foundation and compatibility readers preserve existing DynamoDB envelopes", async () => {
  const client = recordingClient({ query: { Items: [{ su: "cats", e: "1" }] } });
  const persistence = createCanonicalPersistence({ documentClient: client });
  const result = await persistence.compatibility.querySubdomain("word-cat", "a");
  assert.deepEqual(result, { Items: [{ su: "cats", e: "1" }] });
  assert.deepEqual(client.calls[0], {
    method: "query",
    params: {
      TableName: "subdomains",
      IndexName: "aIndex",
      KeyConditionExpression: "#key = :value",
      ExpressionAttributeNames: { "#key": "a" },
      ExpressionAttributeValues: { ":value": "word-cat" },
    },
  });
});

test("context compatibility writes deduplicate records and retry unprocessed items", async () => {
  let attempt = 0;
  const client = recordingClient({
    batchWrite: (params) => {
      attempt += 1;
      const requests = params.RequestItems.context_graph;
      return attempt === 1
        ? { UnprocessedItems: { context_graph: [requests[0]] } }
        : { UnprocessedItems: {} };
    },
  });
  const persistence = createCanonicalPersistence({ documentClient: client });
  const first = { audienceId: "u:1", recordKey: "node#cat", version: 1 };
  const replacement = { ...first, version: 2 };
  const written = await persistence.context.batchPut([first, replacement]);
  assert.equal(written, 1);
  assert.equal(client.calls.length, 2);
  assert.equal(
    client.calls[0].params.RequestItems.context_graph[0].PutRequest.Item.version,
    2
  );
});

test("derived retrieval queries are isolated from canonical and authorization stores", async () => {
  const client = recordingClient({ query: { Items: [{ su: "entity-1" }] } });
  const persistence = createCanonicalPersistence({
    documentClient: client,
    tableNames: { retrievalPostings: "DerivedPositions" },
  });
  const result = await persistence.retrieval.queryWindow({
    partitionKey: "AB#v1#L0=1#L1=2",
    startKey: "B=00010#S=00",
    endKey: "B=00020#S=07",
  });
  assert.equal(result.Items[0].su, "entity-1");
  assert.equal(client.calls[0].params.TableName, "DerivedPositions");
  assert.equal(persistence.contractVersion, 1);
});

test("the port rejects unsupported compatibility keys before database access", () => {
  const client = recordingClient();
  const persistence = createCanonicalPersistence({ documentClient: client });
  assert.throws(
    () => persistence.compatibility.querySubdomain("x", "unknown"),
    /not supported/
  );
  assert.equal(client.calls.length, 0);
});

test("canonical publication markers are written only after facts and projections", async () => {
  const client = recordingClient({ batchWrite: { UnprocessedItems: {} } });
  const persistence = createCanonicalPersistence({
    documentClient: client,
    tableNames: { canonicalProjections: "CanonicalProjection" },
  });
  await persistence.canonical.batchPut({
    entities: [{ e: "entity-1" }],
    projections: [
      { pk: "AUD#1#00", sk: "NODE#entity-1", recordType: "audience-node" },
      { pk: "SYNC#1#00", sk: "IDEMPOTENCY#input-1", recordType: "canonical-publication" },
    ],
  });
  assert.deepEqual(client.calls.map((call) => call.params.RequestItems), [
    { entities: [{ PutRequest: { Item: { e: "entity-1" } } }] },
    { CanonicalProjection: [{ PutRequest: { Item: {
      pk: "AUD#1#00", sk: "NODE#entity-1", recordType: "audience-node",
    } } }] },
    { CanonicalProjection: [{ PutRequest: { Item: {
      pk: "SYNC#1#00", sk: "IDEMPOTENCY#input-1", recordType: "canonical-publication",
    } } }] },
  ]);
});
