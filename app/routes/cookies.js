var express = require('express');
const AWS = require('aws-sdk');

// Export a function that accepts privateKey
module.exports = function(privateKey) {
    var router = express.Router();

    // Your CloudFront key pair ID
    const keyPairId = 'K2LZRHRSYZRU3Y'; // Replace with your key pair ID

    // Create a CloudFront signer using the privateKey passed from app.js
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);

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

    return router;
};