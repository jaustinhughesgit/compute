// modules/saveFile.js
"use strict";

/**
 * Saves the provided JSON to S3 at the entity's SU name, and returns convertToJSON.
 */
async function saveFileHandle(ctx) {
  const {
    s3, dynamodb, uuidv4, dynamodbLL,
    convertToJSON, getSub, setIsPublic,
    reqPath, reqBody, cookie
  } = ctx;

  // Path: /<anything>/saveFile/:su
  const segs = (reqPath || "").split("/");
  const su = segs[3];

  // Determine public/private from subdomain row (authoritative),
  // but also try to read it from convertToJSON meta if available.
  const sub = await getSub(su, "su", dynamodb);
  setIsPublic(sub.Items?.[0]?.z);

  const mainObj = await convertToJSON(
    su, [], null, null, cookie, dynamodb, uuidv4,
    null, [], {}, "", dynamodbLL, reqBody
  );

  const defaultLocation =
    (sub.Items?.[0]?.z === true || sub.Items?.[0]?.z === "true") ? "public" : "private";

  const metaLocation = mainObj?.obj?.[su]?.meta?.location; // "public" | "private"
  const bucketName = (metaLocation || defaultLocation) + ".1var.com";

  const payload = (reqBody && Object.prototype.hasOwnProperty.call(reqBody, "body"))
    ? reqBody.body
    : reqBody;

  await s3.putObject({
    Bucket: bucketName,
    Key: su,
    Body: (typeof payload === "string") ? payload : JSON.stringify(payload),
    ContentType: "application/json"
  }).promise();

  return { mainObj, actionFile: su };
}

// keep old-style usage
module.exports.handle = saveFileHandle;

// new auto-wiring entry for cookies.js registerModule(...)
module.exports.register = function register({ on /*, use */ }) {
  on("saveFile", saveFileHandle);
};
