var express = require('express');
var router = express.Router();

module.exports = (dynamodb, dynamodbLL, uuidv4) => {

    router.get('/', function(req, res, next){
        res.render('v1', {})
    });

return router;
};