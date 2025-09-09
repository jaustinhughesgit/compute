// modules/embed.js
"use strict";

function register({ on, use }) {
  const {
    // raw deps bag (use only what's needed)
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // local helper: preserve legacy "flattened or legacy body.body" handling
  function unwrapBody(b) {
    if (!b || typeof b !== "object") return b;
    if (b.body && typeof b.body === "object") return b.body;
    return b;
  }

  on("embed", async (ctx /*, meta */) => {
    const { req /*, res, path, type, signer */ } = ctx;

    // parity with old route logging/shape expectations
    // (keep minimal logs if present upstream; safe to no-op if console isn’t desired)
    try { console.log("req.body", req?.body); } catch {}

    const flat = unwrapBody(req?.body || {});
    try { console.log("flat (legacy body.body supported)", flat); } catch {}

    // legacy flow:
    //  text is a JSON string → JSON.parse → JSON.stringify → embed
    let text = flat?.text;
    let parsedText = JSON.parse(text);
    let stringifyText = JSON.stringify(parsedText);

    const { data } = await deps.openai.embeddings.create({
      model: "text-embedding-3-large",
      input: stringifyText,
    });

    // preserve response shape/keys
    return {
      embedding: data[0].embedding,
      requestId: flat?.requestId,
    };
  });

  return { name: "embed" };
}

module.exports = { register };
