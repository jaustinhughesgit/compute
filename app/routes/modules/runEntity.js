// routes/modules/runEntity.js
"use strict";

/**
 * Run an entity (by subdomain su). If subdomain has a cached .output in DynamoDB,
 * return it; otherwise delegate to app.runApp() and return its chainParams.
 *
 * The module registers itself via `register({ on })` so your loader can auto-wire it.
 */

async function runEntityHandle(ctx) {
  const { dynamodb, req, res, next, getSub, reqPath } = ctx || {};

  // Path shape: /<anything>/runEntity/:su
  const su = (reqPath || "").split("?")[0].split("/")[3];
  if (!su) {
    throw new Error("runEntity: su required");
  }

  const subBySU = await getSub(su, "su", dynamodb);
  if (!subBySU?.Items?.length) {
    throw new Error(`runEntity: no subdomain found for ${su}`);
  }

  const out = subBySU.Items[0].output;
  if (out !== undefined && out !== "") {
    // Use persisted output if present
    return out;
  }

  // Fall back to the main app runner (same file you call inside the route)
  const { runApp } = require("../../app");
  const result = await runApp(req, res, next);

  // Mirror the route behavior: return chainParams when available
  return result?.chainParams ?? result ?? null;
}

// Optional: keep a direct handle export (symmetry with other modules)
module.exports.handle = runEntityHandle;

// Required by your loader: expose a register() that binds the action name.
module.exports.register = function register({ on /*, use */ }) {
  on("runEntity", runEntityHandle);
};
