const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
var passport = require('passport');
const session = require('express-session');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const AppleStrategy = require('passport-apple').Strategy;
const fs = require('fs');
const jwt = require('jsonwebtoken');
const saltRounds = 10;
const { check, validationResult } = require('express-validator');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
// Test 2

AWS.config.update({ region: 'us-east-1' });
const dynamodbLL = new AWS.DynamoDB();
const dynamodb = new AWS.DynamoDB.DocumentClient();

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

passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
}, async (email, password, done) => {
    try {
        console.log("email", email)
        const params = { TableName: 'account', Key: { "email": email } };
        const coll = await dynamodb.get(params).promise();

        if (coll && coll.Item) {
            const user = coll.Item;

            bcrypt.compare(password, user.password, (err, isMatch) => {
                if (err) return done(err);
                if (isMatch) {
                    return done(null, user);
                } else {
                    return done(null, false, { message: 'Invalid password' });
                }
            });
        } else {
            return done(null, false, { message: 'Email not registered' });
        }
    } catch (err) {
        return done(err);
    }
}));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'https://www.1var.com/auth/google/callback',
}, (token, tokenSecret, profile, done) => {
    console.log("token", token);
    console.log("tokenSecret", tokenSecret)
    console.log(JSON.stringify(profile))
    const userId = profile.id;
  
    const newUser = {
        id: userId,
        name: profile.displayName,
        provider: 'google'
    };
  
        try {
          console.log("newUser",newUser)
      } catch (error) {
              console.error(error);
      }
      done(null, newUser);

}));

