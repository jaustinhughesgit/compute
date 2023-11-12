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

console.log("start");
const client = new SecretsManagerClient({ region: "us-east-1" });

async function retrieveSecret() {
    try {
        console.log("client", client)
        const command = await new GetSecretValueCommand({ SecretId: "public/1var/s3" }).promise();
        console.log("command", command)
        const response = await client.send(command);
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