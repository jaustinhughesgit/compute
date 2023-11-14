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
        console.log("1")
        const tableParams = {
            AttributeDefinitions: [
                {
                    AttributeName: 'pk',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'pk',
                    KeyType: 'HASH'
                }
            ],
            BillingMode: 'PAY_PER_REQUEST',  // You're using on-demand capacity, so you don't specify ProvisionedThroughput
            TableName: 'eCounter'
        };

        dynamodbLL.createTable(tableParams, (err, data) => {
            console.log("2")
            if (err) {
                console.log("3")
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                        res.render('controller', {results: JSON.stringify({data})});
                   
            }
        });
        
    });

    router.post('/createEntityTable', function(req, res) {

                res.render('controller', {results: {}});

        });

    return router;
};