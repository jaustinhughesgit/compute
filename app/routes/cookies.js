// routes/cookies.js
"use strict";

const express = require("express");
const AWS = require("aws-sdk");
const util = require("util");
const { createShared } = require("./shared"); /* shared exposes:
  Registry: on, use, dispatch, expose, actions, registry, cache
  Toggles: setIsPublic, fileLocation
  Utils: isObject, isCSV, parseCSV, deepEqual, sleep, getUUID, moment
  Domain (Dynamo): getSub, getEntity, getWord, getGroup, getAccess, getVerified, getGroups, getTasks
  Links: makeLinkId, makeCKey, putLink, deleteLink, getLinkedChildren, getLinkedParents, migrateLinksFromEntities
  Versions/Entities/Words/Groups: incrementCounterAndGetNewValue, addVersion, updateEntity, createWord, createGroup, createEntity, createSubdomain
  Access/Cookies/Auth: createAccess, createVerified, createCookie, getCookie, manageCookie, verifyThis, useAuth, useFunc
  S3/Files: createFile, retrieveAndParseJSON
  Tree: convertToJSON
  Misc: getHead, sendBack, getDocClient, getS3, getSES
  Deps bag: deps { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
*/

let _deps, _shared, _signer;
const ensureShared = () => (_shared ?? (_shared = createShared(_deps)));

function unwrapBody(b) {
  if (!b || typeof b !== "object") return b;
  if (b.body && typeof b.body === "object") return b.body;
  return b;
}

function promoteHeader(req, hdrs, name, targetLower) {
  if (!hdrs) return;
  const v = hdrs[name] ?? hdrs[name.toLowerCase()];
  if (v == null) return;
  req.headers ||= {};
  req.headers[targetLower] = v;
}

function normalize(rawPath, typeFromParams, queryType) {
  let rp = String(rawPath || "").split("?")[0];
  const segs = rp.split("/").filter(Boolean);

  let type = typeFromParams || queryType;
  let action = "";
  let pathForModules = rp;

  if (segs[0] === "cookies" || segs[0] === "url") {
    type = type || segs[0];
    action = segs[1] || "";
    pathForModules = "/" + segs.slice(2).join("/");
  } else {
    // Mounted at "/<action>/..."
    action = segs[0] || "";
    pathForModules = "/" + segs.slice(1).join("/");
  }

  if (!pathForModules) pathForModules = "/";
  return { action, type, pathForModules };
}

