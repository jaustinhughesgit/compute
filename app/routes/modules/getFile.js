// routes/modules/getFile.js
/**
 * Action:
 *  - getFile → load a JSON file from the *public* bucket by sub-uuid
 */
module.exports.register = ({ on /*, use */ }) => {
  on("getFile", async (ctx) => {
    const { s3 } = ctx.deps;
    const su = (ctx.path || "").split("/")[3];
    if (!su) return { ok: false, error: "missing-id" };

    try {
      const data = await s3.getObject({ Bucket: "public.1var.com", Key: su }).promise();
      const json = JSON.parse(data.Body.toString("utf-8"));
      return json; // direct JSON passthrough (old behavior)
    } catch (err) {
      if (err && err.code === "NoSuchKey") return { ok: false, error: "not-found" };
      console.error("getFile → S3 getObject error:", err);
      return { ok: false, error: "s3-error" };
    }
  });
};
