// modules/embed.js
"use strict";

function register({ on, use }) {
  const { deps } = use(); // { openai, ... }
  const EMB_MODEL_ID = process.env.EMB_MODEL || "text-embedding-3-large";

  // Preserve legacy "flattened or legacy body.body" handling
  function unwrapBody(b) {
    if (!b || typeof b !== "object") return b;
    if (b.body && typeof b.body === "object") return b.body;
    return b;
  }

  const toUnit = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    let ss = 0;
    for (const v of arr) {
      const f = +v;
      if (!Number.isFinite(f)) return null;
      ss += f * f;
    }
    const n = Math.sqrt(ss);
    if (n < 1e-12) return null;
    return arr.map((v) => +v / n);
  };

  const normalizeInputText = (val) => {
    // Accept: string, number, object, array
    if (typeof val === "string") {
      const t = val.trim();
      // If it *looks* like JSON, try to parse, otherwise use as-is
      if (t.startsWith("{") || t.startsWith("[")) {
        try { return JSON.stringify(JSON.parse(t)); }
        catch { /* fall through to raw */ }
      }
      return t;
    }
    if (val == null) return "";
    // Non-string: embed a JSON representation (stable behavior)
    try { return JSON.stringify(val); } catch { return String(val); }
  };

  on("embed", async (ctx) => {
    const { req } = ctx;
    const flat = unwrapBody(req?.body || {});

    try {
      // 1) If the caller already provided an embedding, pass it through (unit-normalized)
      if (Array.isArray(flat?.embedding)) {
        const u = toUnit(flat.embedding);
        if (!u) throw new Error("Invalid embedding array");
        return { embedding: u, requestId: flat?.requestId };
      }

      // 2) Otherwise, we need text
      const text = normalizeInputText(flat?.text);
      if (!text) throw new Error("Missing 'text' (or 'embedding') in request body.");

      const { data } = await deps.openai.embeddings.create({
        model: EMB_MODEL_ID,
        input: text,
      });

      return {
        embedding: data?.[0]?.embedding || [],
        requestId: flat?.requestId,
      };
    } catch (err) {
      // Keep route behavior consistent with the shared dispatcher
      // If an upstream Express res is present, the dispatcher will catch & serialize.
      throw err;
    }
  });

  return { name: "embed" };
}

module.exports = { register };
