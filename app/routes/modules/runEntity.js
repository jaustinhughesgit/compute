// modules/runEntity.js
function register({ on, use }) {
  const shared = use();                 // shared surface
  const { getSub } = shared;

  on("runEntity", async (ctx) => {
    const { req, res, path, next } = ctx;

    // Figure out the action file (same as old logic)
    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);

    console.log("segs", segs)
    const actionFile = segs[0] || "";

    const subBySU = await getSub(actionFile, "su");
    const out = subBySU.Items?.[0]?.output;
    console.log("out", out)
    if (out === undefined && out === "") {

    console.log("skipping 'out'' because it was not generated")

    const { runApp } = require("../../app");
    let ot;
    ot = await runApp(req, res, next);
    console.log("ot", ot)

    //ot.existing = true;
    return ot?.chainParams
    } else {
            return out; 
    }
  });

  return { name: "runEntity" };
}

module.exports = { register };
