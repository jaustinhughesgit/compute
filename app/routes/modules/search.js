// modules/search.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getDocClient,
    // raw deps if ever needed
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // ────────────────────────────────────────────────────────────────────────────
  // Internal: faithful port of legacy `searchSubdomains(...)`
  // ────────────────────────────────────────────────────────────────────────────
  async function searchSubdomains({ req, res, dynamodb, embedding, domain, subdomain, entity, query, limit }) {
    console.log("searchSubdomains ----------------");
    console.log("embedding", embedding);
    console.log("domain", domain);
    console.log("subdomain", subdomain);
    console.log("entity", entity);
    console.log("query", query);
    console.log("limit", limit);
    console.log("action", "search");

    // Legacy behavior: silently return (undefined) when required pieces are falsy.
    if (!embedding || !domain || !subdomain || !entity) {
      console.log("returning early because of a falsy");
      return;
    }

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
        // Legacy: respond immediately with 404 + { error }
        res.status(404).json({ error: "no record for that sub-domain" });
        return { __handled: true };
      }
      item = data.Items[0];
    } catch (err) {
      console.error("DynamoDB query failed:", err);
      // Legacy: respond immediately with 502 + { error }
      res.status(502).json({ error: "db-unavailable" });
      return { __handled: true };
    }

    const cosineDist = (a, b) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
    };

    const distances = {};
    for (let i = 1; i <= 5; i++) {
      const attr = `emb${i}`;
      const raw = item[attr];

      let refArr = null;
      if (typeof raw === "string") {
        try { refArr = JSON.parse(raw); } catch { /* ignore parse error, keep null */ }
      } else if (Array.isArray(raw)) {
        refArr = raw;
      }

      if (Array.isArray(refArr) && refArr.length === embedding.length) {
        distances[`dist${i}`] = cosineDist(embedding, refArr);
      }
    }

    const dist1 = distances.dist1;
    if (typeof dist1 !== "number") {
      // Legacy: respond immediately with 500 + { error }
      res.status(500).json({ error: "dist1 missing from first pass" });
      return { __handled: true };
    }

    const dist1Lower = Math.max(0, dist1 - limit);
    const dist1Upper = Math.min(1, dist1 + limit);

    const fullPath = `/${domain}/${subdomain}`;
    let matches = [];
    try {
      const params = {
        TableName: "subdomains",
        IndexName: "path-index",
        ExpressionAttributeNames: { "#p": "path", "#d1": "dist1" },
        ExpressionAttributeValues: { ":path": fullPath, ":lo": dist1Lower, ":hi": dist1Upper },
        KeyConditionExpression: "#p = :path AND #d1 BETWEEN :lo AND :hi",
      };

      let last;
      do {
        const data = await dynamodb.query({ ...params, ExclusiveStartKey: last }).promise();
        matches.push(...data.Items);
        last = data.LastEvaluatedKey;
      } while (last);
    } catch (err) {
      console.error("search → DynamoDB failed:", err);
      // Legacy: respond immediately with 502 + { error }
      res.status(502).json({ error: "db-unavailable" });
      return { __handled: true };
    }

    return {
      action: "search",
      query,
      domain,
      subdomain,
      entity,
      distances,
      matches,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Action wiring
  // ────────────────────────────────────────────────────────────────────────────
  on("search", async (ctx /*, meta */) => {
    const { req, res } = ctx;
    const dynamodb = getDocClient();

    // Preserve legacy body handling (support both flattened req.body and legacy body.body)
    const rawBody = (req && req.body) || {};
    const body = rawBody && typeof rawBody === "object" && rawBody.body && typeof rawBody.body === "object"
      ? rawBody.body
      : rawBody;

    const {
      domain,
      subdomain,
      query = "",
      entity = null,
      embedding,
      limit,
    } = body || {};

    const result = await searchSubdomains({
      req,
      res,
      dynamodb,
      embedding,
      domain,
      subdomain,
      entity,
      query,
      limit,
    });

    // If the handler already wrote to res (legacy early-return), respect it.
    if (result && result.__handled) return result;

    // Legacy wrapper shape: { ok: true, response: <mainObj> }
    return { ok: true, response: result };
  });

  return { name: "search" };
}

module.exports = { register };
