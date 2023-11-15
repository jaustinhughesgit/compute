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

    const incrementCounterAndGetNewValue = async (tableName) => {
        const response = await dynamodb.update({
            TableName: tableName,
            Key: { pk: tableName },
            UpdateExpression: "ADD #cnt :val",
            ExpressionAttributeNames: { '#cnt': 'x' },
            ExpressionAttributeValues: { ':val': 1 },
            ReturnValues: "UPDATED_NEW"
        }).promise();
    
        return response.Attributes.x;
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

    async function addVersion(newE, col, val, forceC){
        try {
            const id = await incrementCounterAndGetNewValue('vCounter');
    
            let newCValue;
            let newSValue; // s value to be determined based on forceC
    
            // Query the database to find the latest record for the given e
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
    
            if (forceC !== null && forceC !== undefined) {
                newCValue = forceC;
                // Increment s only if forceC is provided and there are existing records
                if (queryResult.Items.length > 0) {
                    const latestSValue = parseInt(queryResult.Items[0].s);
                    newSValue = isNaN(latestSValue) ? 1 : latestSValue + 1;
                } else {
                    newSValue = 1; // default if no records are found
                }
            } else {
                newSValue = 1; // Set s to 1 if forceC is null
                newCValue = queryResult.Items.length > 0 ? parseInt(queryResult.Items[0].c) + 1 : 1;
            }
    
            let previousVersionId, previousVersionDate;
            if (queryResult.Items.length > 0) {
                const latestRecord = queryResult.Items[0];
                previousVersionId = latestRecord.v; // Store the v of the last record
                previousVersionDate = latestRecord.d; // Store the d (sort key) of the last record
            }
    
            // Insert the new record with the c, s, and p values
            const newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                p: previousVersionId, // Set the p attribute to the v of the last record
                [col]: val,
                d: Date.now()
            };
    
            await dynamodb.put({
                TableName: 'versions',
                Item: newRecord
            }).promise();
    
            // Update the last record with the n attribute
            if (previousVersionId && previousVersionDate) {
                await dynamodb.update({
                    TableName: 'versions',
                    Key: {
                        v: previousVersionId,
                        d: previousVersionDate
                    },
                    UpdateExpression: 'set n = :newV',
                    ExpressionAttributeValues: {
                        ':newV': id.toString()
                    }
                }).promise();
            }
            return id.toString();
        } catch (error) {
            console.error("Error adding record:", error);
            return null
        }
    };

    // gets -----------------------------------------------

    router.get('/', async function(req, res, next) {
        res.render('controller', {title:'controller'})
    });


    // posts ----------------------------------------------

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
                    AttributeType: 'S'
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

    router.post('/addWords', async (req, res) => {
        try {
            const words = ["Company","Technology","KPMG","PY","HR","ID","State","Name","Car","Austin","Honda","City","Road","Street","Lake","test","Monastery","River","New"];
            await initializeCounter();
            let status = {
                added:[],
                existed:[]
            }
            for (const word of words) {
                const id = await incrementCounterAndGetNewValue('wCounter');
                const wStatus = await createWord(id.toString(), word);
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

    const createWord = async (id, word) => {
        const lowerCaseWord = word.toLowerCase();
    
        // Check if the word already exists in the database
        const checkResult = await wordExists(lowerCaseWord);
        if (checkResult.exists) {
            return checkResult.id;
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
    
        return id;
    };


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
    
    const createEntity = async (e, a, v) => {
        const params = {
            TableName: 'entities',
            Item: {
                e: e,
                a: a,
                v: v
            }
        };
    
        try {
            await dynamodb.put(params).promise();
            console.log(`Entity created with e: ${e}, a: ${a}, v: ${v}`);
            return `Entity created with e: ${e}, a: ${a}, v: ${v}`;
        } catch (error) {
            console.error("Error creating entity:", error);
            throw error; // Rethrow the error for the caller to handle
        }
    };
    
    router.post('/createEntity', async function(req, res) {
        try {
            const word = "Key";
            const e = await incrementCounterAndGetNewValue('eCounter');
            const aNew = await incrementCounterAndGetNewValue('wCounter');
            const a = await createWord(aNew.toString(), word);
            const v = await addVersion(e.toString(), "a", a.toString(), null);
            const result = await createEntity(e.toString(), a.toString(), v);
    
            res.render('controller', {results: result});
        } catch (err) {
            console.error(err);
            res.status(500).render('controller', {results: 'An error occurred!'});
        }
    });

    router.post('/updateEntity', async function(req, res) {
        try {
            const e = "1";
            const c = null;
            const col = "g";
            const val = "1";
            const v = await addVersion(e.toString(), col, val, c);
    
            res.render('controller', {results: "done"});
        } catch (err) {
            console.error(err);
            res.status(500).render('controller', {results: 'An error occurred!'});
        }
    });
    
    
    


    //WORKING VERSION OF v,c,e,s,d
    /*router.post('/addVersion', async function(req, res) {
        try {
            const id = await incrementCounterAndGetNewValue('vCounter');
            let newE = "1";
            let forceC = "2"; // Assuming forceC is passed in the request body
    
            let newCValue;
            let newSValue = 1; // Default value for s
    
            // Query the database to find the latest record for the given e
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
    
            // Determine newCValue based on forceC or incrementing the latest c value
            if (forceC !== null && forceC !== undefined) {
                newCValue = forceC;
    
                // Increment s only if forceC is provided and there are existing records
                if (queryResult.Items.length > 0) {
                    const latestSValue = parseInt(queryResult.Items[0].s);
                    newSValue = isNaN(latestSValue) ? 1 : latestSValue + 1;
                }
            } else if (queryResult.Items.length > 0) {
                const latestCValue = parseInt(queryResult.Items[0].c);
                newCValue = isNaN(latestCValue) ? 1 : latestCValue + 1;
            } else {
                newCValue = 1; // default if no records are found
            }
    
            // Insert the new record with the c and s values
            const newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                d: Date.now()
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
    });*/
    

    /*router.post('/addversion', async (req, res) => {});*/

    return router;
};