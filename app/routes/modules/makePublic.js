// modules/makePublic.js
"use strict";

/**
 * Toggles file visibility by moving *all versions* between buckets via updateSubPermission,
 * then returns a fresh convertToJSON of the file.
 */
async function makePublicHandle(ctx) {
  const {
    dynamodb, s3, uuidv4, dynamodbLL,
    convertToJSON, updateSubPermission,
    reqPath, reqBody, cookie
  } = ctx;

  // Path: /<anything>/makePublic/:su/:permission
  const segs = (reqPath || "").split("/");
  const su = segs[3];
  const permission = segs[4]; // "true" | "false"

  await updateSubPermission(su, permission, dynamodb, s3);

  const mainObj = await convertToJSON(
    su, [], null, null, cookie,
    dynamodb, uuidv4, null, [], {}, "",
    dynamodbLL, reqBody
  );

  return { mainObj, actionFile: su };
}

// Back-compat named export
module.exports.handle = makePublicHandle;

/** Register hook for the module loader */
module.exports.register = function register({ on /*, use */ }) {
  on("makePublic", makePublicHandle);
};
