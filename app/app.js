const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');

// Initialize AWS Secrets Manager
const SM = new AWS.SecretsManager();

async function getPrivateKey() {
    const secretName = "public/1var/s3"; // Replace with your secret name
    try {
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
        const secret = JSON.parse(data.SecretString);
        return secret.privateKey;
    } catch (error) {
        console.error("Error fetching secret:", error);
        throw error;
    }
}

(async () => {
    try {
        const privateKey = await getPrivateKey();
        const app = express();

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.set('views', path.join(__dirname, 'views'));
        app.set('view engine', 'ejs');

        var indexRouter = require('./routes/index');
        var cookiesRouter = require('./routes/cookies')(privateKey);

        app.use('/', indexRouter);
        app.use('/cookies', cookiesRouter);

        module.exports.lambdaHandler = serverless(app);
    } catch (error) {
        console.error("Failed to start the application due to an error in retrieving the private key:", error);
        // Handle initialization error
        // Note: You might need to handle this differently depending on your deployment environment
    }
})();
