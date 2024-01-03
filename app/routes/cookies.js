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
        } else if (key === "e"){
            params = { TableName: 'subdomains',IndexName: 'eIndex',KeyConditionExpression: 'e = :e',ExpressionAttributeValues: {':e': val} }
        } else if (key === "a"){
            params = { TableName: 'subdomains',IndexName: 'aIndex',KeyConditionExpression: 'a = :a',ExpressionAttributeValues: {':a': val} }
        } else if (key === "g"){
            params = { TableName: 'subdomains',IndexName: 'gIndex',KeyConditionExpression: 'g = :g',ExpressionAttributeValues: {':g': val} }
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

    async function getGroups(){
        params = { TableName: 'groups' };
        let groups = await dynamodb.scan(params).promise();
        let groupObjs = []
        for (group in groups.Items){
            const subByG = await getSub(groups.Items[group].g.toString(), "g");
            const groupName = await getWord(groups.Items[group].a.toString())
            const subByE = await getSub(groups.Items[group].e.toString(), "e");
            groupObjs.push({"groupId":subByG.Items[0].su, "name":groupName.Items[0].r, "head":subByE.Items[0].su})
        }

        return groupObjs
    }
    
    async function convertToJSON(fileID, parentPath = []) {
        const subBySU = await getSub(fileID, "su");
        const entity = await getEntity(subBySU.Items[0].e)
        const children = entity.Items[0].t
        const linked = entity.Items[0].l
        const head = await getWord(entity.Items[0].a)
        const name = head.Items[0].r
        let obj = {};
        let using = false;
        if (entity.Items[0].u === "1"){
            using = true
        }
        obj[fileID] = {meta: {name: name, expanded:false, head:entity.Items[0].h},children: {}, using: using, linked:{}};
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
        if (using){
            console.log("using", )
            const subOfHead = await getSub(entity.Items[0].u, "e");
            console.log("subBySU", subBySU)
            const headUsingObj  = await convertToJSON(subOfHead.Items[0].su, paths[fileID])
            console.log("headUsingObj", JSON.stringify(headUsingObj))
            //obj[fileID].children = headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].children
            Object.assign(obj[fileID].children, headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].children);


            // PATHS NEEDS TO HAVE THE MAINOBJ PATH AND THE REFFERENCED PATH COMBINED SO THE APP CAN FOLLOW IT THROUGH THE HIERARCHY.

            Object.assign(paths, headUsingObj.paths);
            obj[fileID].meta["usingMeta"] = {
                "name": headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].meta.name,
                "head": headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].meta.head,
                "id": Object.keys(headUsingObj.obj)[0]
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
        
        console.log("DONE", JSON.stringify(obj))
        let groupList = await getGroups()
        return { obj: obj, paths: paths, groups: groupList };
    }

    const updateEntity = async (e, col, val, v, c) => {
        let params = {}
        if (col === "t" || col === "f"){
            console.log("col === f || col === f")
            params = {
                "TableName": 'entities',
                "Key": {
                    "e": e
                },
                "UpdateExpression": `set ${col} = list_append(if_not_exists(${col}, :empty_list), :val), v = :v, c = :c`,
                "ExpressionAttributeValues": {
                    ':val': [val], // Wrap val in an array
                    ':empty_list': [], // An empty list to initialize if col does not exist
                    ':v': v,
                    ':c': c
                }
            };
        } else {
            console.log("col is not t")
            params = {
                "TableName": 'entities',
                "Key": { "e": e }, 
                "UpdateExpression": `set ${col} = if_not_exists(${col}, :val), v = :v, c = :c`,
                "ExpressionAttributeValues": {
                    ':val': val,
                    ':v': v,
                    ':c': c
                }
            };
        }
       
    
        try {
            await dynamodb.update(params).promise();
            //console.log(`Entity updated with e: ${e}, ${col}: ${val}, v: ${v}, c: ${c}`);
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

    const getHead = async (by, uuid) => {
        const subBySU = await getSub(uuid, "su");
        const entity = await getEntity(subBySU.Items[0].e)
    }

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

    const createGroup = async (gid, groupNameID, entityID) => {
    
        await dynamodb.put({
            TableName: 'groups',
            Item: {
                g: gid,
                a: groupNameID,
                e: entityID
            }
        }).promise();
        return gid;
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
            if (forceC) {
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

            // Initialize col as an array and add val to it
            const colArray = [val];
    
            // Insert the new record with the c, s, and p values
            let newRecord = {}
        if (col === "t" || col === "f" || col === "l" || col === "o"){
            newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                p: previousVersionId, // Set the p attribute to the v of the last record
                [col]: colArray,
                d: Date.now()
            };
        } else {
            newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                p: previousVersionId, // Set the p attribute to the v of the last record
                [col]: val,
                d: Date.now()
            };
        }
    
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
            return {v:id.toString(), c:newCValue.toString()};
        } catch (error) {
            console.error("Error adding record:", error);
            return null
        }
    };

    const createEntity = async (e, a, v, g, h) => {
        const params = {
                TableName: 'entities',
                Item: {
                    e: e,
                    a: a,
                    v: v,
                    g: g,
                    h: h
                }
            };
        
    
        try {
            await dynamodb.put(params).promise();
            //console.log(`Entity created with e: ${e}, a: ${a}, v: ${v}`);
            return `Entity created with e: ${e}, a: ${a}, v: ${v}`;
        } catch (error) {
            console.error("Error creating entity:", error);
            throw error; // Rethrow the error for the caller to handle
        }
    };

    const createSubdomain = async (su, a, e, g) => {
        const paramsAA = {
            TableName: 'subdomains',
            Item: {
                su: su,
                a: a,
                e: e,
                g: g
            }
        };
    
        try {
            const response = await dynamodb.put(paramsAA).promise();
            //console.log(`Entity created with su: ${su}, a: ${a}, e: ${e}`);
            return `Entity created with su: ${su}, a: ${a}, e: ${e}`;
        } catch (error) {
            console.error("Error creating entity:", error);
            throw error; // Rethrow the error for the caller to handle
        }
    };

    async function linkEntities(childID, parentID){
        var childE = await getSub(childID, "su");
        var parentE = await getSub(parentID, "su");

        const eParent = await getEntity(parentE.Items[0].e)
        const eChild = await getEntity(childE.Items[0].e)

        var detailsChild = await addVersion(childE.Items[0].e, "o", parentE.Items[0].e, eChild.Items[0].c);
        var updateEntityC = await updateEntity(childE.Items[0].e, "o", parentE.Items[0].e, detailsChild.v, detailsChild.c)

        var detailsParent = await addVersion(parentE.Items[0].e, "l", childE.Items[0].e, eParent.Items[0].c);
        var updateEntityP = await updateEntity(parentE.Items[0].e, "l", childE.Items[0].e, detailsParent.v, detailsParent.c)

        return "success"
    }

    router.get('/*', async function(req, res, next) {
        const reqPath = req.apiGateway.event.path
        const action = reqPath.split("/")[2]
        
        var response = {}
        if (action == "get"){
            const fileID = reqPath.split("/")[3]
            response = await convertToJSON(fileID)
        } else if (action == "add") {
            const fileID = reqPath.split("/")[3]
            const newEntityName = reqPath.split("/")[4]
            const headUUID = reqPath.split("/")[5]
            const parent = await getSub(fileID, "su");
            const eParent = await getEntity(parent.Items[0].e)
            const e = await incrementCounterAndGetNewValue('eCounter');
            const aNew = await incrementCounterAndGetNewValue('wCounter');
            const a = await createWord(aNew.toString(), newEntityName);
            const details = await addVersion(e.toString(), "a", a.toString(), null);
            const result = await createEntity(e.toString(), a.toString(), details.v, eParent.Items[0].g, eParent.Items[0].h);
            const uniqueId = await uuidv4();
            let subRes = await createSubdomain(uniqueId,a.toString(),e.toString(), "0")
            const details2 = await addVersion(parent.Items[0].e.toString(), "t", e.toString(), eParent.Items[0].c);
            const updateParent = await updateEntity(parent.Items[0].e.toString(), "t", e.toString(), details2.v, details2.c);
            const details22 = await addVersion(e.toString(), "f", parent.Items[0].e.toString(), "1");
            const updateParent22 = await updateEntity(e.toString(), "f", parent.Items[0].e.toString(), details22.v, details22.c);
            const group = eParent.Items[0].g
            const details3 = await addVersion(e.toString(), "g", group, "1");
            const updateParent3 = await updateEntity(e.toString(), "g", group, details3.v, details3.c);
            response = await convertToJSON(headUUID)
        } else if (action == "link"){
            const childID = reqPath.split("/")[3]
            const parentID = reqPath.split("/")[4]
            await linkEntities(childID, parentID)
            response = await convertToJSON(childID)
        } else if (action == "newGroup"){
            const newGroupName = reqPath.split("/")[3]
            const headEntityName = reqPath.split("/")[4]
            const aNewG = await incrementCounterAndGetNewValue('wCounter');
            const aG = await createWord(aNewG.toString(), newGroupName);
            const aNewE = await incrementCounterAndGetNewValue('wCounter');
            const aE = await createWord(aNewE.toString(), headEntityName);
            const gNew = await incrementCounterAndGetNewValue('gCounter');
            const e = await incrementCounterAndGetNewValue('eCounter');
            const groupID = await createGroup(gNew.toString(), aNewG, e.toString());
            const uniqueId = await uuidv4();
            console.log(uniqueId, "0", "0", )
            let subRes = await createSubdomain(uniqueId,"0","0",gNew.toString())
            const details = await addVersion(e.toString(), "a", aE.toString(), null);
            const result = await createEntity(e.toString(), aE.toString(), details.v, gNew.toString(), e.toString()); //DO I NEED details.c
            const uniqueId2 = await uuidv4();
            let subRes2 = await createSubdomain(uniqueId2,aE.toString(),e.toString(),"0")
            response  = await convertToJSON(uniqueId2)
        } else if (action == "useGroup"){
            const newUsingName = reqPath.split("/")[3]
            const headUsingName = reqPath.split("/")[4]
            const using = await getSub(newUsingName, "su");
            const ug = await getEntity(using.Items[0].e)
            const used = await getSub(headUsingName, "su");
            const ud = await getEntity(used.Items[0].e)
            const details2 = await addVersion(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), ug.Items[0].c);
            const updateParent = await updateEntity(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), details2.v, details2.c);
            //const usingHead = getHead("entity",newUsingName)
            
            //THIS WORKS FOR ONE USING ENTITY, WE NEED IT FOR ALL USINGS IN THE RESPONSE. WE NEED TO GET THEM BY THE "u" COLUMN
            // MAKE THE USING ENTITY HAVE THE DATA INSIDE THE BOX, OR IN THE RIGH PANNEL, MAYBE COLOR IT

            const headSub = await getSub(ug.Items[0].h, "e");
            const mainObj  = await convertToJSON(headSub.Items[0].su)
 

            // get head of newUsingName
            // convertToJson the head
            // convertToJson the headUsingName
            // grap the using entity and stick the headUsingName object into it, but keep the newUsingName UUID
            // locate all the mappings in the same group as the newUsingName
            // convertToJSON the mapping entity uuids and stick them into the mapped target UUUID
            // send the collective response.
            // well need some meta that designates the entities that are used.

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