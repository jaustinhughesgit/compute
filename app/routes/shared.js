// routes/shared.js
//
// Shared registry + cross-functional helpers.
// - Create the bus with createShared({ dynamodb, dynamodbLL, s3, ses, uuidv4, AWS })
// - Pass { on, use } into each /modules/*.js → module.register({ on, use })
// - In your controller (cookies.js), call shared.dispatch(action, ctx) to run.
//
// ctx shape expected by modules:
// {
//   req, res,
//   path,                  // e.g. "/cookies/file/1v4r..."
//   type,                  // "cookies" | "url"
//   signer,                // CloudFront signer
//   deps: { dynamodb, s3, ses, dynamodbLL, uuidv4, AWS }
// }

"use strict";

function createShared(deps = {}) {
  /* ─────────────────────────────────  tiny bus  ───────────────────────────────── */
  const actions = new Map();
  const registry = Object.create(null);

  const on = (action, handler) => {
    if (actions.has(action)) {
      throw new Error(`shared.on: action "${action}" already registered`);
    }
    actions.set(action, handler);
  };

  const dispatch = async (action, ctx, payload) => {
    const h = actions.get(action);
    if (!h) return null;
    // Handlers return either a value or { __handled: true }
    return await h(ctx, payload);
  };

  const expose = (name, fn) => {
    if (registry[name]) {
      throw new Error(`shared.expose: "${name}" already exists`);
    }
    registry[name] = fn;
  };

  const use = (name) => {
    const fn = registry[name];
    if (!fn) throw new Error(`shared.use: "${name}" not found`);
    return fn;
  };

  /* ───────────────────────────────  util: sendBack  ───────────────────────────── */
  function sendBack(res, type, val, isShorthand = false) {
    if (!isShorthand) res.json(val);
    else return val;
  }

  /* ─────────────────────────────  hot path caches  ────────────────────────────── */
  const cache = {
    getSub: Object.create(null),
    getEntity: Object.create(null),
    getWord: Object.create(null),
    getGroup: Object.create(null),
    getAccess: Object.create(null),
    getVerified: Object.create(null),
  };

  /* ───────────────────────────── Dynamo helpers (v2) ──────────────────────────── */
  async function getSub(val, key, dynamodb) {
    const ck = `${key}:${val}`;
    if (cache.getSub[ck]) return cache.getSub[ck];
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
    const out = await dynamodb.query(params).promise();
    cache.getSub[ck] = out;
    return out;
  }

  async function getEntity(e, dynamodb) {
    if (cache.getEntity[e]) return cache.getEntity[e];
    const params = { TableName: "entities", KeyConditionExpression: "e = :e", ExpressionAttributeValues: { ":e": e } };
    const out = await dynamodb.query(params).promise();
    cache.getEntity[e] = out;
    return out;
  }

  async function getWord(a, dynamodb) {
    if (cache.getWord[a]) return cache.getWord[a];
    const params = { TableName: "words", KeyConditionExpression: "a = :a", ExpressionAttributeValues: { ":a": a } };
    const out = await dynamodb.query(params).promise();
    cache.getWord[a] = out;
    return out;
  }

  async function getGroup(g, dynamodb) {
    if (cache.getGroup[g]) return cache.getGroup[g];
    const params = { TableName: "groups", KeyConditionExpression: "g = :g", ExpressionAttributeValues: { ":g": g } };
    const out = await dynamodb.query(params).promise();
    cache.getGroup[g] = out;
    return out;
  }

  async function getAccess(ai, dynamodb) {
    if (cache.getAccess[ai]) return cache.getAccess[ai];
    const params = { TableName: "access", KeyConditionExpression: "ai = :ai", ExpressionAttributeValues: { ":ai": ai } };
    const out = await dynamodb.query(params).promise();
    cache.getAccess[ai] = out;
    return out;
  }

  async function getVerified(key, val, dynamodb) {
    let params;
    if (key === "vi") {
      params = { TableName: "verified", KeyConditionExpression: "vi = :vi", ExpressionAttributeValues: { ":vi": val } };
    } else if (key === "ai") {
      params = { TableName: "verified", IndexName: "aiIndex", KeyConditionExpression: "ai = :ai", ExpressionAttributeValues: { ":ai": val } };
    } else if (key === "gi") {
      params = { TableName: "verified", IndexName: "giIndex", KeyConditionExpression: "gi = :gi", ExpressionAttributeValues: { ":gi": val } };
    }
    return await dynamodb.query(params).promise();
  }

  /* ───────────────────────────────  links helpers  ────────────────────────────── */
  function makeLinkId(wholeE, partE) {
    return `lnk#${wholeE}#${partE}`;
  }
  function makeCKey(wholeE, partE) {
    return `${wholeE}|${partE}`;
  }
  async function putLink(wholeE, partE, dynamodb) {
    const id = makeLinkId(wholeE, partE);
    const ckey = makeCKey(wholeE, partE);
    try {
      await dynamodb.put({
        TableName: "links",
        Item: { id, whole: wholeE, part: partE, ckey, type: "link", ts: Date.now() },
        ConditionExpression: "attribute_not_exists(id)"
      }).promise();
    } catch (err) {
      if (err.code !== "ConditionalCheckFailedException") throw err;
    }
    return { id, ckey };
  }
  async function deleteLink(wholeE, partE, dynamodb) {
    const ckey = makeCKey(wholeE, partE);
    const q = await dynamodb.query({
      TableName: "links",
      IndexName: "ckeyIndex",
      KeyConditionExpression: "ckey = :ck",
      ExpressionAttributeValues: { ":ck": ckey },
      Limit: 1
    }).promise();
    if (!q.Items?.length) return false;
    await dynamodb.delete({ TableName: "links", Key: { id: q.Items[0].id } }).promise();
    return true;
  }
  async function getLinkedChildren(e, dynamodb) {
    const res = await dynamodb.query({
      TableName: "links",
      IndexName: "wholeIndex",
      KeyConditionExpression: "whole = :e",
      ExpressionAttributeValues: { ":e": e }
    }).promise();
    return (res.Items || []).map(it => it.part);
  }
  async function getLinkedParents(e, dynamodb) {
    const res = await dynamodb.query({
      TableName: "links",
      IndexName: "partIndex",
      KeyConditionExpression: "part = :e",
      ExpressionAttributeValues: { ":e": e }
    }).promise();
    return (res.Items || []).map(it => it.whole);
  }

  /* ───────────────────────────────  groups helper  ────────────────────────────── */
  async function getGroups(dynamodb) {
    const params = { TableName: "groups" };
    const groups = await dynamodb.scan(params).promise();
    const groupObjs = [];
    const subPromises = [];
    const wordPromises = [];
    for (const group of groups.Items || []) {
      subPromises.push(getSub(group.g.toString(), "g", dynamodb));
      wordPromises.push(getWord(group.a.toString(), dynamodb));
    }
    const subResults = await Promise.all(subPromises);
    const wordResults = await Promise.all(wordPromises);
    for (let i = 0; i < (groups.Items || []).length; i++) {
      const groupItem = groups.Items[i];
      const subByG = subResults[i];
      const groupName = wordResults[i];
      if (groupName.Items.length > 0) {
        const subByE = await getSub(groupItem.e.toString(), "e", dynamodb);
        groupObjs.push({
          groupId: subByG.Items[0].su,
          name: groupName.Items[0].r,
          head: subByE.Items[0].su
        });
      }
    }
    return groupObjs;
  }

  /* ─────────────────────────────── misc tiny utils ───────────────────────────── */
  function fileLocation(val) {
    return (val === true || val === "true") ? "public" : "private";
  }

  let _isPublic = true;
  function setIsPublic(val) {
    _isPublic = (val === true || val === "true");
    return _isPublic;
  }

  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v);
  const isCSV = (str) => typeof str === "string" && (str.includes(",") || str.includes("\n"));
  const parseCSV = (csv) => csv.trim().split("\n").map(r => r.split(",").map(c => c.trim()));

  const deepEqual = (a, b) => {
    if (a === b) return true;
    if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return Buffer.compare(a, b) === 0;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((x, i) => deepEqual(x, b[i]));
    }
    if (typeof a === "string" && typeof b === "string" && isCSV(a) && isCSV(b)) {
      return deepEqual(parseCSV(a), parseCSV(b));
    }
    if (isObject(a) && isObject(b)) {
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every(k => deepEqual(a[k], b[k]));
    }
    return a === b;
  };

  // Robust UUID helper: uses param → deps.uuidv4 → crypto.randomUUID → polyfill
  async function getUUID(uuidv4Param) {
    let gen = uuidv4Param || deps.uuidv4;
    let raw;
    if (typeof gen === "function") {
      raw = await gen(); // works for sync or async
    } else {
      try {
        const { randomUUID } = require("crypto");
        if (typeof randomUUID === "function") {
          raw = randomUUID();
        }
      } catch (_) { /* ignore */ }
      if (!raw) {
        // simple v4-ish fallback
        raw = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          const v = c === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
    }
    return "1v4r" + raw;
  }

  /* ─────────────────────────────── tasks helpers ──────────────────────────────── */
  async function getTasks(val, col, dynamodb) {
    if (col === "su") {
      const params = {
        TableName: "tasks",
        IndexName: "urlIndex",
        KeyConditionExpression: "#url = :url",
        ExpressionAttributeNames: { "#url": "url" },
        ExpressionAttributeValues: { ":url": val }
      };
      return await dynamodb.query(params).promise();
    } else if (col === "e") {
      // legacy branch: by entity → resolve subdomain first
      const subByE = await getSub(val, "e", dynamodb);
      const params = {
        TableName: "tasks",
        IndexName: "urlIndex",
        KeyConditionExpression: "url = :url",
        ExpressionAttributeValues: { ":url": subByE.Items[0].su }
      };
      return await dynamodb.query(params).promise();
    }
    return { Items: [] };
  }

  const moment = require("moment-timezone");
  async function getTasksIOS(tasks) {
    tasks = tasks.Items || [];
    const out = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const o = {};
      o.url = t.url;

      const momentSD = moment.unix(t.sd).utc();
      o.startDate = momentSD.format("YYYY-MM-DD");

      const momentED = moment.unix(t.ed).utc();
      o.endDate = momentED.format("YYYY-MM-DD");

      const momentST = moment.unix(t.sd + t.st).utc();
      o.startTime = momentST.format("HH:mm");

      const momentET = moment.unix(t.sd + t.et).utc();
      o.endTime = momentET.format("HH:mm");

      o.monday    = t.mo === 1;
      o.tuesday   = t.tu === 1;
      o.wednesday = t.we === 1;
      o.thursday  = t.th === 1;
      o.friday    = t.fr === 1;
      o.saturday  = t.sa === 1;
      o.sunday    = t.su === 1;

      o.zone     = t.zo;
      o.interval = t.it;
      o.taskID   = t.ti;
      out.push(o);
    }
    return out;
  }

  /* ─────────────────────────────── verification ──────────────────────────────── */
  async function verifyThis(fileID, cookie, dynamodb, body) {
    let subBySU = await getSub(fileID, "su", dynamodb);
    if (!subBySU.Items?.length) return { verified: false, subBySU, entity: { Items: [] }, isPublic: false };

    let isPublicVal = setIsPublic(subBySU.Items[0].z);
    let entity = await getEntity(subBySU.Items[0].e, dynamodb);

    if (isPublicVal) return { verified: true, subBySU, entity, isPublic: true };

    // Private: check verified records for this gi over group/entity ai
    const group = await getGroup(entity.Items[0].g, dynamodb);
    const groupAi = group.Items?.[0]?.ai || [];
    const entityAi = entity.Items?.[0]?.ai || [];

    const verify = await getVerified("gi", String(cookie.gi), dynamodb);
    let verified = false;

    if (verify.Items?.length) {
      // group membership w/ bo true and not expired
      verified = verify.Items.some(v => groupAi.includes(v.ai) && v.bo);
      if (!verified) {
        verified = verify.Items.some(v => entityAi.includes(v.ai) && v.bo);
      }
    }

    // fallback: value-based match against access.va
    if (!verified && entityAi.length) {
      const payloadBody = body?.body ? body.body : (body || {});
      for (const ai of entityAi) {
        const access = await getAccess(ai, dynamodb);
        if (access.Items?.[0]?.va && deepEqual(access.Items[0].va, payloadBody)) {
          verified = true;
          break;
        }
      }
    }

    return { verified, subBySU, entity, isPublic: isPublicVal };
  }

  /* ─────────────────────────────── convertToJSON  ────────────────────────────── */
  async function convertToJSON(
    fileID,
    parentPath = [],
    isUsing,
    mapping,
    cookie,
    dynamodb,
    uuidv4Fn,
    pathID,
    parentPath2 = [],
    id2Path = {},
    usingID = "",
    dynamodbLL,
    body,
    substitutingID = ""
  ) {
    const { verified, subBySU, entity, isPublic } = await verifyThis(fileID, cookie, dynamodb, body);
    if (!verified) return { obj: {}, paths: {}, paths2: {}, id2Path: {}, groups: {}, verified: false };

    const children = (mapping && mapping[subBySU.Items[0].e]) || entity.Items[0].t || [];
    const headWord = await getWord(entity.Items[0].a, dynamodb);
    const name = headWord.Items?.[0]?.r || "";

    const pathUUID = await getUUID(uuidv4Fn);
    id2Path = id2Path || {};
    parentPath2 = parentPath2 || [];
    usingID = usingID || "";
    substitutingID = substitutingID || "";

    id2Path[fileID] = pathUUID;

    const subH = await getSub(entity.Items[0].h, "e", dynamodb);

    const obj = {};
    const paths = {};
    const paths2 = {};

    obj[fileID] = {
      meta: { name, expanded: false, head: subH.Items?.[0]?.su || "" },
      children: {},
      linked: {},
      using: Boolean(entity.Items[0].u),
      pathid: pathUUID,
      usingID,
      substitutingID,
      location: fileLocation(isPublic),
      verified: true
    };

    const newParentPath  = isUsing ? [...parentPath]  : [...parentPath, fileID];
    const newParentPath2 = isUsing ? [...parentPath2] : [...parentPath2, fileID];
    paths[fileID] = newParentPath;
    paths2[pathUUID] = newParentPath2;

    // recurse children
    if (children && children.length) {
      const childPromises = children.map(async (childE) => {
        const subByE = await getSub(childE, "e", dynamodb);
        const uuid = subByE.Items?.[0]?.su;
        if (!uuid) return { obj: {}, paths: {}, paths2: {} };
        return await convertToJSON(
          uuid, newParentPath, false, mapping, cookie,
          dynamodb, uuidv4Fn, pathUUID, newParentPath2, id2Path, usingID,
          dynamodbLL, body, substitutingID
        );
      });
      const responses = await Promise.all(childPromises);
      for (const r of responses) {
        Object.assign(obj[fileID].children, r.obj);
        Object.assign(paths, r.paths);
        Object.assign(paths2, r.paths2);
      }
    }

    // using (u) head expansion
    if (entity.Items[0].u) {
      usingID = fileID;
      const subOfHead = await getSub(entity.Items[0].u, "e", dynamodb);
      if (subOfHead.Items?.[0]?.su) {
        const headUsingObj = await convertToJSON(
          subOfHead.Items[0].su, newParentPath, true, entity.Items[0].m,
          cookie, dynamodb, uuidv4Fn, pathUUID, newParentPath2, id2Path, usingID,
          dynamodbLL, body
        );
        const headKey = Object.keys(headUsingObj.obj)[0];
        if (headKey) {
          Object.assign(obj[fileID].children, headUsingObj.obj[headKey]?.children || {});
          Object.assign(paths, headUsingObj.paths);
          Object.assign(paths2, headUsingObj.paths2);
          obj[fileID].meta.usingMeta = {
            name: headUsingObj.obj[headKey].meta.name,
            head: headUsingObj.obj[headKey].meta.head,
            id: headKey,
            pathid: pathUUID
          };
        }
      }
    }

    // linked children (links table)
    const linked = await getLinkedChildren(entity.Items[0].e, dynamodb);
    if (linked?.length) {
      const linkPromises = linked.map(async (childE) => {
        const subByE = await getSub(childE, "e", dynamodb);
        const uuid = subByE.Items?.[0]?.su;
        if (!uuid) return { obj: {}, paths: {}, paths2: {} };
        return await convertToJSON(
          uuid, newParentPath, false, null, cookie,
          dynamodb, uuidv4Fn, pathUUID, newParentPath2, id2Path, usingID,
          dynamodbLL, body, substitutingID
        );
      });
      const linkResponses = await Promise.all(linkPromises);
      for (const r of linkResponses) {
        Object.assign(obj[fileID].linked, r.obj);
        Object.assign(paths, r.paths);
        Object.assign(paths2, r.paths2);
      }
    }

    const groupList = await getGroups(dynamodb);
    return { obj, paths, paths2, id2Path, groups: groupList, verified: true };
  }

  /* ─────────────────────────────── counters helper ───────────────────────────── */
  async function incrementCounterAndGetNewValue(tableName, dynamodb) {
    const response = await dynamodb.update({
      TableName: tableName,
      Key: { pk: tableName },
      UpdateExpression: "ADD #cnt :val",
      ExpressionAttributeNames: { "#cnt": "x" },
      ExpressionAttributeValues: { ":val": 1 },
      ReturnValues: "UPDATED_NEW"
    }).promise();
    return response.Attributes.x;
  }

  /* ─────────────────────────────── create/update helpers ─────────────────────── */
  async function createWord(a, r, dynamodb) {
    const item = { a: String(a), r: String(r), ts: Date.now() };
    await dynamodb.put({
      TableName: "words",
      Item: item,
      ConditionExpression: "attribute_not_exists(a)"
    }).promise();
    return a;
  }

  async function createGroup(g, a, e, aiArr, dynamodb) {
    const item = {
      g: String(g), a: String(a), e: String(e),
      ai: (aiArr || []).map(String),
      ts: Date.now()
    };
    await dynamodb.put({
      TableName: "groups",
      Item: item,
      ConditionExpression: "attribute_not_exists(g)"
    }).promise();
    return g;
  }

  // New(er) access shape (duration grant, rate/limit, value auth, perms)
  async function createAccess(ai, g, e, durGrant, limit, durRate, va, perms, dynamodb) {
    const item = {
      ai: String(ai),
      g:  String(g),
      e:  String(e),
      dg: durGrant || null,     // {count, metric}
      rl: limit ?? null,        // numeric rate/limit
      dr: durRate || null,      // {count, metric}
      va: va || {},             // value-based access payload
      perms: perms || "rwado",
      ts: Date.now()
    };
    await dynamodb.put({
      TableName: "access",
      Item: item,
      ConditionExpression: "attribute_not_exists(ai)"
    }).promise();
    return ai;
  }

  async function createVerified(vi, gi, g, e, ai, bo, ex, ok, zx, zy, dynamodb) {
    const item = {
      vi: String(vi),
      gi: String(gi),
      g:  String(g),
      e:  String(e),
      ai: String(ai),
      bo: Boolean(bo),
      ex: Number(ex),           // unix seconds
      ok: Boolean(ok),
      zx: Number(zx) || 0,
      zy: Number(zy) || 0,
      ts: Date.now()
    };
    await dynamodb.put({
      TableName: "verified",
      Item: item,
      ConditionExpression: "attribute_not_exists(vi)"
    }).promise();
    return vi;
  }

  async function createSubdomain(su, a, e, g, isPublic, dynamodb) {
    const item = {
      su: String(su),
      a:  String(a),
      e:  String(e),
      g:  String(g),
      z:  Boolean(isPublic),  // public flag
      ts: Date.now()
    };
    await dynamodb.put({
      TableName: "subdomains",
      Item: item,
      ConditionExpression: "attribute_not_exists(su)"
    }).promise();
    return su;
  }

  async function addVersion(e, code, a, current, dynamodb) {
    // returns { v, c } as modules expect
    const c = Date.now();
    const v = `v${c}`;
    await dynamodb.put({
      TableName: "versions",
      Item: {
        id: `${e}#${v}`,
        e: String(e),
        v: String(v),
        a: String(a),
        code: String(code),
        c
      },
      ConditionExpression: "attribute_not_exists(id)"
    }).promise();
    return { v, c };
  }

  async function updateEntity(e, code, value, v, c, dynamodb) {
    // Set 'u' or 'z' field depending on code, plus version metadata.
    let attr = "x";
    if (code === "u") attr = "u";
    else if (code === "z") attr = "z";

    await dynamodb.update({
      TableName: "entities",
      Key: { e: String(e) },
      UpdateExpression: "SET #attr = :val, #v = :v, #c = :c",
      ExpressionAttributeNames: { "#attr": attr, "#v": "v", "#c": "c" },
      ExpressionAttributeValues: { ":val": value, ":v": v, ":c": c }
    }).promise();

    return true;
  }

  async function createEntity(e, a, v, g, h, aiArr, dynamodb) {
    const item = {
      e: String(e),
      a: String(a),
      v: String(v),
      g: String(g),
      h: String(h),                 // head entity id
      ai: (aiArr || []).map(String),
      t: [],                        // children
      ts: Date.now()
    };
    await dynamodb.put({
      TableName: "entities",
      Item: item,
      ConditionExpression: "attribute_not_exists(e)"
    }).promise();
    return e;
  }

  async function createFile(su, payload, s3) {
    const Bucket = process.env.FILES_BUCKET || process.env.PUBLIC_BUCKET || process.env.BUCKET || "1var-files";
    const Key = `${su}.json`;
    const Body = Buffer.from(JSON.stringify(payload));
    await s3.putObject({ Bucket, Key, Body, ContentType: "application/json", ACL: "private" }).promise();
    return { bucket: Bucket, key: Key };
  }

  async function email(from, to, subject, text, html, ses) {
    const params = {
      Source: from,
      Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: text ? { Data: text, Charset: "UTF-8" } : undefined,
          Html: html ? { Data: html, Charset: "UTF-8" } : undefined
        }
      }
    };
    return await ses.sendEmail(params).promise();
  }

  /* ─────────────────────────────── cookies (legacy helpers) ──────────────────── */
  async function createCookie(ci, gi, ex, ak, dynamodb) {
    await dynamodb.put({
      TableName: "cookies",
      Item: { ci: String(ci), gi: String(gi), ex: Number(ex), ak: String(ak) }
    }).promise();
    return { ci, gi, ex, ak };
  }
  async function getCookie(val, key, dynamodb) {
    let params;
    if (key === "ci") {
      params = { TableName: "cookies", KeyConditionExpression: "ci = :ci", ExpressionAttributeValues: { ":ci": String(val) } };
    } else if (key === "ak") {
      params = { TableName: "cookies", IndexName: "akIndex", KeyConditionExpression: "ak = :ak", ExpressionAttributeValues: { ":ak": String(val) } };
    } else if (key === "gi") {
      params = { TableName: "cookies", IndexName: "giIndex", KeyConditionExpression: "gi = :gi", ExpressionAttributeValues: { ":gi": String(val) } };
    } else {
      throw new Error("getCookie: invalid key");
    }
    return await dynamodb.query(params).promise();
  }
  async function manageCookie(mainObj, xAccessToken, res, dynamodb, uuidv4) {
    let existing = false;
    if (xAccessToken) {
      mainObj.status = "authenticated";
      existing = true;
      const cookie = await getCookie(xAccessToken, "ak", dynamodb);
      return cookie.Items?.[0];
    } else {
      const ak = await getUUID(uuidv4);
      const ci = await incrementCounterAndGetNewValue("ciCounter", dynamodb);
      const gi = await incrementCounterAndGetNewValue("giCounter", dynamodb);
      const ttlSeconds = 86400;
      const ex = Math.floor(Date.now() / 1000) + ttlSeconds;
      await createCookie(ci.toString(), gi.toString(), ex, ak, dynamodb);
      mainObj.accessToken = ak;
      existing = true;
      if (res && typeof res.cookie === "function") {
        res.cookie("accessToken", ak, {
          domain: ".1var.com",
          maxAge: ttlSeconds * 1000,
          httpOnly: true,
          secure: true,
          sameSite: "None"
        });
      }
      return { ak, gi, ex, ci, existing };
    }
  }

  // Best-effort "getHead": given a subdomain or entity, find the head subdomain
  async function getHead(val, dynamodb) {
    // If val looks like a subdomain id, start there; else assume entity id
    let sub = await getSub(val, "su", dynamodb);
    if (!sub.Items?.length) {
      const subByE = await getSub(val, "e", dynamodb);
      sub = subByE;
    }
    if (!sub.Items?.length) return null;
    const ent = await getEntity(sub.Items[0].e, dynamodb);
    if (!ent.Items?.length) return null;
    const headSu = await getSub(ent.Items[0].h, "e", dynamodb);
    return headSu.Items?.[0]?.su || null;
  }

  /* ───────────────────────────── expose helpers on bus ────────────────────────── */
  expose("sendBack", sendBack);
  expose("fileLocation", fileLocation);
  expose("setIsPublic", setIsPublic);

  // read/query helpers (modules may pass dynamodb themselves)
  expose("getSub", getSub);
  expose("getEntity", getEntity);
  expose("getWord", getWord);
  expose("getGroup", getGroup);
  expose("getAccess", getAccess);
  expose("getVerified", getVerified);

  expose("getLinkedChildren", getLinkedChildren);
  expose("getLinkedParents", getLinkedParents);
  expose("putLink", putLink);
  expose("deleteLink", deleteLink);

  expose("getGroups", getGroups);
  expose("deepEqual", deepEqual);
  expose("isObject", isObject);
  expose("isCSV", isCSV);
  expose("parseCSV", parseCSV);
  expose("getUUID", getUUID);

  expose("getTasks", getTasks);
  expose("getTasksIOS", getTasksIOS);

  expose("verifyThis", verifyThis);
  expose("convertToJSON", convertToJSON);

  // ── write helpers: lazily read deps at call-time (avoid stale capture) ──
  function getDocClient() {
    const d = deps?.dynamodb;
    if (!d || typeof d.put !== "function") {
      throw new Error("shared: deps.dynamodb must be an AWS.DynamoDB.DocumentClient (missing .put).");
    }
    return d;
  }
  function getS3() {
    const c = deps?.s3;
    if (!c || typeof c.putObject !== "function") {
      throw new Error("shared: deps.s3 must be an S3 client (missing .putObject).");
    }
    return c;
  }
  function getSES() {
    const c = deps?.ses;
    if (!c || typeof c.sendEmail !== "function") {
      throw new Error("shared: deps.ses must be an SES client (missing .sendEmail).");
    }
    return c;
  }

  // counters
  expose("incrementCounterAndGetNewValue", (table) => incrementCounterAndGetNewValue(table, getDocClient()));
  expose("incrementCounter",               (table) => incrementCounterAndGetNewValue(table, getDocClient())); // alias
  expose("nextCounterValue",               (table) => incrementCounterAndGetNewValue(table, getDocClient())); // alias

  // create/update
  expose("createWord",      (a, r)                       => createWord(a, r, getDocClient()));
  expose("createGroup",     (g, a, e, aiArr)             => createGroup(g, a, e, aiArr, getDocClient()));
  expose("createAccess",    (ai, g, e, dg, rl, dr, va, perms) =>
                                              createAccess(ai, g, e, dg, rl, dr, va, perms, getDocClient()));
  expose("createVerified",  (vi, gi, g, e, ai, bo, ex, ok, zx, zy) =>
                                              createVerified(vi, gi, g, e, ai, bo, ex, ok, zx, zy, getDocClient()));
  expose("createSubdomain", (su, a, e, g, isPublic)      => createSubdomain(su, a, e, g, isPublic, getDocClient()));

  expose("addVersion",      (e, code, a, current)        => addVersion(e, code, a, current, getDocClient()));
  expose("updateEntity",    (e, code, value, v, c)       => updateEntity(e, code, value, v, c, getDocClient()));
  expose("createEntity",    (e, a, v, g, h, aiArr)       => createEntity(e, a, v, g, h, aiArr, getDocClient()));

  // storage + email
  expose("createFile", (su, payload) => createFile(su, payload, getS3()));
  expose("email",      (from, to, subject, text, html) => email(from, to, subject, text, html, getSES()));

  // legacy binds expected by cookies.js
  expose("createCookie", (ci, gi, ex, ak) => createCookie(ci, gi, ex, ak, getDocClient()));
  expose("getCookie",    (val, key)       => getCookie(val, key, getDocClient()));
  expose("manageCookie", (mainObj, xAccessToken, res, dynamodb, uuidv4) =>
    manageCookie(mainObj, xAccessToken, res, dynamodb || getDocClient(), uuidv4 || deps.uuidv4)
  );
  expose("getHead", (val) => getHead(val, getDocClient()));

  /* ─────────────────────────────── public API ─────────────────────────────────── */
  return { on, use, dispatch, expose, deps };
}

module.exports = { createShared };
