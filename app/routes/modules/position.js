// modules/position.js
"use strict";

const AWS = require("aws-sdk"); // only for types/utilities if needed (low-level is already provided via deps)

function register({ on, use }) {
  const { getDocClient, deps } = use();
  const doc = getDocClient();          // DocumentClient (JSON in/out)
  const ddb = deps.dynamodbLL;         // low-level AWS.DynamoDB (AttributeValue API)

  // Keep legacy body handling parity: support both flattened req.body and legacy req.body.body
  const getLegacyBody = (req) => {
    const b = req?.body;
    if (!b || typeof b !== "object") return b;
    if (b.body && typeof b.body === "object") return b.body;
    return b;
  };

  // Cosine distance (unchanged)
  const cosineDist = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
  };

  on("position", async (ctx, meta) => {
    console.log("Position 1", ctx);
    const { req, res /*, path, type, signer */ } = ctx;

    console.log("Position 2");
    // Legacy: read from reqBody.body; keep identical behavior (but also works if already flattened)
    const b = getLegacyBody(req);
    console.log("b", b);
    // NOTE: keep legacy shape (b.body || {}) to preserve behavior
    const { description, domain, subdomain, embedding, entity, pb, output } = b?.body || {};

    console.log("Position 3");
    // Legacy error shapes and codes:
    if (!embedding || !domain || !subdomain || !entity) {
      res.status(400).json({ error: "embedding, domain & subdomain required" });
      return { __handled: true };
    }

    console.log("Position 4");
    // 1️⃣ pull the record for that sub-domain from DynamoDB (unchanged)
    const tableName = `i_${domain}`;
    let item;
    try {
      const params = {
        TableName: tableName,
        KeyConditionExpression: "#r = :sub",
        ExpressionAttributeNames: { "#r": "root" },
        ExpressionAttributeValues: { ":sub": subdomain },
        Limit: 1,
      };
      const data = await doc.query(params).promise();
      if (!data.Items.length) {
        res.status(404).json({ error: "no record for that sub-domain" });
        return { __handled: true };
      }
      item = data.Items[0];
    } catch (err) {
      console.error("DynamoDB query failed:", err);
      res.status(502).json({ error: "db-unavailable" });
      return { __handled: true };
    }

    console.log("Position 5");
    // 2️⃣ compare incoming embedding with emb1…emb5 (unchanged)
    const distances = {};
    for (let i = 1; i <= 5; i++) {
      const attr = `emb${i}`;
      const raw = item[attr];
      let refArr = null;

      if (typeof raw === "string") {
        try {
          refArr = JSON.parse(raw);
        } catch (_e) {
          // keep legacy permissive behavior: skip malformed
          continue;
        }
      } else if (Array.isArray(raw)) {
        refArr = raw;
      }

      if (!Array.isArray(refArr) || refArr.length !== embedding.length) continue;
      distances[attr] = cosineDist(embedding, refArr);
    }

    console.log("Position 6");
    // 3️⃣ Update using DocumentClient for normal attributes (NO pb here)
    try {
      const updateParams = {
        TableName: "subdomains",
        Key: { su: entity },
        UpdateExpression: `
          SET #d1 = :d1,
              #d2 = :d2,
              #d3 = :d3,
              #d4 = :d4,
              #d5 = :d5,
              #path = :path,
              #output = :output
        `,
        ExpressionAttributeNames: {
          "#d1": "dist1",
          "#d2": "dist2",
          "#d3": "dist3",
          "#d4": "dist4",
          "#d5": "dist5",
          "#path": "path",
          "#output": "output",
        },
        ExpressionAttributeValues: {
          ":d1": distances.emb1 ?? null,
          ":d2": distances.emb2 ?? null,
          ":d3": distances.emb3 ?? null,
          ":d4": distances.emb4 ?? null,
          ":d5": distances.emb5 ?? null,
          ":path": `/${domain}/${subdomain}`,
          ":output": output,
        },
        ReturnValues: "UPDATED_NEW",
      };
      await doc.update(updateParams).promise();
    } catch (err) {
      console.error("Failed to update subdomains table (DocClient):", err);
      res.status(502).json({ error: "failed to save distances" });
      return { __handled: true };
    }

    console.log("Position 7");
    // 4️⃣ Low-level update for pb as a DynamoDB Number (N) using AttributeValue API
    try {
      if (pb == null) {
        // Keep behavior predictable: if pb is missing, skip this step silently.
        // If you want strict legacy erroring on missing pb, replace this branch with:
        // throw new Error("pb is required");
      } else {
        const pbStr = String(pb);
        // Optional minimal guard: ensure it looks like a decimal/number string
        // (DynamoDB will still validate; this just avoids obvious mistakes)
        if (!/^-?\d+(\.\d+)?$/.test(pbStr)) {
          throw new Error(`Invalid pb format: ${pbStr}`);
        }

        await ddb.updateItem({
          TableName: "subdomains",
          Key: { su: { S: String(entity) } },
          UpdateExpression: "SET #pb = :pb",
          ExpressionAttributeNames: { "#pb": "pb" },
          ExpressionAttributeValues: { ":pb": { N: pbStr } }
        }).promise();
      }
    } catch (err) {
      console.error("Failed to set pb (low-level):", err);
      res.status(502).json({ error: "failed to save pb" });
      return { __handled: true };
    }

    console.log("Position 8");
    // Legacy response shape: wrapped in { ok: true, response }
    const existing = meta?.cookie?.existing;
    const response = {
      action: "position",
      position: distances,
      domain,
      subdomain,
      entity,
      id: item.id ?? null,
      existing,
      file: "", // legacy always appended actionFile (empty for this branch)
    };
    console.log("response", response);
    return { ok: true, response };
  });

  return { name: "position" };
}

module.exports = { register };
