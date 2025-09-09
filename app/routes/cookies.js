// routes/cookies.js
const express = require('express');
const AWS = require('aws-sdk');
const { createShared } = require('./shared');

// ────────────────────────── internal singletons ──────────────────────────
let _deps = null;      // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
let _shared = null;    // result of createShared(_deps)
let _signer = null;    // CloudFront signer

function ensureShared() {
  if (!_shared) {
    if (!_deps) throw new Error('[cookies] Not initialized yet (call setupRouter first)');
    _shared = createShared(_deps);
  }
  return _shared;
}

function ensureSigner() {
  if (!_signer) throw new Error('[cookies] Signer not initialized');
  return _signer;
}

// ───────────────────────────── router setup ──────────────────────────────
function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  // cache deps for legacy exports
  _deps = { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = createShared(_deps);

  // IMPORTANT: use your real CloudFront key pair id
  _signer = new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID, privateKey);

  // register modules with shared.on/use
  const regOpts = { on: _shared.on, use: _shared.use };
  const registerModule = (p) => {
    const mod = require(p);
    const candidate =
      (mod && typeof mod.register === 'function' && mod) ||
      (mod && mod.default && typeof mod.default.register === 'function' && mod.default) ||
      null;
    if (!candidate) {
      const keys = mod ? Object.keys(mod) : [];
      throw new TypeError(`Module "${p}" does not export register(); keys=[${keys.join(', ')}]`);
    }
    return candidate.register(regOpts);
  };

  // Core
  registerModule('./modules/get');
  registerModule('./modules/file');
  registerModule('./modules/links');
  registerModule('./modules/tasks');
  registerModule('./modules/groups');
  // Newly added
  registerModule('./modules/validation');
  registerModule('./modules/updateEntityByAI');
  registerModule('./modules/position');
  registerModule('./modules/search');
  registerModule('./modules/getFile');
  // Extras
  registerModule('./modules/shorthand');
  registerModule('./modules/convert');
  registerModule('./modules/embed');
  registerModule('./modules/users');
  registerModule('./modules/passphrases');
  // Existing
  registerModule('./modules/map');
  registerModule('./modules/extend');
  registerModule('./modules/saveFile');
  registerModule('./modules/makePublic');
  registerModule('./modules/fineTune');
  registerModule('./modules/runEntity');
  registerModule('./modules/resetDB');
  registerModule('./modules/add');
  registerModule('./modules/addIndex');

  const router = express.Router({ mergeParams: true });

  router.all('*', async (req, res) => {
    // Mounted at "/:type(cookies|url)". After mount, first segment is the action
    const segs = (req.path || '').split('/').filter(Boolean);
    const action = (segs[0] || '').trim();

    const ctx = {
      req,
      res,
      path: (req.path || '').split('?')[0],
      type: req.params?.type || req.type || req.query?.type,
      signer: ensureSigner(),
      deps: _deps,
    };

    const cookie = req.cookies || {};
    const result = await _shared.dispatch(action, ctx, { cookie });

    if (!res.headersSent) {
      if (result && result.__handled) return;
      if (result) return res.json(result);
      return res.status(404).json({ ok: false, error: `No handler for "${action}"` });
    }
  });

  return router;
}

// ───────────────────────── legacy compatibility ──────────────────────────
// Some code paths (like your app.js) import these helpers from cookies.js.
// We forward them into the shared implementation once setupRouter has run.
// If you moved these helpers into separate files, update the property names
// below to match what createShared(...) exposes.

async function route(
  req, res, next,
  privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL,
  isShorthand, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken
) {
  // Adapter that mimics the old signature and executes through shared.dispatch
  // Derive action if not provided
  const act =
    action ||
    ((reqPath || '').split('?')[0].split('/')[2] || '').trim() ||
    ((req.path || '').split('/').filter(Boolean)[0] || '');

  // Make sure our singletons exist (setupRouter usually ran already)
  if (!_deps) {
    _deps = { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  }
  if (!_signer) {
    _signer = signer || new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID, privateKey);
  }
  const shared = ensureShared();

  const ctx = {
    req, res,
    path: reqPath || (req?.path || ''),
    type: req?.type || reqType,
    signer: ensureSigner(),
    deps: _deps
  };

  const cookie = (req && req.cookies) || {};
  const result = await shared.dispatch(act, ctx, { cookie });

  if (!res.headersSent) {
    if (result && result.__handled) return;
    if (result) return res.json(result);
    return res.status(404).json({ ok: false, error: `No handler for "${act}"` });
  }
}

// Helper to map exported names to shared implementation
const bind = (name) => {
  return (...args) => {
    const s = ensureShared();
    if (typeof s[name] !== 'function') {
      throw new Error(`[cookies] shared.${name} is not available`);
    }
    return s[name](...args);
  };
};

// Re-export the legacy helpers (names preserved)
const getHead = bind('getHead');
const convertToJSON = bind('convertToJSON');
const manageCookie = bind('manageCookie');
const getSub = bind('getSub');
const createVerified = bind('createVerified');
const incrementCounterAndGetNewValue = bind('incrementCounterAndGetNewValue');
const getWord = bind('getWord');
const createWord = bind('createWord');
const addVersion = bind('addVersion');
const updateEntity = bind('updateEntity');
const getEntity = bind('getEntity');
const verifyThis = bind('verifyThis');

// Links helpers (new table) — also provided by shared
const getLinkedChildren = bind('getLinkedChildren');
const getLinkedParents  = bind('getLinkedParents');
const putLink           = bind('putLink');
const deleteLink        = bind('deleteLink');

module.exports = {
  // new
  setupRouter,

  // legacy API surface
  route,
  getHead,
  convertToJSON,
  manageCookie,
  getSub,
  createVerified,
  incrementCounterAndGetNewValue,
  getWord,
  createWord,
  addVersion,
  updateEntity,
  getEntity,
  verifyThis,

  // links helpers
  getLinkedChildren,
  getLinkedParents,
  putLink,
  deleteLink,
};
