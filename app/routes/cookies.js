// routes/cookies.js
"use strict";

const express = require("express");
const AWS = require("aws-sdk");
const { createShared } = require("./shared");

// ───────────────────────────────────────────────────────────────────────────────
// Lazily-created shared (so adapter + express share one instance)
// ───────────────────────────────────────────────────────────────────────────────
let _deps, _shared, _signer;
const ensureShared = () => (_shared ?? (_shared = createShared(_deps)));

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────

// unwrap worker/axios-style bodies: `{ method, headers, body: {...} }`
function unwrapBody(b) {
  if (!b || typeof b !== "object") return b;
  if (b.body && typeof b.body === "object") return b.body;
  return b;
}

// promote a header from a possibly nested `headers` object into `req.headers`
function promoteHeader(req, hdrs, name, targetLower) {
  if (!hdrs) return;
  const v = hdrs[name] ?? hdrs[name.toLowerCase()];
  if (v == null) return;
  req.headers ||= {};
  req.headers[targetLower] = v;
}

// normalize path/action/type for router + adapter (keeps old shapes working)
function normalize(rawPath, typeFromParams, queryType) {
  let rp = String(rawPath || "").split("?")[0]; // drop query
  const segs = rp.split("/").filter(Boolean);

  let type = typeFromParams || queryType;
  let action = "";
  let pathForModules = rp;

  // Mounted at "/cookies/<action>/..." or "/url/<action>/..."
  if (segs[0] === "cookies" || segs[0] === "url") {
    type = type || segs[0];
    action = segs[1] || "";
    pathForModules = "/" + segs.slice(2).join("/"); // "/<tail>..."
  } else {
    // Mounted at "/<action>/..."
    action = segs[0] || "";
    pathForModules = "/" + segs.slice(1).join("/"); // "/<tail>..."
  }

  if (!pathForModules) pathForModules = "/"; // always provide a tail
  return { action, type, pathForModules };
}

// ───────────────────────────────────────────────────────────────────────────────
// Express router (preferred)
// ───────────────────────────────────────────────────────────────────────────────
function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  // IMPORTANT: pass uuidv4 so shared.getUUID() can use it
  _deps = { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = createShared(_deps);

  // keep legacy default, but prefer env
  _signer =
    _signer ||
    new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID || "K2LZRHRSYZRU3Y", privateKey);

  const regOpts = { on: _shared.on, use: _shared.use };
  const reg = (p) => {
    const m = require(p);
    const mod = m?.register ? m : m?.default?.register ? m.default : null;
    if (!mod) throw new TypeError(`Module "${p}" does not export register()`);
    return mod.register(regOpts);
  };

  // register all modules (unchanged)
  reg("./modules/get");
  reg("./modules/file");
  reg("./modules/links");
  reg("./modules/tasks");
  reg("./modules/groups");
  reg("./modules/validation");
  reg("./modules/updateEntityByAI");
  reg("./modules/position");
  reg("./modules/search");
  reg("./modules/getFile");
  reg("./modules/shorthand");
  reg("./modules/convert");
  reg("./modules/embed");
  reg("./modules/users");
  reg("./modules/passphrases");
  reg("./modules/map");
  reg("./modules/extend");
  reg("./modules/saveFile");
  reg("./modules/makePublic");
  reg("./modules/fineTune");
  reg("./modules/runEntity");
  reg("./modules/resetDB");
  reg("./modules/add");
  reg("./modules/addIndex");

  const router = express.Router({ mergeParams: true });

  // Single catch-all that preserves legacy worker bridge semantics
  router.all("*", async (req, res) => {
    try {
      // 1) unwrap worker/axios-style envelope so modules get a flat body
      if (req.body && typeof req.body === "object") {
        const maybeHeaders =
          req.body.headers || (req.body.body && req.body.body.headers) || null;

        // promote worker-provided headers into real req.headers (legacy parity)
        if (maybeHeaders) {
          promoteHeader(req, maybeHeaders, "X-Original-Host", "x-original-host");
          promoteHeader(req, maybeHeaders, "X-accessToken", "x-accesstoken");
        }

        // then flatten the body once
        req.body = unwrapBody(req.body);
      }

      // 2) compute path from either actual req.path or X-Original-Host (legacy)
      const cookie = req.cookies || {};
      let rawPath = String(req.path || "").split("?")[0];
      let type = req.params?.type || req.type || req.query?.type;

      if (!rawPath || rawPath === "/") {
        const fromHeader =
          req.get?.("X-Original-Host") ||
          req.headers?.["x-original-host"] ||
          (req.body &&
            req.body.headers &&
            (req.body.headers["X-Original-Host"] || req.body.headers["x-original-host"]));

        if (fromHeader) {
          const p = String(fromHeader).replace(/^https?:\/\/[^/]+/, "");
          rawPath = p.split("?")[0];
        }
      }

      const { action, type: t, pathForModules } = normalize(
        rawPath,
        type,
        req.query?.type
      );
      type = t;

      // 3) build ctx exactly how modules/shared expect
      const ctx = {
        req,
        res,
        path: pathForModules, // tail that modules expect
        type,
        signer: _signer,
        deps: _deps,
        // expose x-accessToken like the old router passed to manageCookie(...)
        xAccessToken:
          req.get?.("X-accessToken") ||
          req.headers?.["x-accesstoken"] ||
          req.headers?.["x-accessToken"],
      };

      // 4) dispatch to modules via shared
      const result = await ensureShared().dispatch(action, ctx, { cookie });

      // 5) if a module wrote the response, we're done
      if (res.headersSent) return;

      // otherwise, mirror the legacy behavior
      if (result && result.__handled) return;
      if (result != null) return res.json(result);

      return res.status(404).json({ ok: false, error: `No handler for "${action}"` });
    } catch (err) {
      console.error("cookies route error", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
    }
  });

  return router;
}

