// routes/modules/validation.js
"use strict";

/**
 * Actions:
 *  - validation         → GET perms + validation value for an entity by sub-uuid
 *  - saveAuthenticator  → update existing access (va + permissions)
 *  - makeAuthenticator  → create new access for an entity
 *  - useAuthenticator   → attach one entity's access set to another entity
 */
module.exports.register = ({ on /*, use */ }) => {
  /* ────────────────────────── helpers ────────────────────────── */
  const getSub = async (val, key, dynamodb) => {
    let params;
    if (key === "su") {
      params = { TableName: "subdomains", KeyConditionExpression: "su = :su", ExpressionAttributeValues: { ":su": val } };
    } else if (key === "e") {
      params = { TableName: "subdomains", IndexName: "eIndex", KeyConditionExpression: "e = :e", ExpressionAttributeValues: { ":e": val } };
    } else if (key === "a") {
      params = { TableName: "subdomains", IndexName: "aIndex", KeyConditionExpression: "a = :a", ExpressionAttributeValues: { ":a": val } };
    } else if (key === "g") {
      params = { TableName: "subdomains", IndexName: "gIndex", KeyConditionExpression: "g = :g", ExpressionAttributeValues: { ":g": val } };
    }
    return dynamodb.query(params).promise();
  };

  const getEntity = async (e, dynamodb) => {
    const params = { TableName: "entities", KeyConditionExpression: "e = :e", ExpressionAttributeValues: { ":e": e } };
    return dynamodb.query(params).promise();
  };

  const incrementCounterAndGetNewValue = async (tableName, dynamodb) => {
    const response = await dynamodb.update({
      TableName: tableName,
      Key: { pk: tableName },
      UpdateExpression: "ADD #cnt :val",
      ExpressionAttributeNames: { "#cnt": "x" },
      ExpressionAttributeValues: { ":val": 1 },
      ReturnValues: "UPDATED_NEW"
    }).promise();
    return response.Attributes.x;
  };

  const addVersion = async (newE, col, val, forceC, dynamodb) => {
    try {
      const id = await incrementCounterAndGetNewValue("vCounter", dynamodb);
      let newCValue;
      let newSValue;

      const q = await dynamodb.query({
        TableName: "versions",
        IndexName: "eIndex",
        KeyConditionExpression: "e = :eValue",
        ExpressionAttributeValues: { ":eValue": newE },
        ScanIndexForward: false,
        Limit: 1
      }).promise();

      if (forceC) {
        newCValue = forceC;
        newSValue = q.Items.length ? (parseInt(q.Items[0].s) || 0) + 1 : 1;
      } else {
        newSValue = 1;
        newCValue = q.Items.length ? (parseInt(q.Items[0].c) || 0) + 1 : 1;
      }

      let prevV, prevD;
      if (q.Items.length) { prevV = q.Items[0].v; prevD = q.Items[0].d; }

      const newRecord = { v: String(id), c: String(newCValue), e: newE, s: String(newSValue), p: prevV, d: Date.now(), [col]: val };
      await dynamodb.put({ TableName: "versions", Item: newRecord }).promise();

      if (prevV && prevD) {
        await dynamodb.update({
          TableName: "versions",
          Key: { v: prevV, d: prevD },
          UpdateExpression: "set n = :newV",
          ExpressionAttributeValues: { ":newV": String(id) }
        }).promise();
      }
      return { v: String(id), c: String(newCValue) };
    } catch {
      return null;
    }
  };

  const updateEntity = async (e, col, val, v, c, dynamodb) => {
    let params;
    if (col === "t" || col === "f" || col === "l" || col === "o" || col === "ai") {
      params = {
        TableName: "entities",
        Key: { e },
        UpdateExpression: `set ${col} = list_append(if_not_exists(${col}, :empty_list), :val), v = :v, c = :c`,
        ExpressionAttributeValues: { ":val": [val], ":empty_list": [], ":v": v, ":c": c }
      };
    } else {
      params = {
        TableName: "entities",
        Key: { e },
        UpdateExpression: `set ${col} = :val, v = :v, c = :c`,
        ExpressionAttributeValues: { ":val": val, ":v": v, ":c": c }
      };
    }
    return dynamodb.update(params).promise();
  };

  const createAccess = async (ai, g, e, ex, at, to, va, ac, dynamodb) => {
    return dynamodb.put({
      TableName: "access",
      Item: { ai, g, e, ex, at, to, va, ac }
    }).promise();
  };

  const permsFromBooleans = (b = {}) => {
    let s = "";
    if (b.execute) s += "e";
    if (b.read) s += "r";
    if (b.write) s += "w";
    if (b.add) s += "a";
    if (b.delete) s += "d";
    if (b.permit) s += "p";
    if (b.own) s += "o";
    return s;
  };

  /* ────────────────────────── handlers ───────────────────────── */

  on("validation", async (ctx) => {
    const { dynamodb } = ctx.deps;
    const subUuid = (ctx.path || "").split("/")[3];
    const sub = await getSub(subUuid, "su", dynamodb);
    if (!sub.Items?.length) return { ok: false, error: "not-found" };

    const params = {
      TableName: "access",
      IndexName: "eIndex",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": String(sub.Items[0].e) }
    };
    const access = await dynamodb.query(params).promise();
    if (!access.Items?.length) {
      return { validation: {}, read: false, write: false, add: false, delete: false, permit: false, own: false };
    }

    const permission = access.Items[0].ac || "";
    const has = (ch) => permission.includes(ch);
    return {
      validation: access.Items[0].va,
      read: has("r"),
      write: has("w"),
      add: has("a"),
      delete: has("d"),
      permit: has("p"),
      own: has("o")
    };
  });

  on("saveAuthenticator", async (ctx) => {
    const { dynamodb } = ctx.deps;
    const body = ctx.req?.body?.body || {};
    const subUuid = (ctx.path || "").split("/")[3];

    const sub = await getSub(subUuid, "su", dynamodb);
    if (!sub.Items?.length) return { ok: false, error: "not-found" };

    const q = await dynamodb.query({
      TableName: "access",
      IndexName: "eIndex",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": String(sub.Items[0].e) }
    }).promise();

    if (!q.Items?.length) return { ok: false, error: "no-access" };

    const ai = q.Items[0].ai.toString();
    const ac = permsFromBooleans(body);
    await dynamodb.update({
      TableName: "access",
      Key: { ai },
      UpdateExpression: "set va = :va, ac = :ac",
      ExpressionAttributeValues: { ":va": body.value, ":ac": ac }
    }).promise();

    return { ok: true };
  });

  on("makeAuthenticator", async (ctx) => {
    const { dynamodb } = ctx.deps;
    const body = ctx.req?.body?.body || {};
    const subUuid = (ctx.path || "").split("/")[3];

    const sub = await getSub(subUuid, "su", dynamodb);
    if (!sub.Items?.length) return { ok: false, error: "not-found" };

    // ignore if payload was a raw Buffer blob
    const isBufferLike = body && typeof body === "object" && body.type === "Buffer";
    if (isBufferLike) return { ok: false, error: "buffer-not-supported" };

    const ex = body.expires;
    const at = body.attempts;
    const va = body.value;
    const to = body.timeout;
    const ac = permsFromBooleans(body);

    if (!ex || !at || !va || !to || !ac) {
      return { ok: false, error: "missing-fields" };
    }

    const ai = String(await incrementCounterAndGetNewValue("aiCounter", dynamodb));
    await createAccess(ai, String(sub.Items[0].g), String(sub.Items[0].e), ex, at, to, va, ac, dynamodb);

    // attach to entity if not the global "0"
    if (String(sub.Items[0].e) !== "0") {
      const ent = await getEntity(String(sub.Items[0].e), dynamodb);
      const changeID = ent.Items?.[0]?.c ? String(ent.Items[0].c) : "1";
      const v = await addVersion(String(sub.Items[0].e), "ai", ai, changeID, dynamodb);
      if (v) await updateEntity(String(sub.Items[0].e), "ai", ai, v.v, v.c, dynamodb);
    }

    return { ok: true, ai, ac };
  });

  on("useAuthenticator", async (ctx) => {
    const { dynamodb } = ctx.deps;
    const parts = (ctx.path || "").split("/");
    const EntitySU = parts[3];
    const AuthenticatorSU = parts[4];

    const subEntity = await getSub(EntitySU, "su", dynamodb);
    const subAuth = await getSub(AuthenticatorSU, "su", dynamodb);
    if (!subEntity.Items?.length || !subAuth.Items?.length) return { ok: false, error: "not-found" };

    const access = await dynamodb.query({
      TableName: "access",
      IndexName: "eIndex",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": String(subAuth.Items[0].e) }
    }).promise();

    if (!access.Items?.length) return { ok: false, error: "no-access" };

    const ent = await getEntity(String(subEntity.Items[0].e), dynamodb);
    const changeID = ent.Items?.[0]?.c ? String(ent.Items[0].c) : "1";

    const added = [];
    for (const ac of access.Items) {
      const v = await addVersion(String(subEntity.Items[0].e), "ai", String(ac.ai), changeID, dynamodb);
      if (v) {
        await updateEntity(String(subEntity.Items[0].e), "ai", String(ac.ai), v.v, v.c, dynamodb);
        added.push(String(ac.ai));
      }
    }

    return { ok: true, added };
  });
};
