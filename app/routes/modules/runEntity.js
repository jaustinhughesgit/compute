// modules/runEntity.js
"use strict";

function register({ on, use }) {
  const {
    // domain helper
    getSub,
    // raw deps bag if ever needed
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  on("runEntity", async (ctx /*, meta */) => {
    const { req, res, path /*, type, signer */ } = ctx;

    // Legacy path parsing equivalent of: reqPath.split("?")[0].split("/")[3]
    // In the modular router, ctx.path is already the tail after the action,
    // e.g. "/<su>/...". We take the first non-empty segment.
    const clean = String(path || "").split("?")[0];
    const segs = clean.split("/").filter(Boolean);
    const actionFile = segs[0] || "";

    // Preserve original logging side-effects
    console.log("actionFile", actionFile);

    // Use shared domain helper (no refactor of signatures here)
    const subBySU = await getSub(actionFile, "su");
    console.log("subBySU", subBySU);

    const out = subBySU.Items[0].output;
    console.log("subBySU.Items[0].output", out);
    console.log("typeof subBySU.Items[0].output", typeof out);

    // Strict-parity behavior:
    // If no output stored on subdomain, call runApp(req,res, next?)
    if (out === undefined || out === "") {
      // Keep require path consistent with legacy (cookies.js lived in routes/,
      // this module lives in routes/modules/, so app.js is ../../app)
      const { runApp } = require("../../app");
      const ot = await runApp(req, res /*, next not available here */);
      console.log("ot", ot);
      // Legacy: mark existing then return chainParams
      ot.existing = true;
      return ot?.chainParams;
    }

    // Else: return stored output verbatim
    return out;
  });

  return { name: "runEntity" };
}

module.exports = { register };
