// routes/modules/convert.js
/**
 * Action:  /cookies/convert/:su
 * Body:    {
 *   body: {
 *     arrayLogic?: Array|String(JSON),
 *     prompt?: String(JSON with {userRequest, relevantItems}),
 *     emit?: string
 *   }
 * }
 *
 * 1) Runs parseArrayLogic first.
 * 2) If a shorthand payload is produced, immediately runs the shorthand engine,
 *    saves to S3 public, and returns the parseResults + newShorthand + conclusion.
 */
module.exports.register = ({ on, use }) => {
  on("convert", async (ctx /*, { cookie } */) => {
    const { s3, openai, Anthropic, dynamodb, dynamodbLL, uuidv4, ses } = ctx.deps || {};
    const parts = (ctx.path || "").split("?")[0].split("/");
    const su = parts[3] || "";
    const body = ctx.req?.body || {};
    const b = body.body || {};

    if (!su) return { ok: false, error: "Missing entity id (su) in path." };

    // Normalise input
    let arrayLogic = b.arrayLogic;
    let sourceType = "arrayLogic";

    if (typeof arrayLogic === "string") {
      try { arrayLogic = JSON.parse(arrayLogic); }
      catch (e) { return { ok: false, error: "arrayLogic is not valid JSON string." }; }
    }

    // If prompt supplied, embed it into the same style "fixed prompt" program the legacy used
    if (!arrayLogic && typeof b.prompt === "string") {
      sourceType = "prompt";
      let promptObj;
      try { promptObj = JSON.parse(b.prompt); } catch {
        return { ok: false, error: "prompt must be a JSON string." };
      }
      const userPath = 1000000000000128; // legacy default path

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

const user_requests = ${JSON.stringify(promptObj.userRequest || "")};

const persistent_knowledge = [{"requester":"Austin Hughes","Austin_Hughes_id":${userPath}}];

const relevant_items = ${JSON.stringify(promptObj.relevantItems || [])};

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

    if (item && typeof item === "object" && Object.keys(item).length === 1) {
      const [key] = Object.keys(item);
      if (isBreadcrumb(key)) {
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
}

(async () => {
  await processArray(previous_response, [], previous_processed_conclusion);
  console.log(previous_processed_conclusion)
})();`;

      arrayLogic = fixedPrompt; // this is what the legacy parser expects
    }

    if (!arrayLogic) return { ok: false, error: "Provide body.arrayLogic or body.prompt." };

    const { parseArrayLogic } = require("../parseArrayLogic"); // existing helper

    // First pass
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
    });

    let newShorthand = null;
    let conclusion = null;

    // If the parser returned a shorthand payload, immediately execute it
    if (parseResults?.shorthand) {
      const s3GetJSON = async (bucket, key) => {
        const obj = await s3.getObject({ Bucket: bucket, Key: key }).promise();
        return JSON.parse(obj.Body.toString("utf-8"));
      };
      const s3PutJSON = (bucket, key, json) =>
        s3.putObject({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(json),
          ContentType: "application/json",
        }).promise();

      const doc = await s3GetJSON("public.1var.com", su);
      const blocksBackup = Array.isArray(doc?.published?.blocks)
        ? JSON.parse(JSON.stringify(doc.published.blocks))
        : [];

      const engineInput = JSON.parse(JSON.stringify(doc));
      // Convert route wraps the shorthand as a "virtual" block per legacy
      engineInput.input = [{ virtual: JSON.parse(JSON.stringify(parseResults.shorthand)) }];
      engineInput.input.unshift({ physical: [[engineInput.published]] });

      const { shorthand } = require("../shorthand");

      const out = await shorthand(
        engineInput,
        ctx.req,
        ctx.res,
        null,
        null,
        dynamodb,
        uuidv4,
        s3,
        ses,
        openai,
        Anthropic,
        dynamodbLL,
        true,
        ctx.path,
        body,
        ctx.req?.method,
        ctx.req?.type,
        ctx.res?.headersSent,
        ctx.signer,
        "shorthand",
        ctx.req?.headers?.["x-accesstoken"] || ctx.req?.headers?.["X-accessToken"]
      );

      out.published.blocks = blocksBackup;
      conclusion = JSON.parse(JSON.stringify(out.conclusion || null));
      delete out.input;
      delete out.conclusion;

      newShorthand = out;
      await s3PutJSON("public.1var.com", su, newShorthand);
    }

    const result = {
      ok: true,
      su,
      parseResults,
      newShorthand,
      arrayLogic: parseResults?.arrayLogic,
      conclusion,
    };

    // Best-effort tree (if available via shared.use)
    if (use && typeof use.convertToJSON === "function") {
      try {
        result.view = await use.convertToJSON(su, ctx, { body });
      } catch {
        // ignore
      }
    }

    return result;
  });
};
