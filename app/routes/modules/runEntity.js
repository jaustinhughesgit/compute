// modules/runEntity.js
//"use strict";
function register({ on, use }) {
  const { getSub } = use();

  on("runEntity", async (ctx) => {
    const { req, res, path } = ctx;

    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);
    const actionFile = segs[0] || "";
    console.log("actionFile", actionFile);

    const subBySU = await getSub(actionFile, "su");
    console.log("subBySU", subBySU);

    const out = subBySU.Items?.[0]?.output;
    console.log("subBySU.Items[0].output", out);
    console.log("typeof subBySU.Items[0].output", typeof out);

    if (out === undefined || out === "") {
      const { runApp } = require("../../app");

      // minimal, non-circular req snapshot
      const reqLite = {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body,
        headers: req.headers,
      };

      // tiny response shim that collects what runApp writes, no sockets
      const resShim = {
        headersSent: false,
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; return this; },
        send(payload) { this.body = payload; this.headersSent = true; return this; },
        setHeader() { /* noop */ return this; },
        getHeader() { return undefined; },
        cookie() { /* noop for runApp */ return this; },
      };

      const ot = await runApp(reqLite, resShim);   // <-- NO real Express res

      if (resShim.headersSent) {
        // runApp already produced a response body → return it upstream
        return resShim.body;
      }

      ot && (ot.existing = true);
      return ot?.chainParams ?? null;
    }

    return out;
  });

  return { name: "runEntity" };
}

module.exports = { register };
