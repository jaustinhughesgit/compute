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
//   type,                  // "cookies" | "url" (your existing value)
//   signer,                // CloudFront signer
//   deps: { dynamodb, s3, ses, dynamodbLL, uuidv4, AWS }
// }

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
    if (!fn) {
      throw new Error(`shared.use: "${name}" not found`);
    }
    return fn;
  };

  /* ───────────────────────────────  util: sendBack  ───────────────────────────── */
  function sendBack(res, type, val, isShorthand = false) {
    if (!isShorthand) {
      res.json(val);
    } else {
      return val;
    }
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

  async function getUUID(uuidv4) {
    const id = await uuidv4();
    return "1v4r" + id;
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
    // Minimal faithful port of your logic (short-circuits for public)
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
    if (!verified) {
      return { obj: {}, paths: {}, paths2: {}, id2Path: {}, groups: {}, verified: false };
    }

    // choose children (direct t[] or custom mapping)
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
      meta: {
        name,
        expanded: false,
        head: subH.Items?.[0]?.su || ""
      },
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

  /* ───────────────────────────── expose helpers on bus ────────────────────────── */
  expose("sendBack", sendBack);
  expose("fileLocation", fileLocation);
  expose("setIsPublic", setIsPublic);

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

  /* ─────────────────────────────── public API ─────────────────────────────────── */
  return {
    on,
    use,
    dispatch,
    expose,
    deps,     // so modules can read ctx.deps
  };
}

module.exports = { createShared };
