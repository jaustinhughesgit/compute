// parseArrayLogic.js

const anchorsUtil = require('./anchors');
const { DynamoDB } = require('aws-sdk');
const { Converter } = DynamoDB;

const ANCHOR_BANDS_TABLE = process.env.ANCHOR_BANDS_TABLE || 'anchor_bands';
const PERM_GRANTS_TABLE = process.env.PERM_GRANTS_TABLE || 'perm_grants';
const PERM_GSI_BY_PRINCIPAL = process.env.PERM_GSI_BY_PRINCIPAL || 'by_principal';
const DEFAULT_POLICY_PREFIX = process.env.POLICY_PREFIX || 'entity';

// marshal helper for low-level numeric attributes
const n = (x) => ({ N: typeof x === 'string' ? x : String(x) });

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


const createArrayOfRootKeys = schema => {
  if (!schema || typeof schema !== "object") return [];
  const { properties } = schema;
  return properties && typeof properties === "object"
    ? Object.keys(properties)
    : [];
};


const REF_REGEX = /^__\$ref\((\d+)\)(.*)$/;

function resolveArrayLogic(arrayLogic) {
  const cache = new Array(arrayLogic.length);
  const resolving = new Set();

  const deepResolve = val => {
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
      return Object.fromEntries(Object.entries(val).map(
        ([k, v]) => [k, deepResolve(v)]
      ));
    return val;
  };

  const resolveElement = i => {
    if (cache[i] !== undefined) return cache[i];
    if (resolving.has(i)) throw new Error(`Circular __$ref at index ${i}`);
    resolving.add(i);
    cache[i] = deepResolve(arrayLogic[i]);
    resolving.delete(i);
    return cache[i];
  };

  return arrayLogic.map((_, i) => resolveElement(i));
}

const OFFSET = 1;
const padRef = n_ => String(n_).padStart(3, "0") + "!!";
const OP_ONLY = /^__\$(?:ref)?\((\d+)\)$/;

const convertShorthandRefs = v => {
  if (typeof v === "string") {
    const m = v.match(OP_ONLY);
    if (m) return padRef(Number(m[1]) + OFFSET);
    return v;
  }
  if (Array.isArray(v)) return v.map(convertShorthandRefs);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(
      ([k, val]) => [k, convertShorthandRefs(val)]
    ));
  return v;
};

const isOperationElem = obj =>
  obj && typeof obj === "object" && !Array.isArray(obj) &&
  Object.keys(obj).length === 1 &&
  (() => { const v = obj[Object.keys(obj)[0]]; return v && v.input && v.schema; })();

const isSchemaElem = obj =>
  obj && typeof obj === "object" && !Array.isArray(obj) && "properties" in obj;

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
        additionalProperties: {
          type: "string",
          description: "Exact name of the npm package to `require`."
        }
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
          { enum: ["==", "!=", "<", ">", "<=", ">=", "===", "!==", "in", "includes"] },
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
              { required: ["target", "chain"], properties: { target: { type: "string" }, chain: { $ref: "#/$defs/chainArray" }, assign: { type: "string" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["if", "set"], properties: { if: { $ref: "#/$defs/conditionArray" }, set: { type: "object" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["while", "nestedActions"], properties: { while: { $ref: "#/$defs/conditionArray" }, nestedActions: { $ref: "#/$defs/actionList" } } },
              { required: ["assign", "params", "nestedActions"], properties: { assign: { type: "string" }, params: { type: "array", items: { type: "string" } }, nestedActions: { $ref: "#/$defs/actionList" } } },
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
    messages: [{
      role: "system",
      content:
        "You are a JSON-only assistant. Reply with **only** a valid JSON " +
        "array—the arrayLogic representation of the user’s request. " +
        "No prose. No markdown. No code fences. No comments!!"
    },
    { role: "user", content: prompt }
    ]
  });
  let text = rsp.choices[0].message.content.trim();

  function stripComments(jsonLike) {
    let out = '';
    let inString = false, quote = '', escaped = false;
    let inSL = false, inML = false;

    for (let i = 0; i < jsonLike.length; i++) {
      const c = jsonLike[i], n = jsonLike[i + 1];

      if (inSL) {
        if (c === '\n' || c === '\r') { inSL = false; out += c; }
        continue;
      }
      if (inML) {
        if (c === '*' && n === '/') { inML = false; i++; }
        continue;
      }
      if (inString) {
        out += c;
        if (!escaped && c === quote) { inString = false; quote = ''; }
        escaped = !escaped && c === '\\';
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true; quote = c; out += c; continue;
      }
      if (c === '/' && n === '/') { inSL = true; i++; continue; }
      if (c === '/' && n === '*') { inML = true; i++; continue; }

      out += c;
    }
    return out;
  }

  text = stripComments(text);

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) {
    throw new Error("Model response did not contain a JSON array.");
  }

  text = text.slice(start, end + 1);
  return JSON.parse(text);
}

