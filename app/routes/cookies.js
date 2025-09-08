// routes/cookies.js
const { createShared } = require('./shared');

function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  const express = require('express');
  const router = express.Router();
  const AWS = require('aws-sdk');
  const signer = new AWS.CloudFront.Signer('K2LZRHRSYZRU3Y', privateKey);

  const shared = createShared({ dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic });

  const regOpts = { on: shared.on, use: shared.use };
  const registerModule = (p) => {
    let mod = require(p);
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

  router.all('/*', async (req, res) => {
    const reqPath = (req.path || '').split('?')[0];
    const action = (reqPath.split('/')[2] || '').trim();

    const ctx = {
      req, res,
      path: reqPath,
      type: req.query?.type,
      signer,
      deps: { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
    };

    const cookie = req.cookies || {};
    const result = await shared.dispatch(action, ctx, { cookie });

    if (!res.headersSent) {
      if (result && result.__handled) return;
      if (result) return res.json(result);
      return res.status(404).json({ ok: false, error: `No handler for "${action}"` });
    }
  });

  return router;
}

module.exports = { setupRouter };
