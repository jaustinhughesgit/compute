const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');

// Initialize AWS Secrets Manager
const SM = new AWS.SecretsManager();
console.log("1")
async function getPrivateKey() {
    console.log("2")
    const secretName = "public/1var/s3"; // Replace with your secret name
    try {
        console.log("3")
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
        console.log("data", data)
        const secret = JSON.parse(data.SecretString);
        console.log("secret", secret)
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