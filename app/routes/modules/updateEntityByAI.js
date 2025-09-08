// routes/modules/updateEntityByAI.js
/**
 * Action:
 *  - updateEntityByAI  → run LLM over current entity JSON and overwrite S3 object
 */
module.exports.register = ({ on /*, use */ }) => {
  /* helpers */
  const getSub = async (val, dynamodb) => {
    const params = { TableName: "subdomains", KeyConditionExpression: "su = :su", ExpressionAttributeValues: { ":su": val } };
    return dynamodb.query(params).promise();
  };

  const retrieveAndParseJSON = async (s3, key, isPublic) => {
    const bucket = (isPublic ? "public" : "private") + ".1var.com";
    const data = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    return JSON.parse(data.Body.toString("utf-8"));
  };

  on("updateEntityByAI", async (ctx) => {
    const { dynamodb, s3, openai } = ctx.deps;
    const su = (ctx.path || "").split("/")[3];
    const prompt = ctx.req?.body?.body || {};

    // resolve visibility and load current JSON
    const sub = await getSub(su, dynamodb);
    if (!sub.Items?.length) return { ok: false, error: "not-found" };
    const isPublic = !!sub.Items[0].z;

    const current = await retrieveAndParseJSON(s3, su, isPublic);
    const originalBlocks = Array.isArray(current?.blocks) ? current.blocks : current?.published?.blocks;
    const originalModules = current?.modules || current?.published?.modules;

    // Build instruction & call the model
    const sys = [
      "",
      "Using the proprietary JSON structure. RESPOND WITH A SINGLE JSON *OBJECT* — no commentary."
    ].join("\n");

    const combined = `${sys}\n\nUser Prompt: ${prompt?.prompt || ""}\n\n--- Current JSON to edit ---\n${JSON.stringify(current)}`;

    const res = await openai.chat.completions.create({
      model: "o3-mini-2025-01-31",
      messages: [{ role: "system", content: combined }],
      response_format: { type: "json_object" }
    });

    const asStr = res.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(asStr); } catch { parsed = {}; }

    // keep modules/blocks stable if model omitted them
    if (parsed && !parsed.modules && originalModules) parsed.modules = originalModules;
    if (parsed && !parsed.blocks && originalBlocks) parsed.blocks = originalBlocks;
    parsed.ai = true;

    // write back to same bucket
    const bucket = (isPublic ? "public" : "private") + ".1var.com";
    await s3.putObject({
      Bucket: bucket,
      Key: su,
      Body: JSON.stringify(parsed),
      ContentType: "application/json"
    }).promise();

    return { ok: true, oai: parsed };
  });
};
