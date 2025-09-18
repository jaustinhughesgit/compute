// modules/convert.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getCookie,
    retrieveAndParseJSON,
    // raw deps bag for legacy calls
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

on("convert", async (ctx, meta = {}) => {
  console.log("CONVERT")
  console.log("CONVERT")
  const { req, res, path, signer } = ctx;
  const { dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic } = deps;

  // ✅ Mirror req.headers into req.body.headers for legacy callers
  if (req) {
    req.body = req.body || {};
    const rawHeaders = req.headers || {};
    // keep any existing body.headers fields, then overlay real headers
    req.body.headers = { ...(req.body.headers || {}), ...rawHeaders };
    // alias for legacy mixed-case lookup
    if (rawHeaders["x-accesstoken"] && !req.body.headers["X-accessToken"]) {
      req.body.headers["X-accessToken"] = rawHeaders["x-accesstoken"];
    }
  }

  let cookie = await getCookie(req.body.headers["X-accessToken"], "ak")
  let e = cookie?.Items?.[0]?.e ?? 0

  // ── legacy body handling…
  const rawBody = (req && req.body) || {};
  const body =
    rawBody && typeof rawBody === "object" && rawBody.body && typeof rawBody.body === "object"
      ? rawBody
      : { body: rawBody };


      console.log("req::::::::", req)
      console.log("req.body::::::::", req.body)
      console.log("segsPath::::::::", path)
    // ── legacy path parsing (tail after action): "/<fileId>[...]" → fileId
    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);
    let actionFile = segs[0] || "";
      console.log("actionFile::::::::", actionFile)

      //req.body.output
      let out
      if (req.body.output == "$essence"){
        out = req?.body?.body?.prompt?.userRequest
      }

    // keep response assembly identical
    let mainObj = {};
    let sourceType;

    // ── require legacy helpers (relative to routes/)
    console.log("require parseArrayLogic")
    const { parseArrayLogic } = require("../parseArrayLogic");
    console.log("require shorthand")
    const { shorthand } = require("../shorthand");

    // 1️⃣ Grab & normalise arrayLogic/prompt from the client
    let arrayLogic = body.body?.arrayLogic ?? body.body?.arrayLogic; // tolerate both shapes
    let prompt = body.body?.prompt ?? body.body?.prompt;

    if (typeof arrayLogic === "string") {
      try {
        arrayLogic = JSON.parse(arrayLogic);
      } catch (err) {
        console.error("arrayLogic is not valid JSON:", err);
        throw new Error("Bad arrayLogic payload");
      }
      sourceType = "arrayLogic";
    } else if (typeof prompt === "string") {
      sourceType = "prompt";
      // The legacy snippet parsed into a variable then referenced `promptObj`.
      // Preserve behavior by defining promptObj (and keeping the unused alias).
      let promptInjection;
      let promptObj;
      try {
        promptInjection = JSON.parse(prompt);
        promptObj = promptInjection;
      } catch (e) {
        promptObj = {};
      }
      let userPath = 1000000000000128;

      // ── fixedPrompt blob preserved verbatim (including template interpolations)
      const fixedPrompt = `directive = [
  \`**this is not a simulation**: do not make up or falsify any data! This is real data!\`,
  \`You are a breadcrumb app sequence generator, meaning you generate an array that is processed in sequence. Row 1, then Row 2, etc. This means any row cannot reference (ref) future rows because they have not been processed yet.\`,
  \`When the user supplies a new persistent fact or resource, **create a single breadcrumb whose method/action pair ends in “/get”.**\`,
  \`• That breadcrumb *simultaneously* stores the data and exposes a standard API for future recall (no separate “/set” or “/store” needed).\`,
  \`• If the user also wants the value immediately, invoke the same “/get” crumb in the same array and return its output in the conclusion.\`,
  \`• If the user only wants to recall something that is already exposed, skip the storage step and simply call the existing “/get”.\`,
  \`You accept {user_requests}, leverage {persistant_knowledge, previous_response, previous_processed_conclusion, relevant_items}, mimic {examples}, follow the {rules}, and organize it into {response}. Response is an array processed in sequence, where the last item is the result conclusion.\`
]

var response = [];

const user_requests = ${JSON.stringify(promptInjection.userRequest)};

const persistent_knowledge = [{"requester":"Austin Hughes", "Austin_Hughes_id":${userPath}}];

const relevant_items = ${JSON.stringify(promptInjection.relevantItems)}

const previous_request = [];

const previous_response = [];

const previous_processed_conclusion = [];

const REF_RE = /^__\\$ref\((\d+)\)(?:\.(.+))?$/;

const isBreadcrumb = key => /^[\w-]+\/.+/.test(key);

async function fetchCrumb(key, payload) {
  const res = await fetch(\`https://1var.com/getCrumbOuput/\${encodeURIComponent(key)}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function processArray(source, context = [], target = []) {
  const walk = (node, pool) => {
    if (typeof node === "string") {
      const m = REF_RE.exec(node);
      if (m) {
        let val = pool[+m[1]];
        for (const k of (m[2]?.split(".") || [])) val = val?.[k];
        return val ?? node;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((x) => walk(x, pool));
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [k, walk(v, pool)])
      );
    }
    return node;
  };

  const result = [];
  for (const raw of source) {
    let item = walk(raw, [...context, ...result]);

    if (
      item &&
      typeof item === "object" &&
      Object.keys(item).length === 1
    ) {
      const [key] = Object.keys(item);
      if (isBreadcrumb(key)) {
        const payload = item[key];
        item = {
          output: await fetchCrumb(key, payload),
        };
      }
    }
    result.push(item);
  }

  const last = walk(source.at(-1), [...context, ...result]);

  target.length = 0;
  if (Array.isArray(last.conclusion)) {
    target.push(...last.conclusion);
  } else {
    target.push(last.conclusion);
  }
  return
}

(async () => {
  await processArray(previous_response, [], previous_processed_conclusion);
  console.log(previous_processed_conclusion)
})();

breadcrumb_rules = [
  /*breadcrumb app 'key': */
  /* 0 */ \`Breadcrumb Format → root / sub‑root / clarifier(s) / locale? / context? / (method/action pairs)+\`,

  /* 1 */ \`No proper nouns anywhere → Never place company, product, or person names (or other unique identifiers) in any breadcrumb segment. All such specifics belong only in the request’s input payload.\`,

  /* 2 */ \`root → Must select a single term from this fixed list: agriculture, architecture, biology, business, characteristic, chemistry, community, cosmology, economics, education, entertainment, environment, event, food, geology, geography, government, health, history, language, law, manufacturing, mathematics, people, psychology, philosophy, religion, sports, technology, transportation.\`,

  /* 3 */ \`sub‑root → A high‑level sub‑domain of the chosen root (e.g. health/clinical, cosmology/galaxies, architecture/structures). Still entirely conceptual—no proper nouns.\`,

  /* 4 */ \`domain‑specific clarifier(s) → One or more deeply nested, slash‑separated conceptual layers that progressively narrow the topic with precise, fully spelled‑out terms (e.g. markets/assets/equity/dividends/valuation or oncology/tumor/staging/treatment/plan). Do NOT fuse concepts into a single segment; each idea gets its own breadcrumb step. No proper nouns.\`,

  /* 5 */ \`locale (optional) → Language or regional facet (e.g. english/american, multilingual/global).\`,

  /* 6 */ \`context (optional) → Perspective or use‑case lens (e.g. marketing, alert, payment, availability).\`,

  /* 7 */ \`method/action pairs → One or more repetitions of “method‑qualifier / action‑verb” (e.g. by/market‑open/sell, via/api/get). These describe *how* the request should execute. Do not include input values or schema fields here.\`,
  /*breadcrumb app 'value': */
  /* 8 */ \`input:{} → The req.body data being sent to the app. Likely sending 'relevant_items' (e.g. { "company_name": "Apple", "product_name": "iPhone 15" }).\`,

  /* 9 */ \`schema:{} → Defines the shape/type of the response data being returned. \`,

  /*10*/ \`Consistency → Always follow this hierarchy and naming discipline so the system can route requests deterministically across all domains and use‑cases.\`
];

examples = [
  \`"My favorite color is red" => [
      { "user": "1000000003" },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "string",
        "const": "red"
      },
      {
        "characteristic/preferences/color/by/user/get": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      { "conclusion": "__$ref(2).output" } // ==> red
  ]\`,

  \`"What is my favorite color?" => [
      { "user-id": "1000000003" },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "string"
      },
      {
        "characteristic/preferences/color/by/user/get": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      { "conclusion": "__$ref(2).output" } // ==> red
  ]\`,
 
  \`"When is the acoustic guitar available for an in-store demo?" =>[
      {
        "store": "Melody Music Emporium",
        "store-id": "hidden",
        "instrument": "Taylor G50 2024",
        "requested-time": "2025-05-30T19:00:00Z"
      },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "verified": {"type": "boolean"},
          "approved-data": {"type": "object"}
        },
        "required": ["verified", "approved-data"]
      },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "confirm-availability": {"type": "boolean"}
        },
        "required": ["confirm-availability"]
      },
      {
        "business/logistics/inventory/stock-verification/by/system/check/availability": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      {
        "business/sales/engagements/demo-booking/by/employee/check/availability": {
          "input": "__$ref(3).output.approved-data",
          "schema": "__$ref(2)"
        }
      },
      {
        "conclusion": {
          "availability": "__$ref(4).output"
        }
      }    
  ]\`
]

root_and_sub_roots = {
  "agriculture": subdomains("agriculture"),
  "architecture": subdomains("architecture"),
  "biology": subdomains("biology"),
  "business": subdomains("business"),
  "characteristic": subdomains("characteristic"),
  "chemistry": subdomains("chemistry"),
  "community": subdomains("community"),
  "cosmology": subdomains("cosmology"),
  "economics": subdomains("economics"),
  "education": subdomains("education"),
  "entertainment": subdomains("entertainment"),
  "environment": subdomains("environment"),
  "event": subdomains("event"),
  "food": subdomains("food"),
  "geology": subdomains("geology"),
  "geography": subdomains("geography"),
  "government": subdomains("government"),
  "health": subdomains("health"),
  "history": subdomains("history"),
  "language": subdomains("language"),
  "law": subdomains("law"),
  "manufacturing": subdomains("manufacturing"),
  "mathematics": subdomains("mathematics"),
  "people": subdomains("people"),
  "psychology": subdomains("psychology"),
  "philosophy": subdomains("philosophy"),
  "religion": subdomains("religion"),
  "sports": subdomains("sports"),
  "technology": subdomains("technology"),
  "transportation": subdomains("transportation")
}

function subdomains(domain){
    let subsArray = require('./'+domain);
    return subsArray
}
//RESPOND LIKE THE EXAMPLES ONLY`;

      arrayLogic = fixedPrompt;
    }
    

    // 2️⃣ First pass – evaluate the array logic (parity with legacy)
    const parseResults = await parseArrayLogic({
      arrayLogic,
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
      e
    });

    // 3️⃣ If shorthand payload was produced, immediately run the shorthand engine
    let newShorthand = null;
    let conclusion = null;

    if (parseResults?.shorthand) {
      const virtualArray = JSON.parse(JSON.stringify(parseResults.shorthand));

      // File id from tail path (legacy used reqPath.split("/")[3])
      // We already parsed actionFile above; keep as-is.
      const jsonpl = await retrieveAndParseJSON(actionFile, true);
      const shorthandLogic = JSON.parse(JSON.stringify(jsonpl));
      const blocks = shorthandLogic.published.blocks;
      const originalPublished = shorthandLogic.published;

      // Re-inject exactly like legacy /shorthand route
      shorthandLogic.input = [{ virtual: virtualArray }];
      shorthandLogic.input.unshift({ physical: [[shorthandLogic.published]] });

      // Fabricate a reqPath string shaped like legacy expectations
      const fakeReqPath = `/cookies/convert/${actionFile}`;
      // Build a reqBody shaped like legacy expectations
      const legacyReqBody = { body: body.body || {} };
      console.log("sh1")

      // Run the shorthand pipeline (preserve call signature)
      newShorthand = await shorthand(
        shorthandLogic,
        req,
        res,
        /* next */ undefined,
        /* privateKey */ undefined,
        dynamodb,
        uuidv4,
        s3,
        ses,
        openai,
        Anthropic,
        dynamodbLL,
        /* isPublished */ true,
        fakeReqPath,
        legacyReqBody,
        req?.method,
        ctx.type || req?.type,
        req?._headerSent,
        signer,
        "shorthand",
        ctx.xAccessToken
      );
      console.log("sh2",newShorthand)
      // Restore untouched blocks & clean temp props (parity)
      newShorthand.published.blocks = blocks;
      conclusion = JSON.parse(JSON.stringify(newShorthand.conclusion));
      delete newShorthand.input;
      delete newShorthand.conclusion;
      console.log("sh3.2",actionFile)

      // Quick checksum for callers (optional parity field)
      parseResults.isPublishedEqual =
        JSON.stringify(originalPublished) === JSON.stringify(newShorthand.published);
      console.log("sh4.2", JSON.stringify(newShorthand))

      // Persist to S3 (exact bucket/key/content-type)
      if (actionFile) {
        console.log("actionFile",actionFile)
        await s3
          .putObject({
            Bucket: "public.1var.com",
            Key: actionFile,
            Body: JSON.stringify(newShorthand),
            ContentType: "application/json",
          })
          .promise();
      }
      console.log("sh5")
    }

    // 4️⃣ Return everything to the caller (parity with legacy response shape)
    mainObj = {
      parseResults,
      newShorthand,
      arrayLogic: parseResults?.arrayLogic,
      conclusion,
    };
      console.log("sh6")

    // Append legacy fields added by the router tail
    mainObj.existing = !!(meta && meta.cookie && meta.cookie.existing);
    mainObj.file = String(actionFile || "");
      console.log("sh7")

    // Legacy sendBack shape: { ok: true, response }
    return { ok: true, response: mainObj };
  });

  return { name: "convert" };
}

module.exports = { register };
