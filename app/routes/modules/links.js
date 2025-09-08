//routes/modules/links.js
/** Capabilities:
 *   - action === "createLinks"  → create links table with GSIs
 *   - action === "migrateLinks" → copy .l/.o from entities → links
 *   - action === "link"         → parent ← child (by su)
 *   - action === "unlink"       → remove parent ← child (by su)
 */
module.exports.register = ({ on, use }) => {
  on('createLinks', async (ctx) => {
    const { dynamodbLL, AWS } = ctx.deps;
    const sendBack = use('sendBack');

    const ddb = dynamodbLL || (AWS ? new AWS.DynamoDB({ region: 'us-east-1' }) : null);
    if (!ddb) {
      return { ok: false, error: 'No low-level DynamoDB client available' };
    }

    const TableName = 'links';

    // Check if exists
    let exists = false;
    try { await ddb.describeTable({ TableName }).promise(); exists = true; } 
    catch (err) { if (err.code !== 'ResourceNotFoundException') throw err; }

    if (!exists) {
      const params = {
        TableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'id',    AttributeType: 'S' },
          { AttributeName: 'whole', AttributeType: 'S' },
          { AttributeName: 'part',  AttributeType: 'S' },
          { AttributeName: 'ckey',  AttributeType: 'S' },
          { AttributeName: 'type',  AttributeType: 'S' },
        ],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'wholeIndex',
            KeySchema: [
              { AttributeName: 'whole', KeyType: 'HASH' },
              { AttributeName: 'type',  KeyType: 'RANGE' }
            ],
            Projection: { ProjectionType: 'ALL' }
          },
          {
            IndexName: 'partIndex',
            KeySchema: [
              { AttributeName: 'part', KeyType: 'HASH' },
              { AttributeName: 'type', KeyType: 'RANGE' }
            ],
            Projection: { ProjectionType: 'ALL' }
          },
          {
            IndexName: 'ckeyIndex',
            KeySchema: [{ AttributeName: 'ckey', KeyType: 'HASH' }],
            Projection: { ProjectionType: 'ALL' }
          }
        ]
      };

      await ddb.createTable(params).promise();
      await ddb.waitFor('tableExists', { TableName }).promise();
      return { ok: true, response: { alert: 'created', table: TableName } };
    }

    return { ok: true, response: { alert: 'already-exists', table: TableName } };
  });

  on('migrateLinks', async (ctx) => {
    const { dynamodb } = ctx.deps;
    const migrateLinksFromEntities = use('migrateLinksFromEntities');

    try {
      const stats = await migrateLinksFromEntities(dynamodb);
      return { ok: true, response: { alert: 'ok', migrated: stats.created, scanned: stats.scanned, table: 'links' } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  on('link', async (ctx, { cookie }) => {
    const { dynamodb, uuidv4, dynamodbLL } = ctx.deps;
    const getSub          = use('getSub');
    const putLink         = use('putLink');
    const convertToJSON   = use('convertToJSON');

    const parts    = ctx.path.split('/');
    const childSU  = parts[3]; // su of child
    const parentSU = parts[4]; // su of parent

    const childSub  = await getSub(childSU, 'su', dynamodb);
    const parentSub = await getSub(parentSU, 'su', dynamodb);
    if (!childSub.Items.length || !parentSub.Items.length) {
      return { ok: false, error: 'not-found' };
    }

    await putLink(parentSub.Items[0].e, childSub.Items[0].e, dynamodb);

    // return updated child view (mirrors original behavior)
    const mainObj = await convertToJSON(
      childSU, [], null, null, cookie, dynamodb, uuidv4,
      null, [], {}, '', dynamodbLL, ctx.req.body
    );

    return { ok: true, response: mainObj };
  });

  on('unlink', async (ctx, { cookie }) => {
    const { dynamodb, uuidv4, dynamodbLL } = ctx.deps;
    const getSub        = use('getSub');
    const deleteLink    = use('deleteLink');
    const convertToJSON = use('convertToJSON');

    const parts    = ctx.path.split('/');
    const childSU  = parts[3];
    const parentSU = parts[4];

    const childSub  = await getSub(childSU, 'su', dynamodb);
    const parentSub = await getSub(parentSU, 'su', dynamodb);
    if (childSub.Items.length && parentSub.Items.length) {
      await deleteLink(parentSub.Items[0].e, childSub.Items[0].e, dynamodb);
    }

    const mainObj = await convertToJSON(
      childSU, [], null, null, cookie, dynamodb, uuidv4,
      null, [], {}, '', dynamodbLL, ctx.req.body
    );

    return { ok: true, response: mainObj };
  });
};
