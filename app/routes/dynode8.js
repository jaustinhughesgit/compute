const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
let local = {}
local.dyRouter = express.Router();
local.path = require('path');
local.unzipper = require('unzipper');
local.session = require('express-session');

local.s3 = new AWS.S3();

local.dyRouter.use(local.session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));

const json = {
    "modules": {
        "moment": "moment",
        "moment-timezone": "moment-timezone"
    },
    "actions": [
        {
            "module": "moment",
            "chain": [
                { "method": "tz", "params": ["Asia/Dubai"] },
                { "method": "format", "params": ["YYYY-MM-DD HH:mm:ss"] }
            ],
            "assignTo": "timeInDubai"
        }
    ]
}

function testFunction(){
        return "hello world"
}

function newFunction(val){
    return val + "!"
}

local.dyRouter.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    context["testFunction"] = testFunction;
    context["newFunction"] = newFunction;
    await initializeModules(context, json, req, res, next);
    res.json(context);
});



async function initializeModules(context, config) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        let moduleInstance = local[action.module] ? local[action.module] : require(action.module);
        let result = typeof moduleInstance === 'function' ? (action.valueFrom ? moduleInstance(context[action.valueFrom]) : moduleInstance()) : moduleInstance;
        result = await applyMethodChain(result, action, context);
        if (action.assignTo) {
            context[action.assignTo] = result;
        }
    }
}

function replacePlaceholders(str, context) {
    return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        return context[key] || match;
    });
}

async function applyMethodChain(target, action, context) {
    let result = target;
    if (action.method) {
        let params = action.params ? action.params.map(param => typeof param === 'string' ? replacePlaceholders(param, context) : param) : [];
        result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : null;
    }
    if (action.chain && result) {
        for (const chainAction of action.chain) {
            const chainParams = chainAction.params?.map(param => typeof param === 'string' ? replacePlaceholders(param, context) : param) || [];
            if (typeof result[chainAction.method] === 'function') {
                result = chainAction.method === 'promise' ? await result.promise() : result[chainAction.method](...chainParams);
            } else {
                console.error(`Method ${chainAction.method} is not a function on ${action.module}`);
                return;
            }
        }
    }
    return result;
}

async function processConfig(config) {
    const context = {};
    for (const [key, value] of Object.entries(config.modules)) {
            let newPath = await downloadAndPrepareModule(value, context);
    }
    return context;
}

async function downloadAndPrepareModule(moduleName, context) {
    const modulePath = `/tmp/node_modules/${moduleName}`;
    if (!fs.existsSync(modulePath)) {
        await downloadAndUnzipModuleFromS3(moduleName, modulePath);
    }
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}:${modulePath}` : modulePath;
    return modulePath;
}

async function downloadAndUnzipModuleFromS3(moduleName, modulePath) {
    const zipKey = `node_modules/${moduleName}.zip`;
    const params = {
        Bucket: "1var-node-modules",
        Key: zipKey,
    };
    console.log(params);
    try {
        const data = await local.s3.getObject(params).promise();
        await unzipModule(data.Body, modulePath);
    } catch (error) {
        console.error(`Error downloading and unzipping module ${moduleName}:`, error);
        throw error;
    }
}

async function unzipModule(zipBuffer, modulePath) {
    fs.mkdirSync(modulePath, { recursive: true });
    const directory = await local.unzipper.Open.buffer(zipBuffer);
    await directory.extract({ path: modulePath });
}

module.exports = local.dyRouter;