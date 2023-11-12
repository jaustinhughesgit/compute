const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
const SM = new AWS.SecretsManager;
//const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

console.log("start");

async function retrieveSecret() {
    try {
        const response = await SM.getSecretValue({ SecretId: "public/1var/s3" }).promise();
        console.log("response", response)
        const secretString = response.SecretString;
        console.log("secretString", secretString);
        const secret = JSON.parse(secretString);
        console.log("secret",secret);
        privateKey = secret.privateKey; // Adjust according to your secret's structure
        console.log("privateKey", privateKey);
        // Setup your routes here
        var indexRouter = require('./routes/index');
        var cookiesRouter = require('./routes/cookies')(privateKey); // Pass privateKey to your router
        app.use('/', indexRouter);
        app.use('/cookies', cookiesRouter);
    } catch (error) {
        console.error("Error retrieving secret:", error);
    }
}

retrieveSecret();

module.exports.lambdaHandler = serverless(app);