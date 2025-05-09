var express = require('express');
var router = express.Router();
const AWS = require('aws-sdk');
var router = express.Router();
const moment = require('moment-timezone')
const { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand } = require("@aws-sdk/client-scheduler");
const keyPairId = 'K2LZRHRSYZRU3Y';

let convertCounter = 0
let isPublic = true

async function getSub(val, key, dynamodb) {
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
    params = { TableName: 'entities', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': e } };
    return await dynamodb.query(params).promise()
}

async function getTasks(val, col, dynamodb) {
    //
    //
    //
    //
    // This function gets the tasks by by taking the e, getting the sub and then finding the url by sub
    //
    //
    //
    //
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
    console.log("getGroup", g)
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
    console.log("getAccess", ai)
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
    console.log("getVerified", key, val)
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
    console.log("getWord", a)
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
    console.log("getGroups")
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
    console.log("fileLocation", val)
    let location = "private"
    if (val == "true" || val == true) {
        location = "public"
    }
    console.log("return", location)
    return location
}

function setIsPublic(val) {
    console.log("setIsPublic", val)
    if (val == "true" || val == true) {
        isPublic = true
    } else {
        isPublic = false
    }
    return isPublic;
}

async function verifyThis(fileID, cookie, dynamodb, body) {
    console.log("verifyThis", fileID, cookie)
    const subBySU = await getSub(fileID, "su", dynamodb);
    const isPublic = setIsPublic(subBySU.Items[0].z);
    const entity = await getEntity(subBySU.Items[0].e, dynamodb);
    const group = await getGroup(entity.Items[0].g, dynamodb);

    const groupAi = group.Items[0].ai;
    const entityAi = entity.Items[0].ai;
    let verified

    if (isPublic) {
        verified = true;
    } else {
        const verify = await getVerified("gi", cookie.gi.toString(), dynamodb, body);
        console.log("verify", verify)

        verified = verify.Items.some(veri => groupAi.includes(veri.ai) && veri.bo); // is the group access id == cookie access id
        //cant use .some. we need to know which ai objects are being used and merge the access types  rw + pd = rwpd
        console.log("groupAi", groupAi)
        console.log("entityAi", entityAi)
        console.log("verified1", verified)
        if (!verified) { // if the group isn't able to be verified, then try individual entities
            console.log("inside condition")
            verified = verify.Items.some(veri => entityAi.includes(veri.ai) && veri.bo); // is the entity access id == cookie access id
            //cant use .some. we need to know which ai objects are being used and merge the access types  rw + pd = rwpd

            let bb = {};
            if (body) {
                bb = JSON.parse(JSON.stringify(body));
            }

            if (bb.hasOwnProperty("body")) {
                console.log("body.body", body);
                bb = JSON.parse(JSON.stringify(body.body));
            }

            console.log("verified2", verified);

            for (x = 0; x < entityAi.length; x++) {
                let access = await getAccess(entityAi[x], dynamodb);
                console.log("access.Items[0].va", access.Items[0].va);
                console.log("body2", bb);

                let deep = true;//await deepEqual(access.Items[0].va, bb);
                console.log("deep", deep);
                if (deep == true && verified == false) {
                    console.log("inside deep condition");
                    console.log("fileID", fileID);
                    console.log("body.headers.X-accessToken", body.headers["X-accessToken"]);
                    let usingAuth = await useAuth(fileID, entity, access, cookie, dynamodb);
                    console.log("usingAuth", usingAuth);
                    verified = true;
                }
            }
            console.log("verified3", verified);
        }
        console.log("verified4", verified);
    }
    console.log("verified5", verified);


    console.log("isPublic", isPublic);
    console.log("=>", verified, subBySU, entity, isPublic);
    return { verified, subBySU, entity, isPublic };
}

async function useAuth(fileID, Entity, access, cookie, dynamodb) {

    // gett the sub is using a cookie. It probably shoould be the entity we want to access or that shouold recieve the acccess.


    const ttlDurationInSeconds = 90000; // For example, 1 hour
    //console.log("J")
    const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
    //console.log("K")
    const vi = await incrementCounterAndGetNewValue('viCounter', dynamodb);
    //console.log("L")
    //console.log("vi", vi)
    await createVerified(vi.toString(), cookie.gi.toString(), "0", Entity.Items[0].e.toString(), access.Items[0].ai.toString(), "0", ex, true, 0, 0)



    const details3 = await addVersion(Entity.Items[0].e.toString(), "ai", access.Items[0].ai.toString(), Entity.Items[0].c.toString(), dynamodb);
    console.log("updateEntity", Entity.Items[0].e.toString(), "ai", access.Items[0].ai.toString(), details3.v, details3.c)
    const updateAuth = await updateEntity(Entity.Items[0].e.toString(), "ai", access.Items[0].ai.toString(), details3.v, details3.c, dynamodb);
    console.log("updateAuth", updateAuth)
    return true
}

const deepEqual = (value1, value2) => {
    if (value1 === value2) return true;

    // Check for Buffer comparison
    if (Buffer.isBuffer(value1) && Buffer.isBuffer(value2)) {
        return Buffer.compare(value1, value2) === 0;
    }

    // Check for Array comparison
    if (Array.isArray(value1) && Array.isArray(value2)) {
        if (value1.length !== value2.length) return false;
        return value1.every((item, index) => deepEqual(item, value2[index]));
    }

    // Check for CSV comparison by parsing to arrays
    if (typeof value1 === 'string' && typeof value2 === 'string') {
        if (isCSV(value1) && isCSV(value2)) {
            return deepEqual(parseCSV(value1), parseCSV(value2));
        }
    }

    // Check for JSON object comparison
    if (isObject(value1) && isObject(value2)) {
        const keys1 = Object.keys(value1);
        const keys2 = Object.keys(value2);
        if (keys1.length !== keys2.length) return false;
        return keys1.every(key => deepEqual(value1[key], value2[key]));
    }

    // For other types (string, number, etc.), they must match exactly
    return value1 === value2;
};

const isObject = (val) => val && typeof val === 'object' && !Array.isArray(val) && !Buffer.isBuffer(val);

// Helper function to check if a string is in CSV format (simple check)
const isCSV = (str) => str.includes(',') || str.includes('\n');

// Helper function to parse a CSV string into a 2D array for comparison
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

    const { verified, subBySU, entity, isPublic } = await verifyThis(fileID, cookie, dynamodb, body);

    console.log("convertToJSON")

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
    console.log("id2Path", id2Path)
    console.log("pathUUID", pathUUID)
    console.log("parentPath2", parentPath2)
    console.log("usingID", usingID)
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
        location: fileLocation(isPublic)
    };

    const newParentPath = isUsing ? [...parentPath] : [...parentPath, fileID];
    const newParentPath2 = isUsing ? [...parentPath2] : [...parentPath2, fileID];

    paths[fileID] = newParentPath;
    paths2[pathUUID] = newParentPath2;

    // Process children in parallel
    if (children && children.length > 0 && convertCounter < 1000) {
        convertCounter += children.length;

        const childPromises = children.map(async (child) => {
            const subByE = await getSub(child, "e", dynamodb);
            const uuid = subByE.Items[0].su;
            return await convertToJSON(uuid, newParentPath, false, mapping, cookie, dynamodb, uuidv4, pathUUID, newParentPath2, id2Path, usingID, dynamodbLL, body);
        });

        const childResponses = await Promise.all(childPromises);
        for (const childResponse of childResponses) {
            Object.assign(obj[fileID].children, childResponse.obj);
            Object.assign(paths, childResponse.paths);
            Object.assign(paths2, childResponse.paths2);
        }
    }

    // Process 'using' entity
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

    // Process linked entities
    if (linked && linked.length > 0) {
        const linkedPromises = linked.map(async (link) => {
            const subByE = await getSub(link, "e", dynamodb);
            const uuid = subByE.Items[0].su;
            return await convertToJSON(uuid, newParentPath, false, null, cookie, dynamodb, uuidv4, pathUUID, newParentPath2, id2Path, usingID, dynamodbLL, body);
        });

        const linkedResponses = await Promise.all(linkedPromises);
        for (const linkedResponse of linkedResponses) {
            Object.assign(obj[fileID].linked, linkedResponse.obj);
            Object.assign(paths, linkedResponse.paths);
            Object.assign(paths2, linkedResponse.paths2);
        }
    }

    const groupList = await getGroups(dynamodb);

    return { obj, paths, paths2, id2Path, groups: groupList };
}

const updateEntity = async (e, col, val, v, c, dynamodb) => {
    //console.log("updateEntity")
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
        //console.log("params", params)
        return await dynamodb.update(params).promise();
    } catch (error) {
        //console.error("Error updating entity:", error);
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
    //console.log("by, value", by, value)
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

async function addVersion(newE, col, val, forceC, dynamodb) {
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
        //console.error("Error adding record:", error);
        return null
    }
};

const createFile = async (su, fileData, s3) => {
    console.log("createFile")
    console.log("fileData", JSON.stringify(fileData, null, 2));
    const jsonString = JSON.stringify(fileData);
    const bucketParams = {
        Bucket: fileLocation(isPublic) + '.1var.com',
        Key: su,
        Body: jsonString,
        ContentType: 'application/json'
    };
    const data = await s3.putObject(bucketParams).promise();
    console.log("s3 response", data)
    return true;
}

const updateJSONL = async (newLine, keys, s3) => {
    try {
        // Validate newLine is a valid JSON string
        JSON.parse(newLine);
        let VAR = JSON.parse(newLine.completion)

        for (let key in VAR) {
            // If the key is not in the array, delete it
            if (!keys.includes(key)) {
                delete VAR[key];
            }
        }
        newLine.completion = JSOn.stringify(VAR)

        const getParams = { Bucket: 'private.1var.com', Key: 'training.jsonl' };
        const data = await s3.getObject(getParams).promise();
        const etag = data.ETag; // The ETag of the object

        // Append the new line
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
            // Remove IfMatch as it's not valid for putObject
            // If you want to ensure safe updates, use versioning or lock mechanisms
        };

        // Use putObject without IfMatch
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
        //training_file: 'file-var001',
        //model: 'gpt-4o-mini-2024-07-18'
    } else if (method == "list") {
        fineTune = await openai.fineTuning.jobs.list({ limit: parseInt(val) });

    } else if (method == "delete") {
        fineTune = await openai.models.delete(val);
        //'ft:gpt-3.5-turbo:acemeco:suffix:abc123'
    } else if (method == "events") {
        fineTune = await openai.fineTuning.jobs.listEvents(val, { limit: parseInt(sub) });
        // valis fineTune.id
    } else if (method == "retrieve") {
        fineTune = await openai.fineTuning.jobs.retrieve(val);

    } else if (method == "cancel") {
        fineTune = await openai.fineTuning.jobs.cancel(val);

    }
    console.log("fineTune", fineTune)
    return fineTune
}






const createEntity = async (e, a, v, g, h, ai, dynamodb) => {
    //console.log("createEntity")
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
        //console.error("Error creating entity:", error);
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
        //console.error("Error creating entity:", error);
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

    //console.log("file", file)

    if (val == "true" || val == true) {
        //console.log("val == true")
        sourceBucket = 'private.1var.com'
        destinationBucket = 'public.1var.com'
    } else {
        //console.log("val == false")
        sourceBucket = 'public.1var.com'
        destinationBucket = 'private.1var.com'
    }

    const versions = await s3.listObjectVersions({
        Bucket: sourceBucket,
        Prefix: file
    }).promise();

    //console.log("versions", versions)

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    for (let x = versions.Versions.length - 1; x >= 0; x--) {
        const version = versions.Versions[x];
        //console.log("version", version)
        // Retrieve current metadata
        let param1 = {
            Bucket: sourceBucket,
            Key: file,
            VersionId: version.VersionId
        }
        //console.log("param1", param1)
        let originalMetadata = await s3.headObject(param1).promise();
        //console.log("originalMetadata", originalMetadata)
        // Prepare new metadata with additional custom data
        let newMetadata = {
            ...originalMetadata.Metadata, // Copy original user-defined metadata
            'originalversionid': version.VersionId // Add your custom metadata
        };


        //
        ///
        //
        ///
        //
        ///
        ///
        ///
        //
        //
        //
        //
        //
        //
        //


        //console.log("newMetadata", newMetadata)
        // Copy the object with the original 'Content-Type'
        let param2 = {
            Bucket: destinationBucket,
            CopySource: `${sourceBucket}/${file}?versionId=${version.VersionId}`,
            Key: file,
            Metadata: newMetadata,
            ContentType: originalMetadata.ContentType, // Set the original 'Content-Type'
            MetadataDirective: "REPLACE"
        }
        //console.log("param2", param2)
        let copyResponse = await s3.copyObject(param2).promise();
        //console.log("copyResponse", copyResponse)
        // Optionally, delete the original version
        let param3 = {
            Bucket: sourceBucket,
            Key: file,
            VersionId: version.VersionId
        }
        //console.log("param3", param3)
        let deleteResponse = await s3.deleteObject(param3).promise();
        //console.log("deleteResponse", deleteResponse)
        // Wait for 1 second before processing the next version
        await delay(1000);
    }







    return { status: 'All versions moved successfully' };

}

async function linkEntities(childID, parentID) {
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

async function email(from, to, subject, emailText, emailHTML, ses) {
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
        //console.log('Email sent:', data);
        return { statusCode: 200, body: JSON.stringify(data) };
    } catch (error) {
        //console.error('Error sending email:', error);
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
    //console.log("req1", req)
    if (xAccessToken) {
        //console.log("has X-accessToken")
        mainObj["status"] = "authenticated";
        let val = xAccessToken;
        //console.log("X-accessToken = ", val)
        let cookie = await getCookie(val, "ak")
        //console.log("cookie.Items[0]", cookie.Items[0])
        return cookie.Items[0]
    } else {
        //console.log("1")
        const ak = await getUUID(uuidv4)
        //console.log("2")
        const ci = await incrementCounterAndGetNewValue('ciCounter', dynamodb);
        //console.log("3")
        const gi = await incrementCounterAndGetNewValue('giCounter', dynamodb);
        //console.log("4")
        const ttlDurationInSeconds = 86400; // For example, 1 hour
        const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
        //console.log("createCookie=>", ci.toString(), gi.toString(), ex, ak)
        await createCookie(ci.toString(), gi.toString(), ex, ak)
        mainObj["accessToken"] = ak;
        //console.log({domain: '.1var.com', maxAge: ttlDurationInSeconds,  httpOnly: true, secure: true, sameSite: 'None' })
        res.cookie('accessToken', ak, {
            domain: '.1var.com',
            maxAge: ttlDurationInSeconds * 1000,
            httpOnly: true, // Inaccessible to client-side JS
            secure: true, // Only sent over HTTPS
            sameSite: 'None' // Can be 'Lax', 'Strict', or 'None'. 'None' requires 'secure' to be true.
        });
        return { "ak": ak, "gi": gi, "ex": ex, "ci": ci }
    }
}

async function createAccess(ai, g, e, ex, at, to, va, ac) {
    //console.log("access", ai, g, e, ex, at, to, va, ac)
    return await dynamodb.put({
        TableName: 'access',
        Item: { ai: ai, g: g, e: e, ex: ex, at: at, to: to, va: va, ac: ac }
    }).promise();
}

async function createVerified(vi, gi, g, e, ai, va, ex, bo, at, ti) {
    //console.log("createVerified", vi, gi, g, e, ai, va, ex, bo, at, ti)
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
        //console.log("list:1", list[l])
        if (list[l] != true) {
            //console.log("false")
            v = false
        }
    }
    //console.log("v", v)
    return v
}

