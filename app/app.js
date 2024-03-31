process.env.PATH = process.env.PATH + ":/opt/gm/bin:/opt/gm/lib:/opt/gs/bin:/opt/gs/lib";

var express = require('express');
const serverless = require('serverless-http');
const AWS = require('aws-sdk');
const app = express();
const cookieParser = require('cookie-parser');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const util = require('util');
const child_process = require('child_process')
const exec = util.promisify(child_process.exec);
const axios = require('axios');
const { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand} = require("@aws-sdk/client-scheduler");
const moment = require('moment-timezone')
const math = require('mathjs');

const OpenAI = require("openai");
const openai = new OpenAI();

const Anthropic = require('@anthropic-ai/sdk');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true, cookie: { secure: true }}));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(cookieParser()); 
AWS.config.update({ region: 'us-east-1' });
dynamodbLL = new AWS.DynamoDB();
dynamodb = new AWS.DynamoDB.DocumentClient();
SM = new AWS.SecretsManager();
s3 = new AWS.S3();
ses = new AWS.SES();

var cookiesRouter;
var controllerRouter = require('./routes/controller')(dynamodb, dynamodbLL, uuidv4);
var indexRouter = require('./routes/index');
const embeddingsRouter = require('./routes/embeddings');
const pineconeRouter = require('./routes/pinecone');


console.log("")
app.use('/embeddings', embeddingsRouter);
app.use('/pinecone', pineconeRouter);
app.use('/controller', controllerRouter);

app.use('/', indexRouter);

app.use(async (req, res, next) => {
    
    if (!cookiesRouter) {
        try {
            const privateKey = await getPrivateKey();
            let {setupRouter, getSub} = require('./routes/cookies')
            cookiesRouter = setupRouter(privateKey, dynamodb, dynamodbLL, uuidv4, s3, ses, openai, Anthropic);
            app.use('/:type(cookies|url)*', function(req, res, next) {
                req.type = req.params.type;
                next('route');
            }, cookiesRouter);
            next();
        } catch (error) {
            console.error("Failed to retrieve private key:", error);
            res.status(500).send("Server Error");
        }
    } else {
        next();
    }
});

function isSubset(jsonA, jsonB) {
    // Check if both inputs are objects
    if (typeof jsonA !== 'object' || typeof jsonB !== 'object') {
        return false;
    }

    // Iterate over all keys in jsonA
    for (let key in jsonA) {
        if (jsonA.hasOwnProperty(key)) {
            // Check if the key exists in jsonB
            if (!jsonB.hasOwnProperty(key)) {
                return false;
            }

            // If the value is an object, recurse
            if (typeof jsonA[key] === 'object' && typeof jsonB[key] === 'object') {
                if (!isSubset(jsonA[key], jsonB[key])) {
                    return false;
                }
            } else {
                // Check if the values are equal
                if (jsonA[key] !== jsonB[key]) {
                    return false;
                }
            }
        }
    }

    // All checks passed, return true
    return true;
}

async function isValid(req, res, data) {
    let {setupRouter, getHead, convertToJSON, manageCookie, getSub, createVerified, incrementCounterAndGetNewValue} = await require('./routes/cookies')
    console.log("req.path::",req.path)
    let sub = await getSub(req.path.replace("/auth/","").replace("/blocks/",""), "su", dynamodb)
    console.log("sub",sub)
    let params = { TableName: 'access',IndexName: 'eIndex',KeyConditionExpression: 'e = :e',ExpressionAttributeValues: {':e': sub.Items[0].e.toString()} }
    console.log("params", params)
    let accessItem = await dynamodb.query(params).promise()
    console.log("accessItem", accessItem)
    let isDataPresent = false
    if (accessItem.Items.length > 0){
        console.log("accessItem.Items[0].va",accessItem.Items[0].va)
        isDataPresent = isSubset(accessItem.Items[0].va, data)
    }
    console.log("isDataPresent", isDataPresent)
    if (isDataPresent){
        let cookie =  await manageCookie({}, req, res, dynamodb, uuidv4)
        const vi = await incrementCounterAndGetNewValue('viCounter', dynamodb);
        const ttlDurationInSeconds = 90000; // take the data from access.ex and calculate duration in seconds
        const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
        await createVerified(vi.toString(), cookie.gi.toString(), "0", sub.Items[0].e.toString(), accessItem.Items[0].ai, "0", ex, true, 0, 0)
    }
    console.log("validating data", data)
    return data
}

app.all("/0001", async (req, res, next) => {
 
});

app.all("/2356", async (req, res, next) => {
   
});

app.all("/eb1", async (req, res, next) => {    

    var hour = moment.utc().format('HH');
    var minute = moment.utc().format('mm');
    console.log("hour", hour, "minute", minute)
    const hourFormatted = hour.toString().padStart(2, '0');
    const minuteFormatted = minute.toString().padStart(2, '0');
    var todayDow = moment.utc().format('dd').toLowerCase();
    var currentDateInSeconds = moment.utc().unix()
    var timeInDay = hourFormatted + minuteFormatted
    console.log("gsiName", gsiName, "timeInDay",timeInDay, "todayDow", todayDow, "currentDateInSeconds", currentDateInSeconds)
    const gsiName = `${todayDow}Index`;
    const queryParams = {
        TableName: 'YourTableName',
        IndexName: gsiName,
        KeyConditionExpression: `#${todayDow} = :dowVal and sd > :currentDate`,
        ExpressionAttributeNames: {
          [`#${todayDow}`]: todayDow, 
        },
        ExpressionAttributeValues: {
          ':dowVal': 1,
          ':currentDate': currentDateInSeconds,
        },
      };

    res.json({"gsiName":gsiName, "timeInDay":timeInDay, "todayDow":todayDow, "currentDateInSeconds": currentDateInSeconds, "queryParams":queryParams})


    // This adds the records into the enabled table
    /*
    const tableName = 'enabled';

    for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute++) {
        const time = `${hour.toString().padStart(2, '0')}${minute.toString().padStart(2, '0')}`;
        const item = {
        TableName: tableName,
        Item: {
            "time": time,
            "enabled": 0,
            "en": 0
        }
        };

        // Insert the item into DynamoDB
        try {
        await dynamodb.put(item).promise();
        console.log(`Inserted item with time: ${time}`);
        
        } catch (err) {
        console.error(`Error inserting item with time: ${time}`, err);
        }
    }
    }
    */

    /*
    // Today's date
    const today = moment();
    // Tomorrow's date
    const tomorrow = moment().add(1, 'days');
    // Day of Week for tomorrow, formatted as needed (e.g., "Tu" for Tuesday)
    const dow = tomorrow.format('dd').toLowerCase();
    // The GSI name for querying
    const gsiName = `${dow}Index`;
    
    // Unix timestamp for the end of tomorrow (to filter records up to the end of tomorrow)
    const endOfTomorrowUnix = tomorrow.endOf('day').unix();

    const params = {
        TableName: "schedules",
        IndexName: gsiName,
        KeyConditionExpression: "#dow = :dowValue AND #sd < :endOfTomorrow",
        ExpressionAttributeNames: {
          "#dow": dow, // Adjust if your GSI partition key is differently named
          "#sd": "sd"
        },
        ExpressionAttributeValues: {
          ":dowValue": 1, // Assuming '1' represents 'true' for tasks to be fetched
          ":endOfTomorrow": endOfTomorrowUnix
        }
      };
      

    console.log("params", params)
    
    try {
        const config = { region: "us-east-1" };
        const client = new SchedulerClient(config);
        const data = await dynamodb.query(params).promise();
        console.log("Query succeeded:", data.Items);

        for (item in data.Items){
            let stUnix = data.Items[item].sd + data.Items[item].st
            var momentObj = moment(stUnix * 1000);
            var hour = momentObj.format('HH');
            var minute = momentObj.format('mm');
            console.log("hour", hour, "minute", minute)
            const hourFormatted = hour.toString().padStart(2, '0');
            const minuteFormatted = minute.toString().padStart(2, '0');
            
            const scheduleName = `${hourFormatted}${minuteFormatted}`;
            
            const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;

            const input = {
                Name: scheduleName,
                GroupName: "runLambda",
                ScheduleExpression: scheduleExpression,
                ScheduleExpressionTimezone: "UTC",
                StartDate: new Date("2024-02-06T00:01:00Z"),
                EndDate: new Date("2025-02-06T00:01:00Z"),
                State: "ENABLED",
                Target: {
                    Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp", 
                    RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
                    Input: JSON.stringify({"disable":true}),
                },
                FlexibleTimeWindow: { Mode: "OFF" },
            };

            const command = new UpdateScheduleCommand(input);
            
            const createSchedule = async () => {
                try {
                    const response = await client.send(command);
                    console.log("Schedule created successfully:", response.ScheduleArn);
                } catch (error) {
                    console.error("Error creating schedule:", error);
                }
            };
            
            await createSchedule();

        }

        res.json(data.Items)
        //return { statusCode: 200, body: JSON.stringify(data.Items) };
    } catch (err) {
        console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
        //return { statusCode: 500, body: JSON.stringify(err) };
    }
*/

// This replaces a schedule with the new details provided
/*
    const config = { region: "us-east-1" };
    
    const client = new SchedulerClient(config);
    let hour = "00"
    let minute = "01"
    const hourFormatted = hour.toString().padStart(2, '0');
    const minuteFormatted = minute.toString().padStart(2, '0');
    
    // Construct the schedule name based on the time
    const scheduleName = `${hourFormatted}${minuteFormatted}`;
    
    // Update the cron expression for the specific time
    const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;

    const input = {
        Name: "disable",
        GroupName: "runLambda",
        ScheduleExpression: scheduleExpression,
        ScheduleExpressionTimezone: "UTC",
        StartDate: new Date("2024-02-06T00:01:00Z"),
        EndDate: new Date("2025-02-06T00:01:00Z"),
        State: "ENABLED",
        Target: {
            Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp", 
            RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
            Input: JSON.stringify({"disable":true}),
        },
        FlexibleTimeWindow: { Mode: "OFF" },
    };

    const command = new CreateScheduleCommand(input);
    
    const createSchedule = async () => {
        try {
            const response = await client.send(command);
            console.log("Schedule created successfully:", response.ScheduleArn);
        } catch (error) {
            console.error("Error creating schedule:", error);
        }
    };
    
    await createSchedule();
*/

// THIS SETS UP Schedule for every minue of the day
/*
    const config = { region: "us-east-1" };
    const client = new SchedulerClient(config);

    const createSchedule = async () => {
        for (let hour = 23; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 1) {
                // Format the hour and minute to ensure two digits
                const hourFormatted = hour.toString().padStart(2, '0');
                const minuteFormatted = minute.toString().padStart(2, '0');
                
                // Construct the schedule name based on the time
                const scheduleName = `${hourFormatted}${minuteFormatted}`;
                
                // Update the cron expression for the specific time
                const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;

                // Create the input object with the updated values
                const input = {
                    Name: scheduleName,
                    GroupName: "runLambda",
                    ScheduleExpression: scheduleExpression,
                    ScheduleExpressionTimezone: "UTC",
                    StartDate: new Date("2024-02-05T00:00:00Z"),
                    EndDate: new Date("2025-02-05T00:00:00Z"),
                    State: "DISABLED",
                    Target: {
                        Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp", 
                        RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
                        Input: JSON.stringify({"automate":true}),
                    },
                    FlexibleTimeWindow: { Mode: "OFF" },
                };

                const command = new CreateScheduleCommand(input);
                
                try {
                    const response = await client.send(command);
                    console.log(`Schedule ${scheduleName} created successfully:`, response.ScheduleArn);
                } catch (error) {
                    console.error(`Error creating schedule ${scheduleName}:`, error);
                }
            }
        }
    };

    await createSchedule().then(() => console.log("Schedules creation process completed."));

    */
    //res.send("success")
})

