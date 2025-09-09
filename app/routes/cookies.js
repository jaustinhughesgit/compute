// routes/cookies.js
"use strict";

const express = require("express");
const AWS = require("aws-sdk");
const { createShared } = require("./shared");

let _deps, _shared, _signer;
const ensureShared = () => (_shared ?? (_shared = createShared(_deps)));

function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  _deps = { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = createShared(_deps);
  // Use your fixed key pair ID here; or switch to env via process.env.CF_KEYPAIR_ID
  _signer = new AWS.CloudFront.Signer("K2LZRHRSYZRU3Y", privateKey);

  const regOpts = { on: _shared.on, use: _shared.use };
  const reg = (p) => {
    const m = require(p);
    const c = (m && m.register) ? m : (m?.default?.register ? m.default : null);
    if (!c) throw new TypeError(`Module "${p}" does not export register()`);
    return c.register(regOpts);
  };

  // register all modules
  reg("./modules/get"); reg("./modules/file"); reg("./modules/links"); reg("./modules/tasks"); reg("./modules/groups");
  reg("./modules/validation"); reg("./modules/updateEntityByAI"); reg("./modules/position"); reg("./modules/search"); reg("./modules/getFile");
  reg("./modules/shorthand"); reg("./modules/convert"); reg("./modules/embed"); reg("./modules/users"); reg("./modules/passphrases");
  reg("./modules/map"); reg("./modules/extend"); reg("./modules/saveFile"); reg("./modules/makePublic"); reg("./modules/fineTune");
  reg("./modules/runEntity"); reg("./modules/resetDB"); reg("./modules/add"); reg("./modules/addIndex");

  const router = express.Router({ mergeParams: true });

  // Normalize incoming paths so modules always get a clean "tail" in ctx.path,
  // and we consistently derive the action/type.
  const normalize = (rawPath, typeFromParams, queryType) => {
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

    return { action, type, pathForModules };
  };

  // One handler that supports BOTH: /cookies/<action> and legacy POST /cookies with X-Original-Host
  router.all("*", async (req, res) => {
    let cookie = req.cookies || {};

    // 👇 ensure we have a cookie record with a GI (bootstrap)
    if (!cookie.gi) {
      try {
        const xTok =
          cookie.accessToken ||
          req.get("x-access-token") ||
          req.headers["x-access-token"] ||
          req.body?.accessToken;

        const manageCookie = ensureShared().use("manageCookie");
        const record = await manageCookie({}, xTok, res, _deps.dynamodb, _deps.uuidv4);
        if (record) cookie = { ...cookie, ...record };
      } catch (e) {
        console.warn("cookie bootstrap failed", e);
      }
    }

    let rawPath = String(req.path || "").split("?")[0];
    let type = req.params?.type || req.type || req.query?.type;

    // Legacy bridge: compute worker posts to "/cookies" and sticks the original URL in X-Original-Host
    if (rawPath === "/" || rawPath === "") {
      const xoh = req.get("X-Original-Host") || req.body?.headers?.["X-Original-Host"];
      if (xoh) {
        const p = String(xoh).replace(/^https?:\/\/[^/]+/, ""); // strip scheme+host
        rawPath = p.split("?")[0]; // e.g. "/cookies/get/<id>"
      }
    }

    const { action, type: t, pathForModules } = normalize(rawPath, type, req.query?.type);
    type = t;

    const ctx = {
      req,
      res,
      path: pathForModules, // what your modules expect as "tail"
      type,
      signer: _signer,
      deps: _deps
    };

    try {
      const result = await ensureShared().dispatch(action, ctx, { cookie });

      if (!res.headersSent) {
        if (result && result.__handled) return;
        if (result) return res.json(result);
        return res.status(404).json({ ok: false, error: `No handler for "${action}"` });
      }
    } catch (err) {
      console.error("cookies route error", { action, pathForModules, err });
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: err?.message || "Internal Server Error" });
      }
    }
  });

  return router;
}

/* Optional: legacy helper exports via shared (only if shared implements them) */
const bind = (name) => (...args) => {
  const s = ensureShared();
  if (typeof s[name] !== "function") throw new Error(`shared.${name} not found`);
  return s[name](...args);
};

/**
 * Adapter function: call the same dispatch logic without an Express router.
 * Keeps path normalization consistent with setupRouter().
 */
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
    console.log("dynamodb",dynamodb);
    console.log("dynamodbLL",dynamodbLL);

    
  // Initialize shared deps/signer once
  _deps = _deps || { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _signer = _signer || signer || new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID, privateKey);

  const raw = String(reqPath || req?.path || "").split("?")[0];

  // Determine action if not provided
  let a = action;
  if (!a) {
    const segs = raw.split("/").filter(Boolean);
    a = (segs[0] === "cookies" || segs[0] === "url") ? (segs[1] || "") : (segs[0] || "");
  }

  // Normalize tail to what modules expect (same logic as normalize())
  const normalizeTail = (rawPath) => {
    const segs = String(rawPath || "").split("/").filter(Boolean);
    return (segs[0] === "cookies" || segs[0] === "url")
      ? "/" + segs.slice(2).join("/")
      : "/" + segs.slice(1).join("/");
  };

  const ctx = {
    req,
    res,
    path: normalizeTail(raw),
    type: req?.type || reqType,
    signer: _signer,
    deps: _deps
  };

  try {
    const result = await ensureShared().dispatch(a, ctx, { cookie: req?.cookies || {} });
    if (!res?.headersSent) {
      return res.json(result ?? { ok: false, error: `No handler for "${a}"` });
    }
  } catch (err) {
    console.error("cookies route adapter error", { action: a, path: ctx.path, err });
    if (!res?.headersSent) {
      res.status(500).json({ ok: false, error: err?.message || "Internal Server Error" });
    }
  }
}

module.exports = {
  setupRouter,
  route,
  // legacy names (these must exist in shared)
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
  getLinkedChildren: bind("getLinkedChildren"),
  getLinkedParents: bind("getLinkedParents"),
  putLink: bind("putLink"),
  deleteLink: bind("deleteLink"),
};
