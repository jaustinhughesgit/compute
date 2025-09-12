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
      let exists = false;
      try {
        await ddbLL.describeTable({ TableName }).promise();
        exists = true;
      } catch (err) {
        if (err.code !== "ResourceNotFoundException") throw err;
      }

      if (!exists) {
        const params = {
          TableName,
          BillingMode: "PAY_PER_REQUEST",
          AttributeDefinitions: [
            { AttributeName: "id",     AttributeType: "S" },
            { AttributeName: "whole",  AttributeType: "S" },
            { AttributeName: "part",   AttributeType: "S" },
            { AttributeName: "ckey",   AttributeType: "S" },
            { AttributeName: "type",   AttributeType: "S" },
          ],
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          GlobalSecondaryIndexes: [
            {
              IndexName: "wholeIndex",
              KeySchema: [
                { AttributeName: "whole", KeyType: "HASH" },
                { AttributeName: "type",  KeyType: "RANGE" }
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
            }
          ]
        };

        await ddbLL.createTable(params).promise();
        await ddbLL.waitFor("tableExists", { TableName }).promise();

        mainObj = { alert: "created", table: TableName };
      } else {
        mainObj = { alert: "already-exists", table: TableName };
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
    const propRaw = segs[2] ? decodeURIComponent(segs[2]) : "";
    const propNorm = String(propRaw || "").trim().toLowerCase();

    // attempt link only if both found; ignore else
    try {
      const childSub  = await getSub(childID,  "su");
      const parentSub = await getSub(parentID, "su");

      if (childSub?.Items?.length && parentSub?.Items?.length) {
        const childE  = childSub.Items[0].e;
        const parentE = parentSub.Items[0].e;
        await putLink(parentE, childE, propNorm || undefined);
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
      const childSub  = await getSub(childID,  "su");
      const parentSub = await getSub(parentID, "su");
      if (childSub?.Items?.length && parentSub?.Items?.length) {
        const childE  = childSub.Items[0].e;
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

  return { name: "links" };
}

module.exports = { register };
