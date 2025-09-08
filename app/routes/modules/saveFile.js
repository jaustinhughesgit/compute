// modules/saveFile.js
/**
 * Saves the provided JSON to S3 at the entity's SU name, and returns convertToJSON.
 */
module.exports.handle = async function saveFileHandle(ctx) {
  const {
    s3, dynamodb, uuidv4, dynamodbLL,
    convertToJSON, getSub, setIsPublic,
    reqPath, reqBody, cookie
  } = ctx;

  // Path: /<anything>/saveFile/:su
  const segs = reqPath.split("/");
  const su = segs[3];

  const sub = await getSub(su, "su", dynamodb);
  setIsPublic(sub.Items[0].z);

  const mainObj = await convertToJSON(su, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody);

  const payload = reqBody.body ?? reqBody; // route supports both
  await s3.putObject({
    Bucket: mainObj?.obj?.[su]?.meta?.location === "public" ? "public.1var.com" : "private.1var.com",
    Key: su,
    Body: JSON.stringify(payload),
    ContentType: "application/json"
  }).promise();

  return { mainObj, actionFile: su };
};
