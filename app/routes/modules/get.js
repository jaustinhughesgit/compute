// modules/get.js
//"use strict";

function register({ on, use }) {
  const {
    // domain / utils from shared
    getDocClient,
    getVerified,
    getTasks, getTasksIOS,
    convertToJSON,
    manageCookie,
    // NEW: pulled from shared
    verifyPath, allVerified,
    // deps bag (unchanged)
    deps,
  } = use();

  on("get", async (ctx /*, meta */) => {
    const { req, res, path } = ctx;
    const dynamodb = getDocClient();

    // manage cookie (legacy behavior)
    const cookie = await manageCookie({}, ctx.xAccessToken, res, dynamodb, deps.uuidv4);

    // verify path (moved to shared; same logic)
    const segs = String(path || "").split("/").filter(Boolean);
    const verifications = await getVerified("gi", cookie.gi.toString(), dynamodb);
    const verifiedList = await verifyPath(segs, verifications, dynamodb);
    const isAllowed = allVerified(verifiedList);
    if (!isAllowed) return {}; // legacy empty response on denial

    // main legacy logic
    const fileID = segs[0] || "";
    let mainObj = await convertToJSON(
      fileID, [], null, null, cookie, dynamodb, deps.uuidv4,
      null, [], {}, "", deps.dynamodbLL, req?.body
    );

    const tasksUnix = await getTasks(fileID, "su", dynamodb);
    const tasksISO = await getTasksIOS(tasksUnix);
    mainObj["tasks"] = tasksISO;

    mainObj["existing"] = cookie.existing;
    mainObj["file"] = fileID + "";

    return { ok: true, response: mainObj};
  });

  return { name: "get" };
}

module.exports = { register };
