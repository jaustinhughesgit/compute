const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('serverless-http');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
var passport = require('passport');
const session = require('express-session');

console.log("test")

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
const authRouter = require('./routes/dynode13');
const dynodeRouter = require('./routes/dynode');
const dynode2Router = require('./routes/dynode2');
const dynode3Router = require('./routes/dynode3');
const dynode4Router = require('./routes/dynode4');
const dynode5Router = require('./routes/dynode5');
const dynode6Router = require('./routes/dynode6');
const dynode7Router = require('./routes/dynode7');
const dynode8Router = require('./routes/dynode8');
const dynode9Router = require('./routes/dynode9');
//const dynode10Router = require('./routes/dynode10');
const s3modulesRouter = require('./routes/s3modules');
const miroRouter = require('./routes/miro');
const embeddingsRouter = require('./routes/embeddings');
const pineconeRouter = require('./routes/pinecone');
const crawlRouter = require('./routes/crawl');


/*
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
});*/

app.use('/', indexRouter);
app.use('/login', loginRouter);
app.use('/controller', controllerRouter);
app.use('/dashboard', ensureAuthenticated, dashboardRouter);
app.use('/auth', authRouter)
app.use('/github', githubRouter);
app.use('/dynode', dynodeRouter);
app.use('/dynode2', dynode2Router);
app.use('/dynode3', dynode3Router);
app.use('/dynode4', dynode4Router);
app.use('/dynode5', dynode5Router);
app.use('/dynode6', dynode6Router);
app.use('/dynode7', dynode7Router);
app.use('/dynode8', dynode8Router);
app.use('/dynode9', dynode9Router);
app.use('/dynode13', authRouter);
app.use('/s3modules', s3modulesRouter);
app.use('/miro', miroRouter);
app.use('/embeddings', embeddingsRouter);
app.use('/pinecone', pineconeRouter);
app.use('/crawl', crawlRouter);


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
