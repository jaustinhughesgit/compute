var express = require('express');
var router = express.Router();

module.exports = (dynamodb, dynamodbLL, uuidv4) => {
    router.get('/', async function(req, res, next) {
        res.render('setupdb', {results: {}});
    });





















    
    const counterTable = 'wCounter';
    const wordsTable = 'words';
    const words = ["Company","Technology","KPMG","PY","HR","ID","State","Name","Car","Austin","Honda","City","Road","Street","Lake","test","Monastery","River"];
    
    
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
            TableName: wordsTable,
            Item: {
                a: id,
                r: word,
                s: word.toLowerCase()
            }
        }).promise();
        
    };

    router.post('/addVersion', async (req, res) => {
        try {
            await initializeCounter();

            for (const word of words) {
                const id = await incrementCounterAndGetNewValue();
                await createWord(id, word);
            }
            res.render('setupdb', {results: "{}"});
        } catch (e) {
            console.error(e);
            return {
                statusCode: 500,
                body: JSON.stringify('An error occurred!'),
            };
        }
    });





    /*router.post('/addVersion', async (req, res) => {
        
        const h = [
            ['company', 'technology', 'kpmg', 'hr', 'people|3'],
            ['company', 'technology', 'PY', 'hr', 'people|4'],
            ['earth', 'people|4'],
            ['people|3', 'id', 'name', "austin|5"],
            ['people|4', 'state', 'name', "janet"],
            ['austin|5', 'city', 'road',"lakebrink|10"],
            ['austin|5', 'city', 'road', "test", "monastery|7"],
            ['austin|5', 'city', 'street', "river"],
            ['lakebrink|10', 'a310', 'apt3', 'hughes', 'family', 'children', 'gavin', 'age', '6'],
            ['monastery|7', 'b310', 'apt3', 'hughes', 'family', 'children', 'raleigh', 'age', '4'],
            ['people|3', 'id', 'car', "honda|8"],
            ['honda|8','model','accord'],
            ['honda|8','model','crx'],
            ['honda|8','model','pilot']
        ];

        let uniqueWords = []
        let uniqueWords2 = []
        for (let z=0; z<h.length; z++){
            for (let y=0; y<h[z].length; y++){
                if (!uniqueWords.includes(h[z][y].split("|")[0])){
                    uniqueWords.push(h[z][y].split("|")[0]);
                    uniqueWords2.push(h[z][y].split("|")[0]);
                }
            }
        }

        const batches = [];
        while (uniqueWords.length) {
            const batch =  uniqueWords.splice(0, 10);
            batches.push(batch);
        }
        
        let allFound = []
        const batchGetPromises =  batches.map(async batch => {
            const keys = await batch.map(raw => ({ 's': s }));
            const requestItems = {
                'words': { Keys: keys }
            };
            const bb = await dynamodb.batchGet({ RequestItems: requestItems }).promise();
            let found = await bb.Responses.words.map(function(item) {
                return item.s;
            });
            allFound.push(...found);
            return ""
        });

        Promise.all(batchGetPromises)
        .then(async result => {
            // All the promises have resolved and results are collected here.
            //console.log(result);
            let doesntExist = await uniqueWords2.filter(function(element) {
                // The 'indexOf' method returns -1 if the element is not found in the array.
                return allFound.indexOf(element) === -1;
            });
            console.log("doesntExist", doesntExist)

            const params = await readyJSON(doesntExist)

            const data = await dynamodb.batchWrite(params).promise();

            // ADD VERSION AND PEI 

            res.render('setupdb', { results: JSON.stringify(data) }); 




            //res.render('setupdb', { results: JSON.stringify({"doesntExist":doesntExist})}); 
            // You can proceed with other operations here.
        })
        .catch(error => {
            // If any promise gets rejected, you will catch the error here.
            console.error("Error processing batches:", error);
        });
        
        //let parent = false;
        //let head = false;
        //let parenting = false;
        //if (y == 0){head = true;}
        //if (y == 0 && !h[z][y].includes("|")){parent = true;}
        //if (y == h[z].length -1 && !h[z][y].includes("|")){parenting = true;}

        / *
        //Version Attributes
        let vAtts = [vidFunc, peiFunc]; //, versionFunc, subFunc, preVidFunc, nextVidFunc, attFunc, textFunc, groupFunc, headFunc, parentingFunc, parentFunc, fromFunc, toFunc, createdFunc]

        for (z=0; z<h.length; z++){
            for (y=0; y<h[z].length; y++){
                let vData = {}
                vAtts.forEach(async func => {
                    //vData = await func(vData);
                });
            }
        }
        * /

        let vvv = peiFunc({})

       async function vidFunc(vData){
            vData["v"] = await uuidv4();
            return vData;
        }

        async function peiFunc(vData){
            let aid = "8603431f-f29b-4ef5-9642-362f80e0c47c";

            const params = {
                TableName: 'entities',
                IndexName: 'aIndex',
                KeyConditionExpression: 'a = :aValue', 
                ExpressionAttributeValues: { 
                    ':aValue': a
                }
            };

            
            dynamodb.query(params, (err, data) => {
                if (err) {
                    console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
                } else {
                    console.log("Query succeeded.");
                    data.Items.forEach((item) => {
                        console.log(" -", item);
                    });
                }
            });

            // TO BE ABLE TO CODE THIS FUNCTION WE FIRST NEED A PEI TABLE AND CHECK IF THERE IS A DUPLICATE NAME IN THE PATH.
            // WE NEED TO RETURN THE PEI IF IT EXIST, ELSE CREATE A NEW PEI.
            // THEN WE CAN RETURN HERE AND IF A PEI EXIST then increment it into the version table)
        }
        




        
        
        / *for (x=0; x<addItems.length; x++){
            items.push({
                's': addItems[x].toLowerCase(),
                'a': uuidv4(),
                'r': addItems[x]
            })
        };

        var params = {
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
    
        try {
            const data = await dynamodb.batchWrite(params).promise();
            res.render('setupdb', { results: JSON.stringify(data) }); 
        } catch (error) {
            console.error("Unable to add item. Error JSON:", JSON.stringify(error, null, 2));
            res.status(500).send(error); 
        }* /
    });*/

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

    // Route for handling form submission
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

        console.log(dynamodbLL); 
        console.log('createTable' in dynamodbLL);

        dynamodbLL.createTable(tableParams, (err, data) => {
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                res.render('setupdb', {results: JSON.stringify(data)});
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
            res.render('setupdb', {results: JSON.stringify(data)});
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
                IndexName: 'cIndex',
                KeySchema: [
                    {
                        AttributeName: 'c',
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

    console.log(dynamodbLL); 
    console.log('createTable' in dynamodbLL);

    dynamodbLL.createTable(tableParams, (err, data) => {
        if (err) {
            console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
            return res.status(500).send(err); // You might want to handle error differently
        } else {
            console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
            res.render('setupdb', {results: JSON.stringify(data)});
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
                
                
                        res.render('setupdb', {results: JSON.stringify({data})});
                   
            }
        });
        
    });

    router.post('/createCounterE', function(req, res) {
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
            if (err) {
                console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
                return res.status(500).send(err); // You might want to handle error differently
            } else {
                console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
                
                
                        res.render('setupdb', {results: JSON.stringify({data})});
                   
            }
        });
        
    });
    return router;
};