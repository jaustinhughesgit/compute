// modules/addIndex.js
"use strict";

/**
 * addIndex
 * ----------
 * Upserts a reference row for a given {domain, subdomain} into a table named `i_<domain>`.
 * The row stores up to five reference embeddings: emb1..emb5.
 *
 * Accepts flexible payloads:
 *  - { domain, subdomain, embeddings: number[][] }           // first 1..5 arrays used
 *  - { domain, subdomain, embedding: number[] }              // treated as emb1
 *  - { domain, subdomain, emb1: number[], ..., emb5: [] }    // explicit fields
 * Optional extras are passed through (e.g., description, id).
 *
 * Also supports path params via ctx.path => "/<domain>/<subdomain>"
 */
function register({ on, use }) {
  const { getDocClient, deps } = use();

  on("addIndex", async (ctx /*, meta */) => {
    const { req, path } = ctx;
    const doc = getDocClient();

    // ── 1) Parse inputs (prefer body, fall back to /<domain>/<subdomain> path) ──
    const body = (req && req.body) || {};
    const segs = String(path || "").split("/").filter(Boolean);

    const domain = (body.domain || segs[0] || "").trim();
    const subdomain = (body.subdomain || segs[1] || "").trim();

    if (!domain || !subdomain) {
      return { ok: false, error: "domain and subdomain are required" };
    }

    // ── 2) Normalise embeddings into an array [emb1, emb2, ...] (max 5) ──
    const toVector = (v) => {
      // Accept JSON strings, typed arrays, or plain arrays
      if (typeof v === "string") {
        try { v = JSON.parse(v); } catch { /* leave as string */ }
      }
      if (Array.isArray(v) && v.every(n => typeof n === "number")) return v;
      return null;
    };

    let embList = [];

    if (Array.isArray(body.embeddings) && Array.isArray(body.embeddings[0])) {
      embList = body.embeddings.map(toVector).filter(Boolean).slice(0, 5);
    } else if (body.embedding) {
      const v = toVector(body.embedding);
      if (v) embList = [v];
    } else {
      // emb1..emb5 explicit
      for (let i = 1; i <= 5; i++) {
        const v = toVector(body[`emb${i}`]);
        if (v) embList.push(v);
      }
    }

    if (embList.length === 0) {
      return { ok: false, error: "At least one embedding is required (embeddings[], embedding, or emb1..emb5)." };
    }

    // ── 3) Ensure the table exists (low-level DynamoDB) ──
    const TableName = `i_${domain}`;
    const ddbLL =
      deps.dynamodbLL ||
      new deps.AWS.DynamoDB({ region: process.env.AWS_REGION || "us-east-1" });

    let createdTable = false;
    try {
      await ddbLL.describeTable({ TableName }).promise();
    } catch (err) {
      if (err && (err.code === "ResourceNotFoundException" || err.name === "ResourceNotFoundException")) {
        await ddbLL
          .createTable({
            TableName,
            BillingMode: "PAY_PER_REQUEST",
            AttributeDefinitions: [{ AttributeName: "root", AttributeType: "S" }],
            KeySchema: [{ AttributeName: "root", KeyType: "HASH" }],
          })
          .promise();
        await ddbLL.waitFor("tableExists", { TableName }).promise();
        createdTable = true;
      } else {
        return { ok: false, error: `describe/create table failed: ${err?.message || String(err)}` };
      }
    }

    // ── 4) Build the item and upsert ──
    const now = Date.now();
    const item = {
      root: subdomain,
      updatedAt: now,
      ...(body.id ? { id: String(body.id) } : {}),
      ...(body.description ? { description: String(body.description) } : {}),
    };

    for (let i = 0; i < Math.min(5, embList.length); i++) {
      item[`emb${i + 1}`] = embList[i];
    }

    try {
      await doc
        .put({
          TableName,
          Item: item,
        })
        .promise();
    } catch (err) {
      return { ok: false, error: `put failed: ${err?.message || String(err)}` };
    }

    return {
      ok: true,
      table: TableName,
      createdTable,
      root: subdomain,
      embCount: embList.length,
      item,
      note:
        "Index updated. You can now call `position` with {domain, subdomain, embedding} to compute dist1..dist5 and update `subdomains` records, and `search` to query by dist1 range.",
    };
  });

  return { name: "addIndex" };
}

module.exports = { register };
