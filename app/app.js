const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const session = require('express-session');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
var passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
var cookieParser = require('cookie-parser');

AWS.config.update({ region: 'us-east-1' });
const dynamodbLL = new AWS.DynamoDB();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const SM = new AWS.SecretsManager();

app.use(cookieParser());

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
  }

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
var cookiesRouter;

var dashboardRouter = require('./routes/dashboard');
var loginRouter = require('./routes/login');

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

app.use('/login', loginRouter);
app.use('/dashboard', dashboardRouter);
passport.use(new MicrosoftStrategy({
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL: "https://compute.1var.com/auth/microsoft/callback",
    resource: 'https://graph.microsoft.com/',
    tenant: process.env.MICROSOFT_TENANT_ID,
    prompt: 'login',
    state: false,
    type: 'Web',
    scope: ['user.read']
},
async function(accessToken, refreshToken, profile, done) {
    console.log(JSON.stringify(profile))
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


  passport.serializeUser((user, done) => {
    console.log("serializeUser", user);
    done(null, user);  // Serialize using the user id for now.
  });

  passport.deserializeUser((user, done) => {
    console.log("deserializeUser for ID:", user);
    
    // You would typically fetch the user from your database here using the id.
    // But for troubleshooting purposes, just return an example user object.
    done(null, user);
  });
app.get('/auth/microsoft', passport.authenticate('microsoft', { scope: ['user.read'] }));

// Callback route
app.get('/auth/microsoft/callback',
  passport.authenticate('microsoft', { failureRedirect: '/login' }),
  function(req, res) {
    res.redirect('/dashboard');
  }
);
app.use('/', indexRouter);
app.use('/controller', controllerRouter);


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
            res.redirect('/dashboard');
            //res.send("Account Created!");
        } catch (error) {
            res.status(500).json({ error: "Error inserting into DynamoDB" });
        }
    }
}

module.exports.lambdaHandler = serverless(app);
