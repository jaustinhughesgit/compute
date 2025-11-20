// modules/resetDB.js
"use strict";

function register({ on, use }) {
  const {
    getDocClient,
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // ────────────────────────────────────────────────────────────────────────────
  // Legacy constants (verbatim)
  // ────────────────────────────────────────────────────────────────────────────
  const tablesToClear = [
    'access',
    'cookies',
    'entities',
    'groups',
    'links',
    'schedules',
    'subdomains',
    'tasks',
    'words',
    'verified',
    'paths',
    'users',
    'passphrases',
    'versions',
    'email_bounce_events',
    'email_sends',
    'deliverability_blocks',
    'email_metrics_daily',
    'anchor_bands'

  ];

  const countersToReset = [
    { tableName: 'aiCounter', primaryKey: 'aiCounter' },
    { tableName: 'ciCounter', primaryKey: 'ciCounter' },
    { tableName: 'eCounter', primaryKey: 'eCounter' },
    { tableName: 'enCounter', primaryKey: 'enCounter' },
    { tableName: 'gCounter', primaryKey: 'gCounter' },
    { tableName: 'giCounter', primaryKey: 'giCounter' },
    { tableName: 'siCounter', primaryKey: 'siCounter' },
    { tableName: 'tiCounter', primaryKey: 'tiCounter' },
    { tableName: 'vCounter', primaryKey: 'vCounter' },
    { tableName: 'viCounter', primaryKey: 'viCounter' },
    { tableName: 'wCounter', primaryKey: 'wCounter' },
    { tableName: 'pCounter', primaryKey: 'pCounter' },
    { tableName: 'ppCounter', primaryKey: 'ppCounter' }
  ];

  const keySchemaMap = {
    'access':   { partitionKey: 'ai' },
    'cookies':  { partitionKey: 'ci' },
    'entities': { partitionKey: 'e' },
    'groups':   { partitionKey: 'g' },
    'links':   { partitionKey: 'id' },
    'schedules':{ partitionKey: 'si' },
    'subdomains': { partitionKey: 'su' },
    'tasks':    { partitionKey: 'ti' },
    'words':    { partitionKey: 'a' },
    'verified': { partitionKey: 'vi' },
    'paths': { partitionKey: 'pi' },
    'users': { partitionKey: 'userID' },
    'passphrases': { partitionKey: 'passphraseID' },
    'versions': { partitionKey: 'v', sortKey: 'd' },
    'email_bounce_events': { partitionKey: 'id' },
    'email_sends': { partitionKey: 'senderHash', sortKey: 'ts' },
    'deliverability_blocks': { partitionKey: 'recipientHash', sortKey: 'scope' },
    'email_metrics_daily': { partitionKey: 'senderUserID', sortKey: 'day'  },
    'anchor_bands': { partitionKey: 'pk', sortKey: 'sk'  },
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Legacy helpers (verbatim logic)
  // ────────────────────────────────────────────────────────────────────────────
  async function clearTable(tableName, dynamodb) {
    const params = { TableName: tableName };
    let items;
    do {
      items = await dynamodb.scan(params).promise();
      if (!items.Items || items.Items.length === 0) break;

      const keySchema = keySchemaMap[tableName];
      if (!keySchema || !keySchema.partitionKey) {
        throw new Error(`Primary key attribute not defined for table ${tableName}`);
      }

      const deleteRequests = items.Items.map((item) => {
        if (item[keySchema.partitionKey] === undefined) {
          throw new Error(`Partition key '${keySchema.partitionKey}' not found in item`);
        }
        const key = { [keySchema.partitionKey]: item[keySchema.partitionKey] };
        if (keySchema.sortKey) {
          if (item[keySchema.sortKey] === undefined) {
            throw new Error(`Sort key '${keySchema.sortKey}' not found in item`);
          }
          key[keySchema.sortKey] = item[keySchema.sortKey];
        }
        return { DeleteRequest: { Key: key } };
      });

      const batches = [];
      while (deleteRequests.length) {
        batches.push(deleteRequests.splice(0, 25));
      }
      for (const batch of batches) {
        const batchParams = { RequestItems: { [tableName]: batch } };
        await dynamodb.batchWrite(batchParams).promise();
      }

      params.ExclusiveStartKey = items.LastEvaluatedKey;
    } while (typeof items.LastEvaluatedKey !== 'undefined');
  }

  async function resetCounter(counter, dynamodb) {
    const params = {
      TableName: counter.tableName,
      Key: { pk: counter.primaryKey },
      UpdateExpression: 'SET #x = :zero',
      ExpressionAttributeNames: { '#x': 'x' },
      ExpressionAttributeValues: { ':zero': 0 },
    };
    await dynamodb.update(params).promise();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Action wiring
  // ────────────────────────────────────────────────────────────────────────────
  on("resetDB", async (ctx /*, meta */) => {
    const dynamodb = getDocClient();

    try {
      for (const tableName of tablesToClear) {
        await clearTable(tableName, dynamodb);
      }
      for (const counter of countersToReset) {
        await resetCounter(counter, dynamodb);
      }

       ctx.res.setHeader("Set-Cookie",
      "accessToken=; Max-Age=0; Path=/; Domain=.1var.com; HttpOnly; Secure; SameSite=None"
    );
      // Preserve legacy response shape: { ok: true, response: { alert: "success" } }
      return { ok: true, response: { alert: "success" } };
    } catch (error) {
      console.error('Error resetting database:', error);
      // Preserve legacy "failed" branch
      return { ok: true, response: { alert: "failed" } };
    }
  });

  return { name: "resetDB" };
}

module.exports = { register };
