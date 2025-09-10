// modules/runEntity.js
function register({ on, use }) {
  // In setupRouter, useCompat returns the shared surface when called without a fn.
  const shared = use();
  const { getSub } = shared;

  on("runEntity", async (ctx) => {
    const { req, res, path, next } = ctx;

    // Same as old: actionFile is the first segment after /runEntity/
    const segs = String(path || "")
      .split("?")[0]
      .split("/")
      .filter(Boolean);
    const actionFile = segs[0] || "";

    const subBySU = await getSub(actionFile, "su");
    const out = subBySU.Items?.[0]?.output;

    // OLD behavior: if output is undefined OR empty string → runApp
    if (out == null || out === "") {
      const { runApp } = require("../../app"); // modules/ → routes/ → app.js
      const ot = await runApp(req, res, next);
      // OLD returned chainParams and marked existing
      if (ot) ot.existing = true;
      return ot?.chainParams;
    }

    // Otherwise return the stored output exactly
    return out;
  });

  return { name: "runEntity" };
}

module.exports = { register };
