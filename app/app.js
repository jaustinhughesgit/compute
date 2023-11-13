const express = require('express');
const serverless = require('serverless-http');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

var indexRouter = require('./routes/index');
var cookiesRouter = require('./routes/cookies');

app.use('/', indexRouter);
app.use('/cookies', cookiesRouter);

module.exports.lambdaHandler = serverless(app);
