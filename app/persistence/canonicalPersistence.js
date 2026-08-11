/**
 * Platform: Central persistence port for canonical entity records, migration adapters, and rebuildable retrieval projections.
 * Technical: Isolates DynamoDB table/index shapes while preserving legacy envelopes for callers that have not migrated yet.
 */
"use strict";

const BASE_TABLES = Object.freeze({
  words: "words",
  entities: "entities",
  addresses: "subdomains",
  groups: "groups",
  relations: "links",
  versions: "versions",
  legacyAccess: "access",
  verified: "verified",
  grants: "perm_grants",
  users: "users",
  contextSidecar: "context_graph",
  retrievalPostings: "anchor_bands",
});

function resolvedTables(overrides = {}, env = process.env) {
  return Object.freeze({
    ...BASE_TABLES,
    contextSidecar: env.CONTEXT_GRAPH_TABLE || BASE_TABLES.contextSidecar,
    grants: env.PERM_GRANTS_TABLE || BASE_TABLES.grants,
    retrievalPostings: env.ANCHOR_BANDS_TABLE || BASE_TABLES.retrievalPostings,
    ...overrides,
  });
}

function required(value, name) {
  if (value == null || String(value).trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function invoke(client, method, params) {
  if (!client || typeof client[method] !== "function") {
    throw new TypeError(`canonical persistence requires DocumentClient.${method}()`);
  }
  const request = client[method](params);
  return request && typeof request.promise === "function" ? request.promise() : Promise.resolve(request);
}

function queryByKey(client, TableName, key, value, IndexName) {
  required(value, key);
  return invoke(client, "query", {
    TableName,
    ...(IndexName ? { IndexName } : {}),
    KeyConditionExpression: "#key = :value",
    ExpressionAttributeNames: { "#key": key },
    ExpressionAttributeValues: { ":value": value },
  });
}

async function batchWriteAll(client, TableName, items, maxAttempts = 7) {
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const key = item.audienceId && item.recordKey
      ? `${item.audienceId}\u001f${item.recordKey}`
      : JSON.stringify(item);
    byKey.set(key, item);
  }
  const uniqueItems = [...byKey.values()];
  let written = 0;
  for (let offset = 0; offset < uniqueItems.length; offset += 25) {
    let pending = uniqueItems.slice(offset, offset + 25)
      .map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending.length && attempt < maxAttempts; attempt += 1) {
      const result = await invoke(client, "batchWrite", {
        RequestItems: { [TableName]: pending },
      });
      const next = result?.UnprocessedItems?.[TableName] || [];
      written += pending.length - next.length;
      pending = next;
    }
    if (pending.length) {
      const error = new Error(`${TableName} left ${pending.length} writes unprocessed`);
      error.code = "CANONICAL_PERSISTENCE_UNPROCESSED";
      throw error;
    }
  }
  return written;
}

