// modules/runEntity.js
function register({ on, use }) {
  const shared = use(); // shared surface
  const { getSub } = shared;

  on("runEntity", async (ctx) => {
    const { req, res, path, next } = ctx;

    // Same path parsing as old: first segment after /runEntity/
    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);
    const actionFile = segs[0] || "";

    const subBySU = await getSub(actionFile, "su");
    const out = subBySU.Items?.[0]?.output;

    // OLD parity: if output is undefined OR empty string -> runApp
    if (out == null || out === "") {
      // Build the SAME sanitized req the old router passed into route()/runApp
      const reqLite = {
        body: req?.body,
        method: req?.method,
        type: req?.type,
        _headerSent: req?._headerSent ?? res?.headersSent ?? false,
        path: req?.path, // old code forwarded the original req.path here
      };

      const { runApp } = require("../../app");
      const ot = await runApp(reqLite, res, next); // res stays real, same as old

      if (ot) ot.existing = true;

      // Old code returned only chainParams (plain JSON), not ot/res/etc.
      return ot?.chainParams;
    }

    // Otherwise return stored output exactly
    return out;
  });

  return { name: "runEntity" };
}

module.exports = { register };
