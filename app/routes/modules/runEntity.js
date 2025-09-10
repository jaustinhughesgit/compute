// modules/runEntity.js
function register({ on, use }) {
  const shared = use();                 // shared surface
  const { getSub } = shared;

  on("runEntity", async (ctx) => {
    const { req, res, path, next } = ctx;

    // Figure out the action file (same as old logic)
    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);

    console.log("segs",segs)
    const actionFile = segs[0] || "";

    const subBySU = await getSub(actionFile, "su");
    const out = subBySU.Items?.[0]?.output;
    console.log("out", out)
    if (out !== undefined && out !== "") {
      return out; // honor stored output shortcut, like before
    }
    console.log("skipping 'out'' because it was not generated")
    // --- Build a legacy-compatible req for runApp --------------------------
    const body = isPlainObject(req.body) ? { ...req.body } : {};
    const hdrsFromBody = isPlainObject(body.headers) ? { ...body.headers } : {};

    // Normalize request headers to a case-insensitive bag
    const hdrsFromReq = Object.entries(req.headers || {}).reduce((m, [k, v]) => {
      m[k.toLowerCase()] = v; return m;
    }, {});

    // Ensure mixed-case compatibility in body.headers (old runApp expects these)
    const capitalized = {
      "X-Original-Host": hdrsFromBody["X-Original-Host"] ?? hdrsFromBody["x-original-host"] ?? hdrsFromReq["x-original-host"],
      "X-accessToken":   hdrsFromBody["X-accessToken"]   ?? hdrsFromBody["x-accesstoken"]   ?? hdrsFromReq["x-accesstoken"],
    };

    body.headers = {
      // keep original caller-provided headers first (so we don't clobber)
      ...hdrsFromBody,
      // add legacy-cased keys if missing
      ...Object.fromEntries(Object.entries(capitalized).filter(([,v]) => v != null)),
      // also include a lower-cased overlay so req.get() + direct lower-case lookups work
      ...hdrsFromReq,
    };

    // Recreate the legacy path the old cookies.js built from X-Original-Host
    const originalHostPath = (capitalized["X-Original-Host"] || "").toString()
      .replace(/^https?:\/\/[^/]+/, "")
      .split("?")[0];

    const legacyPath =
      originalHostPath && originalHostPath !== "/"
        ? originalHostPath
        : `/cookies/runEntity/${actionFile}`;

    // Make a req proxy that looks like old Express req (without mutating ctx.req)
    const reqForApp = Object.create(req || null);
    reqForApp.method      = req.method;
    reqForApp.path        = legacyPath;
    reqForApp.url         = legacyPath;
    reqForApp.originalUrl = legacyPath;
    reqForApp.query       = req.query || {};
    reqForApp.cookies     = req.cookies || {};
    reqForApp.headers     = { ...(req.headers || {}) }; // leave original casing as-is
    reqForApp.body        = body;
    if (typeof reqForApp.get !== "function") {
      reqForApp.get = function (name) {
        const k = String(name).toLowerCase();
        const bag = {};
        // case-insensitive view over headers
        for (const [hk, hv] of Object.entries(this.headers || {})) {
          bag[hk.toLowerCase()] = hv;
        }
        return bag[k];
      };
    }

    // --- Response proxy that forwards to real res (so cookies/headers go out) ----
    const resProxy = Object.create(res || null);
    resProxy.headersSent = !!res?.headersSent;
    resProxy.statusCode = res?.statusCode ?? 200;

    resProxy.status = function (code) {
      resProxy.statusCode = code;
      res?.status && res.status(code);
      return resProxy;
    };
    resProxy.setHeader = function (...args) {
      res?.setHeader && res.setHeader(...args);
      return resProxy;
    };
    resProxy.getHeader = function (...args) {
      return res?.getHeader ? res.getHeader(...args) : undefined;
    };
    resProxy.cookie = function (...args) {
      res?.cookie && res.cookie(...args);
      return resProxy;
    };
    resProxy.json = function (payload) {
      resProxy.body = payload;
      resProxy.headersSent = true;
      if (res?.json) res.json(payload);
      else if (res?.send) res.send(payload);
      return resProxy;
    };
    resProxy.send = function (payload) {
      resProxy.body = payload;
      resProxy.headersSent = true;
      res?.send && res.send(payload);
      return resProxy;
    };

    // Hand off to the app with legacy-compatible shapes
    const { runApp } = require("../../app");
    let ot;
    try {
      ot = await runApp(req, res, next);
    } catch (err) {
      console.error("runEntity → runApp error", err);
      // Old cookies.js would not force a response on failure
      return { __handled: true };
    }

    // If runApp already wrote to the real response, suppress any router fallback.
    if (res?.headersSent || resProxy.headersSent) {
      return { __handled: true };
    }

    // Old cookies.js: only surface chainParams if present; otherwise do nothing.
    if (ot && typeof ot === "object" && Object.prototype.hasOwnProperty.call(ot, "chainParams")) {
      ot.existing = true;
      return ot.chainParams;
    }

    // No chainParams → treat as handled with no body (prevents router wrappers).
    return { __handled: true };
  });

  return { name: "runEntity" };
}

// small local helper
function isPlainObject(x) { return x && typeof x === "object" && !Array.isArray(x) && !Buffer.isBuffer(x); }

module.exports = { register };
