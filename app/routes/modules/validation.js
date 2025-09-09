// modules/validation.js
"use strict";

function register({ on, use }) {
  const {
    // domain/data helpers from shared (reuse, don’t duplicate)
    getSub,
    getEntity,
    addVersion,
    updateEntity,
    incrementCounterAndGetNewValue,
    createAccess,
    convertToJSON,

    // service getters / deps
    getDocClient,
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // helper: legacy body flattening (supports flattened req.body and legacy req.body.body)
  const getPayload = (req) => {
    const b = req?.body;
    if (b && typeof b === "object" && b.body && typeof b.body === "object") return b.body;
    return (b && typeof b === "object") ? b : {};
  };

  // helper: build permissions string from booleans (order preserved: e r w a d p o)
  const permsFromBooleans = (b = {}) => {
    let s = "";
    if (b.execute) s += "e";
    if (b.read)    s += "r";
    if (b.write)   s += "w";
    if (b.add)     s += "a";
    if (b.delete)  s += "d";
    if (b.permit)  s += "p";
    if (b.own)     s += "o";
    return s;
  };

  // ──────────────────────────────────────────────────────────────────────────
  // validation → GET perms + validation value for an entity by sub-uuid
  // legacy response shape: { ok: true, response: { validation, read, write, add, delete, permit, own } }
  // ──────────────────────────────────────────────────────────────────────────
  on("validation", async (ctx /*, meta */) => {
    const ddb = getDocClient();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const subUuid = segs[0];

    const sub = await getSub(subUuid, "su");
    if (!sub?.Items?.length) {
      // legacy returned empty-ish object on misses; wrap in { ok: true, response } to match outer shape
      return {
        ok: true,
        response: { validation: {}, read: false, write: false, add: false, delete: false, permit: false, own: false },
      };
    }

    const params = {
      TableName: "access",
      IndexName: "eIndex",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": String(sub.Items[0].e) },
    };
    const access = await ddb.query(params).promise();
    if (!access?.Items?.length) {
      return {
        ok: true,
        response: { validation: {}, read: false, write: false, add: false, delete: false, permit: false, own: false },
      };
    }

    const permission = String(access.Items[0].ac || "");
    const has = (ch) => permission.includes(ch);
    return {
      ok: true,
      response: {
        validation: access.Items[0].va,
        read:  has("r"),
        write: has("w"),
        add:   has("a"),
        delete:has("d"),
        permit:has("p"),
        own:   has("o"),
      },
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // saveAuthenticator → update existing access (va + permissions)
  // legacy response shape: { ok: true, response: { alert: "success" } }
  // ──────────────────────────────────────────────────────────────────────────
  on("saveAuthenticator", async (ctx /*, meta */) => {
    const ddb = getDocClient();
    const body = getPayload(ctx.req);
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const subUuid = segs[0];

    const sub = await getSub(subUuid, "su");
    if (!sub?.Items?.length) return { ok: true, response: { alert: "not-found" } };

    const q = await ddb.query({
      TableName: "access",
      IndexName: "eIndex",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": String(sub.Items[0].e) },
    }).promise();

    if (!q?.Items?.length) return { ok: true, response: { alert: "no-access" } };

    const ai = String(q.Items[0].ai);
    const ac = permsFromBooleans(body);

    await ddb.update({
      TableName: "access",
      Key: { ai },
      UpdateExpression: "set va = :va, ac = :ac",
      ExpressionAttributeValues: { ":va": body.value, ":ac": ac },
    }).promise();

    return { ok: true, response: { alert: "success" } };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // makeAuthenticator → create new access for an entity
  // legacy behavior:
  //  - ignore Buffer-like payloads
  //  - require ex/at/va/to/ac, then create access + attach to entity via version/update
  //  - response returned was the converted tree for the same sub (convertToJSON)
  //    wrapped as { ok: true, response: <tree> }
  // ──────────────────────────────────────────────────────────────────────────
  on("makeAuthenticator", async (ctx, meta) => {
    const ddb  = getDocClient();
    const { dynamodbLL, uuidv4 } = deps || {};
    const body = getPayload(ctx.req);
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const subUuid = segs[0];

    const sub = await getSub(subUuid, "su");
    if (!sub?.Items?.length) return { ok: true, response: { alert: "not-found" } };

    // Ignore if payload was a raw Buffer blob (legacy check)
    const isBufferLike = body && typeof body === "object" && body.type === "Buffer";
    if (isBufferLike) return { ok: true, response: { alert: "buffer-not-supported" } };

    const ex = body.expires;
    const at = body.attempts;
    const va = body.value;
    const to = body.timeout;
    const ac = permsFromBooleans(body);
    if (!ex || !at || !va || !to || !ac) {
      return { ok: true, response: { alert: "missing-fields" } };
    }

    const ai = String(await incrementCounterAndGetNewValue("aiCounter"));
    await createAccess(ai, String(sub.Items[0].g), String(sub.Items[0].e), ex, at, to, va, ac);

    if (String(sub.Items[0].e) !== "0") {
      const ent = await getEntity(String(sub.Items[0].e));
      const changeID = ent?.Items?.[0]?.c ? String(ent.Items[0].c) : "1";
      const ver = await addVersion(String(sub.Items[0].e), "ai", ai, changeID);
      if (ver) await updateEntity(String(sub.Items[0].e), "ai", ai, ver.v, ver.c);
    }

    // parity: return convertToJSON tree for this sub
    const tree = await convertToJSON(
      subUuid,
      [],              // parentPath
      null,            // isUsing
      null,            // mapping
      meta?.cookie || {},
      ddb,             // ddb
      uuidv4,          // uuid
      undefined,       // pathID
      [],              // parentPath2
      {},              // id2Path
      "",              // usingID
      dynamodbLL,      // ddbLL
      ctx.req?.body    // body (for deepEqual validation path)
    );

    return { ok: true, response: tree };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // useAuthenticator → attach one entity's access set to another entity
  // legacy response shape: { ok: true, response: { alert: "success" } }
  // (legacy loop attached all access.ai from the authenticator entity)
  // ──────────────────────────────────────────────────────────────────────────
  on("useAuthenticator", async (ctx /*, meta */) => {
    const ddb = getDocClient();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const entitySU       = segs[0];
    const authenticatorSU= segs[1];

    const subEntity = await getSub(entitySU, "su");
    const subAuth   = await getSub(authenticatorSU, "su");
    if (!subEntity?.Items?.length || !subAuth?.Items?.length) {
      return { ok: true, response: { alert: "not-found" } };
    }

    const access = await ddb.query({
      TableName: "access",
      IndexName: "eIndex",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": String(subAuth.Items[0].e) },
    }).promise();

    if (!access?.Items?.length) return { ok: true, response: { alert: "no-access" } };

    const ent = await getEntity(String(subEntity.Items[0].e));
    const changeID = ent?.Items?.[0]?.c ? String(ent.Items[0].c) : "1";

    for (const ac of access.Items) {
      const v = await addVersion(String(subEntity.Items[0].e), "ai", String(ac.ai), changeID);
      if (v) await updateEntity(String(subEntity.Items[0].e), "ai", String(ac.ai), v.v, v.c);
    }

    return { ok: true, response: { alert: "success" } };
  });

  return { name: "validation" };
}

module.exports = { register };
