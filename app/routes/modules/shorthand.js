// routes/modules/shorthand.js
/**
 * Action:  /cookies/shorthand/:su
 * Body:    { body: { arrayLogic: [...], emit?: "..." } }
 *
 * Reads the published JSON for :su (from public bucket), injects the provided
 * shorthand array into the engine, persists the updated JSON back to S3, and
 * returns a compact payload. If shared.use.convertToJSON exists, we also try to
 * return a computed tree (best-effort).
 */
module.exports.register = ({ on, use }) => {
  on("shorthand", async (ctx /*, { cookie } */) => {
    const { s3, openai, Anthropic, dynamodb, dynamodbLL, uuidv4, ses } = ctx.deps || {};
    const parts = (ctx.path || "").split("?")[0].split("/");
    const su = parts[3] || "";
    const body = ctx.req?.body || {};
    const payload = body.body || {};
    const arrayLogic = payload.arrayLogic;

    if (!su) return { ok: false, error: "Missing entity id (su) in path." };
    if (!Array.isArray(arrayLogic)) {
      return { ok: false, error: "body.arrayLogic must be an array." };
    }

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

    // Load current published doc
    const doc = await s3GetJSON("public.1var.com", su);

    // Prepare the engine input to match legacy pipeline
    const blocksBackup = Array.isArray(doc?.published?.blocks)
      ? JSON.parse(JSON.stringify(doc.published.blocks))
      : [];

    const engineInput = JSON.parse(JSON.stringify(doc));
    engineInput.input = Array.isArray(arrayLogic) ? [...arrayLogic] : [];
    engineInput.input.unshift({ physical: [[engineInput.published]] });

    // Run the shorthand engine
    const { shorthand } = require("../shorthand"); // existing engine
    const newShorthand = await shorthand(
      engineInput,
      ctx.req,
      ctx.res,
      null,                         // next
      null,                         // privateKey (not needed by engine paths that we use)
      dynamodb,
      uuidv4,
      s3,
      ses,
      openai,
      Anthropic,
      dynamodbLL,
      true,                         // keep "isPublished" style
      ctx.path,
      body,
      ctx.req?.method,
      ctx.req?.type,
      ctx.res?.headersSent,
      ctx.signer,
      "shorthand",
      ctx.req?.headers?.["x-accesstoken"] || ctx.req?.headers?.["X-accessToken"]
    );

    // Restore blocks; strip transients; persist
    newShorthand.published.blocks = blocksBackup;
    const content = JSON.parse(JSON.stringify(newShorthand.content || null));
    delete newShorthand.input;
    delete newShorthand.content;

    await s3PutJSON("public.1var.com", su, newShorthand);

    const result = { ok: true, su, newShorthand, content };

    // Best-effort: if shared.use.convertToJSON is available, add a tree
    if (use && typeof use.convertToJSON === "function") {
      try {
        result.view = await use.convertToJSON(su, ctx, { body: body });
      } catch {
        // non-fatal; omitted
      }
    }

    return result;
  });
};
