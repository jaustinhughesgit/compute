// modules/addIndex.js
"use strict";

/**
 * Placeholder for future indexing. Right now it just echoes intent.
 *
 * Accepts either:
 *  • Legacy shape: ({ target?, note? })
 *  • New shared-dispatch ctx: { reqBody, reqPath, ... }
 */
async function addIndexHandle(ctxOrArgs) {
  console.log("addIndex")
  // Legacy mode: called directly with args
  if (ctxOrArgs && (ctxOrArgs.target !== undefined || ctxOrArgs.note !== undefined) && !ctxOrArgs.reqBody) {
    const { target, note } = ctxOrArgs || {};
    return { ok: true, status: "placeholder", target, note };
  }

  // New mode: dispatched with ctx
  const { reqBody, reqPath } = ctxOrArgs || {};
  let target = reqBody?.body?.target ?? reqBody?.target;
  let note   = reqBody?.body?.note   ?? reqBody?.note;

  // Also allow path params: /<anything>/addIndex/:target?/:note?
  if (target == null || note == null) {
    const segs = (reqPath || "").split("/");
    if (target == null && segs[3]) {
      try { target = decodeURIComponent(segs[3]); } catch { target = segs[3]; }
    }
    if (note == null && segs[4]) {
      try { note = decodeURIComponent(segs[4]); } catch { note = segs[4]; }
    }
  }

  return { ok: true, status: "placeholder", target, note };
}

// Expose handler for direct use (optional/back-compat)
module.exports.handle = addIndexHandle;

// Required by your loader: wire the action name → handler
module.exports.register = function register({ on /*, use */ }) {
  console.log("addIndex")
  on("addIndex", addIndexHandle);
};

// Optional: provide a default export with register() for ESM interop
module.exports.default = { register: module.exports.register };
