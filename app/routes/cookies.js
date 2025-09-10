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
    // pull linked children from the links table (was entity.Items[0].l)
    const linked = await getLinkedChildren(entity.Items[0].e, dynamodb);
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
        const linkedPromises = linked.map(async (childE) => {
            const subByE = await getSub(childE, "e", dynamodb);
            const uuid = subByE.Items[0].su;
            return await convertToJSON(
                uuid,
                newParentPath,
                false,
                null,
                cookie,
                dynamodb,
                uuidv4,
                pathUUID,
                newParentPath2,
                id2Path,
                usingID,
                dynamodbLL,
                body,
                substitutingID
            );
        });
        const linkedResponses = await Promise.all(linkedPromises);
        for (const lr of linkedResponses) {
            Object.assign(obj[fileID].linked, lr.obj);
            Object.assign(paths, lr.paths);
            Object.assign(paths2, lr.paths2);
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

//new link helpers

/* ───────────────────────────── links table helpers ───────────────────────────── */

function makeLinkId(wholeE, partE) {
    return `lnk#${wholeE}#${partE}`;            // stable id → mirrors linksById style
}

function makeCKey(wholeE, partE) {
    return `${wholeE}|${partE}`;                // collision-free composite key
}

/** Idempotent: creates a link wholeE → partE if it doesn't already exist */
async function putLink(wholeE, partE, dynamodb) {
    const id = makeLinkId(wholeE, partE);
    const ckey = makeCKey(wholeE, partE);
    try {
        await dynamodb.put({
            TableName: "links",
            Item: {
                id, whole: wholeE, part: partE,
                ckey, type: "link", ts: Date.now()
            },
            ConditionExpression: "attribute_not_exists(id)"
        }).promise();
    } catch (err) {
        if (err.code !== "ConditionalCheckFailedException") throw err; // already exists
    }
    return { id, ckey };
}

/** Idempotent delete by pair */
async function deleteLink(wholeE, partE, dynamodb) {
    const ckey = makeCKey(wholeE, partE);
    const q = await dynamodb.query({
        TableName: "links",
        IndexName: "ckeyIndex",
        KeyConditionExpression: "ckey = :ck",
        ExpressionAttributeValues: { ":ck": ckey },
        Limit: 1
    }).promise();
    if (!q.Items || !q.Items.length) return false;
    await dynamodb.delete({
        TableName: "links",
        Key: { id: q.Items[0].id }
    }).promise();
    return true;
}

/** children of E (was: entity.Items[0].l) */
async function getLinkedChildren(e, dynamodb) {
    const res = await dynamodb.query({
        TableName: "links",
        IndexName: "wholeIndex",
        KeyConditionExpression: "whole = :e",
        ExpressionAttributeValues: { ":e": e }
    }).promise();
    return (res.Items || []).map(it => it.part);
}

/** parents of E (was: entity.Items[0].o) */
async function getLinkedParents(e, dynamodb) {
    const res = await dynamodb.query({
        TableName: "links",
        IndexName: "partIndex",
        KeyConditionExpression: "part = :e",
        ExpressionAttributeValues: { ":e": e }
    }).promise();
    return (res.Items || []).map(it => it.whole);
}

/** one-time migration: copy .l/.o from entities → links (idempotent) */
async function migrateLinksFromEntities(dynamodb) {
    let created = 0, scanned = 0, last;
    do {
        const batch = await dynamodb.scan({
            TableName: "entities",
            ProjectionExpression: "e, #l, #o",
            ExpressionAttributeNames: { "#l": "l", "#o": "o" },
            ExclusiveStartKey: last
        }).promise();
        for (const item of (batch.Items || [])) {
            scanned++;
            const eThis = item.e;
            if (Array.isArray(item.l)) {
                for (const childE of item.l) {
                    await putLink(eThis, childE, dynamodb);
                    created++;
                }
            }
            if (Array.isArray(item.o)) {
                for (const parentE of item.o) {
                    await putLink(parentE, eThis, dynamodb);
                    created++;
                }
            }
        }
        last = batch.LastEvaluatedKey;
    } while (last);
    return { scanned, created };
}


//end new link helpers


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
// OLD linkEntities(...) → REPLACE ENTIRE FUNCTION
async function linkEntities(childSU, parentSU, dynamodb) {
    const childSub = await getSub(childSU, "su", dynamodb);
    const parentSub = await getSub(parentSU, "su", dynamodb);
    if (!childSub.Items.length || !parentSub.Items.length) return "not-found";

    const childE = childSub.Items[0].e;
    const parentE = parentSub.Items[0].e;

    // write to links table (no more .l/.o on entities)
    await putLink(parentE, childE, dynamodb);
    return "success";
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
    verifyThis,

    // NEW:
    getLinkedChildren,
    getLinkedParents,
    putLink,
    deleteLink
}
