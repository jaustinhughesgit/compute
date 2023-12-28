var express = require('express');
const serverless = require('serverless-http');
const AWS = require('aws-sdk');
const app = express();

const path = require('path');

const session = require('express-session');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

SM = new AWS.SecretsManager();

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



var cookiesRouter;
app.use(async (req, res, next) => {
    if (!cookiesRouter) {
        try {
            console.log("-----cookiesRouter")
            const privateKey = await getPrivateKey();
            cookiesRouter = require('./routes/cookies')(privateKey);
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

var indexRouter = require('./routes/index');

app.use('/', indexRouter);



module.exports.lambdaHandler = serverless(app);