passport.use(new MicrosoftStrategy({
  clientID: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  callbackURL: "https://www.1var.com/auth/microsoft/callback",
  resource: 'https://graph.microsoft.com/',
  tenant: process.env.MICROSOFT_TENANT_ID,
  prompt: 'login',
  state: false,
  type: 'Web',
}, (token, tokenSecret, profile, done) => {
  console.log("token", token);
  console.log("tokenSecret", tokenSecret)
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

passport.use(new AppleStrategy({
    clientID: process.env.APPLE_CLIENT_ID,
    teamID: process.env.APPLE_TEAM_ID,
    callbackURL: 'https://www.1var.com/auth/apple/callback',
    keyID: process.env.APPLE_KEY_ID,
    privateKeyLocation: false,
    privateKeyString: process.env.APPLE_PRIVATE_KEY.replace(/\?\?\?/g, '\n'),
    passReqToCallback: true
}, 
async function(req, accessToken, refreshToken, idToken, profile, done) {
    console.log("req", req);
    console.log("accessToken", accessToken);
    console.log("refreshToken", refreshToken)
    console.log("idToken", idToken)
    console.log("profile", profile);
    const decodedToken = jwt.decode(idToken);
    const uuid = decodedToken.sub;  // Extract the UUID from the idToken
    console.log(decodedToken);
    console.log(uuid);
    done(null, uuid);
    //done(null, idToken);
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
  

/*passport.deserializeUser(async (email, done) => {
    console.log("deserializeUser", email)
    //const params = { TableName: 'account', Key: { "email": email } };
    //try {
      done(null, email);
        //const coll = await dynamodb.get(params).promise();
        //done(null, coll.Item);

    //} catch (err) {
    //    done(err);
    //}
});*/

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

var indexRouter = require('./routes/index');
var v1Router = require('./routes/v1');
var dashboardRouter = require('./routes/dashboard');
var registerRouter = require('./routes/register')(dynamodb, passport);
var setupdbRouter = require('./routes/setupdb')(dynamodb, dynamodbLL, uuidv4);
var loginRouter = require('./routes/login')(passport, session, dynamodb);
var logoutRouter = require('./routes/logout');
var apiController = require('./scripts/apicontroller')(dynamodb);

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
      return next();
  }
  res.redirect('/login');
}

app.use('/', indexRouter);
app.use('/register', registerRouter);
app.use('/v1', v1Router);
app.use('/login', loginRouter);
app.use('/dashboard', ensureAuthenticated, dashboardRouter);
app.use('/logout', ensureAuthenticated, logoutRouter);
app.use('/setupdb', setupdbRouter);

app.post('/auth/manual',
[
  check('email', 'Email is required').notEmpty(),
  check('password', 'Password is required').notEmpty()
],
  async function(req, res) {
      console.log(req.body);
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
      } else {
          const email = req.body.email;
          const password = req.body.password;
          const params = {TableName: 'account', Key: {"email": email}};
          const coll = await dynamodb.get(params).promise();
          console.log(coll);
          if (coll.hasOwnProperty("Item")){
              res.send("Email already registered.");
          } else {
                    // Hash the password before saving it
              bcrypt.hash(password, saltRounds, async (err, hashedPassword) => {
                  if (err) {
                  return res.status(500).json({ error: "Error hashing the password" });
                  }
                  //const uniqueId = uuidv4();
                  //const currentDate = new Date();
                  //const isoFormat = currentDate.toISOString();
                  
                  const firstName = req.body.first;
                  const lastName = req.body.last;
                  const realEmail = true;

                  /*const item = {
                      id: uniqueId,
                      email: req.body.email,
                      password: hashedPassword,
                      first: req.body.first,
                      last: req.body.last,
                      creationDate: isoFormat,
                  };*/
          
                  /*const params = {
                      TableName: 'account',
                      Item: item
                  };*/
                  await registerOAuthUser(email, firstName, lastName, res, realEmail, hashPassword);
                  /*try {
                      await dynamodb.put(params).promise();
                      res.send("Account Created!");
                  } catch (error) {
                      res.status(500).json({ error: "Error inserting into DynamoDB" });
                  }*/
              });
          }
      }
  });

  app.post('/api/*', apiController.handlePost);

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/microsoft', passport.authenticate('microsoft', { scope: ['user.read'] }));
app.get('/auth/apple', passport.authenticate('apple', { scope: ['name', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), function(req, res) { res.redirect('/dashboard');});
app.get('/auth/microsoft/callback', passport.authenticate('microsoft', { failureRedirect: '/login' }), function(req, res) { res.redirect('/dashboard');});
app.post('/auth/apple/callback', //passport.authenticate('apple', { failureRedirect: '/login' }), function(req, res) { res.redirect('/dashboard');});
    function(req, res) {
    passport.authenticate('apple', async function(err, user, info) {
        if (err) {
            if (err == "AuthorizationError") {
                res.send("Oops! Looks like you didn't allow the app to proceed. Please sign in again! <br /> \
                <a href=\"/login\">Sign in with Apple</a>");
            } else if (err == "TokenError") {
                res.send("Oops! Couldn't get a valid token from Apple's servers! <br /> \
                <a href=\"/login\">Sign in with Apple</a>");
            } else {
                res.send(err);
            }
        } else {
                //async (req, res) => {
                    console.log("user --- | ", user)
            if (req.body.hasOwnProperty("user")){
                console.log(req);
                console.log(req.body);
                console.log(req.body.user);
                console.log(JSON.parse(req.body.user));
                const userParsed = JSON.parse(req.body.user);
                let email = userParsed.email  ?  userParsed.email : "";
                const firstName = userParsed.name  ? (userParsed.name.firstName ? userParsed.name.firstName : "Apple User") : "Apple User";
                const lastName  = userParsed.name  ? (userParsed.name.lastName ? userParsed.name.lastName : "") : "";
                const realEmail = true
                console.log(email);
                email = email + ""
                /*try{
                    console.log(email.split("appleid")[0])
                if (email.split("appleid").length > 1){
                    realEmail = false
                }
                } catch (err){
                    res.status(500).json({ error: "Error testing email includes appleid" });
                }*/
                console.log("before registerOAuthUser is called")
                await registerOAuthUser(email, firstName, lastName, res, realEmail, false);
            } else {
                res.redirect('/dashboard');
            }
        }
    })(req, res);
});

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