var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

module.exports = function(privateKey) {
    var router = express.Router();

// Your CloudFront key pair ID and private key
const keyPairId = 'K2LZRHRSYZRU3Y'; // Replace with your key pair ID 123


// Create a CloudFront signer
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
        // Render the 'cookies' view with the title 'Test'
        res.render('cookies', { title: 'Test' });
    });

    return router;

}
