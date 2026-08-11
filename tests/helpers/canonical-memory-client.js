"use strict";

const KEYS = {
  words: ["a"], entities: ["e"], subdomains: ["su"], groups: ["g"], links: ["id"],
  versions: ["v", "d"], perm_grants: ["entityID", "principalID"],
  canonical_projection: ["pk", "sk"], context_graph: ["audienceId", "recordKey"],
};

function memoryClient() {
  const tables = new Map(Object.keys(KEYS).map((name) => [name, new Map()]));
  const rowKey = (table, row) => KEYS[table].map((key) => String(row[key])).join("\u001f");
  const clone = (value) => value == null ? value : structuredClone(value);
  return {
    tables,
    batchWrite: ({ RequestItems }) => ({ promise: async () => {
      for (const [table, requests] of Object.entries(RequestItems)) {
        const rows = tables.get(table);
        for (const request of requests) {
          const item = request.PutRequest?.Item;
          if (item) rows.set(rowKey(table, item), clone(item));
        }
      }
      return { UnprocessedItems: {} };
    } }),
    batchGet: ({ RequestItems }) => ({ promise: async () => {
      const Responses = {};
      for (const [table, request] of Object.entries(RequestItems)) {
        const rows = tables.get(table);
        Responses[table] = request.Keys.map((key) => clone(rows.get(rowKey(table, key)))).filter(Boolean);
      }
      return { Responses, UnprocessedKeys: {} };
    } }),
    query: (params) => ({ promise: async () => {
      const rows = [...tables.get(params.TableName).values()];
      const pk = params.ExpressionAttributeValues[":pk"];
      if (pk != null) return { Items: clone(rows.filter((row) => row.pk === pk)) };
      const audience = params.ExpressionAttributeValues[":audience"];
      if (audience != null) return { Items: clone(rows.filter((row) => row.audienceId === audience)) };
      const lookup = params.ExpressionAttributeValues[":lookup"];
      if (lookup != null) return { Items: clone(rows.filter((row) => row.lookupKey === lookup)) };
      throw new Error(`unsupported memory query for ${params.TableName}`);
    } }),
    put: ({ TableName, Item }) => ({ promise: async () => {
      tables.get(TableName).set(rowKey(TableName, Item), clone(Item));
      return {};
    } }),
    get: ({ TableName, Key }) => ({ promise: async () => ({
      Item: clone(tables.get(TableName).get(rowKey(TableName, Key))),
    }) }),
  };
}

module.exports = { memoryClient };
