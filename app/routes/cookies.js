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
    console.log("inside getEntity", e)
    params = { TableName: 'entities', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': e } };
    return await dynamodb.query(params).promise()
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
    body
) {
    //console.log("fileID", fileID)
    //console.log("cookie", cookie)
    //console.log("body", body)
    const { verified, subBySU, entity, isPublic } = await verifyThis(fileID, cookie, dynamodb, body);
    //console.log("verified", verified)
    //console.log("subBySU", subBySU)
    //console.log("entity", entity)
    //console.log("isPublic", isPublic)
    if (!verified) {
        return { obj: {}, paths: {}, paths2: {}, id2Path: {}, groups: {}, verified: false };
    }
    let children = mapping?.[subBySU.Items[0].e] || entity.Items[0].t;
    const linked = entity.Items[0].l;
    const head = await getWord(entity.Items[0].a, dynamodb);
    const name = head.Items[0].r;
    const pathUUID = await getUUID(uuidv4)
    const using = Boolean(entity.Items[0].u);
    const obj = {};
    const paths = {};
    const paths2 = {};




    if (id2Path == null) {
        id2Path = {}
    }
    if (parentPath2 == null) {
        parentPath2 = []
    }
    if (usingID == null) {
        usingID = ""
    }
    id2Path[fileID] = pathUUID;
    const subH = await getSub(entity.Items[0].h, "e", dynamodb);
    if (subH.Count === 0) {
        await sleep(2000);
    }
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
        location: fileLocation(isPublic),
        verified: verified
    };
    const newParentPath = isUsing ? [...parentPath] : [...parentPath, fileID];
    const newParentPath2 = isUsing ? [...parentPath2] : [...parentPath2, fileID];
    paths[fileID] = newParentPath;
    paths2[pathUUID] = newParentPath2;
    if (children && children.length > 0 && convertCounter < 1000) {
        convertCounter += children.length;
        const childPromises = children.map(async (child) => {
            const subByE = await getSub(child, "e", dynamodb);
            const uuid = subByE.Items[0].su;
            console.log("returning children")
            return await convertToJSON(uuid, newParentPath, false, mapping, cookie, dynamodb, uuidv4, pathUUID, newParentPath2, id2Path, usingID, dynamodbLL, body);
        });
        const childResponses = await Promise.all(childPromises);
        for (const childResponse of childResponses) {
            Object.assign(obj[fileID].children, childResponse.obj);
            Object.assign(paths, childResponse.paths);
            Object.assign(paths2, childResponse.paths2);
        }
    }
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
    if (linked && linked.length > 0) {
        const linkedPromises = linked.map(async (link) => {
            const subByE = await getSub(link, "e", dynamodb);
            const uuid = subByE.Items[0].su;
            console.log("performing convertToJSON LINKED")
            return await convertToJSON(uuid, newParentPath, false, null, cookie, dynamodb, uuidv4, pathUUID, newParentPath2, id2Path, usingID, dynamodbLL, body);
        });
        const linkedResponses = await Promise.all(linkedPromises);
        for (const linkedResponse of linkedResponses) {
            Object.assign(obj[fileID].linked, linkedResponse.obj);
            Object.assign(paths, linkedResponse.paths);
            Object.assign(paths2, linkedResponse.paths2);
        }
    }
    //console.log("getGroups")
    const groupList = await getGroups(dynamodb);
    //console.log("returning ----", groupList)
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
    console.log("getHead", by, value)
    const subBySU = await getSub(value, by, dynamodb);
    console.log("getEntity", subBySU)
    const entity = await getEntity(subBySU.Items[0].e, dynamodb)
    console.log("getSub", entity)
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
    if (xAccessToken) {
        mainObj["status"] = "authenticated";
        let val = xAccessToken;
        let cookie = await getCookie(val, "ak")
        return cookie.Items[0]
    } else {
        const ak = await getUUID(uuidv4)
        const ci = await incrementCounterAndGetNewValue('ciCounter', dynamodb);
        const gi = await incrementCounterAndGetNewValue('giCounter', dynamodb);
        const ttlDurationInSeconds = 86400;
        const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
        await createCookie(ci.toString(), gi.toString(), ex, ak)
        mainObj["accessToken"] = ak;
        res.cookie('accessToken', ak, {
            domain: '.1var.com',
            maxAge: ttlDurationInSeconds * 1000,
            httpOnly: true,
            secure: true,
            sameSite: 'None'
        });
        return { "ak": ak, "gi": gi, "ex": ex, "ci": ci }
    }
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


