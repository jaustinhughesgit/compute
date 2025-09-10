// modules/runEntity.js
function register({ on, use }) {
  const shared = use(); // shared surface
  const { getSub } = shared;

  on("runEntity", async (ctx) => {
    const { req, res, path, next } = ctx;

    // Parse: first segment after /runEntity/
    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);
    const actionFile = segs[0] || "";

    const subBySU = await getSub(actionFile, "su");
    const out = subBySU.Items?.[0]?.output;

    // If no precomputed output, delegate to app (legacy parity)
    if (out == null || out === "") {
      // ---- Collect & normalize headers from all possible places ----
      const rawBody = (req && typeof req.body === "object") ? req.body : {};

      // headers may be nested in body.headers OR body.body.headers (legacy edge/gateway)
      const fromBodyHeaders =
        (rawBody && rawBody.headers) ||
        (rawBody && rawBody.body && rawBody.body.headers) ||
        undefined;

      const mergedHeaders = Object.assign({}, req?.headers || {});
      if (fromBodyHeaders && typeof fromBodyHeaders === "object") {
        for (const [k, v] of Object.entries(fromBodyHeaders)) {
          mergedHeaders[k] = v;
          mergedHeaders[k.toLowerCase()] = v;
        }
      }

      // Tiny getter like Express' req.get()
      const getHeader = (name) => {
        if (!name) return undefined;
        const lc = String(name).toLowerCase();
        return mergedHeaders[name] ?? mergedHeaders[lc];
      };

      // Ensure the two legacy keys ALWAYS exist on body.headers:
      const xOriginalHost =
        getHeader("X-Original-Host") ||
        ""; // default to empty string to avoid "reading 'X-Original-Host'" crash

      const xAccessTokenHeader =
        getHeader("X-accessToken") ||
        getHeader("x-accessToken") ||
        getHeader("x-accesstoken") ||
        "";

      // Rebuild body with a guaranteed headers object (and both casings)
      const bodyForLegacy = {
        ...rawBody,
        headers: {
          ...(fromBodyHeaders || {}),
          "X-Original-Host": xOriginalHost,
          "x-original-host": xOriginalHost,
          "X-accessToken": xAccessTokenHeader,
          "x-accesstoken": xAccessTokenHeader
        }
      };

      // ---- Build the sanitized, Express-like req expected by old runApp ----
      const reqLite = {
        method: req?.method,
        path: req?.path,
        originalUrl: req?.originalUrl || req?.path,
        type: req?.type,
        _headerSent: req?._headerSent ?? res?.headersSent ?? false,

        body: bodyForLegacy,     // must contain body.headers with required keys
        headers: mergedHeaders,  // allow direct header access
        get: getHeader,          // allow req.get("X-Original-Host")

        cookies: req?.cookies || {},
        query: req?.query || {},
        params: req?.params || {}
      };
      // ---- end sanitized req ----

      // Call the legacy app runner with the sanitized req and real res
      const { runApp } = require("../../app");
      const ot = await runApp(reqLite, res, next);

      if (ot) ot.existing = true;

      // Old code returns just chainParams
      return ot?.chainParams;
    }

    // Otherwise return stored output as-is
    return out;
  });

  return { name: "runEntity" };
}

module.exports = { register };
