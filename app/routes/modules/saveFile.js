// modules/saveFile.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    manageCookie, getVerified, verifyPath, allVerified,
    convertToJSON, createFile,
    // raw deps bag if needed
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  on("saveFile", async (ctx /*, meta */) => {
    const { req, res, path } = ctx;
    const { dynamodb, dynamodbLL, uuidv4, s3 } = (ctx.deps || deps || {});

    // ── Auth/cookie+verification (strict parity with legacy flow) ─────────────
    const cookie = await manageCookie({}, ctx.xAccessToken, res, dynamodb, uuidv4);
    const verifications = await getVerified("gi", cookie.gi.toString(), dynamodb);

    // In legacy, verifyPath consumed the original path split; recreate a compatible value.
    const fullPathForVerify =
      (req && typeof req.path === "string" && req.path) ||
      `/${(ctx.type || "cookies")}/saveFile${String(path || "")}`;
    const splitPath = String(fullPathForVerify).split("/");

    const verified = await verifyPath(splitPath, verifications, dynamodb);
    const allV = allVerified(verified);
    if (!allV) {
      // Legacy returned an empty JSON body on failed verification.
      return {};
    }

    // ── Path parsing: /saveFile/:fileID/... → fileID is first seg in ctx.path ─
    const segs = String(path || "").split("/").filter(Boolean);
    const actionFile = segs[0] || "";

    // ── Maintain legacy request-body handling (flattened vs legacy body.body) ─
    // Legacy code passed the *entire* reqBody into convertToJSON, and for createFile:
    //   if (!reqBody.body) createFile(fileID, reqBody) else createFile(fileID, reqBody.body)
    // We emulate that exactly using the current req.body shape.
    const hasLegacyEnvelope =
      req && req.body && typeof req.body === "object" && Object.prototype.hasOwnProperty.call(req.body, "body");

    // Pass-through for convertToJSON (legacy passed "reqBody" positionally as the 'body' arg)
    const bodyForConvert = hasLegacyEnvelope ? req.body : req.body;

    // ── Convert & then persist file payload exactly like before ───────────────
    const mainObj = await convertToJSON(
      actionFile,
      [],
      null,
      null,
      cookie,
      dynamodb,
      uuidv4,
      null,
      [],
      {},
      "",
      dynamodbLL,
      bodyForConvert
    );

    if (!hasLegacyEnvelope) {
      await createFile(actionFile, req.body, s3);
    } else {
      await createFile(actionFile, req.body.body, s3);
    }

    // Legacy always appended these fields before the final sendBack()
    mainObj.existing = cookie.existing;
    mainObj.file = actionFile + "";

    // Legacy sendBack(..., { ok: true, response }) shape:
    return { ok: true, response: mainObj };
  });

  return { name: "saveFile" };
}

module.exports = { register };
