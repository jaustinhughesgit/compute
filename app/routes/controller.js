var express = require('express');
var router = express.Router();

module.exports = (dynamodb, dynamodbLL, uuidv4) => {


    // functions ------------------------------------------
    
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


        try {
            await dynamodb.put({
                TableName: "vCounter",
                Item: {
                    pk: 'vCounter',
                    x: 0  // Initialize the counter value to 0
                },
                ConditionExpression: "attribute_not_exists(vCounter)"  // Only put the item if it doesn't already exist
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
        const lowerCaseWord = word.toLowerCase();
    
        // Check if the word already exists in the database
        const checkResult = await wordExists(lowerCaseWord);
        if (checkResult.exists) {
            return { success: false, message: 'Word already exists in the database.', existingId: checkResult.id };
        }
    
        // If the word does not exist, insert it
        await dynamodb.put({
            TableName: 'words',
            Item: {
                a: id,
                r: word,
                s: lowerCaseWord
            }
        }).promise();
    
        return { success: true, message: 'Word added successfully.' };
    };

    const wordExists = async (word) => {
        const params = {
            TableName: 'words',
            IndexName: 'sIndex', // Using the secondary index
            KeyConditionExpression: 's = :s',
            ExpressionAttributeValues: {
                ':s': word
            }
        };
    
        const result = await dynamodb.query(params).promise();
        if (result.Items.length > 0) {
            return { exists: true, id: result.Items[0].a };
        } else {
            return { exists: false };
        }
    };

    const createVersion = async (entityid, column, value)


    // gets -----------------------------------------------

    router.get('/', async function(req, res, next) {
        res.render('controller', {title:'controller'})
    });


    // posts ----------------------------------------------
    if (true){
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
                    AttributeName: 'c',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'e',
                    AttributeType: 'S'
                },
                {
                    AttributeName: 'd',
                    AttributeType: 'N'
                }
            ],
            KeySchema: [
                {
                    AttributeName: 'v',
                    KeyType: 'HASH'
                },
                {
                    AttributeName: 'd',
                    KeyType: 'RANGE'
                }
            ],
            GlobalSecondaryIndexes: [ 
                {
                    IndexName: 'eIndex',
                    KeySchema: [
                        {
                            AttributeName: 'e',
                            KeyType: 'HASH'
                        },
                        {
                            AttributeName: 'd',
                            KeyType: 'RANGE'
                        }
                    ],
                    Projection: {
                        ProjectionType: 'ALL'
                    }
                }
            ],
            BillingMode: 'PAY_PER_REQUEST',
            TableName: 'versions'
        };

        dynamodbLL.createTable(tableParams, (err, data) => {
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err);
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                res.render('controller', {results: JSON.stringify(data)});
            }
        });
    });
    }

    router.post('/addWords', async (req, res) => {
        try {
            const words = ["Company","Technology","KPMG","PY","HR","ID","State","Name","Car","Austin","Honda","City","Road","Street","Lake","test","Monastery","River","New"];
            await initializeCounter();
            let status = {
                added:[],
                existed:[]
            }
            for (const word of words) {
                const id = await incrementCounterAndGetNewValue();
                const wStatus = await createWord(id, word);
                if (wStatus.success == false){
                    status.existed.push(word)
                } else {
                    status.added.push(word)
                }
            }
            res.render('controller', {results: JSON.stringify(status)});
        } catch (e) {
            console.error(e);
            return {
                statusCode: 500,
                body: JSON.stringify('An error occurred!'),
            };
        }
    });

    router.post('/addVersion', async function(req, res) {
        try {
            let newE = "1"
            // Step 1: Query the table to find the latest record with e = "1234"
            const queryResult = await dynamodb.query({
                TableName: 'versions',
                IndexName: 'eIndex',
                KeyConditionExpression: 'e = :eValue',
                ExpressionAttributeValues: {
                    ':eValue': newE
                },
                ScanIndexForward: false, // false for descending order
                Limit: 1 // we only need the latest record
            }).promise();
    
            let newCValue = 1; // default if no records are found
            if (queryResult.Items.length > 0) {
                const latestCValue = parseInt(queryResult.Items[0].c);
                newCValue = isNaN(latestCValue) ? 1 : latestCValue + 1;
            }
    
            // Step 2: Insert the new record with the incremented c value
            const newRecord = {
                // ... other record data ...
                c: newCValue.toString(),
                e: newE,
                // ... other record data ...
            };
    
            await dynamodb.put({
                TableName: 'versions',
                Item: newRecord
            }).promise();
    
            res.send('Record added successfully');
        } catch (error) {
            console.error("Error adding record:", error);
            res.status(500).send(error);
        }
    });

    /*router.post('/addversion', async (req, res) => {});*/

    return router;
};