// ───────────────────────────────────────────────────────────────────────────────
// Express router (preferred)
// ───────────────────────────────────────────────────────────────────────────────
function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  // IMPORTANT: pass uuidv4 so shared.getUUID() can use it
  _deps = { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = createShared(_deps);

  // Mint (or lookup) a cookie and attach it both to ctx and req.cookies
  _shared.use(async (ctx) => {
    const main = {};
    const ck = await _shared.manageCookie(
      main,
      ctx.xAccessToken,   // picked from headers below
      ctx.res             // lets manageCookie set Set-Cookie header
    );

    // Make this cookie available everywhere downstream
    ctx.cookie = ck;
    ctx.req.cookies ||= {};
    Object.assign(ctx.req.cookies, ck);
  });

  // keep legacy default, but prefer env
  _signer =
    _signer ||
    new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID || "K2LZRHRSYZRU3Y", privateKey);

  const useCompat = (mw) => (typeof mw === "function" ? _shared.use(mw) : _shared);
  const regOpts = { on: _shared.on, use: useCompat };

  const reg = (p) => {
    const m = require(p);
    const mod = m?.register ? m : m?.default?.register ? m.default : null;
    if (!mod) throw new TypeError(`Module "${p}" does not export register()`);
    return mod.register(regOpts); // pass adapter, not _shared directly
  };

  // register all modules
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

  router.all("*", async (req, res) => {
    try {
      // Flush shared caches per request (parity with old behavior)
      const s = ensureShared();
      if (s.cache) {
        for (const k of Object.keys(s.cache)) s.cache[k] = Object.create(null);
      }

      if (req.body && typeof req.body === "object") {
        const maybeHeaders =
          req.body.headers || (req.body.body && req.body.body.headers) || null;

        if (maybeHeaders) {
          promoteHeader(req, maybeHeaders, "X-Original-Host", "x-original-host");
          promoteHeader(req, maybeHeaders, "X-accessToken", "x-accesstoken");
        }

        req.body = unwrapBody(req.body);
      }

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

      const ctx = {
        req,
        res,
        path: pathForModules,
        type,
        signer: _signer,
        deps: _deps,
        xAccessToken:
          req.get?.("X-accessToken") ||
          req.headers?.["x-accesstoken"] ||
          req.headers?.["x-accessToken"],
      };

      // Try modules first
      const result = await s.dispatch(action, ctx, { cookie });
      if (res.headersSent) return;
      if (result && result.__handled) return; // explicit no-op (legacy parity)

      // If a module returned something concrete, respect it.
      if (result !== undefined && result !== null) {
        return _shared.sendBack(res, "json", result, /*isShorthand*/ false);
      }

      // ───────────────────────────────────────────────────────────────────
      // Legacy-compat fallback: bottom-of-old-cookies.js behavior
      // (only kicks in if no module handled the action)
      // ───────────────────────────────────────────────────────────────────
      await legacyBottomCompat({ action, type, pathForModules, req, res, cookie });

      if (res.headersSent) return;

      // Legacy: empty JSON when nothing to do
      return _shared.sendBack(res, "json", {}, /*isShorthand*/ false);
    } catch (err) {
      console.error("cookies route error", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
      if (!res.headersSent) {
        // Legacy error shape
        _shared.sendBack(res, "json", { ok: false, response: {} }, /*isShorthand*/ false);
      }
    }
  });

  return router;
}

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
  _deps = _deps || { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = _shared || createShared(_deps);
  _signer =
    _signer || signer || new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID || "K2LZRHRSYZRU3Y", privateKey);

  req = req || {};
  res = res || {};
  req.headers ||= {};

  if (reqBody) {
    const flat = unwrapBody(reqBody);
    if (!req.body || !Object.keys(req.body).length) req.body = flat;

    const hdrs =
      (reqBody && reqBody.headers) || (flat && flat.headers) || undefined;
    promoteHeader(req, hdrs, "X-Original-Host", "x-original-host");
    promoteHeader(req, hdrs, "X-accessToken", "x-accesstoken");
  }

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

  let a = action;
  if (!a) {
    const segs = String(raw || "").split("/").filter(Boolean);
    a = segs[0] === "cookies" || segs[0] === "url" ? segs[1] || "" : segs[0] || "";
  }

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
    xAccessToken:
      xAccessToken ||
      req?.get?.("X-accessToken") ||
      req?.headers?.["x-accesstoken"] ||
      req?.headers?.["x-accessToken"],
  };

  try {
    // Flush shared caches per request (parity with old behavior)
    const s = ensureShared();
    if (s.cache) {
      for (const k of Object.keys(s.cache)) s.cache[k] = Object.create(null);
    }

    const result = await s.dispatch(a, ctx, { cookie: req?.cookies || {} });

    if (!res?.headersSent) {
      if (result && result.__handled) return; // legacy parity
      if (res?.json && result !== undefined && result !== null) {
        return _shared.sendBack(res, "json", result, /*isShorthand*/ !!isShorthand);
      }

      // Legacy-compat fallback (bottom-of-old-cookies.js)
      await legacyBottomCompat({
        action: a,
        type: ctx.type,
        pathForModules: ctx.path,
        req,
        res,
        cookie: req?.cookies || {},
        isShorthand: !!isShorthand,
      });
      if (res?.headersSent) return;

      if (res?.json) {
        // No handler → empty payload
        return _shared.sendBack(res, "json", {}, /*isShorthand*/ !!isShorthand);
      }
      // No HTTP writer (shorthand/programmatic) → return raw
      return result ?? {};
    }
  } catch (err) {
    console.error("cookies route adapter error", { action: a, path: ctx.path, err });
    if (!res?.headersSent && res?.status && res?.json) {
      _shared.sendBack(res, "json", { ok: false, response: {} }, /*isShorthand*/ !!isShorthand);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Legacy bottom-of-old-cookies.js behavior (compat layer)
   - action "file": CloudFront signed URL or signed cookies
   - action "reqPut": S3 pre-signed PUT
   This only runs when no module already handled the request.
   It mirrors the original control flow & response shape as closely as possible.
──────────────────────────────────────────────────────────────────────────── */
async function legacyBottomCompat({
  action,
  type,
  pathForModules,
  req,
  res,
  cookie,
  isShorthand = false,
}) {
  try {
    console.log("1", action)
    if (!action) return;

    // Build the legacy mainObj/response shape
    const actionFile = String(pathForModules || "/").replace(/^\//, "");
    let response;
    const mainObj = {};

    // carry through "existing" if it was set by manageCookie middleware
    console.log("2", "existing")
    if (cookie && Object.prototype.hasOwnProperty.call(cookie, "existing")) {
      mainObj["existing"] = cookie.existing;
    }
    console.log("2", "actionFile", actionFile)
    mainObj["file"] = actionFile + "";
    response = mainObj;

    console.log("action", action)
    if (action === "file") {
      const expires = 90_000;
      // Use the last known public/private toggle from shared; default to public if unknown
      const isPublic = !!ensureShared()._isPublic;
      const url = `https://${ensureShared().fileLocation(isPublic)}.1var.com/${actionFile}`;

      const policy = JSON.stringify({
        Statement: [
          {
            Resource: url,
            Condition: {
              DateLessThan: { "AWS:EpochTime": Math.floor((Date.now() + expires) / 1000) },
            },
          },
        ],
      });

      if (type === "url" || req?.type === "url" || req?.query?.type === "url") {
        // direct CloudFront URL
        const signedUrl = _signer.getSignedUrl({ url, policy });
        return ensureShared().sendBack(res, "json", { signedUrl }, isShorthand);
      }

      // signed-cookies branch (attach to domain)
      const cookies = _signer.getSignedCookie({ policy });
      Object.entries(cookies).forEach(([name, val]) => {
        res.cookie?.(name, val, {
          maxAge: expires,
          httpOnly: true,
          domain: ".1var.com",
          secure: true,
          sameSite: "None",
        });
      });

      return ensureShared().sendBack(res, "json", { ok: true, response }, isShorthand);
    } else if (action === "reqPut") {
      // Inputs may come from query or body; default content type if absent
      const isPublic = !!ensureShared()._isPublic;
      const bucketName = `${ensureShared().fileLocation(isPublic)}.1var.com`;
      const fileName = actionFile;
      const expires = 90_000;

      const fileCategory =
        req?.query?.fileCategory ||
        req?.body?.fileCategory ||
        req?.query?.category ||
        req?.body?.category ||
        "application";
      const fileType =
        req?.query?.fileType ||
        req?.body?.fileType ||
        req?.query?.type ||
        req?.body?.type ||
        "octet-stream";

      const params = {
        Bucket: bucketName,
        Key: fileName,
        Expires: Math.floor(expires / 1000), // AWS expects seconds
        ContentType: `${fileCategory}/${fileType}`,
      };

      try {
        // v2 SDK compat: promisify getSignedUrl
        const getSignedUrlAsync = (op, p) =>
          new Promise((resolve, reject) =>
            ensureShared()
              .getS3()
              .getSignedUrl(op, p, (err, url) => (err ? reject(err) : resolve(url)))
          );

        const url = await getSignedUrlAsync("putObject", params);
        response.putURL = url;
        return ensureShared().sendBack(res, "json", { ok: true, response }, isShorthand);
      } catch (err) {
        console.error("getSignedUrl failed:", err);
        return ensureShared().sendBack(res, "json", { ok: false, response: {} }, isShorthand);
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(response, "ot")) {
        return ensureShared().sendBack(res, "json", { ok: true, response }, isShorthand);
      } else if (isShorthand) {
        return ensureShared().sendBack(res, "json", { ok: true, response }, isShorthand);
      } else {
        return ensureShared().sendBack(res, "json", { ok: true, response }, isShorthand);
      }
    }
  } catch (e) {
    // Match legacy: return an empty shape on error if not already handled
    if (!res.headersSent) {
      return ensureShared().sendBack(res, "json", { ok: false, response: {} }, isShorthand);
    }
  }
}

const bind = (name) => (...args) => {
  const s = ensureShared();
  if (typeof s[name] !== "function") throw new Error(`shared.${name} not found`);
  return s[name](...args);
};

module.exports = {
  setupRouter,
  route,
  sendBack: bind("sendBack"),
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

  // explicit exports mirroring old tail
  getLinkedChildren: bind("getLinkedChildren"),
  getLinkedParents: bind("getLinkedParents"),
  putLink: bind("putLink"),
  deleteLink: bind("deleteLink"),
};
