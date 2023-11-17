const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
var passport = require('passport');
const jwt = require('jsonwebtoken');

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

function authenticateToken(req, res, next) {
    const token = req.cookies.jwt; // If you're sending the token in a cookie
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); 
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Initialize Passport
app.use(passport.initialize());

// You can place this in a separate config file and require it in your main server file
var strategiesConfig = {
    "microsoft": {
        strategyModule: 'passport-azure-ad',
        strategyName: 'OIDCStrategy',
        config: {
            identityMetadata: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/v2.0/.well-known/openid-configuration`,
            clientID: process.env.MICROSOFT_CLIENT_ID,
            responseType: 'code id_token',
            responseMode: 'form_post',
            redirectUrl: 'https://compute.1var.com/auth/microsoft/callback', // Update with your redirect URL
            allowHttpForRedirectUrl: true,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            validateIssuer: false,
            passReqToCallback: true,
            scope: ['profile', 'offline_access', 'https://graph.microsoft.com/mail.read']
        }
    }
    // Add other strategies here
};

app.get('/auth/:strategy', async (req, res, next) => {
    const strategy = req.params.strategy;
    try {
        if (!strategiesConfig[strategy]) {
            throw new Error(`Configuration for ${strategy} not found`);
        }

        const strategyConfig = strategiesConfig[strategy];
        const StrategyModule = require(strategyConfig.strategyModule);
        const Strategy = StrategyModule[strategyConfig.strategyName];

        passport.use(new Strategy(strategyConfig.config, (req, iss, sub, profile, accessToken, refreshToken, done) => {
            // Your verification logic here
            // Create a JWT token after successful authentication
            const userPayload = { email: profile.email, id: profile.id }; // Adjust according to your user profile structure
            const token = jwt.sign(userPayload, process.env.JWT_SECRET, { expiresIn: '1h' });
            return done(null, profile, { token });
        }));

        passport.authenticate(strategy, {
            // Authentication options
        })(req, res, next);
    } catch (error) {
        res.status(404).send(`Error loading strategy: ${strategy}. ${error.message}`);
    }
});

app.get('/auth/:strategy/callback', (req, res, next) => {
    const strategy = req.params.strategy;
    passport.authenticate(strategy, (err, user, info) => {
        if (err || !user) {
            return res.redirect('/login?error=true');
        }
        // Set the JWT as a cookie
        res.cookie('jwt', info.token, { httpOnly: true, secure: true }); // As a secure HTTP-only cookie
        res.redirect('/dashboard'); // Redirect to the desired page
    })(req, res, next);
});

var indexRouter = require('./routes/index');
var loginRouter = require('./routes/login');
var dashboardRouter = require('./routes/dashboard');
var controllerRouter = require('./routes/controller')(dynamodb, dynamodbLL, uuidv4);
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

app.use('/', indexRouter);
app.use('/login', loginRouter);
app.use('/controller', controllerRouter);
app.use('/dashboard', authenticateToken, dashboardRouter);



app.get('/protected-route', authenticateToken, (req, res) => {
    // Handle the request
});

module.exports.lambdaHandler = serverless(app);