app.all('/blocks/*', 
    async (req, res, next) => {
        console.log("auth", req)
        console.log("req.body", req.body)
        console.log("req.headers", req.headers)
        req.lib = {}
        req.lib.modules = {};
        req.lib.middlewareCache = []
        req.lib.isMiddlewareInitialized = false;
        req.lib.whileLimit = 10;
        req.lib.root = {}
        req.lib.root.context = {}
        req.lib.root.context.session = session
        res.originalJson = res.json;


        res.json = async function(data) {
            if (await isValid(req, res, data)) {
                res.originalJson.call(this, data);
            } else {
                res.originalJson.call(this, {});
            }
        };
        next();
    },
    async (req, res, next) => {
        req.blocks = true;
         let blocksData = await initializeMiddleware(req, res, next);
         console.log("blocksData", blocksData)
          res.json({"data":blocksData});
    }
);

app.all('/auth/*', 
    async (req, res, next) => {
        console.log("auth", req)
        console.log("req.body", req.body)
        console.log("req.headers", req.headers)
        req.lib = {}
        req.lib.modules = {};
        req.lib.middlewareCache = []
        req.lib.isMiddlewareInitialized = false;
        req.lib.whileLimit = 10;
        req.lib.root = {}
        req.lib.root.context = {}
        req.lib.root.context.session = session
        res.originalJson = res.json;


        res.json = async function(data) {
            if (await isValid(req, res, data)) {
                res.originalJson.call(this, data);
            } else {
                res.originalJson.call(this, {});
            }
        };
        next();
    },
    async (req, res, next) => {
        if (!req.lib.isMiddlewareInitialized && req.path.startsWith('/auth')) {
            req.blocks = false;
            req.lib.middlewareCache = await initializeMiddleware(req, res, next);
            req.lib.isMiddlewareInitialized = true;
        }
        console.log("req.lib.middlewareCache", req.lib.middlewareCache)
        console.log("req.lib.middlewareCache.length", req.lib.middlewareCache.length)
        if (req.lib.middlewareCache.length == 0){
            res.send("no access")
        } else {
            next();
        }
    },
    async (req, res, next) => {
        if (req.lib.middlewareCache.length > 0) {
            const runMiddleware = async (index) => {
                if (index < req.lib.middlewareCache.length) {
                    await req.lib.middlewareCache[index] (req, res, async () => await runMiddleware(index + 1));
                } else {
                    //next();
                }
            };
            await runMiddleware(0);
        } else {
            //next();
        }
    }
);

