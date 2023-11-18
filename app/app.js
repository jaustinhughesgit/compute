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





// Authentication route
app.get('/auth/microsoft', passport.authenticate('microsoft', { scope: ['user.read'] }));

// Callback route
app.get('/auth/microsoft/callback', passport.authenticate('microsoft', { failureRedirect: '/login' }), function(req, res) { res.redirect('/dashboard');});

app.use('/', indexRouter);
app.use('/controller', controllerRouter);

module.exports.lambdaHandler = serverless(app);