async function verifyPath(splitPath, verifications, dynamodb) {
    console.log("splitPath", splitPath)
    console.log("vertifyPath", verifications)
    let verified = [];
    let verCounter = 0;
    for (ver in splitPath) {
        if (splitPath[ver].startsWith("1v4r")) {
            let verValue = false
            verified.push(false)
            const sub = await getSub(splitPath[ver], "su", dynamodb);
            console.log("sub", sub)
            console.log("sub.Items[0].z", sub.Items[0].z)
            let groupID = sub.Items[0].g
            let entityID = sub.Items[0].e
            if (sub.Items[0].z) {
                verValue = true
            }
            for (veri in verifications.Items) {
                console.log("^^^^^^^^^^^^^^^^^^^^^^^^")
                console.log("groupID", groupID)
                console.log("entityID", entityID)

                if (entityID != "0") {
                    console.log("entityID!=0")
                    let eSub = await getEntity(sub.Items[0].e, dynamodb)
                    console.log("eSub", eSub)
                    groupID = eSub.Items[0].g
                    console.log("eSub.Items[0].ai", eSub.Items[0].ai)
                    if (eSub.Items[0].ai.toString() == "0") {
                        verValue = true
                        console.log("verValue1", verValue)
                    }
                    console.log("groupID2", groupID)
                }

                if (sub.Items.length > 0) {
                    console.log("entityID3", entityID)
                    console.log("groupID3", groupID)
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
                        //MAYBE THIS IS NOT NEEDED. ADDED IT BUT NEVER TESTED IT
                        console.log("e and g are 0 so verValue is true")
                        verValue = true;
                    }
                }
            }
            //console.log("verValue", verValue)
            verified[verCounter] = verValue
            verCounter++;
            //console.log("verCounter", verCounter)
        }
    }
    //console.log("verified", verified)
    return verified
}

async function createTask(ti, en, sd, ed, st, et, zo, it, mo, tu, we, th, fr, sa, su, ex, dynamodb) {
    //console.log("createTask", ti, en, sd, ed, st, et, zo, it, mo, tu, we, th, fr, sa, su, ex)
    await dynamodb.put({
        TableName: 'tasks',
        Item: { ti: ti.toString(), url: en, sd: sd, ed: ed, st: st, et: et, zo: zo, it: it, mo: mo, tu: tu, we: we, th: th, fr: fr, sa: sa, su: su, ex: ex }
    }).promise();
    return ti
}

