/* --------------------------------------------------------------------
 *  routes/shorthandConverter.js   (updated 2025‑05‑30)
 *  ------------------------------------------------------------------
 *  convertToShorthand(params)
 *
 *      params = {
 *        // choose ONE of the next two:
 *        prompt?      : string,         // natural‑language prompt → GPT‑4o
 *        arrayLogic?  : string|object[],// pre‑built arrayLogic (string or parsed array)
 *
 *        // required clients – pass the SAME ones used in app.js
 *        openai       : OpenAI,         // already initialised
 *        s3           : AWS.S3,         // already initialised
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

  const params = { Bucket: "public.1var.com", Key: `subIndexes/${root}.json` };
  console.log("s3 params", params)
  try {
    const { Body } = await s3.getObject(params).promise();
    console.log("Body", Body)
    const json = JSON.parse(Body.toString("utf8")); // { subRoot: [1536] }
    console.log("json", json)
    subIndexCache.set(root, json);
    return json;
  } catch (err) {
    // Gracefully degrade when a sub‑index file isn’t present – keep going with
    // an empty index instead of throwing and killing the whole conversion.
    if (err.code === "NoSuchKey" || err.code === "NotFound") {
      const empty = {};
      subIndexCache.set(root, empty);
      return empty; // caller will detect empty map and skip normalisation
    }
    // Bubble up anything unexpected (permissions, network, etc.)
    throw err;
  }
}

/* ─────────────── embed a text string ─────────────── */
async function embed(text, openai) {
  console.log("embed",text)
  let split = text.split("/")
  if (split.length > 1){
    const { data } = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: split[1],
    });
  }
  return data[0].embedding;
}

/* ─────────────── pick best sub‑root for root ─────────────── */
async function bestSubRoot(root, bcEmbed, s3, openai) {
    console.log("root", root)
  const index = await loadSubIndex(root, s3);
  console.log("index", index)
  // short‑circuit: if the index is empty (file missing), just skip normalisation
  if (!index || Object.keys(index).length === 0) return null;

  let best = { key: null, score: -Infinity };
  for (const [subRoot, vec] of Object.entries(index)) {
    const score = cosine(bcEmbed, vec);
    console.log("score", subRoot, score)
    if (score > best.score) best = { key: subRoot, score };
  }
  console.log("best.key", best.key)
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

  // If we couldn’t find a sub‑index (or it’s empty) just leave the key as‑is.
  if (!subRoot) return key;

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

/* ─────────────── helper: arrayLogic string → parsed object[] ─────────────── */
/**
 * Accepts a pseudo‑JSON string used in prompts/configs (may contain bare‑word
 * tokens such as `hidden`, `number`, `boolean`, `object`, `array`, or complex
 * `ref(3).path` expressions) and converts it into real JSON that can be parsed
 * by `JSON.parse`.
 *
 * Algorithm:
 *   1. Strip template‑literal back‑ticks (if present).
 *   2. Split the string on double‑quoted substrings to preserve existing quotes.
 *   3. On *unquoted* segments, wrap sentinel literals and any `ref(...)` tokens
 *      in double‑quotes.
 */
function parseArrayLogicString(str) {
  if (typeof str !== "string") return str;

  const trimmed = str.trim().replace(/^`|`$/g, "");
  if (!trimmed.startsWith("[")) {
    throw new Error("convertToShorthand: arrayLogic string must start with [ … ] JSON‑array syntax");
  }

  // Regexes for replacements on unquoted segments only.
  const PRIMITIVE_RX = /\b(hidden|string|number|boolean|object|array)\b/g;
  const REF_RX_ALL   = /ref\(\d+\)(?:\.[A-Za-z0-9_]+)*/g;

  const segments = trimmed.split(/("(?:[^"\\]|\\.)*")/); // keep quoted parts

  const rebuilt = segments.map((seg, idx) => {
    // odd indexes are quoted substrings – leave untouched
    if (idx % 2 === 1) return seg;
    // even indexes are outside quotes – safe to transform
    return seg
      .replace(PRIMITIVE_RX, '"$1"')
      .replace(REF_RX_ALL, (m) => `"${m}"`);
  }).join("");

  return JSON.parse(rebuilt);
}

/* ─────────────── MAIN EXPORT ─────────────── */
async function convertToShorthand(params = {}) {
    console.log("params", params)
  const { openai, s3, prompt, arrayLogic } = params;

  if (!openai || !s3)
    throw new Error("convertToShorthand: params must include { openai, s3 }");
  if (!prompt && !arrayLogic)
    throw new Error("convertToShorthand: supply either prompt or arrayLogic");

  /* 1️⃣  Obtain arrayLogic */
  let logic = arrayLogic;
  if (prompt) {
    logic = await llmArrayLogic(prompt, openai);  // always an array
  }

  // If logic is delivered as a string, sanitise & parse it into an object[]
  if (typeof logic === "string") {
    logic = parseArrayLogicString(logic);
  }

  if (!Array.isArray(logic)) {
    throw new Error("convertToShorthand: arrayLogic must resolve to an array after parsing");
  }

  /* 2️⃣  Normalise breadcrumb keys */
  const normalised = await walkAndNormalise(logic, s3, openai);

  /* 3️⃣  ref substitution → 2‑D shorthand matrix */
  return normalised.map((obj) => ["JSON", JSON.stringify(convertRefs(obj))]);
}

module.exports = { convertToShorthand };
