const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

console.log("1");
const client = new SecretsManagerClient({ region: "us-east-1" });

async function retrieveSecret() {
    try {
        const response = await client.send(new GetSecretValueCommand({ SecretId: "public/1var/s3" }));
        const secretString = response.SecretString;
        console.log("3");
        const secret = JSON.parse(secretString);
        console.log("7");
        privateKey = secret.privateKey; // Adjust according to your secret's structure
        console.log(privateKey);
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