async function getPrivateKey() {
    const secretName = "public/1var/s3";
    try {
        const data = await SM.getSecretValue({ SecretId: secretName }).promise();
        const secret = JSON.parse(data.SecretString);
        let pKey = JSON.stringify(secret.privateKey).replace(/###/g, "\n").replace('"','').replace('"','');
        return pKey
    } catch (error) {
        console.error("Error fetching secret:", error);
        throw error;
    }
}

async function retrieveAndParseJSON(fileName, isPublic, getSub, getWord) {



    let fileLocation = "private"
    if (isPublic == "true" || isPublic == true){
        fileLocation = "public"
    }
    const params = { Bucket: fileLocation +'.1var.com', Key: fileName};
    const data = await s3.getObject(params).promise();
    console.log("data63", data)
    if (data.ContentType == "application/json"){
        let s3JSON = await JSON.parse(data.Body.toString());

        const promises = await s3JSON.blocks.map(async (obj, index) => {    
            console.log("999obj", obj)
            let subRes = await getSub(obj.entity, "su", dynamodb) 
            console.log("999subRes", subRes)
            let name = await getWord(subRes.Items[0].a, dynamodb)
                console.log("999name", name)
            s3JSON.name = name.Items[0].r
            s3JSON.entity = obj.entity
            let loc = subRes.Items[0].z
            console.log("999loc", loc)
            let fileLoc = "private"
            if (isPublic == "true" || isPublic == true){
                fileLoc = "public"
            }
            console.log("999fileLoc",fileLoc)
            s3JSON.blocks[index].privacy = fileLoc
            console.log("s3JSON", s3JSON)
            return s3JSON
        })
        let results22 = await Promise.all(promises);
        if (results22.length > 0){
            return results22[0];
        } else {
            console.log("data.body.toString",data.Body.toString())
            let s3JSON2 = await JSON.parse(data.Body.toString());
            let subRes = await getSub(fileName, "su", dynamodb) 
                console.log("999subRes", subRes)
                let name = await getWord(subRes.Items[0].a, dynamodb)
                console.log("999name", name)
                s3JSON2.name = name.Items[0].r
                s3JSON2.entity = fileName
            console.log("s3JSON",s3JSON2)
            return s3JSON2
        }
    } else {
        let subRes = await getSub(fileName, "su", dynamodb) 
        console.log("999subRes", subRes)
        let name = getWord(subRes.Items[0].a, dynamodb)
        return {"blocks":[],"modules":{},"actions":[{
            "target": "{|res|}",
            "chain": [
                {
                    "access": "send",
                    "params": [
                        fileName
                    ]
                }
            ]
        }],
        "name":name.Items[0].s
        }
    }
}

async function processConfig(config, initialContext, lib) {
    const context = { ...initialContext };
    if (config.modules){
        for (const [key, value] of Object.entries(config.modules, context)) {
            let newPath = await installModule(value, key, context, lib);
        }
    }
    return context;
}

async function installModule(moduleName, contextKey, context, lib) {
    const npmConfigArgs = Object.entries({cache: '/tmp/.npm-cache',prefix: '/tmp',}).map(([key, value]) => `--${key}=${value}`).join(' ');
    await exec(`npm install ${moduleName} --save ${npmConfigArgs}`); 
    lib.modules[moduleName] = moduleName
    if (!context.hasOwnProperty(contextKey)){
        context[contextKey] = {"value":{}, "context":{}}
    }
    context[contextKey].value = await require("/tmp/node_modules/"+moduleName);
    return "/tmp/node_modules/"+moduleName
}

function getPageType(urlPath){
    if (urlPath.toLowerCase().includes("sc")){
        return "sc"
    } else if (urlPath.toLowerCase().includes("mc")){
        return "mc"
    } else if (urlPath.toLowerCase().includes("sa")){
        return "sa"
    } else if (urlPath.toLowerCase().includes("ma")){
        return "ma"
    } else if (urlPath.toLowerCase().includes("blank")){
        return "blank"
    } else {
        return "1var"
    }
}

async function initializeMiddleware(req, res, next) {
    console.log("req", req)

    

    if (req.path.startsWith('/auth') || req.path.startsWith('/blocks')) {
        let {setupRouter, getHead, convertToJSON, manageCookie, getSub, getWord} = await require('./routes/cookies')
        console.log("req", req)
        console.log("req.body", req.body)
        let originalHost = req.body.headers["X-Original-Host"];
        console.log("originalHost",originalHost)
        let splitOriginalHost = originalHost.split("1var.com")[1]
        console.log("splitOriginalHost",splitOriginalHost)
        const reqPath = splitOriginalHost.split("?")[0]
        console.log("reqPath",reqPath)
        req.path = reqPath
        const head = await getHead("su", reqPath.split("/")[1], dynamodb)
        let isPublic = head.Items[0].z
        let cookie =  await manageCookie({}, req, res, dynamodb, uuidv4)
        console.log("#1cookie", cookie)
        const parent = await convertToJSON(head.Items[0].su, [], null, null, cookie, dynamodb, uuidv4)
        console.log("#1parent", parent)
        let fileArray = parent.paths[reqPath.split("/")[1]];
        console.log("fileArray", fileArray);


        if (fileArray != undefined){           
            const promises = await fileArray.map(async fileName => await retrieveAndParseJSON(fileName, isPublic, getSub, getWord));
            const results = await Promise.all(promises);
            console.log("RESULTS87",results)
            console.log("req.blocks",req.blocks)
            if (req.blocks){
                return results
            } else {
                const arrayOfJSON = [];

                console.log("results",results)
                results.forEach(result => arrayOfJSON.push(result));
                console.log("arrayOfJSON", arrayOfJSON)
                let resultArrayOfJSON = arrayOfJSON.map(async userJSON => {
                    return async (req, res, next) => {
                        req.lib.root.context.body = {"value":req.body.body, "context":{}}
                        console.log("userJSON",userJSON)
                        req.lib.root.context = await processConfig(userJSON, req.lib.root.context, req.lib);
                        req.lib.root.context["urlpath"] = {"value":reqPath, "context":{}}
                        req.lib.root.context["entity"] = {"value":fileArray[fileArray.length - 1], "context":{}};
                        req.lib.root.context["pageType"] = {"value":getPageType(reqPath), "context":{}};
                        req.lib.root.context["sessionID"] = {"value":req.sessionID, "context":{}}
                        req.lib.root.context.req = {"value":req, "context":{}}
                        req.lib.root.context.res = {"value":res, "context":{}}
                        req.lib.root.context.math = {"value":math, "context":{}}
                        req.lib.root.context.axios = {"value":axios, "context":{}}
                        req.lib.root.context.fs = {"value":fs, "context":{}}
                        req.lib.root.context.JSON = {"value":JSON, "context":{}}
                        req.lib.root.context.Buffer = {"value":Buffer, "context":{}}
                        req.lib.root.context.path = {"value":reqPath, "context":{}}
                        req.lib.root.context.console = {"value":console, "context":{}}
                        req.lib.root.context.util = {"value":util, "context":{}}
                        req.lib.root.context.child_process = {"value":child_process, "context":{}}
                        req.lib.root.context.moment = {"value":moment, "context":{}}
                        req.lib.root.context.s3 = {"value":s3, "context":{}}
                        await initializeModules(req.lib, userJSON, req, res, next);
                        console.log("req.lib.root.context",req.lib.root.context)
                    };
                });
                return await Promise.all(resultArrayOfJSON)
            }
        } else {
            console.log("ELSE87")
            return []
        }
    }
}

async function initializeModules(libs, config, req, res, next) {
    await require('module').Module._initPaths();
    for (const action of config.actions) {
        let runResponse = await runAction(action, libs, "root", req, res, next);
        if (runResponse == "contune"){
            continue
        }
    }
}

async function getNestedContext(libs, nestedPath, key = "") {
    ////////console.log("getNestedContext")
    ////////console.log("libs", libs)
    ////////console.log("nestedPath", nestedPath)
    ////////console.log("key", key)
    if (key.startsWith("~/")){
        nestedPath = key.replace("~/","root.").split(".")
        ////////console.log("333: nestedPath", nestedPath)
        nestedPath = nestedPath.slice(0, -1).join('.')
    }

    let arrowJson  = nestedPath.split("=>")
    if (nestedPath.includes("=>")){
        nestedPath = arrowJson[0]
    }
    ////////console.log("444: nestedPath", nestedPath)
    const parts = nestedPath.split('.');
    
    ////////console.log("parts", parts)
    if (nestedPath && nestedPath != ""){
        let tempContext = libs;
        let partCounter = 0
        for (let part of parts) {
            ////////console.log("part", part)
            ////////console.log("parts[part]", parts[part])
                tempContext = tempContext[part].context;
        }
        /*if (arrowJson.length > 1){
            const pathParts = arrowJson[1].split('.');
            for (const part of pathParts) {
                if (currentValue.hasOwnProperty(part)) {
                    tempContext = tempContext[part];
                } else {
                    console.error(`Path ${arrowJson[1]} not found in JSON.`);
                    tempContext = ''; // Path not found
                    break;
                }
            }
        }*/
        return tempContext;
    }
    return libs
}

async function getNestedValue(libs, nestedPath) {
    ////////console.log("getNestedValue")
    ////////console.log("libs", libs)
    ////////console.log("nestedPath", nestedPath)
    const parts = nestedPath.split('.');
    ////////console.log("parts",parts)
    if (nestedPath && nestedPath != ""){
        let tempContext = libs;
        let partCounter = 0
        ////////console.log("parts",parts)
        for (let part of parts) {

            if (partCounter < parts.length-1 || partCounter == 0){
                ////////console.log("part context",part)
                tempContext = tempContext[part].context;
            } else {
                ////////console.log("part value",part)
                tempContext = tempContext[part].value;
            }
        }
        return tempContext;
    }
    return libs
}

async function condition(left, conditions, right, operator = "&&", libs, nestedPath) {
    //need an updated condition for if left is the only argument then return it's value (bool or truthy)

    if (!Array.isArray(conditions)) {
        conditions = [{ condition: conditions, right: right }];
    }

    return await conditions.reduce(async (result, cond) => {
        const currentResult = await checkCondition(left, cond.condition, cond.right, libs, nestedPath);
        if (operator === "&&") {
            return result && currentResult;
        } else if (operator === "||") {
            return result || currentResult;
        } else {
            //console.log("Invalid operator");
        }
    }, operator === "&&");
}

async function checkCondition(left, condition, right, libs, nestedPath) {
    left = await replacePlaceholders(left, libs, nestedPath)
    right = await replacePlaceholders(right, libs, nestedPath)
    switch (condition) {
        case '==': return left == right;
        case '===': return left === right;
        case '!=': return left != right;
        case '!==': return left !== right;
        case '>': return left > right;
        case '>=': return left >= right;
        case '<': return left < right;
        case '<=': return left <= right;
        case 'startsWith': return typeof left === 'string' && left.startsWith(right);
        case 'endsWith': return typeof left === 'string' && left.endsWith(right);
        case 'includes': return typeof left === 'string' && left.includes(right);
        case 'isDivisibleBy': return typeof left === 'number' && typeof right === 'number' && right !== 0 && left % right === 0;
        default:
            if (!condition && !right) {
                return !!left;
            }
            throw new Error("Invalid condition type");
    }
}

async function replacePlaceholders(item, libs, nestedPath) {
    let processedItem = item;
    let processedItem2 = item+"";
    if (typeof processedItem === 'string') {
        let stringResponse = await processString(processedItem, libs, nestedPath);
        return stringResponse;
    } else if (Array.isArray(processedItem)) {
        let newProcessedItem2 = processedItem.map(async element => {
            ////////console.log("element", element)
            let repHolder = await replacePlaceholders(element, libs, nestedPath)
            ////////console.log("repHolder", repHolder)
            return repHolder
        });
        return await Promise.all(newProcessedItem2);
    } else {
        return item
    }
    
}
async function isOnePlaceholder(str) {
    if (str.startsWith("{|") && (str.endsWith("|}") || str.endsWith("|}!")) && !str.includes("=>") && !str.includes("[") && !str.includes("{|=")) {
        return str.indexOf("{|", 2) === -1;
    }
    return false;
}

async function removeBrackets(str, isObj, isExecuted){
    return isObj ? str.slice(2, isExecuted ? -3 : -2) : str
}

async function getKeyAndPath(str, nestedPath){
    let val = str.split(".");

    let key = str;
    let path = "";
    if (str.startsWith("~/")){
        val[0] = val[0].replace("~/", "")
        val.unshift("root")
    }
    if (val.length > 1){
        key = val[val.length-1]
        path = val.slice(0, -1)
        path = path.join(".")
    }
    if (nestedPath != "" && !str.startsWith("~/")){
        path = nestedPath + "." + path
    } else {
        path = path
    }
    if (path.endsWith(".")){
        path = path.slice(0,-1)
    } 
    return {"key":key, "path":path}
}

function getValueFromPath(obj, path) {
    return path.split('.').reduce((current, key) => {
        // Traverse using 'context' key and then get the 'value'
        return current && current && current[key] ? current[key] : null;
    }, obj);
}

function isNumber(value) {
    return typeof value === 'number' && !isNaN(value);
  }

function isArray(string) {
    if (string.startsWith("[")) {
      try {
        const parsed = JSON.parse(string);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        } else {
          return false
        }
      } catch (error) {
        return false
      }
    } else {
      return false
    }
  }

  function isMathEquation(expression) {
    try {
        math.parse(expression);
        return true; // No error means it's likely a valid math equation
    } catch {
        return false; // An error indicates it's not a valid math equation
    }
}

function evaluateMathExpression(expression) {
    try {
        // Evaluate the math expression safely
        const result = math.evaluate(expression);
        return result;
    } catch (error) {
        // Handle errors (e.g., syntax errors in the expression)
        console.error("Error evaluating expression:", error);
        return null;
    }
}

  function replaceWords(input, obj) {
    
    return input.replace(/\[(\w+)]/g, (match, word) => {
        if (!isNaN(word)) {
            return match;
        }

        if (!/^\".*\"$/.test(word)) {
            if (isContextKey(word, obj)){
                return `["||${word}||"]`;
            }
        }
        return match;
    });
}

