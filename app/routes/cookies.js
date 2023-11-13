var express = require('express');
const AWS = require('aws-sdk');

// Initialize AWS Secrets Manager
const SM = new AWS.SecretsManager();

async function getPrivateKey() {
    const secretName = "public/1var/s3"; // Replace with your secret name
    try {
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
        const secret = JSON.parse(data.SecretString);
        return secret.privateKey;
    } catch (error) {
        console.error("Error fetching secret:", error);
        throw error;
    }
}

var router = express.Router();

router.get('/', async function(req, res, next) {
    try {
        const privateKey = await getPrivateKey();

        // Your CloudFront key pair ID and private key
        const keyPairId = 'K2LZRHRSYZRU3Y'; // Replace with your key pair ID

        // Create a CloudFront signer
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

        // Render the 'cookies' view with the title 'Test'
        res.render('cookies', { title: 'Test' });
    } catch (error) {
        console.error("Error in /cookies route:", error);
        res.status(500).send("Server Error");
    }
});

module.exports = router;