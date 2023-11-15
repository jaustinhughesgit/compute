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

    
    
    const initializeCounter = async () => {
        try {
            await dynamodb.put({
                TableName: "wCounter",
                Item: {
                    pk: 'wCounter',
                    x: 0  // Initialize the counter value to 0
                },
                ConditionExpression: "attribute_not_exists(wCounter)"  // Only put the item if it doesn't already exist
            }).promise();
        } catch (e) {
            if (e.code === 'ConditionalCheckFailedException') {
                // The item already exists, so no action is needed
            } else {
                throw e;  // Re-throw any other errors
            }
        }

        try {
            await dynamodb.put({
                TableName: "eCounter",
                Item: {
                    pk: 'eCounter',
                    x: 0  // Initialize the counter value to 0
                },
                ConditionExpression: "attribute_not_exists(eCounter)"  // Only put the item if it doesn't already exist
            }).promise();
        } catch (e) {
            if (e.code === 'ConditionalCheckFailedException') {
                // The item already exists, so no action is needed
            } else {
                throw e;  // Re-throw any other errors
            }
        }
    };

    const incrementCounterAndGetNewValue = async () => {
        const response = await dynamodb.update({
            TableName: "wCounter",
            Key: { pk: 'wCounter' },
            UpdateExpression: "ADD #cnt :val",
            ExpressionAttributeNames: { '#cnt': 'x' },
            ExpressionAttributeValues: { ':val': 1 },
            ReturnValues: "UPDATED_NEW"
        }).promise();
    
        return response.Attributes.x;
    };

    const createWord = async (id, word) => {
        await dynamodb.put({
            TableName: 'words',
            Item: {
                a: id,
                r: word,
                s: word.toLowerCase()
            }
        }).promise();
        
    };

    router.post('/addWords', async (req, res) => {
        try {
            const words = ["Company","Technology","KPMG","PY","HR","ID","State","Name","Car","Austin","Honda","City","Road","Street","Lake","test","Monastery","River"];
            await initializeCounter();
            for (const word of words) {
                const id = await incrementCounterAndGetNewValue();
                await createWord(id, word);
            }
            res.render('controller', {results: "{}"});
        } catch (e) {
            console.error(e);
            return {
                statusCode: 500,
                body: JSON.stringify('An error occurred!'),
            };
        }
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
            res.render('controller', { results: JSON.stringify(data) }); 
        } catch (error) {
            console.error("Unable to add item. Error JSON:", JSON.stringify(error, null, 2));
            res.status(500).send(error); 
        }
    });




    return router;
};