function isContextKey(searchKey, obj) {
    if (obj.hasOwnProperty(searchKey)) {
        return true;
    }
    
    for (let key in obj) {
        if (key != "req" && key != "res" && key != "session" && key != "body" && key != "urlpath" && key != "sessionID"){
            if (typeof obj[key] === 'object') {
                const result = isContextKey(searchKey, obj[key]);
                if (result) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

function isNestedArrayPlaceholder(str) {
    return str.toString().startsWith("||") && str.toString().endsWith("||");
}

function evaluateMathExpression2(expression) {
    try {
        const result = math.evaluate(expression);
        return result;
    } catch (error) {
        console.error("Error evaluating expression:", error);
        return null;
    }
}

async function replacePlaceholders2(str, json, nestedPath = "") {
    ////////console.log("AAAAAAAA")
    function getValueFromJson2(path, json, nestedPath, forceRoot) {
        console.log("getValueFromJson2", path, json, nestedPath, forceRoot)
        let current = json;
        if (!forceRoot && nestedPath) {
            const nestedKeys = nestedPath.split('.');
            for (let key of nestedKeys) {
                if (current.hasOwnProperty(key)) {
                    current = current[key];
                } else {
                    console.error(`Nested path ${nestedPath} not found in JSON.`);
                    return '';
                }
            }
        }

        // Check for array access syntax and split if present
        let arrayAccess = path.split('=>');
        let keys = arrayAccess[0].split('.');
        let keys2 = []
        let index = null;
        if (arrayAccess.length > 1) {
            keys2 = arrayAccess[1].split('.');
            // Extract index from the right side of "=>"
            if (arrayAccess[1].includes("[")){
                index = arrayAccess[1].slice(0,-1).split("[")[1]
                index = parseInt(index);
                keys2 = arrayAccess[1].split("[")[0].split('.');
            }
        }

        let curCounter = 0
        if (current.value){
            if (Object.keys(current.value).length == 0){
                current = current.context
            }
        }
        for (let key of keys) {
            //if (current.hasOwnProperty(key)) {
            //    current = current[key];
            //    if (current && typeof current === 'object' && current.hasOwnProperty('value')) {
            //        current = current.value;
            //    }
            //} else {
                ////////console.log("LL", key)
                ////////console.log("LL",current);
                ////////console.log("LL",current[key]);
                ////////console.log("LL",keys.length - 1, curCounter);
                if (keys.length - 1 > curCounter){
                    try{current = current[key].context}catch{}
                } else {
                    try{current = current[key].value}catch{}
                }
                //return '';
            //}
            curCounter++;
        }

        function isValidJSON(string) {
            try {
              JSON.parse(string); // Try parsing the string
              return true; // If parsing succeeds, return true
            } catch (error) {
              return false; // If parsing fails, return false
            }
          }

        ////////console.log("keys2", keys2)
        ////////console.log("keys2", keys2)
        if (isValidJSON(current)){
            current = JSON.parse(current)
        }
        for (let key of keys2) {
            ////////console.log("key",key)
            ////////console.log("typeof", typeof current)
            ////////console.log("curent", current)
            ////////console.log("k2.1:",current.hasOwnProperty(key))
            ////////console.log("k2.3:",current.hasOwnProperty("value"))
            if (current.hasOwnProperty(key)) {
                current = current[key];
                ////////console.log("k2.4", current)
                if (current && typeof current === 'object' && current.hasOwnProperty('value')) {
                    current = current.value;
                }
            } else if (current.hasOwnProperty("value")) {
                current = current[key];
                ////////console.log("k2.5", current)
                //return '';
            }
            curCounter++;
        }

        ////////console.log("index",index)
        ////////console.log("current",current)
        ////////console.log("Array.isArray(current)",Array.isArray(current))
        if (index !== null && Array.isArray(current)) {
            if (index >= 0 && index < current.length) {
                current = current[index];
            } else {
                console.error(`Index ${index} out of bounds for array.`);
                return '';
            }
        }

        return current;
    }

    async function replace2(str, nestedPath) {
        ////////console.log("BBBBBBBB")
        ////////console.log("str",str)
        ////////console.log("nestedPath", nestedPath)
        //str = str.replace(/ /g, "")
        let regex = /{\|(~\/)?([^{}]+)\|}/g;
        let match;
        let modifiedStr = str;

        while ((match = regex.exec(str)) !== null) {
            ////////console.log("CCCCCCCCCC")
            let forceRoot = match[1] === "~/";
            let innerStr = match[2];
            if (/{\|.*\|}/.test(innerStr)) {
                innerStr = await replace2(innerStr, nestedPath);
            }

            let value;
            console.log("innerStr",innerStr)
            if (innerStr.startsWith("=")) {
                let expression = innerStr.slice(1);
                value = await evaluateMathExpression2(expression);
            } else if (innerStr.startsWith(">")){
                console.log("INSIDE > ")
                let {getWord, getSub} = require('./routes/cookies')
                let subRes = await getSub(innerStr.replace(">",""), "su", dynamodb) 
                console.log("subRes", subRes)
                console.log("subRes.Items[0].a",subRes.Items[0].a)
                let subWord = await getWord(subRes.Items[0].a, dynamodb) 
                console.log("subWord", subWord)
                value = subWord.Items[0].s
            } else {
                console.log("DDDDDDDDDDD")
                ////////console.log("forceRoot",forceRoot)
                ////////console.log("nestedPath",nestedPath)
                value = await getValueFromJson2(innerStr, json.context || {}, nestedPath, forceRoot);
                ////////console.log("value from json 2", value)
                ////////console.log("typeof from json 2", typeof value)
            }
            

            const arrayIndexRegex = /{\|\[(.*?)\]=>\[(\d+)\]\|}/g;
            const jsonPathRegex = /{\|((?:[^=>]+))=>((?:(?!\[\d+\]).)+)\|}/;



            if (typeof value === "string" || typeof value === "number") {
                ////////console.log("value is string or number")
                ////////console.log("match[0]", match[0])
                ////////console.log("modifiedStr1", modifiedStr)
                ////////console.log("value", value)
                modifiedStr = modifiedStr.replace(match[0], value.toString());
                ////////console.log("modifiedStr2",modifiedStr)
            } else {
                console.log("str2", str);
                console.log("modifiedStr", modifiedStr);
                const isObj = await isOnePlaceholder(str) 
                console.log("isObj", isObj);
                if (isObj) {
                    ////////console.log("object", value)
                    return value;
                } else {
                    console.log("stringify", value)
                    modifiedStr = modifiedStr.replace(match[0], JSON.stringify(value));
                }
            }


            if (arrayIndexRegex.test(str)) {

                let updatedStr = str.replace(arrayIndexRegex, (match, p1, p2) => {
                    let strArray = p1.split(',').map(element => element.trim().replace(/^['"]|['"]$/g, ""));
                    let index = parseInt(p2);
                    return strArray[index] ?? "";
                });
                return updatedStr
            } else if (jsonPathRegex.test(modifiedStr) && !modifiedStr.includes("[") && !modifiedStr.includes("=>")){

                let updatedStr = modifiedStr.replace(jsonPathRegex, (match, jsonString, jsonPath) => {
                    ////////console.log("modifiedStr",modifiedStr)
                    ////////console.log("match",match),
                    ////////console.log("jsonString",jsonString)
                    ////////console.log("jsonPath",jsonPath)
                    jsonPath = jsonPath.replace("|}","")
                    try {
                        const jsonObj = JSON.parse(jsonString);
                        const pathParts = jsonPath.split('.');
                        let currentValue = jsonObj;
                        ////////console.log("JSON PATH B1",jsonObj)
                        ////////console.log("JSON PATH B2",pathParts)
                        ////////console.log("JSON PATH B3",currentValue)
                        for (const part of pathParts) {
                            if (currentValue.hasOwnProperty(part)) {
                                currentValue = currentValue[part];
                            } else {
                                console.error(`Path ${jsonPath} not found in JSON.`);
                                //currentValue = ''; // Path not found
                                break;
                            }
                        }
                        ////////console.log("JSON PATH B4",currentValue)
                        return JSON.stringify(currentValue) ?? "";
                    } catch (e) {
                        ////////console.log(`Error parsing JSON: ${e}`);
                        ////////console.log("@modifiedStr",modifiedStr)
                        //return modifiedStr; // JSON parsing error
                    }
                });
                ////////console.log("JSON PATH B5",updatedStr)
                ////////console.log("JSON PATH B6",JSON.stringify(updatedStr))
                if (updatedStr != ""){
                    return updatedStr;
                } 
                //test
                /*
                console.log("JSON PATH A", modifiedStr)
                let updatedStr = modifiedStr.replace(jsonPathRegex, (match, jsonString, jsonPath) => {
                    console.log("JSON PATH B1", match)
                    console.log("JSON PATH B2", jsonString)
                    console.log("JSON PATH B3", jsonPath)

                //the jsonString is not recocognized yet and is just returning the placeholder. We need to take the lower section and move it up, 
                // or take this and move it below the replace code below.                    
                });
                console.log("JSON PATH C", updatedStr)
                //return updatedStr;*/
            }
        }

        if (modifiedStr.match(regex)) {
            return replace2(modifiedStr, nestedPath);
        }

        return modifiedStr;
    }

    return replace2(str, nestedPath);
}

// Example usage
const str88 = "{{={{people.{{first}}{{last}}.age}} + 10}}";
const json88 = {
    "context": {
        "first": {
            "value": "adam",
            "context": {}
        },
        "last": {
            "value": "smith",
            "context": {}
        },
        "people": {
            "adamsmith": {
                "age": {
                    "value": "31",
                    "context": {}
                }
            }
        }
    },
    "value": ""
};

//console.log(replacePlaceholders(str, json));

async function processString(str, libs, nestedPath) {
    const isExecuted = str.endsWith('|}!');


    let obj = Object.keys(libs.root).reduce((acc, key) => {
        if (!["req", "res"].includes(key)) {
          acc[key] = libs.root[key];
        }
        return acc;
      }, {});

    let newNestedPath = nestedPath
    if (nestedPath.startsWith("root.")){
        newNestedPath = newNestedPath.replace("root.", "")
    } else if (nestedPath.startsWith("root")){
        newNestedPath = newNestedPath.replace("root", "")
    }

    let mmm = await replacePlaceholders2(str, obj, newNestedPath)
    console.log("MMM1", newNestedPath)
    console.log("typeof", typeof mmm)
    console.log("MMM2", mmm)
    

    const isObj = await isOnePlaceholder(str)
    console.log("str", str)
    console.log("isObj", isObj)
    console.log("---------------------")
    console.log("---------------------")
    console.log("---------------------")
    console.log("---------------------")
    console.log("---------------------")
    console.log("libs.root.context", libs.root.context)
    console.log("libs.root.context[str]", libs.root.context[str])
    console.log("typeof libs.root.context[str]", typeof libs.root.context[str])
    if ((isObj || typeof libs.root.context[str] === "object") && !str.includes("{|>")){
            target = await getKeyAndPath(str.replace("{|","").replace("|}",""), nestedPath)
            console.log("target", target)
            let nestedValue = await getNestedValue(libs, target.path)
            console.log("nestedValue", nestedValue[str.replace("{|","").replace("|}","")])
            try{
                mmm = nestedValue[str.replace("{|","").replace("|}","")].value
            } catch (e){
                mmm = nestedValue[str.replace("{|","").replace("|}","")]
            }
    }
    
    /*if (str == "res"){
        mmm = libs.root.context[str].value
    }*/
    
    console.log("TYPEOF", typeof mmm)
    if (isExecuted){
        mmm = await mmm();
    } else {
        return mmm;
    }
    /*const isExecuted = str.endsWith('|}!');
    const isObj = await isOnePlaceholder(str)
    let strClean = await removeBrackets(str, isObj, isExecuted);
    let arrowJson = strClean.split("=>")
    strClean = arrowJson[0]
    console.log("strClean", strClean, str)
    let target
    if (isObj){
        target = await getKeyAndPath(strClean, nestedPath)
    } else {
        target = {"key":strClean, "path":nestedPath}
    }
    let nestedContext = await getNestedContext(libs, target.path)
    let nestedValue= await getNestedValue(libs, target.path)

    console.log("nC", nestedContext)
    console.log("t.k", target.key)
    console.log("isMathEquation", isMathEquation(strClean))
    console.log("evaluateMathExpression", evaluateMathExpression(strClean))

    console.log("@@1",str)
    console.log("@@2", nestedContext)
    
    console.log(replacePlaceholders2(str, nestedContext));

    if (nestedContext.hasOwnProperty(target.key)){
        console.log("AAA")
        let value = nestedContext[target.key].value
        if (arrowJson.length > 1){
            console.log("BBB")
            value = getValueFromPath(value, arrowJson[1]);
        }
        if (typeof value === 'function') {
            console.log("CCC")
            if (isExecuted){
            value = await value();
            }
        }
        if (value == null || value == undefined){
            console.log("DDD")
            let fixArrayVars = replaceWords(arrowJson[1], nestedContext)
            let isArrayChecked = isArray(fixArrayVars)
            let isNumberChecked = isNumber(isArrayChecked[0])
            console.log("fixArrayVars",fixArrayVars)
            console.log("isArrayChecked",isArrayChecked)
            console.log("isNumberChecked",isNumberChecked)
            if (isNumberChecked){
                value = nestedContext[target.key].value[isArrayChecked[0]]
            } else {
                if (isArrayChecked){
                    let arrayVal
                    if (isNestedArrayPlaceholder(isArrayChecked[0])){
                        let val = isArrayChecked[0].replace("||","").replace("||","")
                        arrayVal = nestedContext[val].value
                    } else {
                        arrayVal = nestedContext[isArrayChecked[0]].value
                    }
                    value = nestedContext[target.key].value[arrayVal]
                } else {
                    value = ""
                }
            }
        }
        console.log("value", value)
        return value
    } else if (isMathEquation(strClean)){
        let fixArrayVars = replaceWords(strClean, nestedContext)
        value = evaluateMathExpression(fixArrayVars)
        return value;
    } else if (isArray(target.key)){
        console.log("THIS ITEM IS AN ARRAY", target.key)   
    }
    if (!isObj){

        const regex = /\{\{([^}]+)\}\}/g;
        let matches = [...str.matchAll(regex)];

        for (const match of matches) {
            let val = await processString(match[0], libs, nestedPath);
            str = str.replace(match[0], val);
        }

        return str;

    }
    return str
    */
}

async function runAction(action, libs, nestedPath, req, res, next){
    ////////console.log("runAction", action)
    if (action != undefined){
        ////////console.log("A111111")
        let runAction = true;
        //DON'T FORGET TO UPDATE JSON TO NOT INCLUDE THE S IN IF !!!!!!!!!!!!!!!!!!
        if (action.if) {
            ////////console.log("B111111")
            for (const ifObject of action.if) {
                ////////console.log("D111111")
                runAction = await condition(ifObject[0], ifObject[1], ifObject[2], ifObject[3], libs, nestedPath);
                if (!runAction) {
                    break;
                }
            }
        }

        if (runAction) {
            ////////console.log("E111111")
            //DON"T FORGET TO UPDATE JSON TO NOT INCLUDE S IN WHILE !!!!!!!!!!!!!!!!!!!!
            if (action.while) {
                ////////console.log("F111111")
                let whileCounter = 0
                for (const whileCondition of action.while) {
                    ////////console.log("G111111")
                    //console.log("---1", await replacePlaceholders(whileCondition[0], libs, nestedPath), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], libs, nestedPath) }], null, "&&", libs, nestedPath)
                    ////////console.log("---2", await condition(await replacePlaceholders(whileCondition[0], libs, nestedPath), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], libs, nestedPath) }], null, "&&", libs, nestedPath))
                    while (await condition(await replacePlaceholders(whileCondition[0], libs, nestedPath), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], libs, nestedPath) }], null, "&&", libs, nestedPath)) {
                        //console.log("+++1", await replacePlaceholders(whileCondition[0], libs, nestedPath), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], libs, nestedPath) }], null, "&&", libs, nestedPath)
                        ////////console.log("+++2", await condition(await replacePlaceholders(whileCondition[0], libs, nestedPath), [{ condition: whileCondition[1], right: await replacePlaceholders(whileCondition[2], libs, nestedPath) }], null, "&&", libs, nestedPath))
                           
                    let leftSide1 = await replacePlaceholders(whileCondition[0], libs, nestedPath)
                    let conditionMiddle = whileCondition[1]
                    let rightSide2 = await replacePlaceholders(whileCondition[2], libs, nestedPath)
                        
                        await processAction(action, libs, nestedPath, req, res, next);
                        whileCounter++;
                        ////////console.log("$$$", typeof leftSide1, conditionMiddle, typeof rightSide2)
                        ////////console.log("$$$", leftSide1, conditionMiddle, rightSide2)
                        ////////console.log("/////", libs.root.context.firstNum)
                        ////////console.log("whileCounter", whileCounter)
                        if (whileCounter >= req.lib.whileLimit){
                            ////////console.log("break")
                            break;
                        }
                    }
                }
            }

            if (!action.while){
                await processAction(action, libs, nestedPath, req, res, next);
            }

            if (action.assign && action.params) {
                return "continue";
            }

            if (action.execute) {
                return "continue";
            }
        }
    }
    return ""
}

async function addValueToNestedKey(key, nestedContext, value){
    if (value == undefined || key == undefined){
        //console.log("key/value undefined")
    } else {
        if (!nestedContext.hasOwnProperty(key)){
            nestedContext[key] = {"value":{}, "context":{}}
        }
        nestedContext[key].value = value;
    }
}

async function putValueIntoContext(contextPath, objectPath, value, libs, index){

    let pathHolder = libs
    ////////console.log("###contextPath2.00", contextPath.slice(0,-1))
    for (const part of contextPath.slice(0,-1)) {
            if (pathHolder.hasOwnProperty(part)) {
                if (pathHolder[part].hasOwnProperty("context")){
                    pathHolder = pathHolder[part].context;
                } else {
                    pathHolder = pathHolder[part];
                }
            }
    }
    ////////console.log("###pathHolder2.01", pathHolder)
    ////////console.log("###contextPath2.02", contextPath.length-1)
    ////////console.log("###contextPath2.03", contextPath[contextPath.length-1])
    if (pathHolder.hasOwnProperty(contextPath[contextPath.length-1])) {
        if (pathHolder[contextPath[contextPath.length-1]].hasOwnProperty("value")){
            pathHolder = pathHolder[contextPath[contextPath.length-1]].value;
        } else {
            pathHolder = pathHolder[contextPath[contextPath.length-1]];
        }
    }
    ////////console.log("###pathHolder2.1", pathHolder)
    ////////console.log("###objectPath2.12", objectPath.slice(0,-1))
    for (const part of objectPath.slice(0,-1)) {
        if (pathHolder.hasOwnProperty(part)) {
            pathHolder = pathHolder[part];
        }
    }
    ////////console.log("###pathHolder2.22", pathHolder)
    ////////console.log("###objectPath2.22",objectPath[objectPath.length - 1])
    if (index != undefined){
        pathHolder[objectPath[objectPath.length - 1]][index] = value
    } else {
        pathHolder[objectPath[objectPath.length - 1]] = value
    }
    ////////console.log("###pathHolder2.3", pathHolder)
}

async function processAction(action, libs, nestedPath, req, res, next) {
    if (action.set) {
        for (const key in action.set) {

                const keyExecuted = key.endsWith('|}!');
                const keyObj = await isOnePlaceholder(key);
                let keyClean = await removeBrackets(key, keyObj, keyExecuted);
                ////////console.log("keyClean",keyClean)
                ////////console.log(key, nestedPath);
                let set
                if (keyObj){
                    set = await getKeyAndPath(keyClean, nestedPath)
                } else {
                    set = {"key":keyClean, "path":nestedPath}
                }
                ////////console.log("66: set", set);
                let nestedContext = await getNestedContext(libs, set.path, set.key);
                ////////console.log("66: nestedContext",nestedContext)
                try{
                    ////////console.log("66:2 nestedContext", nestedContext.originalFunction)
                } catch (err) {}
                ////////console.log("66: action", action)
                ////////console.log("66: action.set[key]",action.set[key])
                function isValidJSON(string) {
                    try {
                    JSON.parse(string); // Try parsing the string
                    return true; // If parsing succeeds, return true
                    } catch (error) {
                    return false; // If parsing fails, return false
                    }
                }
                let isJ = false
                let sending = action.set[key]
                if (typeof action.set[key] === "object"){
                    isJ = true
                    sending = JSON.stringify(sending)
                }
                let value = await replacePlaceholders(sending, libs, nestedPath)
                if (isJ){
                    value = JSON.parse(value)
                }
                ////////console.log("66: value", value)

                console.log("key startsWith {|>",key )
                if (key.startsWith("{|>")){
                    let {incrementCounterAndGetNewValue, createWord, getSub, addVersion, updateEntity, getEntity, verifyThis, manageCookie} = await require('./routes/cookies');

                    keyClean = keyClean.replace(">","")
                    set.key = keyClean
                    let subRes = await getSub(keyClean, "su", dynamodb) 
                    console.log("subRes", subRes)
                    console.log("subRes.Items[0].g",subRes.Items[0].g)
                    let cookie =  await manageCookie({}, req, res, dynamodb, uuidv4)
                    console.log("cookie33", cookie)
                    let {verified} = await verifyThis(keyClean, cookie, dynamodb)
                    console.log("verified33", verified)
                    if (verified){

                        const aNew = await incrementCounterAndGetNewValue('wCounter', dynamodb);
                        console.log("aNew", aNew)
                        let nonObj = ""
                        console.log("isJ", isJ)
                        if (isJ){
                            nonObj = JSON.stringify(value)
                        } else {
                            nonObj = value
                        }
                        console.log("nonObj")
                        const a = await createWord(aNew.toString(), nonObj, dynamodb);
                        console.log("a", a)
                        params1 = {
                            "TableName": 'subdomains',
                            "Key": { "su": keyClean }, 
                            "UpdateExpression": `set a = :val`,
                            "ExpressionAttributeValues": {
                                ':val': a
                            }
                        };
                        await dynamodb.update(params1).promise();




                        const eParent = await getEntity(subRes.Items[0].e.toString(), dynamodb)

                        params2 = {
                            "TableName": 'groups',
                            "Key": { "g": eParent.Items[0].g.toString() }, 
                            "UpdateExpression": `set a = :val`,
                            "ExpressionAttributeValues": {
                                ':val': a
                            }
                        };
                        await dynamodb.update(params2).promise();

                        const details2 = await addVersion(subRes.Items[0].e.toString(), "a", a.toString(), "1", dynamodb);
                        const updateParent = await updateEntity(subRes.Items[0].e.toString(), "a", a.toString(), details2.v, details2.c, dynamodb);
                    }
                }

                let arrowJson = keyClean.split("=>") 
                ////////console.log("66: arrowJson", arrowJson)
                if (arrowJson.length > 1){
                    let index
                    if (arrowJson[1].includes("[")){
                        index = arrowJson[1].slice(0,-1).split("[")[1]
                        arrowJson[1] = arrowJson[1].slice(0,-1).split("[")[0]
                    }
                    const pathParts = arrowJson[1].split('.');
                    ////////console.log("66: pathParts", pathParts)
                    let firstParts = arrowJson[0].replace("~/","root.").split('.')
                    ////////console.log("###firstParts", firstParts)
                    ////////console.log("###pathParts", pathParts)
                    ////////console.log("###value", value)
                    ////////console.log("###libs", libs)
                    if (index != undefined){
                        if (index.includes("{|")){
                            ////////console.log("index", index)
                            index = index.replace("{|","").replace("|}","")
                            ////////console.log("preIndex", index)
                            index = libs.root.context[index.replace("{|","").replace("|}","").replace("~/","")]
                            index = parseInt(index.value.toString())
                            ////////console.log("postIndex", index)
                        }
                    }
                    await putValueIntoContext(firstParts, pathParts, value, libs, index);
                    ////////console.log("###libs3", libs)
                } else {
                    await addValueToNestedKey(set.key.replace("~/",""), nestedContext, value);
                }
        }
    }

    if (action.target) {

        const isObj = await isOnePlaceholder(action.target)
        let strClean = await removeBrackets(action.target, isObj, false);
        let target
        if (isObj){
            target = await getKeyAndPath(strClean, nestedPath)
        } else {
            target = {"key":strClean, "path":nestedPath}
        }
        let nestedContext = await getNestedContext(libs, target.path);

        if (!nestedContext.hasOwnProperty(target.key)){
            nestedContext[target.key] = {"value":{}, "context":{}}
        }
        ////////console.log(">>A<<")
        value = await replacePlaceholders(target.key, libs, target.path);
        let args = [];

        if (value){
            //.arguments is the old .from
            if (action.params) {
                let promises = action.params.map(async item => {
                    ////////console.log("arguments: item", item)
                    const fromExecuted = item.endsWith('|}!');
                    ////////console.log("arguments: fromExecuted", fromExecuted)
                    const fromObj = await isOnePlaceholder(item);
                    ////////console.log("arguments: fromObj", fromObj)
                    let fromClean = await removeBrackets(item, fromObj, fromExecuted);
                    ////////console.log("arguments: fromClean", fromClean)
                    let from
                    if (isObj){
                        from = await getKeyAndPath(fromClean, nestedPath)
                    } else {
                        from = {"key":fromClean, "path":nestedPath}
                    }
                    ////////console.log("arguments: from", from)
                    let nestedContext = await getNestedContext(libs, from.path);
                    ////////console.log("arguments: nestedContext", nestedContext)

                    ////////console.log(">>B<<")
                    let value = await replacePlaceholders(item, libs, nestedPath);
                    ////////console.log("arguments: value", value)
                    if (fromObj && fromExecuted && typeof value === 'function') {
                        return value();
                    }
                    return value;
                });
                args = await Promise.all(promises)
                ////////console.log("arguments: args", args)
            }

            if (typeof nestedContext[target.key].value === 'function' && args.length > 0) {
                ////////console.log("Is a function: ", target.key, typeof nestedContext[target.key].value )
                nestedContext[target.key].value = value(...args); 
            }
        }
        let newNestedPath = nestedPath
        result = await applyMethodChain(value, action, libs, newNestedPath, res, req, next);
        if (action.assign) {
            const assignExecuted = action.assign.endsWith('|}!');
            ////////console.log("assignExecuted",assignExecuted, action.assign)
            const assignObj = await isOnePlaceholder(action.assign);
            ////////console.log("assignObj",assignObj)
            let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
            ////////console.log("strClean",strClean)
            let assign
            if (isObj){
                assign = await getKeyAndPath(strClean, nestedPath)
            } else {
                assign = {"key":strClean, "path":nestedPath}
            }
            ////////console.log("assign", assign)
            let nestedContext = await getNestedContext(libs, assign.path);
            ////////console.log("nestedContext", nestedContext)
            if (assignObj && assignExecuted && typeof result === 'function') {
                ////////console.log("inside", result)
                let tempFunction = () => result;
                ////////console.log("tempFunction", tempFunction)
                let newResult = await tempFunction()
                ////////console.log("newResult", newResult)
                await addValueToNestedKey(strClean, nestedContext, newResult)
            } else {
                ////////console.log("other", assign)
                await addValueToNestedKey(strClean, nestedContext, result)
                //console.log("if", typeof nestedContext[assign.target], assignExecuted)
                //if (typeof nestedContext[assign.target] === "function" && assignExecuted){
                //    nestedContext[assign.target](...args)
                //}
            }
        }
    } else if (action.assign) {
       console.log("!!!~~~~~~~~~")
        const assignExecuted = action.assign.endsWith('|}!');
        const assignObj = await isOnePlaceholder(action.assign);
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        let assign
        if (assignObj){
            assign = await getKeyAndPath(strClean, nestedPath)
        } else {
            assign = {"key":strClean, "path":nestedPath}
        }
        let nestedContext = await getNestedContext(libs, assign.path);
        if (assignObj) {
            let result = await createFunctionFromAction(action, libs, assign.path, req, res, next)
            if (assignExecuted && typeof result === 'function'){
                    result = await result()
            } else if (typeof result === 'function'){
                    result = JSON.stringify(result);
            }
            await addValueToNestedKey(assign.key, nestedContext, result);
        } else {
            await addValueToNestedKey(action.assign, nestedContext, await createFunctionFromAction(action, libs, assign.path, req, res, next));
        }
    } 

    if (action.execute) {
        const isObj = await isOnePlaceholder(action.execute)
        let strClean = await removeBrackets(action.execute, isObj, false);//false but will be executed below
        let execute
        if (isObj){
            execute = await getKeyAndPath(strClean, nestedPath)
        } else {
            execute = {"key":strClean, "path":nestedPath}
        }
        let nestedContext = await getNestedContext(libs, execute.path);
        let value = nestedContext[execute.value]
        ////////console.log("777: isObj", isObj)
        ////////console.log("777: nestedPath", nestedPath)
        ////////console.log("777: execute", execute)
        ////////console.log("777: nestedContext", nestedContext)
        ////////console.log("777: value", value)
        // LOOK INTO ACTION.NEXT = FALSE. IS THIS POSSIBLE IN ACTION LIKE IN CHAIN.
        if (typeof value === 'function') {
            if (action.express) {
                if (!action.next){
                    await value.value(req, res);
                } else {
                    await value.value(req, res, next); 
                }
            } else {
                await value.value;
            }
        } else {
            console.error(`No function named ${strClean} found in context`);
        }
    }
    
    if (action.next) {
        next();
    }
}

async function applyMethodChain(target, action, libs, nestedPath, res, req, next) {
    let result = target

    if (nestedPath.endsWith(".")){
        nestedPath = nestedPath.slice(0,-1)
    }

    if (nestedPath.startsWith(".")){
        nestedPath = nestedPath.slice(1)
    }

    async function instantiateWithNew(constructor, args) {
        return await new constructor(...args);
    }
    // DELETED (here) the action.access condition that avoided action.chain by putting everything in the action, so that we had less to prompt engineer for LLM.

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            let chainParams;

            // I FORGOT ABOUT THIS RETURN CAPABILITY. IT RETURNS WHAT THE "VALUE" OF WHAT CHAINACTION.RETURN HOLDS. 
            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return;
            }

            if (chainAction.params) {
                console.log(">>C<<")
                chainParams = await replacePlaceholders(chainAction.params, libs, nestedPath)
            } else {
                chainParams = [];
            }
            console.log("chainParams",chainParams)
            let accessClean = chainAction.access
            if (accessClean){
                const isObj = await isOnePlaceholder(accessClean)
                accessClean = await removeBrackets(accessClean, isObj, false);
            }

            console.log("a", accessClean);
            console.log("b", chainAction.params);
            console.log("c", chainAction.new);
            console.log("d", result);
            console.log("e", result[accessClean]);
            console.log("f", result.length);
            console.log("g", typeof result[accessClean]);
            console.log("h", nestedPath)

            //target is not getting letters andd it's value.
            // we need to ensure it navvvigates to the path and gets the target value
            // and applies the chain so length can run on letters which is an array.
            

            if (accessClean && (!chainAction.params || chainAction.params.length == 0) && !chainAction.new) {
                console.log("--1--")
                
                result = result[accessClean];
            } else if (accessClean && chainAction.new && chainAction.params.length > 0) {
                console.log("--2a--")
                result = await instantiateWithNew(result[accessClean], chainParams);
            } else if ((!accessClean || accessClean == "") && chainAction.new && (!chainAction.params || chainAction.params.length == 0)) {
                console.log("--2b--")
                result = await instantiateWithNew(result, []);
            } else if ((!accessClean || accessClean == "") && chainAction.new && chainAction.params.length > 0) {
                console.log("--2c--")
                result = await instantiateWithNew(result, chainAction.params);
            } else if (typeof result[accessClean] === 'function') {
                console.log("--3--")
                if (accessClean === 'promise') {
                    result = await result.promise();
                } else {

                    console.log("..a..")
                    if (chainAction.new) {
                        console.log("..b..")
                        result = new result[accessClean](...chainParams);
                    } else {
                        console.log("..c..")
                        if (chainAction.access && accessClean.length != 0){
                            console.log("..d..")
                            if (chainAction.express){
                                console.log("..e..")
                                if (chainAction.next || chainAction.next == undefined){
                                    console.log("..f..")
                                    result = await result[accessClean](...chainParams)(req, res, next);
                                } else {
                                    console.log("..g..")
                                    result = await result[accessClean](...chainParams)(req, res);
                                }
                            } else {
                                
                                console.log("..h..")
                                try{ console.log("result", result) } catch (err){}
                                try{ console.log("accessClean", accessClean)} catch (err){}
                                try{ console.log("chainParams", chainParams)} catch (err){}
                                try{
                                    console.log("..i..")
                                    ////////console.log(chainParams[0])
                                    ////////console.log(typeof chainParams[0])
                                    if (chainParams.length > 0){
                                        if (typeof chainParams[0] == "number"){
                                            chainParams[0] = chainParams[0].toString();
                                        }
                                    }
                                    result = await result[accessClean](...chainParams);
                                } catch(err){
                                    console.log("err", err)
                                    console.log("..j..")
                                    //console.log("result", result.req.lib.root)
                                    result = result
                                }
                            }
                        }
                    }
                }
            } else if (typeof result === 'function') {
                console.log("--3--")
                //if (accessClean === 'promise') {
                //    result = await result.promise();
                //} else {

                    console.log("..a..")
                    if (chainAction.new) {
                        console.log("..b..")
                        result = new result(...chainParams);
                    } else {
                        console.log("..c..")
            //            if (chainAction.access && accessClean.length != 0){
                            console.log("..d..")
                            if (chainAction.express){
                                console.log("..e..")
                                if (chainAction.next || chainAction.next == undefined){
                                    console.log("..f..")
                                    result = await result(...chainParams)(req, res, next);
                                } else {
                                    console.log("..g..")
                                    result = await result(...chainParams)(req, res);
                                }
                            } else {
                                
                                console.log("..h..")
                                try{ console.log("result", result) } catch (err){}
                                //try{ console.log("accessClean", accessClean)} catch (err){}
                                try{ console.log("chainParams", chainParams)} catch (err){}
                                try{
                                    console.log("..i..")
                                    ////////console.log(chainParams[0])
                                    ////////console.log(typeof chainParams[0])
                                    if (chainParams.length > 0){
                                        if (typeof chainParams[0] === "function" || typeof chainParams[0] === "object"){
                                            console.log("DO NOTHING BECAUSE IT IS A FUNCTION OR OBJECT")
                                        } else if (typeof chainParams[0] === "number"){
                                            chainParams[0] = chainParams[0].toString();
                                        }
                                    }
                                    result = await result(...chainParams);
                                } catch(err){
                                    console.log("err", err)
                                    console.log("..j..")
                                    //console.log("result", result.req.lib.root)
                                    result = result
                                }
                            }
            //            }
            //        }
                }
            } else if (!accessClean && chainAction.params){
                console.log("--4--")
                // SEE IF WE CAN USE THIS FOR NO METHOD FUNCTIONS LIKE method()(param, param, pram)
            } else {
                console.log("--5--")
                try{
                ////////console.log(libs.root.context[action.target].value)
                ////////console.log(libs.root.context[action.target].value.length)
                } catch (err){}
                console.error(`Method ${chainAction.access} is not a function on ${action.target}`);
                return;
            }
        }
    }
    console.log("--6--")
    try {
        // Log the files and folders in /opt
        const optDir = '/tmp';
        fs.readdir(optDir, (err, files) => {
          if (err) {
            console.error('Error reading /opt directory:', err);
          } else {
            console.log('Files and folders in /opt:');
            files.forEach(file => {
              const filePath = path.join(optDir, file);
              const stats = fs.statSync(filePath);
              console.log(`- ${file} (${stats.isDirectory() ? 'directory' : 'file'})`);
            });
          }
        });
    
        // ... your existing code ...
    
      } catch (err) {
        console.log(err);
        res.status(500).send('An error occurred');
      }
    return result;
}