// ───────────────────────────────────────────────────────────────────────────────
/** Adapter: call the same dispatch logic without an Express router.
 *  (keeps the exact same header/cookie normalization as setupRouter) */
// ───────────────────────────────────────────────────────────────────────────────
async function route(
  req,
  res,
  next,
  privateKey,
  dynamodb,
  uuidv4,
  s3,
  ses,
  openai,
  Anthropic,
  dynamodbLL,
  isShorthand,
  reqPath,
  reqBody,
  reqMethod,
  reqType,
  reqHeaderSent,
  signer,
  action,
  xAccessToken
) {
  // init shared deps/signer once
  _deps = _deps || { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = _shared || createShared(_deps);
  _signer =
    _signer || signer || new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID || "K2LZRHRSYZRU3Y", privateKey);

  // minimal req/res shape
  req = req || {};
  res = res || {};
  req.headers ||= {};

  // 1) graft/unwrap provided body & promote worker headers
  if (reqBody) {
    const flat = unwrapBody(reqBody);

    // keep original body if it already exists + has keys; else replace
    if (!req.body || !Object.keys(req.body).length) req.body = flat;

    const hdrs =
      (reqBody && reqBody.headers) || (flat && flat.headers) || undefined;
    promoteHeader(req, hdrs, "X-Original-Host", "x-original-host");
    // critical for legacy cookie flow:
    promoteHeader(req, hdrs, "X-accessToken", "x-accesstoken");
  }

  // 2) derive the raw path, honoring X-Original-Host the same way as router
  let raw = String(reqPath || req?.path || "").split("?")[0];
  if (!raw || raw === "/") {
    const fromHeader =
      req?.get?.("X-Original-Host") ||
      req?.headers?.["x-original-host"] ||
      (req.body &&
        req.body.headers &&
        (req.body.headers["X-Original-Host"] || req.body.headers["x-original-host"]));
    if (fromHeader) {
      const p = String(fromHeader).replace(/^https?:\/\/[^/]+/, "");
      raw = p.split("?")[0];
    }
  }

  // 3) determine action if not provided (consistent with normalize())
  let a = action;
  if (!a) {
    const segs = String(raw || "").split("/").filter(Boolean);
    a = segs[0] === "cookies" || segs[0] === "url" ? segs[1] || "" : segs[0] || "";
  }

  // 4) normalize tail the same way modules expect
  const normalizeTail = (rawPath) => {
    const segs = String(rawPath || "").split("/").filter(Boolean);
    const tail =
      segs[0] === "cookies" || segs[0] === "url"
        ? "/" + segs.slice(2).join("/")
        : "/" + segs.slice(1).join("/");
    return tail || "/";
  };

  const ctx = {
    req,
    res,
    path: normalizeTail(raw),
    type: req?.type || reqType,
    signer: _signer,
    deps: _deps,
    // pass through xAccessToken like the legacy code path
    xAccessToken:
      xAccessToken ||
      req?.get?.("X-accessToken") ||
      req?.headers?.["x-accesstoken"] ||
      req?.headers?.["x-accessToken"],
  };

  try {
    const result = await ensureShared().dispatch(a, ctx, { cookie: req?.cookies || {} });

    if (!res?.headersSent) {
      if (res?.json) return res.json(result ?? { ok: false, error: `No handler for "${a}"` });
      return result;
    }
  } catch (err) {
    console.error("cookies route adapter error", { action: a, path: ctx.path, err });
    if (!res?.headersSent && res?.status && res?.json) {
      res.status(500).json({ ok: false, error: err?.message || "Internal Server Error" });
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Legacy helper exports — these delegate to shared.* so modules stay intact
// ───────────────────────────────────────────────────────────────────────────────
const bind = (name) => (...args) => {
  const s = ensureShared();
  if (typeof s[name] !== "function") throw new Error(`shared.${name} not found`);
  return s[name](...args);
};

module.exports = {
  setupRouter,
  route,

  // legacy names (must exist in shared)
  getHead: bind("getHead"),
  convertToJSON: bind("convertToJSON"),
  manageCookie: bind("manageCookie"),
  getSub: bind("getSub"),
  createVerified: bind("createVerified"),
  incrementCounterAndGetNewValue: bind("incrementCounterAndGetNewValue"),
  getWord: bind("getWord"),
  createWord: bind("createWord"),
  addVersion: bind("addVersion"),
  updateEntity: bind("updateEntity"),
  getEntity: bind("getEntity"),
  verifyThis: bind("verifyThis"),
  putLink: bind("putLink"),
  deleteLink: bind("deleteLink"),
};
