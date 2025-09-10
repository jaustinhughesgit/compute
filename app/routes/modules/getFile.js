// modules/getFile.js
//"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getDocClient,
    retrieveAndParseJSON,
    manageCookie,
    getVerified,
    verifyPath,
    allVerified,
    // raw deps if needed
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  on("getFile", async (ctx /*, meta */) => {
    const { req, res, path } = ctx;

    // ── legacy: cookie/auth/verification flow (unchanged) ──────────────────────
    const dynamodb = getDocClient();
    const uuidv4 = deps?.uuidv4;

    const mainObj = {};
    const cookie = await manageCookie(mainObj, ctx.xAccessToken, res, dynamodb, uuidv4);

    // Build splitPath identically to old code: prefer the full Express path
    const fullPath = String(req?.path || ("/cookies/getFile" + String(path || "")));
    const splitPath = fullPath.split("/");

    const verifications = await getVerified("gi", String(cookie?.gi ?? ""), dynamodb);
    const verified = await verifyPath(splitPath, verifications, dynamodb);
    const allV = allVerified(verified);

    if (!allV) {
      // strict parity: old route called sendBack(res,"json",{},isShorthand)
      // which returned an empty object body
      return {};
    }

    // ── legacy: path parsing for file id (unchanged) ───────────────────────────
    // old: actionFile = reqPath.split("/")[3]
    // new router gives us `path` as "/<fileID>[/...]" after the action segment
    const segs = String(path || "").split("/").filter(Boolean);
    const actionFile = segs[0] || "";

    // ── legacy: S3 read via retrieveAndParseJSON(fileID, true) ─────────────────
    // (hard-coded `true` preserved)
    const jsonpl = await retrieveAndParseJSON(actionFile, true);
    const payload = JSON.parse(JSON.stringify(jsonpl));

    // ── legacy: decorate response with .existing and .file ─────────────────────
    payload.existing = cookie.existing;
    payload.file = actionFile + "";

    // ── legacy: final response shape { ok: true, response } ────────────────────
    const response = payload;
    return { ok: true, response };
  });

  return { name: "getFile" };
}

module.exports = { register };
