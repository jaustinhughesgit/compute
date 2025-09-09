// modules/updateEntityByAI.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getS3,
    getHead,
    retrieveAndParseJSON,
    fileLocation,
    // raw deps bag if needed
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  /**
   * Legacy-compatible helper that mirrors the old runPrompt() from cookies.js.
   * Preserves prompt construction, model choice, block/module reattachment, etc.
   */
  async function runPrompt(question, entity, dynamodb, openai, Anthropic) {
    const gptScript = [""];

    const head = await getHead("su", entity, dynamodb);
    const isPublic = head.Items[0].z;

    // pull current JSON from S3, but keep original blocks/modules aside
    let results = await retrieveAndParseJSON(entity, isPublic);
    const blocks = JSON.parse(JSON.stringify(results.blocks));
    const modules = JSON.parse(JSON.stringify(results.modules));
    results = JSON.stringify(results);

    const combinedPrompt = `${gptScript} /n/n Using the proprietary json structure. RESPOND BACK WITH JUST AND ONLY A SINGLE JSON FILE!! NO COMMENTS!! NO EXPLINATIONS!! NO INTRO!! JUST JSON!!:  ${question.prompt} /n/n Here is the code to edit; ${results} `;

    let jsonParsed;

    // Keep the exact old branching (Anthropic path is disabled)
    if (false) {
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 4000,
        temperature: 0.7,
        system: gptScript.join(" "),
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: combinedPrompt }],
          },
        ],
      });
      jsonParsed = JSON.parse(response.content[0].text);
      jsonParsed.modules = modules;
      jsonParsed.blocks = blocks;
      jsonParsed.ai = true;
    } else {
      const response = await openai.chat.completions.create({
        messages: [{ role: "system", content: combinedPrompt }],
        model: "o3-mini-2025-01-31",
        response_format: { type: "json_object" },
      });
      jsonParsed = JSON.parse(response.choices[0].message.content);
      jsonParsed.modules = modules;
      jsonParsed.blocks = blocks;
      jsonParsed.ai = true;
    }

    return { response: JSON.stringify(jsonParsed), isPublic, entity };
  }

  on("updateEntityByAI", async (ctx, meta) => {
    const { req, path } = ctx;
    const { dynamodb, openai, Anthropic } = deps;
    const s3 = getS3();

    // ── Path parsing parity with legacy: fileID came from reqPath.split("/")[3]
    // In modules, ctx.path is the tail ("/<fileID>..."). Use index 1 to match old position.
    const fileID = String(path || "").split("?")[0].split("/")[1];

    // ── Body unwrapping parity: support both flattened req.body and legacy body.body
    const raw = req?.body;
    const prompt = raw && typeof raw === "object" && raw.body && typeof raw.body === "object"
      ? raw.body
      : raw;

    // Run model and write exact same S3 object
    const oai = await runPrompt(prompt, fileID, dynamodb, openai, Anthropic);
    await s3
      .putObject({
        Bucket: fileLocation(oai.isPublic) + ".1var.com",
        Key: fileID,
        Body: oai.response,
        ContentType: "application/json",
      })
      .promise();

    // Preserve legacy response shape fields
    const response = {};
    response.oai = JSON.parse(oai.response);
    response.existing = meta?.cookie?.existing; // same as legacy "cookie.existing"
    response.file = (fileID ?? "") + "";

    return { ok: true, response };
  });

  return { name: "updateEntityByAI" };
}

module.exports = { register };
