// modules/convert.js
"use strict";

function register({ on, use }) {
  const { getCookie, retrieveAndParseJSON, deps } = use();

  on("convert", async (ctx, meta = {}) => {
    try {
      const { req, res, path, signer } = ctx;
      const { dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic } = deps;

      // ─────────────────────────────────────────────────────────────
      // 1) Normalize headers AND ensure req.body is an object
      //    (req.body may arrive as a string from some clients)
      // ─────────────────────────────────────────────────────────────
      if (req) {
        const rawHeaders = req.headers || {};

        // Ensure req.body is an object
        if (typeof req.body !== "object" || req.body === null) {
          try {
            req.body = JSON.parse(req.body ?? "{}");
          } catch {
            req.body = {};
          }
        }

        // Attach headers (preserve legacy X-accessToken casing)
        req.body.headers = { ...(req.body.headers || {}), ...rawHeaders };
        if (rawHeaders["x-accesstoken"] && !req.body.headers["X-accessToken"]) {
          req.body.headers["X-accessToken"] = rawHeaders["x-accesstoken"];
        } else if (rawHeaders["x-access-token"] && !req.body.headers["X-accessToken"]) {
          req.body.headers["X-accessToken"] = rawHeaders["x-access-token"];
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 2) Resolve user id from cookie (default 0 to preserve legacy flows)
      // ─────────────────────────────────────────────────────────────
      let e = 0;
      try {
        const xAccessToken = req?.body?.headers?.["X-accessToken"];
        if (xAccessToken) {
          const cookie = await getCookie(xAccessToken, "ak");
          const maybeE = cookie?.Items?.[0]?.e;
          if (Number.isFinite(Number(maybeE))) e = Number(maybeE);
        }
      } catch {
        // ignore cookie errors
      }

      // ─────────────────────────────────────────────────────────────
      // 3) Envelope normalization (robust to body being a string)
      //    Final shape we want: { body: <object> }
      // ─────────────────────────────────────────────────────────────
      const rawBody = req ? req.body : {};
      let body;

      if (typeof rawBody === "string") {
        // If the transport left us a string, try to parse; if it's a bare
        // sentence, treat it as `{ prompt: <string> }`.
        try {
          const parsed = JSON.parse(rawBody);
          body =
            parsed && typeof parsed === "object" && parsed.body && typeof parsed.body === "object"
              ? parsed
              : { body: parsed };
        } catch {
          body = { body: { prompt: rawBody } };
        }
      } else if (rawBody && typeof rawBody === "object") {
        body =
          rawBody.body && typeof rawBody.body === "object"
            ? rawBody
            : { body: rawBody };
      } else {
        body = { body: {} };
      }

      // ─────────────────────────────────────────────────────────────
      // 4) Workspace id from path: /cookies/convert/<workspaceId>
      // ─────────────────────────────────────────────────────────────
      const segs = String(path || "").split("?")[0].split("/").filter(Boolean);
      const convertIdx = segs.findIndex((s) => s === "convert");
      let actionFile = (convertIdx >= 0 ? segs[convertIdx + 1] : segs[segs.length - 1]) || "";

      // ─────────────────────────────────────────────────────────────
      // 5) Determine requestOnly FIRST (so it exists before any usage)
      // ─────────────────────────────────────────────────────────────
      const requestOnly = !!body.body?.requestOnly;

      // ─────────────────────────────────────────────────────────────
      // 6) Safe prompt parser:
      //    - Accepts object, JSON string, or plain natural-language string
      //    - Normalizes { prompt: "..." } → { userRequest: "..." }
      //    - Ensures relevantItems is an array
      // ─────────────────────────────────────────────────────────────
      function parsePrompt(p) {
        if (!p) return {};
        if (p && typeof p === "object") {
          let obj = { ...p };
          if (typeof obj.userRequest !== "string" && typeof obj.prompt === "string") {
            obj.userRequest = obj.prompt;
          }
          if (!Array.isArray(obj.relevantItems)) obj.relevantItems = obj.relevantItems ?? [];
          return obj;
        }
        const s = String(p).trim();
        if (!s) return {};
        try {
          const asObj = JSON.parse(s);
          if (asObj && typeof asObj === "object") {
            if (typeof asObj.userRequest !== "string" && typeof asObj.prompt === "string") {
              asObj.userRequest = asObj.prompt;
            }
            if (!Array.isArray(asObj.relevantItems)) asObj.relevantItems = asObj.relevantItems ?? [];
            return asObj;
          }
        } catch {
          // Plain sentence → wrap
          return { userRequest: s, relevantItems: [] };
        }
        return {};
      }

      const promptObjForEssence = parsePrompt(body.body?.prompt);

      // ─────────────────────────────────────────────────────────────
      // 7) Essence word extraction (when output === "$essence", or requestOnly mode)
      // ─────────────────────────────────────────────────────────────
      let out = "";
      if (req?.body?.output === "$essence") {
        out = String(promptObjForEssence?.userRequest || "");
      }
      if (!out && requestOnly) {
        out = String(promptObjForEssence?.userRequest || "");
      }


  // If we only need the essence/requestOnly output, return early and
  // avoid calling parseArrayLogic (which may expect arrayLogic/sourceType).
  if ((req?.body?.output === "$essence") || requestOnly) {
    return { ok: true, response: { conclusion: out } };
  }


      // ─────────────────────────────────────────────────────────────
      // 8) Main flow
      // ─────────────────────────────────────────────────────────────
      let mainObj = {};
      let sourceType;
      const { parseArrayLogic } = require("../parseArrayLogic");
      const { shorthand } = require("../shorthand");

      let arrayLogic = body.body?.arrayLogic;
      let prompt = body.body?.prompt;

      // If prompt supplied, we build arrayLogic from your fixed prompt template
      if (prompt && (typeof prompt === "string" || typeof prompt === "object")) {
        sourceType = "prompt";
        const promptObj = parsePrompt(prompt); // ← safe (no throws)

        const userPath = 1000000000000128;

        // ↓↓↓ KEEP YOUR EXISTING LONG PROMPT STRING HERE, UNCHANGED ↓↓↓
        // It must assign the giant template literal to `fixedPrompt`.
        // For example:
        //
        // const fixedPrompt = `... your very long prompt string literal ...`;
        //
        // (Do NOT change its contents; just paste the same string you already use.)







        const fixedPrompt = /* PASTE YOUR EXISTING LONG PROMPT STRING LITERAL HERE (UNCHANGED) */ (
          () => {
            // This placeholder keeps the file syntactically valid until you paste the string.
            // Replace this IIFE with your actual template literal.
            return String(
              // minimal, harmless fallback so local editors don't crash before you paste:
              `directive = [
  \`**this is not a simulation**: do not make up or falsify any data! This is real data!\`,
  \`You are a breadcrumb app sequence generator, meaning you generate an array that is processed in sequence. Row 1, then Row 2, etc. This means any row cannot reference (ref) future rows because they have not been processed yet.\`,
  \`When the user supplies a new persistent fact or resource, **create a single breadcrumb whose method/action pair ends in “/get”.**\`,
  \`• That breadcrumb *simultaneously* stores the data and exposes a standard API for future recall (no separate “/set” or “/store” needed).\`,
  \`• If the user also wants the value immediately, invoke the same “/get” crumb in the same array and return its output in the conclusion.\`,
  \`• If the user only wants to recall something that is already exposed, skip the storage step and simply call the existing “/get”.\`,
  \`You accept {user_requests}, leverage {persistant_knowledge, previous_response, previous_processed_conclusion, relevant_items}, mimic {examples}, follow the {rules}, and organize it into {response}. Response is an array processed in sequence, where the last item is the result conclusion.\`
]

var response = [];

const user_requests = ${JSON.stringify(promptObj?.userRequest ?? promptObj ?? "")};

const persistent_knowledge = [{"requester":"Austin Hughes", "Austin_Hughes_id":${userPath}}];

const relevant_items = ${JSON.stringify(promptObj?.relevantItems ?? [])}

const previous_request = [];

const previous_response = [];

const previous_processed_conclusion = [];

const REF_RE = /^__\\$ref\\((\\d+)\\)(?:\\.(.+))?$/;

const isBreadcrumb = key => /^[\\w-]+\\/.+/.test(key);

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
  /* 0 */ \`Breadcrumb Format → root / sub-root / clarifier(s) / locale? / context? / (method/action pairs)+\`,

  /* 1 */ \`No proper nouns anywhere → Never place company, product, or person names (or other unique identifiers) in any breadcrumb segment. All such specifics belong only in the request’s input payload.\`,

  /* 2 */ \`root → Must select a single term from this fixed list: agriculture, architecture, biology, business, characteristic, chemistry, community, cosmology, economics, education, entertainment, environment, event, food, geology, geography, government, health, history, language, law, manufacturing, mathematics, people, psychology, philosophy, religion, sports, technology, transportation.\`,

  /* 3 */ \`sub-root → A high-level sub-domain of the chosen root (e.g. health/clinical, cosmology/galaxies, architecture/structures). Still entirely conceptual—no proper nouns.\`,

  /* 4 */ \`domain-specific clarifier(s) → One or more deeply nested, slash-separated conceptual layers that progressively narrow the topic with precise, fully spelled-out terms (e.g. markets/assets/equity/dividends/valuation or oncology/tumor/staging/treatment/plan). Do NOT fuse concepts into a single segment; each idea gets its own breadcrumb step. No proper nouns.\`,

  /* 5 */ \`locale (optional) → Language or regional facet (e.g. english/american, multilingual/global).\`,

  /* 6 */ \`context (optional) → Perspective or use-case lens (e.g. marketing, alert, payment, availability).\`,

  /* 7 */ \`method/action pairs → One or more repetitions of “method-qualifier / action-verb” (e.g. by/market-open/sell, via/api/get). These describe *how* the request should execute. Do not include input values or schema fields here.\`,
  /*breadcrumb app 'value': */
  /* 8 */ \`input:{} → The req.body data being sent to the app. Likely sending 'relevant_items' (e.g. { "company_name": "Apple", "product_name": "iPhone 15" }).\`,

  /* 9 */ \`schema:{} → Defines the shape/type of the response data being returned. \`,

  /*10*/ \`Consistency → Always follow this hierarchy and naming discipline so the system can route requests deterministically across all domains and use-cases.\`
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
//RESPOND LIKE THE EXAMPLES ONLY`
            );
          }
        )();
        // ↑↑↑ KEEP YOUR EXISTING LONG PROMPT STRING HERE, UNCHANGED ↑↑↑

        // Use your fixedPrompt to drive arrayLogic creation on the server
        arrayLogic = fixedPrompt;
      } else if (typeof arrayLogic === "string" && arrayLogic.trim().startsWith("[")) {
        arrayLogic = JSON.parse(arrayLogic);
        sourceType = "arrayLogic";
      }


      // Ensure actionFile is a safe non-empty string
      if (!actionFile || typeof actionFile !== "string") {
        actionFile = "default";
      }

      // 🔒 Normalize values handed to parseArrayLogic so `.includes` is safe downstream
      const safeArrayLogic =
        typeof arrayLogic === "string" || Array.isArray(arrayLogic) ? arrayLogic : "";
      const safeSourceType = typeof sourceType === "string" ? sourceType : "";


      // ─────────────────────────────────────────────────────────────
      // 9) Hand off to parseArrayLogic (passes essence `out` and requestOnly flag)
      // ─────────────────────────────────────────────────────────────
      const parseResults = await parseArrayLogic({
        arrayLogic: safeArrayLogic,
        dynamodb,
        uuidv4,
        s3,
        ses,
        openai,
        Anthropic,
        dynamodbLL,
        sourceType: safeSourceType,
        actionFile,
        out,
        e,
        requestOnly: false, // already short-circuited above
      });

      let newShorthand = null;
      let conclusion = null;
      let createdEntities = [];
      let entityFromConclusion = null;

      if (parseResults?.shorthand) {
        const virtualArray = JSON.parse(JSON.stringify(parseResults.shorthand));

        // Try to load existing published logic for this actionFile
        let jsonpl = null;
        try {
          jsonpl = await retrieveAndParseJSON(actionFile, true);
        } catch (err) {
          console.error("retrieveAndParseJSON failed:", err && err.message);
        }

        if (jsonpl?.published) {
          // Run the prompt-generated shorthand as *virtual only*.
          // Do NOT mix in the sender's published logic; we're creating a *new* entity.
          const runEnvelope = { input: [{ virtual: virtualArray }] };

          const fakeReqPath = `/cookies/convert/${actionFile}`;
          const legacyReqBody = { body: body.body || {} };

          const runResult = await shorthand(
            runEnvelope,
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

          // Extract conclusion payload (runner may wrap it)
          const rawConclusion = JSON.parse(JSON.stringify(runResult?.conclusion || null));
 

          const conclusionValue =
            rawConclusion && typeof rawConclusion === "object" && "value" in rawConclusion
              ? rawConclusion.value
              : rawConclusion;
          createdEntities = rawConclusion && Array.isArray(rawConclusion.createdEntities)
            ? rawConclusion.createdEntities
            : [];
          entityFromConclusion =
            (rawConclusion && typeof rawConclusion === "object" && rawConclusion.entity) ||
            (createdEntities[0]?.entity) ||
            null;
          conclusion = conclusionValue;

          // IMPORTANT: do **not** write back to the sender's actionFile here.
          // The new entity was created/saved by the virtual run itself.

          // (optional) expose runResult if you want to inspect it client-side
          newShorthand = undefined;

        }
      }

      // ─────────────────────────────────────────────────────────────
      // 10) Final response envelope
      // ─────────────────────────────────────────────────────────────
      mainObj = {
        parseResults,
        newShorthand,
        arrayLogic: parseResults?.arrayLogic,
        conclusion,
        entity: entityFromConclusion || "",
        createdEntities,
      };

      mainObj.existing = !!(meta && meta.cookie && meta.cookie.existing);
      mainObj.file = String(entityFromConclusion || actionFile || "");

      return { ok: true, response: mainObj };
    } catch (err) {
      console.error("convert handler error:", err);
      return {
        ok: false,
        error: err?.message || String(err),
      };
    }
  });

  return { name: "convert" };
}

module.exports = { register };