async function retrieveAndParseJSON(fileName, isPublic) {
    let fileLocation = "private"
    if (isPublic == "true" || isPublic == true) {
        fileLocation = "public"
    }
    const params = { Bucket: fileLocation + '.1var.com', Key: fileName };
    const data = await s3.getObject(params).promise();

    return await JSON.parse(data.Body.toString('utf-8'));
}

async function route(req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, isShorthand, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken) {

    console.log("PROMISE CHECK )))", req, res, privateKey, reqBody, reqMethod, reqType, reqHeaderSent, action)
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
    console.log("reqMethod", reqMethod)
    if (reqMethod === 'GET' || reqMethod === 'POST') {


        let cookie = await manageCookie(mainObj, xAccessToken, res, dynamodb, uuidv4)

        const verifications = await getVerified("gi", cookie.gi.toString(), dynamodb)

        let splitPath = reqPath.split("/")

        let verified = await verifyPath(splitPath, verifications, dynamodb);


        let allV = allVerified(verified);
        console.log("allV", allV)
        if (allV) {
            console.log("action", action)
            if (action == "shorthand") {
                actionFile = reqPath.split("/")[3];
                let { shorthand } = require('../routes/shorthand');
                const arrayLogic = reqBody.body.arrayLogic;
                const emitType = reqBody.body.emit
                console.log("arrayLogic", arrayLogic)
                console.log("emitType", emitType)
                let jsonpl = await retrieveAndParseJSON(actionFile, true);
                let shorthandLogic = JSON.parse(JSON.stringify(jsonpl))
                const blocks = shorthandLogic.published.blocks
                shorthandLogic.input = arrayLogic;
                shorthandLogic.input.unshift({
                    "physical": [[shorthandLogic.published]]
                })
                console.log("shorthandLogic", shorthandLogic)
                let newShorthand = await shorthand(shorthandLogic, req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, true, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken);
                console.log("newShorthand", newShorthand)
                newShorthand.published.blocks = blocks;
                console.log("newShorthand", newShorthand)
                delete newShorthand.input
                const params = {
                    Bucket: "public.1var.com",
                    Key: actionFile,
                    Body: JSON.stringify(newShorthand),
                    ContentType: "application/json"
                };
                await s3.putObject(params).promise();
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody);
                mainObj["newShorthand"] = newShorthand
            } else if (action == "runEntity") {
                actionFile = reqPath.split("?")[0].split("/")[3];
                let { runApp } = require('../app');
                let ot = await runApp(req, res, next)
                console.log("ot", ot)
                if (ot){
                    return ot?.chainParams
                } else {
                    return
                }
            }
            mainObj["file"] = actionFile + ""
            response = mainObj

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
                /* fall‑through: always respond */
                console.log("isShorthand", isShorthand)
                console.log("!!!RESPONSE!!!", response)
                console.log(reqBody.headers['X-Original-Host'])
                console.log(reqBody.headers['X-Original-Host'].includes("https://abc.api.1var.com/cookies/file"))
                console.log(reqBody.headers['X-Original-Host'].includes("https://abc.api.1var.com/cookies/runEntity"))
                console.log(reqBody.headers['X-Original-Host'].includes("https://abc.api.1var.com/cookies/get"))
                if (response.hasOwnProperty("ot")) {

                } else if (isShorthand) {

                } else {
                    //if (response.file !== "" || !response.hasOwnProperty("status")) {
                    return sendBack(res, "json", { ok: true, response }, isShorthand);
                    //}
                }
            }

        } else {
            return sendBack(res, "json", {}, isShorthand);
        }
    } else {

        return sendBack(res, "json", {}, isShorthand);
    }
}
function sendBack(res, type, val, isShorthand) {


    if (!isShorthand) {
        res.json(val)
    } else {
        return val
    }
}
function setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic) {
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
