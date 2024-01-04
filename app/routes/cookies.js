var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');

module.exports = function(privateKey, dynamodb, dynamodbLL, uuidv4, s3) {
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
    let convertCounter = 0
    async function convertToJSON(fileID, parentPath = [], isUsing, mapping) {
        const subBySU = await getSub(fileID, "su");
        const entity = await getEntity(subBySU.Items[0].e)
        let children 
        
        if (mapping){
            if (mapping.hasOwnProperty(subBySU.Items[0].e)){
                console.log("mapping", mapping, subBySU.Items[0].e, mapping[subBySU.Items[0].e])
                children = mapping[subBySU.Items[0].e]
            } else {
                children = entity.Items[0].t
            }
        } else {
            children = entity.Items[0].t
        }
        const linked = entity.Items[0].l
        const head = await getWord(entity.Items[0].a)
        const name = head.Items[0].r
        let obj = {};
        let using = false;
        if (entity.Items[0].u){
            using = true
        }
        console.log("entity", entity)
        console.log("entity.Items[0].h", entity.Items[0].h)
        let subH = await getSub(entity.Items[0].h, "e")
        console.log(subH)
        console.log("subH.Items[0].su",subH.Items[0].su)
        obj[fileID] = {meta: {name: name, expanded:false, head:subH.Items[0].su},children: {}, using: using, linked:{}};
        let paths = {}
        if (isUsing){
            paths[fileID] = [...parentPath];
        } else {
            paths[fileID] = [...parentPath, fileID];
        }
        if (children){
            for (let child of children) {
                const subByE = await getSub(child, "e");
                console.log("subByE", subByE)
                    let uuid = subByE.Items[0].su
                    let childResponse = {}
                    if (convertCounter < 200) {

                    childResponse = await convertToJSON(uuid, paths[fileID], false, mapping);
                    convertCounter++;
                    }

                    

                    Object.assign(obj[fileID].children, childResponse.obj);
                    Object.assign(paths, childResponse.paths);
            }
        }
        if (using){
            const subOfHead = await getSub(entity.Items[0].u, "e");
            console.log("subBySU", subBySU)
            console.log("USING:::paths", paths)
            console.log("USING:::paths[fileID]", paths[fileID])
            const headUsingObj  = await convertToJSON(subOfHead.Items[0].su, paths[fileID], true, entity.Items[0].m)
            console.log("headUsingObj", JSON.stringify(headUsingObj))
            Object.assign(obj[fileID].children, headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].children);

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
                let linkResponse = await convertToJSON(uuid, paths[fileID], false);
                Object.assign(obj[fileID].linked, linkResponse.obj);
                Object.assign(paths, linkResponse.paths);
            }
        }
        
        console.log("DONE", JSON.stringify(obj))
        let groupList = await getGroups()
    
        return { obj: obj, paths: paths, groups: groupList };
    }

    const updateEntity = async (e, col, val, v, c) => {
        console.log("updateEntity",e, col, val, v, c)
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
        } else if (col === "m"){
            params1 = {
                "TableName": "entities",
                "Key": {"e": e},
                "UpdateExpression": `set #m = if_not_exists(#m, :emptyMap)`,
                "ExpressionAttributeNames": {'#m': 'm'},
                "ExpressionAttributeValues": {":emptyMap": {}}
            };
            await dynamodb.update(params1).promise();
            /////////////////////// WORKING ON THIS: START
            console.log("col is m")
            console.log(val[Object.keys(val)[0]])
            params = {
                "TableName": "entities",
                "Key": {
                    "e": e // Replace with your item's primary key and value
                },
                "UpdateExpression": `set #m.#val = :valList, #v = :v, #c = :c`,
                "ExpressionAttributeNames": {
                    '#m': 'm',
                    '#val': Object.keys(val)[0], // Assuming this is a correct and valid attribute name
                    '#v': 'v', // Assuming 'v' is the attribute name you're trying to update
                    '#c': 'c'  // Assuming 'c' is the attribute name you're trying to update
                },
                "ExpressionAttributeValues": {
                    ":valList": val[Object.keys(val)[0]], // The value for '#val'
                    ":v": v, // The value you want to set for 'v'
                    ":c": c  // The value you want to set for 'c'
                }
            };
            
            /////////////////////////WORKING ON THIS: END



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
            console.log("params",params)
            await dynamodb.update(params).promise();
            console.log("done");
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
            let colVal = [val];
    
            // Insert the new record with the c, s, and p values
            let newRecord = {}

            let newM = {}
        if (col === "t" || col === "f" || col === "l" || col === "o"){
            newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                p: previousVersionId, // Set the p attribute to the v of the last record
                [col]: colVal,
                d: Date.now()
            };
        } else if (col === "m"){
            const entity = await getEntity(newE)
            //entity = await getEntity() // getting the entity which called the using
            if (entity.Items[0].m){
                console.log("entity.Items[0].m",entity.Items[0].m)
                colVal = entity.Items[0].m // storing the mapping object
            } else {
                colVal = {}
                console.log("colVal", colVal)
            }
            colVal[Object.keys(val)[0]] = [val[Object.keys(val)[0]]] // adding or updating the value to be the array of the new entity created
            //This should ensure the entity that is using another hierarchy gets the mapping of any child objects attached to the refferenced hierarchy.
            //DO WE NEED TO PUSH IT, MAYBE WE NEED TO CHECK IF THE VAL OR THE PARENT EXIST AND PUSH OR REPLACE IT IF IT DOES.
            newM = colVal
            newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                p: previousVersionId, // Set the p attribute to the v of the last record
                [col]: colVal,
                d: Date.now()
            };

        }else {
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
            console.log("v,c,m",id.toString(),newCValue.toString(), newM)
            return {v:id.toString(), c:newCValue.toString(), m:newM};
        } catch (error) {
            console.error("Error adding record:", error);
            return null
        }
    };

    const createFile = async (su) => {
            console.log("createFile=", su)
            const jsonObject = {
                "entity": su
            };
            const jsonString = JSON.stringify(jsonObject);
            const bucketParams = {
                Bucket: 'public.1var.com',
                Key: "actions/"+su+".json",
                Body: jsonString,
                ContentType: 'application/json'
            };
            const data = await s3.putObject(bucketParams).promise();
            console.log(`File uploaded successfully to ${bucketParams.Bucket}/${bucketParams.Key}`);
            console.log(data);
            return true;

    }

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
        var actionFile = ""
        var mainObj = {}
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
            const fileResult = await createFile(uniqueId)
            actionFile = uniqueId
            const details2 = await addVersion(parent.Items[0].e.toString(), "t", e.toString(), eParent.Items[0].c);
            const updateParent = await updateEntity(parent.Items[0].e.toString(), "t", e.toString(), details2.v, details2.c);
            const details22 = await addVersion(e.toString(), "f", parent.Items[0].e.toString(), "1");
            const updateParent22 = await updateEntity(e.toString(), "f", parent.Items[0].e.toString(), details22.v, details22.c);
            const group = eParent.Items[0].g
            const details3 = await addVersion(e.toString(), "g", group, "1");
            const updateParent3 = await updateEntity(e.toString(), "g", group, details3.v, details3.c);
            mainObj = await convertToJSON(headUUID)
        } else if (action == "link"){
            const childID = reqPath.split("/")[3]
            const parentID = reqPath.split("/")[4]
            await linkEntities(childID, parentID)
            mainObj = await convertToJSON(childID)
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
            const fileResult = await createFile(uniqueId2)
            actionFile = uniqueId2
            let subRes2 = await createSubdomain(uniqueId2,aE.toString(),e.toString(),"0")
            mainObj  = await convertToJSON(uniqueId2)
        } else if (action == "useGroup"){
            const newUsingName = reqPath.split("/")[3]
            const headUsingName = reqPath.split("/")[4]
            const using = await getSub(newUsingName, "su");
            const ug = await getEntity(using.Items[0].e)
            const used = await getSub(headUsingName, "su");
            const ud = await getEntity(used.Items[0].e)
            const details2 = await addVersion(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), ug.Items[0].c);
            const updateParent = await updateEntity(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), details2.v, details2.c);
            const headSub = await getSub(ug.Items[0].h, "e");
            mainObj  = await convertToJSON(headSub.Items[0].su)
        } else if (action == "map"){
            const referencedParent = reqPath.split("/")[3]
            const newEntityName = reqPath.split("/")[4]
            const mappedParent = reqPath.split("/")[5]
            const headEntity = reqPath.split("/")[6]
            const subRefParent = await getSub(referencedParent, "su");
            const subMapParent = await getSub(mappedParent, "su");
            const mpE = await getEntity(subMapParent.Items[0].e)
            const mrE = await getEntity(subRefParent.Items[0].e)

            const e = await incrementCounterAndGetNewValue('eCounter');
            const aNew = await incrementCounterAndGetNewValue('wCounter');
            const a = await createWord(aNew.toString(), newEntityName);

            const details = await addVersion(e.toString(), "a", a.toString(), null);
            const result = await createEntity(e.toString(), a.toString(), details.v, mpE.Items[0].g, mpE.Items[0].h);

            const uniqueId = await uuidv4();
            let subRes = await createSubdomain(uniqueId,a.toString(),e.toString(), "0")
            const fileResult = await createFile(uniqueId)
            actionFile = uniqueId

            let newM = {}
            newM[mrE.Items[0].e] = e.toString()
            console.log("mpE.Items[0]",mpE.Items[0])
            const details2a = await addVersion(mpE.Items[0].e.toString(), "m", newM, mpE.Items[0].c);
            console.log("details2a", details2a)
            const updateParent = await updateEntity(mpE.Items[0].e.toString(), "m", details2a.m, details2a.v, details2a.c);
            
            mainObj  = await convertToJSON(headEntity)
            // m is being added to Primary and it needs to be added to PrimaryChild
            // Look into if we have to have group as an int in meta. Maybe we could assign the groupid and look at paths for the last record assigned to the used hierarchy.
        } else if (action == "file"){
            const actionFile = reqPath.split("/")[3]

        }
        mainObj["file"] = actionFile + ""
        response = mainObj
            const expires = 90000;
            const url = "https://public.1var.com/actions/"+actionFile+".json";
            console.log("url", url)
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
                console.log("cookies", cookies)
                for (const cookieName in cookies) {
                    res.cookie(cookieName, cookies[cookieName], { maxAge: expires, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
                }
                console.log("response", response)
                res.json({"ok":true,"response":response});
            }   
    });
    return router;

}