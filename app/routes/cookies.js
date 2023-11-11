var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');
import {
    SecretsManagerClient,
    GetSecretValueCommand,
  } from "@aws-sdk/client-secrets-manager";

  const secret_name = "public/1var/s3";
  
  const client = new SecretsManagerClient({
    region: "us-east-1",
  });
  
  let response;
  
  try {
    response = await client.send(
      new GetSecretValueCommand({
        SecretId: secret_name,
        VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
      })
    );
  } catch (error) {
    // For a list of exceptions thrown, see
    // https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
    throw error;
  }
  
  const secret = response.SecretString;

// Your CloudFront key pair ID and private key
const keyPairId = 'K2LZRHRSYZRU3Y'; // Replace with your key pair ID 123
const privateKey = secret; // Replace with your private key 123

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

module.exports = router;
