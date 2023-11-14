var express = require('express');
var router = express.Router();

module.exports = (dynamodb, dynamodbLL, uuidv4) => {
    console.log("dynamodb",dynamodb);
    console.log("dynamodbLL",dynamodbLL);
    console.log("uuidv4",uuidv4);
    router.get('/', async function(req, res, next) {
        res.render('controller', {title:'controller'})
    });
    
    return router;
};