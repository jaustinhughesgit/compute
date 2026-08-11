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
  canonicalProjections: "canonical_projection",
  canonicalAudit: "canonical_audit",
  retrievalPostings: "anchor_bands",
});

function resolvedTables(overrides = {}, env = process.env) {
  return Object.freeze({
    ...BASE_TABLES,
    contextSidecar: env.CONTEXT_GRAPH_TABLE || BASE_TABLES.contextSidecar,
    canonicalProjections: env.CANONICAL_PROJECTION_TABLE || BASE_TABLES.canonicalProjections,
    canonicalAudit: env.CANONICAL_AUDIT_TABLE || BASE_TABLES.canonicalAudit,
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
    const key = item.pk != null && item.sk != null
      ? `${item.pk}\u001f${item.sk}`
      : item.audienceId && item.recordKey
        ? `${item.audienceId}\u001f${item.recordKey}`
        : item.entityID != null && item.principalID != null
          ? `${item.entityID}\u001f${item.principalID}`
          : item.v != null && item.d != null
            ? `${item.v}\u001f${item.d}`
            : String(item.a ?? item.e ?? item.su ?? item.g ?? item.id ?? JSON.stringify(item));
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

async function batchGetAll(client, TableName, keys, maxAttempts = 7) {
  const unique = [...new Map(
    (Array.isArray(keys) ? keys : []).map((key) => [JSON.stringify(key), key])
  ).values()];
  const items = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    let pending = unique.slice(offset, offset + 100);
    for (let attempt = 0; pending.length && attempt < maxAttempts; attempt += 1) {
      const result = await invoke(client, "batchGet", {
        RequestItems: { [TableName]: { Keys: pending } },
      });
      items.push(...(result?.Responses?.[TableName] || []));
      pending = result?.UnprocessedKeys?.[TableName]?.Keys || [];
    }
    if (pending.length) {
      const error = new Error(`${TableName} left ${pending.length} reads unprocessed`);
      error.code = "CANONICAL_PERSISTENCE_UNPROCESSED";
      throw error;
    }
  }
  return items;
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
      batchGet: (wordIds) => batchGetAll(
        documentClient, tables.words, (Array.isArray(wordIds) ? wordIds : []).map((a) => ({ a }))
      ),
    }),
    entities: Object.freeze({
      byId: (entityId) => queryByKey(documentClient, tables.entities, "e", entityId),
      put: (item, options = {}) => invoke(documentClient, "put", {
        TableName: tables.entities, Item: required(item, "entity item"), ...options,
      }),
      batchGet: (entityIds) => batchGetAll(
        documentClient, tables.entities, (Array.isArray(entityIds) ? entityIds : []).map((e) => ({ e }))
      ),
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
      batchGet: (addressIds) => batchGetAll(
        documentClient,
        tables.addresses,
        (Array.isArray(addressIds) ? addressIds : []).map((su) => ({ su: String(su) }))
      ),
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
      batchGet: (relationIds) => batchGetAll(
        documentClient, tables.relations, (Array.isArray(relationIds) ? relationIds : []).map((id) => ({ id }))
      ),
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
    batchGetGrants: (keys) => batchGetAll(documentClient, tables.grants, keys),
    putGrant: (item, options = {}) => invoke(documentClient, "put", {
      TableName: tables.grants, Item: required(item, "grant item"), ...options,
    }),
  });

  const governance = Object.freeze({
    enabled: Boolean(tableNames.canonicalAudit || (env || process.env).CANONICAL_AUDIT_TABLE),
    appendAudit: (event, options = {}) => invoke(documentClient, "put", {
      TableName: tables.canonicalAudit, Item: required(event, "audit event"), ...options,
    }),
    writeRelation({ relation, expectedVersion = 0, versionRecord, audit }) {
      const expected = Math.max(0, Number(expectedVersion) || 0);
      const relationPut = {
        TableName: tables.relations, Item: required(relation, "relation"),
        ConditionExpression: expected
          ? "#version = :expected" : "attribute_not_exists(#version)",
        ExpressionAttributeNames: { "#version": "canonicalVersion" },
        ...(expected ? { ExpressionAttributeValues: { ":expected": expected } } : {}),
      };
      const items = [{ Put: relationPut }];
      if (versionRecord) items.push({ Put: { TableName: tables.versions, Item: versionRecord } });
      if (audit && governance.enabled) items.push({ Put: { TableName: tables.canonicalAudit, Item: audit } });
      return invoke(documentClient, "transactWrite", { TransactItems: items });
    },
    async auditByResource(resourceId, { month = new Date().toISOString().slice(0, 7), limit = 100 } = {}) {
      const pages = await Promise.all(Array.from({ length: 16 }, (_, shard) => invoke(documentClient, "query", {
        TableName: tables.canonicalAudit,
        KeyConditionExpression: "#partition = :partition",
        ExpressionAttributeNames: { "#partition": "auditPartition" },
        ExpressionAttributeValues: {
          ":partition": `${required(resourceId, "resourceId")}#${month}#${String(shard).padStart(2, "0")}`,
        },
        ScanIndexForward: false,
        Limit: Math.max(1, Math.min(100, Number(limit) || 100)),
      })));
      return pages.flatMap((page) => page?.Items || [])
        .sort((a, b) => String(b.eventKey).localeCompare(String(a.eventKey)))
        .slice(0, Math.max(1, Math.min(100, Number(limit) || 100)));
    },
    transition({ resourceType, key, expectedVersion, nextVersion, lifecycle, updatedAt, versionRecord, audit }) {
      const resources = {
        entity: [tables.entities, ["e"]], address: [tables.addresses, ["su"]],
        group: [tables.groups, ["g"]], relation: [tables.relations, ["id"]],
        grant: [tables.grants, ["entityID", "principalID"]],
      };
      const selected = resources[resourceType];
      if (!selected) throw new Error(`Lifecycle resource type '${resourceType}' is not supported`);
      const [TableName, keyNames] = selected;
      const resourceKey = typeof key === "object"
        ? Object.fromEntries(keyNames.map((name) => [name, required(key[name], `resource key ${name}`)]))
        : { [keyNames[0]]: required(key, "resource key") };
      const expected = Math.max(1, Number(expectedVersion) || 1);
      const condition = expected === 1
        ? "attribute_not_exists(#version) OR #version = :expected"
        : "#version = :expected";
      const items = [{ Update: {
        TableName, Key: resourceKey,
        UpdateExpression: "SET #version = :next, #lifecycle = :lifecycle, #updatedAt = :updatedAt",
        ConditionExpression: condition,
        ExpressionAttributeNames: {
          "#version": "canonicalVersion", "#lifecycle": "canonicalLifecycle", "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":expected": expected, ":next": Number(nextVersion), ":lifecycle": lifecycle, ":updatedAt": updatedAt,
        },
      } }];
      if (versionRecord) items.push({ Put: { TableName: tables.versions, Item: versionRecord } });
      if (audit && governance.enabled) items.push({ Put: { TableName: tables.canonicalAudit, Item: audit } });
      return invoke(documentClient, "transactWrite", { TransactItems: items });
    },
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

  const canonical = Object.freeze({
    enabled: Boolean(
      tableNames.canonicalProjections
      || (env || process.env).CANONICAL_PROJECTION_TABLE
    ),
    queryProjection: (partitionKey, { cursor, limit = 100 } = {}) => invoke(documentClient, "query", {
      TableName: tables.canonicalProjections,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "pk" },
      ExpressionAttributeValues: { ":pk": required(partitionKey, "partitionKey") },
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      Limit: Math.max(1, Math.min(500, Number(limit) || 100)),
      ConsistentRead: true,
    }),
    getProjection: (pk, sk) => invoke(documentClient, "get", {
      TableName: tables.canonicalProjections,
      Key: { pk: required(pk, "pk"), sk: required(sk, "sk") },
      ConsistentRead: true,
    }),
    async batchPut(recordSets = {}, options = {}) {
      const maximumAttempts = Math.max(1, Number(options.maxAttempts) || 7);
      const foundationSets = [
        [tables.words, recordSets.words],
        [tables.entities, recordSets.entities],
        [tables.addresses, recordSets.addresses],
        [tables.groups, recordSets.groups],
        [tables.relations, recordSets.relations],
        [tables.versions, recordSets.versions],
        [tables.grants, recordSets.grants],
      ].filter(([, items]) => Array.isArray(items) && items.length);
      const counts = await Promise.all(foundationSets.map(([table, items]) => batchWriteAll(
        documentClient,
        table,
        items,
        maximumAttempts
      )));
      const projections = (recordSets.projections || [])
        .filter((item) => item?.recordType !== "canonical-publication");
      const commitMarkers = (recordSets.projections || [])
        .filter((item) => item?.recordType === "canonical-publication");
      if (projections.length) {
        counts.push(await batchWriteAll(
          documentClient, tables.canonicalProjections, projections, maximumAttempts
        ));
      }
      // A publication marker is written only after canonical facts, grants, and
      // projections have completed, so retry checks cannot accept partial work.
      if (commitMarkers.length) {
        counts.push(await batchWriteAll(
          documentClient, tables.canonicalProjections, commitMarkers, maximumAttempts
        ));
      }
      return counts.reduce((sum, count) => sum + count, 0);
    },
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
    governance,
    identity,
    context,
    canonical,
    retrieval,
    compatibility,
  });
}

module.exports = {
  BASE_TABLES,
  batchGetAll,
  batchWriteAll,
  createCanonicalPersistence,
  resolvedTables,
};
