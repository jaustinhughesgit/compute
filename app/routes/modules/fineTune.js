// modules/fineTune.js
"use strict";

/**
 * Fine-tune utilities wrapper. Supports:
 *  - addFineTune      (append a line to training.jsonl with field filtering)
 *  - createFineTune   (start job)
 *  - listFineTune     (list jobs)
 *  - deleteFineTune   (delete model)
 *  - eventsFineTune   (job events)
 *  - retrieveFineTune (job details)
 *  - cancelFineTune   (cancel job)
 */
async function fineTuneHandle(ctx) {
  const {
    openai, s3,
    reqPath, reqBody,
    updateJSONL, fineTune // helpers injected from cookies.js
  } = ctx;

  const segs = String(reqPath || "").split("/");
  const action = segs[2] || "";

  if (action === "addFineTune") {
    // Path: /<x>/addFineTune/<KEY1>/<KEY2>/...
    const keys = segs.slice(3);
    await updateJSONL(reqBody.body, keys, s3);
    return { mainObj: { alert: "success" }, actionFile: "" };
  }

  if (action === "createFineTune") {
    // Path: /<x>/createFineTune/:training_file_id/:base_model
    const trainingFile = segs[3];
    const baseModel    = segs[4];
    const r = await fineTune(openai, "create", trainingFile, baseModel);
    return { mainObj: { alert: JSON.stringify(r) }, actionFile: "" };
  }

  if (action === "listFineTune") {
    // Path: /<x>/listFineTune/:limit
    const limit = segs[3];
    const r = await fineTune(openai, "list", limit, "");
    return { mainObj: { alert: JSON.stringify(r) }, actionFile: "" };
  }

  if (action === "deleteFineTune") {
    // Path: /<x>/deleteFineTune/:model
    const model = segs[3];
    const r = await fineTune(openai, "delete", model, "");
    return { mainObj: { alert: JSON.stringify(r) }, actionFile: "" };
  }

  if (action === "eventsFineTune") {
    // Path: /<x>/eventsFineTune/:job_id/:limit
    const jobId = segs[3];
    const limit = segs[4];
    const r = await fineTune(openai, "events", jobId, limit);
    return { mainObj: { alert: JSON.stringify(r) }, actionFile: "" };
  }

  if (action === "retrieveFineTune") {
    // Path: /<x>/retrieveFineTune/:job_id
    const jobId = segs[3];
    const r = await fineTune(openai, "retrieve", jobId, "");
    return { mainObj: { alert: JSON.stringify(r) }, actionFile: "" };
  }

  if (action === "cancelFineTune") {
    // Path: /<x>/cancelFineTune/:job_id
    const jobId = segs[3];
    const r = await fineTune(openai, "cancel", jobId, "");
    return { mainObj: { alert: JSON.stringify(r) }, actionFile: "" };
  }

  return { mainObj: { alert: "noop" }, actionFile: "" };
}

// Export the handler (for direct calls if needed)
module.exports.handle = fineTuneHandle;

/**
 * register() hook so cookies.js can auto-wire this module.
 * We bind every fine-tune action to the same handler; it inspects reqPath.
 */
module.exports.register = function register({ on /*, use */ }) {
  [
    "addFineTune",
    "createFineTune",
    "listFineTune",
    "deleteFineTune",
    "eventsFineTune",
    "retrieveFineTune",
    "cancelFineTune",
  ].forEach((action) => on(action, fineTuneHandle));
};
