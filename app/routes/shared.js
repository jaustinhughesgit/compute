// routes/shared.js


const moment = require("moment-timezone");

const isObject = (val) =>
  val && typeof val === "object" && !Array.isArray(val) && !Buffer.isBuffer(val);
const isCSV = (str) =>
  typeof str === "string" && (str.includes(",") || str.includes("\n"));
const parseCSV = (csv) =>
  String(csv)
    .trim()
    .split("\n")
    .map((row) => row.split(",").map((c) => c.trim()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deepEqual = (a, b) => {
  if (a === b) return true;
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return Buffer.compare(a, b) === 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "string" && typeof b === "string" && isCSV(a) && isCSV(b)) {
    return deepEqual(parseCSV(a), parseCSV(b));
  }
  if (isObject(a) && isObject(b)) {
    const k1 = Object.keys(a),
      k2 = Object.keys(b);
    if (k1.length !== k2.length) return false;
    for (const k of k1) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }

  return a == b;
};


function createShared(deps = {}) {
  const {
    dynamodb,
    dynamodbLL,
    uuidv4,
    s3,
    ses,
    AWS,
    openai,
    Anthropic,
  } = deps;

  const actions = new Map();
  const middlewares = [];
  const registry = Object.create(null);

  const on = (action, handler) => {
    if (typeof action !== "string" || !action)
      throw new TypeError("on(action, handler): action must be a string");
    if (typeof handler !== "function")
      throw new TypeError("on(action, handler): handler must be a function");
    actions.set(action, handler);
    return () => actions.delete(action);
  };

  const use = (mw) => {
    if (typeof mw !== "function") throw new TypeError("use(mw): mw must be a function");
    middlewares.push(mw);
    return () => {
      const i = middlewares.indexOf(mw);
      if (i >= 0) middlewares.splice(i, 1);
    };
  };

  const dispatch = async (action, ctx = {}, extra = {}) => {
    const handler = actions.get(action);
    if (!handler) return null;

    const res = ctx?.res || {};
    if (typeof res.headersSent !== "boolean") res.headersSent = false;

    try {
      for (const mw of middlewares) {
        if (res.headersSent) return { __handled: true };

        if (mw.length >= 3) {
          let advanced = false;
          const next = () => {
            advanced = true;
          };
          const maybe = await mw(ctx, extra, next);

          if (!advanced) {
            if (res.headersSent) return { __handled: true };
            return maybe === undefined ? { __handled: true } : maybe;
          }
        } else {
          const maybe = await mw(ctx, extra);
          if (res.headersSent) return { __handled: true };
          if (maybe && typeof maybe === "object" && maybe.__handled) return maybe;
          if (maybe !== undefined) return maybe;
        }
      }

      if (res.headersSent) return { __handled: true };

      const out = await handler(ctx, extra);
      if (res.headersSent) return { __handled: true };
      return out;
    } catch (err) {
      if (
        ctx?.res &&
        !res.headersSent &&
        typeof res.status === "function" &&
        typeof res.json === "function"
      ) {
        console.log("err", err);
        res.status(500).json({ ok: false, error: err?.message || "Internal Server Error" });
        return { __handled: true };
      }
      throw err;
    }
  };

  const expose = (name, fn) => {
    registry[name] = fn;
    return fn;
  };

  let _isPublic = true;
  const setIsPublic = (val) => {
    _isPublic = val === true || val === "true";
    return _isPublic;
  };
  const fileLocation = (val) => (val === true || val === "true" ? "public" : "private");

  const cache = {
    getSub: Object.create(null),
    getEntity: Object.create(null),
    getWord: Object.create(null),
    getGroup: Object.create(null),
    getAccess: Object.create(null),
  };

  async function getSub(val, key, ddb = dynamodb) {
    let params;
    if (key === "su") {
      params = {
        TableName: "subdomains",
        KeyConditionExpression: "su = :su",
        ExpressionAttributeValues: { ":su": val },
      };
    } else if (key === "e") {
      params = {
        TableName: "subdomains",
        IndexName: "eIndex",
        KeyConditionExpression: "e = :e",
        ExpressionAttributeValues: { ":e": val },
      };
    } else if (key === "a") {
      params = {
        TableName: "subdomains",
        IndexName: "aIndex",
        KeyConditionExpression: "a = :a",
        ExpressionAttributeValues: { ":a": val },
      };
    } else if (key === "g") {
      params = {
        TableName: "subdomains",
        IndexName: "gIndex",
        KeyConditionExpression: "g = :g",
        ExpressionAttributeValues: { ":g": val },
      };
    } else if (key === "path") {
      params = {
        TableName: "subdomains",
        IndexName: "path-index",
        KeyConditionExpression: "#p = :p",
        ExpressionAttributeNames: { "#p": "path" },
        ExpressionAttributeValues: { ":p": val },
      };
    } else {
      throw new Error(`getSub: unknown key "${key}"`);
    }
    return await ddb.query(params).promise();
  }

  async function getEntity(e, ddb = dynamodb) {
    if (cache.getEntity[e]) return cache.getEntity[e];
    const params = {
      TableName: "entities",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": e },
    };
    const res = await ddb.query(params).promise();
    cache.getEntity[e] = res;
    return res;
  }

  async function getWord(a, ddb = dynamodb) {
    if (cache.getWord[a]) return cache.getWord[a];
    const params = {
      TableName: "words",
      KeyConditionExpression: "a = :a",
      ExpressionAttributeValues: { ":a": a },
    };
    const res = await ddb.query(params).promise();
    cache.getWord[a] = res;
    return res;
  }

  async function getGroup(g, ddb = dynamodb) {
    if (cache.getGroup[g]) return cache.getGroup[g];
    const params = {
      TableName: "groups",
      KeyConditionExpression: "g = :g",
      ExpressionAttributeValues: { ":g": g },
    };
    const res = await ddb.query(params).promise();
    cache.getGroup[g] = res;
    return res;
  }

  async function getAccess(ai, ddb = dynamodb) {
    if (cache.getAccess[ai]) return cache.getAccess[ai];
    const params = {
      TableName: "access",
      KeyConditionExpression: "ai = :ai",
      ExpressionAttributeValues: { ":ai": ai },
    };
    const res = await ddb.query(params).promise();
    cache.getAccess[ai] = res;
    return res;
  }

  async function getVerified(key, val, ddb = dynamodb) {
    let params;
    if (key === "vi") {
      params = {
        TableName: "verified",
        KeyConditionExpression: "vi = :vi",
        ExpressionAttributeValues: { ":vi": val },
      };
    } else if (key === "ai") {
      params = {
        TableName: "verified",
        IndexName: "aiIndex",
        KeyConditionExpression: "ai = :ai",
        ExpressionAttributeValues: { ":ai": val },
      };
    } else if (key === "gi") {
      params = {
        TableName: "verified",
        IndexName: "giIndex",
        KeyConditionExpression: "gi = :gi",
        ExpressionAttributeValues: { ":gi": val },
      };
    } else {
      throw new Error(`getVerified: unknown key "${key}`);
    }
    return await ddb.query(params).promise();
  }

  async function getGroups(ddb = dynamodb) {
    const params = { TableName: "groups" };
    const groups = await ddb.scan(params).promise();
    const out = [];
    // parallel lookups
    const subsByG = await Promise.all(
      groups.Items.map((it) => getSub(it.g.toString(), "g", ddb))
    );
    const wordsByA = await Promise.all(
      groups.Items.map((it) => getWord(it.a.toString(), ddb))
    );
    for (let i = 0; i < groups.Items.length; i++) {
      const groupItem = groups.Items[i];
      const subByG = subsByG[i];
      const word = wordsByA[i];
      if (!word.Items.length) continue;
      const subByE = await getSub(groupItem.e.toString(), "e", ddb);
      out.push({
        groupId: subByG.Items?.[0]?.su,
        name: word.Items?.[0]?.r,
        head: subByE.Items?.[0]?.su,
      });
    }
    return out;
  }

  const makeLinkId = (wholeE, partE) => `lnk#${wholeE}#${partE}`;
  const makeCKey = (wholeE, partE) => `${wholeE}|${partE}`;

  async function putLink(wholeE, partE, propE, ddb = dynamodb) {
    const id = makeLinkId(wholeE, partE);
    const ckey = makeCKey(wholeE, partE);
    try {
      await ddb
        .put({
          TableName: "links",
          Item: {
            id,
            whole: wholeE,
            part: partE,
            ckey,
            type: "link",
            ts: Date.now(),
            ...(propE ? { prop: propE } : {}),
          },
          ConditionExpression: "attribute_not_exists(id)",
        })
        .promise();
    } catch (err) {
      if (err.code !== "ConditionalCheckFailedException") throw err;
    }
    return { id, ckey };
  }

  async function deleteLink(wholeE, partE, ddb = dynamodb) {
    const ckey = makeCKey(wholeE, partE);
    const q = await ddb
      .query({
        TableName: "links",
        IndexName: "ckeyIndex",
        KeyConditionExpression: "ckey = :ck",
        ExpressionAttributeValues: { ":ck": ckey },
        Limit: 1,
      })
      .promise();
    if (!q.Items || !q.Items.length) return false;
    await ddb.delete({ TableName: "links", Key: { id: q.Items[0].id } }).promise();
    return true;
  }

  async function getLinkedChildren(e, ddb = dynamodb) {
    const res = await ddb
      .query({
        TableName: "links",
        IndexName: "wholeIndex",
        KeyConditionExpression: "whole = :e",
        ExpressionAttributeValues: { ":e": e },
      })
      .promise();
    return (res.Items || []).map((it) => it.part);
  }

  async function getLinkedParents(e, ddb = dynamodb) {
    const res = await ddb
      .query({
        TableName: "links",
        IndexName: "partIndex",
        KeyConditionExpression: "part = :e",
        ExpressionAttributeValues: { ":e": e },
      })
      .promise();
    return (res.Items || []).map((it) => it.whole);
  }

  async function migrateLinksFromEntities(ddb = dynamodb) {
    let created = 0,
      scanned = 0,
      last;
    do {
      const batch = await ddb
        .scan({
          TableName: "entities",
          ProjectionExpression: "e, #l, #o",
          ExpressionAttributeNames: { "#l": "l", "#o": "o" },
          ExclusiveStartKey: last,
        })
        .promise();
      for (const item of batch.Items || []) {
        scanned++;
        const eThis = item.e;
        if (Array.isArray(item.l)) {
          for (const childE of item.l) {
            await putLink(eThis, childE, ddb);
            created++;
          }
        }
        if (Array.isArray(item.o)) {
          for (const parentE of item.o) {
            await putLink(parentE, eThis, ddb);
            created++;
          }
        }
      }
      last = batch.LastEvaluatedKey;
    } while (last);
    return { scanned, created };
  }

  async function incrementCounterAndGetNewValue(tableName, ddb = dynamodb) {
    const res = await ddb
      .update({
        TableName: tableName,
        Key: { pk: tableName },
        UpdateExpression: "ADD #x :one",
        ExpressionAttributeNames: { "#x": "x" },
        ExpressionAttributeValues: { ":one": 1 },
        ReturnValues: "UPDATED_NEW",
      })
      .promise();
    return res.Attributes.x;
  }

  async function wordExists(word, ddb = dynamodb) {
    const params = {
      TableName: "words",
      IndexName: "sIndex",
      KeyConditionExpression: "s = :s",
      ExpressionAttributeValues: { ":s": word.toLowerCase() },
    };
    const result = await ddb.query(params).promise();
    if (result.Items.length > 0) return { exists: true, id: result.Items[0].a };
    return { exists: false };
  }

  async function createWord(id, word, ddb = dynamodb) {
    const lower = String(word || "").toLowerCase();
    const check = await wordExists(lower, ddb);
    if (check.exists) return check.id;
    await ddb
      .put({ TableName: "words", Item: { a: id, r: word, s: lower } })
      .promise();
    return id;
  }

  async function addVersion(eNew, col, val, forceC, ddb = dynamodb) {
    try {
      const vId = await incrementCounterAndGetNewValue("vCounter", ddb);
      let newC, newS;

      const latest = await ddb
        .query({
          TableName: "versions",
          IndexName: "eIndex",
          KeyConditionExpression: "e = :e",
          ExpressionAttributeValues: { ":e": eNew },
          ScanIndexForward: false,
          Limit: 1,
        })
        .promise();

      if (forceC) {
        newC = forceC;
        newS = latest.Items.length ? (parseInt(latest.Items[0].s) || 0) + 1 : 1;
      } else {
        newS = 1;
        newC = latest.Items.length ? (parseInt(latest.Items[0].c) || 0) + 1 : 1;
      }

      let prevV, prevD;
      if (latest.Items.length) {
        prevV = latest.Items[0].v;
        prevD = latest.Items[0].d;
      }

      let newRecord;
      if (col === "t" || col === "f" || col === "l" || col === "o") {
        newRecord = {
          v: String(vId),
          c: String(newC),
          e: eNew,
          s: String(newS),
          p: prevV,
          [col]: [val],
          d: Date.now(),
        };
      } else if (col === "m") {
        const ent = await getEntity(eNew, ddb);
        const current = ent.Items?.[0]?.m || {};
        const k = Object.keys(val)[0];
        current[k] = (current[k] || []).concat(val[k]);
        newRecord = {
          v: String(vId),
          c: String(newC),
          e: eNew,
          s: String(newS),
          p: prevV,
          m: current,
          d: Date.now(),
        };
      } else {
        newRecord = {
          v: String(vId),
          c: String(newC),
          e: eNew,
          s: String(newS),
          p: prevV,
          [col]: val,
          d: Date.now(),
        };
      }

      await ddb.put({ TableName: "versions", Item: newRecord }).promise();
      if (prevV && prevD) {
        await ddb
          .update({
            TableName: "versions",
            Key: { v: prevV, d: prevD },
            UpdateExpression: "SET #n = :nv",
            ExpressionAttributeNames: { "#n": "n" },
            ExpressionAttributeValues: { ":nv": String(vId) },
          })
          .promise();
      }
      return { v: String(vId), c: String(newC) };
    } catch (err) {
      return null;
    }
  }

  async function updateEntity(e, col, val, v, c, ddb = dynamodb) {
    let params = {};
    if (col === "-t" || col === "-f") {
      const ent = await getEntity(e, ddb);
      const arr = ent.Items[0]?.[col.replace("-", "")] || [];
      const idx = arr.indexOf(val);
      if (idx < 0) return ent;
      params = {
        TableName: "entities",
        Key: { e },
        UpdateExpression: `REMOVE ${col.replace("-", "")}[${idx}]`,
        ReturnValues: "ALL_NEW",
      };
    } else if (["t", "f", "l", "o", "ai"].includes(col)) {
      params = {
        TableName: "entities",
        Key: { e },
        UpdateExpression: `SET ${col} = list_append(if_not_exists(${col}, :empty), :val), v = :v, c = :c`,
        ExpressionAttributeValues: {
          ":val": [val],
          ":empty": [],
          ":v": v,
          ":c": c,
        },
      };
    } else if (col === "m") {
      const k = Object.keys(val)[0];
      await ddb
        .update({
          TableName: "entities",
          Key: { e },
          UpdateExpression: "SET #m = if_not_exists(#m, :empty)",
          ExpressionAttributeNames: { "#m": "m" },
          ExpressionAttributeValues: { ":empty": {} },
        })
        .promise();
      await ddb
        .update({
          TableName: "entities",
          Key: { e },
          UpdateExpression: "SET #m.#k = if_not_exists(#m.#k, :emptyList)",
          ExpressionAttributeNames: { "#m": "m", "#k": k },
          ExpressionAttributeValues: { ":emptyList": [] },
        })
        .promise();
      params = {
        TableName: "entities",
        Key: { e },
        UpdateExpression:
          "SET #m.#k = list_append(#m.#k, :newVal), #v = :v, #c = :c",
        ExpressionAttributeNames: { "#m": "m", "#k": k, "#v": "v", "#c": "c" },
        ExpressionAttributeValues: { ":newVal": val[k], ":v": v, ":c": c },
      };
    } else {
      params = {
        TableName: "entities",
        Key: { e },
        UpdateExpression: `SET ${col} = :val, v = :v, c = :c`,
        ExpressionAttributeValues: { ":val": val, ":v": v, ":c": c },
      };
    }
    return await ddb.update(params).promise();
  }

  async function createGroup(gid, groupNameID, entityID, ai, ddb = dynamodb) {
    await ddb
      .put({
        TableName: "groups",
        Item: { g: gid, a: groupNameID, e: entityID, ai },
      })
      .promise();
    return gid;
  }

  async function createEntity(e, a, v, g, h, ai, ddb = dynamodb) {
    await ddb
      .put({
        TableName: "entities",
        Item: { e, a, v, g, h, ai: ai || "0" },
      })
      .promise();
    return e;
  }

  async function createSubdomain(
    su, a, e, g, z,
    maybeOutputOrDdb,
    maybeDdb
  ) {
    let output;
    let ddb = dynamodb;

    if (maybeDdb) {
      output = maybeOutputOrDdb;
      ddb = maybeDdb;
    } else if (maybeOutputOrDdb && typeof maybeOutputOrDdb.put === "function") {
      ddb = maybeOutputOrDdb;
    } else {
      output = maybeOutputOrDdb;
    }

    const item = { su, a, e, g, z };
    if (output !== undefined) item.output = output;

    await ddb.put({ TableName: "subdomains", Item: item }).promise();
    return su;
  }

  async function createCookie(ci, gi, ex, ak, e, ddb = dynamodb) {
    await ddb
      .put({
        TableName: "cookies",
        Item: { ci, gi, ex, ak, e },
      })
      .promise();
    return true;
  }

  async function getCookie(val, key, ddb = dynamodb) {
    let params;
    if (key === "ci") {
      params = {
        TableName: "cookies",
        KeyConditionExpression: "ci = :ci",
        ExpressionAttributeValues: { ":ci": val },
      };
    } else if (key === "ak") {
      params = {
        TableName: "cookies",
        IndexName: "akIndex",
        KeyConditionExpression: "ak = :ak",
        ExpressionAttributeValues: { ":ak": val },
      };
    } else if (key === "gi") {
      params = {
        TableName: "cookies",
        IndexName: "giIndex",
        KeyConditionExpression: "gi = :gi",
        ExpressionAttributeValues: { ":gi": val },
      };
    } else if (key === "e") {
      params = {
        TableName: "cookies",
        IndexName: "eIndex",
        KeyConditionExpression: "e = :e",
        ExpressionAttributeValues: { ":e": val },
      };
    } else {
      throw new Error(`getCookie: unknown key "${key}"`);
    }
    return await ddb.query(params).promise();
  }

  async function getUUID(fn = uuidv4) {
    const id = await fn();
    return "1v4r" + id;
  }

  async function manageCookie(mainObj, xAccessToken, res, ddb = dynamodb, uuid = uuidv4) {
    console.log("mainObj", mainObj);
    console.log("xAccessToken", xAccessToken);
    console.log("ddb", ddb);
    console.log("uuid", uuid);

    if (xAccessToken) {
      mainObj.status = "authenticated";
      const cookie = await getCookie(xAccessToken, "ak", ddb);
      return cookie.Items?.[0];
    } else {
      /*
        call newGroup with /newGroup/newUser/newUser
        get subdomain back
        const sub = await getSub(subdomain, "su", ddb);
        add the "e" to the createCookie using sub.Items[0].e
        make sure e is added to the cookie record in the database
      */
      const ttl = 86400;
      const ak = await getUUID(uuid);
      const ci = await incrementCounterAndGetNewValue("ciCounter", ddb);
      const gi = await incrementCounterAndGetNewValue("giCounter", ddb);
      const ex = Math.floor(Date.now() / 1000) + ttl;

      let eForCookie = "0";
      let suDocForEmail = null;

      try {
        // Call newGroup directly (bypass dispatch middleware to avoid recursion into manageCookie)
        const newGroupHandler = actions.get("newGroup");
        if (typeof newGroupHandler === "function") {
          const ctxForNewGroup = {
            path: "/newUser/newUser", // handler expects "/<name>/<head>/<uuid?>"
            req: { body: {} },
            res,
            xAccessToken: null,
          };

          // Provide a cookie with the pre-allocated gi so newGroup uses it and doesn't call manageCookie
          const ngResult = await newGroupHandler(ctxForNewGroup, { cookie: { gi: String(gi) } });

          // ngResult is { ok: true, response: mainObj }, where response.file is the entity subdomain (suDoc)
          const suDoc = ngResult?.response?.file;
          if (suDoc) {
            suDocForEmail = suDoc;
          const sub = await getSub(suDoc, "su", ddb);
          if (sub?.Items?.length) {
            // sub may correspond to the new GROUP; derive the true entity id from the group
            const gFromSub = String(sub.Items[0].g ?? "");
            if (gFromSub) {
              const group = await getGroup(gFromSub, ddb);
              const entId = group?.Items?.[0]?.e;
              if (entId) {
                eForCookie = String(entId);
              }
            }
            // Fallback: if group lookup fails, use the subdomain's e as-is
            if (eForCookie === "0" && sub.Items[0].e != null) {
              eForCookie = String(sub.Items[0].e);
            }
          }
          }
        } else {
          console.warn("manageCookie: newGroup action not registered; proceeding without e");
        }
      } catch (err) {
        console.warn("manageCookie: newGroup pre-creation failed; proceeding without e", err);
      }

      // Create the cookie, now including e
      await createCookie(String(ci), String(gi), ex, ak, eForCookie, ddb);


      // Create the user record BEFORE returning the cookie.
      // e = user id; suDoc drives the generated email <suDoc>@email.1var.com
      try {
        if (eForCookie !== "0" && suDocForEmail) {
          const createUserHandler = actions.get("createUser");
          if (typeof createUserHandler === "function") {
            await createUserHandler(
              {
                req: {
                  body: {
                    userID: eForCookie,
                    emailHash: `${suDocForEmail}@email.1var.com`,
                    pubEnc: null,
                    pubSig: null,
                    revoked: false,
                    latestKeyVersion: 1,
                  }
                }
              },
              {}
            );
          } else {
            console.warn("manageCookie: createUser action not registered; skipping user creation");
          }
        } else {
          console.warn("manageCookie: missing e or suDoc; skipping user creation");
        }
      } catch (err) {
        console.warn("manageCookie: createUser failed; continuing without blocking", err);
      }


      mainObj.accessToken = ak;

      // set browser cookie for *.1var.com
      res?.cookie?.("accessToken", ak, {
        domain: ".1var.com",
        maxAge: ttl * 1000,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      });

      return { ak, gi: String(gi), ex, ci: String(ci), e: eForCookie, existing: true };
    }
  }

  async function createAccess(ai, g, e, ex, at, to, va, ac, ddb = dynamodb) {
    await ddb
      .put({
        TableName: "access",
        Item: { ai, g, e, ex, at, to, va, ac },
      })
      .promise();
    return ai;
  }

  async function createVerified(
    vi,
    gi,
    g,
    e,
    ai,
    va,
    ex,
    bo,
    at,
    ti,
    ddb = dynamodb
  ) {
    await ddb
      .put({
        TableName: "verified",
        Item: { vi, gi, g, e, ai, va, ex, bo, at, ti },
      })
      .promise();
    return vi;
  }

  async function useAuth(fileID, Entity, access, cookie, ddb = dynamodb) {
    const ttl = 90000;
    const ex = Math.floor(Date.now() / 1000) + ttl;
    const vi = await incrementCounterAndGetNewValue("viCounter", ddb);
    await createVerified(
      String(vi),
      String(cookie.gi),
      "0",
      String(Entity.Items[0].e),
      String(access.Items[0].ai),
      "0",
      ex,
      true,
      0,
      0,
      ddb
    );
    const details = await addVersion(
      String(Entity.Items[0].e),
      "ai",
      String(access.Items[0].ai),
      String(Entity.Items[0].c || "1"),
      ddb
    );
    await updateEntity(
      String(Entity.Items[0].e),
      "ai",
      String(access.Items[0].ai),
      details.v,
      details.c,
      ddb
    );
    return true;
  }

  async function verifyThis(fileID, cookie, ddb = dynamodb, body) {
    let subBySU = await getSub(fileID, "su", ddb);
    if (!subBySU.Items?.length)
      return { verified: false, subBySU, entity: null, isPublic: false };

    setIsPublic(subBySU.Items[0].z);
    let entity = await getEntity(subBySU.Items[0].e, ddb);
    let group = await getGroup(entity.Items[0].g, ddb);
    const groupAi = group.Items[0].ai || [];
    const entityAi = entity.Items[0].ai || [];

    let verified = false;
    if (_isPublic) {
      verified = true;
    } else {
      const verif = await getVerified("gi", String(cookie.gi), ddb, body);
      verified =
        verif.Items.some((v) => groupAi.includes(v.ai) && v.bo) ||
        verif.Items.some((v) => entityAi.includes(v.ai) && v.bo);
      if (!verified) {
        const bb = isObject(body) ? (isObject(body.body) ? body.body : body) : {};
        for (const ai of entityAi) {
          const acc = await getAccess(ai, ddb);
          const ok = deepEqual(acc.Items?.[0]?.va, bb);
          if (ok) {
            await useAuth(fileID, entity, acc, cookie, ddb);
            verified = true;
            break;
          }
        }
      }
    }

    if (entity.Items[0].z && typeof entity.Items[0].z === "string") {
      const subByE = await getSub(entity.Items[0].z, "e", ddb);
      const v2 = await verifyThis(subByE.Items[0].su, cookie, ddb, body);
      verified = v2.verified;
      subBySU = v2.subBySU;
      entity = v2.entity;
      setIsPublic(v2.isPublic);
    }

    return { verified, subBySU, entity, isPublic: _isPublic };
  }

  async function createFile(su, fileData, s3cli = s3) {
    const jsonString = JSON.stringify(fileData);
    const bucket = `${fileLocation(_isPublic)}.1var.com`;
    await s3cli
      .putObject({
        Bucket: bucket,
        Key: su,
        Body: jsonString,
        ContentType: "application/json",
      })
      .promise();
    return true;
  }

  async function retrieveAndParseJSON(fileName, isPub, s3cli = s3) {
    const bucket = `${fileLocation(isPub)}.1var.com`;
    const data = await s3cli.getObject({ Bucket: bucket, Key: fileName }).promise();
    return JSON.parse(data.Body.toString("utf-8"));
  }

  async function getHead(by, value, ddb = dynamodb) {
    const sub = await getSub(value, by, ddb);
    const ent = await getEntity(sub.Items[0].e, ddb);
    const headSub = await getSub(ent.Items[0].h, "e", ddb);
    return headSub;
  }

  async function getTasks(val, col, ddb = dynamodb) {
    if (col === "e") {
      const subByE = await getSub(String(val), "e", ddb);
      const params = {
        TableName: "tasks",
        IndexName: "urlIndex",
        KeyConditionExpression: "url = :u",
        ExpressionAttributeValues: { ":u": subByE.Items?.[0]?.su },
      };
      return await ddb.query(params).promise();
    } else if (col === "su") {
      const params = {
        TableName: "tasks",
        IndexName: "urlIndex",
        KeyConditionExpression: "#url = :u",
        ExpressionAttributeNames: { "#url": "url" },
        ExpressionAttributeValues: { ":u": val },
      };
      return await ddb.query(params).promise();
    }
    throw new Error("getTasks: invalid column");
  }

  function getTasksIOS(tasks) {
    tasks = tasks.Items;
    const converted = [];
    for (let task in tasks) {
      converted.push({});
      converted[task].url = tasks[task].url;

      const momentSD = moment.unix(tasks[task].sd).utc();
      converted[task].startDate = momentSD.format("YYYY-MM-DD");

      const momentED = moment.unix(tasks[task].ed).utc();
      converted[task].endDate = momentED.format("YYYY-MM-DD");

      const momentST = moment.unix(tasks[task].sd + tasks[task].st).utc();
      converted[task].startTime = momentST.format("HH:mm");

      const momentET = moment.unix(tasks[task].sd + tasks[task].et).utc();
      converted[task].endTime = momentET.format("HH:mm");

      converted[task].monday = tasks[task].mo === 1;
      converted[task].tuesday = tasks[task].tu === 1;
      converted[task].wednesday = tasks[task].we === 1;
      converted[task].thursday = tasks[task].th === 1;
      converted[task].friday = tasks[task].fr === 1;
      converted[task].saturday = tasks[task].sa === 1;
      converted[task].sunday = tasks[task].su === 1;

      converted[task].zone = tasks[task].zo;
      converted[task].interval = tasks[task].it;
      converted[task].taskID = tasks[task].ti;
    }
    return converted;
  }

  function allVerified(list) {
    let v = true;
    for (l in list) {
      if (list[l] != true) {
        v = false;
      }
    }
    return v;
  }

  async function verifyPath(splitPath, verifications, ddb = dynamodb) {
    let verified = [];
    let verCounter = 0;
    for (ver in splitPath) {
      if (splitPath[ver].startsWith("1v4r")) {
        let verValue = false;
        verified.push(false);
        const sub = await getSub(splitPath[ver], "su", ddb);

        let groupID = sub.Items[0].g;
        let entityID = sub.Items[0].e;
        if (sub.Items[0].z) {
          verValue = true;
        }
        for (veri in verifications.Items) {
          if (entityID != "0") {
            let eSub = await getEntity(sub.Items[0].e, ddb);
            groupID = eSub.Items[0].g;
            if (eSub.Items[0].ai.toString() == "0") {
              verValue = true;
            }
          }
          if (sub.Items.length > 0) {
            if (sub.Items[0].z == true) {
              verValue = true;
            } else if (entityID == verifications.Items[veri].e && verifications.Items[veri].bo) {
              const ex = Math.floor(Date.now() / 1000);
              if (ex < verifications.Items[veri].ex) {
                verValue = true;
              }
            } else if (groupID == verifications.Items[veri].g && verifications.Items[veri].bo) {
              const ex = Math.floor(Date.now() / 1000);
              if (ex < verifications.Items[veri].ex) {
                verValue = true;
              }
            } else if (entityID == "0" && groupID == "0") {
              verValue = true;
            }
          }
        }
        verified[verCounter] = verValue;
        verCounter++;
      }
    }
    return verified;
  }

  function makeIdMaps() {
    return { convertCounter: 0 };
  }
  const state = makeIdMaps();

  async function convertToJSON(
    fileID,
    parentPath = [],
    isUsing,
    mapping,
    cookie,
    ddb = dynamodb,
    uuid = uuidv4,
    pathID,
    parentPath2 = [],
    id2Path = {},
    usingID = "",
    ddbLL = dynamodbLL,
    body,
    substitutingID = ""
  ) {
    const { verified, subBySU, entity, isPublic } = await verifyThis(
      fileID,
      cookie,
      ddb,
      body
    );
    if (!verified)
      return { obj: {}, paths: {}, paths2: {}, id2Path: {}, groups: {}, verified: false };

    let children = mapping?.[subBySU.Items[0].e] || entity.Items[0].t;
    const linked = await getLinkedChildren(entity.Items[0].e, ddb);
    const head = await getWord(entity.Items[0].a, ddb);
    const name = head.Items[0].r;
    const pathUUID = await getUUID(uuid);
    const using = Boolean(entity.Items[0].u);

    if (!id2Path) id2Path = {};
    if (!parentPath2) parentPath2 = [];
    if (!usingID) usingID = "";
    if (!substitutingID) substitutingID = "";

    id2Path[fileID] = pathUUID;

    const subH = await getSub(entity.Items[0].h, "e", ddb);
    if (subH.Count === 0) await sleep(250);

    const obj = {};
    const paths = {};
    const paths2 = {};

    obj[fileID] = {
      meta: { name, expanded: false, head: subH.Items[0].su },
      children: {},
      using,
      linked: {},
      pathid: pathUUID,
      usingID,
      substitutingID,
      location: fileLocation(isPublic),
      verified: true,
    };

    const newParentPath = isUsing ? [...parentPath] : [...parentPath, fileID];
    const newParentPath2 = isUsing ? [...parentPath2] : [...parentPath2, fileID];
    paths[fileID] = newParentPath;
    paths2[pathUUID] = newParentPath2;

    if (children && children.length > 0 && state.convertCounter < 1200) {
      state.convertCounter += children.length;
      const childRes = await Promise.all(
        children.map(async (childE) => {
          const subByE = await getSub(childE, "e", ddb);
          const uuidSu = subByE.Items[0].su;
          return await convertToJSON(
            uuidSu,
            newParentPath,
            false,
            mapping,
            cookie,
            ddb,
            uuid,
            pathUUID,
            newParentPath2,
            id2Path,
            usingID,
            ddbLL,
            body,
            substitutingID
          );
        })
      );
      for (const r of childRes) {
        Object.assign(obj[fileID].children, r.obj);
        Object.assign(paths, r.paths);
        Object.assign(paths2, r.paths2);
      }
    }

    if (using) {
      const subOfHead = await getSub(entity.Items[0].u, "e", ddb);
      const headUsingObj = await convertToJSON(
        subOfHead.Items[0].su,
        newParentPath,
        true,
        entity.Items[0].m,
        cookie,
        ddb,
        uuid,
        pathUUID,
        newParentPath2,
        id2Path,
        fileID,
        ddbLL,
        body,
        substitutingID
      );
      const headKey = Object.keys(headUsingObj.obj)[0];
      Object.assign(obj[fileID].children, headUsingObj.obj[headKey].children);
      Object.assign(paths, headUsingObj.paths);
      Object.assign(paths2, headUsingObj.paths2);
      obj[fileID].meta["usingMeta"] = {
        name: headUsingObj.obj[headKey].meta.name,
        head: headUsingObj.obj[headKey].meta.head,
        id: headKey,
        pathid: pathUUID,
      };
    }

    if (linked && linked.length > 0) {
      const linkedRes = await Promise.all(
        linked.map(async (childE) => {
          const subByE = await getSub(childE, "e", ddb);
          const uuidSu = subByE.Items[0].su;
          return await convertToJSON(
            uuidSu,
            newParentPath,
            false,
            null,
            cookie,
            ddb,
            uuid,
            pathUUID,
            newParentPath2,
            id2Path,
            usingID,
            ddbLL,
            body,
            substitutingID
          );
        })
      );
      for (const r of linkedRes) {
        Object.assign(obj[fileID].linked, r.obj);
        Object.assign(paths, r.paths);
        Object.assign(paths2, r.paths2);
      }
    }

    const groupList = await getGroups(ddb);

    return { obj, paths, paths2, id2Path, groups: groupList };
  }


  function sendBack(res, type, val, isShorthand) {
    if (val == null) val = {};
    if (isShorthand) return val;
    return res?.json?.(val);
  }


  const getDocClient = () => dynamodb;
  const getS3 = () => s3;
  const getSES = () => ses;

  return {
    // registry
    actions, registry, cache, on, use, dispatch, expose,

    // toggles
    _isPublic,
    setIsPublic,
    fileLocation,

    // utils
    isObject, isCSV, parseCSV, deepEqual, sleep, getUUID, moment,

    // data access / domain
    getSub, getEntity, getWord, getGroup, getAccess, getVerified, getGroups, getTasks, getTasksIOS,
    makeLinkId, makeCKey, putLink, deleteLink, getLinkedChildren, getLinkedParents, migrateLinksFromEntities,

    // versions/entities/groups/words
    incrementCounterAndGetNewValue, addVersion, updateEntity,
    createWord, createGroup, createEntity, createSubdomain,

    // access / cookies / verification
    createAccess, createVerified, createCookie, getCookie, manageCookie, verifyThis, useAuth,

    verifyPath, allVerified,

    // files
    createFile, retrieveAndParseJSON, convertToJSON,

    // misc
    getHead, sendBack,

    // deps exposure
    getDocClient, getS3, getSES,

    // also surface LLM/AWS if modules want them
    deps: { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  };
}

module.exports = { createShared };