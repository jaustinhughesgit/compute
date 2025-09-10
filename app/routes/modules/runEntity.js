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
      // ---- Build a sanitized, Express-like request the old code expects ----
      const body =
        req && typeof req.body === "object" ? req.body : {};

      // headers might have been posted inside body.headers (legacy edge/gateway)
      const hdrsFromBody =
        (body && body.headers) ||
        (body && body.body && body.body.headers) ||
        undefined;

      // normalize body.headers into both original- and lower-case keys
      const normalizedFromBody = {};
      if (hdrsFromBody && typeof hdrsFromBody === "object") {
        for (const [k, v] of Object.entries(hdrsFromBody)) {
          normalizedFromBody[k] = v;
          normalizedFromBody[k.toLowerCase()] = v;
        }
      }

      // merged headers: real req.headers + promoted body.headers
      const mergedHeaders = Object.assign({}, req?.headers || {}, normalizedFromBody);

      // tiny Express-like getter
      const getHeader = (name) => {
        if (!name) return undefined;
        const lc = String(name).toLowerCase();
        return mergedHeaders[name] ?? mergedHeaders[lc];
      };

      const reqLite = {
        method: req?.method,
        path: req?.path,                             // keep original path
        originalUrl: req?.originalUrl || req?.path,  // many middlewares read this
        type: req?.type,
        _headerSent: req?._headerSent ?? res?.headersSent ?? false,

        body,                        // keep body.headers available for legacy reads
        headers: mergedHeaders,      // allow direct header access
        get: getHeader,              // allow req.get("X-Original-Host") etc.

        cookies: req?.cookies || {},
        query: req?.query || {},
        params: req?.params || {}
      };
      // ---- end sanitized req ----

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
