const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const passport = require('passport');

AWS.config.update({ region: 'us-east-1' });
const dynamodbLL = new AWS.DynamoDB();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const SM = new AWS.SecretsManager();

const app = express();
const { v4: uuidv4 } = require('uuid');

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

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: true, 
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); 
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(passport.initialize());
app.use(passport.session());

var strategiesConfig = {
    "azure-ad": {
        strategyModule: 'passport-azure-ad',
        strategyName: 'OIDCStrategy',
        config: {
            identityMetadata: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/v2.0/.well-known/openid-configuration`,
            clientID: process.env.MICROSOFT_CLIENT_ID,
            responseType: 'code id_token',
            responseMode: 'form_post',
            redirectUrl: 'https://compute.1var.com/auth/azure-ad/callback',
            allowHttpForRedirectUrl: true,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            validateIssuer: false,
            passReqToCallback: true,
            scope: ['user.read']
        }
    }
};
const StrategyModule = require('passport-azure-ad');

app.get('/auth/:strategy', async (req, res, next) => {
    const strategy = req.params.strategy;
    console.log("strategy",strategy)
    try {
        if (!strategiesConfig[strategy]) {
            console.log("0")
            throw new Error(`Configuration for ${strategy} not found`);
        }

        const strategyConfig = strategiesConfig[strategy];
        const Strategy = StrategyModule[strategyConfig.strategyName];
        console.log("1")
        passport.use(strategy, new Strategy(strategyConfig.config, async (req, iss, sub, profile, accessToken, refreshToken, done) => {
            //const email = profile._json.email || profile._json.preferred_username || '';
            //const firstName = profile.name.givenName || '';
            //const lastName = profile.name.familyName || '';
            //const realEmail = true; 
            console.log("2")
            try {
                console.log("3")
                console.log("profile",profile);
                //await registerOAuthUser(email, firstName, lastName, req, realEmail, false);
                return done(null, profile);
            } catch (error) {
               console.log("4")
                return done(error);
            }
        }));
        console.log("5")

        passport.authenticate(strategy)(req, res, next);
    } catch (error) {
        console.log("404")
        res.status(404).send(`Error loading strategy: ${strategy}. ${error.message}`);
    }
});

app.all('/auth/:strategy/callback', (req, res, next) => {
    const strategy = req.params.strategy;
    console.log("strategy", strategy)
    passport.authenticate(strategy, (err, user) => {
        console.log("err", err)
        console.log("user". user)
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

passport.serializeUser((user, done) => {
    console.log("serializeUser", user);
    done(null, user);
  });

  passport.deserializeUser((user, done) => {
    console.log("deserializeUser for ID:", user);
    
    done(null, user);
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
app.use('/dashboard', ensureAuthenticated, dashboardRouter);

async function registerOAuthUser(email, firstName, lastName, res, realEmail, hasPass) {
    console.log("inside regOAuth", email)
    const params = { TableName: 'account', Key: { "email": email } };
    console.log(params)
    const coll = await dynamodb.get(params).promise();
    console.log(coll)
    if (coll.hasOwnProperty("Item")) {
        res.send("Email already registered through another method.");
    } else {
        const uniqueId = uuidv4();
        const currentDate = new Date();
        const isoFormat = currentDate.toISOString();
        const item = {
            id: uniqueId,
            email: email,
            first: firstName,
            last: lastName,
            creationDate: isoFormat,
            proxyEmail: realEmail,
            verified: false,
            password: hasPass
            // No password is saved for OAuth users
        };

        const insertParams = {
            TableName: 'account',
            Item: item
        };
        try {
            await dynamodb.put(insertParams).promise();
            //res.redirect('/dashboard');
            //res.send("Account Created!");
            return
        } catch (error) {
            res.status(500).json({ error: "Error inserting into DynamoDB" });
        }
    }
}

module.exports.lambdaHandler = serverless(app);
