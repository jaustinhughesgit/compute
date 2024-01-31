var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');
const bodyParser = require('body-parser');
var router = express.Router();
const keyPairId = 'K2LZRHRSYZRU3Y'; 
let convertCounter = 0
let isPublic = true

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
    console.log("getEntity", e)
    params = { TableName: 'entities', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: {':e': e} };
    return await dynamodb.query(params).promise()
}

async function getGroup(g, dynamodb){
    console.log("getGroup", g)
    params = { TableName: 'groups', KeyConditionExpression: 'g = :g', ExpressionAttributeValues: {':g': g} };
    return await dynamodb.query(params).promise()
}

async function getAccess(ai, dynamodb){
    console.log("getAccess", ai)
    params = { TableName: 'access', KeyConditionExpression: 'ai = :ai', ExpressionAttributeValues: {':ai': ai} };
    return await dynamodb.query(params).promise()
}

async function getVerified(key, val, dynamodb){
    console.log("getVerified", key, val)
    let params
    if (key == "vi"){
        params = { TableName: 'verified', KeyConditionExpression: 'vi = :vi', ExpressionAttributeValues: {':vi': val} };
    } else if (key == "ai"){
        params = { TableName: 'verified',IndexName: 'aiIndex',KeyConditionExpression: 'ai = :ai',ExpressionAttributeValues: {':ai': val} }
    } else if (key == "gi"){
        params = { TableName: 'verified',IndexName: 'giIndex',KeyConditionExpression: 'gi = :gi',ExpressionAttributeValues: {':gi': val} }
    }
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

async function convertToJSON(fileID, parentPath = [], isUsing, mapping, cookie, dynamodb, uuidv4, pathID, parentPath2 = [], id2Path = {}, usingID = "") {
    console.log("convertToJSON")
    const subBySU = await getSub(fileID, "su", dynamodb);
    console.log("subBySU:fileID", fileID, subBySU)
    setIsPublic(subBySU.Items[0].z);
    const entity = await getEntity(subBySU.Items[0].e, dynamodb)
    console.log("entity", entity)
    const group = await getGroup(entity.Items[0].g, dynamodb)
    console.log("group", group)
    const access = await getAccess(group.Items[0].ai, dynamodb)
    console.log("access", access)
    const verify = await getVerified("gi", cookie.gi.toString(), dynamodb)
    console.log("verified", verify)
    let verified = false;
    console.log("subBySU.Items[0].z", subBySU.Items[0].z)
    for (veri in verify.Items){
        console.log("veri", veri, verify.Items[veri])
        if ((verify.Items[veri].ai == group.Items[0].ai && verify.Items[veri].bo) || group.Items[0].ai.toString() == "0"){
            console.log("VERIFIED")
            verified = true;
        }
        
    }
    console.log("entity.Items[0].ai",entity.Items[0].ai)
    console.log("verified == ", verified)
    if (entity.Items[0].ai.toString() != "0" && verified == true){
        console.log("???????")
        verified = false
        for (veri in verify.Items){
            console.log("veri22", veri, verify.Items[veri])
            if ((verify.Items[veri].ai == entity.Items[0].ai && verify.Items[veri].bo)){
                console.log("DOUBLE VERIFIED")
                verified = true;
            }
            
        }
    }

    if (subBySU.Items[0].z){
        console.log("NO VERIFICATION NEEDED : IS PUBLIC")
        verified = true;
    }

    if (verified){
        console.log("ALL GOOD!")
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
        pathID = await getUUID(uuidv4)
        console.log("entity.Items[0].h",entity.Items[0].h)
        let subH = await getSub(entity.Items[0].h, "e", dynamodb)
        console.log("subH", subH)
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

                    childResponse = await convertToJSON(uuid, paths[fileID], false, mapping, cookie, dynamodb, uuidv4, pathID, paths2[pathID], id2Path, usingID);
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
            const headUsingObj  = await convertToJSON(subOfHead.Items[0].su, paths[fileID], true, entity.Items[0].m, cookie, dynamodb, uuidv4, pathID, paths2[pathID], id2Path, usingID)
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
                let linkResponse = await convertToJSON(uuid, paths[fileID], false, null, cookie, dynamodb, uuidv4, pathID, paths2[pathID], id2Path, usingID);
                Object.assign(obj[fileID].linked, linkResponse.obj);
                Object.assign(paths, linkResponse.paths);
                Object.assign(paths2, linkResponse.paths2);
            }
        }
        
        let groupList = await getGroups(dynamodb)

        return { obj: obj, paths: paths, paths2: paths2, id2Path:id2Path, groups:groupList };
    } else {
        return { obj: {}, paths: {}, paths2: {}, id2Path: {}, groups: {}, verified: false }
        //NEED TO PROVIDE BACK WHAT THE USER IS ALLOWED TO VIEW, like the Groups they have, AND ALSO MAKE SURE NO ERRORS HAPPEN FROM SENDING BACK {} FOR obj, paths, paths2 and id2Path
    }
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
    } else if (col === "t" || col === "f" || col === "l" || col === "o"){
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
    console.log("by, value", by, value)
    const subBySU = await getSub(value, by, dynamodb);
    console.log("subBySU", subBySU)
    const entity = await getEntity(subBySU.Items[0].e, dynamodb)
    console.log("entity", entity)
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

const createGroup = async (gid, groupNameID, entityID, ai, dynamodb) => {
    //console.log("createGroup")

    await dynamodb.put({
        TableName: 'groups',
        Item: {
            g: gid,
            a: groupNameID,
            e: entityID,
            ai: ai
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

const createEntity = async (e, a, v, g, h, ai, dynamodb) => {
    //console.log("createEntity")
    if (!ai){
        ai = "0"
    }
    const params = {
        TableName: 'entities',
        Item: { e: e, a: a, v: v, g: g, h: h, ai: ai }
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

        const versions = await s3.listObjectVersions({
            Bucket: sourceBucket,
            Prefix: file
        }).promise();

        console.log("versions", versions)

        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        for (let x = versions.Versions.length - 1; x >= 0; x--) {
            const version = versions.Versions[x];
        
            // Retrieve current metadata
            let originalMetadata = await s3.headObject({
                Bucket: sourceBucket,
                Key: file,
                VersionId: version.VersionId
            }).promise();
        
            // Prepare new metadata with additional custom data
            let newMetadata = {
                ...originalMetadata.Metadata, // Copy original user-defined metadata
                'originalVersionId': version.VersionId // Add your custom metadata
            };
        
            // Copy the object with the original 'Content-Type'
            await s3.copyObject({
                Bucket: destinationBucket,
                CopySource: `${sourceBucket}/${file}?versionId=${version.VersionId}`,
                Key: file,
                Metadata: newMetadata,
                ContentType: originalMetadata.ContentType, // Set the original 'Content-Type'
                MetadataDirective: "REPLACE"
            }).promise();
        
            // Optionally, delete the original version
            await s3.deleteObject({
                Bucket: sourceBucket,
                Key: file,
                VersionId: version.VersionId
            }).promise();
        
            // Wait for 1 second before processing the next version
            await delay(1000);
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

async function email(from, to, subject, emailText, emailHTML, ses){
    const params = {
        Source: from, //noreply@email.1var.com
        Destination: {
            ToAddresses: [
                to
            ] //'austin@1var.com'
        },
        Message: {
            Subject: {
                Data: subject
            },
            Body: {
                Text: {
                    Data: emailText
                },
                Html: {
                    Data: emailHTML
                }
            }
        }
    };

    try {
        const data = await ses.sendEmail(params).promise();
        console.log('Email sent:', data);
        return { statusCode: 200, body: JSON.stringify(data) };
    } catch (error) {
        console.error('Error sending email:', error);
        return { statusCode: 500, body: JSON.stringify(error) };
    }
}

async function createCookie(ci, gi, ex, ak){
    return await dynamodb.put({
        TableName: 'cookies',
        Item: { "ci": ci, "gi": gi, "ex": ex, "ak": ak}
    }).promise();
}

async function getCookie(val, key){
    if (key == "ci"){
        params = { TableName: 'cookies', KeyConditionExpression: 'ci = :ci', ExpressionAttributeValues: {':ci': val} };
    } else if (key == "ak"){
        params = { TableName: 'cookies',IndexName: 'akIndex',KeyConditionExpression: 'ak = :ak',ExpressionAttributeValues: {':ak': val} }
    } else if (key == "gi"){
        params = { TableName: 'cookies',IndexName: 'giIndex',KeyConditionExpression: 'gi = :gi',ExpressionAttributeValues: {':gi': val} }
    }
    return await dynamodb.query(params).promise()
}

async function manageCookie(mainObj, req, res, dynamodb, uuidv4){
    console.log("req1",req)
    console.log("req2",req.apiGateway)
    console.log("req3",req.apiGateway.event)
    console.log("req4",req.apiGateway.event.body)
    let headersJSON = JSON.parse(req.apiGateway.event.body);
    console.log("req5", headersJSON.headers)
    if (headersJSON.headers.hasOwnProperty("X-accessToken")){
        mainObj["status"] = "authenticated";
        let val = headersJSON.headers["X-accessToken"];
        let cookie = await getCookie(val, "ak")
        console.log("cookie",cookie.Items[0])
        return cookie.Items[0]
    } else {
        console.log("1")
        const ak = await getUUID(uuidv4)
        console.log("2")
        const ci = await incrementCounterAndGetNewValue('ciCounter', dynamodb);
        console.log("3")
        const gi = await incrementCounterAndGetNewValue('giCounter', dynamodb);
        console.log("4")
        const ttlDurationInSeconds = 90000; // For example, 1 hour
        const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
        console.log("createCookie", ci.toString(), gi.toString(), ex, ak)
        await createCookie(ci.toString(), gi.toString(), ex, ak)
        mainObj["accessToken"] = ak;
        res.cookie('accessToken', ak, {
            domain: '.1var.com',
            maxAge: ex,
            httpOnly: true, // Inaccessible to client-side JS
            secure: true, // Only sent over HTTPS
            sameSite: 'None' // Can be 'Lax', 'Strict', or 'None'. 'None' requires 'secure' to be true.
        });
        return {"ak":ak, "gi":gi, "ex":ex, "ci":ci}
    }
}

async function createAccess (ai, g, e, ex, at, to, va) {
    console.log("access", ai, g, e, ex, at, to, va)
    return await dynamodb.put({
        TableName: 'access',
        Item: { ai: ai, g: g, e: e, ex: ex, at: at, to: to, va: va}
    }).promise();
}

async function createVerified(vi, gi, g, e, ai, va, ex, bo, at, ti){
    console.log("createVerified",vi, gi, g, e, ai, va, ex, bo, at, ti)
    return await dynamodb.put({
        TableName: 'verified',
        Item: { vi: vi, gi: gi, g:g, e:e, ai:ai, va:va, ex:ex, bo:bo, at:at, ti:ti}
    }).promise();
}

async function getUUID(uuidv4){
    let uniqueId = await uuidv4();
    return "1v4r" + uniqueId
}

function allVerified(list){
    let v = true
    for (l in list){
        console.log("list:1", list[l])
        if (list[l] != true){
            console.log("false")
            v = false
        }
    }
    console.log("v", v)
    return v
}

async function verifyPath(splitPath, verifications, dynamodb){
    let verified = [];
    let verCounter = 0;
    for (ver in splitPath){
        if (splitPath[ver].startsWith("1v4r")){
            let verValue = false
            verified.push(false)
            for (veri in verifications.Items){
                const sub = await getSub(splitPath[ver], "su", dynamodb);
                console.log("^^^^^^^^^^^^^^^^^^^^^^^^")
                console.log("sub", sub)
                let groupID = sub.Items[0].g
                let entityID = sub.Items[0].e
                console.log("groupID",groupID)
                console.log("entityID",entityID)
                if (sub.Items[0].z){
                    verValue = true
                }

                if (entityID != "0"){
                    console.log("entityID!=0")
                    let eSub = await getEntity(sub.Items[0].e, dynamodb)
                    console.log("eSub",eSub)
                    groupID = eSub.Items[0].g
                    console.log("eSub.Items[0].ai",eSub.Items[0].ai)
                    if (eSub.Items[0].ai.toString() == "0"){
                        verValue = true
                        console.log("verValue1", verValue)
                    }
                    console.log("groupID2",groupID)
                }
                
                if (sub.Items.length > 0){
                    console.log("entityID3", entityID)
                    console.log("groupID3", groupID)
                    if (sub.Items[0].z == true){
                        verValue = true
                    } else if (entityID == verifications.Items[veri].e && verifications.Items[veri].bo){
                        const ex = Math.floor(Date.now() / 1000);
                        if (ex < verifications.Items[veri].ex){
                            verValue = true
                        }
                    } else if (groupID == verifications.Items[veri].g && verifications.Items[veri].bo){
                        const ex = Math.floor(Date.now() / 1000);
                        if (ex < verifications.Items[veri].ex){
                            verValue = true
                        }
                    } else if (entityID == "0" && groupID == "0"){
                        //MAYBE THIS IS NOT NEEDED. ADDED IT BUT NEVER TESTED IT
                        console.log("e and g are 0 so verValue is true")
                        verValue = true;
                    }
                }
            }
            console.log("verValue", verValue)
            verified[verCounter] = verValue
            verCounter++;
            console.log("verCounter", verCounter)
        }
    }
    console.log("verified", verified)
    return verified
}
//
//
//
//
//WE NEED TO MODIFY ALL INSTANCES OF req...path TO ONLY GET PATH FROM X-Original-Host
//
//
//
//



async function route (req, res, next, privateKey, dynamodb, uuidv4, s3, ses){
    console.log("route", req)
    console.log("req.body", req.body)
    console.log("req.headers", req.headers)
    let originalHost = req.body.headers["X-Original-Host"]
    let splitOriginalHost = originalHost.split("1var.com")[1]
    const computeUrl = `https://compute.1var.com${splitOriginalHost}`;
    const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);
    const reqPath = splitOriginalHost.split("?")[0]
    const action = reqPath.split("/")[2]
    const requestBody = req.body;  
    var response = {}
    var actionFile = ""
    var mainObj = {}
    if (req.method === 'GET' || req.method === 'POST'){

        let cookie =  await manageCookie(mainObj, req, res, dynamodb, uuidv4)
        const verifications = await getVerified("gi", cookie.gi.toString(), dynamodb)
        let splitPath = reqPath.split("/")
        let verified = await verifyPath(splitPath, verifications, dynamodb);
        


        if (allVerified(verified)){
            if (action === "get"){
                //console.log("get")
                const fileID = reqPath.split("/")[3]
                actionFile = fileID
                mainObj = await convertToJSON(fileID, [], null, null, cookie, dynamodb, uuidv4)
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
                const result = await createEntity(e.toString(), a.toString(), details.v, eParent.Items[0].g, eParent.Items[0].h, "0", dynamodb);
                const uniqueId = await getUUID(uuidv4)
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
                mainObj = await convertToJSON(headUUID, [], null, null, cookie, dynamodb, uuidv4)
            } else if (action === "link"){
                //console.log("link")
                const childID = reqPath.split("/")[3]
                const parentID = reqPath.split("/")[4]
                await linkEntities(childID, parentID)
                mainObj = await convertToJSON(childID, [], null, null, cookie, dynamodb, uuidv4)
            } else if (action === "newGroup"){
                //console.log("newGroup")
                if (cookie != undefined) {
                    const newGroupName = reqPath.split("/")[3]
                    const headEntityName = reqPath.split("/")[4]
                    setIsPublic(true)
                    console.log("A")
                    const aNewG = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                    console.log("B")
                    const aG = await createWord(aNewG.toString(), newGroupName, dynamodb);
                    console.log("C")
                    const aNewE = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                    console.log("D")
                    const aE = await createWord(aNewE.toString(), headEntityName, dynamodb);
                    console.log("E")
                    const gNew = await incrementCounterAndGetNewValue('gCounter', dynamodb);
                    console.log("F")
                    const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
                    console.log("G")
                    const ai = await incrementCounterAndGetNewValue('aiCounter', dynamodb);
                    console.log("H")
                    const access = await createAccess(ai.toString(), gNew.toString(), "0", {"count":1, "metric":"year"}, 10, {"count":1, "metric":"minute"}, )
                    console.log("I")
                    const ttlDurationInSeconds = 90000; // For example, 1 hour
                    console.log("J")
                    const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
                    console.log("K")
                    const vi = await incrementCounterAndGetNewValue('viCounter', dynamodb);
                    console.log("L")
                    console.log("vi", vi)
                    //await createVerified(vi.toString(), cookie.gi.toString(), gNew.toString(), "0", ai.toString(), "0", ex, true, 0, 0)

                    const groupID = await createGroup(gNew.toString(), aNewG, e.toString(), ai.toString(), dynamodb);
                    const uniqueId = await getUUID(uuidv4)
                    //console.log(uniqueId, "0", "0", )
                    let subRes = await createSubdomain(uniqueId,"0","0",gNew.toString(), true, dynamodb)
                    const details = await addVersion(e.toString(), "a", aE.toString(), null, dynamodb);
                    const result = await createEntity(e.toString(), aE.toString(), details.v, gNew.toString(), e.toString(), ai.toString(), dynamodb); //DO I NEED details.c
                    const uniqueId2 = await getUUID(uuidv4)
                    const fileResult = await createFile(uniqueId2, {}, s3)
                    actionFile = uniqueId2
                    let subRes2 = await createSubdomain(uniqueId2,aE.toString(),e.toString(),"0", true, dynamodb)
                    console.log("ses",ses)
                    let from = "noreply@email.1var.com"
                    let to = "austin@1var.com"
                    let subject = "1 VAR - Email Address Verification Request"
                    let emailText = "Dear 1 Var User, \n\n We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. \n\n http://1var.com/verify/"+uniqueId
                    let emailHTML = "Dear 1 Var User, <br><br> We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. <br><br> http://1var.com/verify/"+uniqueId
                    //let emailer = await email(from, to, subject, emailText, emailHTML, ses)  //COMMENTED OUT BECAUSE WE ONLY GET 200 EMAILS IN AMAZON SES.
                    //console.log(emailer)
                    mainObj  = await convertToJSON(uniqueId2, [], null, null, cookie, dynamodb, uuidv4)
                }
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
                mainObj  = await convertToJSON(headSub.Items[0].su, [], null, null, cookie, dynamodb, uuidv4)
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
                const result = await createEntity(e.toString(), a.toString(), details.v, mpE.Items[0].g, mpE.Items[0].h, "0", dynamodb);
                const uniqueId = await getUUID(uuidv4)
                let subRes = await createSubdomain(uniqueId,a.toString(),e.toString(), "0", false, dynamodb)
                const fileResult = await createFile(uniqueId, {}, s3)
                actionFile = uniqueId
                let newM = {}
                newM[mrE.Items[0].e] = e.toString()
                const details2a = await addVersion(mpE.Items[0].e.toString(), "m", newM, mpE.Items[0].c, dynamodb);
                let addM = {}
                addM[mrE.Items[0].e] = [e.toString()]
                const updateParent = await updateEntity(mpE.Items[0].e.toString(), "m", addM, details2a.v, details2a.c, dynamodb);
                mainObj  = await convertToJSON(headEntity, [], null, null, cookie, dynamodb, uuidv4)
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
                const result = await createEntity(e.toString(), a.toString(), details.v, eParent.Items[0].g, eParent.Items[0].h, "0", dynamodb);

                const uniqueId = await getUUID(uuidv4)
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
                mainObj = await convertToJSON(headUUID, [], null, null, cookie, dynamodb, uuidv4)

            } else if (action === "reqPut"){
                actionFile = reqPath.split("/")[3]
                fileCategory = reqPath.split("/")[4]
                fileType = reqPath.split("/")[5]
                const subBySU = await getSub(actionFile, "su", dynamodb);
                setIsPublic(subBySU.Items[0].z)
                console.log("subBySU",subBySU)
                console.log("actionFile",actionFile)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4)
            } else if (action === "file"){
                //console.log("file")
                actionFile = reqPath.split("/")[3]
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4)

            } else if (action === "saveFile"){
                //console.log("saveFile")
                actionFile = reqPath.split("/")[3]
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4)
                console.log("req", req)
                console.log("req.body", req.body)
                const fileResult = await createFile(actionFile, req.body.body, s3)
            } else if (action === "makePublic"){
                actionFile = reqPath.split("/")[3]
                let permission = reqPath.split("/")[4]
                const permStat = await updateSubPermission(actionFile, permission, dynamodb, s3)
                console.log("permStat", permStat)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4)
            }


            

            mainObj["file"] = actionFile + ""
            response = mainObj

            if (action === "file"){
                //console.log("file2")
                const expires = 90000;
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
            } else if (action === "reqPut"){
                const bucketName = fileLocation(isPublic)+'.1var.com';
                const fileName = actionFile;
                const expires = 90000;

                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Expires: expires,
                    ContentType: fileCategory+'/'+fileType
                };
                console.log("params", params)
                s3.getSignedUrl('putObject', params, (error, url) => {
                    if (error) {
                        res.status(500).json({ error: 'Error generating presigned URL' });
                    } else {
                        console.log("preSigned URL:", url)
                        response.putURL = url
                        res.json({"ok":true,"response":response});
                    }
                });
            } else {
                console.log("returning", {"ok":true,"response":response})
                console.log("res",res)
                res.json({"ok":true,"response":response});
            }
        } else {
            res.json({})
        }
    } else {
        res.json({})
    }
}

function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses) {
    router.use(bodyParser.json());
    
    router.all('/*', async function(req, res, next) {
        route (req, res, next, privateKey, dynamodb, uuidv4, s3, ses)
    });

    return router;
}

module.exports = {
    setupRouter,
    getHead,
    convertToJSON,
    manageCookie
}