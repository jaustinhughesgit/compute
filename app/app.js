const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
var passport = require('passport');
const session = require('express-session');
const MicrosoftStrategy = require('passport-microsoft').Strategy;

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



passport.use(new MicrosoftStrategy({
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL: "https://compute.1var.com/auth/microsoft/callback",
    resource: 'https://graph.microsoft.com/',
    tenant: process.env.MICROSOFT_TENANT_ID,
    prompt: 'login',
    state: false,
    type: 'Web',
    scope: ['user.read'],
  }, (token, tokenSecret, profile, done) => {
    console.log("profile",profile)
    const userId = profile.id;
    const newUser = {
        id: userId,
        name: profile.displayName,
        provider: 'microsoft'
    };
        try {
          console.log("newUser",newUser)
      } catch (error) {
              console.error(error);
      }
      done(null, newUser);
  }));

  passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});
var indexRouter = require('./routes/index');
var controllerRouter = require('./routes/controller')(dynamodb, dynamodbLL, uuidv4);


var loginRouter = require('./routes/login')
var dashboardRouter = require('./routes/dashboard');

// Authentication route
app.get('/auth/microsoft', passport.authenticate('microsoft', { scope: ['user.read'] }));

// Callback route
app.get('/auth/microsoft/callback*', passport.authenticate('microsoft', { failureRedirect: '/login' }), function(req, res) { res.redirect('/dashboard');});

app.use('/', indexRouter);
app.use('/login', loginRouter);
app.use('/controller', controllerRouter);
app.use('/dashboard', ensureAuthenticated, dashboardRouter);

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
