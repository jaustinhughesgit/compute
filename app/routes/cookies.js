// routes/cookies.js
// Keep the modular system, but add a tiny compat layer so app.js keeps working.

const express = require('express');
const AWS = require('aws-sdk');
const { createShared } = require('./shared');

// Prefer env; fall back to existing value or the old placeholder
const DEFAULT_CF_KEYPAIR_ID = process.env.AWS_CF_KEYPAIR_ID || 'K2LZRHRSYZRU3Y';

function buildSigner(privateKey, keyPairId = DEFAULT_CF_KEYPAIR_ID) {
  return new AWS.CloudFront.Signer(keyPairId, privateKey);
}

function setupRouter(
  privateKey,
  dynamodb,
  dynamodbLL,
  uuidv4,
  s3,
  ses,
  openai,
  Anthropic,
  opts = {} // { keyPairId?: string }
) {
  const router = express.Router();

  const signer = buildSigner(privateKey, opts.keyPairId);
  const shared = createShared({ dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic });

  // --- module registration stays exactly as in your new version ---
  const regOpts = { on: shared.on, use: shared.use };
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
  // --- end registration ---

  // -------- compat helpers (restore old assumptions) --------
  function normalizeFromOldEdgeHeaders(req) {
    // Old code sometimes used req.body.headers["X-Original-Host"], which is brittle.
    // Prefer real headers; gracefully fall back.
    const originalHostHdr = req.get('X-Original-Host') || req.headers['x-original-host'];
    const rawUrl = req.originalUrl || req.url || '/';
    let pathFromEdge = null;

    if (originalHostHdr && originalHostHdr.includes('1var.com')) {
      // Old code did: originalHost.split("1var.com")[1]
      const afterDomain = originalHostHdr.split('1var.com')[1] || '';
      pathFromEdge = (afterDomain.split('?')[0] || '').trim();
    }

    const cleanPath = (pathFromEdge || rawUrl).split('?')[0] || '/';
    const parts = cleanPath.split('/');
    // Expect /cookies/:action/...
    const action = (parts[2] || '').trim();

    const xAccessToken =
      req.get('X-accessToken') ||
      req.headers['x-accesstoken'] ||
      (req.cookies && req.cookies.accessToken) ||
      null;

    return { cleanPath, action, xAccessToken };
  }

  async function compatDispatch(req, res) {
    const { cleanPath, action, xAccessToken } = normalizeFromOldEdgeHeaders(req);

    const ctx = {
      req,
      res,
      path: cleanPath,
      type: req.query?.type,
      signer,
      // expose deps just like before
      deps: { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic },
      // some modules may read this off ctx
      xAccessToken
    };

    const cookie = req.cookies || {};
    const result = await shared.dispatch(action, ctx, { cookie });

    if (res.headersSent) return;           // module already handled (streams, redirects, etc.)
    if (result && result.__handled) return;

    // Old app.js expected { ok: true, response: <payload> }
    if (result && typeof result === 'object' && 'ok' in result && 'response' in result) {
      return res.json(result);
    }
    if (result !== undefined && result !== null) {
      return res.json({ ok: true, response: result });
    }
    return res.status(404).json({ ok: false, error: `No handler for "${action}"` });
  }

  // The new router path stays simple, but returns the old envelope
  router.all('/*', (req, res) => { void compatDispatch(req, res); });

  // ---------- restore an old-style exported route(...) function ----------
  // Some old app.js code called cookies.route(...) directly.
  async function route(
    req,
    res,
    next,
    _privateKey = privateKey,
    _dynamodb = dynamodb,
    _uuidv4 = uuidv4,
    _s3 = s3,
    _ses = ses,
    _openai = openai,
    _Anthropic = Anthropic,
    _dynamodbLL = dynamodbLL,
    /* legacy params (ignored but accepted) */ isShorthand = false,
    reqPath = req.path,
    reqBody = req.body,
    reqMethod = req.method,
    reqType = req.type,
    _reqHeaderSent = res.headersSent,
    _signer = signer,
    actionOverride,
    xAccessTokenOverride
  ) {
    // If legacy code stuffed headers into req.body.headers, merge them back.
    if (reqBody && reqBody.headers && typeof reqBody.headers === 'object') {
      for (const [k, v] of Object.entries(reqBody.headers)) {
        req.headers[String(k).toLowerCase()] = v;
      }
    }
    // Allow overriding the action like the old call sites
    if (actionOverride) {
      const base = req.originalUrl || req.url || reqPath || '/';
      const suffix = base.startsWith('/cookies/') ? base : `/cookies/${actionOverride}${base}`;
      req.url = suffix;
      req.originalUrl = suffix;
    }

    // Ensure path & query are present for normalizeFromOldEdgeHeaders
    if (!req.originalUrl) req.originalUrl = reqPath || '/';
    if (!req.url) req.url = req.originalUrl;

    // Provide token override if passed
    if (xAccessTokenOverride) {
      req.headers['x-accesstoken'] = xAccessTokenOverride;
    }
    return compatDispatch(req, res);
  }

  // Attach the compat route so legacy importers can call router.route(...)
  router.route = route;

  // Export the router (Express middleware) with the compat method attached
  return router;
}

module.exports = { setupRouter };
