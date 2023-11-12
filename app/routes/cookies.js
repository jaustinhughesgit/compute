var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();
let privateKey;

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

(async () => {
    try {
        const secret = await getSecret();
        privateKey = JSON.parse(secret).privateKey; // Ensure this matches how you've stored the key

console.log(privateKey);


// Your CloudFront key pair ID and private key
const keyPairId = 'K2LZRHRSYZRU3Y'; // Replace with your key pair ID 123
//const privateKey = secret; // Replace with your private key 123

// Use this code snippet in your app.
// If you need more information about configurations or implementing the sample code, visit the AWS docs:
// https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started.html


  

  
  // Your code goes here














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

    res.render('cookies', { title: 'Test' });
});
} catch (err) {
    console.error(err);
}
})();
module.exports = router;
