// modules/shorthand.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getDocClient,
    getS3,
    retrieveAndParseJSON,
    convertToJSON,
    manageCookie,
    getVerified,
    verifyPath,
    allVerified,
    // raw deps bag if needed
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  on("shorthand", async (ctx /*, meta */) => {
    console.log("ctx",ctx)
    const { req, res, path, type, signer } = ctx;

    const dynamodb = getDocClient();
    const s3 = getS3();

    // Preserve legacy dual-shape body handling (flattened or { body: {...} })
    const wrapBody = (b) => {
      if (!b || typeof b !== "object") return { body: b };
      if (b.body && typeof b.body === "object") return b; // already legacy-shaped
      return { body: b }; // wrap flattened
    };

    // Determine target file (legacy used reqPath.split("/")[3])
    const segs = String(path || "").split("/").filter(Boolean);
    const actionFile = segs[0] || "";

    // ── Cookie + path verification (parity with legacy route) ───────────────────
    const mainObj = {};
    const cookie = await manageCookie(mainObj, ctx.xAccessToken, res, dynamodb, deps.uuidv4);

    try {
      const verifications = await getVerified("gi", String(cookie?.gi ?? ""), dynamodb);
      const splitPath = String(req?.path || "").split("/");
      const verified = await verifyPath(splitPath, verifications, dynamodb);
      if (!allVerified(verified)) return {};
    } catch (_err) {
      // On verification helper failure, mimic legacy by returning empty payload.
      return {};
    }

    const wrapped = wrapBody(req?.body || {});
    const body = wrapped.body || {};
    const arrayLogic = body.arrayLogic;
    const emitType = body.emit; // kept for parity (not used directly)

    // Load current published JSON and prepare shorthand input (parity)
    const jsonpl = await retrieveAndParseJSON(actionFile, true);
    const shorthandLogic = JSON.parse(JSON.stringify(jsonpl));
    const blocks = shorthandLogic?.published?.blocks;
    const originalPublished = shorthandLogic.published;

    shorthandLogic.input = arrayLogic;
    if (Array.isArray(shorthandLogic.input)) {
      shorthandLogic.input.unshift({ physical: [[shorthandLogic.published]] });
    }

    // Call legacy shorthand engine with the original argument order
    const { shorthand } = require("../shorthand");
    const newShorthand = await shorthand(
      shorthandLogic,
      req,
      res,
      undefined,                              // next
      undefined,                              // privateKey
      dynamodb,
      deps.uuidv4,
      s3,
      deps.ses,
      deps.openai,
      deps.Anthropic,
      deps.dynamodbLL,
      true,                                   // isShorthand
      req?.path,                              // reqPath
      wrapped,                                // reqBody (preserve legacy shape)
      req?.method,                            // reqMethod
      type,                                   // reqType
      res?.headersSent || req?._headerSent,   // reqHeaderSent
      signer,
      "shorthand",                            // action
      ctx.xAccessToken
    );

    // Restore blocks; strip temp fields; compute equality (parity)
    if (blocks && newShorthand?.published) {
      newShorthand.published.blocks = blocks;
    }
    const content = JSON.parse(JSON.stringify(newShorthand.content));
    delete newShorthand.input;
    delete newShorthand.content;

    // Keep equality calc for parity (not returned)
    const isPublishedEqual =
      JSON.stringify(originalPublished) === JSON.stringify(newShorthand.published);
    void isPublishedEqual;

    // Persist to S3 exactly as before
    await s3
      .putObject({
        Bucket: "public.1var.com",
        Key: actionFile,
        Body: JSON.stringify(newShorthand),
        ContentType: "application/json",
      })
      .promise();

    // Return same response shape as legacy: convertToJSON + extras
    const result = await convertToJSON(
      actionFile,
      [],
      null,
      null,
      cookie,
      dynamodb,
      deps.uuidv4,
      null,
      [],
      {},
      "",
      deps.dynamodbLL,
      wrapped
    );

    result["newShorthand"] = newShorthand;
    result["content"] = content;
    result["existing"] = cookie?.existing;
    result["file"] = String(actionFile);

    // Legacy route wrapped responses as { ok: true, response: ... }
    return { ok: true, response: result };
  });

  return { name: "shorthand" };
}

module.exports = { register };
