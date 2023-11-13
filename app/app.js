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
        let pKey = JSON.stringify(secret.privateKey).replace(/###/g, "\n");
        console.log(pKey)
        return pKey //JSON.stringify(secret.privateKey).replace("###", "\n");
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

// Middleware to ensure privateKey is loaded
app.use(async (req, res, next) => {
    if (!cookiesRouter) {
        try {
            const privateKey = await getPrivateKey();
            cookiesRouter = require('./routes/cookies')(privateKey);
            app.use('/cookies', cookiesRouter);
            next();
        } catch (error) {
            console.error("Failed to retrieve private key:", error);
            res.status(500).send("Server Error");
        }
    } else {
        next();
    }
});

app.use('/', indexRouter);

module.exports.lambdaHandler = serverless(app);
