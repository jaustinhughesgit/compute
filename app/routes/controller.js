var express = require('express');
var router = express.Router();

module.exports = (dynamodb, dynamodbLL, uuidv4) => {
    console.log("dynamodb",dynamodb);
    console.log("dynamodbLL",dynamodbLL);
    console.log("uuidv4",uuidv4);
    router.get('/', async function(req, res, next) {
        res.render('controller', {title:'controller'})
    });
    
    router.post('/createCounterE', function(req, res) {
        res.render('controller', {});
        
    });

    router.post('/createEntityTable', function(req, res) {

                res.render('controller', {});

        });

    return router;
};