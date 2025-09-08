// routes/modules/search.js
/**
 * Action:
 *  - search → find similar subdomains within a distance window around dist1
 *             (path-index GSI required: partition key "path", sort "dist1")
 */
module.exports.register = ({ on /*, use */ }) => {

  const searchSubdomains = async (dynamodb, embedding, domain, subdomain, entity, query, limit) => {
    if (!embedding || !domain || !subdomain || !entity) return { ok: false, error: "missing-fields" };

    const tableName = `i_${domain}`;
    let item;
    try {
      const data = await dynamodb.query({
        TableName: tableName,
        KeyConditionExpression: "#r = :sub",
        ExpressionAttributeNames: { "#r": "root" },
        ExpressionAttributeValues: { ":sub": subdomain },
        Limit: 1
      }).promise();
      if (!data.Items?.length) return { ok: false, error: "no-record" };
      item = data.Items[0];
    } catch (err) {
      console.error("search → DynamoDB failed (i_domain):", err);
      return { ok: false, error: "db-unavailable" };
    }

    const cosine = (a, b) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
    };

    const distances = {};
    for (let i = 1; i <= 5; i++) {
      const attr = `emb${i}`;
      const raw = item[attr];
      let refArr = null;
      if (typeof raw === "string") { try { refArr = JSON.parse(raw); } catch {} }
      else if (Array.isArray(raw)) refArr = raw;
      if (Array.isArray(refArr) && refArr.length === embedding.length) {
        distances[`dist${i}`] = cosine(embedding, refArr);
      }
    }

    const dist1 = distances.dist1;
    if (typeof dist1 !== "number") return { ok: false, error: "dist1-missing" };

    const window = Math.max(0.01, Number(limit) || 0.2); // default ±0.2
    const lo = Math.max(0, dist1 - window);
    const hi = Math.min(1, dist1 + window);

    const fullPath = `/${domain}/${subdomain}`;
    const matches = [];
    try {
      const params = {
        TableName: "subdomains",
        IndexName: "path-index",
        ExpressionAttributeNames: { "#p": "path", "#d1": "dist1" },
        ExpressionAttributeValues: { ":path": fullPath, ":lo": lo, ":hi": hi },
        KeyConditionExpression: "#p = :path AND #d1 BETWEEN :lo AND :hi"
      };
      let last;
      do {
        const data = await dynamodb.query({ ...params, ExclusiveStartKey: last }).promise();
        matches.push(...(data.Items || []));
        last = data.LastEvaluatedKey;
      } while (last);
    } catch (err) {
      console.error("search → DynamoDB failed (subdomains):", err);
      return { ok: false, error: "db-unavailable" };
    }

    return { ok: true, action: "search", query, domain, subdomain, entity, distances, matches };
  };

  on("search", async (ctx) => {
    const { dynamodb } = ctx.deps;
    const { domain, subdomain, query = "", entity = null, embedding, limit } = ctx.req?.body?.body || {};
    return searchSubdomains(dynamodb, embedding, domain, subdomain, entity, query, limit);
  });
};
