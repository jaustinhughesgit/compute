var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function getSecret() {
    const secretName = 'public/1var/s3'; // Replace with your secret name
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();

    if ('SecretString' in data) {
        return data.SecretString;
    } else {
        let buff = new Buffer(data.SecretBinary, 'base64');
        return buff.toString('ascii');
    }
}

async function setupRoutes() {
    try {
        const secret = await getSecret();
        const privateKey = JSON.parse(secret).privateKey; // Ensure this matches how you've stored the key

        // Your CloudFront key pair ID
        const keyPairId = 'K2LZRHRSYZRU3Y'; // Replace with your key pair ID

        // Create a CloudFront signer using the retrieved private key
        const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);

        router.get('/', async function(req, res, next) {
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

            const cookies = signer.getSignedCookie({
                policy: policy
            });

            for (const cookieName in cookies) {
                res.cookie(cookieName, cookies[cookieName], { maxAge: twoMinutes, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
            }

            res.render('cookies', { title: 'Test' });
        });

    } catch (err) {
        console.error(err);
        // Handle error appropriately
    }
}

setupRoutes();

module.exports = router;