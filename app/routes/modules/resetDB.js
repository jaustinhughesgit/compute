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
    // Keep the core account/runtime tables first so a later optional-table
    // failure cannot leave these behind after a reset.
    'users',
    'versions',
    'paths',
    'presence',
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
    'passphrases',
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

  // ────────────────────────────────────────────────────────────────────────────
  // Reset helpers
  // ────────────────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isMissingTable(error) {
    return error && error.code === 'ResourceNotFoundException';
  }

  async function writeDeleteBatch(tableName, batch, dynamodb) {
    let pending = batch;

    for (let attempt = 0; pending.length && attempt < 8; attempt += 1) {
      const result = await dynamodb.batchWrite({
        RequestItems: { [tableName]: pending },
      }).promise();

      pending = (result.UnprocessedItems && result.UnprocessedItems[tableName]) || [];
      if (pending.length) await sleep(Math.min(50 * (2 ** attempt), 1000));
    }

    if (pending.length) {
      throw new Error(`Unable to delete ${pending.length} item(s) from ${tableName}`);
    }
  }

  async function clearTable(tableName, dynamodb, dynamodbLL) {
    let description;
    try {
      description = await dynamodbLL.describeTable({ TableName: tableName }).promise();
    } catch (error) {
      if (isMissingTable(error)) return { tableName, deleted: 0, skipped: true };
      throw error;
    }

    const keyNames = (description.Table && description.Table.KeySchema || [])
      .sort((a, b) => (a.KeyType === 'HASH' ? -1 : 1) - (b.KeyType === 'HASH' ? -1 : 1))
      .map((key) => key.AttributeName);

    if (!keyNames.length) {
      throw new Error(`No key schema found for table ${tableName}`);
    }

    const expressionNames = {};
    const projection = keyNames.map((keyName, index) => {
      const placeholder = `#k${index}`;
      expressionNames[placeholder] = keyName;
      return placeholder;
    }).join(', ');

    let deleted = 0;
    while (true) {
      // Always scan from the beginning after deleting a page. This avoids
      // using a deleted LastEvaluatedKey and continues until the table is empty.
      const page = await dynamodb.scan({
        TableName: tableName,
        ConsistentRead: true,
        ProjectionExpression: projection,
        ExpressionAttributeNames: expressionNames,
      }).promise();

      if (!page.Items || page.Items.length === 0) break;

      const requests = page.Items.map((item) => {
        const key = {};
        for (const keyName of keyNames) {
          if (item[keyName] === undefined) {
            throw new Error(`Key '${keyName}' not found in an item from ${tableName}`);
          }
          key[keyName] = item[keyName];
        }
        return { DeleteRequest: { Key: key } };
      });

      for (let index = 0; index < requests.length; index += 25) {
        const batch = requests.slice(index, index + 25);
        await writeDeleteBatch(tableName, batch, dynamodb);
        deleted += batch.length;
      }
    }

    return { tableName, deleted, skipped: false };
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
    const dynamodbLL = deps.dynamodbLL;
    const clearedTables = [];
    const skippedTables = [];
    const failures = [];

    for (const tableName of tablesToClear) {
      try {
        const result = await clearTable(tableName, dynamodb, dynamodbLL);
        if (result.skipped) skippedTables.push(tableName);
        else clearedTables.push({ tableName, deleted: result.deleted });
      } catch (error) {
        console.error(`Error clearing table ${tableName}:`, error);
        failures.push({ tableName, error: error.message });
      }
    }

    for (const counter of countersToReset) {
      try {
        await resetCounter(counter, dynamodb);
      } catch (error) {
        if (isMissingTable(error)) {
          skippedTables.push(counter.tableName);
        } else {
          console.error(`Error resetting counter ${counter.tableName}:`, error);
          failures.push({ tableName: counter.tableName, error: error.message });
        }
      }
    }

    if (failures.length === 0) {
      ctx.res.setHeader("Set-Cookie",
      "accessToken=; Max-Age=0; Path=/; Domain=.1var.com; HttpOnly; Secure; SameSite=None"
      );
      // Preserve legacy response shape: { ok: true, response: { alert: "success" } }
      return {
        ok: true,
        response: { alert: "success", clearedTables, skippedTables },
      };
    }

    return {
      ok: true,
      response: { alert: "failed", clearedTables, skippedTables, failures },
    };
  });

  return { name: "resetDB" };
}

module.exports = { register };
