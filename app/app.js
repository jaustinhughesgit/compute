const express = require('express');
const serverless = require('serverless-http');
const app = express();
const session = require('express-session');
app.set('trust proxy', 1);
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
    app.use(req.local.passport.initialize());
    next()
}

function two(req, res, next) {
    app.use(req.local.passport.session());
    next()
}

function three(req, res, next) {
    req.local.passport.serializeUser((user, done) => {
        done(null, user);
    });

    req.local.passport.deserializeUser((obj, done) => {
        done(null, obj);
    });
    next();
}

function four(req, res, next) {
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
        next()
    }
}

function logSessionCookie(req, res, next) {
    const sessionCookie = req.cookies['connect.sid']; // The default name for Express session cookies
    if (sessionCookie) {
        console.log('Session Cookie:', sessionCookie);
    } else {
        console.log('No Session Cookie found');
    }
    next(); // Continue to the next middleware or route handler
}

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    //res.redirect('/auth/microsoft');
}

app.get('/auth/dashboard', one, two, three, four, isLoggedIn, logSessionCookie, (req, res) => {
    res.send('Welcome to your dashboard');
});

app.all('/*', one, two, three, four);

module.exports.lambdaHandler = serverless(app);