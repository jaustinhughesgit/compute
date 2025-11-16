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

      // ─────────────────────────────────────────────────────────────
      // 8) Main flow
      // ─────────────────────────────────────────────────────────────
      let mainObj = {};
      let sourceType;
      const { parseArrayLogic } = require("../parseArrayLogic");
      const { shorthand } = require("../shorthand");

      let arrayLogic = body.body?.arrayLogic;
      let prompt = body.body?.prompt;

      // If prompt supplied, we build arrayLogic from our fixed prompt template
      if (prompt && (typeof prompt === "string" || typeof prompt === "object")) {
        sourceType = "prompt";
        const promptObj = parsePrompt(prompt); // ← safe (no throws)

        const userPath = 1000000000000128;

        // ↓↓↓ UPDATED PROMPT: no domain/subdomain logic ↓↓↓
        const fixedPrompt = (() => {
          return String(
`directive = [
  \`**this is not a simulation**: do not make up or falsify any data! This is real data!\`,
  \`You generate a JSON array ("arrayLogic") that is processed strictly in sequence (row 0, then 1, ...). Future rows must never be referenced by earlier rows.\`,
  \`When the user supplies a new persistent fact/resource, create a single operation whose key ends with a method/action pair like "by/user/get" or "via/api/get".\`,
  \`If the user also wants the value immediately, invoke the same operation in the same array and surface its output in the final conclusion row.\`,
  \`If the user wants to recall an already-exposed value, just call the existing operation (no extra storage row).\`,
  \`There is **no domain/subdomain classification**. The operation key is a simple, free-form, slash-separated concept path followed by method/action pairs (e.g., "profile/preferences/color/by/user/get" or "inventory/items/search/via/api/get").\`,
  \`Do not put concrete values (names, ids, secrets, etc.) in the key. Put all concrete values in the "input" payload.\`,
  \`Every operation row is an object with a single key (the concept path). Its value has { "input": <object>, "schema": <JSON-Schema object> }.\`,
  \`The last row must be { "conclusion": <value or ref> } and should return the final value to the caller.\`
]

var response = [];

// Caller-provided context
const user_requests = ${JSON.stringify(promptObj?.userRequest ?? promptObj ?? "")};
const persistent_knowledge = [{"requester":"Austin Hughes", "Austin_Hughes_id":${userPath}}];
const relevant_items = ${JSON.stringify(promptObj?.relevantItems ?? [])};

const previous_request = [];
const previous_response = [];
const previous_processed_conclusion = [];

// Utilities for refs and executing remote crumbs
const REF_RE = /^__\\$ref\\((\\d+)\\)(?:\\.(.+))?$/;
const isOpKey = key => /^[\\w-]+\\/.+/.test(key);

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
    if (item && typeof item === "object" && Object.keys(item).length === 1) {
      const [key] = Object.keys(item);
      if (isOpKey(key)) {
        const payload = item[key];
        item = { output: await fetchCrumb(key, payload) };
      }
    }
    result.push(item);
  }

  const last = walk(source.at(-1), [...context, ...result]);
  target.length = 0;
  if (Array.isArray(last.conclusion)) target.push(...last.conclusion);
  else target.push(last.conclusion);
  return;
}

(async () => {
  await processArray(previous_response, [], previous_processed_conclusion);
  console.log(previous_processed_conclusion)
})();

// -------------------------- rules ---------------------------------
// (No domain/subdomain taxonomy. Keys are simple, conceptual paths.)
operation_rules = [
  /* 0 */ \`Format → <concept path> / (method/action pairs)+\`,
  /* 1 */ \`Concept path → 1+ slash segments describing the feature (e.g. profile/preferences/color, inventory/availability, contacts/notes).\`,
  /* 2 */ \`Method/action pairs → One or more pairs like by/user/get, via/api/get, by/system/check.\`,
  /* 3 */ \`Input payload → Put all concrete values (names, ids, strings) into "input".\`,
  /* 4 */ \`Schema → JSON-Schema describing the expected output from the operation.\`,
  /* 5 */ \`Conclusion → The last array row must return the final value.\`
];

// ------------------------- examples -------------------------------
examples = [
  \`"My favorite color is red" => [
      { "user": "1000000003" },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "string",
        "const": "red"
      },
      {
        "profile/preferences/color/by/user/get": {
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
        "profile/preferences/color/by/user/get": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      { "conclusion": "__$ref(2).output" } // ==> previously stored value
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
        "inventory/stock-verification/by/system/check/availability": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      {
        "appointments/demo-booking/by/employee/check/availability": {
          "input": "__$ref(3).output.approved-data",
          "schema": "__$ref(2)"
        }
      },
      {
        "conclusion": { "availability": "__$ref(4).output" }
      }
  ]\`
]

// RESPOND LIKE THE EXAMPLES ONLY`
          );
        })();
        // ↑↑↑ UPDATED PROMPT (no domain/subdomain) ↑↑↑

        // Use fixedPrompt to drive arrayLogic creation on the server
        arrayLogic = fixedPrompt;
      } else if (typeof arrayLogic === "string" && arrayLogic.trim().startsWith("[")) {
        arrayLogic = JSON.parse(arrayLogic);
        sourceType = "arrayLogic";
      }

      // ─────────────────────────────────────────────────────────────
      // 9) Hand off to parseArrayLogic (passes essence `out` and requestOnly flag)
      // ─────────────────────────────────────────────────────────────
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
        e,
        requestOnly,
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

        // Always run the runner (with a stub if no published)
        let shorthandLogic;
        if (jsonpl?.published) {
          shorthandLogic = JSON.parse(JSON.stringify(jsonpl));
        } else {
          // minimal shell so the runner can execute with virtual input
          shorthandLogic = { published: { actions: [], modules: {} } };
        }

        const blocks = shorthandLogic.published?.blocks ?? [];
        const originalPublished = shorthandLogic.published;

        // Feed virtual input always. If we had published, also feed it physically.
        shorthandLogic.input = [{ virtual: virtualArray }];
        if (jsonpl?.published) {
          shorthandLogic.input.unshift({ physical: [[shorthandLogic.published]] });
        }

        const fakeReqPath = `/cookies/convert/${actionFile}`;
        const legacyReqBody = { body: body.body || {} };

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

        // Preserve original block listing for parity
        if (newShorthand?.published) {
          newShorthand.published.blocks = blocks;
        }

        // Extract conclusion payload (runner may wrap it)
        const rawConclusion = JSON.parse(JSON.stringify(newShorthand?.conclusion || null));
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

        // Cleanup fields we don't want to echo
        if (newShorthand) {
          delete newShorthand.input;
          delete newShorthand.conclusion;
        }

        // Equality hint (only meaningful if we actually had a published doc)
        if (parseResults) {
          parseResults.isPublishedEqual =
            JSON.stringify(originalPublished) === JSON.stringify(newShorthand?.published);
        }

        // Persist updated published logic only when there was a real published doc
        if (actionFile && jsonpl?.published) {
          try {
            await s3
              .putObject({
                Bucket: "public.1var.com",
                Key: actionFile,
                Body: JSON.stringify(newShorthand),
                ContentType: "application/json",
              })
              .promise();
          } catch (err) {
            console.error("S3 putObject failed:", err && err.message);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 10) Final response envelope
      // ─────────────────────────────────────────────────────────────
      const mainObj = {
        parseResults,
        newShorthand,
        arrayLogic: parseResults?.arrayLogic,
        conclusion,
        entity: entityFromConclusion || "",
        createdEntities,
        existing: !!(meta && meta.cookie && meta.cookie.existing),
        file: String((entityFromConclusion || actionFile || "")),
      };

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
