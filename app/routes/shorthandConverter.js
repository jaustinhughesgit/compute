/* --------------------------------------------------------------------
 *  routes/shorthandConverter.js
 *  ------------------------------------------------------------------
 *  convertToShorthand(params)
 *
 *      params = {
 *        // choose ONE of the next two:
 *        prompt?      : string,     // natural‑language prompt → GPT‑4o
 *        arrayLogic?  : object[],   // pre‑built arrayLogic
 *
 *        // required clients – pass the SAME ones used in app.js
 *        openai       : OpenAI,     // already initialised
 *        s3           : AWS.S3,     // already initialised
 *      }
 *
 *  Returns: shorthand 2‑D matrix  →  [["JSON","{…}"], …]
 * ------------------------------------------------------------------ */

const subIndexCache = new Map();              // root → { subRoot: [vec] }

/* ╔═══════════════  tiny vector helpers ═══════════════╗ */
const dot       = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const magnitude = (a)    => Math.sqrt(dot(a, a));
const cosine    = (a, b) => dot(a, b) / (magnitude(a) * magnitude(b));
/* ╚════════════════════════════════════════════════════╝ */

/* ─────────────── fetch sub‑index file via S3 ─────────────── */
async function loadSubIndex(root, s3) {
  if (subIndexCache.has(root)) return subIndexCache.get(root);

  const params = { Bucket: "public.1var.com", Key: `subIndexs/${root}.json` };
  const { Body } = await s3.getObject(params).promise();
  const json    = JSON.parse(Body.toString("utf8"));    // { subRoot: [1536] }

  subIndexCache.set(root, json);
  return json;
}

/* ─────────────── embed a text string ─────────────── */
async function embed(text, openai) {
  const { data } = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return data[0].embedding;
}

/* ─────────────── pick best sub‑root for root ─────────────── */
async function bestSubRoot(root, bcEmbed, s3, openai) {
  const index = await loadSubIndex(root, s3);
  let best = { key: null, score: -Infinity };

  for (const [subRoot, vec] of Object.entries(index)) {
    const score = cosine(bcEmbed, vec);
    if (score > best.score) best = { key: subRoot, score };
  }
  return best.key;
}

/* ─────────────── normalise a breadcrumb key ─────────────── */
async function normaliseBreadcrumb(key, s3, openai) {
  if (!key.includes("/")) return key;
  const parts = key.split("/");
  if (parts.length < 2) return key;

  const [root, , ...rest] = parts;
  const bcEmbed = await embed(key, openai);
  const subRoot = await bestSubRoot(root, bcEmbed, s3, openai);

  return [root, subRoot, ...rest].join("/");
}

/* ─────────────── recursive walk / key rewrite ─────────────── */
async function walkAndNormalise(val, s3, openai) {
  if (Array.isArray(val)) {
    return Promise.all(val.map((v) => walkAndNormalise(v, s3, openai)));
  }
  if (val && typeof val === "object") {
    const entries = await Promise.all(
      Object.entries(val).map(async ([k, v]) => [
        await normaliseBreadcrumb(k, s3, openai),
        await walkAndNormalise(v, s3, openai),
      ]),
    );
    return Object.fromEntries(entries);
  }
  return val;
}

/* ─────────────── ref(n) → shorthand row/path ─────────────── */
const REF_RX  = /^ref\((\d+)\)(.*)$/i;
const toRowId = (n) => n.toString().padStart(3, "0");

function convertRefs(val) {
  if (Array.isArray(val))              return val.map(convertRefs);
  if (val && typeof val === "object")  return Object.fromEntries(
    Object.entries(val).map(([k, v]) => [k, convertRefs(v)]),
  );
  if (typeof val === "string") {
    const m = val.match(REF_RX);
    if (m) return `${toRowId(+m[1])}!!${m[2] || ""}`;
  }
  return val;
}

/* ─────────────── GPT‑4o helper: prompt → arrayLogic ─────────────── */
async function llmArrayLogic(prompt, openai) {
  const chat = await openai.chat.completions.create({
    model           : "gpt-4o-mini",      // adjust as available
    temperature     : 0,
    response_format : { type: "json_object" },
    messages: [
      {
        role   : "system",
        content:
          "You are an API that ONLY returns valid JSON – an array named "
          + '"arrayLogic". No prose, markdown or back‑ticks.',
      },
      { role: "user", content: prompt },
    ],
  });

  return JSON.parse(chat.choices[0].message.content);
}

/* ─────────────── MAIN EXPORT ─────────────── */
async function convertToShorthand(params = {}) {
  const { openai, s3, prompt, arrayLogic } = params;

  if (!openai || !s3)
    throw new Error("convertToShorthand: params must include { openai, s3 }");
  if (!prompt && !arrayLogic)
    throw new Error("convertToShorthand: supply either prompt or arrayLogic");

  /* 1️⃣  Obtain arrayLogic */
  let logic = arrayLogic;
  if (prompt) {
    logic = await llmArrayLogic(prompt, openai);
  }
  if (!Array.isArray(logic))
    throw new Error("convertToShorthand: arrayLogic must be an array");

  /* 2️⃣  Normalise breadcrumb keys */
  const normalised = await walkAndNormalise(logic, s3, openai);

  /* 3️⃣  ref substitution → 2‑D shorthand matrix */
  return normalised.map((obj) => ["JSON", JSON.stringify(convertRefs(obj))]);
}

module.exports = { convertToShorthand };