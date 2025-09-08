// routes/modules/position.js
/**
 * Action:
 *  - position → compute cosine distances against i_{domain}.emb1..emb5 and
 *               store dist1..dist5 + path + pb + output on subdomains row.
 */
module.exports.register = ({ on /*, use */ }) => {
  on("position", async (ctx) => {
    const { dynamodb } = ctx.deps;
    const b = ctx.req?.body?.body || {};
    const { description, domain, subdomain, embedding, entity, pb, output } = b || {};

    if (!embedding || !domain || !subdomain || !entity) {
      return { ok: false, error: "embedding, domain, subdomain, entity required" };
    }

    /* 1) pull i_{domain} row for this subdomain */
    const tableName = `i_${domain}`;
    let item;
    try {
      const q = await dynamodb.query({
        TableName: tableName,
        KeyConditionExpression: "#r = :sub",
        ExpressionAttributeNames: { "#r": "root" },
        ExpressionAttributeValues: { ":sub": subdomain },
        Limit: 1
      }).promise();
      if (!q.Items?.length) return { ok: false, error: "no-record" };
      item = q.Items[0];
    } catch (err) {
      console.error("position → DynamoDB query failed:", err);
      return { ok: false, error: "db-unavailable" };
    }

    /* 2) cosine distance */
    const cosine = (a, b) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
    };

    /* 3) compute distances vs emb1..emb5 */
    const distances = {};
    for (let i = 1; i <= 5; i++) {
      const key = `emb${i}`;
      const raw = item[key];
      let ref = null;
      if (typeof raw === "string") { try { ref = JSON.parse(raw); } catch { ref = null; } }
      else if (Array.isArray(raw)) ref = raw;
      if (Array.isArray(ref) && ref.length === embedding.length) {
        distances[`emb${i}`] = cosine(embedding, ref);
      }
    }

    /* 4) save on subdomains row */
    try {
      await dynamodb.update({
        TableName: "subdomains",
        Key: { su: entity },
        UpdateExpression: `
          SET #d1 = :d1, #d2 = :d2, #d3 = :d3, #d4 = :d4, #d5 = :d5,
              #path = :path, #pb = :pb, #output = :output
        `,
        ExpressionAttributeNames: {
          "#d1": "dist1", "#d2": "dist2", "#d3": "dist3", "#d4": "dist4", "#d5": "dist5",
          "#path": "path", "#pb": "pb", "#output": "output"
        },
        ExpressionAttributeValues: {
          ":d1": distances.emb1 ?? null,
          ":d2": distances.emb2 ?? null,
          ":d3": distances.emb3 ?? null,
          ":d4": distances.emb4 ?? null,
          ":d5": distances.emb5 ?? null,
          ":path": `/${domain}/${subdomain}`,
          ":pb": pb,
          ":output": output
        },
        ReturnValues: "UPDATED_NEW"
      }).promise();
    } catch (err) {
      console.error("position → update subdomains failed:", err);
      return { ok: false, error: "failed-to-save" };
    }

    return {
      ok: true,
      action: "position",
      position: distances,
      domain, subdomain, entity,
      id: item?.id ?? null,
      description
    };
  });
};