async function createFunctionFromAction(action, libs, nestedPath, req, res, next) {
    console.log("11111111")
    return  async function (...args) {
        const assignExecuted = action.assign.endsWith('|}!');
        ////////console.log("55: assignExecuted", assignExecuted)
        const assignObj = await isOnePlaceholder(action.assign);
        ////////console.log("55: assignObj", assignObj)
        let strClean = await removeBrackets(action.assign, assignObj, assignExecuted);
        ////////console.log("55: strClean", strClean)
        let assign
        if (assignObj){
            assign = await getKeyAndPath(strClean, nestedPath)
        } else {
            assign = {"key":strClean, "path":nestedPath}
        }
        ////////console.log("55: assign", assign)
        let nestedContext = await getNestedContext(libs, assign.path);
        ////////console.log("createFunctionFromAction", assign.key, nestedContext)
        await addValueToNestedKey(assign.key, nestedContext, {})
        let result;
        ////////console.log("args", args)

        if (action.params){
            /*let promises = args.map(async arg => {
                console.log("11: arg", arg)
                if (action.params && arg) {
                    const paramExecuted1 = arg.endsWith('|}!');
                    console.log("11: paramExecuted1", paramExecuted1)
                    const paramObj1 = await isOnePlaceholder(arg);
                    console.log("11: paramObj1", paramObj1)
                    let paramClean1 = await removeBrackets(arg, paramObj1, paramExecuted1);
                    console.log("11: paramClean1", paramClean1)
                    let param1 = await getKeyAndPath(paramClean1, nestedPath);
                    console.log("11: param1", param1)
                    let paramNestedContext1 = await getNestedContext(libs, param1.path);
                    console.log("11: paramNestedContext1", paramNestedContext1)
                    if (paramExecuted1 && paramObj1 && typeof arg === "function"){
                        console.log("11: paramNestedContext1 function", param1.key, arg, paramNestedContext1)
                        paramNestedContext1[param1.key] = await arg();
                    } else {
                        console.log("11: paramNestedContext1 not function", param1.key, arg, paramNestedContext1)
                        paramNestedContext1[param1.key] = arg;
                    }
                }
            })*/

            //from params might actually create context params. 

            //let addToNested = await Promise.all(promises);
            //console.log("addToNested", addToNested)

            let indexP = 0;
            for (par in action.params){
                console.log("par",par)
                let param2 = action.params[par]
                console.log("11: param2",param2)
                if (param2 != null && param2 != ""){
                    const paramExecuted2 = param2.endsWith('|}!');
                    console.log("22: paramExecuted2",paramExecuted2)
                    const paramObj2 = await isOnePlaceholder(param2);
                    console.log("22: paramObj2",paramObj2)
                    let paramClean2 = await removeBrackets(param2, paramObj2, paramExecuted2);
                    console.log("22: paramClean2",paramClean2)
                    let newNestedPath2 = nestedPath+"."+assign.key
                    console.log("22: newNestedPath2",newNestedPath2)
                    let p
                    const isObj = await isOnePlaceholder(paramClean2)
                    if (isObj){
                        p = await getKeyAndPath(paramClean2, newNestedPath2)
                    } else {
                        p = {"key":paramClean2, "path":newNestedPath2}
                    }
                    console.log("22: p",p)
                    let nestedParamContext2 = await getNestedContext(libs, p.path);
                    console.log("22: addValue:",paramClean2, nestedParamContext2, args[indexP])
                    await addValueToNestedKey(paramClean2, nestedParamContext2, args[indexP])
                    ////////console.log("22: lib.root.context", libs.root.context);
                }
                indexP++
            }
        }
        ////////console.log("222222")
        ////////console.log("lib.root.context", libs.root.context)
        //.actions is the old .run
        if (action.nestedActions) {
            console.log("ACTIONS5 ACTIONS5")
            for (const act of action.nestedActions) {
                console.log("00: act", act)
                let newNestedPath = nestedPath+"."+assign.key;
                console.log("00: newNestedPath", newNestedPath, "libs", libs);
                result = await runAction(act, libs, newNestedPath, req, res, next)
                console.log("00: result", result)
            }
            console.log("00: lib.root.context", libs.root.context)
        }
        return result;
    };
}

