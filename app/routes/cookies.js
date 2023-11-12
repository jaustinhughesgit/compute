const express = require('express');
const router = express.Router();
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const secretName = 'public/1var/s3'; // Replace with your secret name
const region = 'us-east-1'; // Replace with your region
const client = new SecretsManagerClient({ region });

let privateKey;
let isSecretFetched = false;

async function fetchSecret() {
    try {
        const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
        if (response.SecretString) {
            privateKey = JSON.parse(response.SecretString).privateKey; // Adjust based on your secret's structure
        } else {
            let buff = Buffer.from(response.SecretBinary, 'base64');
            privateKey = buff.toString('ascii');
        }
        isSecretFetched = true;
    } catch (error) {
        console.error("Error fetching secret:", error);
        throw error;
    }
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
    if (!privateKey) {
        return res.status(500).send('Private key not loaded');
    }

    // Your CloudFront key pair ID
    const keyPairId = 'K2LZRHRSYZRU3Y'; // Replace with your key pair ID

    // Create a CloudFront signer using the retrieved private key
    const AWS = require('aws-sdk');
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);

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
