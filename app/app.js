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

const secretName = process.env.SECRET_NAME || "public/1var/s3"; // Use environment variable
const region = process.env.AWS_REGION || "us-east-1"; // Use environment variable

const client = new SecretsManagerClient({ region });

async function getSecret() {
    console.log("4")
    //try {
        const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
        console.log("5")
        return response.SecretString;
    //} catch (error) {
    //    console.log("6")
     //   console.error("Error fetching secret:", error);
    //    throw error;
    //}
}

let privateKey;

console.log("1")

async function setup() {
    console.log("2")
    //try {
        const secretString = await getSecret();
        console.log("3")
        const secret = JSON.parse(secretString);
        console.log("7")
        privateKey = secret.privateKey; // Adjust according to your secret's structure
        console.log(privateKey)
        // Setup your routes here
        var indexRouter = require('./routes/index');
        var cookiesRouter = require('./routes/cookies')(privateKey); // Pass privateKey to your router
        app.use('/', indexRouter);
        app.use('/cookies', cookiesRouter);

    //} catch (error) {
    //    console.log("8")
    //    console.error("Error in setup:", error);
        // Handle initialization error
    //}
}

setup();

module.exports.lambdaHandler = serverless(app);