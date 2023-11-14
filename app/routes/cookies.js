var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

module.exports = function(privateKey) {
    var router = express.Router();

    const keyPairId = 'K2LZRHRSYZRU3Y'; 
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);

    router.get('/', async function(req, res, next) {
        const expires = 30000; // .5 minutes in milliseconds
        const url = "https://public.1var.com/test2.txt";
        const policy = JSON.stringify({
            Statement: [
                {
                    Resource: url,
                    Condition: {
                        DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + expires) / 1000) }
                    }
                }
            ]
        });

        if (false){
            const url = signer.getSignedUrl({
                url: 'https://public.1var.com/test.txt',
                policy: policy
            });
            res.json({ signedUrl: url });
        } else {
            const cookies = signer.getSignedCookie({
                policy: policy
            });

            for (const cookieName in cookies) {
                res.cookie(cookieName, cookies[cookieName], { maxAge: twoMinutes, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
            }
            res.render('cookies', { title: 'Test' });
        }   
    });

    return router;

}
