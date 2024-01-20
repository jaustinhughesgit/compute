var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');
const bodyParser = require('body-parser');
var router = express.Router();
const keyPairId = 'K2LZRHRSYZRU3Y'; 
let convertCounter = 0
let isPublic = false

async function getSub(val, key, dynamodb){
    //console.log("getSub")
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

async function getEntity(e, dynamodb){
    //console.log("getEntity")
    params = { TableName: 'entities', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: {':e': e} };
    return await dynamodb.query(params).promise()
}

async function getWord(a, dynamodb){
    //console.log("getWord")
    params = { TableName: 'words', KeyConditionExpression: 'a = :a', ExpressionAttributeValues: {':a': a} };
    return await dynamodb.query(params).promise()
}

async function getGroups(dynamodb){
    //console.log("getGroups")
    params = { TableName: 'groups' };
    let groups = await dynamodb.scan(params).promise();
    let groupObjs = []
    for (group in groups.Items){
        const subByG = await getSub(groups.Items[group].g.toString(), "g", dynamodb);
        const groupName = await getWord(groups.Items[group].a.toString(), dynamodb)
        const subByE = await getSub(groups.Items[group].e.toString(), "e", dynamodb);
        groupObjs.push({"groupId":subByG.Items[0].su, "name":groupName.Items[0].r, "head":subByE.Items[0].su})
    }

    return groupObjs
}

function fileLocation(val){
    let location = "private"
    if (val == "true" || val == true){
        location = "public"
    }
    return location
}

function setIsPublic(val){
    if (val == "true" || val == true){
        isPublic = true
    } else {
        isPublic = false
    }
}

async function convertToJSON(fileID, parentPath = [], isUsing, mapping, dynamodb, uuidv4, pathID, parentPath2 = [], id2Path = {}, usingID = "") {
    //console.log("convertToJSON")
    const subBySU = await getSub(fileID, "su", dynamodb);
    setIsPublic(subBySU.Items[0].z);
    const entity = await getEntity(subBySU.Items[0].e, dynamodb)
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
    const head = await getWord(entity.Items[0].a, dynamodb)
    const name = head.Items[0].r
    let obj = {};
    let using = false;
    if (entity.Items[0].u){
        using = true
    }
    pathID = await uuidv4();
    let subH = await getSub(entity.Items[0].h, "e", dynamodb)
    obj[fileID] = {meta: {name: name, expanded:false, head:subH.Items[0].su},children: {}, using: using, linked:{}, pathid:pathID, usingID:usingID, location:fileLocation(isPublic)};
    let paths = {}
    let paths2 = {}
    //if (!pathID){
    //}
    if (isUsing){
        paths[fileID] = [...parentPath];
        paths2[pathID] = [...parentPath2];
    } else {
        paths[fileID] = [...parentPath, fileID];
        paths2[pathID] = [...parentPath2, fileID];
    }
    id2Path[fileID] = pathID

    if (children){
        for (let child of children) {
            const subByE = await getSub(child, "e", dynamodb);
                let uuid = subByE.Items[0].su
                let childResponse = {}
                if (convertCounter < 200) {

                childResponse = await convertToJSON(uuid, paths[fileID], false, mapping, dynamodb, uuidv4, pathID, paths2[pathID], id2Path, usingID);
                convertCounter++;
                }
                Object.assign(obj[fileID].children, childResponse.obj);
                Object.assign(paths, childResponse.paths);
                Object.assign(paths2, childResponse.paths2);

        }
    }
    if (using){
        usingID = fileID
        const subOfHead = await getSub(entity.Items[0].u, "e", dynamodb);
        const headUsingObj  = await convertToJSON(subOfHead.Items[0].su, paths[fileID], true, entity.Items[0].m, dynamodb, uuidv4, pathID, paths2[pathID], id2Path, usingID)
        Object.assign(obj[fileID].children, headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].children);
        Object.assign(paths, headUsingObj.paths);
        Object.assign(paths2, headUsingObj.paths2);
        obj[fileID].meta["usingMeta"] = {
            "name": headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].meta.name,
            "head": headUsingObj.obj[Object.keys(headUsingObj.obj)[0]].meta.head,
            "id": Object.keys(headUsingObj.obj)[0],
            "pathid":pathID
        }
    }

    if (linked){
        for (let link of linked) {
            const subByE = await getSub(link, "e", dynamodb);
            let uuid = subByE.Items[0].su
            let linkResponse = await convertToJSON(uuid, paths[fileID], false, null, dynamodb, uuidv4, pathID, paths2[pathID], id2Path, usingID);
            Object.assign(obj[fileID].linked, linkResponse.obj);
            Object.assign(paths, linkResponse.paths);
            Object.assign(paths2, linkResponse.paths2);
        }
    }
    
    let groupList = await getGroups(dynamodb)

    return { obj: obj, paths: paths, paths2: paths2, id2Path:id2Path, groups:groupList };
}

