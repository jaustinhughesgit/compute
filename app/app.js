const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');

// Initialize AWS Secrets Manager
const SM = new AWS.SecretsManager();

async function getPrivateKey() {
    const secretName = "tutorialSecretManager"; // Replace with your secret name
    try {
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
        const secret = JSON.parse(data.SecretString);
        return secret.privateKey;
    } catch (error) {
        console.error("Error fetching secret:", error);
        throw error;
    }
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

var indexRouter = require('./routes/index');
var cookiesRouter;

getPrivateKey().then(privateKey => {
    cookiesRouter = require('./routes/cookies')(privateKey);
    app.use('/', indexRouter);
    app.use('/cookies', cookiesRouter);
}).catch(error => {
    console.error("Failed to retrieve private key:", error);
    // Handle the error appropriately
});

module.exports.lambdaHandler = serverless(app);