function createCanonicalPersistence({ documentClient, tableNames = {}, env } = {}) {
  if (!documentClient) throw new TypeError("documentClient is required");
  const tables = resolvedTables(tableNames, env || process.env);

  const foundation = Object.freeze({
    words: Object.freeze({
      byId: (wordId) => queryByKey(documentClient, tables.words, "a", wordId),
      byNormalized: (normalized, { limit = 25 } = {}) => invoke(documentClient, "query", {
        TableName: tables.words,
        IndexName: "sIndex",
        KeyConditionExpression: "#normalized = :normalized",
        ExpressionAttributeNames: { "#normalized": "s" },
        ExpressionAttributeValues: { ":normalized": required(normalized, "normalized") },
        Limit: Math.max(1, Math.min(100, Number(limit) || 25)),
      }),
      put: (item, options = {}) => invoke(documentClient, "put", {
        TableName: tables.words, Item: required(item, "word item"), ...options,
      }),
    }),
    entities: Object.freeze({
      byId: (entityId) => queryByKey(documentClient, tables.entities, "e", entityId),
      put: (item, options = {}) => invoke(documentClient, "put", {
        TableName: tables.entities, Item: required(item, "entity item"), ...options,
      }),
    }),
    addresses: Object.freeze({
      byId: (addressId) => queryByKey(documentClient, tables.addresses, "su", addressId),
      byEntity: (entityId) => queryByKey(documentClient, tables.addresses, "e", entityId, "eIndex"),
      byWord: (wordId) => queryByKey(documentClient, tables.addresses, "a", wordId, "aIndex"),
      byGroup: (groupId) => queryByKey(documentClient, tables.addresses, "g", groupId, "gIndex"),
      byPath: (path) => queryByKey(documentClient, tables.addresses, "path", path, "path-index"),
      put: (item, options = {}) => invoke(documentClient, "put", {
        TableName: tables.addresses, Item: required(item, "address item"), ...options,
      }),
      setPosition: (addressId, position) => invoke(documentClient, "update", {
        TableName: tables.addresses,
        Key: { su: String(required(addressId, "addressId")) },
        UpdateExpression: "SET #position = :position",
        ExpressionAttributeNames: { "#position": "anchor" },
        ExpressionAttributeValues: { ":position": required(position, "position") },
        ReturnValues: "NONE",
      }),
      batchGet: (addressIds) => invoke(documentClient, "batchGet", {
        RequestItems: {
          [tables.addresses]: {
            Keys: (Array.isArray(addressIds) ? addressIds : [])
              .map((su) => ({ su: String(su) })),
          },
        },
      }),
    }),
    groups: Object.freeze({
      byId: (groupId) => queryByKey(documentClient, tables.groups, "g", groupId),
      scan: (options = {}) => invoke(documentClient, "scan", { TableName: tables.groups, ...options }),
      put: (item, options = {}) => invoke(documentClient, "put", {
        TableName: tables.groups, Item: required(item, "group item"), ...options,
      }),
    }),
    relations: Object.freeze({
      byId: (relationId) => invoke(documentClient, "get", {
        TableName: tables.relations, Key: { id: required(relationId, "relationId") },
      }),
      byWhole: (entityId) => queryByKey(documentClient, tables.relations, "whole", entityId, "wholeIndex"),
      byPart: (entityId) => queryByKey(documentClient, tables.relations, "part", entityId, "partIndex"),
      byCompositeKey: (key) => queryByKey(documentClient, tables.relations, "ckey", key, "ckeyIndex"),
      put: (item, options = {}) => invoke(documentClient, "put", {
        TableName: tables.relations, Item: required(item, "relation item"), ...options,
      }),
      remove: (relationId, options = {}) => invoke(documentClient, "delete", {
        TableName: tables.relations, Key: { id: required(relationId, "relationId") }, ...options,
      }),
    }),
    versions: Object.freeze({
      byEntity: (entityId) => queryByKey(documentClient, tables.versions, "e", entityId, "eIndex"),
      put: (item, options = {}) => invoke(documentClient, "put", {
        TableName: tables.versions, Item: required(item, "version item"), ...options,
      }),
    }),
  });

  const authorization = Object.freeze({
    legacyAccessById: (accessId) => queryByKey(documentClient, tables.legacyAccess, "ai", accessId),
    verifiedBy: (key, value) => {
      const indexes = { vi: null, ai: "aiIndex", gi: "giIndex" };
      if (!Object.hasOwn(indexes, key)) throw new Error(`verified key '${key}' is not supported`);
      return queryByKey(documentClient, tables.verified, key, value, indexes[key]);
    },
    batchGetGrants: (keys) => invoke(documentClient, "batchGet", {
      RequestItems: { [tables.grants]: { Keys: Array.isArray(keys) ? keys : [] } },
    }),
    putGrant: (item, options = {}) => invoke(documentClient, "put", {
      TableName: tables.grants, Item: required(item, "grant item"), ...options,
    }),
  });

  const identity = Object.freeze({
    getUser: (userId, { consistentRead = true } = {}) => invoke(documentClient, "get", {
      TableName: tables.users,
      Key: { userID: Number(required(userId, "userId")) },
      ConsistentRead: consistentRead,
    }),
  });

  const context = Object.freeze({
    get: (audienceId, recordKey, { consistentRead = true } = {}) => invoke(documentClient, "get", {
      TableName: tables.contextSidecar,
      Key: { audienceId: required(audienceId, "audienceId"), recordKey: required(recordKey, "recordKey") },
      ConsistentRead: consistentRead,
    }),
    put: (item, options = {}) => invoke(documentClient, "put", {
      TableName: tables.contextSidecar, Item: required(item, "context item"), ...options,
    }),
    byLookup: (lookupKey, { limit = 12 } = {}) => invoke(documentClient, "query", {
      TableName: tables.contextSidecar,
      IndexName: "lookupKey-index",
      KeyConditionExpression: "#lookup = :lookup",
      ExpressionAttributeNames: { "#lookup": "lookupKey" },
      ExpressionAttributeValues: { ":lookup": required(lookupKey, "lookupKey") },
      Limit: Math.max(1, Math.min(100, Number(limit) || 12)),
    }),
    byAudience: (audienceId, { cursor, limit = 300, consistentRead = true } = {}) => invoke(documentClient, "query", {
      TableName: tables.contextSidecar,
      KeyConditionExpression: "#audience = :audience",
      ExpressionAttributeNames: { "#audience": "audienceId" },
      ExpressionAttributeValues: { ":audience": required(audienceId, "audienceId") },
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      Limit: Math.max(1, Math.min(500, Number(limit) || 300)),
      ConsistentRead: consistentRead,
    }),
    batchPut: (items, options = {}) => batchWriteAll(
      documentClient,
      tables.contextSidecar,
      (Array.isArray(items) ? items : []).filter((item) => item?.audienceId && item?.recordKey),
      Math.max(1, Number(options.maxAttempts) || 7)
    ),
  });

  const retrieval = Object.freeze({
    batchPut: (items, options = {}) => batchWriteAll(
      documentClient,
      tables.retrievalPostings,
      items,
      Math.max(1, Number(options.maxAttempts) || 7)
    ),
    queryWindow: ({ partitionKey, startKey, endKey, limit = 500, cursor }) => invoke(documentClient, "query", {
      TableName: tables.retrievalPostings,
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :start AND :end",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: {
        ":pk": required(partitionKey, "partitionKey"),
        ":start": required(startKey, "startKey"),
        ":end": required(endKey, "endKey"),
      },
      Limit: Math.max(1, Math.min(1000, Number(limit) || 500)),
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }),
  });

  const compatibility = Object.freeze({
    querySubdomain(value, key) {
      const readers = {
        su: foundation.addresses.byId,
        e: foundation.addresses.byEntity,
        a: foundation.addresses.byWord,
        g: foundation.addresses.byGroup,
        path: foundation.addresses.byPath,
      };
      if (!readers[key]) throw new Error(`subdomain key '${key}' is not supported`);
      return readers[key](value);
    },
    queryEntity: foundation.entities.byId,
    queryWord: foundation.words.byId,
    queryGroup: foundation.groups.byId,
    queryAccess: authorization.legacyAccessById,
    queryVerified: authorization.verifiedBy,
  });

  return Object.freeze({
    contractVersion: 1,
    tables,
    foundation,
    authorization,
    identity,
    context,
    retrieval,
    compatibility,
  });
}

module.exports = {
  BASE_TABLES,
  batchWriteAll,
  createCanonicalPersistence,
  resolvedTables,
};
