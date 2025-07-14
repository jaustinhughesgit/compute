//cookies.js ---------------------
var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');
var router = express.Router();
const moment = require('moment-timezone')
const { promisify } = require('util');
const getSignedUrlAsync = promisify(s3.getSignedUrl.bind(s3));   // v2 SDK -> promise
const { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand } = require("@aws-sdk/client-scheduler");
const keyPairId = 'K2LZRHRSYZRU3Y';
let convertCounter = 0
let isPublic = true
async function getSub(val, key, dynamodb) {
    //console.log("getSub", val, key)
    let params
    if (key == "su") {
        params = { TableName: 'subdomains', KeyConditionExpression: 'su = :su', ExpressionAttributeValues: { ':su': val } };
    } else if (key === "e") {
        params = { TableName: 'subdomains', IndexName: 'eIndex', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': val } }
    } else if (key === "a") {
        params = { TableName: 'subdomains', IndexName: 'aIndex', KeyConditionExpression: 'a = :a', ExpressionAttributeValues: { ':a': val } }
    } else if (key === "g") {
        params = { TableName: 'subdomains', IndexName: 'gIndex', KeyConditionExpression: 'g = :g', ExpressionAttributeValues: { ':g': val } }
    }
    return await dynamodb.query(params).promise()
}
async function getEntity(e, dynamodb) {
    //console.log("inside getEntity", e)
    params = { TableName: 'entities', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': e } };
    return await dynamodb.query(params).promise()
}
async function getTasks(val, col, dynamodb) {
    if (col == "e") {
        const subByE = await getSub(groups.Items[group].e.toString(), "e", dynamodb);
        let params = { TableName: 'tasks', IndexName: 'urlIndex', KeyConditionExpression: 'url = :url', ExpressionAttributeValues: { ':url': subByE.Items[0].su } }
        return await dynamodb.query(params).promise()
    } else if (col == "su") {
        let params = { TableName: 'tasks', IndexName: 'urlIndex', KeyConditionExpression: '#url = :urlValue', ExpressionAttributeNames: { '#url': 'url', }, ExpressionAttributeValues: { ':urlValue': val } }
        return await dynamodb.query(params).promise()
    }
}
async function getTasksIOS(tasks) {
    tasks = tasks.Items
    let converted = []
    for (let task in tasks) {
        converted.push({})
        converted[task].url = tasks[task].url
        let momentSD = moment.unix(tasks[task].sd).utc()
        converted[task].startDate = momentSD.format("YYYY-MM-DD")
        let momentED = moment.unix(tasks[task].ed).utc()
        converted[task].endDate = momentED.format("YYYY-MM-DD")
        let momentST = moment.unix(tasks[task].sd + tasks[task].st).utc()
        converted[task].startTime = momentST.format("HH:mm")
        let momentET = moment.unix(tasks[task].sd + tasks[task].et).utc()
        converted[task].endTime = momentET.format("HH:mm")
        converted[task].monday = tasks[task].mo === 1;
        converted[task].tuesday = tasks[task].tu === 1;
        converted[task].wednesday = tasks[task].we === 1;
        converted[task].thursday = tasks[task].th === 1;
        converted[task].friday = tasks[task].fr === 1;
        converted[task].saturday = tasks[task].sa === 1;
        converted[task].sunday = tasks[task].su === 1;
        converted[task].zone = tasks[task].zo;
        converted[task].interval = tasks[task].it;
        converted[task].taskID = tasks[task].ti;
    }
    return converted
}
let cache = {
    getSub: {},
    getEntity: {},
    getWord: {},
    getGroup: {},
    getAccess: {},
    getVerified: {}
};
async function getGroup(g, dynamodb) {

    if (cache.getGroup[g]) {
        return cache.getGroup[g];
    }
    const params = {
        TableName: 'groups',
        KeyConditionExpression: 'g = :g',
        ExpressionAttributeValues: { ':g': g }
    };
    const result = await dynamodb.query(params).promise();
    cache.getGroup[g] = result;
    return result;
}
async function getAccess(ai, dynamodb) {

    if (cache.getAccess[ai]) {
        return cache.getAccess[ai];
    }
    const params = {
        TableName: 'access',
        KeyConditionExpression: 'ai = :ai',
        ExpressionAttributeValues: { ':ai': ai }
    };
    const result = await dynamodb.query(params).promise();
    cache.getAccess[ai] = result;
    return result;
}
async function getVerified(key, val, dynamodb) {

    let params;
    if (key === "vi") {
        params = {
            TableName: 'verified',
            KeyConditionExpression: 'vi = :vi',
            ExpressionAttributeValues: { ':vi': val }
        };
    } else if (key === "ai") {
        params = {
            TableName: 'verified',
            IndexName: 'aiIndex',
            KeyConditionExpression: 'ai = :ai',
            ExpressionAttributeValues: { ':ai': val }
        };
    } else if (key === "gi") {
        params = {
            TableName: 'verified',
            IndexName: 'giIndex',
            KeyConditionExpression: 'gi = :gi',
            ExpressionAttributeValues: { ':gi': val }
        };
    }
    const result = await dynamodb.query(params).promise();
    return result;
}
async function getWord(a, dynamodb) {

    if (cache.getWord[a]) {
        return cache.getWord[a];
    }
    const params = {
        TableName: 'words',
        KeyConditionExpression: 'a = :a',
        ExpressionAttributeValues: { ':a': a }
    };
    const result = await dynamodb.query(params).promise();
    cache.getWord[a] = result;
    return result;
}
async function getGroups(dynamodb) {

    const params = { TableName: 'groups' };
    const groups = await dynamodb.scan(params).promise();
    const groupObjs = [];
    const subPromises = [];
    const wordPromises = [];
    for (const group of groups.Items) {
        subPromises.push(getSub(group.g.toString(), "g", dynamodb));
        wordPromises.push(getWord(group.a.toString(), dynamodb));
    }
    const subResults = await Promise.all(subPromises);
    const wordResults = await Promise.all(wordPromises);
    for (let i = 0; i < groups.Items.length; i++) {
        const groupItem = groups.Items[i];
        const subByG = subResults[i];
        const groupName = wordResults[i];
        if (groupName.Items.length > 0) {
            const subByE = await getSub(groupItem.e.toString(), "e", dynamodb);
            groupObjs.push({
                "groupId": subByG.Items[0].su,
                "name": groupName.Items[0].r,
                "head": subByE.Items[0].su
            });
        }
    }
    return groupObjs;
}
function fileLocation(val) {

    let location = "private"
    if (val == "true" || val == true) {
        location = "public"
    }

    return location
}
function setIsPublic(val) {

    if (val == "true" || val == true) {
        isPublic = true
    } else {
        isPublic = false
    }
    return isPublic;
}
async function verifyThis(fileID, cookie, dynamodb, body) {

    const subBySU = await getSub(fileID, "su", dynamodb);
    const isPublic = setIsPublic(subBySU.Items[0].z);
    const entity = await getEntity(subBySU.Items[0].e, dynamodb);
    const group = await getGroup(entity.Items[0].g, dynamodb);
    const groupAi = group.Items[0].ai;
    const entityAi = entity.Items[0].ai;
    let verified = false;
    if (isPublic) {
        verified = true;
    } else {
        const verify = await getVerified("gi", cookie.gi.toString(), dynamodb, body);

        verified = verify.Items.some(veri => groupAi.includes(veri.ai) && veri.bo);



        if (!verified) {

            verified = verify.Items.some(veri => entityAi.includes(veri.ai) && veri.bo);

            let bb = {};
            if (body) {
                bb = JSON.parse(JSON.stringify(body));
            }
            if (bb.hasOwnProperty("body")) {

                bb = JSON.parse(JSON.stringify(body.body));
            }

            for (x = 0; x < entityAi.length; x++) {
                let access = await getAccess(entityAi[x], dynamodb);



                let deep = await deepEqual(access.Items[0].va, bb);

                if (deep == true && verified == false) {



                    let usingAuth = await useAuth(fileID, entity, access, cookie, dynamodb);

                    verified = true;
                }
            }

        }

    }




    return { verified, subBySU, entity, isPublic };
}
async function useAuth(fileID, Entity, access, cookie, dynamodb) {

    const ttlDurationInSeconds = 90000;
    const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
    const vi = await incrementCounterAndGetNewValue('viCounter', dynamodb);
    await createVerified(vi.toString(), cookie.gi.toString(), "0", Entity.Items[0].e.toString(), access.Items[0].ai.toString(), "0", ex, true, 0, 0)

    const details3 = await addVersion(Entity.Items[0].e.toString(), "ai", access.Items[0].ai.toString(), Entity.Items[0].c.toString(), dynamodb);
    const updateAuth = await updateEntity(Entity.Items[0].e.toString(), "ai", access.Items[0].ai.toString(), details3.v, details3.c, dynamodb);

    return true
}
const deepEqual = (value1, value2) => {
    if (value1 === value2) return true;
    if (Buffer.isBuffer(value1) && Buffer.isBuffer(value2)) {
        return Buffer.compare(value1, value2) === 0;
    }
    if (Array.isArray(value1) && Array.isArray(value2)) {
        if (value1.length !== value2.length) return false;
        return value1.every((item, index) => deepEqual(item, value2[index]));
    }
    if (typeof value1 === 'string' && typeof value2 === 'string') {
        if (isCSV(value1) && isCSV(value2)) {
            return deepEqual(parseCSV(value1), parseCSV(value2));
        }
    }
    if (isObject(value1) && isObject(value2)) {
        const keys1 = Object.keys(value1);
        const keys2 = Object.keys(value2);
        if (keys1.length !== keys2.length) return false;
        return keys1.every(key => deepEqual(value1[key], value2[key]));
    }
    return value1 === value2;
};
const isObject = (val) => val && typeof val === 'object' && !Array.isArray(val) && !Buffer.isBuffer(val);
const isCSV = (str) => str.includes(',') || str.includes('\n');
const parseCSV = (csv) => {
    return csv.trim().split('\n').map(row => row.split(',').map(cell => cell.trim()));
};
async function convertToJSON(
    fileID,
    parentPath = [],
    isUsing,
    mapping,
    cookie,
    dynamodb,
    uuidv4,
    pathID,
    parentPath2 = [],
    id2Path = {},
    usingID = "",
    dynamodbLL,
    body,
    substitutingID = ""
) {

    // we need to be able to replace the existing entity, not get the child of the substituted


    // else if (substituting) {
    //substitutingID = fileID;
    //const subOfHead = await getSub(entity.Items[0].u, "e", dynamodb);
    /*        const headSubstitutingObj = await convertToJSON(
                subOfHead.Items[0].su,
                newParentPath,
                true,
                entity.Items[0].m,
                cookie,
                dynamodb,
                uuidv4,
                pathUUID,
                newParentPath2,
                id2Path,
                usingID, dynamodbLL, body, substitutingID
            );
            const headKey = Object.keys(headSubstitutingObj.obj)[0];
            Object.assign(obj[fileID].children, headSubstitutingObj.obj[headKey].children);
            Object.assign(paths, headSubstitutingObj.paths);
            Object.assign(paths2, headSubstitutingObj.paths2);
            obj[fileID].meta["substitutingMeta"] = {
                "name": headSubstitutingObj.obj[headKey].meta.name,
                "head": headSubstitutingObj.obj[headKey].meta.head,
                "id": headKey,
                "pathid": pathUUID
            };
        }
    */
    //console.log("fileID", fileID)
    //console.log("cookie", cookie)
    //console.log("body", body)
    var { verified, subBySU, entity, isPublic } = await verifyThis(fileID, cookie, dynamodb, body);
    console.log("verified", verified)
    console.log("subBySU", subBySU)
    console.log("entity", entity)
    console.log("isPublic", isPublic)

    console.log("entity.Items[0].z", entity.Items[0].z)
    if (typeof entity.Items[0].z == "string") {
        const subByE = await getSub(entity.Items[0].z, "e", dynamodb);
        console.log("subByE", subByE)
        var veriThis = await verifyThis(subByE.Items[0].su, cookie, dynamodb, body)


        verified = veriThis.verified;
        subBySU = veriThis.subBySU;
        entity = veriThis.entity;
        isPublic = veriThis.isPublic;
        //NEED TO look into = await verifyThis(fileID, cookie, dynamodb, body);
        console.log("zzzzzzzzzz")
        console.log("zzzzzzzzzz")
        console.log("zzzzzzzzzz")
        console.log("zzzzzzzzzz")
        console.log("zzzzzzzzzz")
        console.log("verified", verified)
        console.log("subBySU", subBySU)
        console.log("entity", entity)
        console.log("isPublic", isPublic)
    }

    if (!verified) {
        return { obj: {}, paths: {}, paths2: {}, id2Path: {}, groups: {}, verified: false };
    }
    console.log("1")
    let children = mapping?.[subBySU.Items[0].e] || entity.Items[0].t;
    const linked = entity.Items[0].l;
    const head = await getWord(entity.Items[0].a, dynamodb);
    const name = head.Items[0].r;
    const pathUUID = await getUUID(uuidv4)
    const using = Boolean(entity.Items[0].u);
    const substituting = Boolean(entity.Items[0].u);
    const obj = {};
    const paths = {};
    const paths2 = {};
    console.log("2")




    if (id2Path == null) {
        id2Path = {}
    }
    if (parentPath2 == null) {
        parentPath2 = []
    }
    if (usingID == null) {
        usingID = ""
    }
    if (substitutingID == null) {
        substitutingID = ""
    }
    console.log("3")
    id2Path[fileID] = pathUUID;
    const subH = await getSub(entity.Items[0].h, "e", dynamodb);
    if (subH.Count === 0) {
        await sleep(2000);
    }
    console.log("4")
    obj[fileID] = {
        meta: {
            name: name,
            expanded: false,
            head: subH.Items[0].su
        },
        children: {},
        using: using,
        linked: {},
        pathid: pathUUID,
        usingID: usingID,
        substitutingID: substitutingID,
        location: fileLocation(isPublic),
        verified: verified
    };
    const newParentPath = isUsing ? [...parentPath] : [...parentPath, fileID];
    const newParentPath2 = isUsing ? [...parentPath2] : [...parentPath2, fileID];
    paths[fileID] = newParentPath;
    paths2[pathUUID] = newParentPath2;
    console.log("5")
    if (children && children.length > 0 && convertCounter < 1000) {
        convertCounter += children.length;
        const childPromises = children.map(async (child) => {
            const subByE = await getSub(child, "e", dynamodb);
            const uuid = subByE.Items[0].su;
            //console.log("returning children")
            return await convertToJSON(uuid, newParentPath, false, mapping, cookie, dynamodb, uuidv4, pathUUID, newParentPath2, id2Path, usingID, dynamodbLL, body, substitutingID);
        });
        const childResponses = await Promise.all(childPromises);
        for (const childResponse of childResponses) {
            Object.assign(obj[fileID].children, childResponse.obj);
            Object.assign(paths, childResponse.paths);
            Object.assign(paths2, childResponse.paths2);
        }
    }
    console.log("6")
    if (using) {
        usingID = fileID;
        const subOfHead = await getSub(entity.Items[0].u, "e", dynamodb);
        const headUsingObj = await convertToJSON(
            subOfHead.Items[0].su,
            newParentPath,
            true,
            entity.Items[0].m,
            cookie,
            dynamodb,
            uuidv4,
            pathUUID,
            newParentPath2,
            id2Path,
            usingID, dynamodbLL, body
        );
        const headKey = Object.keys(headUsingObj.obj)[0];
        Object.assign(obj[fileID].children, headUsingObj.obj[headKey].children);
        Object.assign(paths, headUsingObj.paths);
        Object.assign(paths2, headUsingObj.paths2);
        obj[fileID].meta["usingMeta"] = {
            "name": headUsingObj.obj[headKey].meta.name,
            "head": headUsingObj.obj[headKey].meta.head,
            "id": headKey,
            "pathid": pathUUID
        };
    }
    console.log("7")
    if (linked && linked.length > 0) {
        const linkedPromises = linked.map(async (link) => {
            const subByE = await getSub(link, "e", dynamodb);
            const uuid = subByE.Items[0].su;
            //console.log("performing convertToJSON LINKED")
            return await convertToJSON(uuid, newParentPath, false, null, cookie, dynamodb, uuidv4, pathUUID, newParentPath2, id2Path, usingID, dynamodbLL, body, substitutingID);
        });
        const linkedResponses = await Promise.all(linkedPromises);
        for (const linkedResponse of linkedResponses) {
            Object.assign(obj[fileID].linked, linkedResponse.obj);
            Object.assign(paths, linkedResponse.paths);
            Object.assign(paths2, linkedResponse.paths2);
        }
    }
    console.log("8")
    //console.log("getGroups")
    const groupList = await getGroups(dynamodb);
    //console.log("returning ----", groupList)
    console.log("9")
    return { obj, paths, paths2, id2Path, groups: groupList };
}
const updateEntity = async (e, col, val, v, c, dynamodb) => {
    let params = {}
    if (col === "-t" || col === "-f") {
        const uEntity = await getEntity(e, dynamodb)
        const list = uEntity.Items[0][col.replace("-", "")]
        const indexToRemove = list.indexOf(val);
        params = {
            "TableName": 'entities',
            "Key": { 'e': e },
            "UpdateExpression": `REMOVE ${col.replace("-", "")}[${indexToRemove}]`,
            "ReturnValues": 'ALL_NEW'
        }
    } else if (col === "t" || col === "f" || col === "l" || col === "o" || col === "ai") {
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
    } else if (col === "m") {
        params1 = {
            "TableName": "entities",
            "Key": { "e": e },
            "UpdateExpression": `set #m = if_not_exists(#m, :emptyMap)`,
            "ExpressionAttributeNames": { '#m': 'm' },
            "ExpressionAttributeValues": { ":emptyMap": {} }
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
            "UpdateExpression": `set ${col} = :val, v = :v, c = :c`,
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
        throw error;
    }
};
const wordExists = async (word, dynamodb) => {
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
    //console.log("getHead", by, value)
    const subBySU = await getSub(value, by, dynamodb);
    //console.log("getEntity", subBySU)
    const entity = await getEntity(subBySU.Items[0].e, dynamodb)
    //console.log("getSub", entity)
    const headSub = await getSub(entity.Items[0].h, "e", dynamodb);
    return headSub
}
const createWord = async (id, word, dynamodb) => {
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
async function addVersion(newE, col, val, forceC, dynamodb) {
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
        if (col === "t" || col === "f" || col === "l" || col === "o") {
            newRecord = {
                v: id.toString(),
                c: newCValue.toString(),
                e: newE,
                s: newSValue.toString(),
                p: previousVersionId,
                [col]: colVal,
                d: Date.now()
            };
        } else if (col === "m") {
            const entity = await getEntity(newE, dynamodb)
            if (entity.Items[0].m) {
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
        } else {
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
        return { v: id.toString(), c: newCValue.toString(), m: newM };
    } catch (error) {
        return null
    }
};
const createFile = async (su, fileData, s3) => {

    const jsonString = JSON.stringify(fileData);
    console.log("!!! jsonString", jsonString)
    const bucketParams = {
        Bucket: fileLocation(isPublic) + '.1var.com',
        Key: su,
        Body: jsonString,
        ContentType: 'application/json'
    };
    const data = await s3.putObject(bucketParams).promise();
    console.log("data", data)
    return true;
}
const updateJSONL = async (newLine, keys, s3) => {
    try {
        JSON.parse(newLine);
        let VAR = JSON.parse(newLine.completion)
        for (let key in VAR) {
            if (!keys.includes(key)) {
                delete VAR[key];
            }
        }
        newLine.completion = JSOn.stringify(VAR)
        const getParams = { Bucket: 'private.1var.com', Key: 'training.jsonl' };
        const data = await s3.getObject(getParams).promise();
        const etag = data.ETag;

        let existingData = data.Body.toString();
        if (!existingData.endsWith('\n')) {
            existingData += '\n';
        }
        const updatedFile = existingData + newLine + '\n';
        const putParams = {
            Bucket: 'private.1var.com',
            Key: 'training.jsonl',
            Body: updatedFile,
            ContentType: 'application/jsonl',

        };

        const response = await s3.putObject(putParams).promise();
        return true;
    } catch (error) {
        console.error('Error updating training.jsonl:', error);
        throw error;
    }
};
const fineTune = async (openai, method, val, sub) => {
    let fineTune = {}
    if (method == "create") {
        fineTune = await openai.fineTuning.jobs.create({
            training_file: val,
            model: sub
        })

    } else if (method == "list") {
        fineTune = await openai.fineTuning.jobs.list({ limit: parseInt(val) });
    } else if (method == "delete") {
        fineTune = await openai.models.delete(val);
    } else if (method == "events") {
        fineTune = await openai.fineTuning.jobs.listEvents(val, { limit: parseInt(sub) });
    } else if (method == "retrieve") {
        fineTune = await openai.fineTuning.jobs.retrieve(val);
    } else if (method == "cancel") {
        fineTune = await openai.fineTuning.jobs.cancel(val);
    }

    return fineTune
}
const createEntity = async (e, a, v, g, h, ai, dynamodb) => {
    if (!ai) {
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
        throw error;
    }
};
const createSubdomain = async (su, a, e, g, z, dynamodb) => {
    const paramsAA = {
        TableName: 'subdomains',
        Item: { su: su, a: a, e: e, g: g, z: z }
    };
    try {
        const response = await dynamodb.put(paramsAA).promise();
        return `Entity created with su: ${su}, a: ${a}, e: ${e}, z: ${z}`;
    } catch (error) {
        throw error;
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

    if (val == "true" || val == true) {
        sourceBucket = 'private.1var.com'
        destinationBucket = 'public.1var.com'
    } else {
        sourceBucket = 'public.1var.com'
        destinationBucket = 'private.1var.com'
    }
    const versions = await s3.listObjectVersions({
        Bucket: sourceBucket,
        Prefix: file
    }).promise();

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let x = versions.Versions.length - 1; x >= 0; x--) {
        const version = versions.Versions[x];

        let param1 = {
            Bucket: sourceBucket,
            Key: file,
            VersionId: version.VersionId
        }
        let originalMetadata = await s3.headObject(param1).promise();

        let newMetadata = {
            ...originalMetadata.Metadata,
            'originalversionid': version.VersionId
        };










        let param2 = {
            Bucket: destinationBucket,
            CopySource: `${sourceBucket}/${file}?versionId=${version.VersionId}`,
            Key: file,
            Metadata: newMetadata,
            ContentType: originalMetadata.ContentType,
            MetadataDirective: "REPLACE"
        }
        let copyResponse = await s3.copyObject(param2).promise();

        let param3 = {
            Bucket: sourceBucket,
            Key: file,
            VersionId: version.VersionId
        }
        let deleteResponse = await s3.deleteObject(param3).promise();

        await delay(1000);
    }



    return { status: 'All versions moved successfully' };
}
async function linkEntities(childID, parentID) {
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
async function email(from, to, subject, emailText, emailHTML, ses) {
    const params = {
        Source: from,
        Destination: {
            ToAddresses: [
                to
            ]
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
        return { statusCode: 200, body: JSON.stringify(data) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify(error) };
    }
}
async function createCookie(ci, gi, ex, ak) {
    return await dynamodb.put({
        TableName: 'cookies',
        Item: { "ci": ci, "gi": gi, "ex": ex, "ak": ak }
    }).promise();
}
async function getCookie(val, key) {
    if (key == "ci") {
        params = { TableName: 'cookies', KeyConditionExpression: 'ci = :ci', ExpressionAttributeValues: { ':ci': val } };
    } else if (key == "ak") {
        params = { TableName: 'cookies', IndexName: 'akIndex', KeyConditionExpression: 'ak = :ak', ExpressionAttributeValues: { ':ak': val } }
    } else if (key == "gi") {
        params = { TableName: 'cookies', IndexName: 'giIndex', KeyConditionExpression: 'gi = :gi', ExpressionAttributeValues: { ':gi': val } }
    }
    return await dynamodb.query(params).promise()
}
async function manageCookie(mainObj, xAccessToken, res, dynamodb, uuidv4) {
    console.log("xAccessToken", xAccessToken)
    let existing = false
    if (xAccessToken) {
        console.log("existing user")
        mainObj["status"] = "authenticated";
        existing = true;
        let val = xAccessToken;
        let cookie = await getCookie(val, "ak")
        return cookie.Items[0]
    } else {
        console.log("else generate Cookie!")
        const ak = await getUUID(uuidv4)
        const ci = await incrementCounterAndGetNewValue('ciCounter', dynamodb);
        const gi = await incrementCounterAndGetNewValue('giCounter', dynamodb);
        const ttlDurationInSeconds = 86400;
        const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
        await createCookie(ci.toString(), gi.toString(), ex, ak)
        mainObj["accessToken"] = ak;
        existing = true;
        res.cookie('accessToken', ak, {
            domain: '.1var.com',
            maxAge: ttlDurationInSeconds * 1000,
            httpOnly: true,
            secure: true,
            sameSite: 'None'
        });
        return { "ak": ak, "gi": gi, "ex": ex, "ci": ci, "existing": existing }
    }
}
async function createAccess(ai, g, e, ex, at, to, va, ac) {
    return await dynamodb.put({
        TableName: 'access',
        Item: { ai: ai, g: g, e: e, ex: ex, at: at, to: to, va: va, ac: ac }
    }).promise();
}
async function createVerified(vi, gi, g, e, ai, va, ex, bo, at, ti) {
    return await dynamodb.put({
        TableName: 'verified',
        Item: { vi: vi, gi: gi, g: g, e: e, ai: ai, va: va, ex: ex, bo: bo, at: at, ti: ti }
    }).promise();
}
async function getUUID(uuidv4) {
    let uniqueId = await uuidv4();
    return "1v4r" + uniqueId
}
function allVerified(list) {
    let v = true
    for (l in list) {
        if (list[l] != true) {
            v = false
        }
    }
    return v
}
async function verifyPath(splitPath, verifications, dynamodb) {


    let verified = [];
    let verCounter = 0;
    for (ver in splitPath) {
        if (splitPath[ver].startsWith("1v4r")) {
            let verValue = false
            verified.push(false)
            const sub = await getSub(splitPath[ver], "su", dynamodb);


            let groupID = sub.Items[0].g
            let entityID = sub.Items[0].e
            if (sub.Items[0].z) {
                verValue = true
            }
            for (veri in verifications.Items) {



                if (entityID != "0") {

                    let eSub = await getEntity(sub.Items[0].e, dynamodb)

                    groupID = eSub.Items[0].g

                    if (eSub.Items[0].ai.toString() == "0") {
                        verValue = true

                    }

                }
                if (sub.Items.length > 0) {


                    if (sub.Items[0].z == true) {
                        verValue = true
                    } else if (entityID == verifications.Items[veri].e && verifications.Items[veri].bo) {
                        const ex = Math.floor(Date.now() / 1000);
                        if (ex < verifications.Items[veri].ex) {
                            verValue = true
                        }
                    } else if (groupID == verifications.Items[veri].g && verifications.Items[veri].bo) {
                        const ex = Math.floor(Date.now() / 1000);
                        if (ex < verifications.Items[veri].ex) {
                            verValue = true
                        }
                    } else if (entityID == "0" && groupID == "0") {

                        verValue = true;
                    }
                }
            }
            verified[verCounter] = verValue
            verCounter++;
        }
    }
    return verified
}
async function createTask(ti, en, sd, ed, st, et, zo, it, mo, tu, we, th, fr, sa, su, ex, dynamodb) {
    await dynamodb.put({
        TableName: 'tasks',
        Item: { ti: ti.toString(), url: en, sd: sd, ed: ed, st: st, et: et, zo: zo, it: it, mo: mo, tu: tu, we: we, th: th, fr: fr, sa: sa, su: su, ex: ex }
    }).promise();
    return ti
}
async function createSchedule(ti, en, sdS, edS, stS, etS, itS, moS, tuS, weS, thS, frS, saS, suS, ex, dynamodb) {
    const si = await incrementCounterAndGetNewValue('siCounter', dynamodb);
    await dynamodb.put({
        TableName: 'schedules',
        Item: { si: si.toString(), ti: ti.toString(), url: en, sd: sdS, ed: edS, st: stS, et: etS, it: itS, mo: moS, tu: tuS, we: weS, th: thS, fr: frS, sa: saS, su: suS, ex: ex }
    }).promise();
    let stUnix = sdS + stS
    let etUnix = sdS + etS
    var objDate = moment.utc(stUnix * 1000);
    const today = moment.utc();
    var isToday = objDate.isSame(today, 'day');
    let dow = {
        mo: moS,
        tu: tuS,
        we: weS,
        th: thS,
        fr: frS,
        sa: saS,
        su: suS
    };
    const todayIndex = moment().utc().day();
    const dayCodes = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
    const todayCode = dayCodes[todayIndex];
    const isTodayOn = dow[todayCode] === 1;
    if (isToday && isTodayOn) {
        const config = { region: "us-east-1" };
        const client = new SchedulerClient(config);
        let enParams = { TableName: 'enCounter', KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': "enCounter" } };
        let enData = await dynamodb.query(enParams).promise()
        var startTime = moment(stUnix * 1000);
        var endTime = moment(etUnix * 1000);
        while (startTime <= endTime) {
            var hour = startTime.format('HH');
            var minute = startTime.format('mm');
            const hourFormatted = hour.toString().padStart(2, '0');
            const minuteFormatted = minute.toString().padStart(2, '0');
            const scheduleName = `${hourFormatted}${minuteFormatted}`;
            const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;
            const input = {
                Name: scheduleName,
                GroupName: "runLambda",
                ScheduleExpression: scheduleExpression,
                ScheduleExpressionTimezone: "UTC",
                StartDate: new Date(moment.utc().format()),
                EndDate: new Date("2030-01-01T00:00:00Z"),
                State: "ENABLED",
                Target: {
                    Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp",
                    RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
                    Input: JSON.stringify({ "disable": true, "automate": true }),
                },
                FlexibleTimeWindow: { Mode: "OFF" },
            };
            const command = new UpdateScheduleCommand(input);
            const createSchedule = async () => {
                try {
                    const response = await client.send(command);
                    const params = {
                        TableName: "enabled",
                        Key: {
                            "time": scheduleName,
                        },
                        UpdateExpression: "set #enabled = :enabled, #en = :en",
                        ExpressionAttributeNames: {
                            "#enabled": "enabled",
                            "#en": "en"
                        },
                        ExpressionAttributeValues: {
                            ":enabled": 1,
                            ":en": enData.Items[0].x
                        },
                        ReturnValues: "UPDATED_NEW"
                    };
                    try {
                        const result = await dynamodb.update(params).promise();
                    } catch (err) {
                    }
                } catch (error) {
                }
            };
            await createSchedule();
            startTime.add(itS, 'minutes');
        }
    }
    return "done"
}
async function removeSchedule(ti) {
    var queryParams = {
        TableName: 'schedules',
        IndexName: 'tiIndex',
        KeyConditionExpression: 'ti = :tiVal',
        ExpressionAttributeValues: {
            ':tiVal': ti
        }
    };
    await dynamodb.query(queryParams, async function (queryErr, queryResult) {
        await queryResult.Items.forEach(async function (item) {
            await dynamodb.delete({
                TableName: 'schedules',
                Key: {
                    'si': item.si
                }
            }).promise();
        });
    }).promise();
    await dynamodb.delete({
        TableName: 'tasks',
        Key: {
            'ti': ti
        }
    }).promise();
    return "success"
}
async function shiftDaysOfWeekForward(daysOfWeek) {
    return {
        sunday: daysOfWeek.saturday,
        monday: daysOfWeek.sunday,
        tuesday: daysOfWeek.monday,
        wednesday: daysOfWeek.tuesday,
        thursday: daysOfWeek.wednesday,
        friday: daysOfWeek.thursday,
        saturday: daysOfWeek.friday,
    };
}
async function convertTimespanToUTC(options) {
    const {
        startDate,
        endDate,
        startTime,
        endTime,
        timeZone,
        ...daysOfWeek
    } = options;
    let sOrigUTC = await moment.tz(`${startDate} ${startTime}`, "YYYY-MM-DD HH:mm", timeZone);
    let startUTC = await moment.tz(`${startDate} ${startTime}`, "YYYY-MM-DD HH:mm", timeZone).utc();
    let eOrigUTC = await moment.tz(`${endDate} ${endTime}`, "YYYY-MM-DD HH:mm", timeZone);
    let endUTC = await moment.tz(`${endDate} ${endTime}`, "YYYY-MM-DD HH:mm", timeZone).utc();
    let firstTimespan
    if (eOrigUTC.format("YYYY-MM-DD") != endUTC.format("YYYY-MM-DD")) {
        if (sOrigUTC.format("YYYY-MM-DD") != startUTC.format("YYYY-MM-DD")) {
            let nextDayShiftedDaysOfWeek = await shiftDaysOfWeekForward(daysOfWeek);
            firstTimespan = await {
                startDate: startUTC.format("YYYY-MM-DD"),
                endDate: endUTC.format("YYYY-MM-DD"),
                startTime: await startUTC.format("HH:mm"),
                endTime: await endUTC.format("HH:mm"),
                timeZone: "UTC",
                ...nextDayShiftedDaysOfWeek
            };
        } else {
            firstTimespan = await {
                startDate: startUTC.format("YYYY-MM-DD"),
                endDate: eOrigUTC.format("YYYY-MM-DD"),
                startTime: await startUTC.format("HH:mm"),
                endTime: await endUTC.clone().endOf('day').format("HH:mm"),
                timeZone: "UTC",
                ...daysOfWeek
            };
        }
    } else {
        firstTimespan = await {
            startDate: startUTC.format("YYYY-MM-DD"),
            endDate: endUTC.format("YYYY-MM-DD"),
            startTime: await startUTC.format("HH:mm"),
            endTime: await endUTC.format("HH:mm"),
            timeZone: "UTC",
            ...daysOfWeek
        };
    }

    if (eOrigUTC.format("YYYY-MM-DD") != endUTC.format("YYYY-MM-DD")) {
        endUTC.clone().add(1, 'day');
    }
    let timespans = [firstTimespan];
    if (eOrigUTC.format("YYYY-MM-DD") != endUTC.format("YYYY-MM-DD")) {
        if (sOrigUTC.format("YYYY-MM-DD") == startUTC.format("YYYY-MM-DD")) {
            let nextDayShiftedDaysOfWeek = await shiftDaysOfWeekForward(daysOfWeek);


            let secondTimespan = await {
                startDate: await startUTC.format("YYYY-MM-DD"),
                endDate: await endUTC.format("YYYY-MM-DD"),
                startTime: "00:00",
                endTime: await endUTC.format("HH:mm"),
                timeZone: "UTC",
                ...nextDayShiftedDaysOfWeek
            };
            timespans.push(secondTimespan);
        }
    }
    return timespans;
}
async function retrieveAndParseJSON(fileName, isPublic) {
    let fileLocation = "private"
    if (isPublic == "true" || isPublic == true) {
        fileLocation = "public"
    }
    const params = { Bucket: fileLocation + '.1var.com', Key: fileName };
    const data = await s3.getObject(params).promise();

    return await JSON.parse(data.Body.toString('utf-8'));
}
async function runPrompt(question, entity, dynamodb, openai, Anthropic) {
    const gptScript = [""];

    const head = await getHead("su", entity, dynamodb)
    let isPublic = head.Items[0].z
    let results = await retrieveAndParseJSON(entity, isPublic);
    let blocks = JSON.parse(JSON.stringify(results.blocks))
    let modules = JSON.parse(JSON.stringify(results.modules))
    results = JSON.stringify(results)

    let combinedPrompt = `${gptScript} /n/n Using the proprietary json structure. RESPOND BACK WITH JUST AND ONLY A SINGLE JSON FILE!! NO COMMENTS!! NO EXPLINATIONS!! NO INTRO!! JUST JSON!!:  ${question.prompt} /n/n Here is the code to edit; ${results} `

    let response;
    let jsonParsed;
    let jsonString
    if (false) {
        const anthropic = new Anthropic();
        response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 4000,
            temperature: 0.7,
            system: gptScript.join(" "),
            messages: [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": combinedPrompt
                        }
                    ]
                }
            ]
        });
        jsonParsed = JSON.parse(response.content[0].text)
        jsonParsed.modules = modules
        jsonParsed.blocks = blocks
        jsonParsed.ai = true;
        jsonString = response.content
    } else {
        response = await openai.chat.completions.create({
            messages: [{ role: "system", content: combinedPrompt }],
            model: "o3-mini-2025-01-31",
            response_format: { "type": "json_object" }
        });
        jsonParsed = JSON.parse(response.choices[0].message.content)
        jsonParsed.modules = modules
        jsonParsed.blocks = blocks
        jsonParsed.ai = true;
    }
    return { "response": JSON.stringify(jsonParsed), "isPublic": isPublic, "entity": entity }
};
const tablesToClear = [
    'access',
    'cookies',
    'entities',
    'groups',
    'schedules',
    'subdomains',
    'tasks',
    'words',
    'verified',
    'versions',
];
const countersToReset = [
    { tableName: 'aiCounter', primaryKey: 'aiCounter' },
    { tableName: 'ciCounter', primaryKey: 'ciCounter' },
    { tableName: 'eCounter', primaryKey: 'eCounter' },
    { tableName: 'enCounter', primaryKey: 'enCounter' },
    { tableName: 'gCounter', primaryKey: 'gCounter' },
    { tableName: 'giCounter', primaryKey: 'giCounter' },
    { tableName: 'siCounter', primaryKey: 'siCounter' },
    { tableName: 'tiCounter', primaryKey: 'tiCounter' },
    { tableName: 'vCounter', primaryKey: 'vCounter' },
    { tableName: 'viCounter', primaryKey: 'viCounter' },
    { tableName: 'wCounter', primaryKey: 'wCounter' }
];
const keySchemaMap = {
    'access': { partitionKey: 'ai' },
    'cookies': { partitionKey: 'ci' },
    'entities': { partitionKey: 'e' },
    'groups': { partitionKey: 'g' },
    'schedules': { partitionKey: 'si' },
    'subdomains': { partitionKey: 'su' },
    'tasks': { partitionKey: 'ti' },
    'words': { partitionKey: 'a' },
    'verified': { partitionKey: 'vi' },
    'versions': { partitionKey: 'v', sortKey: 'd' }
};
async function clearTable(tableName, dynamoDb) {
    const params = {
        TableName: tableName,
    };
    let items;
    do {
        items = await dynamoDb.scan(params).promise();
        if (!items.Items || items.Items.length === 0) {

            break;
        }
        const keySchema = keySchemaMap[tableName];
        if (!keySchema || !keySchema.partitionKey) {
            throw new Error(`Primary key attribute not defined for table ${tableName}`);
        }
        const deleteRequests = items.Items.map((item) => {
            if (item[keySchema.partitionKey] === undefined) {
                throw new Error(`Partition key '${keySchema.partitionKey}' not found in item`);
            }
            const key = {
                [keySchema.partitionKey]: item[keySchema.partitionKey],
            };
            if (keySchema.sortKey) {
                if (item[keySchema.sortKey] === undefined) {
                    throw new Error(`Sort key '${keySchema.sortKey}' not found in item`);
                }
                key[keySchema.sortKey] = item[keySchema.sortKey];
            }
            return {
                DeleteRequest: {
                    Key: key,
                },
            };
        });
        const batches = [];
        while (deleteRequests.length) {
            batches.push(deleteRequests.splice(0, 25));
        }
        for (const batch of batches) {
            const batchParams = {
                RequestItems: {
                    [tableName]: batch,
                },
            };
            await dynamoDb.batchWrite(batchParams).promise();
        }
        params.ExclusiveStartKey = items.LastEvaluatedKey;
    } while (typeof items.LastEvaluatedKey !== 'undefined');
}
async function resetCounter(counter, dynamoDb) {
    const params = {
        TableName: counter.tableName,
        Key: {
            pk: counter.primaryKey,
        },
        UpdateExpression: 'SET #x = :zero',
        ExpressionAttributeNames: {
            '#x': 'x',
        },
        ExpressionAttributeValues: {
            ':zero': 0,
        },
    };
    await dynamoDb.update(params).promise();
}

async function searchSubdomains(
    embedding, domain, subdomain, entity, query, limit, action
) {

    console.log("searchSubdomains ----------------");
    console.log("embedding", embedding);
    console.log("domain", domain);
    console.log("subdomain", subdomain);
    console.log("entity", entity);
    console.log("query", query);
    console.log("limit", limit);
    console.log("action", action);
    if (!embedding || !domain || !subdomain || !entity) {
        console.log("returning early because of a falsy")
        return
    }


    const tableName = `i_${domain}`;
    let item;
    try {
        const params = {
            TableName: tableName,
            KeyConditionExpression: "#r = :sub",
            ExpressionAttributeNames: { "#r": "root" },
            ExpressionAttributeValues: { ":sub": subdomain },
            Limit: 1
        };
        const data = await dynamodb.query(params).promise();
        if (!data.Items.length) {
            return res.status(404).json({ error: "no record for that sub‑domain" });
        }
        item = data.Items[0];
    } catch (err) {
        console.error("DynamoDB query failed:", err);
        return res.status(502).json({ error: "db‑unavailable" });
    }

    const cosineDist = (a, b) => {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
    };

    const distances = {};
    for (let i = 1; i <= 5; i++) {
        const attr = `emb${i}`;
        const raw = item[attr];

        let refArr = null;
        if (typeof raw === "string") {
            try { refArr = JSON.parse(raw); } catch { }
        } else if (Array.isArray(raw)) {
            refArr = raw;
        }

        if (Array.isArray(refArr) && refArr.length === embedding.length) {
            distances[`dist${i}`] = cosineDist(embedding, refArr);
        }
    }


    const dist1 = distances.dist1;
    if (typeof dist1 !== "number") {
        return res.status(500).json({ error: "dist1 missing from first pass" });
    }

    const dist1Lower = Math.max(0, dist1 - limit);
    const dist1Upper = Math.min(1, dist1 + limit);

    const fullPath = `/${domain}/${subdomain}`;
    let matches = [];
    try {
        const params = {
            TableName: "subdomains",
            IndexName: "path-index",
            ExpressionAttributeNames: { "#p": "path", "#d1": "dist1" },
            ExpressionAttributeValues: { ":path": fullPath, ":lo": dist1Lower, ":hi": dist1Upper },
            KeyConditionExpression: "#p = :path AND #d1 BETWEEN :lo AND :hi"
        };

        let last;
        do {
            const data = await dynamodb.query({ ...params, ExclusiveStartKey: last }).promise();
            matches.push(...data.Items);
            last = data.LastEvaluatedKey;
        } while (last);

    } catch (err) {
        console.error("search → DynamoDB failed:", err);
        return res.status(502).json({ error: "db‑unavailable" });
    }

    /* ───────────── respond ───────────── */
    return { action, query, domain, subdomain, entity, distances, matches };
}

async function route(req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, isShorthand, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken) {

    console.log("PROMISE CHECK )))", req, res, reqBody, reqMethod, reqType, reqHeaderSent, action)
    console.log("route indise")
    cache = {
        getSub: {},
        getEntity: {},
        getWord: {},
        getGroup: {},
        getAccess: {},
        getVerified: {},
    }


    var response = {}
    var actionFile = ""
    var mainObj = {}
    //console.log("reqMethod", reqMethod)
    if (reqMethod === 'GET' || reqMethod === 'POST') {


        let cookie = await manageCookie(mainObj, xAccessToken, res, dynamodb, uuidv4)

        const verifications = await getVerified("gi", cookie.gi.toString(), dynamodb)

        let splitPath = reqPath.split("/")

        let verified = await verifyPath(splitPath, verifications, dynamodb);


        let allV = allVerified(verified);
        console.log("allV", allV)
        if (allV) {
            console.log("action", action)
            if (action === "get") {

                const fileID = reqPath.split("/")[3]
                actionFile = fileID
                mainObj = await convertToJSON(fileID, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)

                let tasksUnix = await getTasks(fileID, "su", dynamodb)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO
            } else if (action == "resetDB") {
                try {
                    for (const tableName of tablesToClear) {
                        await clearTable(tableName, dynamodb);

                    }
                    for (const counter of countersToReset) {
                        await resetCounter(counter, dynamodb);

                    }
                    mainObj = { "alert": "success" }
                } catch (error) {
                    console.error('Error resetting database:', error);
                    mainObj = { "alert": "failed" }
                }

            } else if (action == "add") {
                const fileID = reqPath.split("/")[3];
                const newEntityName = reqPath.split("/")[4];
                const headUUID = reqPath.split("/")[5];
                const parent = await getSub(fileID, "su", dynamodb);
                setIsPublic(parent.Items[0].z);
                const eParent = await getEntity(parent.Items[0].e, dynamodb);
                const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
                const aNew = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                const a = await createWord(aNew.toString(), newEntityName, dynamodb);
                const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);

                const result = await createEntity(e.toString(), a.toString(), details.v, eParent.Items[0].g, eParent.Items[0].h, eParent.Items[0].ai, dynamodb);
                const uniqueId = await getUUID(uuidv4);
                let subRes = await createSubdomain(uniqueId, a.toString(), e.toString(), "0", parent.Items[0].z, dynamodb)
                const fileResult = await createFile(uniqueId,
                    {
                        "input": [], "published": {
                            "blocks": [{ "entity": uniqueId, "name": "Primary" }],
                            "modules": {},
                            "actions": [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }],
                            "function": {},
                            "automation": [],
                            "menu": { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } },
                            "commands": { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } },
                            "calls": { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] },
                            "templates": { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } },
                            "assignments": {
                                "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 1" }, "_mode": "_html" },
                                "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 2" }, "_mode": "_html" },
                                "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 3" }, "_mode": "_html" },
                                "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 4" }, "_mode": "_html" }
                            },
                            "mindsets": [],
                            "thoughts": {
                                "1v4rdc3d72be-3e20-435c-a68b-3808f99af1b5": {
                                    "owners": [],
                                    "content": "",
                                    "contentType": "text",
                                    "moods": {
                                    },
                                    "selectedMood": ""
                                }
                            },
                            "moods": [
                            ],
                        }, "skip": [], "sweeps": 1, "expected": []
                    }, s3);
                actionFile = uniqueId;
                const details2 = await addVersion(parent.Items[0].e.toString(), "t", e.toString(), eParent.Items[0].c, dynamodb);
                const updateParent = await updateEntity(parent.Items[0].e.toString(), "t", e.toString(), details2.v, details2.c, dynamodb);
                const details22 = await addVersion(e.toString(), "f", parent.Items[0].e.toString(), "1", dynamodb);
                const updateParent22 = await updateEntity(e.toString(), "f", parent.Items[0].e.toString(), details22.v, details22.c, dynamodb);
                const group = eParent.Items[0].g;
                const details3 = await addVersion(e.toString(), "g", group, "1", dynamodb);
                const updateParent3 = await updateEntity(e.toString(), "g", group, details3.v, details3.c, dynamodb);
                mainObj = await convertToJSON(headUUID, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "link") {
                const childID = reqPath.split("/")[3]
                const parentID = reqPath.split("/")[4]
                await linkEntities(childID, parentID)
                mainObj = await convertToJSON(childID, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "newGroup") {
                if (cookie != undefined) {
                    const newGroupName = reqPath.split("/")[3]
                    const headEntityName = reqPath.split("/")[4]
                    const parentEntity = reqPath.split("/")[5]
                    console.log("reqBody??", reqBody)
                    console.log("req.body??", req.body)
                    setIsPublic(true)
                    const aNewG = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                    const aG = await createWord(aNewG.toString(), newGroupName, dynamodb);
                    const aNewE = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                    const aE = await createWord(aNewE.toString(), headEntityName, dynamodb);
                    const gNew = await incrementCounterAndGetNewValue('gCounter', dynamodb);
                    const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
                    const ai = await incrementCounterAndGetNewValue('aiCounter', dynamodb);
                    const access = await createAccess(ai.toString(), gNew.toString(), "0", { "count": 1, "metric": "year" }, 10, { "count": 1, "metric": "minute" }, {}, "rwado")
                    const ttlDurationInSeconds = 90000;
                    const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
                    const vi = await incrementCounterAndGetNewValue('viCounter', dynamodb);
                    await createVerified(vi.toString(), cookie.gi.toString(), gNew.toString(), "0", ai.toString(), "0", ex, true, 0, 0)
                    const groupID = await createGroup(gNew.toString(), aNewG, e.toString(), [ai.toString()], dynamodb);
                    const uniqueId = await getUUID(uuidv4)
                    let subRes = await createSubdomain(uniqueId, "0", "0", gNew.toString(), true, dynamodb)
                    const details = await addVersion(e.toString(), "a", aE.toString(), null, dynamodb);
                    const result = await createEntity(e.toString(), aE.toString(), details.v, gNew.toString(), e.toString(), [ai.toString()], dynamodb); //DO I NEED details.c
                    const uniqueId2 = await getUUID(uuidv4)
                    console.log("reqBody.output", reqBody.output)
                    console.log("req.body.output", req.body.output)
                    const fileResult = await createFile(uniqueId2,
                        {
                            "input": [], "published": {
                                "blocks": [{ "entity": uniqueId2, "name": "Primary" }],
                                "modules": {},
                                "actions": [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": [reqBody.output] }], "assign": "{|send|}" }],
                                "function": {},
                                "automation": [],
                                "menu": { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } },
                                "commands": { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } },
                                "calls": { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] },
                                "templates": { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } },
                                "assignments": {
                                    "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 1" }, "_mode": "_html" },
                                    "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 2" }, "_mode": "_html" },
                                    "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 3" }, "_mode": "_html" },
                                    "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 4" }, "_mode": "_html" }
                                },
                                "mindsets": [],
                                "thoughts": {
                                    "1v4rdc3d72be-3e20-435c-a68b-3808f99af1b5": {
                                        "owners": [],
                                        "content": "",
                                        "contentType": "text",
                                        "moods": {
                                        },
                                        "selectedMood": ""
                                    }
                                },
                                "moods": [
                                ],
                            }, "skip": [], "sweeps": 1, "expected": []
                        }
                        , s3)
                    actionFile = uniqueId2

                    let subRes2 = await createSubdomain(uniqueId2, aE.toString(), e.toString(), "0", true, dynamodb)
                    let from = "noreply@email.1var.com"
                    let to = "austin@1var.com"
                    let subject = "1 VAR - Email Address Verification Request"
                    let emailText = "Dear 1 Var User, \n\n We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. \n\n http://1var.com/verify/" + uniqueId
                    let emailHTML = "Dear 1 Var User, <br><br> We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. <br><br> http://1var.com/verify/" + uniqueId
                    let emailer = await email(from, to, subject, emailText, emailHTML, ses)

                    mainObj = await convertToJSON(uniqueId2, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                    console.log("mainObj=.", mainObj)
                }
            } else if (action === "useGroup") {
                actionFile = reqPath.split("/")[3]
                const newUsingName = reqPath.split("/")[3]
                const headUsingName = reqPath.split("/")[4]
                const using = await getSub(newUsingName, "su", dynamodb);
                const ug = await getEntity(using.Items[0].e, dynamodb)
                const used = await getSub(headUsingName, "su", dynamodb);
                const ud = await getEntity(used.Items[0].e, dynamodb)
                const details2 = await addVersion(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), ug.Items[0].c, dynamodb);
                const updateParent = await updateEntity(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), details2.v, details2.c, dynamodb);
                const headSub = await getSub(ug.Items[0].h, "e", dynamodb);
                mainObj = await convertToJSON(headSub.Items[0].su, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "substituteGroup") {
                actionFile = reqPath.split("/")[3]
                const newSubstitutingName = reqPath.split("/")[3]
                const headSubstitutingName = reqPath.split("/")[4]
                const substituting = await getSub(newSubstitutingName, "su", dynamodb);
                const sg = await getEntity(substituting.Items[0].e, dynamodb)
                const substituted = await getSub(headSubstitutingName, "su", dynamodb);
                const sd = await getEntity(substituted.Items[0].e, dynamodb)
                const details2 = await addVersion(sg.Items[0].e.toString(), "z", sd.Items[0].e.toString(), sg.Items[0].c, dynamodb);
                const updateParent = await updateEntity(sg.Items[0].e.toString(), "z", sd.Items[0].e.toString(), details2.v, details2.c, dynamodb);
                const headSub = await getSub(sg.Items[0].h, "e", dynamodb);
                mainObj = await convertToJSON(headSub.Items[0].su, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "map") {
                const referencedParent = reqPath.split("/")[3]
                const newEntityName = reqPath.split("/")[4]
                const mappedParent = reqPath.split("/")[5]
                const headEntity = reqPath.split("/")[6]
                const subRefParent = await getSub(referencedParent, "su", dynamodb);
                setIsPublic(subRefParent.Items[0].z);
                const subMapParent = await getSub(mappedParent, "su", dynamodb);
                const mpE = await getEntity(subMapParent.Items[0].e, dynamodb)
                const mrE = await getEntity(subRefParent.Items[0].e, dynamodb)
                const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
                const aNew = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                const a = await createWord(aNew.toString(), newEntityName, dynamodb);
                const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);
                const result = await createEntity(e.toString(), a.toString(), details.v, mpE.Items[0].g, mpE.Items[0].h, mpE.Items[0].ai, dynamodb);
                const uniqueId = await getUUID(uuidv4)
                let subRes = await createSubdomain(uniqueId, a.toString(), e.toString(), "0", true, dynamodb)
                const fileResult = await createFile(uniqueId,
                    {
                        "input": [{
                            "physical": [
                                [{}],
                                ["ROWRESULT", "000", "NESTED", "000!!", "blocks", [{ "entity": uniqueId, "name": "Primary" }]],
                                ["ROWRESULT", "000", "NESTED", "000!!", "modules", {}],
                                ["ROWRESULT", "000", "NESTED", "000!!", "actions", [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }]],
                                ["ROWRESULT", "000", "NESTED", "000!!", "menu", {}], ["ROWRESULT", "0", "NESTED", "000!!", "function", {}], ["ROWRESULT", "0", "NESTED", "000!!", "automation", []],
                                ["ROWRESULT", "000", "NESTED", "000!!", "menu", { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "commands", { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "calls", { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "templates", { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "assignments", { "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello5" }, "_mode": "_html" }, "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello6" }, "_mode": "_html" }, "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello7" }, "_mode": "_html" }, "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello8" }, "_mode": "_html" } }]
                            ]
                        }, { "virtual": [] }], "published": {
                            "blocks": [{ "entity": uniqueId, "name": "Primary" }],
                            "modules": {},
                            "actions": [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }],
                            "function": {},
                            "automation": [],
                            "menu": { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } },
                            "commands": { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } },
                            "calls": { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] },
                            "templates": { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } },
                            "assignments": {
                                "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 1" }, "_mode": "_html" },
                                "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 2" }, "_mode": "_html" },
                                "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 3" }, "_mode": "_html" },
                                "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 4" }, "_mode": "_html" }
                            }
                        }, "skip": [], "sweeps": 1, "expected": []
                    }
                    , s3)
                actionFile = uniqueId
                let newM = {}
                newM[mrE.Items[0].e] = e.toString()
                const details2a = await addVersion(mpE.Items[0].e.toString(), "m", newM, mpE.Items[0].c, dynamodb);
                let addM = {}
                addM[mrE.Items[0].e] = [e.toString()]
                const updateParent = await updateEntity(mpE.Items[0].e.toString(), "m", addM, details2a.v, details2a.c, dynamodb);
                mainObj = await convertToJSON(headEntity, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "extend") {
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
                const result = await createEntity(e.toString(), a.toString(), details.v, eParent.Items[0].g, eParent.Items[0].h, eParent.Items[0].ai, dynamodb);
                const uniqueId = await getUUID(uuidv4)
                let subRes = await createSubdomain(uniqueId, a.toString(), e.toString(), "0", true, dynamodb)
                const fileResult = await createFile(uniqueId,
                    {
                        "input": [{
                            "physical": [
                                [{}],
                                ["ROWRESULT", "000", "NESTED", "000!!", "blocks", [{ "entity": uniqueId, "name": "Primary" }]],
                                ["ROWRESULT", "000", "NESTED", "000!!", "modules", {}],
                                ["ROWRESULT", "000", "NESTED", "000!!", "actions", [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }]],
                                ["ROWRESULT", "000", "NESTED", "000!!", "menu", {}], ["ROWRESULT", "0", "NESTED", "000!!", "function", {}], ["ROWRESULT", "0", "NESTED", "000!!", "automation", []],
                                ["ROWRESULT", "000", "NESTED", "000!!", "menu", { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "commands", { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "calls", { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "templates", { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } }],
                                ["ROWRESULT", "000", "NESTED", "000!!", "assignments", { "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello5" }, "_mode": "_html" }, "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello6" }, "_mode": "_html" }, "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello7" }, "_mode": "_html" }, "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello8" }, "_mode": "_html" } }]
                            ]
                        }, { "virtual": [] }], "published": {
                            "blocks": [{ "entity": uniqueId, "name": "Primary" }],
                            "modules": {},
                            "actions": [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }],
                            "function": {},
                            "automation": [],
                            "menu": { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } },
                            "commands": { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } },
                            "calls": { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] },
                            "templates": { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } },
                            "assignments": {
                                "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 1" }, "_mode": "_html" },
                                "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 2" }, "_mode": "_html" },
                                "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 3" }, "_mode": "_html" },
                                "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 4" }, "_mode": "_html" }
                            }
                        }, "skip": [], "sweeps": 1, "expected": []
                    }
                    , s3)
                actionFile = uniqueId
                const updateList = eParent.Items[0].t
                for (u in updateList) {
                    const details24 = await addVersion(updateList[u], "-f", eParent.Items[0].e, "1", dynamodb);
                    const updateParent24 = await updateEntity(updateList[u], "-f", eParent.Items[0].e, details24.v, details24.c, dynamodb);
                    const details25 = await addVersion(eParent.Items[0].e, "-t", updateList[u], "1", dynamodb);
                    const updateParent25 = await updateEntity(eParent.Items[0].e, "-t", updateList[u], details25.v, details25.c, dynamodb);
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
                mainObj = await convertToJSON(headUUID, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "reqPut") {
                actionFile = reqPath.split("/")[3]
                fileCategory = reqPath.split("/")[4]
                fileType = reqPath.split("/")[5]
                const subBySU = await getSub(actionFile, "su", dynamodb);
                setIsPublic(subBySU.Items[0].z)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "file") {
                actionFile = reqPath.split("/")[3]
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                let tasksUnix = await getTasks(actionFile, "su", dynamodb)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO
            } else if (action === "addFineTune") {
                let sections = reqPath.split("/")

                const fileResult = await updateJSONL(reqBody.body, sections, s3)
                mainObj = { "alert": "success" }
            } else if (action === "createFineTune") {
                let sections = reqPath.split("/")


                const fineTuneResponse = await fineTune(openai, "create", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "listFineTune") {
                let sections = reqPath.split("/")

                const fineTuneResponse = await fineTune(openai, "list", sections[3], "")
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "deleteFineTune") {
                let sections = reqPath.split("/")


                const fineTuneResponse = await fineTune(openai, "delete", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "eventsFineTune") {
                let sections = reqPath.split("/")


                const fineTuneResponse = await fineTune(openai, "events", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "retrieveFineTune") {
                let sections = reqPath.split("/")


                const fineTuneResponse = await fineTune(openai, "retrieve", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "cancelFineTune") {
                let sections = reqPath.split("/")


                const fineTuneResponse = await fineTune(openai, "cancel", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "saveFile") {
                console.log("reqBody", reqBody)
                console.log("req.body", req.body)

                actionFile = reqPath.split("/")[3]
                console.log("!!! actionFile", actionFile)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                console.log("createFile reqBody.body", reqBody.body)
                if (!reqBody.body) {
                    const fileResult = await createFile(actionFile, reqBody, s3)
                } else {
                    const fileResult = await createFile(actionFile, reqBody.body, s3)
                }
            } else if (action === "makePublic") {
                actionFile = reqPath.split("/")[3]
                let permission = reqPath.split("/")[4]
                const permStat = await updateSubPermission(actionFile, permission, dynamodb, s3)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "makeAuthenticator") {

                const subUuid = reqPath.split("/")[3]
                actionFile = reqPath.split("/")[3]
                const sub = await getSub(subUuid, "su", dynamodb);
                let buffer = false
                if (reqBody.body.hasOwnProperty("type")) {
                    if (reqBody.body.type == "Buffer") {
                        buffer = true
                    }
                }
                let ex = false
                let at = false
                let va = false
                let to = false
                let ac = false
                if (!buffer) {
                    ex = reqBody.body.expires
                    at = reqBody.body.attempts
                    va = reqBody.body.value
                    to = reqBody.body.timeout
                    let permissions = ""
                    if (reqBody.body.execute == true) { permissions += "e" }
                    if (reqBody.body.read == true) { permissions += "r" }
                    if (reqBody.body.write == true) { permissions += "w" }
                    if (reqBody.body.add == true) { permissions += "a" }
                    if (reqBody.body.delete == true) { permissions += "d" }
                    if (reqBody.body.permit == true) { permissions += "p" }
                    if (reqBody.body.own == true) { permissions += "o" }
                    ac = permissions
                }
                if (ex && at && va && to && ac && !buffer) {
                    const ai = await incrementCounterAndGetNewValue('aiCounter', dynamodb);
                    const access = await createAccess(ai.toString(), sub.Items[0].g.toString(), sub.Items[0].e.toString(), ex, at, to, va, ac)

                    if (sub.Items[0].e.toString() != "0") {
                        const details2 = await addVersion(sub.Items[0].e.toString(), "ai", ai.toString(), null, dynamodb);
                        const updateParent = await updateEntity(sub.Items[0].e.toString(), "ai", ai.toString(), details2.v, details2.c, dynamodb);
                    }
                }
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "validation") {
                const subUuid = reqPath.split("/")[3]
                const sub = await getSub(subUuid, "su", dynamodb);
                let params = { TableName: 'access', IndexName: 'eIndex', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': sub.Items[0].e.toString() } }
                let access = await dynamodb.query(params).promise()
                let permission = access.Items[0].ac;
                let r = false
                let w = false
                let a = false
                let d = false
                let p = false
                let o = false
                if (permission.includes("r")) { r = true }
                if (permission.includes("w")) { w = true }
                if (permission.includes("a")) { a = true }
                if (permission.includes("d")) { d = true }
                if (permission.includes("p")) { p = true }
                if (permission.includes("o")) { o = true }
                mainObj = { "validation": access.Items[0].va, "read": r, "write": w, "add": a, "delete": d, "permit": p, "own": o }
            } else if (action === "saveAuthenticator") {
                const subUuid = reqPath.split("/")[3]
                const sub = await getSub(subUuid, "su", dynamodb);
                let params1 = { TableName: 'access', IndexName: 'eIndex', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': sub.Items[0].e.toString() } }
                let access = await dynamodb.query(params1).promise()
                let permissions = ""
                if (reqBody.body.execute == true) { permissions += "e" }
                if (reqBody.body.read == true) { permissions += "r" }
                if (reqBody.body.write == true) { permissions += "w" }
                if (reqBody.body.add == true) { permissions += "a" }
                if (reqBody.body.delete == true) { permissions += "d" }
                if (reqBody.body.permit == true) { permissions += "p" }
                if (reqBody.body.own == true) { permissions += "o" }
                let params2 = {
                    "TableName": 'access',
                    "Key": {
                        "ai": access.Items[0].ai.toString()
                    },
                    "UpdateExpression": `set va = :va, ac = :ac`,
                    "ExpressionAttributeValues": {
                        ':va': reqBody.body.value,
                        ':ac': permissions
                    }
                };
                await dynamodb.update(params2).promise();
                mainObj = { "alert": "success" }
            } else if (action == "useAuthenticator") {
                const Entity = reqPath.split("/")[3]
                const Authenticator = reqPath.split("/")[4]


                const subEntity = await getSub(Entity, "su", dynamodb);
                const subAuthenticator = await getSub(Authenticator, "su", dynamodb);


                let params = { TableName: 'access', IndexName: 'eIndex', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': subAuthenticator.Items[0].e.toString() } }
                let access = await dynamodb.query(params).promise()

                const useE = await getEntity(subEntity.Items[0].e, dynamodb)

                for (ac in access.Items) {



                    let changeID = "1"
                    if (useE.Items[0].hasOwnProperty("c")) {
                        changeID = useE.Items[0].c.toString();
                    }
                    const details3 = await addVersion(subEntity.Items[0].e.toString(), "ai", access.Items[ac].ai.toString(), changeID, dynamodb);
                    const updateAuth = await updateEntity(subEntity.Items[0].e.toString(), "ai", access.Items[ac].ai.toString(), details3.v, details3.c, dynamodb);

                }
                mainObj = { "alert": "success" }
            } else if (action == "createTask") {
                const fileID = reqPath.split("/")[3]
                actionFile = fileID
                const task = reqBody.body;
                let sDate = new Date(task.startDate + 'T00:00:00Z')
                let sDateSeconds = sDate.getTime() / 1000;
                let eDate = new Date(task.endDate + 'T00:00:00Z')
                let eDateSeconds = Math.floor(eDate.getTime() / 1000);
                let ST = task.startTime
                const [sHours, sMinutes] = ST.split(':').map(Number);
                const sSeconds = (sHours * 3600) + (sMinutes * 60);
                let ET = task.endTime
                const [eHours, eMinutes] = ET.split(':').map(Number);
                const eSeconds = (eHours * 3600) + (eMinutes * 60);
                const en = reqPath.split("/")[3];
                const sd = sDateSeconds;
                const ed = eDateSeconds;
                const st = sSeconds;
                const et = eSeconds;
                const zo = task.zone;
                const it = task.interval
                const mo = task.monday
                const tu = task.tuesday
                const we = task.wednesday
                const th = task.thursday
                const fr = task.friday
                const sa = task.saturday
                const su = task.sunday
                const taskJSON = {
                    startDate: task.startDate,
                    endDate: task.endDate,
                    startTime: task.startTime,
                    endTime: task.endTime,
                    timeZone: zo,
                    monday: mo,
                    tuesday: tu,
                    wednesday: we,
                    thursday: th,
                    friday: fr,
                    saturday: sa,
                    sunday: su
                }

                const schedules = await convertTimespanToUTC(taskJSON)



                let ti
                if (task.taskID === "") {
                    ti = await incrementCounterAndGetNewValue('tiCounter', dynamodb);
                } else {
                    ti = task.taskID;
                    await removeSchedule(ti);
                }
                let ex = 0
                for (const schedule of schedules) {
                    let sDateS = new Date(schedule.startDate + 'T00:00:00Z')
                    let sDateSecondsS = sDateS.getTime() / 1000;
                    let eDateS = new Date(schedule.endDate + 'T00:00:00Z')
                    let eDateSecondsS = Math.floor(eDateS.getTime() / 1000);
                    const [sHoursS, sMinutesS] = schedule.startTime.split(':').map(Number);
                    const sSecondsS = (sHoursS * 3600) + (sMinutesS * 60);
                    const [eHoursS, eMinutesS] = schedule.endTime.split(':').map(Number);
                    const eSecondsS = (eHoursS * 3600) + (eMinutesS * 60);
                    const sdS = sDateSecondsS;
                    const edS = eDateSecondsS;
                    const stS = sSecondsS;
                    const etS = eSecondsS;
                    const itS = task.interval
                    const moS = schedule.monday
                    const tuS = schedule.tuesday
                    const weS = schedule.wednesday
                    const thS = schedule.thursday
                    const frS = schedule.friday
                    const saS = schedule.saturday
                    const suS = schedule.sunday
                    ex = eDateSecondsS + eSecondsS
                    await createSchedule(ti, en, sdS, edS, stS, etS, itS, +moS, +tuS, +weS, +thS, +frS, +saS, +suS, ex, dynamodb)
                }
                if (ex > 0) {
                    await createTask(ti, en, sd, ed, st, et, zo, it, +mo, +tu, +we, +th, +fr, +sa, +su, ex, dynamodb)
                }
                let tasksUnix = await getTasks(fileID, "su", dynamodb)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO
            } else if (action == "tasks") {
                const sub = reqPath.split("/")[3]
                let tasksUnix = await getTasks(sub, "su", dynamodb)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO
            } else if (action == "deleteTask") {
                const fileID = reqPath.split("/")[3]
                actionFile = fileID
                const task = reqBody.body;
                await removeSchedule(task.taskID);
                let tasksUnix = await getTasks(fileID, "su", dynamodb)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO
            } else if (action == "updateEntityByAI") {
                //console.log("updateEntityByAI", reqPath)
                const fileID = reqPath.split("/")[3]
                actionFile = fileID
                const prompt = reqBody.body;

                let oai = await runPrompt(prompt, fileID, dynamodb, openai, Anthropic);
                const params = {
                    Bucket: fileLocation(oai.isPublic) + ".1var.com",
                    Key: fileID,
                    Body: oai.response,
                    ContentType: "application/json"
                };

                await s3.putObject(params).promise();
                //console.log("Making oai")
                mainObj["oai"] = JSON.parse(oai.response);
                //console.log("mainObj", mainObj)
            } else if (action == "position") {

                let b = reqBody.body;

                const { description, domain, subdomain, embedding, entity, pb, output } = b || {};

                console.log("b", b)
                console.log("b.body", b.body)
                console.log("description-----------", description);
                console.log("domain", domain);
                console.log("subdomain", subdomain);
                console.log("embedding", embedding);
                console.log("entity", entity);
                if (!embedding || !domain || !subdomain || !entity) {
                    return res.status(400).json({ error: 'embedding, domain & subdomain required' });
                }
                /* 1️⃣  pull the record for that sub‑domain from DynamoDB */
                const tableName = `i_${domain}`;
                let item;
                try {
                    const params = {
                        TableName: tableName,
                        KeyConditionExpression: '#r = :sub',
                        ExpressionAttributeNames: { '#r': 'root' },
                        ExpressionAttributeValues: { ':sub': subdomain },
                        Limit: 1
                    };
                    const data = await dynamodb.query(params).promise();
                    if (!data.Items.length) {
                        return res.status(404).json({ error: 'no record for that sub‑domain' });
                    }
                    item = data.Items[0];
                } catch (err) {
                    console.error('DynamoDB query failed:', err);
                    return res.status(502).json({ error: 'db‑unavailable' });
                }
                /* 2️⃣  cosine distance helper */
                const cosineDist = (a, b) => {
                    let dot = 0, na = 0, nb = 0;
                    for (let i = 0; i < a.length; i++) {
                        dot += a[i] * b[i];
                        na += a[i] * a[i];
                        nb += b[i] * b[i];
                    }
                    return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
                };
                /* 3️⃣  compare with emb1…emb5 */
                const distances = {};
                for (let i = 1; i <= 5; i++) {
                    const attr = `emb${i}`;
                    const raw = item[attr];
                    let refArr = null;

                    if (typeof raw === 'string') {
                        try {
                            refArr = JSON.parse(raw);
                        } catch (err) {
                            console.warn(`Failed to parse ${attr} for ${domain}/${subdomain}:`, err);
                            continue;
                        }
                    }
                    else if (Array.isArray(raw)) {
                        refArr = raw;
                    }

                    if (!Array.isArray(refArr) || refArr.length !== embedding.length) {
                        continue;
                    }

                    distances[attr] = cosineDist(embedding, refArr);
                }
                console.log("!!!!pb", pb)

                try {
                    const updateParams = {
                        TableName: 'subdomains',
                        Key: { su: entity },
                        UpdateExpression: `
                        SET #d1 = :d1,
                            #d2 = :d2,
                            #d3 = :d3,
                            #d4 = :d4,
                            #d5 = :d5,
                            #path = :path,
                            #pb = :pb,
                            #output = :output
                      `,
                        ExpressionAttributeNames: {
                            '#d1': 'dist1',
                            '#d2': 'dist2',
                            '#d3': 'dist3',
                            '#d4': 'dist4',
                            '#d5': 'dist5',
                            '#path': 'path',
                            '#pb': 'pb',
                            '#output': 'output'
                        },
                        ExpressionAttributeValues: {
                            ':d1': distances.emb1 ?? null,
                            ':d2': distances.emb2 ?? null,
                            ':d3': distances.emb3 ?? null,
                            ':d4': distances.emb4 ?? null,
                            ':d5': distances.emb5 ?? null,
                            ':path': `/${domain}/${subdomain}`,
                            ':pb': pb,
                            ':output': output
                        },
                        ReturnValues: 'UPDATED_NEW'
                    };
                    const updateResult = await dynamodb.update(updateParams).promise();

                } catch (err) {
                    console.error('Failed to update subdomains table:', err);
                    return res.status(502).json({ error: 'failed to save distances' });
                }

                mainObj = {
                    action,
                    position: distances,
                    domain,
                    subdomain,
                    entity,
                    id: item.id ?? null
                }

                /************************************************************
                 *  action === "search"
                 *  ---------------------------------------------------------
                 *  Body must contain: domain, subdomain
                 *  Optional: query (original text), entity (caller id)
                 *
                 *  Reads from the "subdomains" table and returns every row
                 *  whose  path  matches  "/{domain}/{subdomain}"  AND whose
                 *  dist1…dist5  are  all  ≤  0.2  (or the DIST_LIMIT below).
                 ************************************************************/
            } else if (action === 'search') {

                const { domain, subdomain, query = '', entity = null, embedding, limit } = reqBody.body || {};
                mainObj = await searchSubdomains(embedding, domain, subdomain, entity, query, limit, action)

            } else if (action == "addIndex") {

            } else if (action == "getFile") {
                actionFile = reqPath.split("/")[3];
                let jsonpl = await retrieveAndParseJSON(actionFile, true);
                mainObj = JSON.parse(JSON.stringify(jsonpl))
            } else if (action == "shorthand") {
                console.log("SHORTHAND !!!!!!!!!!")
                actionFile = reqPath.split("/")[3];
                let { shorthand } = require('../routes/shorthand');
                const arrayLogic = reqBody.body.arrayLogic;
                const emitType = reqBody.body.emit
                console.log("arrayLogic", arrayLogic)
                console.log("emitType", emitType)
                let jsonpl = await retrieveAndParseJSON(actionFile, true);
                let shorthandLogic = JSON.parse(JSON.stringify(jsonpl))
                const blocks = shorthandLogic.published.blocks
                let originalPublished = shorthandLogic.published
                shorthandLogic.input = arrayLogic;
                shorthandLogic.input.unshift({
                    "physical": [[shorthandLogic.published]]
                })
                console.log("shorthandLogic", shorthandLogic)
                let newShorthand = await shorthand(shorthandLogic, req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, true, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken);
                console.log("newShorthand", newShorthand)
                newShorthand.published.blocks = blocks;
                console.log("newShorthand", newShorthand)
                let content = JSON.parse(JSON.stringify(newShorthand.content));
                delete newShorthand.input
                delete newShorthand.content
                let isPublishedEqual = JSON.stringify(originalPublished) === JSON.stringify(newShorthand.published);
                console.log("isPublishedEqual", isPublishedEqual)
                const params = {
                    Bucket: "public.1var.com",
                    Key: actionFile,
                    Body: JSON.stringify(newShorthand),
                    ContentType: "application/json"
                };
                await s3.putObject(params).promise();
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody);
                mainObj["newShorthand"] = newShorthand
                mainObj["content"] = content


                /*} else if (action === "convert") {
    
                    const { parseArrayLogic } = require("../routes/parseArrayLogic");
    
                    console.log("reqBody", reqBody)
                    console.log("reqBody.body", reqBody.body)
    
    
                    // app.js (inside the "convert" branch)
                    let arrayLogic = reqBody.body.arrayLogic;
    
                    // If the client sent a JSON string, turn it into a JS value
                    if (typeof arrayLogic === 'string') {
                        try {
                            arrayLogic = JSON.parse(arrayLogic);
                        } catch (err) {
                            console.error('arrayLogic is not valid JSON:', err);
                            throw new Error('Bad arrayLogic payload');   // or return 400
                        }
                    }
                    console.log("arrayLogic", arrayLogic)
                    const parseResults = await parseArrayLogic({
                        arrayLogic,          // now an array, not a string
                        dynamodb,
                        uuidv4,
                        s3,
                        ses,
                        openai,
                        Anthropic,
                        dynamodbLL
                    });
    
    
                    mainObj = { "parseResults": parseResults };
                
                    }
                */
            } else if (action === "convert") {
                const { parseArrayLogic } = require("../routes/parseArrayLogic");
                const { shorthand } = require("../routes/shorthand");

                console.log("reqBody", reqBody);
                console.log("reqBody.body", reqBody.body);

                // 1️⃣  Grab & normalise arrayLogic from the client
                let arrayLogic = reqBody.body.arrayLogic;
                let prompt = reqBody.body.prompt;
                if (typeof arrayLogic === "string") {
                    try {
                        arrayLogic = JSON.parse(arrayLogic);
                    } catch (err) {
                        console.error("arrayLogic is not valid JSON:", err);
                        throw new Error("Bad arrayLogic payload");
                    }
                    sourceType = "arrayLogic"
                } else if (typeof prompt === "string") {
                    sourceType = "prompt"
                    console.log("prompt JSON", prompt)
                    let promptInjection = JSON.parse(prompt);
                    userPath = 1000000000000128
                    let fixedPrompt = `directive = [
  \`**this is not a simulation**: do not make up or falsify any data! This is real data!\`,
  \`You are a breadcrumb app sequence generator, meaning you generate an array that is processed in sequence. Row 1, then Row 2, etc. This means any row cannot reference (ref) future rows because they have not been processed yet.\`,
  \`When the user supplies a new persistent fact or resource, **create a single breadcrumb whose method/action pair ends in “/get”.**\`,
  \`• That breadcrumb *simultaneously* stores the data and exposes a standard API for future recall (no separate “/set” or “/store” needed).\`,
  \`• If the user also wants the value immediately, invoke the same “/get” crumb in the same array and return its output in the conclusion.\`,
  \`• If the user only wants to recall something that is already exposed, skip the storage step and simply call the existing “/get”.\`,
  \`You accept {user_requests}, leverage {persistant_knowledge, previous_response, previous_processed_conclusion, relevant_items}, mimic {examples}, follow the {rules}, and organize it into {response}. Response is an array processed in sequence, where the last item is the result conclusion.\`
]

var response = [];

const user_requests = ${JSON.stringify(promptInjection.userRequest)};

const persistent_knowledge = [{"requester":"Austin Hughes", "Austin_Hughes_id":${userPath}}];

const relevant_items = ${JSON.stringify(promptInjection.relevantItems)}

const previous_request = [];

const previous_response = [];

const previous_processed_conclusion = [];

const REF_RE = /^__\\$ref\((\d+)\)(?:\.(.+))?$/;

const isBreadcrumb = key => /^[\w-]+\/.+/.test(key);

async function fetchCrumb(key, payload) {
  const res = await fetch(\`https://1var.com/getCrumbOuput/\${encodeURIComponent(key)}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function processArray(source, context = [], target = []) {
  const walk = (node, pool) => {
    if (typeof node === "string") {
      const m = REF_RE.exec(node);
      if (m) {
        let val = pool[+m[1]];
        for (const k of (m[2]?.split(".") || [])) val = val?.[k];
        return val ?? node;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((x) => walk(x, pool));
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [k, walk(v, pool)])
      );
    }
    return node;
  };

  const result = [];
  for (const raw of source) {
    let item = walk(raw, [...context, ...result]);

    if (
      item &&
      typeof item === "object" &&
      Object.keys(item).length === 1
    ) {
      const [key] = Object.keys(item);
      if (isBreadcrumb(key)) {
        const payload = item[key];
        item = {
          output: await fetchCrumb(key, payload),
        };
      }
    }
    result.push(item);
  }

  const last = walk(source.at(-1), [...context, ...result]);

  target.length = 0;
  if (Array.isArray(last.conclusion)) {
    target.push(...last.conclusion);
  } else {
    target.push(last.conclusion);
  }
  return
}

(async () => {
  await processArray(previous_response, [], previous_processed_conclusion);
  console.log(previous_processed_conclusion)
})();

breadcrumb_rules = [
  /*breadcrumb app 'key': */
  /* 0 */ \`Breadcrumb Format → root / sub‑root / clarifier(s) / locale? / context? / (method/action pairs)+\`,

  /* 1 */ \`No proper nouns anywhere → Never place company, product, or person names (or other unique identifiers) in any breadcrumb segment. All such specifics belong only in the request’s input payload.\`,

  /* 2 */ \`root → Must select a single term from this fixed list: agriculture, architecture, biology, business, characteristic, chemistry, community, cosmology, economics, education, entertainment, environment, event, food, geology, geography, government, health, history, language, law, manufacturing, mathematics, people, psychology, philosophy, religion, sports, technology, transportation.\`,

  /* 3 */ \`sub‑root → A high‑level sub‑domain of the chosen root (e.g. health/clinical, cosmology/galaxies, architecture/structures). Still entirely conceptual—no proper nouns.\`,

  /* 4 */ \`domain‑specific clarifier(s) → One or more deeply nested, slash‑separated conceptual layers that progressively narrow the topic with precise, fully spelled‑out terms (e.g. markets/assets/equity/dividends/valuation or oncology/tumor/staging/treatment/plan). Do NOT fuse concepts into a single segment; each idea gets its own breadcrumb step. No proper nouns.\`,

  /* 5 */ \`locale (optional) → Language or regional facet (e.g. english/american, multilingual/global).\`,

  /* 6 */ \`context (optional) → Perspective or use‑case lens (e.g. marketing, alert, payment, availability).\`,

  /* 7 */ \`method/action pairs → One or more repetitions of “method‑qualifier / action‑verb” (e.g. by/market‑open/sell, via/api/get). These describe *how* the request should execute. Do not include input values or schema fields here.\`,
  /*breadcrumb app 'value': */
  /* 8 */ \`input:{} → The req.body data being sent to the app. Likely sending 'relevant_items' (e.g. { "company_name": "Apple", "product_name": "iPhone 15" }).\`,

  /* 9 */ \`schema:{} → Defines the shape/type of the response data being returned. \`,

  /*10*/ \`Consistency → Always follow this hierarchy and naming discipline so the system can route requests deterministically across all domains and use‑cases.\`
];

examples = [
  \`"My favorite color is red" => [
      { "user": "1000000003" },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "string",
        "const": "red"
      },
      {
        "characteristic/preferences/color/by/user/get": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      { "conclusion": "__$ref(2).output" } // ==> red
  ]\`,

  \`"What is my favorite color?" => [
      { "user-id": "1000000003" },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "string"
      },
      {
        "characteristic/preferences/color/by/user/get": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      { "conclusion": "__$ref(2).output" } // ==> red
  ]\`,
 
  \`"When is the acoustic guitar available for an in-store demo?" =>[
      {
        "store": "Melody Music Emporium",
        "store-id": "hidden",
        "instrument": "Taylor G50 2024",
        "requested-time": "2025-05-30T19:00:00Z"
      },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "verified": {"type": "boolean"},
          "approved-data": {"type": "object"}
        },
        "required": ["verified", "approved-data"]
      },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "confirm-availability": {"type": "boolean"}
        },
        "required": ["confirm-availability"]
      },
      {
        "business/logistics/inventory/stock-verification/by/system/check/availability": {
          "input": "__$ref(0)",
          "schema": "__$ref(1)"
        }
      },
      {
        "business/sales/engagements/demo-booking/by/employee/check/availability": {
          "input": "__$ref(3).output.approved-data",
          "schema": "__$ref(2)"
        }
      },
      {
        "conclusion": {
          "availability": "__$ref(4).output"
        }
      }    
  ]\`
]

root_and_sub_roots = {
  "agriculture": subdomains("agriculture"),
  "architecture": subdomains("architecture"),
  "biology": subdomains("biology"),
  "business": subdomains("business"),
  "characteristic": subdomains("characteristic"),
  "chemistry": subdomains("chemistry"),
  "community": subdomains("community"),
  "cosmology": subdomains("cosmology"),
  "economics": subdomains("economics"),
  "education": subdomains("education"),
  "entertainment": subdomains("entertainment"),
  "environment": subdomains("environment"),
  "event": subdomains("event"),
  "food": subdomains("food"),
  "geology": subdomains("geology"),
  "geography": subdomains("geography"),
  "government": subdomains("government"),
  "health": subdomains("health"),
  "history": subdomains("history"),
  "language": subdomains("language"),
  "law": subdomains("law"),
  "manufacturing": subdomains("manufacturing"),
  "mathematics": subdomains("mathematics"),
  "people": subdomains("people"),
  "psychology": subdomains("psychology"),
  "philosophy": subdomains("philosophy"),
  "religion": subdomains("religion"),
  "sports": subdomains("sports"),
  "technology": subdomains("technology"),
  "transportation": subdomains("transportation")
}

function subdomains(domain){
    let subsArray = require('./'+domain);
    return subsArray
}
//RESPOND LIKE THE EXAMPLES ONLY
`


                    arrayLogic = fixedPrompt
                }
                console.log("arrayLogic", arrayLogic);

                // 2️⃣  First pass – evaluate the array logic
                const parseResults = await parseArrayLogic({
                    arrayLogic,
                    dynamodb,
                    uuidv4,
                    s3,
                    ses,
                    openai,
                    Anthropic,
                    dynamodbLL,
                    sourceType
                });

                // 3️⃣  If a shorthand payload was produced, immediately run the shorthand engine
                let newShorthand = null;
                let conclusion = null;
                if (parseResults?.shorthand) {

                    const arrayLogic = JSON.parse(JSON.stringify(parseResults.shorthand));
                    console.log("SHORTHAND !!!!!!!!!!")
                    actionFile = reqPath.split("/")[3];
                    let { shorthand } = require('../routes/shorthand');
                    const emitType = reqBody.body.emit
                    console.log("arrayLogic", arrayLogic)
                    console.log("emitType", emitType)
                    let jsonpl = await retrieveAndParseJSON(actionFile, true);
                    let shorthandLogic = JSON.parse(JSON.stringify(jsonpl))

                    console.log("shorthandLogic1", shorthandLogic)


                    // Deep‑clone so we can mutate safely

                    const blocks = shorthandLogic.published.blocks; // keep original blocks safe
                    const originalPublished = shorthandLogic.published;

                    // Re‑inject the client arrayLogic exactly as the standalone /shorthand route does
                    shorthandLogic.input = [{ "virtual": arrayLogic }];
                    shorthandLogic.input.unshift({ physical: [[shorthandLogic.published]] });


                    console.log("shorthandLogic2", shorthandLogic)
                    // 🪄  Run the shorthand pipeline
                    newShorthand = await shorthand(
                        shorthandLogic,
                        req,
                        res,
                        next,
                        privateKey,
                        dynamodb,
                        uuidv4,
                        s3,
                        ses,
                        openai,
                        Anthropic,
                        dynamodbLL,
                        true,              // keep the original "isPublished" flag
                        reqPath,
                        reqBody,
                        reqMethod,
                        reqType,
                        reqHeaderSent,
                        signer,
                        "shorthand",      // treat this sub‑phase as a shorthand op
                        xAccessToken
                    );
                    console.log("newShorthand4", newShorthand)
                    // Restore untouched blocks & clean temp props
                    newShorthand.published.blocks = blocks;
                    console.log("newShorthand5", newShorthand)
                    conclusion = JSON.parse(JSON.stringify(newShorthand.conclusion));
                    delete newShorthand.input;
                    delete newShorthand.conclusion;

                    // Quick checksum for callers (optional)
                    parseResults.isPublishedEqual =
                        JSON.stringify(originalPublished) === JSON.stringify(newShorthand.published);
                    console.log("originalPublished", originalPublished);
                    console.log("newShorthand.published", newShorthand.published)
                    // Persist the freshly‑generated shorthand back to S3 (mirrors the original route)
                    console.log("newShorthand6", newShorthand)
                    if (reqPath) {
                        const actionFile = reqPath.split("/")[3];
                        await s3
                            .putObject({
                                Bucket: "public.1var.com",
                                Key: actionFile,
                                Body: JSON.stringify(newShorthand),
                                ContentType: "application/json",
                            })
                            .promise();
                    }
                }

                /* 4️⃣  Return everything to the caller */
                mainObj = {
                    parseResults,
                    newShorthand,
                    arrayLogic: parseResults?.arrayLogic,
                    conclusion
                };
            } else if (action === "embed") {
                console.log("reqBody", reqBody)
                console.log("reqBody.body", reqBody.body)
                let text = reqBody.body.text
                let parsedText = JSON.parse(text)
                let stringifyText = JSON.stringify(parsedText)
                console.log("stringifyText", stringifyText)
                const { data } = await openai.embeddings.create({
                    model: 'text-embedding-3-large',
                    input: stringifyText
                });
                console.log("data", data);
                console.log("data[0]", data[0]);
                console.log("data[0].embedding", data[0].embedding);
                console.log(" reqBody.body.requestId", reqBody.body.requestId);
                mainObj["embedding"] = data[0].embedding;
                mainObj["requestId"] = reqBody.body.requestId;
            } else if (action === "createUser") {
                const now = Date.now();
                const newUser = {
                    userID: parseInt(reqBody.body.userID),
                    emailHash: reqBody.body.emailHash,
                    pubEnc: reqBody.body.pubEnc,
                    pubSig: reqBody.body.pubSig,
                    created: now,
                    revoked: !!reqBody.body.revoked,
                    latestKeyVersion: reqBody.body.latestKeyVersion ?? 1
                };
                const params = { TableName: "users", Item: newUser, ConditionExpression: "attribute_not_exists(e)" };
                try {
                    const createUserResult = await dynamodb.put(params).promise();
                } catch (err) {
                    if (err.code === "ConditionalCheckFailedException") {
                        console.error("User already exists");
                    } else {
                        throw err;
                    }
                }
            } else if (action === "getUserPubKeys") {
                console.log("getUserPubKeys555")
                console.log("reqBody.body", reqBody.body)
                // 1. Sanitise / validate input
                const userID = String(reqBody.body.userID ?? "").trim();
                if (!userID) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: "userID required" })
                    };
                }

                /* 2. Fetch just the three columns we need            *
                 *    (projection keeps RCUs low and hides extras)    */
                const params = {
                    TableName: "users",
                    Key: { userID: parseInt(userID) },
                    ProjectionExpression: "pubEnc, pubSig, latestKeyVersion"
                };

                const { Item } = await dynamodb.get(params).promise();

                if (!Item) {
                    return {
                        statusCode: 404,
                        body: JSON.stringify({ error: "user not found" })
                    };
                }

                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        pubEnc: Item.pubEnc,
                        pubSig: Item.pubSig,
                        latestKeyVersion: Item.latestKeyVersion
                    })
                };

                /* ─────────────── ADD / WRAP PASSPHRASE ─────────────── */
            } else if (action === "wrapPassphrase" || action === "addPassphrase") {
                console.log("wrapPassphrase555 || addPassphrase555")
                console.log("reqBody.body", reqBody.body)
                const { passphraseID, keyVersion, wrapped } = reqBody.body || {};

                // Basic validation
                if (!passphraseID || !keyVersion || !wrapped || typeof wrapped !== "object") {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: "Invalid payload" })
                    };
                }

                const params = {
                    TableName: "passphrases",
                    Item: {
                        passphraseID,
                        keyVersion: Number(keyVersion),
                        wrapped,  
                        created: new Date().toISOString()
                    },
                    ConditionExpression: "attribute_not_exists(passphraseID)"
                };

                try {
                    await dynamodb.put(params).promise();
                    return {
                        statusCode: 200,
                        body: JSON.stringify({ success: true })
                    };
                } catch (err) {
                    if (err.code === "ConditionalCheckFailedException") {
                        return {
                            statusCode: 409,
                            body: JSON.stringify({ error: `passphraseID \"${passphraseID}\" already exists` })
                        };
                    }
                    throw err; 
                }

            } else if (action == "runEntity") {
                //console.log("reqPath", reqPath);
                //console.log("reqPath.split('?')[0]", reqPath.split("?")[0]);
                //console.log('reqPath.split("?")[0].split("/")[3]', reqPath.split("?")[0].split("/")[3])
                actionFile = reqPath.split("?")[0].split("/")[3];
                //console.log("runEntity inside", actionFile)
                let subBySU = await getSub(actionFile, "su", dynamodb);
                console.log("actionFile", actionFile)
                console.log("subBySU", subBySU)

                console.log("subBySU.Items[0].output", subBySU.Items[0].output);
                console.log("typeof subBySU.Items[0].output", typeof subBySU.Items[0].output);
                if (subBySU.Items[0].output == undefined || subBySU.Items[0].output == "") {
                    let { runApp } = require('../app');
                    //console.log("running app runApp 12345")
                    let ot = await runApp(req, res, next)
                    console.log("ot", ot)
                    //if (ot){
                    ot.existing = true;
                    return ot?.chainParams
                } else {
                    return subBySU.Items[0].output
                }

                //} else {
                //    return
                //}
            }
            /* else if (action == "transcribe"){
                mainObj["presign"] = await getPresignedUrl();
            } */



            mainObj["existing"] = cookie.existing;
            mainObj["file"] = actionFile + ""
            response = mainObj

            console.log("response 007=>", response)

            if (action === "file") {
                const expires = 90_000;
                const url = `https://${fileLocation(isPublic)}.1var.com/${actionFile}`;

                const policy = JSON.stringify({
                    Statement: [{
                        Resource: url,
                        Condition: {
                            DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + expires) / 1000) }
                        }
                    }]
                });

                if (reqType === 'url') {                          // direct CloudFront URL
                    const signedUrl = signer.getSignedUrl({ url, policy });
                    return sendBack(res, "json", { signedUrl }, isShorthand);
                }

                /* signed‑cookies branch */
                const cookies = signer.getSignedCookie({ policy });
                Object.entries(cookies).forEach(([name, val]) => {
                    res.cookie(name, val, {
                        maxAge: expires,
                        httpOnly: true,
                        domain: '.1var.com',
                        secure: true,
                        sameSite: 'None'
                    });
                });

                return sendBack(res, "json", { ok: true, response }, isShorthand);

            } else if (action === "reqPut") {
                const bucketName = `${fileLocation(isPublic)}.1var.com`;
                const fileName = actionFile;
                const expires = 90_000;

                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Expires: expires,
                    ContentType: `${fileCategory}/${fileType}`
                };

                try {
                    /* v2 SDK wrapped with promisify so we can await it */
                    const url = await getSignedUrlAsync('putObject', params);
                    response.putURL = url;
                    return sendBack(res, "json", { ok: true, response }, isShorthand);
                } catch (err) {
                    console.error('getSignedUrl failed:', err);
                    return sendBack(res, "json", { ok: false, response: {} }, isShorthand);
                }

            } else {
                console.log("007 => 1")
                /* fall‑through: always respond */
                if (response.hasOwnProperty("ot")) {
                    console.log("007 => 1")

                } else if (isShorthand) {
                    console.log("007 => 2")
                    return sendBack(res, "json", { ok: true, response }, isShorthand);

                } else {
                    console.log("007 => 3")
                    console.log("sendBack", { ok: true, response })
                    //if (response.file !== "" || !response.hasOwnProperty("status")) {
                    return sendBack(res, "json", { ok: true, response }, isShorthand);
                    //}
                }
            }

            /* ── NEW: final catch‑all so the function never resolves to undefined ── */
            //return sendBack(res, "json", { ok: true, response }, isShorthand);

        } else {
            return sendBack(res, "json", {}, isShorthand);
        }
    } else {

        return sendBack(res, "json", {}, isShorthand);
    }
}
function sendBack(res, type, val, isShorthand) {
    console.log("sendBack", val, type, isShorthand)

    if (!isShorthand) {
        res.json(val)
    } else {
        return val
    }
}
function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
    console.log("setupRouter!!!!!!!!!!!!!!!")
    router.all('/*', async function (req, res, next) {
        let xAccessToken = req.body.headers["X-accessToken"]
        let originalHost = req.body.headers["X-Original-Host"];
        let splitOriginalHost = originalHost.split("1var.com")[1];
        const signer = new AWS.CloudFront.Signer(keyPairId, privateKey);
        let reqPath = splitOriginalHost.split("?")[0];
        let reqBody = req.body;
        const action = reqPath.split("/")[2];
        const reqMethod = req.method;
        const reqType = req.type;
        const reqHeaderSent = req._headerSent;
        let newReq = {};
        newReq.body = req.body
        newReq.method = req.method
        newReq.type = req.type
        newReq._headerSent = req._headerSent
        newReq.path = req.path
        route(newReq, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, false, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken)
    });
    return router;
}
module.exports = {
    route,
    setupRouter,
    getHead,
    convertToJSON,
    manageCookie,
    getSub,
    createVerified,
    incrementCounterAndGetNewValue,
    getWord,
    createWord,
    addVersion,
    updateEntity,
    getEntity,
    verifyThis
}
