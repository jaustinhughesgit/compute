// modules/fineTune.js
"use strict";

function register({ on, use }) {
  const {
    getS3,
    deps, // { openai }
  } = use();

  // Helper: normalize legacy/flattened body shape to always have `.body`
  function ensureLegacyBodyShape(req) {
    const b = req?.body;
    if (b && typeof b === "object" && b.body && typeof b.body === "object") {
      return b; // already legacy-shaped: { body: {...} }
    }
    return { body: b || {} }; // wrap flattened body into legacy shape
  }

  // ───────────────────────────────────────────────────────────
  // Legacy helper (kept with minimal fixes for strict mode)
  // ───────────────────────────────────────────────────────────
  async function updateJSONL(newLine, keys, s3) {
    try {
      // Accept string or object for the incoming line
      let lineObj = typeof newLine === "string" ? JSON.parse(newLine) : newLine;

      // completion may be a JSON string; preserve original filtering behavior
      let VAR = lineObj && typeof lineObj.completion === "string"
        ? JSON.parse(lineObj.completion)
        : (lineObj?.completion || {});

      // Filter properties by presence in `keys` (legacy behavior)
      for (const key in VAR) {
        if (!keys.includes(key)) {
          delete VAR[key];
        }
      }

      lineObj.completion = JSON.stringify(VAR);

      // Append to s3://private.1var.com/training.jsonl (legacy bucket/key)
      const getParams = { Bucket: "private.1var.com", Key: "training.jsonl" };
      let existingData = "";
      try {
        const data = await s3.getObject(getParams).promise();
        existingData = (data?.Body || Buffer.from("")).toString();
      } catch (err) {
        // if not found, we start a fresh file
        if (err && err.code !== "NoSuchKey") throw err;
      }
      if (!existingData.endsWith("\n") && existingData.length) {
        existingData += "\n";
      }

      const updatedFile =
        existingData + JSON.stringify(lineObj) + "\n";

      const putParams = {
        Bucket: "private.1var.com",
        Key: "training.jsonl",
        Body: updatedFile,
        ContentType: "application/jsonl",
      };
      await s3.putObject(putParams).promise();
      return true;
    } catch (error) {
      console.error("Error updating training.jsonl:", error);
      throw error;
    }
  }

  async function fineTune(openai, method, val, sub) {
    let fineTune = {};
    if (method == "create") {
      fineTune = await openai.fineTuning.jobs.create({
        training_file: val,
        model: sub
      });
    } else if (method == "list") {
      fineTune = await openai.fineTuning.jobs.list({ limit: parseInt(val) });
    } else if (method == "delete") {
      fineTune = await openai.models.delete(val);
    } else if (method == "events") {
      fineTune = await openai.fineTuning.jobs.listEvents(val, { limit: parseInt(sub) });
    } else if (method == "retrieve") {
      fineTune = await openai.fineTuning.jobs.retrieve(val);
    } else if (method == "cancel") {
      fineTune = await openai.fineTuning.jobs.cancel(val);
    }
    return fineTune;
  }

  // For path tail extraction (modules receive only the tail after the action)
  function tailSegs(path) {
    return String(path || "").split("/").filter(Boolean);
  }

  // ───────────────────────────────────────────────────────────
  // addFineTune: append a JSONL line to private.1var.com/training.jsonl
  // ───────────────────────────────────────────────────────────
  on("addFineTune", async (ctx /*, meta */) => {
    const { req, path } = ctx;
    const s3 = getS3();
    const reqBody = ensureLegacyBodyShape(req);

    // Legacy passed the full reqPath split array as `keys`; we pass tail segs.
    const keys = String(req?.path || "").split("/");

    await updateJSONL(reqBody.body, keys, s3);
    return { alert: "success" };
  });

  // ───────────────────────────────────────────────────────────
  // createFineTune: /createFineTune/:training_file/:model
  // ───────────────────────────────────────────────────────────
  on("createFineTune", async (ctx /*, meta */) => {
    const { path } = ctx;
    const { openai } = deps;
    const segs = tailSegs(path); // [ training_file, model ]
    const fineTuneResponse = await fineTune(openai, "create", segs[0], segs[1]);
    return { alert: JSON.stringify(fineTuneResponse) };
  });

  // listFineTune: /listFineTune/:limit
  on("listFineTune", async (ctx /*, meta */) => {
    const { path } = ctx;
    const { openai } = deps;
    const segs = tailSegs(path); // [ limit ]
    const fineTuneResponse = await fineTune(openai, "list", segs[0], "");
    return { alert: JSON.stringify(fineTuneResponse) };
  });

  // deleteFineTune: /deleteFineTune/:modelId
  on("deleteFineTune", async (ctx /*, meta */) => {
    const { path } = ctx;
    const { openai } = deps;
    const segs = tailSegs(path); // [ modelId ]
    const fineTuneResponse = await fineTune(openai, "delete", segs[0], segs[1]);
    return { alert: JSON.stringify(fineTuneResponse) };
  });

  // eventsFineTune: /eventsFineTune/:jobId/:limit
  on("eventsFineTune", async (ctx /*, meta */) => {
    const { path } = ctx;
    const { openai } = deps;
    const segs = tailSegs(path); // [ jobId, limit ]
    const fineTuneResponse = await fineTune(openai, "events", segs[0], segs[1]);
    return { alert: JSON.stringify(fineTuneResponse) };
  });

  // retrieveFineTune: /retrieveFineTune/:jobId
  on("retrieveFineTune", async (ctx /*, meta */) => {
    const { path } = ctx;
    const { openai } = deps;
    const segs = tailSegs(path); // [ jobId ]
    const fineTuneResponse = await fineTune(openai, "retrieve", segs[0], segs[1]);
    return { alert: JSON.stringify(fineTuneResponse) };
  });

  // cancelFineTune: /cancelFineTune/:jobId
  on("cancelFineTune", async (ctx /*, meta */) => {
    const { path } = ctx;
    const { openai } = deps;
    const segs = tailSegs(path); // [ jobId ]
    const fineTuneResponse = await fineTune(openai, "cancel", segs[0], segs[1]);
    return { alert: JSON.stringify(fineTuneResponse) };
  });

  return { name: "fineTune" };
}

module.exports = { register };
