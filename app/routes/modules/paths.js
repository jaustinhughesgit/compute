// modules/paths.js
"use strict";

/**
 * DynamoDB tables
 *  - paths
 *      PK:  id (S)           e.g. "p1234"
 *      ATTR: e (S)           entity id the path belongs to
 *            by (S)          creator E (from cookie)
 *            sig (S)         signature (unique per e)
 *            left (S)        JSON string
 *            right (S)       JSON string
 *            createdAt (S)   ISO
 *            updatedAt (S)   ISO
 *    GSIs:
 *      - eSigIndex  (PK: e, SK: sig)         // fast idempotent upsert by (e,sig)
 *      - eIndex     (PK: e, SK: updatedAt)   // list paths for an entity page
 *      - byIndex    (PK: by, SK: updatedAt)  // optional auditing by creator
 *
 *  - pCounter
 *      PK: k (S)       always "paths"
 *      ATTR: n (N)     monotonically increasing counter
 */

function register({ on, use }) {
  const {
    getDocClient,
    deps,
    getSub,                          // su/e lookup
    incrementCounterAndGetNewValue,  // << reuse your shared counter helper
  } = use();

  const TableName = "paths";
  const CounterTable = "pCounter";

  // ---------- helpers ----------
  const withEnv = () => {
    const { AWS: AWSFromUse, dynamodbLL: ddbLLFromUse } = deps || {};
    const AWS = AWSFromUse || require("aws-sdk");
    const doc = getDocClient();
    const ddbLL = ddbLLFromUse || new AWS.DynamoDB({ region: "us-east-1" });
    return { doc, ddbLL, AWS };
  };

  const wrap = (payload, meta, file = "") => {
    const cookie = meta?.cookie || {};
    const response = { ...(payload || {}), existing: cookie.existing, file };
    return { ok: true, response };
  };

  async function nextPathId(doc) {
    const res = await doc
      .update({
        TableName: CounterTable,
        Key: { k: "paths" },
        UpdateExpression: "ADD #n :one SET #u = :now",
        ExpressionAttributeNames: { "#n": "n", "#u": "updatedAt" },
        ExpressionAttributeValues: { ":one": 1, ":now": new Date().toISOString() },
        ReturnValues: "UPDATED_NEW",
      })
      .promise();
    const n = Number(res?.Attributes?.n ?? 0);
    return `p${n}`; // e.g. "p1234"; tweak formatting if you want zero-padding
  }

  // ID minting now uses your shared { pk: <tableName>, x: <number> } pattern.
  async function nextPathId() {
    const x = await incrementCounterAndGetNewValue(CounterTable); // returns updated x
    return `p${Number(x)}`; // e.g. "p36"
  }

  async function resolveE({ body, segs, meta }) {
    // 1) explicit body.e
    let e = String(body?.e || "").trim();
    if (e) return e;

    // 2) path[0] = primarySu → e
    const primarySu = String(segs?.[0] || "").trim();
    if (primarySu) {
      try {
        const sub = await getSub(primarySu, "su");
        e = String(sub?.Items?.[0]?.e || "");
        if (e) return e;
      } catch {}
    }

    // 3) fallback to cookie.e
    e = String(meta?.cookie?.e || "");
    return e;
  }

  // ---------- bootstrap ----------
  on("createPaths", async (_ctx, meta) => {
    const { ddbLL } = withEnv();

    let info = {};
    try {
      // paths
      const ensureTable = async () => {
        let exists = false;
        try {
          await ddbLL.describeTable({ TableName }).promise();
          exists = true;
        } catch (err) {
          if (err.code !== "ResourceNotFoundException") throw err;
        }
        if (!exists) {
          await ddbLL
            .createTable({
              TableName,
              BillingMode: "PAY_PER_REQUEST",
              AttributeDefinitions: [
                { AttributeName: "id", AttributeType: "S" },
                { AttributeName: "e", AttributeType: "S" },
                { AttributeName: "sig", AttributeType: "S" },
                { AttributeName: "by", AttributeType: "S" },
                { AttributeName: "updatedAt", AttributeType: "S" },
              ],
              KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
              GlobalSecondaryIndexes: [
                {
                  IndexName: "eSigIndex",
                  KeySchema: [
                    { AttributeName: "e", KeyType: "HASH" },
                    { AttributeName: "sig", KeyType: "RANGE" },
                  ],
                  Projection: { ProjectionType: "ALL" },
                },
                {
                  IndexName: "eIndex",
                  KeySchema: [
                    { AttributeName: "e", KeyType: "HASH" },
                    { AttributeName: "updatedAt", KeyType: "RANGE" },
                  ],
                  Projection: { ProjectionType: "ALL" },
                },
                {
                  IndexName: "byIndex",
                  KeySchema: [
                    { AttributeName: "by", KeyType: "HASH" },
                    { AttributeName: "updatedAt", KeyType: "RANGE" },
                  ],
                  Projection: { ProjectionType: "ALL" },
                },
              ],
            })
            .promise();
          await ddbLL.waitFor("tableExists", { TableName }).promise();
        }
      };

      const ensureCounter = async () => {
        let exists = false;
        try {
          await ddbLL.describeTable({ TableName: CounterTable }).promise();
          exists = true;
        } catch (err) {
          if (err.code !== "ResourceNotFoundException") throw err;
        }
        if (!exists) {
          await ddbLL
            .createTable({
              TableName: CounterTable,
              BillingMode: "PAY_PER_REQUEST",
              // match aiCounter/eCounter shape: pk (S) is the HASH key
              AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
              KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
            })
            .promise();
          await ddbLL.waitFor("tableExists", { TableName: CounterTable }).promise();
          // (Optional) no need to seed; your shared increment will create the item on first ADD.
        }
      };

      await ensureTable();
      await ensureCounter();
      info = { alert: "ok", tables: [TableName, CounterTable] };
    } catch (e) {
      info = { alert: "failed", error: String(e?.message || e) };
    }
    return wrap(info, meta, "");
  });

  // ---------- list for an entity (by e or primarySu path seg) ----------
  // Path: /listPaths/:primarySu?   Body: { e?:string }
  on("listPaths", async (ctx, meta) => {
    const { doc } = withEnv();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const body = (ctx?.req?.body && ctx.req.body.body) || ctx?.req?.body || {};
    const e = await resolveE({ body, segs, meta });
    if (!e) return wrap({ paths: [], note: "no-e" }, meta, "");

    const out = [];
    let ExclusiveStartKey;
    do {
      const res = await doc
        .query({
          TableName,
          IndexName: "eIndex",
          KeyConditionExpression: "#e = :e",
          ExpressionAttributeNames: { "#e": "e" },
          ExpressionAttributeValues: { ":e": e },
          ExclusiveStartKey,
          ScanIndexForward: false, // newest first
        })
        .promise();
      out.push(
        ...(res.Items || []).map((it) => ({
          id: it.id,
          e: it.e,
          by: it.by,
          sig: it.sig,
          left: it.left ? JSON.parse(it.left) : null,
          right: it.right ? JSON.parse(it.right) : null,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
        }))
      );
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    return wrap({ paths: out }, meta, "");
  });

  // ---------- save (create or update by (e,sig)) ----------
  // Path: /savePath/:primarySu?   Body: { e?:string, sig, left, right }
  on("savePath", async (ctx, meta) => {
    const { doc } = withEnv();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const rb = (ctx?.req?.body && ctx.req.body.body) || ctx?.req?.body || {};
    const now = new Date().toISOString();
    const sig = String(rb.sig || "").trim();
    const e = await resolveE({ body: rb, segs, meta });
    if (!sig || !e) return wrap({ ok: false, error: "missing sig or e" }, meta, "");

    // idempotent upsert by (e, sig)
    const found = await doc
      .query({
        TableName,
        IndexName: "eSigIndex",
        KeyConditionExpression: "#e = :e AND #sig = :sig",
        ExpressionAttributeNames: { "#e": "e", "#sig": "sig" },
        ExpressionAttributeValues: { ":e": e, ":sig": sig },
        Limit: 1,
      })
      .promise();

    const by = String(meta?.cookie?.e || "");
    const leftStr = JSON.stringify(rb.left ?? null);
    const rightStr = JSON.stringify(rb.right ?? null);

    if (found?.Items?.length) {
      const it = found.Items[0];
      const upd = await doc
        .update({
          TableName,
          Key: { id: it.id },
          UpdateExpression:
            "SET #left = :left, #right = :right, #updatedAt = :now, #by = if_not_exists(#by, :by)",
          ExpressionAttributeNames: {
            "#left": "left",
            "#right": "right",
            "#updatedAt": "updatedAt",
            "#by": "by",
          },
          ExpressionAttributeValues: {
            ":left": leftStr,
            ":right": rightStr,
            ":now": now,
            ":by": by,
          },
          ReturnValues: "ALL_NEW",
        })
        .promise();

      return wrap(
        {
          path: {
            id: upd.Attributes.id,
            e: upd.Attributes.e,
            by: upd.Attributes.by,
            sig: upd.Attributes.sig,
            left: JSON.parse(upd.Attributes.left || "null"),
            right: JSON.parse(upd.Attributes.right || "null"),
            createdAt: upd.Attributes.createdAt,
            updatedAt: upd.Attributes.updatedAt,
          },
        },
        meta,
        upd.Attributes.id
      );
    }

    const id = await nextPathId();
    await doc
      .put({
        TableName,
        Item: {
          id,
          e,
          by,
          sig,
          left: leftStr,
          right: rightStr,
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression: "attribute_not_exists(#id)",
        ExpressionAttributeNames: { "#id": "id" },
      })
      .promise();

    return wrap(
      {
        path: {
          id,
          e,
          by,
          sig,
          left: JSON.parse(leftStr),
          right: JSON.parse(rightStr),
          createdAt: now,
          updatedAt: now,
        },
      },
      meta,
      id
    );
  });

  // ---------- delete by id ----------
  // Path: /deletePath/:id
  on("deletePath", async (ctx, meta) => {
    const { doc } = withEnv();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const id = String(segs?.[0] || "").trim();
    if (!id) return wrap({ ok: false, error: "missing id" }, meta, "");
    await doc.delete({ TableName, Key: { id } }).promise();
    return wrap({ ok: true, id }, meta, id);
  });

  return { name: "paths" };
}

module.exports = { register };
