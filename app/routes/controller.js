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
        const tableParams = {
            AttributeDefinitions: [
                {
                    AttributeName: 'e',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'v',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'e',
                    KeyType: 'HASH'
                }
            ],
            GlobalSecondaryIndexes: [ 
                {
                    IndexName: 'vIndex',
                    KeySchema: [
                        {
                            AttributeName: 'v',
                            KeyType: 'HASH'
                        }
                    ],
                    Projection: {
                        ProjectionType: 'ALL'
                    }
                }
            ],
            BillingMode: 'PAY_PER_REQUEST',  // You're using on-demand capacity, so you don't specify ProvisionedThroughput
            TableName: 'entities'
        };
    
        dynamodbLL.createTable(tableParams, (err, data) => {
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                res.render('controller', {results: JSON.stringify(data)});
            }
        });
    });

    router.post('/createCounterW', function(req, res) {
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
            TableName: 'wCounter'
        };

        dynamodbLL.createTable(tableParams, (err, data) => {
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                
                
                        res.render('controller', {results: JSON.stringify({data})});
                    
            }
        });
        
    });

    router.post('/createWordsTable', function(req, res) {
        const tableParams = {
            AttributeDefinitions: [
                {
                    AttributeName: 'a',
                    AttributeType: 'N'
                },
                {
                    AttributeName: 's',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'a',
                    KeyType: 'HASH'
                }
            ],
            GlobalSecondaryIndexes: [ 
                {
                    IndexName: 'sIndex',
                    KeySchema: [
                        {
                            AttributeName: 's',
                            KeyType: 'HASH'
                        }
                    ],
                    Projection: {
                        ProjectionType: 'ALL'
                    }
                }
            ],
            BillingMode: 'PAY_PER_REQUEST',  // You're using on-demand capacity, so you don't specify ProvisionedThroughput
            TableName: 'words'
        };

        dynamodbLL.createTable(tableParams, (err, data) => {
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                res.render('controller', {results: JSON.stringify(data)});
            }
        });
    });

    router.post('/createCounterV', function(req, res) {
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
            TableName: 'vCounter'
        };

        dynamodbLL.createTable(tableParams, (err, data) => {
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                
                
                        res.render('controller', {results: JSON.stringify({data})});
                    
            }
        });
        
    });

    router.post('/createVersionTable', function(req, res) {
        const tableParams = {
            AttributeDefinitions: [
                {
                    AttributeName: 'v',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'e',
                    AttributeType: 'S'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'v',
                    KeyType: 'HASH'
                }
            ],
            GlobalSecondaryIndexes: [ 
                {
                    IndexName: 'eIndex',
                    KeySchema: [
                        {
                            AttributeName: 'e',
                            KeyType: 'HASH'
                        }
                    ],
                    Projection: {
                        ProjectionType: 'ALL'
                    }
                }
            ],
            BillingMode: 'PAY_PER_REQUEST',  // You're using on-demand capacity, so you don't specify ProvisionedThroughput
            TableName: 'versions'
        };

        dynamodbLL.createTable(tableParams, (err, data) => {
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                res.render('controller', {results: JSON.stringify(data)});
            }
        });
    });

    function readyJSON(wordList){
        const items = []
        for (x=0; x<wordList.length; x++){
            items.push({
                's': wordList[x].toLowerCase(),
                'a': uuidv4(),
                'r': wordList[x]
            })
        };

        let params = {
            RequestItems: {
                'words': items.map(item => {
                    return {
                        PutRequest: {
                            Item: item
                        }
                    };
                })
            }
        };
        return params;
    }

    router.post('/addItem', async (req, res) => {
    
        // Prepare the item to add to the DynamoDB table
        let addItems = ["Company","Technology","KPMG","PY","HR","ID","State","Name","Car","Austin","Honda","City","Road","Street","Lake","test","Monastery","River"]

        let params = readyJson(addItems);
    
        try {
            const data = await dynamodb.batchWrite(params).promise();
            res.render('setupdb', { results: JSON.stringify(data) }); 
        } catch (error) {
            console.error("Unable to add item. Error JSON:", JSON.stringify(error, null, 2));
            res.status(500).send(error); 
        }
    });




    return router;
};