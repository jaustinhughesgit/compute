// modules/runEntity.js
function register({ on, use }) {
  const shared = use();                 // shared surface
  const { getSub } = shared;

  on("runEntity", async (ctx) => {
    const { req, res, path } = ctx;

    // Figure out the action file (same as old logic)
    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);

    console.log("segs", segs)
    const actionFile = segs[0] || "";

    const subBySU = await getSub(actionFile, "su");
    const out = subBySU.Items?.[0]?.output;
    console.log("out", out)
    if (out !== undefined && out !== "") {
      return out; // honor stored output shortcut, like before
    }
    console.log("skipping 'out'' because it was not generated")

    // Hand off to the app with legacy-compatible shapes
    const { runApp } = require("../../app");
    let ot;
    ot = await runApp(reqForApp, resProxy);
    console.log("ot", ot)
    //if (ot){
    ot.existing = true;
    return ot?.chainParams
  });

  return { name: "runEntity" };
}

module.exports = { register };
