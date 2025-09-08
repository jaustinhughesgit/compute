// routes/modules/embed.js
/**
 * Action:  /cookies/embed
 * Body:    { body: { text: string|JSON-string, requestId?: string } }
 *
 * Returns an OpenAI embedding for the provided text.
 */
module.exports.register = ({ on /*, use */ }) => {
  on("embed", async (ctx) => {
    const { openai } = ctx.deps || {};
    if (!openai) return { ok: false, error: "OpenAI client not available." };

    const body = ctx.req?.body || {};
    const b = body.body || {};
    let text = b.text;

    if (typeof text !== "string") return { ok: false, error: "body.text must be a string." };

    // if it's a JSON string, keep the same behavior as legacy (parse then stringify)
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
  });
};
