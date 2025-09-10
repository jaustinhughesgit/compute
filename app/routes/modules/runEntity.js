// modules/runEntity.js
function register({ on, use }) {
  const { getSub } = use(); // ok: use() returns shared surface

  on("runEntity", async (ctx) => {
    const { req, res, path } = ctx;

    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);
    const actionFile = segs[0] || "";

    const subBySU = await getSub(actionFile, "su");
    const out = subBySU.Items?.[0]?.output;

    if (out === undefined || out === "") {
      const { runApp } = require("../../app");

      // ——— build an “express-ish” req clone ———
      const merged = Object.create(null);
      // 1) take existing headers, normalize case
      for (const [k, v] of Object.entries(req.headers || {})) {
        merged[k.toLowerCase()] = v;
      }
      // 2) also merge any body.headers the caller might have sent
      const bodyHdrs = (req.body && req.body.headers) || {};
      for (const [k, v] of Object.entries(bodyHdrs)) {
        merged[k.toLowerCase()] = v;
      }

      const reqLite = {
        method: req.method,
        path: req.path || ctx.path || "/",
        url: req.originalUrl || req.url || req.path || ctx.path || "/",
        originalUrl: req.originalUrl || req.url || req.path || ctx.path || "/",
        query: req.query || {},
        cookies: req.cookies || {},              // some middlewares read this
        headers: merged,                         // normalized map
        body: { ...(req.body || {}), headers: { ...bodyHdrs, ...merged } },
        get(name) {                              // express compat
          const k = String(name).toLowerCase();
          return this.headers[k];
        }
      };

      // ——— response shim (unchanged) ———
      const resShim = {
        headersSent: false,
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; return this; },
        send(payload) { this.body = payload; this.headersSent = true; return this; },
        setHeader() { return this; },
        getHeader() { return undefined; },
        cookie() { return this; },
      };

      const ot = await runApp(reqLite, resShim);

      if (resShim.headersSent) return resShim.body;
      ot && (ot.existing = true);
      return ot?.chainParams ?? null;
    }

    return out;
  });

  return { name: "runEntity" };
}

module.exports = { register };
