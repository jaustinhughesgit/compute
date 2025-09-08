// routes/cookies.js (controller)
const { createShared } = require('./shared');

function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
  const express = require('express');
  const router = express.Router();
  const AWS = require('aws-sdk');
  const signer = new AWS.CloudFront.Signer('K2LZRHRSYZRU3Y', privateKey);

  const shared = createShared({ dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic });

  // ── Core modules
  require('./modules/get').register({ on: shared.on, use: shared.use });
  require('./modules/file').register({ on: shared.on, use: shared.use });   // file + reqPut
  require('./modules/links').register({ on: shared.on, use: shared.use });  // createLinks, migrateLinks, link, unlink
  require('./modules/tasks').register({ on: shared.on, use: shared.use });  // tasks, createTask, deleteTask
  require('./modules/groups').register({ on: shared.on, use: shared.use }); // newGroup, useGroup, substituteGroup

  // ── Newly added modules
  require('./modules/validation').register({ on: shared.on, use: shared.use });       // validation, saveAuthenticator, makeAuthenticator, useAuthenticator
  require('./modules/updateEntityByAI').register({ on: shared.on, use: shared.use }); // updateEntityByAI
  require('./modules/position').register({ on: shared.on, use: shared.use });         // position
  require('./modules/search').register({ on: shared.on, use: shared.use });           // search
  require('./modules/getFile').register({ on: shared.on, use: shared.use });          // getFile

  // ── Added per request
  require('./modules/shorthand').register({ on: shared.on, use: shared.use });        // shorthand
  require('./modules/convert').register({ on: shared.on, use: shared.use });          // convert
  require('./modules/embed').register({ on: shared.on, use: shared.use });            // embed
  require('./modules/users').register({ on: shared.on, use: shared.use });            // createUser, getUserPubKeys
  require('./modules/passphrases').register({ on: shared.on, use: shared.use });      // wrapPassphrase, addPassphrase, decryptPassphrase

  // ── Existing registrations you already had
  require('./modules/map').register({ on: shared.on, use: shared.use });
  require('./modules/extend').register({ on: shared.on, use: shared.use });
  require('./modules/saveFile').register({ on: shared.on, use: shared.use });
  require('./modules/makePublic').register({ on: shared.on, use: shared.use });
  require('./modules/fineTune').register({ on: shared.on, use: shared.use }); // add/create/list/delete/events/retrieve/cancel


  require('./modules/runEntity').register({ on: shared.on, use: shared.use });
  require('./modules/resetDB').register({ on: shared.on, use: shared.use });
  require('./modules/add').register({ on: shared.on, use: shared.use });
  require('./modules/addIndex').register({ on: shared.on, use: shared.use });

  router.all('/*', async (req, res) => {
    const reqPath = (req.path || '').split('?')[0];
    const action = (reqPath.split('/')[2] || '').trim(); // e.g. "get", "file", "reqPut", etc.

    const ctx = {
      req, res,
      path: reqPath,
      type: req.query?.type,          // enables file module's "url" branch (signed URL)
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
