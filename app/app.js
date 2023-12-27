const express = require('express');
const serverless = require('serverless-http');
const session = require('express-session');
const passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const app = express();

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true },
    sameSite: 'None'
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new MicrosoftStrategy({
    clientID: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    callbackURL: "https://compute.1var.com/auth/microsoft/callback",
    scope: ['user.read']
  },
  (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => {return done(null, profile);});
  }
));

app.get('/auth/microsoft',
  passport.authenticate('microsoft', { scope: ['user.read'] }),(req, res) => {});

app.get('/auth/microsoft/callback', 
  passport.authenticate('microsoft', { failureRedirect: '/' }),
  (req, res) => {res.redirect('/dashboard'); });

app.get('/dashboard', ensureAuthenticated, (req, res) => {
  res.send('<h1>Dashboard</h1><a href="/account">Account</a>');
});

app.get('/account', ensureAuthenticated, (req, res) => {
  res.send('<h1>Account Details</h1>');
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  res.redirect('/');
}

module.exports.lambdaHandler = serverless(app);
