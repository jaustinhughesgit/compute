const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
var passport = require('passport');
const session = require('express-session');

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

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));

app.use(passport.initialize());
app.use(passport.session());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

var indexRouter = require('./routes/index');
var controllerRouter = require('./routes/controller')(dynamodb, dynamodbLL, uuidv4);

var loginRouter = require('./routes/login')
var dashboardRouter = require('./routes/dashboard');
const githubRouter = require('./routes/github');

var strategiesConfig = {
    "microsoft": {
        strategyModule: 'passport-microsoft',
        strategyName: 'Strategy', // Adjust this based on how the strategy is actually exported
        config: {
            clientID: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            callbackURL: "https://compute.1var.com/auth/microsoft/callback",
            resource: 'https://graph.microsoft.com/',
            tenant: process.env.MICROSOFT_TENANT_ID,
            prompt: 'login',
            state: false,
            type: 'Web',
            scope: ['user.read'],
        }
    }
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
        passport.use(new Strategy(strategyConfig.config, (token, tokenSecret, profile, done) => {
            // Your authentication logic
            done(null, profile);
        }));
        passport.authenticate(strategy)(req, res, next);
    } catch (error) {
        res.status(404).send(`Error loading strategy: ${strategy}. ${error.message}`);
    }
});

app.all('/auth/:strategy/callback', (req, res, next) => {
    const strategy = req.params.strategy;
    passport.authenticate(strategy, (err, user) => {
        if (err || !user) {
            return res.redirect('/login?error=true');
        }
        req.login(user, (err) => {
            if (err) {
                return next(err);
            }
            return res.redirect('/dashboard');
        });
    })(req, res, next);
});

passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

app.use('/', indexRouter);
app.use('/login', loginRouter);
app.use('/controller', controllerRouter);
app.use('/dashboard', ensureAuthenticated, dashboardRouter);
app.use('/github', githubRouter);

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
