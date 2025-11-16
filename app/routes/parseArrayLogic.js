// parseArrayLogic.js
/* ------------------------------------------------------------------ */
/* Anchor-only parseArrayLogic (drop-in)                              */
/* ------------------------------------------------------------------ */

const anchorsUtil = require('./anchors');
// kept for signature parity
const { DynamoDB } = require('aws-sdk');

const ANCHOR_BANDS_TABLE    = process.env.ANCHOR_BANDS_TABLE    || 'anchor_bands';
const PERM_GRANTS_TABLE     = process.env.PERMS_GRANTS_TABLE    || process.env.PERM_GRANTS_TABLE || 'perm_grants';
const DEFAULT_POLICY_PREFIX = process.env.POLICY_PREFIX         || 'entity';

/* ------------------------- tiny helpers --------------------------- */

const createArrayOfRootKeys = (schema) => {
  if (!schema || typeof schema !== "object") return [];
  const { properties } = schema;
  return properties && typeof properties === "object" ? Object.keys(properties) : [];
};

const safeClone = (x) => JSON.parse(JSON.stringify(x));

const _normalizeVec = (v) => {
  if (!Array.isArray(v) || v.length === 0) return null;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = 1 / (Math.sqrt(s) + 1e-12);
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
};

async function _embedUnit({ openai, text }) {
  const { data: [{ embedding }] } = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text
  });
  return _normalizeVec(embedding);
}

async function _computeAnchorPayload({ s3, openai, text }) {
  try {
    const t = String(text || '').trim();
    if (!t) return null;

    const anchors = await anchorsUtil.loadAnchors({ s3 });
    const eU = await _embedUnit({ openai, text: t });
    const topL0 = Number(process.env.ANCHORS_TOP_L0 || 2);
    const assigns = anchorsUtil.assign(eU, anchors, { topL0 });

    return {
      setId: anchors.setId,
      band_scale: anchors.band_scale,
      num_shards: anchors.num_shards,
      assigns: assigns.map(a => ({
        l0: a.l0, l1: a.l1, band: a.band, dist_q16: a.dist_q16
      }))
    };
  } catch (err) {
    console.error('anchor assign failed:', err && err.message);
    return null;
  }
}

// batch writer (kept for completeness; not used on new entities pre-SU)
async function _putAllBatched(dynamodb, table, items) {
  if (!items || !items.length) return 0;
  let written = 0;
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25).map(Item => ({ PutRequest: { Item } }));
    const params = { RequestItems: { [table]: chunk } };
    let backoff = 100;
    while (true) {
      const rsp = await dynamodb.batchWrite(params).promise();
      const un = rsp.UnprocessedItems?.[table] || [];
      written += chunk.length - un.length;
      if (!un.length) break;
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 2000);
      params.RequestItems[table] = un;
    }
  }
  return written;
}

