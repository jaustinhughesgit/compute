const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

let privateKey;
let isSecretFetched = false;

async function fetchSecret() {
    const secretName = 'public/1var/s3'; // Replace with your secret name
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();

    if ('SecretString' in data) {
        privateKey = JSON.parse(data.SecretString).privateKey;
    } else {
        let buff = new Buffer(data.SecretBinary, 'base64');
        privateKey = buff.toString('ascii');
    }
    isSecretFetched = true;
}

// Fetch the secret when the module is loaded
fetchSecret().catch(console.error);

// Middleware to ensure secret is loaded
function ensureSecretLoaded(req, res, next) {
    if (!isSecretFetched) {
        return res.status(503).send('Service not ready');
    }
    next();
}

router.use(ensureSecretLoaded);

router.get('/', async function(req, res, next) {
    // Set the policy for the signed cookies
    const twoMinutes = 30000; // .5 minutes in milliseconds
    const policy = JSON.stringify({
        Statement: [
            {
                Resource: 'https://public.1var.com/test.txt', // The URL pattern to allow
                Condition: {
                    DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + twoMinutes) / 1000) }
                }
            }
        ]
    });

    // Generate signed cookies
    const cookies = signer.getSignedCookie({
        policy: policy
    });

    // Set the signed cookies in the response
    for (const cookieName in cookies) {
        res.cookie(cookieName, cookies[cookieName], { maxAge: twoMinutes, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
    }

    res.render('cookies', { title: 'Test' });
});

module.exports = router;
