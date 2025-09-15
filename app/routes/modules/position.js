// modules/position.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  // Keep legacy body handling parity: support both flattened req.body and legacy req.body.body
  const getLegacyBody = (req) => {
    const b = req?.body;
    if (!b || typeof b !== "object") return b;
    if (b.body && typeof b.body === "object") return b.body;
    return b;
  };

  // Cosine distance: unchanged from legacy
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
    console.log("Position 1", ctx)
    const { req, res /*, path, type, signer */ } = ctx;
    const dynamodb = getDocClient();

    console.log("Position 2")
    // Legacy: read from reqBody.body; keep identical behavior (but also works if already flattened)
    const b = getLegacyBody(req);
    console.log("b",b)
    const { description, domain, subdomain, embedding, entity, pb, output } = b.body || {};

    console.log("Position 3")
    // Legacy error shapes and codes:
    if (!embedding || !domain || !subdomain || !entity) {
      res.status(400).json({ error: "embedding, domain & subdomain required" });
      return { __handled: true };
    }

    console.log("Position 4")
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
      const data = await dynamodb.query(params).promise();
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

    console.log("Position 5")
    // 2️⃣ compare incoming embedding with emb1…emb5 (unchanged)
    const distances = {};
    for (let i = 1; i <= 5; i++) {
      const attr = `emb${i}`;
      const raw = item[attr];
      let refArr = null;

      if (typeof raw === "string") {
        try {
          refArr = JSON.parse(raw);
        } catch (e) {
          // keep legacy permissive behavior: skip malformed
          continue;
        }
      } else if (Array.isArray(raw)) {
        refArr = raw;
      }

      if (!Array.isArray(refArr) || refArr.length !== embedding.length) {
        continue;
      }
      distances[attr] = cosineDist(embedding, refArr);
    }

    console.log("Position 1")
    // 3️⃣ update subdomains with dist1…dist5, path, pb, and output (unchanged)
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
              #pb = :pb,
              #output = :output
        `,
        ExpressionAttributeNames: {
          "#d1": "dist1",
          "#d2": "dist2",
          "#d3": "dist3",
          "#d4": "dist4",
          "#d5": "dist5",
          "#path": "path",
          "#pb": "pb",
          "#output": "output",
        },
        // NOTE: preserve legacy behavior — pass values through verbatim.
        // (If pb/output are undefined, DynamoDB will error just like legacy.)
        ExpressionAttributeValues: {
          ":d1": distances.emb1 ?? null,
          ":d2": distances.emb2 ?? null,
          ":d3": distances.emb3 ?? null,
          ":d4": distances.emb4 ?? null,
          ":d5": distances.emb5 ?? null,
          ":path": `/${domain}/${subdomain}`,
          ":pb": {N:pb},
          ":output": output,
        },
        ReturnValues: "UPDATED_NEW",
      };
      await dynamodb.update(updateParams).promise();
    } catch (err) {
      console.error("Failed to update subdomains table:", err);
      res.status(502).json({ error: "failed to save distances" });
      return { __handled: true };
    }

    console.log("Position 5")
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
    console.log("response", response)
    return { ok: true, response };
  });

  return { name: "position" };
}

module.exports = { register };
