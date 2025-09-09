// routes/modules/resetDB.js
"use strict";

/**
 * Danger: wipes core tables and resets counters to zero.
 * Mirrors the logic already embedded in your route("resetDB") branch.
 */

const keySchemaMap = {
  access:     { partitionKey: "ai" },
  cookies:    { partitionKey: "ci" },
  entities:   { partitionKey: "e"  },
  groups:     { partitionKey: "g"  },
  schedules:  { partitionKey: "si" },
  subdomains: { partitionKey: "su" },
  tasks:      { partitionKey: "ti" },
  words:      { partitionKey: "a"  },
  verified:   { partitionKey: "vi" },
  versions:   { partitionKey: "v", sortKey: "d" }
};

const tablesToClear = [
  "access","cookies","entities","groups","schedules",
  "subdomains","tasks","words","verified","versions"
];

const countersToReset = [
  { tableName: "aiCounter", primaryKey: "aiCounter" },
  { tableName: "ciCounter", primaryKey: "ciCounter" },
  { tableName: "eCounter",  primaryKey: "eCounter"  },
  { tableName: "enCounter", primaryKey: "enCounter" },
  { tableName: "gCounter",  primaryKey: "gCounter"  },
  { tableName: "giCounter", primaryKey: "giCounter" },
  { tableName: "siCounter", primaryKey: "siCounter" },
  { tableName: "tiCounter", primaryKey: "tiCounter" },
  { tableName: "vCounter",  primaryKey: "vCounter"  },
  { tableName: "viCounter", primaryKey: "viCounter" },
  { tableName: "wCounter",  primaryKey: "wCounter"  }
];

async function clearTable(tableName, dynamodb) {
  let lastKey;
  do {
    const scanRes = await dynamodb.scan({
      TableName: tableName,
      ExclusiveStartKey: lastKey
    }).promise();

    const items = scanRes.Items || [];
    if (!items.length) break;

    const ks = keySchemaMap[tableName];
    const deletes = items.map((it) => {
      const key = { [ks.partitionKey]: it[ks.partitionKey] };
      if (ks.sortKey) key[ks.sortKey] = it[ks.sortKey];
      return { DeleteRequest: { Key: key } };
    });

    // Batch in chunks of 25
    for (let i = 0; i < deletes.length; i += 25) {
      const chunk = deletes.slice(i, i + 25);
      let req = { RequestItems: { [tableName]: chunk } };
      // simple retry loop for unprocessed items
      for (let attempt = 0; attempt < 5 && Object.keys(req.RequestItems).length; attempt++) {
        const res = await dynamodb.batchWrite(req).promise();
        const unp = res.UnprocessedItems || {};
        req = { RequestItems: unp };
        if (!Object.keys(unp).length) break;
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
      }
    }

    lastKey = scanRes.LastEvaluatedKey;
  } while (lastKey);
}

async function resetCounter(counter, dynamodb) {
  await dynamodb.update({
    TableName: counter.tableName,
    Key: { pk: counter.primaryKey },
    UpdateExpression: "SET #x = :zero",
    ExpressionAttributeNames: { "#x": "x" },
    ExpressionAttributeValues: { ":zero": 0 }
  }).promise();
}

async function handleResetDB(ctx) {
  // Support either flattened deps or ctx.deps.*
  const dynamodb = ctx.dynamodb || ctx.deps?.dynamodb;
  if (!dynamodb) {
    return { alert: "failed", error: "dynamodb client not available" };
  }

  try {
    for (const t of tablesToClear) {
      await clearTable(t, dynamodb);
    }
    for (const c of countersToReset) {
      await resetCounter(c, dynamodb);
    }
    return { alert: "success" };
  } catch (err) {
    console.error("resetDB failed:", err);
    return { alert: "failed", error: String(err?.message || err) };
  }
}

// Export a direct handler (optional/back-compat with direct requires)
module.exports.handle = handleResetDB;

/** Register hook for your shared module loader */
module.exports.register = function register({ on /*, use */ }) {
  on("resetDB", handleResetDB);
};