async function _fanoutAnchorBands({ dynamodb, su, setId, anchor, type = 'su', policy_id }) {
  // Only with a real SU (no ref strings, no placeholders)
  if (!su || /^__\$ref\(/.test(String(su))) return 0;
  const assigns = anchor?.assigns || [];
  if (!setId || !assigns.length) return 0;
  const rows = assigns.map(a => ({
    ...anchorsUtil.makePosting({ setId, su, assign: a, type, shards: anchorsUtil.DEFAULT_NUM_SHARDS }),
    ...(policy_id ? { policy_id } : {})
  }));
  return _putAllBatched(dynamodb, ANCHOR_BANDS_TABLE, rows);
}

async function _ensureOwnerGrant({ dynamodb, su, e, perms = "rwdop" }) {
  try {
    if (!su || !e) return;
    const now = Math.floor(Date.now() / 1000);
    await dynamodb.put({
      TableName: PERM_GRANTS_TABLE,
      Item: { entityID: String(su), principalID: `u:${e}`, perms, created: now }
    }).promise();
  } catch (err) {
    console.warn("perm_grants owner seed failed:", err && err.message);
  }
}

/* ----------------------- de-dupe helper ---------------------------- */
/** Try to reuse an existing entity by (output name, creator e). */
async function _findExistingEntityByName({ dynamodb, name, e }) {
  if (!name) return null;

  // 1) Try a likely GSI if present (best-effort)
  const indexNames = ['output-index', 'by_output', 'outputIndex'];
  for (const IndexName of indexNames) {
    try {
      const q = await dynamodb.query({
        TableName: 'subdomains',
        IndexName,
        KeyConditionExpression: '#out = :name',
        ExpressionAttributeNames: { '#out': 'output' },
        ExpressionAttributeValues: { ':name': name }
      }).promise();
      const items = q.Items || [];
      if (!items.length) continue;
      if (e != null) {
        const hit = items.find(it => String(it.e) === String(e));
        if (hit?.su) return String(hit.su);
      }
      return String(items[0].su || '');
    } catch (_ignore) { /* index might not exist */ }
  }

  // 2) Fallback scan (safe; not ideal for huge tables)
  try {
    let ExclusiveStartKey;
    do {
      const res = await dynamodb.scan({
        TableName: 'subdomains',
        ProjectionExpression: '#su, #e, #out',
        FilterExpression: '#out = :name' + (e != null ? ' AND #e = :e' : ''),
        ExpressionAttributeNames: { '#su': 'su', '#e': 'e', '#out': 'output' },
        ExpressionAttributeValues: Object.assign({ ':name': name }, (e != null ? { ':e': e } : {})),
        ExclusiveStartKey
      }).promise();
      const items = res.Items || [];
      if (items.length) return String(items[0].su);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  } catch (err) {
    console.warn('dedupe scan failed:', err && err.message);
  }
  return null;
}

/* ----------------------- arrayLogic utilities ---------------------- */

const REF_REGEX = /^__\$ref\((\d+)\)(.*)$/;

function resolveArrayLogic(arrayLogic) {
  const cache = new Array(arrayLogic.length);
  const resolving = new Set();

  const deepResolve = (val) => {
    if (typeof val === "string") {
      const m = val.match(REF_REGEX);
      if (m) {
        const [, idxStr, restPath] = m;
        const target = resolveElement(Number(idxStr));
        if (!restPath) return target;
        const segs = restPath.replace(/^\./, "").split(".");
        let out = target;
        for (const s of segs) { if (out == null) break; out = out[s]; }
        return deepResolve(out);
      }
    }
    if (Array.isArray(val)) return val.map(deepResolve);
    if (val && typeof val === "object")
      return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, deepResolve(v)]));
    return val;
  };

  const resolveElement = (i) => {
    if (cache[i] !== undefined) return cache[i];
    if (resolving.has(i)) throw new Error(`Circular __$ref at index ${i}`);
    resolving.add(i);
    cache[i] = deepResolve(arrayLogic[i]);
    resolving.delete(i);
    return cache[i];
  };

  return arrayLogic.map((_, i) => resolveElement(i));
}

const OP_ONLY = /^__\$(?:ref)?\((\d+)\)$/;
const padRef = (n_) => String(n_).padStart(3, "0") + "!!";
const OFFSET = 1;

const convertShorthandRefs = (v) => {
  if (typeof v === "string") {
    const m = v.match(OP_ONLY);
    if (m) return padRef(Number(m[1]) + OFFSET);
    return v;
  }
  if (Array.isArray(v)) return v.map(convertShorthandRefs);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, convertShorthandRefs(val)]));
  return v;
};

const isOperationElem = (obj) =>
  obj && typeof obj === "object" && !Array.isArray(obj) &&
  Object.keys(obj).length === 1 &&
  (() => { const v = obj[Object.keys(obj)[0]]; return v && v.input && v.schema; })();

const isSchemaElem = (obj) =>
  obj && typeof obj === "object" && !Array.isArray(obj) && "properties" in obj;

