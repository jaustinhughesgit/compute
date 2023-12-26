const express = require('express');
const serverless = require('serverless-http');
const app = express();
const session = require('express-session');

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));

function one(req, res, next) {
    req.local = {}
    req.local.passport = require('passport');
    req.local.MicrosoftStrategy = require('passport-microsoft').Strategy;
    req.local.passport.initialize()(req, res, next);
}

function two(req, res, next) {
    req.local.passport.session()(req, res, next);
}

function three(req, res) {
    req.local.passport.serializeUser((user, done) => {
        done(null, user);
    });

    req.local.passport.deserializeUser((obj, done) => {
        done(null, obj);
    });

    req.local.passport.use(new req.local.MicrosoftStrategy({
        clientID: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL: "https://compute.1var.com/auth/microsoft/callback",
        scope: ['user.read']
    }, (accessToken, refreshToken, profile, done) => {
        done(null, profile);
    }));


    if (req.path === "/auth/microsoft") {
        req.local.passport.authenticate('microsoft', { scope: ['user.read'] })(req, res);
    }

    if (req.path === "/auth/microsoft/callback") {
        req.local.passport.authenticate('microsoft', { failureRedirect: '/' }, (err, user, info) => {
            if (err || !user) {
                return res.redirect('/');
            }
            req.logIn(user, (err) => {
                if (err) {
                    return res.redirect('/');
                }
                return res.redirect('/auth/dashboard');
            });
        })(req, res);
    } else {
        res.send("Page not found");
    }
}

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/auth/microsoft');
}

app.get('/auth/dashboard', isLoggedIn, (req, res) => {
    res.send('Welcome to your dashboard');
});

app.all('/*', one, two, three);

module.exports.lambdaHandler = serverless(app);