// routes/cookies.js
const express = require('express');
const AWS = require('aws-sdk');
const { createShared } = require('./shared');

let _deps, _shared, _signer;
const ensureShared = () => (_shared ?? (_shared = createShared(_deps)));

function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  _deps = { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _shared = createShared(_deps);
  _signer = new AWS.CloudFront.Signer("K2LZRHRSYZRU3Y", privateKey);

  const regOpts = { on: _shared.on, use: _shared.use };
  const reg = (p) => {
    const m = require(p);
    const c = (m && m.register) ? m : (m?.default?.register ? m.default : null);
    if (!c) throw new TypeError(`Module "${p}" does not export register()`);
    return c.register(regOpts);
  };

  // register all modules (same as you listed)
  reg('./modules/get'); reg('./modules/file'); reg('./modules/links'); reg('./modules/tasks'); reg('./modules/groups');
  reg('./modules/validation'); reg('./modules/updateEntityByAI'); reg('./modules/position'); reg('./modules/search'); reg('./modules/getFile');
  reg('./modules/shorthand'); reg('./modules/convert'); reg('./modules/embed'); reg('./modules/users'); reg('./modules/passphrases');
  reg('./modules/map'); reg('./modules/extend'); reg('./modules/saveFile'); reg('./modules/makePublic'); reg('./modules/fineTune');
  reg('./modules/runEntity'); reg('./modules/resetDB'); reg('./modules/add'); reg('./modules/addIndex');

  const router = express.Router({ mergeParams: true });

  // One handler that supports BOTH: /cookies/<action> and legacy POST /cookies with X-Original-Host
  router.all('*', async (req, res) => {
    const cookie = req.cookies || {};
    let rawPath = (req.path || '').split('?')[0];        // e.g. "/get/1v4r..."
    let type = req.params?.type || req.type || req.query?.type;
    let action = '';
    let pathForModules = rawPath;

    // Legacy bridge: compute worker posts to "/cookies" and sticks the original URL in X-Original-Host
    if (rawPath === '/' || rawPath === '') {
      const xoh = req.get('X-Original-Host') || req.body?.headers?.['X-Original-Host'];
      if (xoh) {
        const p = String(xoh).replace(/^https?:\/\/[^/]+/, ''); // strip scheme+host
        rawPath = p.split('?')[0];                              // "/cookies/get/<id>"
      }
    }

    const segs = rawPath.split('/').filter(Boolean);
    // If mounted at "/:type", segs is like ["get", "<id>..."]; if legacy, segs is ["cookies","get","<id>..."]
    if (segs[0] === 'cookies' || segs[0] === 'url') {
      type = type || segs[0];
      action = segs[1] || '';
      pathForModules = '/' + segs.slice(2).join('/');          // "/<id>..."
    } else {
      action = segs[0] || '';
      pathForModules = '/' + segs.slice(1).join('/');          // "/<id>..."
    }

    const ctx = {
      req, res,
      path: pathForModules,  // what your modules expect as "tail"
      type,
      signer: _signer,
      deps: _deps
    };

    const result = await ensureShared().dispatch(action, ctx, { cookie });

    if (!res.headersSent) {
      if (result && result.__handled) return;
      if (result) return res.json(result);
      return res.status(404).json({ ok: false, error: `No handler for "${action}"` });
    }
  });

  return router;
}

/* Optional: legacy helper exports via shared (only if shared implements them) */
const bind = (name) => (...args) => {
  const s = ensureShared();
  if (typeof s[name] !== 'function') throw new Error(`shared.${name} not found`);
  return s[name](...args);
};

async function route(req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL,
  isShorthand, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken) {
  // Adapter: call the same dispatch logic
  _deps = _deps || { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic };
  _signer = _signer || signer || new AWS.CloudFront.Signer(process.env.CF_KEYPAIR_ID, privateKey);

  const p = (reqPath || req?.path || '').split('?')[0];
  let a = action;
  if (!a) {
    const segs = p.split('/').filter(Boolean);
    a = segs[2] || segs[0] || ''; // supports both "/cookies/<a>" and raw "<a>"
  }
  const ctx = { req, res, path: p, type: req?.type || reqType, signer: _signer, deps: _deps };
  const result = await ensureShared().dispatch(a, ctx, { cookie: req.cookies || {} });

  if (!res.headersSent) return res.json(result ?? { ok: false, error: `No handler for "${a}"` });
}

module.exports = {
  setupRouter,
  route,
  // legacy names (these must exist in shared)
  getHead: bind('getHead'),
  convertToJSON: bind('convertToJSON'),
  manageCookie: bind('manageCookie'),
  getSub: bind('getSub'),
  createVerified: bind('createVerified'),
  incrementCounterAndGetNewValue: bind('incrementCounterAndGetNewValue'),
  getWord: bind('getWord'),
  createWord: bind('createWord'),
  addVersion: bind('addVersion'),
  updateEntity: bind('updateEntity'),
  getEntity: bind('getEntity'),
  verifyThis: bind('verifyThis'),
  getLinkedChildren: bind('getLinkedChildren'),
  getLinkedParents: bind('getLinkedParents'),
  putLink: bind('putLink'),
  deleteLink: bind('deleteLink'),
};