/* ------------------------ prompt → arrayLogic ---------------------- */

const buildLogicSchema = {
  name: "build_logic",
  description: "Create a structured modules/actions JSON payload for the logic runner.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["modules", "actions"],
    properties: {
      modules: {
        type: "object",
        description: "Map from local alias → npm-package name.",
        additionalProperties: { type: "string" }
      },
      actions: { $ref: "#/$defs/actionList" }
    },
    $defs: {
      jsonVal: {
        oneOf: [
          { type: "string" }, { type: "number" }, { type: "boolean" },
          { type: "object" }, { type: "array", items: {} }
        ]
      },
      decorators: {
        type: "object",
        properties: {
          if: { $ref: "#/$defs/conditionArray" },
          while: { $ref: "#/$defs/conditionArray" },
          timeout: { type: "integer", minimum: 0 },
          next: { type: "boolean" },
          promise: { enum: ["raw", "await"] }
        },
        additionalProperties: false
      },
      chainItem: {
        type: "object",
        required: ["access"],
        additionalProperties: false,
        properties: {
          access: { type: "string" },
          params: { type: "array", items: { $ref: "#/$defs/jsonVal" } },
          new: { type: "boolean" },
          express: { type: "boolean" },
          next: { type: "boolean" },
          return: { $ref: "#/$defs/jsonVal" }
        }
      },
      chainArray: { type: "array", items: { $ref: "#/$defs/chainItem" } },
      conditionTuple: {
        type: "array", minItems: 3, maxItems: 3,
        prefixItems: [
          { type: "string" },
          { enum: ["==","!=", "<",">","<=",">=","===","!==","in","includes"] },
          { $ref: "#/$defs/jsonVal" }
        ]
      },
      conditionArray: { type: "array", items: { $ref: "#/$defs/conditionTuple" } },
      actionList: { type: "array", items: { $ref: "#/$defs/actionObject" } },
      actionObject: {
        type: "object",
        allOf: [
          { $ref: "#/$defs/decorators" },
          {
            additionalProperties: false,
            oneOf: [
              { required: ["set"], properties: { set: { type: "object" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["target","chain"], properties: { target: { type: "string" }, chain: { $ref: "#/$defs/chainArray" }, assign: { type: "string" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["if","set"], properties: { if: { $ref: "#/$defs/conditionArray" }, set: { type: "object" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["while","nestedActions"], properties: { while: { $ref: "#/$defs/conditionArray" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["assign","params","nestedActions"], properties: { assign: { type: "string" }, params: { type: "array", items: { type: "string" } }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["return"], properties: { return: { $ref: "#/$defs/jsonVal" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { title: "else", required: ["else"], properties: { else: { $ref: "#/$defs/actionObject" } } }
            ]
          }
        ]
      }
    }
  }
};

const buildBreadcrumbApp = async ({ openai, str }) => {
  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-2024-08-06",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a JSON-only assistant. Reply with a single valid JSON object and nothing else." },
      { role: "user", content: str }
    ],
    functions: [buildLogicSchema],
    function_call: { name: "build_logic" }
  });

  const fc = rsp.choices[0].message.function_call;
  fc.arguments = fc.arguments.replaceAll(/\{\|req=>body(?!\.body)/g, '{|req=>body.body');
  const args = JSON.parse(fc.arguments);
  return args;
};

async function buildArrayLogicFromPrompt({ openai, prompt }) {
  const rsp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    top_p: 0,
    seed: 42,
    messages: [
      { role: "system", content: "You are a JSON-only assistant. Reply with ONLY a valid JSON array (arrayLogic). No prose." },
      { role: "user", content: prompt }
    ]
  });
  let text = rsp.choices[0].message.content.trim();

  function stripComments(jsonLike) {
    let out = '', inString = false, quote = '', escaped = false, inSL = false, inML = false;
    for (let i = 0; i < jsonLike.length; i++) {
      const c = jsonLike[i], n = jsonLike[i + 1];
      if (inSL) { if (c === '\n' || c === '\r') { inSL = false; out += c; } continue; }
      if (inML) { if (c === '*' && n === '/') { inML = false; i++; } continue; }
      if (inString) { out += c; if (!escaped && c === quote) { inString = false; quote = ''; } escaped = !escaped && c === '\\'; continue; }
      if (c === '"' || c === "'") { inString = true; quote = c; out += c; continue; }
      if (c === '/' && n === '/') { inSL = true; i++; continue; }
      if (c === '/' && n === '*') { inML = true; i++; continue; }
      out += c;
    }
    return out;
  }

  text = stripComments(text);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Model response did not contain a JSON array.");
  return JSON.parse(text.slice(start, end + 1));
}

/* ------------------------------- main -------------------------------- */

async function parseArrayLogic({
  arrayLogic = [],
  dynamodb,    // DocumentClient
  uuidv4,
  s3,
  ses,
  openai,
  Anthropic,
  dynamodbLL,  // signature parity
  sourceType,
  actionFile,
  out,
  e,
  requestOnly = false
} = {}) {

  if (sourceType === "prompt") {
    if (typeof arrayLogic !== "string") {
      throw new TypeError("When sourceType === 'prompt', arrayLogic must be a string.");
    }
    arrayLogic = await buildArrayLogicFromPrompt({ openai, prompt: arrayLogic });
  }

  const resolvedLogic = resolveArrayLogic(arrayLogic);

  const shorthand = [];
  const results = [];
  const createdEntities = [];
  const policyFor = su => `${DEFAULT_POLICY_PREFIX}:${String(su)}`;

  let lastRouteIdx = -1;
  let lastCreatedSu = null;

  for (let i = 0; i < arrayLogic.length; i++) {
    const origElem = arrayLogic[i];

    // Skip user-provided conclusion; we’ll wire our own.
    if (i === arrayLogic.length - 1 && origElem && typeof origElem === 'object' && 'conclusion' in origElem) {
      continue;
    }

    const elem = resolvedLogic[i];

    // passthrough non-ops
    if (!isOperationElem(origElem)) {
      if (isSchemaElem(origElem)) {
        shorthand.push(createArrayOfRootKeys(elem));
      } else if (origElem && typeof origElem === 'object') {
        shorthand.push([elem]);
      } else {
        shorthand.push([elem]);
      }
      continue;
    }

    // op
    const breadcrumb = Object.keys(elem)[0];
    const body = elem[breadcrumb] || {};
    const inputParam = body.input;
    const expectedKeys = createArrayOfRootKeys(body.schema || {});
    const schemaParam = expectedKeys;

    const b = body || {};
    const inp = b?.input && typeof b.input === 'object' ? b.input : {};
    let userReqText = typeof out === 'string' && out.trim() ? out.trim() : null;
    if (!userReqText) {
      const candidate =
        inp.user_requests ?? inp.user_request ?? inp.request ?? inp.query ?? inp.q ?? inp.word ?? inp.words ?? null;
      if (Array.isArray(candidate)) userReqText = candidate.map(String).join(' ').trim();
      else if (typeof candidate === 'string') userReqText = candidate.trim();
    }
    const textForAnchors = requestOnly
      ? (userReqText || b?.input?.name || b?.input?.title || JSON.stringify(elem))
      : (b?.input?.name || b?.input?.title || (typeof out === 'string' && out) || JSON.stringify(elem));

    const anchorPayload = await _computeAnchorPayload({ s3, openai, text: textForAnchors });

    // If we have a concrete workspace, reuse it (no new entity).
    if (actionFile) {
      const positionBodyAF = {
        description: "provided entity (fallback)",
        entity: actionFile,
        path: breadcrumb,
        output: b.output || out || "",
        ...(anchorPayload ? { anchor: anchorPayload } : {})
      };

      // safe: we have a real SU
      if (positionBodyAF.anchor) {
        await _fanoutAnchorBands({
          dynamodb,
          su: actionFile,
          setId: positionBodyAF.anchor.setId,
          anchor: positionBodyAF.anchor,
          type: 'su',
          policy_id: policyFor(actionFile)
        });
      }

      await _ensureOwnerGrant({ dynamodb, su: actionFile, e });

      shorthand.push(["ROUTE", { body: positionBodyAF }, {}, "position", actionFile, ""]);
      lastRouteIdx = shorthand.length - 1;

      shorthand.push(["ROUTE", inputParam, schemaParam, "runEntity", actionFile, ""]);
      lastRouteIdx = shorthand.length - 1;

      lastCreatedSu = actionFile;
      continue;
    }

    // No workspace → de-dupe by (name, e) first
    const pick = (...xs) => xs.find(s => typeof s === "string" && s.trim());
    const sanitize = s => String(s || '').replace(/[\/?#]/g, ' ').trim();
    const entNameRaw = pick(body?.schema?.const, b.output, b?.input?.name, b?.input?.title, b?.input?.entity, out) || "$noName";
    const entName = sanitize(entNameRaw);

    const existingSu = await _findExistingEntityByName({ dynamodb, name: entName, e });
    if (existingSu) {
      // Reuse existing; DO NOT create another.
      const positionBodyExisting = {
        description: "matched existing entity",
        entity: existingSu,
        path: breadcrumb,
        output: entName,
        ...(anchorPayload ? { anchor: anchorPayload } : {})
      };

      // idempotent: overwrites or upserts postings; keys should collide
      if (positionBodyExisting.anchor) {
        await _fanoutAnchorBands({
          dynamodb,
          su: existingSu,
          setId: positionBodyExisting.anchor.setId,
          anchor: positionBodyExisting.anchor,
          type: 'su',
          policy_id: policyFor(existingSu)
        });
      }

      shorthand.push(["ROUTE", { body: positionBodyExisting }, {}, "position", existingSu, ""]);
      lastRouteIdx = shorthand.length - 1;

      shorthand.push(["ROUTE", inputParam, {}, "runEntity", existingSu, ""]);
      lastRouteIdx = shorthand.length - 1;
      lastCreatedSu = existingSu;
      continue;
    }

    // Create a **new** entity

    // 1) new group
    shorthand.push(["ROUTE", { output: entName }, {}, "newGroup", entName, entName]);
    const idxNewGroup = shorthand.length - 1;

    // 2) read created file id (REAL SU will be produced at runtime)
    shorthand.push(["GET", `__$ref(${idxNewGroup})`, "response", "file"]);
    const idxFileRow = shorthand.length - 1;

    // 3) load file json
    shorthand.push(["ROUTE", {}, {}, "getFile", `__$ref(${idxFileRow})`, ""]);
    const idxGetFile = shorthand.length - 1;

    // 4) get response json
    shorthand.push(["GET", `__$ref(${idxGetFile})`, "response"]);
    const idxLoadedJSON = shorthand.length - 1;

    // 5) synthesize minimal JPL (actions/modules) for the new file
    const desiredObj = safeClone(elem);
    desiredObj.response = entName;

    let newJPL =
      `directive = [ "**this is not a simulation**: do not make up or falsify any data, and do not use example URLs! This is real data!", ` +
      `"Never response with axios URLs like example.com or domain.com because the app will crash.",` +
      `"respond with {\\"reason\\":\\"...text\\"} if it is impossible to build the app per the users request and rules", ` +
      `"you are a JSON logic app generator.", ` +
      `"You will review the 'example' json for understanding on how to program the 'logic' json object", ` +
      `"You will create a new JSON object based on the details in the desiredApp object like the breadcrumbs path, input json, and output schema.", ` +
      `"Then you build a new JSON logic that best represents (accepts the inputs as body, and products the outputs as a response.", ` +
      `"please give only the 'logic' object, meaning only respond with JSON", ` +
      `"Don't include any of the logic.modules already created.", ` +
      `"the last action item always targets '{|res|}!' to give your response back in the last item in the actions array!", ` +
      `"The user should provide an api key to anything, else attempt to build apps that don't require api key, else instead build an app to tell the user to you can't do it." ];`;
    newJPL += ` let desiredApp = ${JSON.stringify(desiredObj)}; var express = require('express'); const serverless = require('serverless-http'); const app = express(); let { requireModule, runAction } = require('./processLogic'); logic = {}; logic.modules = {"axios": "axios","math": "mathjs","path": "path"}; for (module in logic.modules) {requireModule(module);}; app.all('*', async (req, res, next) => {logic.actions.set = {"URL":URL,"req":req,"res":res,"JSON":JSON,"Buffer":Buffer,"email":{}};for (action in logic.actions) {await runAction(action, req, res, next);};});`;
    newJPL += ` var example = {"modules":{"{shuffle}":"lodash","moment-timezone":"moment-timezone"}, "actions":[{"set":{"ok":true}},{"target":"{|res|}!","chain":[{"access":"json","params":[{"ok":"{|ok|}"}]}]}]};`;

    const objectJPL = await buildBreadcrumbApp({ openai, str: newJPL });

    // 6) write actions/modules into loaded JSON
    shorthand.push(["NESTED", `__$ref(${idxLoadedJSON})`, "published", "actions", objectJPL.actions]);
    shorthand.push(["NESTED", `__$ref(${idxLoadedJSON})`, "published", "modules", objectJPL.modules || {}]);

    // 7) save updated file
    shorthand.push(["ROUTE", `__$ref(${idxLoadedJSON})`, {}, "saveFile", `__$ref(${idxFileRow})`, ""]);

    // 8) position (+anchor included) — use the **ref** to the real SU; DO NOT fanout yet
    const positionBodyCreated = {
      description: "auto created entity",
      entity: `__$ref(${idxFileRow})`,     // resolve at runtime to the real SU
      path: breadcrumb,
      output: entName,
      ...(anchorPayload ? { anchor: anchorPayload } : {})
    };

    // Seed owner grant once the SU exists (runtime will resolve __$ref)
    // We cannot grant here because we don't have the concrete SU yet.
    // Leave ACL seeding to the position handler (or do a post-save step in runner).

    shorthand.push(["ROUTE", { body: positionBodyCreated }, {}, "position", `__$ref(${idxFileRow})`, ""]);
    lastRouteIdx = shorthand.length - 1;

    // 9) run the new entity
    shorthand.push(["ROUTE", inputParam, {}, "runEntity", `__$ref(${idxFileRow})`, ""]);
    lastRouteIdx = shorthand.length - 1;

    // Track for conclusion
    lastCreatedSu = `__$ref(${idxFileRow})`;
  }

  // Wire a single clean conclusion compatible with convert.js
  const lastOrig = arrayLogic[arrayLogic.length - 1] || {};
  if (lastOrig && typeof lastOrig === "object" && "conclusion" in lastOrig && lastRouteIdx >= 0) {
    const addIdx = shorthand.push(
      ["ADDPROPERTY", "000!!", "conclusion", padRef(lastRouteIdx)]
    ) - 1;

    shorthand.push([
      "ADDPROPERTY",
      padRef(addIdx + 1),
      "createdEntities",
      { entity: "", name: "_new", contentType: "text", id: "_new" }
    ]);

    if (lastCreatedSu) {
      shorthand.push(["NESTED", padRef(addIdx + 2), "createdEntities", "entity", lastCreatedSu]);
    }

    shorthand.push(["ROWRESULT", "000", padRef(addIdx + 3)]);
  }

  const finalShorthand = shorthand.map(convertShorthandRefs);

  console.log("⇢ shorthand", JSON.stringify(finalShorthand, null, 4));
  return { shorthand: finalShorthand, details: results, arrayLogic, createdEntities };
}

module.exports = { parseArrayLogic };