async function _ensureOwnerGrant({ dynamodb, su, e, perms = "rwdop" }) {
  try {
    if (!su || !e) return;
    const now = Math.floor(Date.now() / 1000);
    await dynamodb.put({
      TableName: PERM_GRANTS_TABLE,
      Item: {
        entityID: String(su),
        principalID: `u:${e}`,
        perms,
        created: now
      }
    }).promise();
  } catch (err) {
    console.warn("perm_grants owner seed failed:", err && err.message);
  }
}

async function parseArrayLogic({
  arrayLogic = [],
  dynamodb, 
  uuidv4,
  s3,
  ses,
  openai,
  Anthropic,
  dynamodbLL,  
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
  const createdEntities = [];
  const results = [];
  let routeRowNewIndex = null;

  // presence check only (uses DocumentClient)
  const loadExistingEntityRow = async (su) => {
    try {
      const { Item } = await dynamodb.get({
        TableName: "subdomains",
        Key: { su }
      }).promise();
      return Item || null;
    } catch (e) {
      console.error("subdomains.get failed", e);
      return null;
    }
  };

  /* ---- anchor_bands helpers (writes postings) ----
     UPDATED: allow optional policy_id to be stamped on postings */
  async function _putAllBatched(table, items) {
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

  async function _fanoutAnchorBands({ su, setId, anchor, type = 'su', policy_id }) {
    const assigns = anchor?.assigns || [];
    if (!su || !setId || !assigns.length) return 0;
    const rows = assigns.map(a => {
      const base = anchorsUtil.makePosting({ setId, su, assign: a, type, shards: anchorsUtil.DEFAULT_NUM_SHARDS });
      return policy_id ? { ...base, policy_id } : base;   // ★ attach policy pointer
    });
    return _putAllBatched(ANCHOR_BANDS_TABLE, rows);
  }

  for (let i = 0; i < arrayLogic.length; i++) {
    const origElem = arrayLogic[i];

    if (i === arrayLogic.length - 1 && origElem?.conclusion !== undefined) {
      continue;
    }

    const elem = resolvedLogic[i];

    let fixedOutput;
    let fixedDate;

    if (!isOperationElem(origElem)) {
      if (isSchemaElem(origElem)) {
        shorthand.push(createArrayOfRootKeys(elem));
      } else if (origElem && typeof origElem === "object") {
        shorthand.push([convertShorthandRefs(elem)]);
      } else {
        shorthand.push([convertShorthandRefs(elem)]);
      }
      continue;
    }

    const bc = Object.keys(elem)[0];

    if (Object.prototype.hasOwnProperty.call(elem[bc], "output")) {
      fixedOutput = elem[bc].output;
      delete elem[bc].output;
    }
    if (Object.prototype.hasOwnProperty.call(elem[bc], "date")) {
      fixedDate = elem[bc].date;
      delete elem[bc].date;
    }

    const [breadcrumb] = Object.keys(elem);
    const body = elem[breadcrumb];

    // Prefer the *user's request* when requestOnly === true
    const b = elem[bc];
    const inp = b?.input && typeof b.input === 'object' ? b.input : {};
    let userReqText = null;

    if (typeof out === "string" && out.trim()) userReqText = out.trim();

    if (!userReqText) {
      const candidate =
        inp.user_requests ?? inp.user_request ?? inp.request ?? inp.query ?? inp.q ?? inp.word ?? inp.words ?? null;
      if (Array.isArray(candidate)) userReqText = candidate.map(String).join(' ').trim();
      else if (typeof candidate === 'string') userReqText = candidate.trim();
    }

    const textForEmbedding = requestOnly
      ? (userReqText || b?.input?.name || b?.input?.title || (typeof out === "string" && out) || JSON.stringify(elem))
      : (b?.input?.name || b?.input?.title || (typeof out === "string" && out) || JSON.stringify(elem));



    const userID = e || 0;



    const inputParam = convertShorthandRefs(body.input);
    const expectedKeys = createArrayOfRootKeys(body.schema);
    const schemaParam = convertShorthandRefs(expectedKeys);

    // NO MATCH: either run provided actionFile, or create new entity + seed ACL + anchor
    if (actionFile) {

      const anchorWordAF = (fixedOutput && String(fixedOutput).trim())
        ? fixedOutput
        : (typeof out === "string" ? out.trim() : "");
      const anchorPayloadAF = anchorWordAF
        ? await _computeAnchorPayload({ s3, openai, text: anchorWordAF })
        : null;

      const positionBodyAF = {
        description: "provided entity (fallback)",
        embedding,
        entity: actionFile,
        output: fixedOutput || out || ""
      };
      if (anchorPayloadAF) positionBodyAF.anchor = anchorPayloadAF;

      // ★ policy pointer on postings
      if (positionBodyAF.anchor) {
        await _fanoutAnchorBands({
          su: actionFile,
          setId: positionBodyAF.anchor.setId,
          anchor: positionBodyAF.anchor,
          type: 'su',
          policy_id: `${DEFAULT_POLICY_PREFIX}:${String(actionFile)}`
        });
      }

      // ★ ensure owner grant (optional; actionFile is typically caller-owned)
      await _ensureOwnerGrant({ dynamodb, su: actionFile, e });

      shorthand.push([
        "ROUTE",
        { "body": positionBodyAF },
        {},
        "position",
        actionFile,
        ""
      ]);

      shorthand.push([
        "ROUTE", inputParam, schemaParam, "runEntity", actionFile, ""
      ]);

      routeRowNewIndex = shorthand.length;
      continue;
    }

    // create a new entity/group
    const pick = (...xs) => xs.find(s => typeof s === "string" && s.trim());
    const sanitize = s => String(s || '').replace(/[\/?#]/g, ' ').trim();

    const entNameRaw = pick(body?.schema?.const, fixedOutput, body?.input?.name, body?.input?.title, body?.input?.entity, out) || "$noName";
    const entName = sanitize(entNameRaw);
    fixedOutput = entName;
    const groupName = entName;

    shorthand.push([
      "ROUTE",
      { output: entName },
      {},
      "newGroup",
      groupName,
      entName
    ]);

    routeRowNewIndex = shorthand.length;

    shorthand.push(["GET", padRef(routeRowNewIndex), "response", "file"]);

    if (fixedOutput) {
      // generate JPL to wire initial actions
      shorthand.push(["ROUTE", {}, {}, "getFile", padRef(routeRowNewIndex + 1), ""]);
      shorthand.push(["GET", padRef(routeRowNewIndex + 2), "response"]);

      const desiredObj = structuredClone(elem);
      if (fixedOutput) desiredObj.response = fixedOutput;

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
      newJPL += ` var example = {"modules":{"{shuffle}":"lodash","moment-timezone":"moment-timezone"}, "actions":[{"set":{"latestEmail":"{|email=>[0]|}"}},{"set":{"latestSubject":"{|latestEmail=>subject|}"}},{"set":{"userIP":"{|req=>ip|}"}},{"set":{"userAgent":"{|req=>headers.user-agent|}"}},{"set":{"userMessage":"{|req=>body.message|}"}},{"set":{"pending":[]}},{"target":"{|axios|}","chain":[{"access":"get","params":["https://httpbin.org/ip"]}],"promise":"raw","assign":"{|pending=>[0]|}!"},{"target":"{|axios|}","chain":[{"access":"get","params":["https://httpbin.org/user-agent"]}],"promise":"raw","assign":"{|pending=>[1]|}!"},{"target":"{|Promise|}","chain":[{"access":"all","params":["{|pending|}"]}],"assign":"{|results|}"},{"set":{"httpBinIP":"{|results=>[0].data.origin|}"}},{"set":{"httpBinUA":"{|results=>[1].data['user-agent']|}"}},{"target":"{|axios|}","chain":[{"access":"get","params":["https://ipapi.co/{|userIP|}/json/"]}],"assign":"{|geoData|}"},{"set":{"city":"{|geoData=>data.city|}"}},{"set":{"timezone":"{|geoData=>data.timezone|}"}},{"target":"{|moment-timezone|}","chain":[{"access":"tz","params":["{|timezone|}"]}],"assign":"{|now|}"},{"target":"{|now|}!","chain":[{"access":"format","params":["YYYY-MM-DD"]}],"assign":"{|today|}"},{"target":"{|now|}!","chain":[{"access":"hour"}],"assign":"{|hour|}"},{"set":{"timeOfDay":"night"}},{"if":[["{|hour|}",">=","{|=3+3|}"],["{|hour|}","<",12]],"set":{"timeOfDay":"morning"}},{"if":[["{|hour|}",">=",12],["{|hour|}","<",18]],"set":{"timeOfDay":"afternoon"}},{"if":[["{|hour|}",">=","{|=36/2|}"],["{|hour|}","<",22]],"set":{"timeOfDay":"evening"}},{"set":{"extra":3}},{"set":{"maxIterations":"{|=5+{|extra|}|}"}},{"set":{"counter":0}},{"set":{"greetings":[]}},{"while":[["{|counter|}","<","{|maxIterations|}"]],"nestedActions":[{"set":{"greetings=>[{|counter|}]":"Hello number {|counter|}"}},{"set":{"counter":"{|={|counter|}+1|}"}}]},{"assign":"{|generateSummary|}","params":["prefix","remark"],"nestedActions":[{"set":{"localZone":"{|~/timezone|}"}},{"return":"{|prefix|} {|remark|} {|~/greetings=>[0]|} Visitor from {|~/city|} (IP {|~/userIP|}) said '{|~/userMessage|}'. Local timezone:{|localZone|} · Time-of-day:{|~/timeOfDay|} · Date:{|~/today|}."}]},{"target":"{|generateSummary|}!","chain":[{"assign":"","params":["Hi.","Here are the details."]}],"assign":"{|message|}"},{"target":"{|res|}!","chain":[{"access":"send","params":["{|message|}"]}]}]};`;

      const objectJPL = await buildBreadcrumbApp({ openai, str: newJPL });

      shorthand.push(["NESTED", padRef(routeRowNewIndex + 3), "published", "actions", objectJPL.actions]);
      shorthand.push(["NESTED", padRef(routeRowNewIndex + 4), "published", "modules", objectJPL.modules || {}]);

      shorthand.push(["ROUTE", padRef(routeRowNewIndex + 5), {}, "saveFile", padRef(routeRowNewIndex + 1), ""]);
    }

    // record positioning for the new entity

    const anchorPayloadNew = await _computeAnchorPayload({
      s3, openai, text: fixedOutput
    });

    const newSu = padRef(routeRowNewIndex + 1);
    const positionBodyCreated = {
      description: "auto created entity",
      embedding,
      entity: newSu,
      output: fixedOutput
    };
    if (anchorPayloadNew) positionBodyCreated.anchor = anchorPayloadNew;

    // ★ fanout with policy pointer
    if (positionBodyCreated.anchor) {
      await _fanoutAnchorBands({
        su: newSu,
        setId: positionBodyCreated.anchor.setId,
        anchor: positionBodyCreated.anchor,
        type: 'su',
        policy_id: `${DEFAULT_POLICY_PREFIX}:${String(newSu)}`
      });
    }

    // ★ seed owner grant for creator
    await _ensureOwnerGrant({ dynamodb, su: newSu, e });

    shorthand.push([
      "ROUTE",
      { "body": positionBodyCreated },
      {},
      "position",
      newSu,
      ""
    ]);

    if (fixedOutput) {
      shorthand.push(["ROUTE", inputParam, {}, "runEntity", newSu, ""]);
    } else {
      shorthand.push([fixedOutput]);
    }



    routeRowNewIndex = shorthand.length;
  }

  const lastOrig = arrayLogic[arrayLogic.length - 1] || {};
  if (lastOrig && typeof lastOrig === "object" && "conclusion" in lastOrig) {
    const getRowIndex = shorthand.push(
      ["ADDPROPERTY", "000!!", "conclusion", padRef(routeRowNewIndex)]
    ) - 1;

    shorthand.push([
      "ADDPROPERTY",
      padRef(getRowIndex + 1),
      "createdEntities",
      { entity: "", name: "_new", contentType: "text", id: "_new" }
    ]);

    shorthand.push(["NESTED", padRef(getRowIndex + 2), "createdEntities", "entity", "004!!"]);

    shorthand.push(["ROWRESULT", "000", padRef(getRowIndex + 3)]);
  }

  const finalShorthand = shorthand.map(convertShorthandRefs);

  console.log("⇢ shorthand", JSON.stringify(finalShorthand, null, 4));
  console.log("createdEntities", JSON.stringify(createdEntities, null, 4));
  return { shorthand: finalShorthand, details: results, arrayLogic, createdEntities };
}

module.exports = { parseArrayLogic };