const automate = async (url) => {
    try {
      const response = await axios.get(url);
      ////////console.log('URL called successfully:', response.data);
    } catch (error) {
      console.error('Error calling URL:', error);
    }
  };

const serverlessHandler = serverless(app);

module.exports.lambdaHandler = async (event, context) => {

    if (event.Records && event.Records[0].eventSource === "aws:ses") {
        // Process the SES email
        console.log("Received SES event:", JSON.stringify(event, null, 2));

        // Extract and process the SES email data
        // Add your SES email processing logic here
        // ...

        return { statusCode: 200, body: JSON.stringify('Email processed') };
    }
    if (event.automate){
        console.log("automate is true")

        var hour = moment.utc().format('HH');
        var minute = moment.utc().format('mm');
        console.log("hour", hour, "minute", minute)
        const hourFormatted = hour.toString().padStart(2, '0');
        const minuteFormatted = minute.toString().padStart(2, '0');
        var dow = moment.utc().format('dd').toLowerCase();
        var today = moment.utc()
        console.log("hour", hourFormatted, "minute", minuteFormatted, "dow",dow, "today", today)

        //await automate("https://1var.com/1v4radcba059-0e47-4042-a887-d110ff4cfa99");
        //await getEventsAndTrigger();
        return {"automate":"done"}
    }
    if (event.enable){

        let {setupRouter, getHead, convertToJSON, manageCookie, getSub, createVerified, incrementCounterAndGetNewValue} = await require('./routes/cookies')

        const en = await incrementCounterAndGetNewValue('enCounter', dynamodb);

        const today = moment();
        const tomorrow = moment().add(1, 'days');
        const dow = tomorrow.format('dd').toLowerCase();
        const gsiName = `${dow}Index`;

        const endOfTomorrowUnix = tomorrow.endOf('day').unix();

        const params = {
            TableName: "schedules",
            IndexName: gsiName,
            KeyConditionExpression: "#dow = :dowValue AND #sd < :endOfTomorrow",
            ExpressionAttributeNames: {
            "#dow": dow, // Adjust if your GSI partition key is differently named
            "#sd": "sd"
            },
            ExpressionAttributeValues: {
            ":dowValue": 1, // Assuming '1' represents 'true' for tasks to be fetched
            ":endOfTomorrow": endOfTomorrowUnix
            }
        };
        

        console.log("params", params)

        try {
            const config = { region: "us-east-1" };
            const client = new SchedulerClient(config);
            const data = await dynamodb.query(params).promise();
            console.log("Query succeeded:", data.Items);

            for (item in data.Items){
                let stUnix = data.Items[item].sd + data.Items[item].st
                let etUnix = data.Items[item].sd + data.Items[item].et


                var startTime = moment(stUnix * 1000);
                var endTime = moment(etUnix * 1000);
                
                while (startTime <= endTime) {

                    var hour = startTime.format('HH');
                    var minute = startTime.format('mm');
                    console.log("hour", hour, "minute", minute)
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
                            Input: JSON.stringify({"disable":true, "automate":true}),
                        },
                        FlexibleTimeWindow: { Mode: "OFF" },
                    };
                    console.log("input2", input)
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
                                    ":en": en // New value for 'en'
                                },
                                ReturnValues: "UPDATED_NEW" // Returns the attribute values as they appear after the UpdateItem operation
                                };
                            
                                try {
                                const result = await dynamodb.update(params).promise();
                                console.log(`Updated item with time: ${scheduleName}`, result);
                                } catch (err) {
                                console.error(`Error updating item with time: ${scheduleName}`, err);
                                }

                            console.log("Schedule created successfully:", response.ScheduleArn);
                        } catch (error) {
                            console.error("Error creating schedule:", error);
                        }
                    };
                    
                    await createSchedule();
                    startTime.add(data.Items[item].it, 'minutes');
                }
            }

            //res.json(data.Items)
            //return { statusCode: 200, body: JSON.stringify(data.Items) };
        } catch (err) {
            console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
            //return { statusCode: 500, body: JSON.stringify(err) };
        }
            
    }
    if (event.disable){
        let enParams = { TableName: 'enCounter', KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: {':pk': "enCounter"} };
        let en = await dynamodb.query(enParams).promise()
        let params = { TableName: 'enabled',IndexName: 'enabledindex',KeyConditionExpression: 'enabled = :enabled AND en = :en',ExpressionAttributeValues: {':en': en.Items[0].x-1, ':enabled':1} }
        console.log("params", params)
        const config = { region: "us-east-1" };
        const client = new SchedulerClient(config);
    
        await dynamodb.query(params).promise()
        .then(async data => {
            let updatePromises = await data.Items.map(async item => {
                console.log("item", item)
                const time = item.time
                console.log("time",time)
                let updateParams = {
                    TableName: 'enabled',
                    Key: {
                         "time": item.time
                    },
                    UpdateExpression: 'SET enabled = :newEnabled, en = :en',
                    ExpressionAttributeValues: {
                        ':newEnabled': 0,
                        ':en': item.en
                    }
                };
    
                await dynamodb.update(updateParams).promise();
                var hour = time.substring(0, 2);
                var minute = time.substring(2, 4);
                console.log("hour", hour, "minute", minute)
                const hourFormatted = hour.toString().padStart(2, '0');
                const minuteFormatted = minute.toString().padStart(2, '0');
                
                console.log("moment", moment.utc().format())
                const scheduleName = `${hourFormatted}${minuteFormatted}`;
                
                const scheduleExpression = `cron(${minuteFormatted} ${hourFormatted} * * ? *)`;
    
                const input = {
                    Name: scheduleName,
                    GroupName: "runLambda",
                    ScheduleExpression: scheduleExpression,
                    ScheduleExpressionTimezone: "UTC",
                    StartDate: new Date(moment.utc().format()),
                    EndDate: new Date("2030-01-01T00:00:00Z"),
                    State: "DISABLED",
                    Target: {
                        Arn: "arn:aws:lambda:us-east-1:536814921035:function:compute-ComputeFunction-o6ASOYachTSp", 
                        RoleArn: "arn:aws:iam::536814921035:role/service-role/Amazon_EventBridge_Scheduler_LAMBDA_306508827d",
                        Input: JSON.stringify({"automate":true}),
                    },
                    FlexibleTimeWindow: { Mode: "OFF" },
                };
                console.log("update input", input)
    
                const command = new UpdateScheduleCommand(input);
                const response = await client.send(command);
                console.log("updateSchedule response", response)
                return "done"
            });
    
            return Promise.all(updatePromises);
        })
        .then(updateResults => {
            console.log('Update completed', updateResults);
        })
        .catch(error => {
            console.error('Error updating items', error);
        });
    } else {
        return serverlessHandler(event, context);
    }
};