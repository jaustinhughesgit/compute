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
    action = segs[0] || "";
    pathForModules = "/" + segs.slice(1).join("/");
  }

  if (!pathForModules) pathForModules = "/";
  return { action, type, pathForModules };
}

function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  _deps = { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = createShared(_deps);

  _shared.use(async (ctx) => {
    const main = {};
    // If this is an opt-in request, do not create a new cookie or pre-create a group.
    // We'll set the existing (invite-time) cookie inside the opt-in handler itself.
    const p = String(ctx?.req?.headers?.["x-original-host"] || ctx?.req?.headers?.["X-Original-Host"]);
    console.log("ppp : ", p)
    if (p.includes("/opt-in")) {
      main.blockCookieBack = true;       // do not set a browser cookie here
      main.skipNewGroupPreCreate = true; // do not call newGroup from manageCookie
      main.suppressNewCookie = true;     // do not create a new cookie record at all
    }
    const ck = await _shared.manageCookie(
      main,
      ctx.xAccessToken,
      ctx.res
    );

    ctx.cookie = ck;
    ctx.req.cookies ||= {};
    Object.assign(ctx.req.cookies, ck);
  });

  _signer =
    _signer ||
    new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID || "K2LZRHRSYZRU3Y", privateKey);

  const useCompat = (mw) => (typeof mw === "function" ? _shared.use(mw) : _shared);
  const regOpts = { on: _shared.on, use: useCompat };

  const reg = (p) => {
    const m = require(p);
    const mod = m?.register ? m : m?.default?.register ? m.default : null;
    if (!mod) throw new TypeError(`Module "${p}" does not export register()`);
    return mod.register(regOpts);
  };

  reg("./modules/get");
  reg("./modules/file");
  reg("./modules/links");
  reg("./modules/tasks");
  reg("./modules/validation");
  reg("./modules/updateEntityByAI");
  reg("./modules/anchor");
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
  reg("./modules/reqPut");
  reg("./modules/newGroup");
  reg("./modules/useGroup");
  reg("./modules/substituteGroup");
  reg("./modules/paths");
  reg("./modules/email");
  reg("./modules/stop");
  reg("./modules/opt-in");

  const router = express.Router({ mergeParams: true });

  router.all("*", async (req, res) => {
    try {
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

      const result = await s.dispatch(action, ctx, { cookie });
      if (res.headersSent) return;
      if (result && result.__handled) return;

      if (result !== undefined && result !== null) {
        return _shared.sendBack(res, "json", result, /*isShorthand*/ false);
      }

      await legacyBottomCompat({ action, type, pathForModules, req, res, cookie });

      if (res.headersSent) return;

      return _shared.sendBack(res, "json", {}, /*isShorthand*/ false);
    } catch (err) {
      console.error("cookies route error", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ ok: false, error: err?.message || "Internal Server Error" });
      }
      if (!res.headersSent) {
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
  xAccessToken,
  Converter
) {
  console.log("route1")
  _deps = _deps || { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = _shared || createShared(_deps);
  _signer =
    _signer || signer || new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID || "K2LZRHRSYZRU3Y", privateKey);

  req = req || {};
  res = res || {};
  req.headers ||= {};

  console.log("route2")
  if (reqBody) {
    console.log("route3")
    const flat = unwrapBody(reqBody);
    if (!req.body || !Object.keys(req.body).length) req.body = flat;
    console.log("route4")

    const hdrs =
      (reqBody && reqBody.headers) || (flat && flat.headers) || undefined;
    promoteHeader(req, hdrs, "X-Original-Host", "x-original-host");
    promoteHeader(req, hdrs, "X-accessToken", "x-accesstoken");
  }

  console.log("route5")
  let raw = String(reqPath || req?.path || "").split("?")[0];
  if (!raw || raw === "/") {
    console.log("route6")
    const fromHeader =
      req?.get?.("X-Original-Host") ||
      req?.headers?.["x-original-host"] ||
      (req.body &&
        req.body.headers &&
        (req.body.headers["X-Original-Host"] || req.body.headers["x-original-host"]));
    if (fromHeader) {
      console.log("route7")
      const p = String(fromHeader).replace(/^https?:\/\/[^/]+/, "");
      raw = p.split("?")[0];
    }
  }

  console.log("route8")
  let a = action;
  if (!a) {
    console.log("route9")
    const segs = String(raw || "").split("/").filter(Boolean);
    a = segs[0] === "cookies" || segs[0] === "url" ? segs[1] || "" : segs[0] || "";
  }

  console.log("route10")
  const normalizeTail = (rawPath) => {
    console.log("route11")
    const segs = String(rawPath || "").split("/").filter(Boolean);
    const tail =
      segs[0] === "cookies" || segs[0] === "url"
        ? "/" + segs.slice(2).join("/")
        : "/" + segs.slice(1).join("/");
    return tail || "/";
  };

  console.log("route12")
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
    console.log("route13")
    const s = ensureShared();
    if (s.cache) {
      for (const k of Object.keys(s.cache)) s.cache[k] = Object.create(null);
    }

    const result = await s.dispatch(a, ctx, { cookie: req?.cookies || {} });

    console.log("route14")
    if (!res?.headersSent) {
      if (result && result.__handled) return;
      if (res?.json && result !== undefined && result !== null) {
        console.log("~~result", result)
        console.log("~~isShorthand", isShorthand)
        return _shared.sendBack(res, "json", result, /*isShorthand*/ !!isShorthand);
      }

      await legacyBottomCompat({
        action: a,
        type: ctx.type,
        pathForModules: ctx.path,
        req,
        res,
        cookie: req?.cookies || {},
        isShorthand: !!isShorthand,
      });
      console.log("~~headersSent")
      if (res?.headersSent) return;

      if (res?.json) {
        console.log("~~1")
        return _shared.sendBack(res, "json", {}, !!isShorthand);
      }
      console.log("~~2")
      return result ?? {};
    }
  } catch (err) {
    console.error("cookies route adapter error", { action: a, path: ctx.path, err });
    if (!res?.headersSent && res?.status && res?.json) {
      console.log("~~3")
      _shared.sendBack(res, "json", { ok: false, response: {} }, /*isShorthand*/ !!isShorthand);
    }
  }
}

async function legacyBottomCompat({ action, type, pathForModules, req, res, cookie, isShorthand = false }) {
  try {
    console.log("~~4")
    return ensureShared().sendBack(res, "json", { ok: true, response: {} }, isShorthand);
  } catch (e) {
    if (!res.headersSent) {

      console.log("~~5")
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

  getLinkedChildren: bind("getLinkedChildren"),
  getLinkedParents: bind("getLinkedParents"),
  putLink: bind("putLink"),
  deleteLink: bind("deleteLink"),
};
