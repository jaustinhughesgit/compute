var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

module.exports = function(privateKey, dynamodb, dynamodbLL, uuidv4) {
    var router = express.Router();
    const keyPairId = 'K2LZRHRSYZRU3Y'; 
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);


    async function getSub(val, key){
        let params
        if (key == "su"){
            params = { TableName: 'subdomains', KeyConditionExpression: 'su = :su', ExpressionAttributeValues: {':su': val} };
        } else if (key == "e"){
            params = { TableName: 'subdomains',IndexName: 'eIndex',KeyConditionExpression: 'e = :e',ExpressionAttributeValues: {':e': val} }
        } else if (key == "a"){
            params = { TableName: 'subdomains',IndexName: 'aIndex',KeyConditionExpression: 'a = :a',ExpressionAttributeValues: {':a': val} }
        }
        return await dynamodb.query(params).promise()
    }

    async function getEntity(e){
        params = { TableName: 'entities', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: {':e': e} };
        return await dynamodb.query(params).promise()
    }

    async function getWord(a){
        params = { TableName: 'words', KeyConditionExpression: 'a = :a', ExpressionAttributeValues: {':a': a} };
        return await dynamodb.query(params).promise()
    }

    async function convertToJSON(fileID, parentPath = []) {
        const subBySU = await getSub(fileID, "su");
        const entity = await getEntity(subBySU.Items[0].e)
        const children = entity.Items[0].t
        const linked = entity.Items[0].l
        const head = await getWord(entity.Items[0].a)
        const name = head.Items[0].r
        let obj = {};
        obj[fileID] = {meta: {name: name, expanded:false, head:entity.Items[0].h},children: {}, linked:{}};
        let paths = {}
        paths[fileID] = [...parentPath, fileID];
        if (children){
            for (let child of children) {
                const subByE = await getSub(child, "e");
                console.log("subByE", subByE)
                    let uuid = subByE.Items[0].su
                    let childResponse = await convertToJSON(uuid, paths[fileID]);
                    Object.assign(obj[fileID].children, childResponse.obj);
                    Object.assign(paths, childResponse.paths);
            }
        }
        if (linked){
            for (let link of linked) {
                const subByE = await getSub(link, "e");
                    let uuid = subByE.Items[0].su
                    let linkResponse = await convertToJSON(uuid, paths[fileID]);
                    Object.assign(obj[fileID].linked, linkResponse.obj);
                    Object.assign(paths, linkResponse.paths);
            }
        }
        return { obj: obj, paths: paths };
    }

    const updateEntity = async (e, col, val, v, c) => {
        if (Array.isArray(val)){
            const params = {
                TableName: 'entities',
                Key: {
                    e: e
                },
                UpdateExpression: `set ${col} = list_append(if_not_exists(${col}, :empty_list), :val), v = :v, c = :c`,
                ExpressionAttributeValues: {
                    ':val': [val], // Wrap val in an array
                    ':empty_list': [], // An empty list to initialize if col does not exist
                    ':v': v,
                    ':c': c
                }
            };
        } else {
            const params = {
                TableName: 'entities',
                Key: { e: e },
                UpdateExpression: `set ${col} = if_not_exists(${col}, :default_val, :val), v = :v, c = :c`,
                ExpressionAttributeValues: {
                    ':val': val,
                    ':default_val': val, // Set default value for col if it doesn't exist
                    ':v': v,
                    ':c': c
                }
            };
        }
    
        try {
            await dynamodb.update(params).promise();
            console.log(`Entity updated with e: ${e}, ${col}: ${val}, v: ${v}, c: ${c}`);
            return `Entity updated with e: ${e}, ${col}: ${val}, v: ${v}, c: ${c}`;
        } catch (error) {
            console.error("Error updating entity:", error);
            throw error; // Rethrow the error for the caller to handle
        }
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

    async function addVersion(newE, col, val, forceC){
        try {
            console.log("01")
            const id = await incrementCounterAndGetNewValue('vCounter');
    
            console.log("02")
            let newCValue;
            let newSValue; // s value to be determined based on forceC
    
            console.log("03")
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
    
            console.log("04")
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
    
            console.log("05")
            let previousVersionId, previousVersionDate;
            if (queryResult.Items.length > 0) {
                const latestRecord = queryResult.Items[0];
                previousVersionId = latestRecord.v; // Store the v of the last record
                previousVersionDate = latestRecord.d; // Store the d (sort key) of the last record
            }

            console.log("06")
            // Initialize col as an array and add val to it
            const colArray = [val];
    
            console.log("07")
            // Insert the new record with the c, s, and p values
            const newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                p: previousVersionId, // Set the p attribute to the v of the last record
                [col]: colArray,
                d: Date.now()
            };
            console.log("08")
    
            await dynamodb.put({
                TableName: 'versions',
                Item: newRecord
            }).promise();
    
            console.log("09")
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
            console.log("010")
            return {v:id.toString(), c:newCValue.toString()};
        } catch (error) {
            console.error("Error adding record:", error);
            return null
        }
    };

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

    const createSubdomain = async (su, a, e) => {
        console.log(su, a, e)
        const paramsAA = {
            TableName: 'subdomains',
            Item: {
                su: su,
                a: a,
                e: e
            }
        };
    
        try {
            console.log("trying")
            const response = await dynamodb.put(paramsAA).promise();
            console.log(response)
            console.log(`Entity created with su: ${su}, a: ${a}, e: ${e}`);
            return `Entity created with su: ${su}, a: ${a}, e: ${e}`;
        } catch (error) {
            console.error("Error creating entity:", error);
            throw error; // Rethrow the error for the caller to handle
        }
    };

    router.get('/*', async function(req, res, next) {
        const reqPath = req.apiGateway.event.path
        const action = reqPath.split("/")[2]
        
        var response = {}
        if (action == "get"){
            const fileID = reqPath.split("/")[3]
            console.log(">>>>>>>>>", fileID)
            response = await convertToJSON(fileID)
        } else if (action == "add") {
            const fileID = reqPath.split("/")[3]
            const newEntityName = reqPath.split("/")[4]
            const headUUID = reqPath.split("/")[5]
            const parent = await getSub(fileID, "su");
            console.log("parent", parent)
            const eParent = await getEntity(parent.Items[0].e)
            console.log("eParent",eParent)
            const e = await incrementCounterAndGetNewValue('eCounter');
            const aNew = await incrementCounterAndGetNewValue('wCounter');
            console.log("0")
            const a = await createWord(aNew.toString(), newEntityName);
            console.log("1")
            const details = await addVersion(e.toString(), "a", a.toString(), null);
            console.log("2")
            const result = await createEntity(e.toString(), a.toString(), details.v);
            console.log("3")
            const uniqueId = await uuidv4();
            console.log("4")
            let subRes = await createSubdomain(uniqueId,a.toString(),e.toString())
            console.log("5")
            const details2 = await addVersion(parent.Items[0].e, "t", e.toString(), null);
            console.log("6")
            const updateParent = await updateEntity(parent.Items[0].e, "t", e.toString(), details2.v, details2.c);
            console.log("7")
            const group = eParent.Items[0].g
            console.log("group", group)
            const details3 = await addVersion(e.toString(), "g", group, null);
            console.log("details3", details3)
            const updateParent3 = await updateEntity(e.toString(), "g", group, details3.v, details3.c);
            console.log("updateParent",updateParent)
            console.log("updateParent3",updateParent3)
            response = await convertToJSON(headUUID)
        }


        const expires = 30000;
        const url = "https://public.1var.com/test.json";
        const policy = JSON.stringify({
            Statement: [
                {
                    Resource: url,
                    Condition: {
                        DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + expires) / 1000) }
                    }
                }
            ]
        });
        if (req.type === 'url'){
            const signedUrl = signer.getSignedUrl({
                url: url,
                policy: policy
            });
            res.json({ signedUrl: signedUrl });
        } else {
            const cookies = signer.getSignedCookie({
                policy: policy
            });
            for (const cookieName in cookies) {
                res.cookie(cookieName, cookies[cookieName], { maxAge: expires, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
            }
            res.json({"ok":true,"response":response});
        }   
    });
    return router;

}