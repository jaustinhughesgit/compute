// modules/makePublic.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getDocClient,
    getS3,
    convertToJSON,
    // and raw deps (for uuidv4 / dynamodbLL passthrough)
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // ────────────────────────────────────────────────────────────────────────────
  // Legacy helper (verbatim behavior): updateSubPermission(su, val)
  //  - Flips subdomains.z
  //  - Moves *all versions* of the object between private/public buckets
  //  - Preserves ContentType, adds originalversionid to metadata, deletes source
  // ────────────────────────────────────────────────────────────────────────────
  async function updateSubPermission(su, val, dynamodb, s3) {
    // Update subdomains.z
    const params = {
      TableName: "subdomains",
      Key: { su },
      UpdateExpression: "set z = :val",
      ExpressionAttributeValues: { ":val": val },
    };
    await dynamodb.update(params).promise();

    const file = su;
    let sourceBucket;
    let destinationBucket;

    if (val == "true" || val === true) {
      sourceBucket = "private.1var.com";
      destinationBucket = "public.1var.com";
    } else {
      sourceBucket = "public.1var.com";
      destinationBucket = "private.1var.com";
    }

    const versions = await s3
      .listObjectVersions({
        Bucket: sourceBucket,
        Prefix: file,
      })
      .promise();

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // walk newest→oldest (as in legacy)
    for (let x = (versions.Versions?.length || 0) - 1; x >= 0; x--) {
      const version = versions.Versions[x];

      const param1 = {
        Bucket: sourceBucket,
        Key: file,
        VersionId: version.VersionId,
      };
      const originalMetadata = await s3.headObject(param1).promise();

      const newMetadata = {
        ...originalMetadata.Metadata,
        originalversionid: version.VersionId,
      };

      const param2 = {
        Bucket: destinationBucket,
        CopySource: `${sourceBucket}/${file}?versionId=${version.VersionId}`,
        Key: file,
        Metadata: newMetadata,
        ContentType: originalMetadata.ContentType,
        MetadataDirective: "REPLACE",
      };
      await s3.copyObject(param2).promise();

      const param3 = {
        Bucket: sourceBucket,
        Key: file,
        VersionId: version.VersionId,
      };
      await s3.deleteObject(param3).promise();

      await delay(1000);
    }

    return { status: "All versions moved successfully" };
  }

  on("makePublic", async (ctx, meta) => {
    const { req, path } = ctx;
    const dynamodb = getDocClient();
    const s3 = getS3();

    // Parse "/<su>/<permission>" from normalized ctx.path
    const segs = String(path || "").split("/").filter(Boolean);
    const actionFile = segs[0] || "";
    const permission = segs[1];

    // 1) Flip permission + move all versions between buckets
    await updateSubPermission(actionFile, permission, dynamodb, s3);

    // 2) Return the exact legacy response shape from convertToJSON(...)
    //    Keep arg ordering/signature identical to the monolith call.
    const cookie = meta?.cookie || (req && req.cookies) || {};
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
      req?.body
    );

    return result;
  });

  return { name: "makePublic" };
}

module.exports = { register };
