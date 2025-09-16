// modules/links.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getDocClient, getS3,
    getSub, convertToJSON,
    putLink, deleteLink, migrateLinksFromEntities,
    // raw deps bag
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers (no behavior changes)
  // ───────────────────────────────────────────────────────────────────────────
  const splitPath = (p) => String(p || "").split("/").filter(Boolean);
  const legacyWrapBody = (rb) => {
    // Preserve legacy `body.body` shape while also accepting flattened `req.body`
    if (!rb || typeof rb !== "object") return rb;
    if (rb && typeof rb === "object" && rb.body && typeof rb.body === "object") return rb; // already legacy-shaped
    return { body: rb }; // wrap flattened as legacy for downstream consumers
  };

  const withStandardEnvelope = (payload, meta, actionFile = "") => {
    const cookie = meta?.cookie || {};
    const response = { ...(payload || {}) };
    response.existing = cookie.existing;
    response.file = String(actionFile || "");
    return { ok: true, response };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // createLinks  (idempotent table bootstrap)
  // ───────────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────
  // createLinks  (idempotent table bootstrap)
  // ───────────────────────────────────────────────────────────────────────────
  on("createLinks", async (ctx, meta) => {
    const { deps: ctxDeps = {} } = ctx;
    const { dynamodbLL: ddbLLFromCtx, AWS: AWSFromCtx } = ctxDeps;
    const { dynamodbLL: ddbLLFromUse, AWS: AWSFromUse } = deps || {};

    const TableName = "links";
    const ddbLL =
      ddbLLFromCtx ||
      ddbLLFromUse ||
      new (AWSFromCtx || AWSFromUse).DynamoDB({ region: "us-east-1" });

    let mainObj;
    try {
      // Does the table exist?
      let exists = false;
      let desc;
      try {
        desc = await ddbLL.describeTable({ TableName }).promise();
        exists = true;
      } catch (err) {
        if (err.code !== "ResourceNotFoundException") throw err;
      }

      if (!exists) {
        const params = {
          TableName,
          BillingMode: "PAY_PER_REQUEST",
          AttributeDefinitions: [
            { AttributeName: "id", AttributeType: "S" },
            { AttributeName: "whole", AttributeType: "S" },
            { AttributeName: "part", AttributeType: "S" },
            { AttributeName: "ckey", AttributeType: "S" },
            { AttributeName: "type", AttributeType: "S" },
            // NEW: enable fast queries by creator
            { AttributeName: "by", AttributeType: "S" },
          ],
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          GlobalSecondaryIndexes: [
            {
              IndexName: "wholeIndex",
              KeySchema: [
                { AttributeName: "whole", KeyType: "HASH" },
                { AttributeName: "type", KeyType: "RANGE" }
              ],
              Projection: { ProjectionType: "ALL" }
            },
            {
              IndexName: "partIndex",
              KeySchema: [
                { AttributeName: "part", KeyType: "HASH" },
                { AttributeName: "type", KeyType: "RANGE" }
              ],
              Projection: { ProjectionType: "ALL" }
            },
            {
              IndexName: "ckeyIndex",
              KeySchema: [{ AttributeName: "ckey", KeyType: "HASH" }],
              Projection: { ProjectionType: "ALL" }
            },
            // NEW: byIndex (creator)
            {
              IndexName: "byIndex",
              KeySchema: [
                { AttributeName: "by", KeyType: "HASH" },
                { AttributeName: "type", KeyType: "RANGE" }
              ],
              Projection: { ProjectionType: "ALL" }
            }
          ]
        };

        await ddbLL.createTable(params).promise();
        await ddbLL.waitFor("tableExists", { TableName }).promise();
        mainObj = { alert: "created", table: TableName, indexes: ["wholeIndex", "partIndex", "ckeyIndex", "byIndex"] };
      } else {
        // If table already exists, ensure byIndex exists; if not, create it.
        const indexNames = (desc.Table.GlobalSecondaryIndexes || []).map(i => i.IndexName);
        if (!indexNames.includes("byIndex")) {
          await ddbLL.updateTable({
            TableName,
            AttributeDefinitions: [
              { AttributeName: "by", AttributeType: "S" },
              { AttributeName: "type", AttributeType: "S" },
            ],
            GlobalSecondaryIndexUpdates: [{
              Create: {
                IndexName: "byIndex",
                KeySchema: [
                  { AttributeName: "by", KeyType: "HASH" },
                  { AttributeName: "type", KeyType: "RANGE" }
                ],
                Projection: { ProjectionType: "ALL" }
              }
            }]
          }).promise();

          // Optionally wait until ACTIVE
          let ready = false;
          while (!ready) {
            await new Promise(r => setTimeout(r, 1500));
            const d2 = await ddbLL.describeTable({ TableName }).promise();
            const idx = (d2.Table.GlobalSecondaryIndexes || []).find(i => i.IndexName === "byIndex");
            ready = idx && idx.IndexStatus === "ACTIVE";
          }
          mainObj = { alert: "index-added", table: TableName, added: "byIndex" };
        } else {
          mainObj = { alert: "already-exists", table: TableName, indexes: indexNames };
        }
      }
    } catch (error) {
      console.error("createLinks failed:", error);
      mainObj = { alert: "failed", error: String(error?.message || error) };
    }

    return withStandardEnvelope(mainObj, meta, "");
  });


  // ───────────────────────────────────────────────────────────────────────────
  // link  (child su -> parent su; returns updated child view)
  // Path: /:childSU/:parentSU
  // ───────────────────────────────────────────────────────────────────────────
  on("link", async (ctx, meta) => {
    const { req, path } = ctx;
    const segs = splitPath(path);
    const childID = segs[0] || "";   // su of child
    const parentID = segs[1] || "";  // su of parent
    // prop is optional 3rd segment; URL-decoded & normalized
    const propSU = segs[2] || ""; // already an SU, not a surface

    console.log("req", req);
    console.log("path", path);
    console.log("segs", segs);
    // attempt link only if both found; ignore else
    try {
      const childSub = await getSub(childID, "su");
      const parentSub = await getSub(parentID, "su");
      const propSub = propSU ? await getSub(propSU, "su") : null;

      if (childSub?.Items?.length && parentSub?.Items?.length) {
        const childE = childSub.Items[0].e;   // server entity id
        const parentE = parentSub.Items[0].e;  // server entity id
        const propE = propSub?.Items?.[0]?.e; // server entity id (optional)
        // Create the link
        const res = await putLink(parentE, childE, propE || undefined);

        // Stamp creator (from users cookie record) onto the link
        const creatorE = String(meta?.cookie?.e ?? "0");
        if (res?.id) {
          try {
            await getDocClient()
              .update({
                TableName: "links",
                Key: { id: res.id },
                // preserve original creator if already set
                UpdateExpression: "SET #by = if_not_exists(#by, :by)",
                ExpressionAttributeNames: { "#by": "by" },
                ExpressionAttributeValues: { ":by": creatorE },
              })
              .promise();
          } catch (updErr) {
            console.warn("link: failed to set creator on link", updErr);
          }
        }
      }
    } catch (err) {
      // keep behavior: don't throw; proceed to return current child view
      console.error("link action failed (continuing to return child view):", err);
    }

    // return updated child view (strict parity)
    const rb = legacyWrapBody(req?.body);
    const d = ctx.deps || {};
    const mainObj = await convertToJSON(
      childID,
      [],                 // parentPath
      null,               // isUsing
      null,               // mapping
      meta?.cookie || {}, // cookie
      d.dynamodb,         // dynamodb
      d.uuidv4,           // uuidv4
      null,               // pathID
      [],                 // parentPath2
      {},                 // id2Path
      "",                 // usingID
      d.dynamodbLL,       // dynamodbLL
      rb                  // body (supports both flattened and legacy)
    );

    return withStandardEnvelope(mainObj, meta, childID);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // unlink  (remove parent→child link; returns updated child view)
  // Path: /:childSU/:parentSU
  // ───────────────────────────────────────────────────────────────────────────
  on("unlink", async (ctx, meta) => {
    const { req, path } = ctx;
    const segs = splitPath(path);
    const childID = segs[0] || "";   // su of child
    const parentID = segs[1] || "";  // su of parent

    try {
      const childSub = await getSub(childID, "su");
      const parentSub = await getSub(parentID, "su");
      if (childSub?.Items?.length && parentSub?.Items?.length) {
        const childE = childSub.Items[0].e;
        const parentE = parentSub.Items[0].e;
        await deleteLink(parentE, childE);
      }
    } catch (err) {
      console.error("unlink action failed (continuing to return child view):", err);
    }

    const rb = legacyWrapBody(req?.body);
    const d = ctx.deps || {};
    const mainObj = await convertToJSON(
      childID,
      [],
      null,
      null,
      meta?.cookie || {},
      d.dynamodb,
      d.uuidv4,
      null,
      [],
      {},
      "",
      d.dynamodbLL,
      rb
    );

    return withStandardEnvelope(mainObj, meta, childID);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // migrateLinks  (one-time migration from entities .l/.o → links table)
  // ───────────────────────────────────────────────────────────────────────────
  on("migrateLinks", async (ctx, meta) => {
    let mainObj;
    try {
      const stats = await migrateLinksFromEntities();
      mainObj = { alert: "ok", migrated: stats.created, scanned: stats.scanned, table: "links" };
    } catch (err) {
      console.error("migrateLinks failed:", err);
      mainObj = { alert: "failed", error: String(err?.message || err) };
    }
    return withStandardEnvelope(mainObj, meta, "");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // export
  // Download all entities + links created by a specific creator 'e'.
  //
  // New behavior:
  //   - The first path segment is treated as a **primary su**, not a raw 'by'.
  //   - We resolve su → e with getSub(su, "su") and export for that 'e'.
  //
  // Supported call styles (priority order):
  //   1) Body override:          POST /export            with body { by: "<e>" }
  //   2) Primary su in path:     POST /export/:primarySu  (server resolves su → e)
  //   3) Cookie fallback:        POST /export            (uses cookie.e)
  //
  // Response: { response: { entities:[{name,su}], links:[{subj,prop,obj}] } }
  // ───────────────────────────────────────────────────────────────────────────
  on("export", async (ctx, meta) => {
    console.log("exprt ----------------------")
    console.log("exprt ----------------------")
    console.log("exprt ----------------------")
    console.log("exprt ----------------------")
    console.log("exprt ----------------------")
    console.log("exprt ----------------------")
    const doc = getDocClient();
    const segs = splitPath(ctx.path || "");
    const rb = legacyWrapBody(ctx?.req?.body) || {};
    const body = rb?.body || {};
    console.log("doc", doc)
    console.log("segs", segs)
    console.log("rb", rb)
    console.log("body", body)

    // Resolve creator 'e' with new precedence:
    // 1) explicit body.by (raw 'e')
    // 2) path seg treated as **primary su** → look up 'e' via getSub(su, "su")
    // 3) cookie.e fallback
    let byE = String(body.by || "").trim();
    console.log("1")
    if (!byE) {
      console.log("2", byE)
      const primarySu = String(segs[0] || "").trim();
      if (primarySu) {
        console.log("3", primarySu)
        try {
          console.log("4")
          const sub = await getSub(primarySu, "su"); // su -> e
          console.log("5")
          byE = String(sub?.Items?.[0]?.e || "").trim();
          console.log("6", byE)
        } catch { /* ignore; we'll fall back below */ }
      }
    }
    if (!byE) byE = String(meta?.cookie?.e || "").trim();
    console.log("7", byE)
    if (!byE) {
      console.log("8")
      return withStandardEnvelope({ entities: [], links: [], note: "no-by" }, meta, "");
    }

    // Page through byIndex to get all links stamped by this creator
    const items = [];
    let ExclusiveStartKey = undefined;
    do {
      console.log("9")
      const res = await doc.query({
        TableName: "links",
        IndexName: "byIndex",
        KeyConditionExpression: "#by = :by",
        ExpressionAttributeNames: { "#by": "by" },
        ExpressionAttributeValues: { ":by": byE },
        ExclusiveStartKey,
      }).promise();
      console.log("10", res)
      items.push(...(res.Items || []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    // Gather unique entity-ids referenced by those links (parent/subj, child/obj, prop)
    const eSet = new Set();
    const get = (obj, ...keys) => keys.reduce((v, k) => (v ??= obj?.[k]), undefined);

    console.log("11")
    for (const it of items) {
      // tolerate several field spellings
      const parentE = get(it, "whole") ?? get(it, "parent") ?? get(it, "parentE");
      const childE = get(it, "part") ?? get(it, "child") ?? get(it, "childE");
      const propE = get(it, "propE") ?? get(it, "prop") ?? undefined;
      console.log("12", parentE)
      console.log("13", childE)
      console.log("14", propE)
      if (parentE) eSet.add(String(parentE));
      if (childE) eSet.add(String(childE));
      if (propE) eSet.add(String(propE));
    }

    // Resolve each entity 'e' to (su, name). We accept several name fields.
    const eToNameSu = new Map();
    for (const e of eSet) {
      console.log("e", e)
      try {
        const sub = await getSub(String(e), "e"); // lookup by server entity id
        const rec = sub?.Items?.[0] || {};
        const su = String(rec.su || rec.id || rec.subdomain || "").trim();
        const name = String(
        rec.output 
        ).toLowerCase();
        console.log("sub", sub)
        console.log("rec", rec)
        console.log("su", su)
        console.log("name", name)
        if (su) {
          console.log("15")
          eToNameSu.set(String(e), { name, su });
        }
      } catch (err) {
        // best-effort; skip missing
      }
    }

    // Build normalized link triples (subj --prop--> obj)
    const links = [];
    console.log("items", items)
    for (const it of items) {
      console.log("it", it)
      const subjE = get(it, "whole") ?? get(it, "parent") ?? get(it, "parentE");
      const objE = get(it, "part") ?? get(it, "child") ?? get(it, "childE");
      const propE = get(it, "propE") ?? get(it, "prop") ?? undefined;
      const subj = eToNameSu.get(String(subjE))?.name || "";
      const obj = eToNameSu.get(String(objE))?.name || "";
      const prop = propE ? (eToNameSu.get(String(propE))?.name || "related_to") : "related_to";
      if (subj && obj) links.push({ subj, prop, obj });
    }
    console.log("eToNameSu", eToNameSu)
    // Unique list of entities referenced in the link set
    const entities = Array.from(eToNameSu.values());

    // Return a compact export payload
    return withStandardEnvelope({ entities, links }, meta, "");
  });


  return { name: "links" };
}

module.exports = { register };
