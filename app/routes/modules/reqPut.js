// modules/reqPut.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    fileLocation, getHead, manageCookie, sendBack, getS3,
    // raw deps (for manageCookie parity)
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  on("reqPut", async (ctx) => {
    const { req, res, path } = ctx;
    const { dynamodb, uuidv4 } = deps;

    // 0) Ensure we have a cookie (router usually minted one already)
    const mainObj = {};
    const cookie =
      ctx.cookie ||
      (await manageCookie(mainObj, ctx.xAccessToken, res, dynamodb, uuidv4));

    // 1) The S3 key is the entire normalized tail (no leading slash)
    const actionFile = String(path || "/").replace(/^\//, "");

    // 2) Bucket selection (public/private)
    // Try to infer from head.z when the first path segment looks like a subdomain id
    const firstSeg = actionFile.split("/")[0] || "";
    let isPublic = false;
    try {
      if (/^1v4r/i.test(firstSeg)) {
        const head = await getHead("su", firstSeg, dynamodb);
        isPublic = !!(head?.Items?.[0]?.z);
      }
    } catch (_) {
      // fall back to default (false) if lookup fails
    }
    // Optional explicit override via query/body
    const pubOverride =
      req?.query?.public ?? req?.body?.public ?? req?.query?.isPublic ?? req?.body?.isPublic;
    if (typeof pubOverride !== "undefined") {
      const truthy = ["1", 1, true, "true", "yes", "public"];
      isPublic = truthy.includes(pubOverride);
    }

    const bucketName = `${fileLocation(isPublic)}.1var.com`;

    // 3) Content type inputs (legacy-compatible)
    const fileCategory =
      req?.query?.fileCategory ||
      req?.body?.fileCategory ||
      req?.query?.category ||
      req?.body?.category ||
      "application";

    const fileType =
      req?.query?.fileType ||
      req?.body?.fileType ||
      req?.query?.type ||
      req?.body?.type ||
      "octet-stream";

    const expires = 90_000; // ms → AWS expects seconds below

    // 4) Sign a PUT URL (AWS SDK v2 compat)
    const params = {
      Bucket: bucketName,
      Key: actionFile,
      Expires: Math.floor(expires / 1000),
      ContentType: `${fileCategory}/${fileType}`,
    };

    const s3 = getS3(); // uses shared-configured S3 client
    const getSignedUrlAsync = (op, p) =>
      new Promise((resolve, reject) =>
        s3.getSignedUrl(op, p, (err, url) => (err ? reject(err) : resolve(url)))
      );

    try {
      const url = await getSignedUrlAsync("putObject", params);

      const response = {
        file: actionFile + "",
        existing: cookie?.existing,
        putURL: url,
      };

      sendBack(res, "json", { ok: true, response }, false);
      return { __handled: true };
    } catch (err) {
      console.error("reqPut signing failed:", err);
      sendBack(res, "json", { ok: false, response: {} }, false);
      return { __handled: true };
    }
  });

  return { name: "reqPut" };
}

module.exports = { register };
