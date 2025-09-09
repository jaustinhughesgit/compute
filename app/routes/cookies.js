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

    console.log("setupRouter!!!!!!!!!!!!!!!")
    router.all('/*', async function (req, res, next) {
        let xAccessToken = req.body.headers["X-accessToken"]
        let originalHost = req.body.headers["X-Original-Host"];
        let splitOriginalHost = originalHost.split("1var.com")[1];
        const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);
        let reqPath = splitOriginalHost.split("?")[0];
        let reqBody = req.body;
        const action = reqPath.split("/")[2];
        const reqMethod = req.method;
        const reqType = req.type;
        const reqHeaderSent = req._headerSent;
        let newReq = {};
        newReq.body = req.body
        newReq.method = req.method
        newReq.type = req.type
        newReq._headerSent = req._headerSent
        newReq.path = req.path
        route(newReq, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, false, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken)
    });
    return router;

}

module.exports = { setupRouter };