async function createSchedule(ti, en, sdS, edS, stS, etS, itS, moS, tuS, weS, thS, frS, saS, suS, ex, dynamodb) {
    //console.log("createSchedule", ti, en, sdS, edS, stS, etS, itS, moS, tuS, weS, thS, frS, saS, suS, ex)
    const si = await incrementCounterAndGetNewValue('siCounter', dynamodb);
    await dynamodb.put({
        TableName: 'schedules',
        Item: { si: si.toString(), ti: ti.toString(), url: en, sd: sdS, ed: edS, st: stS, et: etS, it: itS, mo: moS, tu: tuS, we: weS, th: thS, fr: frS, sa: saS, su: suS, ex: ex }
    }).promise();

    let stUnix = sdS + stS
    let etUnix = sdS + etS
    var objDate = moment.utc(stUnix * 1000); // Assuming stUnix is your Unix timestamp
    //console.log(objDate)
    const today = moment.utc(); // Get current time in UTC
    //console.log(today)

    // Check if momentObj is today by comparing year, month, and day
    var isToday = objDate.isSame(today, 'day');
    //console.log(isToday)

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

    //console.log("isToday", isToday);
    //console.log("isTodayOn", isTodayOn);

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
            //console.log("hour", hour, "minute", minute)
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

            //console.log("input2", input)
            const command = new UpdateScheduleCommand(input);

            const createSchedule = async () => {
                try {
                    const response = await client.send(command);

                    const params = {
                        TableName: "enabled",
                        Key: {
                            "time": scheduleName, // Specify the key of the item you want to update
                        },
                        UpdateExpression: "set #enabled = :enabled, #en = :en",
                        ExpressionAttributeNames: {
                            "#enabled": "enabled", // Attribute name alias to avoid reserved words issues
                            "#en": "en"
                        },
                        ExpressionAttributeValues: {
                            ":enabled": 1, // New value for 'enabled'
                            ":en": enData.Items[0].x // New value for 'en'
                        },
                        ReturnValues: "UPDATED_NEW" // Returns the attribute values as they appear after the UpdateItem operation
                    };

                    try {
                        const result = await dynamodb.update(params).promise();
                        //console.log(`Updated item with time: ${scheduleName}`, result);
                    } catch (err) {
                        //console.error(`Error updating item with time: ${scheduleName}`, err);
                    }

                    //console.log("Schedule created successfully:", response.ScheduleArn);
                } catch (error) {
                    //console.error("Error creating schedule:", error);
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
    //console.log("removeSchedule", queryParams)
    await dynamodb.query(queryParams, async function (queryErr, queryResult) {
        //console.log("queryResult", queryResult)
        await queryResult.Items.forEach(async function (item) {
            //console.log("deleting", item.si)
            await dynamodb.delete({
                TableName: 'schedules',
                Key: {
                    'si': item.si
                }
            }).promise();
        });
    }).promise();
    //console.log("deleting ti from tasks:", ti)
    await dynamodb.delete({
        TableName: 'tasks',
        Key: {
            'ti': ti
        }
    }).promise();

    return "success"
}

async function shiftDaysOfWeekForward(daysOfWeek) {
    // Shift days of the week one day forward
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

    // Convert start and end times to UTC and adjust for next day if end is before start
    let sOrigUTC = await moment.tz(`${startDate} ${startTime}`, "YYYY-MM-DD HH:mm", timeZone);
    let startUTC = await moment.tz(`${startDate} ${startTime}`, "YYYY-MM-DD HH:mm", timeZone).utc();
    let eOrigUTC = await moment.tz(`${endDate} ${endTime}`, "YYYY-MM-DD HH:mm", timeZone);
    let endUTC = await moment.tz(`${endDate} ${endTime}`, "YYYY-MM-DD HH:mm", timeZone).utc();


    //console.log("startUTC", startUTC);
    //console.log("origUTC", sOrigUTC);
    //console.log(startUTC.isSame(sOrigUTC, 'day'))
    //console.log("startUTC.format(YYYY-MM-DD)", startUTC.format("YYYY-MM-DD"));
    //console.log("sOrigUTC.format(YYYY-MM-DD)", sOrigUTC.format("YYYY-MM-DD"));
    //console.log("endUTC.format(YYYY-MM-DD)", endUTC.format("YYYY-MM-DD"));
    //console.log("eOrigUTC.format(YYYY-MM-DD)", eOrigUTC.format("YYYY-MM-DD"));

    //console.log("startDate:", startDate, "startTime:", startTime, "")



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
        endUTC.clone().add(1, 'day'); // Adjusts end time to next day if it ends before it starts (due to time conversion)
    }

    let timespans = [firstTimespan];

    if (eOrigUTC.format("YYYY-MM-DD") != endUTC.format("YYYY-MM-DD")) {
        if (sOrigUTC.format("YYYY-MM-DD") == startUTC.format("YYYY-MM-DD")) {
            //console.log("NOT SAME DAY")
            // If the timespan crosses into the next day
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

/*  async function getPresignedUrl(languageCode = "en-US", mediaEncoding = "flac", sampleRate = 16000) {
    const region = "us-east-1";
    const transcribe = new AWS.TranscribeService();
    const endpoint = `transcribestreaming.${region}.amazonaws.com:8443`;
    // Ensure you're using the correct query parameters as specified in the AWS documentation
    const queryParams = `language-code=${languageCode}&media-encoding=${mediaEncoding}&sample-rate=${sampleRate}`;
    
    const request = new AWS.HttpRequest(`https://${endpoint}/stream-transcription-websocket?${queryParams}`, region);
    request.method = 'GET';
    request.headers.host = endpoint;
    request.headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD';
  

    const signer = new AWS.Signers.V4(request, 'transcribe');
    signer.addAuthorization(AWS.config.credentials, new Date());
  console.log("signer",signer)
    const authorizationHeader = signer.request.headers.Authorization;
    const Credential = authorizationHeader.split('Credential=')[1].split(',')[0];
    const SignedHeader = authorizationHeader.split('SignedHeaders=')[1].split(',')[0];
    const Signature = authorizationHeader.split('Signature=')[1].split(',')[0];
    const X_Amz_Date = signer.request.headers['X-Amz-Date'];
    const x_amz_security_token = signer.request.headers['x-amz-security-token'];
    const X_Amz_Expires = 300; // Set the expiration time as needed
  
    const awsHost = request.endpoint.host;
    const awsPath = request.endpoint.pathname;
  
    // Construct the signed URL following AWS guidelines
    let url = `wss://${awsHost}${awsPath}?`;
    url += `X-Amz-Algorithm=AWS4-HMAC-SHA256`;
    url += `&X-Amz-Credential=${encodeURIComponent(Credential)}`;
    url += `&X-Amz-Date=${X_Amz_Date}`;
    url += `&X-Amz-Expires=${X_Amz_Expires}`;
    url += `&X-Amz-Security-Token=${encodeURIComponent(x_amz_security_token)}`;
    url += `&X-Amz-Signature=${Signature}`;
    url += `&X-Amz-SignedHeaders=${encodeURIComponent(SignedHeader)}`;
    url += `&language-code=en-US`
    url += `&media-encoding=flac`
    url += `&sample-rate=16000`
  
    console.log("Generated URL:", url);
    return url;
  }*/

async function retrieveAndParseJSON(fileName, isPublic) {
    let fileLocation = "private"
    if (isPublic == "true" || isPublic == true) {
        fileLocation = "public"
    }
    const params = { Bucket: fileLocation + '.1var.com', Key: fileName };
    const data = await s3.getObject(params).promise();
    console.log("data", data);
    console.log("data.Body", data.Body.toString('utf-8'))
    return await JSON.parse(data.Body.toString('utf-8'));
}

async function runPrompt(question, entity, dynamodb, openai, Anthropic) {
    const gptScript = ["//Respond with only JSON. You generate Node.js/Express apps using a proprietary json structure. Always put json data in a 'data' key. Notice how I combine json references before referencing the nested objects. Always do this! Every req request is a POST.  Always use support@1var.com to send emails. \nstore: {\"req\":req, \"res\":res, \"fs\":fs, \"axios\":axios, \"math\":mathjs, \"JSON\":JSON, \"Buffer\":Buffer, \"moment\":moment, \"child_process\":child_process} //pre-created targets\nvar: {\"modules\": {}, \"actions\": []}\nvar.modules: {\"moduleName\": \"npmPackageName\"} \nvar.email:[{\"from\": \"jaustinhughes@gmail.com\",\"to\": \"1v4r1b356363-88ca-3463s-a653-d997a2a80073\",\"subject\": \"Subject Text\",\"date\": \"Mon, 1 Apr 2024 01:52:40 -0400\",\"emailID\": \"0lroo0umdm72o9vt0asdf444fne6suc54c2pfa81\"}] // store.moduleName\nvar.actions: {\"if\":[], \"while\":[], \"set\":{}, \"target\":\"\", \"chain\":[], \"actions\":[], \"next\":bool}\nvar.actions[n].if: [[\"string\",\"==\",\"string\"],[\"{|counter|}\",\"<\",5]]\nvar.actions[n].while: [[\"string\",\"==\",\"string\"],[\"{|counter|}\",\"<\",5]]\nvar.actions[n].set: {\"action1\":\"value\", \"action2\":{\"object\":true}, \"action3\":[0,1,2], \"action4\":\"{|res|}\"} // store.action1, store.action2, store.action3, store.action4a\nvar.actions[n].target: \"{|action4a|}\" //store.action4a\nvar.actions[n].chain: [{\"access\":\"send\", \"parames\":[\"html\"]}, \"new\":true, \"express\":true] //store.action4a.send(\"html\")\nvar.actions[n].actions: [{\"if\":[], \"while\":[], \"set\":{}, \"target\":\"\", \"chain\":[], \"actions\":[], \"next\":true}, {}] //store.action4a.action4b\nvar.actions[n].assign: \"{|targetName|}\" //store.targetName\nvar.actions[n].params: [\"{|arg1|}\", \"{|arg2||}\", \"string\"] //store.targetName(store.targetName.arg1,store.targetName.arg2, \"string\")\nvar.actions[n].next: true // req.next()\nvar.actions[n].express true //store.targetName()(req,res,next)\n(var.actions[n].next: true and var.actions[n].express: true) //store.targetName()(req,res)\n\n//special considerations\nvar.actions[n].action4b.set: {\"~/counter\":0} // the ~/ forces path to store root\nvar.actions[n]: {\"while\":[[\"{|counter|}\",\"<\",3]], \"set\":{\"{|~/counter|}\":\"{|={|~/counter|}+1|}\"}} // while array is not nested, set is nested. While is an array of array conditions just like if conditions. \nvar.actions[n]: {\"set\":{\"obj\":{\"key\":\"value\"}, \"{|obj=>key|}\":\"newValue\"}} // obj is an object, => accesses the object\nvar.actions[n]: {\"set\":{\"obj\":[0,1,3], \"{|arr=>[2]|}\":2}} // arr is an array, =>[n] accesses the index\nvar.actions[n]: {\"set\":{\"result\":\"{|=pi*{|counter|}|}\"}} // = starts a npm mathjs formula like excel formulas\nvar.actions[n].chain.new: true // new store.targetName();\nvar.action[n].chain.express: true // store.targetName()(req,res,next);\nvar.action[n].chain.express: true  and var.action[n].chain.express: true  // store.targetName()(req,res,next);",
        "\n\nExample 1:take the most recent email and send it to me.\n{\"blocks\":[{\"entity\":\"1v4r644b6416-52a3-4383-b748-f3c8aa5fd9dc\",\"width\":\"100\",\"align\":\"center\"}],\"modules\":{},\"actions\":[{\"target\":\"{|nodemailer|}\",\"chain\":[{\"access\":\"createTransport\",\"params\":[\"{|gmailKey|}\"]}],\"assign\":\"{|transporter|}!\"},{\"set\":{\"recentEmail\":\"{|email=>[0]|}\",\"subject\":\"{|recentEmail=>subject|}\",\"emailBody\":{\"from\":\"support@1var.com\",\"to\":\"jaustinhughes@gmail.com\",\"subject\":\"Testing\",\"text\":\"Testing\",\"html\":\"\"},\"emailHTML\":\"{|emailBody=>html|}\",\"emailText\":\"{|emailBody=>text|}\"}},{\"set\":{\"emailHTML\":\"{|subject|}\",\"emailText\":\"{|subject|}\"}},{\"target\":\"{|transporter|}\",\"chain\":[{\"access\":\"sendMail\",\"params\":[\"{|emailBody|}\"]}],\"assign\":\"{|send|}!\"},{\"target\":\"{|res|}\",\"chain\":[{\"access\":\"send\",\"params\":[\"Email Sent! <br> To: j...@gmail.com<br>Subject:{|emailBody=>subject|} <br> Body:{|emailBody=>text|}\"]}],\"assign\":\"{|showPage|}!\"}],\"email\":[{\"from\":\"jaustinhughes@gmail.com\",\"to\":\"1v4r644b6416-52a3-4383-b748-f3c8aa5fd9dc\",\"subject\":\"Testing2\",\"date\":\"Mon, 24 Jun 2024 12:00:12 -0400\",\"emailID\":\"1ifmg9baipt8gmt4bqdtb2r7s40aoqaoagjb92g1\"}]}",
        "\n\nExample 2:get me the cnn rss feed and give me the top 6 articles.\n{\"blocks\":[{\"entity\":\"1v4r521f3e2f-97ac-48cd-a7c0-00115b1c2788\",\"width\":\"100\",\"align\":\"center\"}],\"modules\":{\"fast-xml-parser\":\"fast-xml-parser\"},\"actions\":[{\"target\":\"{|axios|}\",\"chain\":[{\"access\":\"get\",\"params\":[\"http://rss.cnn.com/rss/cnn_topstories.rss\"],\"new\":true}],\"assign\":\"{|response|}\"},{\"set\":{\"rss\":\"{|response=>data|}\",\"options\":{\"ignoreAttributes\":false,\"attributeNamePrefix\":\"@_\",\"allowBooleanAttributes\":true,\"parseAttributeValue\":true,\"processEntities\":true}}},{\"target\":\"{|fast-xml-parser|}\",\"chain\":[{\"access\":\"XMLParser\",\"params\":[\"{|options|}\"],\"new\":true}],\"assign\":\"{|parser|}!\"},{\"target\":\"{|parser|}\",\"chain\":[{\"access\":\"parse\",\"params\":[\"{|rss|}\"]}],\"assign\":\"{|jObj|}!\"},{\"set\":{\"html\":\"\",\"channel\":\"{|jObj=>rss.channel|}\"}},{\"set\":{\"counter\":0,\"limit\":\"{|={|~/channel=>item.length|}-1|}\",\"fixedMax\":6}},{\"target\":\"{|math|}\",\"chain\":[{\"access\":\"number\",\"params\":[\"{|limit|}\"]}],\"assign\":\"{|max|}!\"},{\"while\":[[\"{|counter|}\",\"<\",\"{|fixedMax|}\"]],\"set\":{\"item\":\"{|channel=>item[{|~/counter|}]|}\",\"img\":\"{|item=>media:group.media:content|}\",\"image\":\"{|img=>[0]|}\",\"~/html\":\"{|~/html|}<br><br><img src='{|image=>@_url|}' width='100%'/><a href='{|item=>link|}'>{|item=>title|}</a>\",\"~/counter\":\"{|={|~/counter|}+1|}\"}},{\"target\":\"{|res|}\",\"chain\":[{\"access\":\"send\",\"params\":[\"{|html|}\"]}],\"assign\":\"{|send|}!\"}],\"email\":[]}",
        "\n\nExample 3:get my the balanace from my stripe account. \n{\"blocks\": [{\"entity\": \"1v4r327dd37d-d1df-4184-a5cb-39d8c6b13a60\",\"width\": \"100\",\"align\": \"center\"}],\"modules\": {},\"actions\": [{\"target\": \"{|axios|}\",\"chain\": [{\"access\": \"get\",\"params\": [\"https://api.stripe.com/v1/balance\",\"{|stripeJSON|}\"],\"new\": true}],\"assign\": \"{|response|}\"},{\"execute\": \"{|response|}\"},{\"set\": {\"response\": \"{|response=>data|}\",\"available\": \"{|response=>available[0]|}\"}},{\"target\": \"{|res|}\",\"chain\": [{\"access\": \"send\",\"params\": [\"Stripe Balance: ${|available=>amount|}<br>\"]}],\"assign\": \"{|showPage|}!\"}],\"email\": []}",
        "\n\nExample 4:create the current time in new york.\n{ \"modules\": {\"moment-timezone\":\"moment-timezone\"}, \"actions\":[{\"target\": \"{|moment-timezone|}\",\"params\": [],\"chain\": [{\"access\": \"tz\",\"params\": [\"America/New_York\"]},{\"access\": \"format\",\"params\": [\"hh:mm:ss\"]}],\"assign\": \"{|timeInZone|}!\"},{\"target\": \"{|res|}\",\"chain\": [{\"access\": \"send\",\"params\": [\"{|timeInZone|}\"]}]}], 'email':[]}",
        "\n\nExample 5:create an svg of a list of topics. Give the list letter bullets with purple circle backgrounds. The list is: housing 100%, transportation  50%.\n{ \"modules\": {}, \"actions\": [ { \"set\": { \"data\": { \"svgWidth\": 240, \"points\": [], \"letters\": [ \"A\", \"B\" ], \"items\": [ { \"name\": \"Housing\", \"percent\": 100 }, { \"name\": \"Transportation\", \"percent\": 50 } ], \"styles\": [ \".point-text, .legend-text { font-family: Arial, sans-serif; font-size: 14px; fill: #734b9e; }\", \".legend-text { font-family: Arial, sans-serif; font-size: 14px; fill: #e4dfed; }\", \".legend-bg { fill: #e4dfed; rx: 5; ry: 5; }\" ] } } }, { \"set\": { \"lettersLength\": \"{|data=>letters.length|}\", \"svgns\": \"http://www.w3.org/2000/svg\", \"svgWH\": \"{|data=>svgWidth|} \", \"centerXY\": \"{|={|svgWH|}/2|}\", \"svgHeight\": \"{|=30+(30*{|lettersLength|})|}\", \"svgContent\": \"<svg id='svg123' width='{|data=>svgWidth|}' height='{|svgHeight|}' xmlns='http://www.w3.org/2000/svg'><style>{|data=>styles[0]|}{|data=>styles[1]|}{|data=>styles[2]|}{|data=>styles[3]|}{|data=>styles[4]|}</style>\", \"styles\": \"\", \"pathString\": \"\", \"points\": [], \"counter\": 0, \"letters\": \"{|data=>letters|}\", \"step\": \"{|=(2*pi)/{|lettersLength|}|}\" } }, { \"set\": { \"counter\": 0 } }, { \"while\": [ [ \"{|counter|}\", \"<\", \"{|~/data=>letters.length|}\" ] ], \"set\": { \"increment\": \"{|={|~/counter|}*30|}\", \"yOffset\": \"{|={|increment|}+20|}\", \"obj\": \"{|~/data=>items[{|~/counter|}]|}\", \"svgContent\": \"{|svgContent|}<circle cx='30' cy='{|={|yOffset|}+9|}' r='10' fill='#734b9e'/><text x='30' y='{|={|yOffset|}+9|}' class='legend-text' text-anchor='middle' dy='.35em'>{|data=>letters[{|~/counter|}]|}</text><text x='50' y='{|={|yOffset|}+14|}' class='point-text'>{|obj=>name|}: {|obj=>percent|}%</text>\", \"~/counter\": \"{|={|~/counter|}+1|}\" } }, { \"target\": \"{|res|}\", \"chain\": [ { \"access\": \"send\", \"params\": [ \"{|svgContent|}\" ] } ] } ], 'email':[] }",
        "\n\nExample 6:make an app that will loop through a list of json objects, grab travel destinations and their states and show that in a svg image of the list in a creative way. {\"locations\":[{\"name\":\"Big Apple\", \"state\":\"New York\"},{\"name\":\"South Beach\", \"State\":\"Florida\"}]}\n{ \"modules\": {}, \"actions\": [ { \"set\": { \"data\": { \"locations\": [ { \"name\": \"Big Apple\", \"state\": \"New York\" }, { \"name\": \"South Beach\", \"state\": \"Florida\" } ], \"svgWidth\": 400, \"svgHeight\": 300, \"styles\": [ \".location-text { font-family: Arial, sans-serif; font-size: 18px; fill: #333; }\", \".state-text { font-family: Arial, sans-serif; font-size: 14px; fill: #666; }\", \".line { stroke: #ccc; stroke-width: 1; }\", \".circle { fill: #ff6b6b; }\" ] } } }, { \"set\": { \"svgContent\": \"<svg width='{|data=>svgWidth|}' height='{|data=>svgHeight|}' xmlns='http://www.w3.org/2000/svg'><style>{|data=>styles.join('')|}</style>\", \"xPos\": 50, \"yPos\": 50, \"counter\": 0 } }, { \"while\": [ [ \"{|counter|}\", \"<\", \"{|data=>locations.length|}\" ] ], \"set\": { \"location\": \"{|~/data=>locations[{|counter|}]|}\", \"~/svgContent\": \"{|~/svgContent|}<circle class='circle' cx='{|~/xPos|}' cy='{|~/yPos|}' r='5' /><text class='location-text' x='{|={|~/xPos|} + 15|}' y='{|~/yPos|}'>{|location=>name|}</text><text class='state-text' x='{|={|~/xPos|} + 15|}' y='{|={|~/yPos|} + 20|}'>{|location=>state|}</text>\", \"yPos\": \"{|={|yPos|} + 50|}\", \"{|~/counter|}\": \"{|={|~/counter|} + 1|}\" } }, { \"set\": { \"svgContent\": \"{|svgContent|}</svg>\" } }, { \"target\": \"{|res|}\", \"chain\": [ { \"access\": \"send\", \"params\": [ \"{|svgContent|}\" ] } ] } ], 'email':[] }",
        "\n\nExample 7:create a email form with to, subject, and body that will send emails using my support email. {\"blocks\": [{\"entity\": \"1v4rf775ca76-4a7c-40f3-9793-d0c98028e25f\",\"width\": \"100\",\"align\": \"center\"}],\"modules\": {},\"actions\": [{\"set\": {\"formHtml\": \"<form action='{|urlpath|}' method='post'><label for='subject'>Subject:</label><input type='hidden' value='support@1var.com' id='from' name='from' ><input type='text' id='subject' name='subject' required><br><label for='body'>Body:</label><textarea id='body' name='body' required></textarea><br><label for='to'>To:</label><input type='email' id='to' name='to' required><br><br><input type='submit' value='Send Email'></form>\"}},{\"if\": [[\"{|body=>from|}\",\"==\",\"support@1var.com\"]],\"target\": \"{|nodemailer|}\",\"chain\": [{\"access\": \"createTransport\",\"params\": [\"{|gmailKey|}\"]}],\"assign\": \"{|transporter|}!\"},{\"set\": {\"emailOptions\": {\"from\": \"support@1var.com\",\"to\": \"{|body=>to|}\",\"subject\": \"{|body=>subject|}\",\"text\": \"{|body=>body|}\",\"html\": \"{|body=>body|}\"}}},{\"target\": \"{|transporter|}\",\"chain\": [{\"access\": \"sendMail\",\"params\": [\"{|emailOptions|}\"]}],\"assign\": \"{|send|}!\"},{\"target\": \"{|res|}\",\"chain\": [{\"access\": \"send\",\"params\": [\"{|formHtml|}{|emailOptions|}\"]}],\"assign\": \"{|showPage|}!\"}]}",
        "\n\nExample 8:create a json database that has building and tenants. {\"modules\":{},\"actions\":[{\"set\":{\"data\":{\"features\":{\"0\":\"Washer/Dryer\",\"1\":\"Garage\",\"2\":\"Hardwood Floors\",\"3\":\"Walk-In Shower\"},\"properties\":{\"0\":{\"address\":\"1000 Park Ave\",\"city\":\"New York\",\"state\":\"New York\",\"zip\":\"10001\",\"Units\":{\"A\":{\"tenants\":[\"0\"],\"start\":\"01/01/24\",\"end\":\"12/31/24\",\"years\":1,\"bedrooms\":2,\"features\":[\"0\",\"1\"]},\"B\":{\"tenants\":[\"1\"],\"start\":\"06/01/24\",\"end\":\"05/31/25\",\"years\":1,\"bedrooms\":3,\"features\":[\"0\",\"2\"]},\"C\":{\"tenants\":[\"2\",\"3\"],\"start\":\"06/15/24\",\"end\":\"06/14/25\",\"years\":1,\"bedrooms\":4,\"features\":[\"1\",\"3\"]},\"D\":{\"tenants\":[],\"start\":\"\",\"end\":\"\",\"years\":0,\"bedrooms\":2,\"features\":[\"2\",\"3\"]},\"E\":{\"tenants\":[\"4\"],\"start\":\"08/01/24\",\"end\":\"07/31/25\",\"years\":1,\"bedrooms\":3,\"features\":[\"0\",\"1\",\"2\"]},\"F\":{\"tenants\":[\"5\"],\"start\":\"03/01/24\",\"end\":\"02/28/26\",\"years\":2,\"bedrooms\":2,\"features\":[\"1\",\"2\",\"3\"]},\"G\":{\"tenants\":[\"6\"],\"start\":\"06/01/24\",\"end\":\"05/31/25\",\"years\":1,\"bedrooms\":1,\"features\":[\"0\",\"1\"]}}},\"1\":{\"address\":\"4712 Adams St\",\"city\":\"Hoboken\",\"state\":\"New Jersey\",\"zip\":\"07087\",\"Units\":{\"101\":{\"tenants\":[\"7\"],\"start\":\"06/01/24\",\"end\":\"05/31/25\",\"years\":1,\"bedrooms\":2,\"features\":[\"1\"]},\"102\":{\"tenants\":[\"8\"],\"start\":\"06/01/24\",\"end\":\"05/31/26\",\"years\":2,\"bedrooms\":2,\"features\":[\"0\",\"3\"]}}}},\"totalProperties\":2,\"tenants\":{\"0\":{\"first\":\"Adam\",\"last\":\"Smith\",\"unit\":\"A\",\"property\":\"0\",\"phone\":\"212-377-3632\",\"credit\":800,\"email\":\"adam.smith@gmail.com\"},\"1\":{\"first\":\"Austin\",\"last\":\"Hughes\",\"unit\":\"B\",\"property\":\"0\",\"phone\":\"212-347-3186\",\"credit\":820,\"email\":\"jaustinhughes@gmail.com\"},\"2\":{\"first\":\"John\",\"last\":\"Doe\",\"unit\":\"C\",\"property\":\"0\",\"phone\":\"212-481-2296\",\"credit\":769,\"email\":\"john.doe@gmail.com\"},\"3\":{\"first\":\"Jane\",\"last\":\"Doe\",\"unit\":\"C\",\"property\":\"0\",\"phone\":\"212-713-4142\",\"credit\":735,\"email\":\"jane.doe@gmail.com\"},\"4\":{\"first\":\"Bob\",\"last\":\"Builder\",\"unit\":\"E\",\"property\":\"0\",\"phone\":\"212-926-1881\",\"credit\":790,\"email\":\"bob.builder@gmail.com\"},\"5\":{\"first\":\"Alice\",\"last\":\"Wonderland\",\"unit\":\"F\",\"property\":\"0\",\"phone\":\"212-332-5700\",\"credit\":810,\"email\":\"alice.wonderland@gmail.com\"},\"6\":{\"first\":\"Charlie\",\"last\":\"Brown\",\"unit\":\"G\",\"property\":\"0\",\"phone\":\"212-627-6442\",\"credit\":800,\"email\":\"charlie.brown@gmail.com\"},\"7\":{\"first\":\"Bruce\",\"last\":\"Wayne\",\"unit\":\"101\",\"property\":\"1\",\"phone\":\"212-373-2500\",\"credit\":781,\"email\":\"bruce.wayne@gmail.com\"},\"8\":{\"first\":\"Clark\",\"last\":\"Kent\",\"unit\":\"102\",\"property\":\"1\",\"phone\":\"212-277-3853\",\"credit\":786,\"email\":\"clark.kent@gmail.com\"}},\"totalTenants\":9}}},{\"target\":\"{|res|}\",\"chain\":[{\"access\":\"send\",\"params\":[\"{|./|} Data<script>var selectedTenant = 0; var selectedProperty = 0; var selectedUnit = 'A'; var data = {|data|}; var emails = {|email|};</script>\"]}]}],\"email\":[],\"blocks\":[],\"ai\":true}",
        "\n\nExample 9:create a map with cities and their population. Let me click on the cities below to see details about that location.{\"blocks\": [{\"entity\": \"1v4r991308f7-87db-4182-a5e9-c1da15268e27\",\"width\": \"100\",\"align\": \"center\"}],\"modules\": {},\"actions\": [{\"set\": {\"data\": {\"countries\": [{\"country\": \"China\",\"population\": 21542000,\"city\": \"Beijing\",\"timezone\": \"Asia/Shanghai\",\"lat\": 39.9042,\"lon\": 116.4074,\"tourist_destinations\": [\"Great Wall of China\",\"Forbidden City\",\"Terracotta Army\"],\"popular_websites\": [\"Baidu\",\"WeChat\",\"Alibaba\"],\"major_companies\": [\"Tencent\",\"Huawei\",\"Xiaomi\"]},{\"country\": \"India\",\"population\": 32226000,\"city\": \"New Delhi\",\"timezone\": \"Asia/Kolkata\",\"lat\": 28.6139,\"lon\": 77.209,\"tourist_destinations\": [\"Taj Mahal\",\"Jaipur\",\"Kerala Backwaters\"],\"popular_websites\": [\"Flipkart\",\"Paytm\",\"Zomato\"],\"major_companies\": [\"Reliance Industries\",\"Tata Group\",\"Infosys\"]},{\"country\": \"United States\",\"population\": 701974,\"city\": \"Washington D.C.\",\"timezone\": \"America/New_York\",\"lat\": 38.9072,\"lon\": -77.0369,\"tourist_destinations\": [\"Statue of Liberty\",\"Grand Canyon\",\"Walt Disney World\"],\"popular_websites\": [\"Google\",\"Facebook\",\"Amazon\"],\"major_companies\": [\"Apple\",\"Microsoft\",\"Walmart\"]},{\"country\": \"Indonesia\",\"population\": 10562088,\"city\": \"Jakarta\",\"timezone\": \"Asia/Jakarta\",\"lat\": -6.2088,\"lon\": 106.8456,\"tourist_destinations\": [\"Bali\",\"Borobudur\",\"Komodo National Park\"],\"popular_websites\": [\"Tokopedia\",\"Gojek\",\"Traveloka\"],\"major_companies\": [\"Pertamina\",\"Bank Central Asia\",\"Astra International\"]},{\"country\": \"Pakistan\",\"population\": 2006572,\"city\": \"Islamabad\",\"timezone\": \"Asia/Karachi\",\"lat\": 33.6844,\"lon\": 73.0479,\"tourist_destinations\": [\"Badshahi Mosque\",\"Hunza Valley\",\"Mohenjo-daro\"],\"popular_websites\": [\"Daraz\",\"Zameen\",\"Pakwheels\"],\"major_companies\": [\"Pakistan State Oil\",\"Engro Corporation\",\"Habib Bank\"]}]}}},{\"set\": {\"mapHTML\": \"<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>Global Capital Cities Explorer</title><link rel='stylesheet' href='https://unpkg.com/leaflet@1.7.1/dist/leaflet.css'/><link href='https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;700&display=swap' rel='stylesheet'><style>body{font-family:'Roboto',sans-serif;margin:0;padding:20px;background-color:#4a0e4e;}h1{text-align:center;color:#ffd700;text-shadow:2px 2px 4px rgba(0,0,0,0.5);}#map{width:100%;height:600px;border-radius:10px;box-shadow:0 4px 6px rgba(255,215,0,0.3);}#cityList{margin-top:30px;list-style-type:none;padding:0;}#cityList li{background-color:#6a1b9a;border-radius:8px;box-shadow:0 2px 4px rgba(255,215,0,0.3);padding:20px;margin:10px 0;cursor:pointer;transition:all 0.3s ease;color:#ffd700;}#cityList li:hover{transform:translateY(-5px);box-shadow:0 4px 8px rgba(255,215,0,0.5);}#cityList li.active{background-color:#9c27b0;}#cityDetails{margin-top:30px;background-color:#6a1b9a;border-radius:8px;box-shadow:0 2px 4px rgba(255,215,0,0.3);padding:30px;color:#ffd700;}#cityDetails h2{margin-top:0;color:#ffd700;}#cityDetails p{margin:10px 0;color:#e6c200;}#cityDetails ul{padding-left:20px;color:#e6c200;}.section-title{font-weight:700;color:#ffd700;margin-top:20px;margin-bottom:10px;}.clickable{cursor:pointer;color:#ffeb3b;}.clickable:hover{text-decoration:underline;}</style></head><body><h1>Global Capital Cities Explorer</h1><div id='map'></div><ul id='cityList'></ul><div id='cityDetails' style='display:none;'></div><script src='https://unpkg.com/leaflet@1.7.1/dist/leaflet.js'></script><script>var map=L.map('map').setView([20,0],2);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);var cityData={|data=>countries|};var markers={};var activeCityLi=null;\",\"counter\": 0}},{\"while\": [[\"{|counter|}\",\"<\",\"{|data=>countries.length|}\"]],\"set\": {\"item\": \"{|~/data=>countries[{|~/counter|}]|}\",\"~/mapHTML\": \"{|~/mapHTML|}markers[{|~/counter|}]=L.marker([{|item=>lat|},{|item=>lon|}]).addTo(map).bindPopup('<strong>{|item=>city|}, {|item=>country|}</strong><br>Population: {|item=>population|}');var cityLi=document.createElement('li');cityLi.innerHTML='<h3>{|item=>city|}, {|item=>country|}</h3><p>Population: {|item=>population|}</p>';cityLi.onclick=function(){showCityDetails({|~/counter|});highlightMarker({|~/counter|});highlightCity(this);};document.getElementById('cityList').appendChild(cityLi);\",\"~/counter\": \"{|={|~/counter|}+1|}\"}},{\"set\": {\"mapHTML\": \"{|mapHTML|}function showCityDetails(index){var city=cityData[index];var details=document.getElementById('cityDetails');details.innerHTML='<h2>'+city.city+', '+city.country+'</h2><p><strong>Population:</strong> '+city.population.toLocaleString()+'</p><p><strong>Timezone:</strong> '+city.timezone+'</p><h3 class=\"section-title\">Tourist Destinations</h3><ul>'+city.tourist_destinations.map(d=>'<li class=\"clickable\" onclick=\"showInfo(\\'tourist_destination\',\''+d+'\')\">' + d + '</li>').join('')+'</ul><h3 class=\"section-title\">Popular Websites</h3><ul>'+city.popular_websites.map(w=>'<li class=\"clickable\" onclick=\"showInfo(\'website\',\''+w+'\')\">' + w + '</li>').join('')+'</ul><h3 class=\"section-title\">Major Companies</h3><ul>'+city.major_companies.map(c=>'<li class=\"clickable\" onclick=\"showInfo(\'company\',\''+c+'\')\">' + c + '</li>').join('')+'</ul>';details.style.display='block';}function highlightMarker(index){Object.values(markers).forEach(marker=>marker.setIcon(L.icon({iconUrl:'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',iconSize:[25,41],iconAnchor:[12,41]})));markers[index].setIcon(L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',iconSize:[25,41],iconAnchor:[12,41]}));markers[index].openPopup();map.setView(markers[index].getLatLng(),5);}function highlightCity(li){if(activeCityLi){activeCityLi.classList.remove('active');}li.classList.add('active');activeCityLi=li;}function showInfo(type,name){var details=document.getElementById('cityDetails');var infoDiv=document.createElement('div');infoDiv.innerHTML='<h3>'+name+'</h3><p>Loading information...</p>';details.innerHTML='';details.appendChild(infoDiv);fetch('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(name)).then(response=>response.json()).then(data=>{infoDiv.innerHTML='<h3>'+name+'</h3><p>'+data.extract+'</p><a href=\"'+data.content_urls.desktop.page+'\" target=\"_blank\">Read more on Wikipedia</a>';}).catch(error=>{infoDiv.innerHTML='<h3>'+name+'</h3><p>Sorry, we couldn\'t load information for this '+type+'. Please try again later.</p>';});}</script></body></html>\"}},{\"target\": \"{|res|}\",\"chain\": [{\"access\": \"send\",\"params\": [\"{|mapHTML|}\"]}],\"assign\": \"{|send|}!\"}],\"email\": [],\"ai\": true}",
        "\n\nHere is the medical history we'll be discussing. You'll be pulliing from this to answer questions if needed. { 'patient_id': '67890', 'patient_details': { 'first_name': 'Jane', 'middle_name': 'F', 'last_name': 'Smith', 'dob': '1975-03-22', 'gender': 'Female', 'phone': '555-258-1416', 'address': '123 Home Street, Springfield, IL 62704', 'email': 'janefsmith@gomail.com' }, 'initial_visit': { 'date': '2024-08-01', 'presenting_symptoms': [ 'Persistent cough lasting over 2 months', 'Shortness of breath', 'Unexplained weight loss of 10 pounds in 2 months', 'Fatigue' ], 'physical_exam': { 'general_appearance': 'Appears fatigued, mildly short of breath', 'lung_exam': 'Diminished breath sounds in the right upper lung field, no wheezing or crackles', 'heart_exam': 'Regular rhythm, no murmurs', 'abdomen_exam': 'Soft, non-tender, no organomegaly', 'extremities_exam': 'No edema' }, 'initial_assessment': 'Suspicious for lung pathology, possibly neoplastic. Recommend further imaging and lab tests.', 'plan': [ 'Order Chest CT scan', 'Obtain Complete Blood Count (CBC)', 'Obtain Comprehensive Metabolic Panel (CMP)', 'Refer to Oncology for further evaluation' ] }, 'lab_results': [ { 'test_name': 'Complete Blood Count (CBC)', 'test_date': '2024-08-03', 'results': { 'hemoglobin': '13.2 g/dL', 'white_blood_cells': '5.9 x10^9/L', 'platelets': '220 x10^9/L' }, 'normal_range': { 'hemoglobin': '12.0-15.5 g/dL', 'white_blood_cells': '4.0-11.0 x10^9/L', 'platelets': '150-400 x10^9/L' }, 'status': 'Normal' }, { 'test_name': 'Comprehensive Metabolic Panel (CMP)', 'test_date': '2024-08-03', 'results': { 'glucose': '95 mg/dL', 'creatinine': '0.9 mg/dL', 'bun': '14 mg/dL', 'sodium': '138 mmol/L', 'potassium': '4.2 mmol/L', 'calcium': '9.4 mg/dL', 'alt': '25 U/L', 'ast': '22 U/L', 'albumin': '4.0 g/dL', 'total_bilirubin': '0.8 mg/dL' }, 'normal_range': { 'glucose': '70-99 mg/dL', 'creatinine': '0.6-1.2 mg/dL', 'bun': '7-20 mg/dL', 'sodium': '135-145 mmol/L', 'potassium': '3.5-5.1 mmol/L', 'calcium': '8.5-10.2 mg/dL', 'alt': '7-56 U/L', 'ast': '10-40 U/L', 'albumin': '3.5-5.0 g/dL', 'total_bilirubin': '0.1-1.2 mg/dL' }, 'status': 'Normal' }, { 'test_name': 'Liver Function Tests (LFTs)', 'test_date': '2024-08-03', 'results': { 'alt': '25 U/L', 'ast': '22 U/L', 'alkaline_phosphatase': '70 U/L', 'total_bilirubin': '0.8 mg/dL', 'albumin': '4.0 g/dL' }, 'normal_range': { 'alt': '7-56 U/L', 'ast': '10-40 U/L', 'alkaline_phosphatase': '44-147 U/L', 'total_bilirubin': '0.1-1.2 mg/dL', 'albumin': '3.5-5.0 g/dL' }, 'status': 'Normal' }, { 'test_name': 'Coagulation Profile', 'test_date': '2024-08-03', 'results': { 'pt': '11.5 seconds', 'inr': '1.0', 'aptt': '28 seconds' }, 'normal_range': { 'pt': '11.0-13.5 seconds', 'inr': '0.8-1.2', 'aptt': '25-35 seconds' }, 'status': 'Normal' }, { 'test_name': 'Carcinoembryonic Antigen (CEA)', 'test_date': '2024-08-03', 'results': { 'cea': '5.2 ng/mL' }, 'normal_range': { 'cea': '0-5 ng/mL' }, 'status': 'Slightly Elevated' } ], 'imaging': [ { 'imaging_type': 'Chest CT Scan', 'date': '2024-08-04', 'findings': 'Large mass in the right upper lobe of the lung, highly suggestive of non-small cell lung cancer (NSCLC). No distant metastasis detected.', 'image_link': 'https://ehr.example.com/imaging/67890/chest_ct_scan_2024-08-04', 'radiologist_report': 'The chest CT scan reveals a large, irregular mass in the right upper lobe measuring approximately 4.5 cm in diameter. The mass demonstrates spiculated margins, consistent with malignancy. No evidence of mediastinal lymphadenopathy or distant metastases. The patient’s trachea and major bronchi are patent. The visualized portions of the liver, adrenal glands, and bones are unremarkable.', 'imaging_parameters': { 'slice_thickness': '5mm', 'contrast_used': 'Yes, intravenous contrast administered', 'radiation_dose': '12.5 mSv' }, 'imaging_facility': { 'facility_name': 'Springfield Imaging Center', 'facility_address': '456 Diagnostic Lane, Springfield, IL 62704', 'facility_contact': '(555) 987-6543' }, 'reference_number': 'CT_20240804_001', 'follow_up_recommendations': 'Recommend PET scan to further evaluate the metabolic activity of the lesion and assess for any occult metastases.' }, { 'imaging_type': 'PET Scan', 'date': '2024-08-11', 'findings': 'Increased metabolic activity noted in the mass in the right upper lobe, consistent with malignant behavior. No evidence of distant metastasis.', 'image_link': 'https://ehr.example.com/imaging/67890/pet_scan_2024-08-11', 'radiologist_report': 'The PET scan demonstrates increased FDG uptake in the right upper lobe mass, consistent with a highly active malignancy. No abnormal FDG uptake is observed in other regions, suggesting no distant metastasis at this time.', 'imaging_parameters': { 'radioisotope_used': 'FDG (Fluorodeoxyglucose)', 'dose_administered': '10 mCi', 'scan_duration': '45 minutes' }, 'imaging_facility': { 'facility_name': 'Springfield Imaging Center', 'facility_address': '456 Diagnostic Lane, Springfield, IL 62704', 'facility_contact': '(555) 987-6543' }, 'reference_number': 'PET_20240811_002', 'follow_up_recommendations': 'Proceed with surgical planning as per oncologist’s recommendations.' } ], 'specialist_notes': [ { 'specialist_type': 'Oncologist', 'date': '2024-08-05', 'notes': 'Patient diagnosed with non-small cell lung cancer (NSCLC) based on recent imaging. Tumor localized in the right upper lobe. Treatment plan includes surgery, followed by chemotherapy and radiation therapy. Patient needs to be scheduled for a consultation with a thoracic surgeon and an oncology team. Preoperative assessment and preparation for adjuvant chemotherapy and radiation required. Patient education on diagnosis and treatment options discussed.' }, { 'specialist_type': 'Oncologist', 'date': '2024-08-12', 'notes': 'PET scan results reviewed. Tumor shows high metabolic activity consistent with malignancy. No evidence of distant metastasis. Proceeding with planned lobectomy surgery. Further chemotherapy and radiation therapy to be planned post-surgery.' } ], 'family_information': [ { 'family_member_name': 'John Smith', 'relationship': 'Spouse', 'contact_number': '+15551234568', 'email': 'john.smith@example.com', 'emergency_contact': true }, { 'family_member_name': 'Emily Smith', 'relationship': 'Daughter', 'contact_number': '+15551234569', 'email': 'emily.smith@example.com', 'emergency_contact': false } ], 'communication_log': [ { 'date': '2024-08-08', 'method': 'SMS', 'recipient': 'Jane Smith', 'message': 'Your consultation with the Thoracic Surgeon is confirmed for August 11, 2024, at 10:00 AM. Please check in at the Thoracic Surgery Clinic, Room 305.', 'status': 'Sent' }, { 'date': '2024-08-08', 'method': 'Email', 'recipient': 'Jane Smith', 'message': 'Dear Jane Smith, Your consultation with the Thoracic Surgeon is confirmed for August 11, 2024, at 10:00 AM. Please check in at the Thoracic Surgery Clinic, Room 305.', 'status': 'Sent' }, { 'date': '2024-08-08', 'method': 'SMS', 'recipient': 'John Smith', 'message': 'Dear John, Your spouse\'s consultation with the Thoracic Surgeon is confirmed for August 11, 2024, at 10:00 AM.', 'status': 'Sent' }, { 'date': '2024-08-12', 'method': 'Phone Call', 'recipient': 'Jane Smith', 'message': 'Spoke with Jane Smith to confirm details of the upcoming surgery on August 14, 2024. Answered questions regarding the procedure and postoperative care.', 'status': 'Completed' } ], 'transportation_log': [ { 'date': '2024-08-11', 'service_name': 'SafeRide Medical Transport', 'service_id': 'trans_001', 'appointment_id': 'appointment_456789', 'pick_up_time': '08:30 AM', 'drop_off_time': '09:00 AM', 'pick_up_location': '123 Home Street, Springfield, IL 62704', 'drop_off_location': 'Thoracic Surgery Clinic, 456 Hospital Lane, Springfield, IL 62704', 'status': 'Confirmed', 'notes': 'Patient requires wheelchair assistance.' }, { 'date': '2024-08-12', 'service_name': 'SafeRide Medical Transport', 'service_id': 'trans_002', 'appointment_id': 'appointment_456793', 'pick_up_time': '06:00 AM', 'drop_off_time': '06:30 AM', 'pick_up_location': '123 Home Street, Springfield, IL 62704', 'drop_off_location': 'Operating Room 2, 456 Hospital Lane, Springfield, IL 62704', 'status': 'Confirmed', 'notes': 'Patient requires wheelchair assistance. Patient dropped off for PET scan and surgery preparation.' } ], 'patient_education_and_support': [ { 'date': '2024-08-05', 'education_type': 'Verbal Instructions', 'topic': 'Preoperative Instructions', 'details': 'Patient was informed verbally about fasting requirements before surgery and advised to arrive early.', 'status': 'Completed' }, { 'date': '2024-08-06', 'education_type': 'Written Materials', 'topic': 'Chemotherapy Side Effects', 'details': 'Patient was given a booklet on managing common side effects of chemotherapy.', 'status': 'Completed' }, { 'date': '2024-08-07', 'education_type': 'Support Resources', 'topic': 'Support Group Referral', 'details': 'Patient was referred to a local cancer support group and provided with contact information.', 'status': 'Pending' }, { 'date': '2024-08-11', 'education_type': 'Preoperative Education', 'topic': 'Lobectomy Preparation', 'details': 'Patient received detailed information about the lobectomy procedure, including potential risks, benefits, and postoperative care.', 'status': 'Completed' } ], 'upcoming_appointments': [ { 'appointment_id': 'appointment_456789', 'date': '2024-08-11', 'time': '10:00 AM', 'specialist_id': 'thoracic_surgeon_123', 'location': 'Thoracic Surgery Clinic, Room 305', 'status': 'Confirmed' }, { 'appointment_id': 'appointment_456790', 'date': '2024-08-12', 'time': '02:00 PM', 'specialist_id': 'oncology_team_456', 'location': 'Oncology Center, Room 210', 'status': 'Confirmed' }, { 'appointment_id': 'appointment_456791', 'date': '2024-08-12', 'time': '09:00 AM', 'specialist_id': 'anesthesia_team_789', 'location': 'Preoperative Clinic, Room 105', 'status': 'Confirmed' }, { 'appointment_id': 'appointment_456793', 'date': '2024-08-13', 'time': '11:00 AM', 'specialist_id': 'oncology_team_456', 'location': 'Oncology Center, Room 210', 'status': 'Confirmed' }, { 'appointment_id': 'appointment_456794', 'date': '2024-08-14', 'time': '07:00 AM', 'specialist_id': 'thoracic_surgeon_123', 'location': 'Operating Room 2', 'procedure': 'Lobectomy', 'status': 'Confirmed' } ], 'required_actions': [ { 'action_type': 'Schedule Consultation', 'specialist_type': 'Thoracic Surgeon', 'notes': 'Schedule consultation for surgical evaluation and planning.', 'status': 'Completed' }, { 'action_type': 'Schedule Consultation', 'specialist_type': 'Oncology Team', 'notes': 'Schedule consultation for chemotherapy and radiation therapy planning.', 'status': 'Completed' }, { 'action_type': 'Preoperative Assessment', 'department': 'Anesthesia', 'notes': 'Schedule preoperative assessment and clearance.', 'status': 'Completed' }, { 'action_type': 'Schedule Surgery', 'procedure': 'Lobectomy', 'notes': 'Surgery to remove the tumor in the right upper lobe of the lung.', 'status': 'Scheduled' }, { 'action_type': 'Post-Surgical Follow-Up', 'specialist_type': 'Oncologist', 'notes': 'Schedule post-surgical follow-up to assess recovery and plan adjuvant therapy.', 'status': 'Scheduled' }, { 'action_type': 'Preoperative Education', 'notes': 'Provide detailed education on lobectomy procedure and postoperative care.', 'status': 'Completed' } ], 'medical_history': [ { 'condition': 'Hypertension', 'diagnosed_date': '2010-05-15', 'status': 'Managed with medication', 'notes': 'Patient on daily Lisinopril 10mg.' }, { 'condition': 'Type 2 Diabetes', 'diagnosed_date': '2015-09-12', 'status': 'Ongoing', 'notes': 'Patient takes Metformin 500mg twice daily.' } ], 'allergies': [ { 'substance': 'Penicillin', 'reaction': 'Rash', 'severity': 'Moderate' } ], 'medications': [ { 'name': 'Metformin', 'dose': '500mg', 'frequency': 'Twice daily' }, { 'name': 'Lisinopril', 'dose': '10mg', 'frequency': 'Daily' } ], 'pharmacy_information': { 'pharmacy_name': 'ABC Pharmacy', 'pharmacy_address': '123 Main Street, Springfield, IL 62704', 'pharmacy_phone': '(555) 123-4567', 'pharmacy_fax': '(555) 123-4568', 'pharmacy_email': 'contact@abcpharmacy.com', 'preferred_pharmacy': true }, 'social_history': { 'smoking_status': 'Former smoker', 'alcohol_use': 'Occasional', 'living_situation': 'Lives with spouse' }, 'functional_assessment': { 'mobility': 'Independent', 'adl': 'Performs all ADLs independently' }, 'psychosocial_assessment': { 'mental_health': 'No history of depression or anxiety', 'support_system': 'Strong support from family' }, 'nutritional_assessment': { 'diet': 'Balanced diet, no special dietary needs', 'weight_change': 'No significant weight change in the past 6 months' }, 'pain_assessment': { 'current_pain_level': '2/10', 'pain_management': 'Taking Ibuprofen as needed' }, 'vital_signs': { 'blood_pressure': '130/80 mmHg', 'heart_rate': '72 bpm', 'respiratory_rate': '16 breaths/min', 'temperature': '98.6°F' }, 'insurance_information': { 'provider': 'Aetna', 'plan': 'Aetna Premier Plan', 'coverage_details': { 'deductible': '$500 per year', 'out_of_pocket_maximum': '$3,000 per year', 'coinsurance': '80% after deductible', 'specialist_visit_copay': '$20', 'primary_care_visit_copay': '$10', 'emergency_room_copay': '$100', 'hospital_stay_coverage': 'Fully covered after deductible', 'prescription_drugs': { 'generic': '$10 copay', 'brand_name': '$30 copay', 'specialty': '$50 copay' }, 'coverage_notes': 'Covers chemotherapy, radiation therapy, and surgery under hospital stay and specialist services.' }, 'preauthorization_required': 'Yes, for all major procedures including surgery, chemotherapy, and radiation.' }, 'advance_directives': { 'living_will': 'Yes', 'power_of_attorney': 'John Smith (Spouse)' }, 'language_preference': 'English', 'cultural_beliefs': 'No specific cultural considerations reported', 'patient_preferences': { 'treatment_goal': 'Focus on maintaining quality of life', 'treatment_preference': 'Wants to proceed with recommended treatments' }, 'treatment_tracking': { 'medication_tracking': [ { 'medication_name': 'Metformin', 'dose': '500mg', 'time_taken': '2024-08-01T08:00:00Z', 'notes': 'Taken with breakfast.' }, { 'medication_name': 'Lisinopril', 'dose': '10mg', 'time_taken': '2024-08-01T08:00:00Z', 'notes': 'Taken with breakfast.' }, { 'medication_name': 'Metformin', 'dose': '500mg', 'time_taken': '2024-08-02T08:00:00Z', 'notes': 'Taken with breakfast.' }, { 'medication_name': 'Lisinopril', 'dose': '10mg', 'time_taken': '2024-08-02T08:00:00Z', 'notes': 'Taken with breakfast.' }, { 'medication_name': 'Metformin', 'dose': '500mg', 'time_taken': '2024-08-03T08:00:00Z', 'notes': 'Taken with breakfast.' }, { 'medication_name': 'Lisinopril', 'dose': '10mg', 'time_taken': '2024-08-03T08:00:00Z', 'notes': 'Taken with breakfast.' } ], 'chemotherapy_tracking': [ { 'cycle_number': 1, 'medication_name': 'Cisplatin', 'dose': '75mg/m2', 'date_administered': '2024-08-07', 'side_effects': 'Nausea, mild fatigue', 'notes': 'Administered via IV over 2 hours.' }, { 'cycle_number': 2, 'medication_name': 'Cisplatin', 'dose': '75mg/m2', 'date_administered': '2024-08-21', 'side_effects': 'Nausea, more pronounced fatigue, mild hair loss', 'notes': 'Administered via IV over 2 hours. Advised patient on managing side effects.' } ], 'radiation_tracking': [ { 'session_number': 1, 'target_area': 'Right upper lobe of the lung', 'radiation_dose': '60 Gy', 'date_administered': '2024-08-09', 'side_effects': 'Skin redness at the treatment site', 'notes': 'Patient tolerated the procedure well.' }, { 'session_number': 2, 'target_area': 'Right upper lobe of the lung', 'radiation_dose': '60 Gy', 'date_administered': '2024-08-20', 'side_effects': 'Increased skin redness, slight shortness of breath', 'notes': 'Patient was advised to monitor for increased shortness of breath and to contact the care team if symptoms worsen.' } ] } }; "

    ];
    /*
    const gptScript = [
        "//Respond with only JSON. You generate Node.js/Express apps using a proprietary json structure. This is not javascript so you can't use things like .replace or .split. Always put json data in a 'data' key. Notice how I combine json references before referencing the nested objects. Always do this! '=>' can only be used once per tag.  \nstore: {\"req\":req, \"res\":res, \"fs\":fs, \"axios\":axios, \"math\":mathjs, \"JSON\":JSON, \"Buffer\":Buffer} //pre-created targets\nvar: {\"modules\": {}, \"actions\": []}\nvar.modules: {\"moduleName\": \"npmPackageName\"} \nvar.email:[{\"from\": \"jaustinhughes@gmail.com\",\"to\": \"1v4r1b356363-88ca-3463s-a653-d997a2a80073\",\"subject\": \"Subject Text\",\"date\": \"Mon, 1 Apr 2024 01:52:40 -0400\",\"emailID\": \"0lroo0umdm72o9vt0asdf444fne6suc54c2pfa81\"}] // store.moduleName\nvar.actions: {\"if\":[], \"while\":[], \"set\":{}, \"target\":\"\", \"chain\":[], \"actions\":[], \"next\":bool}\nvar.actions[n].if: [[\"string\",\"==\",\"string\"],[\"{|counter|}\",\"<\",5]]\nvar.actions[n].while: [[\"string\",\"==\",\"string\"],[\"{|counter|}\",\"<\",5]]\nvar.actions[n].set: {\"action1\":\"value\", \"action2\":{\"object\":true}, \"action3\":[0,1,2], \"action4\":\"{|res|}\"} // store.action1, store.action2, store.action3, store.action4a\nvar.actions[n].target: \"{|action4a|}\" //store.action4a\nvar.actions[n].chain: [{\"access\":\"send\", \"parames\":[\"html\"]}, \"new\":true, \"express\":true] //store.action4a.send(\"html\")\nvar.actions[n].actions: [{\"if\":[], \"while\":[], \"set\":{}, \"target\":\"\", \"chain\":[], \"actions\":[], \"next\":true}, {}] //store.action4a.action4b\nvar.actions[n].assign: \"{|targetName|}\" //store.targetName\nvar.actions[n].params: [\"{|arg1|}\", \"{|arg2||}\", \"string\"] //store.targetName(store.targetName.arg1,store.targetName.arg2, \"string\")\nvar.actions[n].next: true // req.next()\nvar.actions[n].express true //store.targetName()(req,res,next)\n(var.actions[n].next: true and var.actions[n].express: true) //store.targetName()(req,res)\n\n//special considerations\nvar.actions[n].action4b.set: {\"~/counter\":0} // the ~/ forces path to store root\nvar.actions[n]: {\"while\":[[\"{|counter|}\",\"<\",3]], \"set\":{\"{|~/counter|}\":\"{|={|~/counter|}+1|}\"}} // while array is not nested, set is nested.  While is an array of array conditions just like if conditions. \nvar.actions[n]: {\"set\":{\"obj\":{\"key\":\"value\"}, \"{|obj=>key|}\":\"newValue\"}} // obj is an object, => accesses the object\nvar.actions[n]: {\"set\":{\"obj\":[0,1,3], \"{|arr=>[2]|}\":2}} // arr is an array, =>[n] accesses the index\nvar.actions[n]: {\"set\":{\"result\":\"{|=pi*{|counter|}|}\"}} // = starts a npm mathjs formula like excel formulas\nvar.actions[n].chain.new: true // new store.targetName();\nvar.action[n].chain.express: true // store.targetName()(req,res,next);\nvar.action[n].chain.express: true  and var.action[n].chain.express: true  // store.targetName()(req,res,next);",
        "\n\n//Example 1: create a list of the most populated places in the world. Add the current times. Create a clock and allow me to click a location to update the clock. {\"modules\":{\"moment-timezone\":\"moment-timezone\"},\"actions\":[{\"target\":\"{|moment-timezone|}\",\"chain\":[],\"assign\":\"{|momentTimezone|}!\"},{\"set\":{\"data\":{\"countries\":[{\"country\":\"China\",\"population\":1444216107,\"city\":\"Beijing\",\"timezone\":\"Asia/Shanghai\"},{\"country\":\"India\",\"population\":1393409038,\"city\":\"New Delhi\",\"timezone\":\"Asia/Kolkata\"},{\"country\":\"United States\",\"population\":331893745,\"city\":\"Washington D.C.\",\"timezone\":\"America/New_York\"},{\"country\":\"Indonesia\",\"population\":276361783,\"city\":\"Jakarta\",\"timezone\":\"Asia/Jakarta\"},{\"country\":\"Pakistan\",\"population\":225199937,\"city\":\"Islamabad\",\"timezone\":\"Asia/Karachi\"}]}}},{\"set\":{\"svgWidth\":600,\"svgHeight\":400,\"styles\":\".country-text { font-family: Arial, sans-serif; font-size: 14px; fill: #000; cursor: pointer; } .time-text { font-family: Arial, sans-serif; font-size: 12px; fill: #666; } .clock-face { fill: #f0f0f0; stroke: #333; stroke-width: 2; } .clock-hand { stroke: #333; stroke-width: 2; stroke-linecap: round; }\",\"yPos\":30,\"svgContent\":\"<svg width='{|svgWidth|}' height='{|svgHeight|}' xmlns='http://www.w3.org/2000/svg'><style>{|styles|}</style>\"}},{\"set\":{\"counter\":0}},{\"while\":[[\"{|counter|}\",\"<\",\"{|data=>countries.length|}\"]],\"set\":{\"item\":\"{|data=>countries[{|counter|}]|}\",\"timezone\":\"{|item=>timezone|}\",\"svgContent\":\"{|svgContent|}<text class='country-text' x='10' y='{|yPos|}' onclick='updateClock(\\\"{|timezone|}\\\")'>{|item=>country|} ({|item=>city|}): {|item=>population|}</text><text class='time-text' x='450' y='{|yPos|}' id='time-{|counter|}'></text>\",\"yPos\":\"{|={|yPos|} + 50|}\",\"counter\":\"{|={|counter|} + 1|}\"}},{\"set\":{\"svgContent\":\"{|svgContent|}<circle cx='300' cy='350' r='40' class='clock-face'/><line x1='300' y1='350' x2='300' y2='320' class='clock-hand' id='hour-hand'/><line x1='300' y1='350' x2='300' y2='315' class='clock-hand' id='minute-hand'/><line x1='300' y1='350' x2='300' y2='310' class='clock-hand' id='second-hand'/></svg><script src='https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.1/moment.min.js'></script><script src='https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.33/moment-timezone-with-data.min.js'></script><script>function updateClock(timezone) {var now = moment.tz(timezone);var hour = now.hour() % 12;var minute = now.minute();var second = now.second();document.getElementById('hour-hand').setAttribute('transform', 'rotate(' + (hour * 30 + minute / 2) + ', 300, 350)');document.getElementById('minute-hand').setAttribute('transform', 'rotate(' + (minute * 6) + ', 300, 350)');document.getElementById('second-hand').setAttribute('transform', 'rotate(' + (second * 6) + ', 300, 350)');} function updateAllTimes() {var countries = {|data=>countries|};countries.forEach((country, index) => {var time = moment.tz(country.timezone).format('HH:mm:ss');document.getElementById('time-' + index).textContent = time;});}updateAllTimes();setInterval(updateAllTimes, 1000);</script>\"}},{\"target\":\"{|res|}\",\"chain\":[{\"access\":\"send\",\"params\":[\"{|svgContent|}\"]}]}],\"email\":[],\"blocks\":[{\"entity\":\"1v4r335d2eb4-0bf3-45a4-a518-4bab08e5d528\",\"width\":\"100\",\"align\":\"center\"}],\"ai\":true}",
        "\n\n//Example 2: create the current time in new york.\n{ \"modules\": {\"moment-timezone\":\"moment-timezone\"}, \"actions\":[{\"target\": \"{|moment-timezone|}\",\"params\": [],\"chain\": [{\"access\": \"tz\",\"params\": [\"America/New_York\"]},{\"access\": \"format\",\"params\": [\"hh:mm:ss\"]}],\"assign\": \"{|timeInZone|}!\"},{\"target\": \"{|res|}\",\"chain\": [{\"access\": \"send\",\"params\": [\"{|timeInZone|}\"]}]}], 'email':[]}",
        "\n\n//Example 3: create an svg of a list of topics. Give the list letter bullets with purple circle backgrounds. The list is: housing 100%, transportation  50%.\n{ \"modules\": {}, \"actions\": [ { \"set\": { \"data\": { \"svgWidth\": 240, \"points\": [], \"letters\": [ \"A\", \"B\" ], \"items\": [ { \"name\": \"Housing\", \"percent\": 100 }, { \"name\": \"Transportation\", \"percent\": 50 } ], \"styles\": [ \".point-text, .legend-text { font-family: Arial, sans-serif; font-size: 14px; fill: #734b9e; }\", \".legend-text { font-family: Arial, sans-serif; font-size: 14px; fill: #e4dfed; }\", \".legend-bg { fill: #e4dfed; rx: 5; ry: 5; }\" ] } } }, { \"set\": { \"lettersLength\": \"{|data=>letters.length|}\", \"svgns\": \"http://www.w3.org/2000/svg\", \"svgWH\": \"{|data=>svgWidth|} \", \"centerXY\": \"{|={|svgWH|}/2|}\", \"svgHeight\": \"{|=30+(30*{|lettersLength|})|}\", \"svgContent\": \"<svg id='svg123' width='{|data=>svgWidth|}' height='{|svgHeight|}' xmlns='http://www.w3.org/2000/svg'><style>{|data=>styles[0]|}{|data=>styles[1]|}{|data=>styles[2]|}{|data=>styles[3]|}{|data=>styles[4]|}</style>\", \"styles\": \"\", \"pathString\": \"\", \"points\": [], \"counter\": 0, \"letters\": \"{|data=>letters|}\", \"step\": \"{|=(2*pi)/{|lettersLength|}|}\" } }, { \"set\": { \"counter\": 0 } }, { \"while\": [ [ \"{|counter|}\", \"<\", \"{|~/data=>letters.length|}\" ] ], \"set\": { \"increment\": \"{|={|~/counter|}*30|}\", \"yOffset\": \"{|={|increment|}+20|}\", \"obj\": \"{|~/data=>items[{|~/counter|}]|}\", \"svgContent\": \"{|svgContent|}<circle cx='30' cy='{|={|yOffset|}+9|}' r='10' fill='#734b9e'/><text x='30' y='{|={|yOffset|}+9|}' class='legend-text' text-anchor='middle' dy='.35em'>{|data=>letters[{|~/counter|}]|}</text><text x='50' y='{|={|yOffset|}+14|}' class='point-text'>{|obj=>name|}: {|obj=>percent|}%</text>\", \"~/counter\": \"{|={|~/counter|}+1|}\" } }, { \"target\": \"{|res|}\", \"chain\": [ { \"access\": \"send\", \"params\": [ \"{|svgContent|}\" ] } ] } ], 'email':[] }",
        "\n\n//Example 4: show this image on the page \"https://domain.com/image.png\"\n{ \"modules\": {}, \"actions\": [ { \"target\": \"{|axios|}\", \"chain\": [ { \"access\": \"get\", \"params\": [ \"https://domain.com/image.png\", { \"responseType\": \"arraybuffer\" } ] } ], \"assign\": \"{|imageResponse|}\" }, { \"target\": \"{|Buffer|}\", \"chain\": [ { \"access\": \"from\", \"params\": [ \"{|imageResponse=>data|}\", \"binary\" ] }, { \"access\": \"toString\", \"params\": [ \"base64\" ] } ], \"assign\": \"{|base64Image|}\" }, { \"target\": \"{|res|}\", \"chain\": [ { \"access\": \"send\", \"params\": [ \"<img src='data:image/png;base64,{|base64Image|}' />\" ] } ] } ], 'email':[] }",
        "\n\n//Example 5: merge these two paths \"https://domain.com and \"favicon.png\n{ \"modules\": { \"path\": \"path\" }, \"actions\": [ { \"target\": \"{|path|}\", \"chain\": [ { \"access\": \"join\", \"params\": [ \"https://domain.com\", \"favicon.png\" ] } ], \"assign\": \"{|imagePath|}\" }, { \"target\": \"{|res|}\", \"chain\": [ { \"access\": \"send\", \"params\": [ \"{|imagePath|}\" ] } ] } ], 'email':[] }",
        "\n\n//Example 6: download this pdf https://domain.com/document.pdf and convert it to a png.\n{ \"modules\": { \"gm\": \"gm\" }, \"actions\": [ { \"target\": \"{|axios|}\", \"chain\": [ { \"access\": \"get\", \"params\": [ \"https://public.1var.com/favicon.pdf\", { \"responseType\": \"arraybuffer\" } ] } ], \"assign\": \"{|pdfResponse|}!\" }, { \"target\": \"{|fs|}\", \"chain\": [ { \"access\": \"writeFileSync\", \"params\": [ \"/tmp/document.pdf\", \"{|pdfResponse=>data|}\" ] } ] }, { \"target\": \"{|gm|}\", \"chain\": [ { \"access\": \"convert\", \"params\": [ \"/tmp/document.pdf[0]\", \"/tmp/output.png\" ] } ], \"assign\": \"{|convertedImage|}\" }, { \"target\": \"{|fs|}\", \"chain\": [ { \"access\": \"readFileSync\", \"params\": [ \"/tmp/output.png\" ] }, { \"access\": \"toString\", \"params\": [ \"base64\" ] } ], \"assign\": \"{|base64Image|}\" }, { \"target\": \"{|res|}\", \"chain\": [ { \"access\": \"send\", \"params\": [ \"<img src='data:image/png;base64,{|base64Image|}' />\" ] } ] } ], 'email':[] }",
        "\n\n//Example 8: create a pdf that says hello world and send it to the user\n{ \"modules\": { \"pdfkit\": \"pdfkit\" }, \"actions\": [ { \"target\": \"{|pdfkit|}\", \"chain\": [ { \"access\": \"\", \"params\": [], \"new\": true } ], \"assign\": \"{|doc|}!\" }, { \"target\": \"{|doc|}\", \"chain\": [ { \"access\": \"fontSize\", \"params\": [ 24 ] }, { \"access\": \"text\", \"params\": [ \"Hello World\", 100, 100 ] }, { \"access\": \"end\" } ] }, { \"target\": \"{|res|}\", \"chain\": [ { \"access\": \"writeHead\", \"params\": [ 200, { \"Content-Type\": \"application/pdf\", \"Content-Disposition\": \"attachment;filename=hello.pdf\" } ] } ] }, { \"target\": \"{|doc|}\", \"chain\": [ { \"access\": \"pipe\", \"params\": [\"{|res|}\"]}]}], 'email':[]}",
        "\n\n//Example 9: create a json database that has building and tenants. {\"modules\":{},\"actions\":[{\"set\":{\"data\":{\"features\":{\"0\":\"Washer/Dryer\",\"1\":\"Garage\",\"2\":\"Hardwood Floors\",\"3\":\"Walk-In Shower\"},\"properties\":{\"0\":{\"address\":\"1000 Park Ave\",\"city\":\"New York\",\"state\":\"New York\",\"zip\":\"10001\",\"Units\":{\"A\":{\"tenants\":[\"0\"],\"start\":\"01/01/24\",\"end\":\"12/31/24\",\"years\":1,\"bedrooms\":2,\"features\":[\"0\",\"1\"]},\"B\":{\"tenants\":[\"1\"],\"start\":\"06/01/24\",\"end\":\"05/31/25\",\"years\":1,\"bedrooms\":3,\"features\":[\"0\",\"2\"]},\"C\":{\"tenants\":[\"2\",\"3\"],\"start\":\"06/15/24\",\"end\":\"06/14/25\",\"years\":1,\"bedrooms\":4,\"features\":[\"1\",\"3\"]},\"D\":{\"tenants\":[],\"start\":\"\",\"end\":\"\",\"years\":0,\"bedrooms\":2,\"features\":[\"2\",\"3\"]},\"E\":{\"tenants\":[\"4\"],\"start\":\"08/01/24\",\"end\":\"07/31/25\",\"years\":1,\"bedrooms\":3,\"features\":[\"0\",\"1\",\"2\"]},\"F\":{\"tenants\":[\"5\"],\"start\":\"03/01/24\",\"end\":\"02/28/26\",\"years\":2,\"bedrooms\":2,\"features\":[\"1\",\"2\",\"3\"]},\"G\":{\"tenants\":[\"6\"],\"start\":\"06/01/24\",\"end\":\"05/31/25\",\"years\":1,\"bedrooms\":1,\"features\":[\"0\",\"1\"]}}},\"1\":{\"address\":\"4712 Adams St\",\"city\":\"Hoboken\",\"state\":\"New Jersey\",\"zip\":\"07087\",\"Units\":{\"101\":{\"tenants\":[\"7\"],\"start\":\"06/01/24\",\"end\":\"05/31/25\",\"years\":1,\"bedrooms\":2,\"features\":[\"1\"]},\"102\":{\"tenants\":[\"8\"],\"start\":\"06/01/24\",\"end\":\"05/31/26\",\"years\":2,\"bedrooms\":2,\"features\":[\"0\",\"3\"]}}}},\"totalProperties\":2,\"tenants\":{\"0\":{\"first\":\"Adam\",\"last\":\"Smith\",\"unit\":\"A\",\"property\":\"0\",\"phone\":\"212-377-3632\",\"credit\":800,\"email\":\"adam.smith@gmail.com\"},\"1\":{\"first\":\"Austin\",\"last\":\"Hughes\",\"unit\":\"B\",\"property\":\"0\",\"phone\":\"212-347-3186\",\"credit\":820,\"email\":\"jaustinhughes@gmail.com\"},\"2\":{\"first\":\"John\",\"last\":\"Doe\",\"unit\":\"C\",\"property\":\"0\",\"phone\":\"212-481-2296\",\"credit\":769,\"email\":\"john.doe@gmail.com\"},\"3\":{\"first\":\"Jane\",\"last\":\"Doe\",\"unit\":\"C\",\"property\":\"0\",\"phone\":\"212-713-4142\",\"credit\":735,\"email\":\"jane.doe@gmail.com\"},\"4\":{\"first\":\"Bob\",\"last\":\"Builder\",\"unit\":\"E\",\"property\":\"0\",\"phone\":\"212-926-1881\",\"credit\":790,\"email\":\"bob.builder@gmail.com\"},\"5\":{\"first\":\"Alice\",\"last\":\"Wonderland\",\"unit\":\"F\",\"property\":\"0\",\"phone\":\"212-332-5700\",\"credit\":810,\"email\":\"alice.wonderland@gmail.com\"},\"6\":{\"first\":\"Charlie\",\"last\":\"Brown\",\"unit\":\"G\",\"property\":\"0\",\"phone\":\"212-627-6442\",\"credit\":800,\"email\":\"charlie.brown@gmail.com\"},\"7\":{\"first\":\"Bruce\",\"last\":\"Wayne\",\"unit\":\"101\",\"property\":\"1\",\"phone\":\"212-373-2500\",\"credit\":781,\"email\":\"bruce.wayne@gmail.com\"},\"8\":{\"first\":\"Clark\",\"last\":\"Kent\",\"unit\":\"102\",\"property\":\"1\",\"phone\":\"212-277-3853\",\"credit\":786,\"email\":\"clark.kent@gmail.com\"}},\"totalTenants\":9}}},{\"target\":\"{|res|}\",\"chain\":[{\"access\":\"send\",\"params\":[\"{|./|} Data<script>var selectedTenant = 0; var selectedProperty = 0; var selectedUnit = 'A'; var data = {|data|}; var emails = {|email|};</script>\"]}]}],\"email\":[],\"blocks\":[],\"ai\":true}"]
*/

    const head = await getHead("su", entity, dynamodb)
    let isPublic = head.Items[0].z

    let results = await retrieveAndParseJSON(entity, isPublic);

    let blocks = JSON.parse(JSON.stringify(results.blocks))
    let modules = JSON.parse(JSON.stringify(results.modules))
    results = JSON.stringify(results)

    //console.log("GPTSCRIPT:33", gptScript);
    //console.log("PROMPT:33", question);
    //console.log("ENTITY:33", entity);
    //console.log("RESULTS:33", results);

    let combinedPrompt = `${gptScript} /n/n Using the proprietary json structure. RESPOND BACK WITH JUST AND ONLY A SINGLE JSON FILE!! NO COMMENTS!! NO EXPLINATIONS!! NO INTRO!! JUST JSON!!:  ${question.prompt} /n/n Here is the code to edit; ${results} `

    //console.log(combinedPrompt);
    //console.log("openai", openai)

    let response;
    let jsonParsed;
    let jsonString
    if (false) {
        //{apiKey: 'my_api_key', // defaults to process.env["ANTHROPIC_API_KEY"]}
        const anthropic = new Anthropic();

        response = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20240620",//"claude-3-opus-20240229", //"claude-3-sonnet-20240229",// "claude-3-haiku-20240307", // 
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

        //console.log("stringifyANTHROPIC", JSON.stringify(response))
        jsonParsed = JSON.parse(response.content[0].text)
        jsonParsed.modules = modules
        jsonParsed.blocks = blocks
        jsonParsed.ai = true;
        jsonString = response.content
    } else {
        response = await openai.chat.completions.create({
            messages: [{ role: "system", content: combinedPrompt }],
            model: "o3-mini-2025-01-31",//"o1-mini-2024-09-12",//"gpt-4o-2024-08-06", //"gpt-3.5-turbo-0125", // "gpt-3.5-turbo-1106",
            response_format: { "type": "json_object" }
        });

        //console.log(">>>",response)
        //console.log("stringifyOPENAI", JSON.stringify(response))
        /*console.log("text.trim", response.choices[0].message.content)
        console.log(`--${response.choices[0].message.content}--`)

        if (response.choices[0].message.content.includes("```json")) {
            jsonString = response.choices[0].message.content.split("```json", "")[1]
        } else {
            if (response.choices[0].message.content.includes("{")) {
                jsonString = response.choices[0].message.content
            }
        }*/
        jsonParsed = JSON.parse(response.choices[0].message.content)
        jsonParsed.modules = modules
        jsonParsed.blocks = blocks
        jsonParsed.ai = true;
    }

    //console.log(parsableJSONresponse)
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
            console.log(`No items found in table ${tableName}`);
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

        // DynamoDB batchWrite can handle up to 25 items at a time
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

async function route(req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, isShorthand, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken) {
    cache = {
        getSub: {},
        getEntity: {},
        getWord: {},
        getGroup: {},
        getAccess: {},
        getVerified: {},
    }
    //console.log("route", req)
    console.log("req.body", req.body)
    console.log("reqBody", reqBody)
    //console.log("req.headers", req.headers)

    var response = {}
    var actionFile = ""
    var mainObj = {}
    if (reqMethod === 'GET' || reqMethod === 'POST') {

        console.log("1111")
        let cookie = await manageCookie(mainObj, xAccessToken, res, dynamodb, uuidv4)
        console.log("2222", cookie)
        const verifications = await getVerified("gi", cookie.gi.toString(), dynamodb)
        console.log("3333", verifications)
        let splitPath = reqPath.split("/")
        console.log("4444", splitPath)
        let verified = await verifyPath(splitPath, verifications, dynamodb);
        console.log("5555", verified)


        let allV = allVerified(verified);
        console.log("6666", allV)
        if (allV) {
            console.log("7777", action)
            if (action === "get") {
                console.log("get")
                const fileID = reqPath.split("/")[3]
                actionFile = fileID
                mainObj = await convertToJSON(fileID, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                console.log("8888", mainObj)
                let tasksUnix = await getTasks(fileID, "su", dynamodb)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO

            } else if (action == "resetDB") {

                try {
                    // Clear specified tables
                    for (const tableName of tablesToClear) {
                        await clearTable(tableName, dynamodb);
                        console.log(`Cleared table: ${tableName}`);
                    }

                    // Reset counters
                    for (const counter of countersToReset) {
                        await resetCounter(counter, dynamodb);
                        console.log(`Reset counter in table: ${counter.tableName}`);
                    }

                    mainObj = { "alert": "success" }
                } catch (error) {
                    console.error('Error resetting database:', error);

                    mainObj = { "alert": "failed" }
                }


            } else if (action == "add") {
                //console.log("add");
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
                //console.log("link")
                const childID = reqPath.split("/")[3]
                const parentID = reqPath.split("/")[4]
                await linkEntities(childID, parentID)
                mainObj = await convertToJSON(childID, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "newGroup") {
                //console.log("newGroup")
                if (cookie != undefined) {
                    const newGroupName = reqPath.split("/")[3]
                    const headEntityName = reqPath.split("/")[4]
                    const parentEntity = reqPath.split("/")[5]
                    console.log("parentEntity", parentEntity) //This seems like I was trying to add a new group to a parent. THere isn't logic in the front-end that is sending parentEntity
                    setIsPublic(true)
                    //console.log("A")
                    const aNewG = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                    //console.log("B")
                    const aG = await createWord(aNewG.toString(), newGroupName, dynamodb);
                    //console.log("C")
                    const aNewE = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                    //console.log("D")
                    const aE = await createWord(aNewE.toString(), headEntityName, dynamodb);
                    //console.log("E")
                    const gNew = await incrementCounterAndGetNewValue('gCounter', dynamodb);
                    //console.log("F")
                    const e = await incrementCounterAndGetNewValue('eCounter', dynamodb);
                    //console.log("G")
                    const ai = await incrementCounterAndGetNewValue('aiCounter', dynamodb);
                    //console.log("H")
                    const access = await createAccess(ai.toString(), gNew.toString(), "0", { "count": 1, "metric": "year" }, 10, { "count": 1, "metric": "minute" }, {}, "rwado")
                    //console.log("I")
                    const ttlDurationInSeconds = 90000; // For example, 1 hour
                    //console.log("J")
                    const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
                    //console.log("K")
                    const vi = await incrementCounterAndGetNewValue('viCounter', dynamodb);
                    //console.log("L")
                    //console.log("vi", vi)
                    await createVerified(vi.toString(), cookie.gi.toString(), gNew.toString(), "0", ai.toString(), "0", ex, true, 0, 0)

                    const groupID = await createGroup(gNew.toString(), aNewG, e.toString(), [ai.toString()], dynamodb);
                    const uniqueId = await getUUID(uuidv4)
                    //console.log(uniqueId, "0", "0", )
                    let subRes = await createSubdomain(uniqueId, "0", "0", gNew.toString(), true, dynamodb)
                    const details = await addVersion(e.toString(), "a", aE.toString(), null, dynamodb);
                    const result = await createEntity(e.toString(), aE.toString(), details.v, gNew.toString(), e.toString(), [ai.toString()], dynamodb); //DO I NEED details.c
                    const uniqueId2 = await getUUID(uuidv4)
                    const fileResult = await createFile(uniqueId2,
                        {
                            "input": [{
                                "physical": [
                                    [{}],
                                    ["ROWRESULT", "000", "NESTED", "000!!", "blocks", [{ "entity": uniqueId2, "name": "Primary" }]],
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
                                "blocks": [{ "entity": uniqueId2, "name": "Primary" }],
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
                    actionFile = uniqueId2
                    let subRes2 = await createSubdomain(uniqueId2, aE.toString(), e.toString(), "0", true, dynamodb)
                    //console.log("ses",ses)
                    let from = "noreply@email.1var.com"
                    let to = "austin@1var.com"
                    let subject = "1 VAR - Email Address Verification Request"
                    let emailText = "Dear 1 Var User, \n\n We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. \n\n http://1var.com/verify/" + uniqueId
                    let emailHTML = "Dear 1 Var User, <br><br> We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. <br><br> http://1var.com/verify/" + uniqueId
                    let emailer = await email(from, to, subject, emailText, emailHTML, ses)  //COMMENTED OUT BECAUSE WE ONLY GET 200 EMAILS IN AMAZON SES.
                    console.log(emailer)
                    mainObj = await convertToJSON(uniqueId2, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                }
            } else if (action === "useGroup") {
                //console.log("useGroup")
                actionFile = reqPath.split("/")[3]
                const newUsingName = reqPath.split("/")[3]
                //console.log("newUsingName", newUsingName)
                const headUsingName = reqPath.split("/")[4]
                //console.log("headUsingName", headUsingName)
                const using = await getSub(newUsingName, "su", dynamodb);
                //console.log("using", using)
                const ug = await getEntity(using.Items[0].e, dynamodb)
                //console.log("ug", ug)
                const used = await getSub(headUsingName, "su", dynamodb);
                //console.log("used", used)
                const ud = await getEntity(used.Items[0].e, dynamodb)
                //console.log("ud", ud)
                const details2 = await addVersion(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), ug.Items[0].c, dynamodb);
                //console.log("details2", details2)
                const updateParent = await updateEntity(ug.Items[0].e.toString(), "u", ud.Items[0].e.toString(), details2.v, details2.c, dynamodb);
                //console.log("updateParent", updateParent)
                const headSub = await getSub(ug.Items[0].h, "e", dynamodb);
                //console.log("headSub", headSub)
                mainObj = await convertToJSON(headSub.Items[0].su, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                //console.log("mainObj", mainObj)
            } else if (action === "map") {
                //console.log("map")
                const referencedParent = reqPath.split("/")[3]
                const newEntityName = reqPath.split("/")[4]
                const mappedParent = reqPath.split("/")[5]
                const headEntity = reqPath.split("/")[6]
                const subRefParent = await getSub(referencedParent, "su", dynamodb);
                setIsPublic(subRefParent.Items[0].z);
                //console.log("mappedParent", mappedParent)
                const subMapParent = await getSub(mappedParent, "su", dynamodb);
                //console.log("subMapParent", subMapParent)
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

                //copy parent
                const updateList = eParent.Items[0].t
                for (u in updateList) {

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
                mainObj = await convertToJSON(headUUID, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)

            } else if (action === "reqPut") {
                //This logic request for the permission to put a file in s3 bucket.
                actionFile = reqPath.split("/")[3]
                fileCategory = reqPath.split("/")[4]
                fileType = reqPath.split("/")[5]
                const subBySU = await getSub(actionFile, "su", dynamodb);
                setIsPublic(subBySU.Items[0].z)
                //console.log("subBySU", subBySU)
                //console.log("actionFile", actionFile)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "file") {
                //console.log("file")
                actionFile = reqPath.split("/")[3]
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                let tasksUnix = await getTasks(actionFile, "su", dynamodb)
                //console.log("tasksUnix", tasksUnix)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO

            } else if (action === "addFineTune") {
                let sections = reqPath.split("/")
                console.log("req.body.body", reqBody.body)
                const fileResult = await updateJSONL(reqBody.body, sections, s3)
                mainObj = { "alert": "success" }
            } else if (action === "createFineTune") {
                let sections = reqPath.split("/")
                console.log("sections[3]", sections[3])
                console.log("sections[4]", sections[4])
                const fineTuneResponse = await fineTune(openai, "create", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "listFineTune") {
                let sections = reqPath.split("/")
                console.log("sections[3]", sections[3])
                const fineTuneResponse = await fineTune(openai, "list", sections[3], "")
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "deleteFineTune") {
                let sections = reqPath.split("/")
                console.log("sections[3]", sections[3])
                console.log("sections[4]", sections[4])
                const fineTuneResponse = await fineTune(openai, "delete", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "eventsFineTune") {
                let sections = reqPath.split("/")
                console.log("sections[3]", sections[3])
                console.log("sections[4]", sections[4])
                const fineTuneResponse = await fineTune(openai, "events", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "retrieveFineTune") {
                let sections = reqPath.split("/")
                console.log("sections[3]", sections[3])
                console.log("sections[4]", sections[4])
                const fineTuneResponse = await fineTune(openai, "retrieve", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "cancelFineTune") {
                let sections = reqPath.split("/")
                console.log("sections[3]", sections[3])
                console.log("sections[4]", sections[4])
                const fineTuneResponse = await fineTune(openai, "cancel", sections[3], sections[4])
                mainObj = { "alert": JSON.stringify(fineTuneResponse) }
            } else if (action === "saveFile") {
                console.log("saveFile")
                actionFile = reqPath.split("/")[3]
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
                console.log("req", req)
                console.log("req.body", JSON.stringify(req.body, null, 2));
                const fileResult = await createFile(actionFile, reqBody.body, s3)
            } else if (action === "makePublic") {
                actionFile = reqPath.split("/")[3]
                let permission = reqPath.split("/")[4]
                const permStat = await updateSubPermission(actionFile, permission, dynamodb, s3)
                //console.log("permStat", permStat)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)
            } else if (action === "makeAuthenticator") {


                const subUuid = reqPath.split("/")[3]
                actionFile = reqPath.split("/")[3]
                //console.log("subUuid", subUuid)
                const sub = await getSub(subUuid, "su", dynamodb);
                //console.log("sub", sub)
                let buffer = false
                if (reqBody.body.hasOwnProperty("type")) {
                    if (reqBody.body.type == "Buffer") {
                        buffer = true
                    }
                }
                //console.log("buffer", buffer)
                let ex = false
                let at = false
                let va = false
                let to = false
                let ac = false
                if (!buffer) {
                    //console.log("reqBody.body", reqBody.body)
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
                //console.log("ex", ex)
                //console.log("at", at)
                //console.log("va", va)
                //console.log("to", to)
                //console.log("ac", ac)
                if (ex && at && va && to && ac && !buffer) {
                    const ai = await incrementCounterAndGetNewValue('aiCounter', dynamodb);
                    console.log("values are truthy", ai.toString())
                    const access = await createAccess(ai.toString(), sub.Items[0].g.toString(), sub.Items[0].e.toString(), ex, at, to, va, ac)
                    console.log(access)

                    if (sub.Items[0].e.toString() != "0") {
                        const details2 = await addVersion(sub.Items[0].e.toString(), "ai", ai.toString(), null, dynamodb);
                        //console.log("details2", details2)
                        const updateParent = await updateEntity(sub.Items[0].e.toString(), "ai", ai.toString(), details2.v, details2.c, dynamodb);
                        //console.log("updateParent", updateParent)
                    }
                }
                //console.log("actionFile", actionFile)
                //console.log("subUuid", subUuid)
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody)

            } else if (action === "validation") {
                const subUuid = reqPath.split("/")[3]
                //console.log("subUuid", subUuid)
                const sub = await getSub(subUuid, "su", dynamodb);
                //console.log("sub", sub)
                let params = { TableName: 'access', IndexName: 'eIndex', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': sub.Items[0].e.toString() } }
                let access = await dynamodb.query(params).promise()
                //console.log("access>>", access)
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
                //console.log("subUuid", subUuid)
                const sub = await getSub(subUuid, "su", dynamodb);
                //console.log("sub", sub)
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
                console.log("Entity", Entity)
                console.log("Authenticator", Authenticator)
                const subEntity = await getSub(Entity, "su", dynamodb);
                const subAuthenticator = await getSub(Authenticator, "su", dynamodb);
                console.log("subEntity", subEntity)
                console.log("subAuthenticator", subAuthenticator)
                let params = { TableName: 'access', IndexName: 'eIndex', KeyConditionExpression: 'e = :e', ExpressionAttributeValues: { ':e': subAuthenticator.Items[0].e.toString() } }
                let access = await dynamodb.query(params).promise()
                console.log("access", access)

                //We're only grabbing the first entity and applying it. THere might be multiple access entities that we need to loop through and give them all to the set entity.
                const useE = await getEntity(subEntity.Items[0].e, dynamodb)
                console.log("usubEntity.Items[0]", subEntity.Items[0]);
                for (ac in access.Items) {
                    console.log("access.Items[0]", access.Items[ac]);
                    console.log("useE.Items[0]", useE.Items[0]);
                    console.log("useE", useE)
                    let changeID = "1"
                    if (useE.Items[0].hasOwnProperty("c")) {
                        changeID = useE.Items[0].c.toString();
                    }
                    const details3 = await addVersion(subEntity.Items[0].e.toString(), "ai", access.Items[ac].ai.toString(), changeID, dynamodb);
                    console.log("updateEntity", subEntity.Items[0].e.toString(), "ai", access.Items[ac].ai.toString(), details3.v, details3.c)
                    const updateAuth = await updateEntity(subEntity.Items[0].e.toString(), "ai", access.Items[ac].ai.toString(), details3.v, details3.c, dynamodb);
                    console.log("updateAuth", updateAuth)
                }
                mainObj = { "alert": "success" }
            } else if (action == "createTask") {
                const fileID = reqPath.split("/")[3]
                actionFile = fileID

                const task = reqBody.body;
                //console.log(task);
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

                //console.log("taskJSON", taskJSON)
                const schedules = await convertTimespanToUTC(taskJSON)
                //console.log("schedules", schedules)
                //This needs to expire on unix timestamp UTC not ETC



                //console.log(`task.taskID -${task.taskID}`)
                let ti
                if (task.taskID === "") {
                    //console.log("taskID === ''")
                    ti = await incrementCounterAndGetNewValue('tiCounter', dynamodb);
                } else {
                    //console.log("taskID != ''")
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
                //console.log("deleteTask", action)
                const task = reqBody.body;
                //console.log("task.taskID", task.taskID)
                await removeSchedule(task.taskID);
                let tasksUnix = await getTasks(fileID, "su", dynamodb)
                let tasksISO = await getTasksIOS(tasksUnix)
                mainObj["tasks"] = tasksISO
            } else if (action == "updateEntityByAI") {
                const fileID = reqPath.split("/")[3]
                actionFile = fileID
                const prompt = reqBody.body;
                //The oai is the published. not the entire shorthand
                //The updated prompt will be the shorthand and we will run it to get the published.
                let oai = await runPrompt(prompt, fileID, dynamodb, openai, Anthropic);
                const params = {
                    Bucket: fileLocation(oai.isPublic) + ".1var.com", // Replace with your bucket name
                    Key: fileID,
                    Body: oai.response,
                    ContentType: "application/json"
                };
                //console.log(JSON.stringify(params))
                //console.log(JSON.stringify(params.body))
                await s3.putObject(params).promise();

                mainObj["oai"] = JSON.parse(oai.response);
            } else if (action == "position") {
                console.log("position>>>>>>>", reqBody)
                const { description, domain, subdomain, embedding, entity } = reqBody.body || {};


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

                    // if stored as a JSON string, parse it
                    if (typeof raw === 'string') {
                        try {
                            refArr = JSON.parse(raw);
                        } catch (err) {
                            console.warn(`Failed to parse ${attr} for ${domain}/${subdomain}:`, err);
                            continue;
                        }
                    }
                    // if it’s already an array, use it directly
                    else if (Array.isArray(raw)) {
                        refArr = raw;
                    }

                    // skip anything that didn’t become an array of the right length
                    if (!Array.isArray(refArr) || refArr.length !== embedding.length) {
                        continue;
                    }

                    // compute distance against the parsed vector
                    distances[attr] = cosineDist(embedding, refArr);
                }
                console.log("-^-^-^-^-^-^-^-^-^-^-^-")
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
                            #path = :path
                      `,
                        ExpressionAttributeNames: {
                            '#d1': 'dist1',
                            '#d2': 'dist2',
                            '#d3': 'dist3',
                            '#d4': 'dist4',
                            '#d5': 'dist5',
                            '#path': 'path'
                        },
                        ExpressionAttributeValues: {
                            ':d1': distances.emb1 ?? null,
                            ':d2': distances.emb2 ?? null,
                            ':d3': distances.emb3 ?? null,
                            ':d4': distances.emb4 ?? null,
                            ':d5': distances.emb5 ?? null,
                            ':path': `/${domain}/${subdomain}`
                        },
                        ReturnValues: 'UPDATED_NEW'
                    };

                    const updateResult = await dynamodb.update(updateParams).promise();
                    console.log('Updated subdomains record:', updateResult);
                } catch (err) {
                    console.error('Failed to update subdomains table:', err);
                    // decide whether to treat this as fatal or continue
                    return res.status(502).json({ error: 'failed to save distances' });
                }

                // 5️⃣  finally send back what PositionModule expects

                mainObj = {
                    position: distances,
                    domain,
                    subdomain,
                    entity,
                    id: item.id ?? null
                }
                console.log("mainObj", mainObj)

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
                // ──────────────────────────────────────────────────────────────
                //  search  route  – uses the GSI  path‑index  (path / dist1)
                // ──────────────────────────────────────────────────────────────
                console.log('search//////');
                const { domain, subdomain, query = '', entity = null, embedding } = reqBody.body || {};

                if (!embedding || !domain || !subdomain || !entity) {
                    return res.status(400).json({ error: 'embedding, domain & subdomain required' });
                }

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



                const DIST_LIMIT = 0.20;
const fullPath   = `/${domain}/${subdomain}`;

// we already computed  distances.emb1  above
const dist1 = distances.emb1;
if (typeof dist1 !== 'number') {
  return res.status(500).json({ error: 'dist1 missing from first pass' });
}

const dist1Lower = Math.max(0,  dist1 - DIST_LIMIT);   // clamp to 0–1 if desired
const dist1Upper = Math.min(1,  dist1 + DIST_LIMIT);

let matches = [];
try {
    const params = {
        TableName : 'subdomains',
        IndexName : 'path-index',                // PK = path (S),  SK = dist1 (N)
        ExpressionAttributeNames: {
          '#p'  : 'path',
          '#d1' : 'dist1'
        },
        ExpressionAttributeValues: {
          ':path': fullPath,
          ':lo'  : dist1Lower,
          ':hi'  : dist1Upper
        },
        KeyConditionExpression:
          '#p = :path AND #d1 BETWEEN :lo AND :hi'
      };

  console.log("params",params)

  let last;
  do {
    const data = await dynamodb.query({ ...params, ExclusiveStartKey: last }).promise();

    console.log('[query] raw count:', data.Count);              // ★  How many survived KeyCondition?
    if (data.Items.length && !matches.length) {
      console.log('[query] first item (raw):', JSON.stringify(data.Items[0], null, 2));
    }
    
    matches.push(...data.Items);
    last = data.LastEvaluatedKey;
    last = data.LastEvaluatedKey;
  } while (last);

} catch (err) {
  console.error('search → DynamoDB failed:', err);
  return res.status(502).json({ error: 'db‑unavailable' });
}

/*  respond to the front‑end  */
const mainObj = { query, domain, subdomain, entity, matches };
console.log('mainObj', mainObj);
            }

            else if (action == "addIndex") {

            } else if (action == "shorthand") {
                actionFile = reqPath.split("/")[3];
                //this needs to be updated so that the entire var is the shorthand.
                let { shorthand } = require('../routes/shorthand');
                const arrayLogic = reqBody.body;
                let jsonpl = await retrieveAndParseJSON(actionFile, true);
                let shorthandLogic = JSON.parse(JSON.stringify(jsonpl))
                shorthandLogic.input.push(arrayLogic[0]);
                let newShorthand = await shorthand(shorthandLogic, req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, true, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken);
                //newJPL["shorthand"] = shorthandLogic
                const params = {
                    Bucket: "public.1var.com",
                    Key: actionFile,
                    Body: JSON.stringify(newShorthand),
                    ContentType: "application/json"
                };
                await s3.putObject(params).promise();
                mainObj = await convertToJSON(actionFile, [], null, null, cookie, dynamodb, uuidv4, null, [], {}, "", dynamodbLL, reqBody);
            } else if (action == "runEntity") {
                console.log("9999", "runEntity")
                let { runApp } = require('../app');
                console.log("res-------")
                console.log("res-------")
                console.log("res-------")
                console.log("res-------")
                console.log("res-------")
                //asking for it to runEntity might require manual adjustments to req.path so that it will run the entity AI chooses not the original request of shorthand.
                await runApp(req, res, next)
            }

            /* else if (action == "transcribe"){
                mainObj["presign"] = await getPresignedUrl();
            } */

            mainObj["file"] = actionFile + ""
            response = mainObj

            if (action === "file") {
                //console.log("file2")
                const expires = 90000;
                const url = "https://" + fileLocation(isPublic) + ".1var.com/" + actionFile;
                const policy = JSON.stringify({ Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': Math.floor((Date.now() + expires) / 1000) } } }] });
                if (reqType === 'url') {
                    const signedUrl = signer.getSignedUrl({
                        url: url,
                        policy: policy
                    });
                    console.log("sendBack:x", { signedUrl: signedUrl });
                    return sendBack(res, "json", { signedUrl: signedUrl }, isShorthand);
                } else {
                    const cookies = signer.getSignedCookie({ policy: policy });
                    for (const cookieName in cookies) {
                        res.cookie(cookieName, cookies[cookieName], { maxAge: expires, httpOnly: true, domain: '.1var.com', secure: true, sameSite: 'None' });
                    }
                    console.log("response", response)
                    console.log("sendBack:0", response);
                    return sendBack(res, "json", { "ok": true, "response": response }, isShorthand);
                }
            } else if (action === "reqPut") {
                const bucketName = fileLocation(isPublic) + '.1var.com';
                const fileName = actionFile;
                const expires = 90000;

                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Expires: expires,
                    ContentType: fileCategory + '/' + fileType
                };
                //console.log("params", params)
                s3.getSignedUrl('putObject', params, (error, url) => {
                    if (error) {
                        if (reqHeaderSent == false) {
                            //res.status(500).json({ error: 'Error generating presigned URL' });
                            console.log("sendBack:1", {});
                            return sendBack(res, "json", { "ok": false, "response": {} }, isShorthand);
                        }
                    } else {
                        //console.log("preSigned URL:", url)
                        response.putURL = url
                        if (reqHeaderSent == false) {
                            console.log("sendBack:2", response);
                            return sendBack(res, "json", { "ok": true, "response": response }, isShorthand);
                        }
                    }
                });
            } else {
                console.log("returning", { "ok": true, "response": response })
                console.log("res", res)
                if (response.file != "") {
                    // conditioned because the page can't send headers after they are already sent.
                    console.log("sendBack:3", response);
                    return sendBack(res, "json", { "ok": true, "response": response }, isShorthand);
                } else {
                    console.log("sendBack:3.0 =>", response)
                    console.log("sendBack:3.1 response =>", "-" + JSON.stringify(response) + "-");
                    console.log("sendBack:3.1 isShorthand =>", isShorthand);
                    if (!response.hasOwnProperty("status")) {
                        return sendBack(res, "json", { "ok": true, "response": response }, isShorthand);
                    }
                }
            }

        } else {
            console.log("sendBack:4"), {};
            return sendBack(res, "json", {}, isShorthand);
        }
    } else {
        console.log("sendBack:5", {});
        return sendBack(res, "json", {}, isShorthand);
    }
}

function sendBack(res, type, val, isShorthand) {
    //Create the ability to detect if it is shorthand
    //check if it is shorthand and send back to shorthand.
    //if not shorthand then do the following;
    console.log("isShorthand========>", isShorthand)
    if (!isShorthand) {
        res.json(val)
    } else {
        return val //returning the value back to the shorthand request
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
