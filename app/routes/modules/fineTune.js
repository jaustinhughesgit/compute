// modules/fineTune.js
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
module.exports.handle = async function fineTuneHandle(ctx) {
  const {
    openai, s3,
    reqPath, reqBody,
    updateJSONL, fineTune // pass these helpers from cookies.js
  } = ctx;

  const segs = reqPath.split("/");
  const action = segs[2]; // which fine-tune action endpoint we routed to

  // Each branch mirrors your original switch
  if (action === "addFineTune") {
    // Expect: body is a single JSON line and path encodes allowed keys
    // Path: /<x>/addFineTune/<KEY1>/<KEY2>/...  (your route used split path "sections")
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
};
