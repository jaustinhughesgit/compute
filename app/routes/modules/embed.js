// routes/modules/embed.js
"use strict";

/**
 * Action:  /cookies/embed
 * Body:    { body: { text: string|JSON-string, requestId?: string } }
 *
 * Returns an OpenAI embedding for the provided text.
 */
module.exports.register = ({ on /*, use */ }) => {
  on("embed", async (ctx) => {
    try {
      const { openai } = (ctx.deps || {});
      if (!openai) return { ok: false, error: "OpenAI client not available." };

      // Be robust to either ctx.reqBody or raw Express req.body
      const body = ctx.reqBody ?? ctx.req?.body ?? {};
      const b = body.body ?? body;
      let text = b?.text;

      if (typeof text !== "string") {
        return { ok: false, error: "body.text must be a string." };
      }

      // Legacy behavior: if it's a JSON string, parse then re-stringify (normalizes whitespace/ordering)
      try {
        const parsed = JSON.parse(text);
        text = JSON.stringify(parsed);
      } catch {
        // not JSON; use as-is
      }

      const { data } = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: text,
      });

      const emb = Array.isArray(data) && data[0] ? data[0].embedding : null;
      if (!emb) return { ok: false, error: "Embedding failed." };

      return { ok: true, embedding: emb, requestId: b.requestId };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
};
