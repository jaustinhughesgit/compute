const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
AWS.config.update({ region: 'us-east-1' });
const dynamodbLL = new AWS.DynamoDB();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const SM = new AWS.SecretsManager();
async function getPrivateKey() {
    const secretName = "public/1var/s3";
    try {
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
        const secret = JSON.parse(data.SecretString);
        let pKey = JSON.stringify(secret.privateKey).replace(/###/g, "\n").replace('"','').replace('"','');
        return pKey
    } catch (error) {
        console.error("Error fetching secret:", error);
        throw error;
    }
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); 
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
var indexRouter = require('./routes/index');
var controllerRouter = require('./routes/controller')(dynamodb, dynamodbLL, uuidv4);
app.use('/controller', controllerRouter);
app.use('/', indexRouter);




// leave at bottom as catch-all
var cookiesRouter;
app.use(async (req, res, next) => {
    if (!cookiesRouter) {
        try {
            const privateKey = await getPrivateKey();
            cookiesRouter = require('./routes/cookies')(privateKey, dynamodb);
            app.use('/:type(cookies|url)', function(req, res, next) {
                req.type = req.params.type; // Capture the type (cookies or url)
                next('route'); // Pass control to the next route
            }, cookiesRouter);
            next();
        } catch (error) {
            console.error("Failed to retrieve private key:", error);
            res.status(500).send("Server Error");
        }
    } else {
        next();
    }
});
module.exports.lambdaHandler = serverless(app);
