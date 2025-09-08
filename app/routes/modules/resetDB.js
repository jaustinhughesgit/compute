// routes/modules/resetDB.js
/**
 * Danger: wipes core tables and resets counters to zero.
 * Mirrors the logic already embedded in your route("resetDB") branch.
 *
 * @param {{}} _args
 * @param {{ dynamodb: AWS.DynamoDB.DocumentClient }} ctx
 * @returns {Promise<{alert: string}>}
 */
const keySchemaMap = {
  access:    { partitionKey: 'ai' },
  cookies:   { partitionKey: 'ci' },
  entities:  { partitionKey: 'e'  },
  groups:    { partitionKey: 'g'  },
  schedules: { partitionKey: 'si' },
  subdomains:{ partitionKey: 'su' },
  tasks:     { partitionKey: 'ti' },
  words:     { partitionKey: 'a'  },
  verified:  { partitionKey: 'vi' },
  versions:  { partitionKey: 'v', sortKey: 'd' }
};

const tablesToClear = [
  'access','cookies','entities','groups','schedules',
  'subdomains','tasks','words','verified','versions'
];

const countersToReset = [
  { tableName: 'aiCounter', primaryKey: 'aiCounter' },
  { tableName: 'ciCounter', primaryKey: 'ciCounter' },
  { tableName: 'eCounter',  primaryKey: 'eCounter'  },
  { tableName: 'enCounter', primaryKey: 'enCounter' },
  { tableName: 'gCounter',  primaryKey: 'gCounter'  },
  { tableName: 'giCounter', primaryKey: 'giCounter' },
  { tableName: 'siCounter', primaryKey: 'siCounter' },
  { tableName: 'tiCounter', primaryKey: 'tiCounter' },
  { tableName: 'vCounter',  primaryKey: 'vCounter'  },
  { tableName: 'viCounter', primaryKey: 'viCounter' },
  { tableName: 'wCounter',  primaryKey: 'wCounter'  }
];

async function clearTable(tableName, dynamodb) {
  let lastKey;
  do {
    const scanRes = await dynamodb.scan({ TableName: tableName, ExclusiveStartKey: lastKey }).promise();
    const items = scanRes.Items || [];
    if (!items.length) break;

    const ks = keySchemaMap[tableName];
    const deletes = items.map((it) => {
      const key = { [ks.partitionKey]: it[ks.partitionKey] };
      if (ks.sortKey) key[ks.sortKey] = it[ks.sortKey];
      return { DeleteRequest: { Key: key } };
    });

    // batch in chunks of 25
    for (let i = 0; i < deletes.length; i += 25) {
      const chunk = deletes.slice(i, i + 25);
      await dynamodb.batchWrite({ RequestItems: { [tableName]: chunk } }).promise();
    }
    lastKey = scanRes.LastEvaluatedKey;
  } while (lastKey);
}

async function resetCounter(counter, dynamodb) {
  await dynamodb.update({
    TableName: counter.tableName,
    Key: { pk: counter.primaryKey },
    UpdateExpression: 'SET #x = :zero',
    ExpressionAttributeNames: { '#x': 'x' },
    ExpressionAttributeValues: { ':zero': 0 }
  }).promise();
}

module.exports = async function resetDB(_args, { dynamodb }) {
  try {
    for (const t of tablesToClear) await clearTable(t, dynamodb);
    for (const c of countersToReset) await resetCounter(c, dynamodb);
    return { alert: 'success' };
  } catch (err) {
    console.error('resetDB failed:', err);
    return { alert: 'failed', error: String(err?.message || err) };
  }
};