const updateEntity = async (e, col, val, v, c, dynamodb) => {
    //console.log("updateEntity")
    let params = {}
    if (col === "-t" || col === "-f"){
        const uEntity = await getEntity(e, dynamodb)
        const list = uEntity.Items[0][col.replace("-","")]
        const indexToRemove = list.indexOf(val);
        params = {
            "TableName": 'entities',
            "Key": { 'e': e },
            "UpdateExpression": `REMOVE ${col.replace("-","")}[${indexToRemove}]`,
            "ReturnValues": 'ALL_NEW'
        }
    } else if (col === "t" || col === "f"){
        params = {
            "TableName": 'entities',
            "Key": {
                "e": e
            },
            "UpdateExpression": `set ${col} = list_append(if_not_exists(${col}, :empty_list), :val), v = :v, c = :c`,
            "ExpressionAttributeValues": {
                ':val': [val],
                ':empty_list': [],
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

        let params2 = {
            "TableName": 'entities',
            "Key": {
                "e": e 
            },
            "UpdateExpression": "set #m.#val = if_not_exists(#m.#val, :emptyList)",
            "ExpressionAttributeNames": {
                '#m': 'm',
                '#val': Object.keys(val)[0]
            },
            "ExpressionAttributeValues": {
                ":emptyList": []
            }
        };
        await dynamodb.update(params2).promise();

        params = {
            "TableName": "entities",
            "Key": {
                "e": e 
            },
            "UpdateExpression": "set #m.#val = list_append(#m.#val, :newVal), #v = :v, #c = :c",
            "ExpressionAttributeNames": {
                '#m': 'm',
                '#val': Object.keys(val)[0], 
                '#v': 'v', 
                '#c': 'c'
            },
            "ExpressionAttributeValues": {
                ":newVal": val[Object.keys(val)[0]],
                ":v": v, 
                ":c": c 
            }
        };
    } else {
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
        return await dynamodb.update(params).promise();
    } catch (error) {
        console.error("Error updating entity:", error);
        throw error; // Rethrow the error for the caller to handle
    }
};

const wordExists = async (word, dynamodb) => {
    //console.log("wordExists")
    const params = {
        TableName: 'words',
        IndexName: 'sIndex',
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

const incrementCounterAndGetNewValue = async (tableName, dynamodb) => {
    //console.log("incrementCounterAndGetNewValue")
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

const getHead = async (by, value, dynamodb) => {
    const subBySU = await getSub(value, by, dynamodb);
    //console.log("subBySU", subBySU)
    const entity = await getEntity(subBySU.Items[0].e, dynamodb)
    //console.log("entity", entity)
    const headSub = await getSub(entity.Items[0].h, "e", dynamodb);
    //console.log("headSub", headSub)
    return headSub
}

const createWord = async (id, word, dynamodb) => {
    //console.log("createWord")
    const lowerCaseWord = word.toLowerCase();

    const checkResult = await wordExists(lowerCaseWord, dynamodb);
    if (checkResult.exists) {
        return checkResult.id;
    }

    await dynamodb.put({
        TableName: 'words',
        Item: { a: id, r: word, s: lowerCaseWord }
    }).promise();

    return id;
};

const createGroup = async (gid, groupNameID, entityID, dynamodb) => {
    //console.log("createGroup")

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

async function addVersion(newE, col, val, forceC, dynamodb){
    //console.log("addVersion")
    try {
        const id = await incrementCounterAndGetNewValue('vCounter', dynamodb);

        let newCValue;
        let newSValue;

        const queryResult = await dynamodb.query({
            TableName: 'versions',
            IndexName: 'eIndex',
            KeyConditionExpression: 'e = :eValue',
            ExpressionAttributeValues: {
                ':eValue': newE
            },
            ScanIndexForward: false,
            Limit: 1
        }).promise();
        if (forceC) {
            newCValue = forceC;

            if (queryResult.Items.length > 0) {
                const latestSValue = parseInt(queryResult.Items[0].s);
                newSValue = isNaN(latestSValue) ? 1 : latestSValue + 1;
            } else {
                newSValue = 1;
            }
        } else {
            newSValue = 1;
            newCValue = queryResult.Items.length > 0 ? parseInt(queryResult.Items[0].c) + 1 : 1;
        }

        let previousVersionId, previousVersionDate;
        if (queryResult.Items.length > 0) {
            const latestRecord = queryResult.Items[0];
            previousVersionId = latestRecord.v;
            previousVersionDate = latestRecord.d;
        }

        let colVal = [val];
        let newRecord = {}
        let newM = {}

    if (col === "t" || col === "f" || col === "l" || col === "o"){
        newRecord = {
            v: id.toString(),
            c: newCValue.toString(),
            e: newE,
            s: newSValue.toString(),
            p: previousVersionId,
            [col]: colVal,
            d: Date.now()
        };
    } else if (col === "m"){
        const entity = await getEntity(newE, dynamodb)
        if (entity.Items[0].m){
            colVal = entity.Items[0].m
        } else {
            colVal = {}
        }
        colVal[Object.keys(val)[0]] = [val[Object.keys(val)[0]]]
        newM = colVal
        newRecord = {
            v: id.toString(),
            c: newCValue.toString(),
            e: newE,
            s: newSValue.toString(),
            p: previousVersionId,
            [col]: colVal,
            d: Date.now()
        };

    }else {
        newRecord = {
            v: id.toString(),
            c: newCValue.toString(),
            e: newE,
            s: newSValue.toString(),
            p: previousVersionId,
            [col]: val,
            d: Date.now()
        };
    }

        await dynamodb.put({
            TableName: 'versions',
            Item: newRecord
        }).promise();

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
        return {v:id.toString(), c:newCValue.toString(), m:newM};
    } catch (error) {
        console.error("Error adding record:", error);
        return null
    }
};

const createFile = async (su, fileData, s3) => {
    //console.log("createFile")
        const jsonString = JSON.stringify(fileData);
        const bucketParams = {
            Bucket: fileLocation(isPublic) + '.1var.com',
            Key: su,
            Body: jsonString,
            ContentType: 'application/json'
        };
        const data = await s3.putObject(bucketParams).promise();
        return true;

}

const createEntity = async (e, a, v, g, h, dynamodb) => {
    //console.log("createEntity")
    const params = {
        TableName: 'entities',
        Item: { e: e, a: a, v: v, g: g, h: h }
    };

    try {
        await dynamodb.put(params).promise();
        return `Entity created with e: ${e}, a: ${a}, v: ${v}`;
    } catch (error) {
        console.error("Error creating entity:", error);
        throw error; // Rethrow the error for the caller to handle
    }
};

const createSubdomain = async (su, a, e, g, z, dynamodb) => {
    //console.log("createSubdomain")
    const paramsAA = {
        TableName: 'subdomains',
        Item: { su: su, a: a, e: e, g: g, z: z }
    };

    try {
        const response = await dynamodb.put(paramsAA).promise();
        return `Entity created with su: ${su}, a: ${a}, e: ${e}, z: ${z}`;
    } catch (error) {
        console.error("Error creating entity:", error);
        throw error; // Rethrow the error for the caller to handle
    }
};

const updateSubPermission = async (su, val, dynamodb, s3) => {
    params = {
        "TableName": 'subdomains',
        "Key": { "su": su }, 
        "UpdateExpression": `set z = :val`,
        "ExpressionAttributeValues": {
            ':val': val
        }
    };
    await dynamodb.update(params).promise();


        let file = su
        let sourceBucket
        let destinationBucket



        if (val == "true"){
            console.log("val == true")
            sourceBucket = 'private.1var.com'
            destinationBucket = 'public.1var.com'
        } else {
            console.log("val == false")
            sourceBucket = 'public.1var.com'
            destinationBucket = 'private.1var.com'
        }

        // List all versions of the object in the source bucket
        const versions = await s3.listObjectVersions({
            Bucket: sourceBucket,
            Prefix: file
        }).promise();
        console.log("versions", versions)
        for (const version of versions.Versions) {
            console.log("version", version)
            // Copy each version to the destination bucket
            await s3.copyObject({
                Bucket: destinationBucket,
                CopySource: `${sourceBucket}/${file}?versionId=${version.VersionId}`,
                Key: file
            }).promise();

            // Optionally, delete the original version
            await s3.deleteObject({
                Bucket: sourceBucket,
                Key: file,
                VersionId: version.VersionId
            }).promise();
        }

        return { status: 'All versions moved successfully' };

}

async function linkEntities(childID, parentID){
    //console.log("linkEntities")
    var childE = await getSub(childID, "su", dynamodb);
    var parentE = await getSub(parentID, "su", dynamodb);

    const eParent = await getEntity(parentE.Items[0].e, dynamodb)
    const eChild = await getEntity(childE.Items[0].e, dynamodb)

    var detailsChild = await addVersion(childE.Items[0].e, "o", parentE.Items[0].e, eChild.Items[0].c, dynamodb);
    var updateEntityC = await updateEntity(childE.Items[0].e, "o", parentE.Items[0].e, detailsChild.v, detailsChild.c, dynamodb)

    var detailsParent = await addVersion(parentE.Items[0].e, "l", childE.Items[0].e, eParent.Items[0].c, dynamodb);
    var updateEntityP = await updateEntity(parentE.Items[0].e, "l", childE.Items[0].e, detailsParent.v, detailsParent.c, dynamodb)

    return "success"
}

async function route (req, res, next, privateKey, dynamodb, uuidv4, s3){
   // console.log("route")
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);
    const reqPath = req.apiGateway.event.path.split("?")[0]
    const action = reqPath.split("/")[2]
    const requestBody = req.body;  
    var response = {}
    var actionFile = ""
    var mainObj = {}
    if (req.method === 'GET' || req.method === 'POST'){
        if (action === "get"){
            //console.log("get")
            const fileID = reqPath.split("/")[3]
            actionFile = fileID
            mainObj = await convertToJSON(fileID, [], null, null, dynamodb, uuidv4)
        } else if (action == "add") {
            //console.log("add")
            const fileID = reqPath.split("/")[3]
            const newEntityName = reqPath.split("/")[4]
            const headUUID = reqPath.split("/")[5]
            const parent = await getSub(fileID, "su", dynamodb);
            setIsPublic(parent.Items[0].z)
            const eParent = await getEntity(parent.Items[0].e, dynamodb)
            const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
            const aNew = await incrementCounterAndGetNewValue('wCounter', dynamodb);
            const a = await createWord(aNew.toString(), newEntityName, dynamodb);
            const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);
            const result = await createEntity(e.toString(), a.toString(), details.v, eParent.Items[0].g, eParent.Items[0].h, dynamodb);
            const uniqueId = await uuidv4();
            let subRes = await createSubdomain(uniqueId,a.toString(),e.toString(), "0", false, dynamodb)
            const fileResult = await createFile(uniqueId, {}, s3)
            actionFile = uniqueId
            const details2 = await addVersion(parent.Items[0].e.toString(), "t", e.toString(), eParent.Items[0].c, dynamodb);
            const updateParent = await updateEntity(parent.Items[0].e.toString(), "t", e.toString(), details2.v, details2.c, dynamodb);
            const details22 = await addVersion(e.toString(), "f", parent.Items[0].e.toString(), "1", dynamodb);
            const updateParent22 = await updateEntity(e.toString(), "f", parent.Items[0].e.toString(), details22.v, details22.c, dynamodb);
            const group = eParent.Items[0].g
            const details3 = await addVersion(e.toString(), "g", group, "1", dynamodb);
            const updateParent3 = await updateEntity(e.toString(), "g", group, details3.v, details3.c, dynamodb);
            mainObj = await convertToJSON(headUUID, [], null, null, dynamodb, uuidv4)
        } else if (action === "link"){
            //console.log("link")
            const childID = reqPath.split("/")[3]
            const parentID = reqPath.split("/")[4]
            await linkEntities(childID, parentID)
            mainObj = await convertToJSON(childID, [], null, null, dynamodb, uuidv4)
        } else if (action === "newGroup"){
            //console.log("newGroup")
            const newGroupName = reqPath.split("/")[3]
            const headEntityName = reqPath.split("/")[4]
            setIsPublic(false)
            const aNewG = await incrementCounterAndGetNewValue('wCounter', dynamodb);
            const aG = await createWord(aNewG.toString(), newGroupName, dynamodb);
            const aNewE = await incrementCounterAndGetNewValue('wCounter', dynamodb);
            const aE = await createWord(aNewE.toString(), headEntityName, dynamodb);
            const gNew = await incrementCounterAndGetNewValue('gCounter', dynamodb);
            const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
            const groupID = await createGroup(gNew.toString(), aNewG, e.toString(), dynamodb);
            const uniqueId = await uuidv4();
            //console.log(uniqueId, "0", "0", )
            let subRes = await createSubdomain(uniqueId,"0","0",gNew.toString(), false, dynamodb)
            const details = await addVersion(e.toString(), "a", aE.toString(), null, dynamodb);
            const result = await createEntity(e.toString(), aE.toString(), details.v, gNew.toString(), e.toString(), dynamodb); //DO I NEED details.c
            const uniqueId2 = await uuidv4();
            const fileResult = await createFile(uniqueId2, {}, s3)
            actionFile = uniqueId2
            let subRes2 = await createSubdomain(uniqueId2,aE.toString(),e.toString(),"0", false, dynamodb)
            mainObj  = await convertToJSON(uniqueId2, [], null, null, dynamodb, uuidv4)
        } else if (action === "useGroup"){
            console.log("useGroup")
            actionFile = reqPath.split("/")[3]
            const newUsingName = reqPath.split("/")[3]
            console.log("newUsingName",newUsingName)
            const headUsingName = reqPath.split("/")[4]
            console.log("headUsingName",headUsingName)
            const using = await getSub(newUsingName, "su", dynamodb);
            console.log("using",using)
            const ug = await getEntity(using.Items[0].e, dynamodb)
            console.log("ug",ug)
            const used = await getSub(headUsingName, "su", dynamodb);
            console.log("used",used)
            const ud = await getEntity(used.Items[0].e, dynamodb)
            console.log("ud",ud)
            const details2 = await addVersion(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), ug.Items[0].c, dynamodb);
            console.log("details2", details2)
            const updateParent = await updateEntity(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), details2.v, details2.c, dynamodb);
            console.log("updateParent", updateParent)
            const headSub = await getSub(ug.Items[0].h, "e", dynamodb);
            console.log("headSub", headSub)
            mainObj  = await convertToJSON(headSub.Items[0].su, [], null, null, dynamodb, uuidv4)
            console.log("mainObj", mainObj)
        } else if (action === "map"){
            //console.log("map")
            const referencedParent = reqPath.split("/")[3]
            const newEntityName = reqPath.split("/")[4]
            const mappedParent = reqPath.split("/")[5]
            const headEntity = reqPath.split("/")[6]
            const subRefParent = await getSub(referencedParent, "su", dynamodb);
            setIsPublic(subRefParent.Items[0].z);
            console.log("mappedParent",mappedParent)
            const subMapParent = await getSub(mappedParent, "su", dynamodb);
            console.log("subMapParent",subMapParent)
            const mpE = await getEntity(subMapParent.Items[0].e, dynamodb)
            const mrE = await getEntity(subRefParent.Items[0].e, dynamodb)
            const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
            const aNew = await incrementCounterAndGetNewValue('wCounter', dynamodb);
            const a = await createWord(aNew.toString(), newEntityName, dynamodb);
            const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);
            const result = await createEntity(e.toString(), a.toString(), details.v, mpE.Items[0].g, mpE.Items[0].h, dynamodb);
            const uniqueId = await uuidv4();
            let subRes = await createSubdomain(uniqueId,a.toString(),e.toString(), "0", false, dynamodb)
            const fileResult = await createFile(uniqueId, {}, s3)
            actionFile = uniqueId
            let newM = {}
            newM[mrE.Items[0].e] = e.toString()
            const details2a = await addVersion(mpE.Items[0].e.toString(), "m", newM, mpE.Items[0].c, dynamodb);
            let addM = {}
            addM[mrE.Items[0].e] = [e.toString()]
            const updateParent = await updateEntity(mpE.Items[0].e.toString(), "m", addM, details2a.v, details2a.c, dynamodb);
            mainObj  = await convertToJSON(headEntity, [], null, null, dynamodb, uuidv4)
        } else if (action === "extend"){

            const fileID = reqPath.split("/")[3]
            const newEntityName = reqPath.split("/")[4]
            const headUUID = reqPath.split("/")[5]
            const parent = await getSub(fileID, "su", dynamodb);
            setIsPublic(parent.Items[0].z)
            
            const eParent = await getEntity(parent.Items[0].e, dynamodb)

            const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
            const aNew = await incrementCounterAndGetNewValue('wCounter', dynamodb);
            const a = await createWord(aNew.toString(), newEntityName, dynamodb);

            const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);
            const result = await createEntity(e.toString(), a.toString(), details.v, eParent.Items[0].g, eParent.Items[0].h, dynamodb);

            const uniqueId = await uuidv4();
            let subRes = await createSubdomain(uniqueId,a.toString(),e.toString(), "0", false, dynamodb)

            const fileResult = await createFile(uniqueId, {}, s3)
            actionFile = uniqueId
            
            //copy parent
            const updateList = eParent.Items[0].t
            for (u in updateList){
                
                const details24 = await addVersion(updateList[u], "-f", eParent.Items[0].e, "1", dynamodb);
                const updateParent24 = await updateEntity(updateList[u], "-f", eParent.Items[0].e, details24.v, details24.c, dynamodb);

                const details25 = await addVersion(eParent.Items[0].e, "-t", updateList[u], "1", dynamodb); 
                const updateParent25 = await updateEntity(eParent.Items[0].e, "-t", updateList[u], details25.v, details25.c, dynamodb);
                //
                const details26 = await addVersion(updateList[u], "f", e.toString(), "1", dynamodb);
                const updateParent26 = await updateEntity(updateList[u], "f", e.toString(), details26.v, details26.c, dynamodb);

                const details27 = await addVersion(e.toString(), "t", updateList[u], "1", dynamodb); 
                const updateParent27 = await updateEntity(e.toString(), "t", updateList[u], details27.v, details27.c, dynamodb);
            }


            const details28 = await addVersion(eParent.Items[0].e, "t", e.toString(), "1", dynamodb); 
            const updateParent28 = await updateEntity(eParent.Items[0].e, "t", e.toString(), details28.v, details28.c, dynamodb);


            const group = eParent.Items[0].g
            const details3 = await addVersion(e.toString(), "g", group, "1", dynamodb);
            const updateParent3 = await updateEntity(e.toString(), "g", group, details3.v, details3.c, dynamodb);
            mainObj = await convertToJSON(headUUID, [], null, null, dynamodb, uuidv4)

        } else if (action === "reqPut"){
            actionFile = reqPath.split("/")[3]
            fileCategory = reqPath.split("/")[4]
            fileType = reqPath.split("/")[5]
            const subBySU = await getSub(actionFile, "su", dynamodb);
            setIsPublic(subBySU.Items[0].z)
            mainObj = await convertToJSON(actionFile, [], null, null, dynamodb, uuidv4)
        } else if (action === "file"){
            //console.log("file")
            actionFile = reqPath.split("/")[3]
            mainObj = await convertToJSON(actionFile, [], null, null, dynamodb, uuidv4)

        } else if (action === "saveFile"){
            //console.log("saveFile")
            actionFile = reqPath.split("/")[3]
            mainObj = await convertToJSON(actionFile, [], null, null, dynamodb, uuidv4)
            const fileResult = await createFile(actionFile, req.body.body, s3)
        } else if (action === "makePublic"){
            actionFile = reqPath.split("/")[3]
            let permission = reqPath.split("/")[4]
            const permStat = await updateSubPermission(actionFile, permission, dynamodb, s3)
            console.log("permStat", permStat)
            mainObj = await convertToJSON(actionFile, [], null, null, dynamodb, uuidv4)
        }

        mainObj["file"] = actionFile + ""
        response = mainObj

        if (action == "file"){
            //console.log("file2")
            const expires = 60;
            const url = "https://"+fileLocation(isPublic)+".1var.com/"+actionFile;
            const policy = JSON.stringify({Statement: [{Resource: url,Condition: { DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + expires) / 1000) }}}]});
            if (req.type === 'url'){
                const signedUrl = signer.getSignedUrl({
                    url: url,
                    policy: policy
                });
                res.json({ signedUrl: signedUrl });
            } else {
                const cookies = signer.getSignedCookie({policy: policy});
                for (const cookieName in cookies) {
                    res.cookie(cookieName, cookies[cookieName], { maxAge: expires, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
                }
                res.json({"ok":true,"response":response});
            }   
        } else {
            res.json({"ok":true,"response":response});
        }

        if (action == "reqPut"){
            const bucketName = fileLocation(isPublic)+'.1var.com';
            const fileName = actionFile;
            const expires = 60;

            const params = {
                Bucket: bucketName,
                Key: fileName,
                Expires: expires,
                ContentType: fileCategory+'/'+fileType
            };

            s3.getSignedUrl('putObject', params, (error, url) => {
                if (error) {
                    res.status(500).json({ error: 'Error generating presigned URL' });
                } else {
                    response.putURL = url
                    res.json({"ok":true,"response":response});
                }
            });
        }
    } else {
        res.json({})
    }
}

function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3) {
    router.use(bodyParser.json());
    
    router.all('/*', async function(req, res, next) {
        route (req, res, next, privateKey, dynamodb, uuidv4, s3)
    });

    return router;
}

module.exports = {
    setupRouter,
    getHead,
    convertToJSON
}