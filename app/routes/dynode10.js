
var express = require('express');
let local = {};
local.AWS = require('aws-sdk');
local.dyRouter = express.Router();
local.path = require('path');
local.unzipper = require('unzipper');
local.fs = require('fs');
local.session = require('express-session');

local.s3 = new local.AWS.S3();
local.dyRouter.use(local.session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true } 
}));

const json = {
    "modules": {
        "moment-timezone": "moment-timezone",
        "passport":"passport",
        "passport-microsoft":"passport-microsoft"
    },
    "actions": [
        {
            "set":{"foo":"bar","bar":"{{foo}}"}
        },
        {
            "module": "moment-timezone",
            "chain": [
                { "method": "tz", "params": ["Asia/Dubai"] },
                { "method": "format", "params": ["YYYY-MM-DD HH:mm:ss"] }
            ],
            "assignTo": "timeInDubai"
        },
        {
            "module": "moment-timezone",
            "assignTo": "justTime",
            "valueFrom": ["{{timeInDubai}}!"],
            "chain": [
                { "method": "format", "params": ["HH:mm"] }
            ]
        },
        {
            "module": "moment-timezone",
            "assignTo": "timeInDubai2",
            "valueFrom": ["{{timeInDubai}}"],
            "chain": [
                { "method": "add", "params": [1, "hours"] },
                { "method": "format", "params": ["YYYY-MM-DD HH:mm:ss"] }
            ]
        },
        {
            "module": "moment-timezone",
            "assignTo": "justTime2",
            "valueFrom": ["{{timeInDubai2}}!"],
            "chain": [
                { "method": "format", "params": ["HH:mm"] }
            ]
        },
        {
            "module": "fs",
            "chain": [
                {
                    "method": "readFileSync",
                    "params": ["/var/task/app/routes/../example.txt", "utf8"],
                }
            ],
            "assignTo": "fileContents"
        },
        {
            "module": "fs",
            "method": "writeFileSync",
            "params": [local.path.join('/tmp', 'tempFile.txt'), "This {{timeInDubai}} is a test file content {{timeInDubai}}", 'utf8']
        },
        {
            "module": "fs",
            "chain": [
                {
                    "method": "readFileSync",
                    "params": [local.path.join('/tmp', 'tempFile.txt'), "utf8"],
                }
            ],
            "assignTo": "tempFileContents"
        },
        {
            "module": "s3",
            "chain": [
                {
                    "method": "upload",
                    "params": [{
                        "Bucket": "public.1var.com",
                        "Key": "tempFile.txt",
                        "Body": "{{testFunction}}"
                    }]
                },
                {
                    "method": "promise",
                    "params": []
                }
            ],
            "assignTo": "s3UploadResult"
        },
        {
            "params":["{test}"], 
            "chain":[
                {"return":"{test}"}
            ],
            "assignTo":"customFunction"
        },
        {
            "if":["{{urlpath}}","!=","/microsoft/callback"],
            "module":"passport",
            "chain":[
            ],
            "assignTo":"passport"
        },
        {
            "if":["{{urlpath}}","!=","/microsoft/callback"],
            "params":["{accessToken}", "{refreshToken}", "{profile}", "{done}"], 
            "chain":[],
            "run":[
                {"method":"{done}", "params":[null, "{profile}"]}
            ],
            "assignTo":"callbackFunction"
        },
        {
            "if":["{{urlpath}}","!=","/microsoft/callback"],
            "module":"passport-microsoft",
            "chain":[
               {"method":"Strategy", "params":[
                {
                    "clientID": process.env.MICROSOFT_CLIENT_ID,
                    "clientSecret": process.env.MICROSOFT_CLIENT_SECRET,
                    "callbackURL": "https://compute.1var.com/auth/microsoft/callback",
                    "resource": "https://graph.microsoft.com/",
                    "tenant": process.env.MICROSOFT_TENANT_ID,
                    "prompt": "login",
                    "state": false,
                    "type": "Web",
                    "scope": ["user.read"]
                },"{{callbackFunction}}"
               ],
                "new":true}
            ],
            "assignTo":"passportmicrosoft"
        },
        {
            "if":["{{urlpath}}","!=","/microsoft/callback"],
            "module":"passport",
            "chain":[
                {"method":"use", "params":["{{passportmicrosoft}}"]}
            ],
            "assignTo":"newStrategy"
        },
        {
            "ifArray":[["{{urlpath}}","!=","/microsoft/callback"]],
            "module":"passport",
            "chain":[
                {"method":"authenticate", "params":["microsoft"], "express":true},
            ],
            "assignTo":"newAuthentication"
        },
        {
            "ifArray":[["{{urlpath}}","==","/microsoft/callback"]],
            "module":"req",
            "method":"json",
            "params":[{"req":"json"}]
        }
    ]
}

local.dyRouter.all('/*', async function(req, res, next) {
    local.req = req;
    local.res = res;
    let context = await processConfig(json);
    context["urlpath"] = req.path
    context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
    await initializeModules(context, json, req, res, next);
    if (context.urlpath== "/microsoft/callback"){
        //local.res.json(context);
    }
});

function testFunction(){
    return "hello world"
}

function newFunction(val){
return val + "!"
}

local.dyRouter.get('/', async function(req, res, next) {
    let context = {};
    context["testFunction"] = testFunction;
    context["newFunction"] = newFunction;
    context = await processConfig(json, context);
    await initializeModules(context, json);
    context["testFunctionResult"] = testFunction();
    context["newFunctionResult"] = newFunction("test");
    context["customFunctionResult"] = context["customFunction"]("yoyo");
    res.json(context);
});

function condition(left, condition, right, context){
    left = replacePlaceholders(left, context)
    condition = replacePlaceholders(condition, context)
    right = replacePlaceholders(right, context)

    if (condition == "=="){
        if (left == right){ return true } else { return false }
    } else if (condition == "!="){
        if (left != right){ return true } else { return false }
    } else if (condition == ">"){
        if (left > right){ return true } else { return false }
    } else if (condition == ">="){
        if (left >= right){ return true } else { return false }
    } else if (condition == "<"){
        if (left < right){ return true } else { return false }
    } else if (condition == "<="){
        if (left <= right){ return true } else { return false }
    } else if ((!condition || condition == "") && (!right || right == "")){
        if (left){ return true} else { return false}
    }
}

async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {

        let runAction = true
        if (action.if) {
                runAction = condition(action.if[0],action.if[1],action.if[2], context)
        }

        if (action.ifArray) {
                for (const ifObject of action.ifArray){
                    runAction = condition(ifObject[0],ifObject[1],ifObject[2], context)
                    if (!runAction){
                        break;
                    }
                }
        }
        
        if (runAction){
            console.log("action.set", action.set)
            if (action.set){
                console.log("inside set")
                for (key in action.set){
                    console.log(key)
                    context[key] = replacePlaceholders(action.set[key], context)
                }
            }

            if (action.execute) {
                const functionName = action.execute;
                if (typeof context[functionName] === 'function') {
                    if (action.express){
                        await context[functionName](req, res, next);
                    } else {
                        await context[functionName]
                    }
                    continue;
                } else {
                    console.error(`No function named ${functionName} found in context`);
                    continue;
                }
            }

            if (!action.module && action.assignTo && action.params && action.chain) {
                context[action.assignTo] = createFunctionFromAction(action, context, req, res, next)
                console.log("context",context)
                continue;
            }

            if (action.module){
                let moduleInstance = local[action.module] ? local[action.module] : require(action.module);

                let args = [];
                if (action.valueFrom) {
                    args = action.valueFrom.map(item => {
                        let isFunctionExecution = item.endsWith('!');
                        let key = isFunctionExecution ? item.slice(2, -3) : item.slice(2, -2);
                        let value = context[key];
                
                        if (isFunctionExecution && typeof value === 'function') {
                            return value();
                        }
                        return value;
                    });
                }

                let result = typeof moduleInstance === 'function' ? moduleInstance(...args) : moduleInstance;
                result = await applyMethodChain(result, action, context, res, req, next);
                if (action.assignTo) {
                    if (action.assignTo.includes('{{')) {
                        let isFunctionExecution = action.assignTo.endsWith('!');
                        let assignKey = isFunctionExecution ? action.assignTo.slice(2, -3) : action.assignTo.slice(2, -2);
                        
                        if (isFunctionExecution) {
                            context[assignKey] = typeof result === 'function' ? result() : result;
                        } else {
                            context[assignKey] = result;
                        }
                    } else {
                        context[action.assignTo] = result;
                    }
                }
            }
        }
    }
}

function createFunctionFromAction(action, context, req, res, next) {
    return function(...args) {
        let result;
        let scope = args.reduce((acc, arg, index) => {
            if (action.params && action.params[index]) {
                const paramName = action.params[index].replace(/[{}]/g, '');
                acc[paramName] = arg;
            }
            return acc;
        }, {});

        if (action.chain) {
            for (const chainAction of action.chain) {
                const chainParams = Array.isArray(chainAction.params) ? chainAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                }) : [];

                if (typeof chainAction.method === 'string') {
                    if (chainAction.method.startsWith('{') && chainAction.method.endsWith('}')) {
                        const methodName = chainAction.method.slice(1, -1);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...chainParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    } else if (result && typeof result[chainAction.method] === 'function') {
                        result = result[chainAction.method](...chainParams);
                    } else {
                        console.error(`Method ${chainAction.method} is not a function on result`);
                        return;
                    }
                }
            }
        }

        if (action.run) {
            for (const runAction of action.run) {
                const runParams = Array.isArray(runAction.params) ? runAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                }) : [];

                if (typeof runAction.method === 'string') {
                    if (runAction.method.startsWith('{') && runAction.method.endsWith('}')) {
                        const methodName = runAction.method.slice(1, -1);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...runParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    }
                }
            }
        }

        return result;
    };
}



function replaceParams(param, context, scope, args) {
    if (param) {
        if (param.startsWith('{') && param.endsWith('}')) {
            const paramName = param.slice(1, -1);
            // Check if paramName is a number (indicating an index in args)
            if (!isNaN(paramName)) {
                return args[paramName];
            }
            return scope[paramName] || context[paramName] || param;
        }
    }
    return param;
}

function replacePlaceholders(str, context) {
    if (typeof str === 'string') {
        return str.replace(/\{\{([^}]+)\}\}/g, (match, keyPath) => {
            const keys = keyPath.split('.');
            let value = keys.reduce((currentContext, key) => {
                return currentContext && currentContext[key] !== undefined ? currentContext[key] : undefined;
            }, context);

            if (typeof value === 'function') {
                return value;
            } else {
                if (value !== undefined) {
                    return value;
                } else {
                    return keyPath;
                }
            }
        });
    }
    return str;
}

async function applyMethodChain(target, action, context, res, req, next) {
    let result = target;

    function processParam(param) {
        if (typeof param === 'string') {
            if (param.startsWith('{{') && param.endsWith('}}')) {
                const key = param.slice(2, -2);
                const value = context[key];
                if (typeof value === 'function') {
                    return value;
                }
                if (value !== undefined) {
                    return value;
                } else {
                    return key;
                }
            }
            return param;
        } else if (Array.isArray(param)) {
            return param.map(item => processParam(item));
        } else if (typeof param === 'object' && param !== null) {
            const processedParam = {};
            for (const [key, value] of Object.entries(param)) {
                processedParam[key] = processParam(value);
            }
            return processedParam;
        } else {
            return param;
        }
    }

    function instantiateWithNew(constructor, args) {
        return new constructor(...args);
    }

    if (action.method) {
        console.log("action.method ==================================")
        let params;

        if (action.params) {
            params = action.params.map(param => {
                if (typeof param === 'string'){
                        param = replacePlaceholders(param, context)
                }
                return processParam(param);
            });
        } else {
            params = [];
        }
        if (action.new) {
            result = instantiateWithNew(result, params);
        } else {
            console.log(typeof result);
            console.log(result)
            result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : null;
            console.log("result", result)
        }
    }

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return;
            }
            let chainParams;

            if (chainAction.params) {
                chainParams = chainAction.params.map(param => {
                    if (typeof param === 'string'){
                        if (!param.startsWith("{{")){
                            param = replacePlaceholders(param, context)
                        }
                    }
                    return processParam(param);
                });
            } else {
                chainParams = [];
            }

            if (chainAction.new) {
                result = instantiateWithNew(result[chainAction.method], chainParams);
            } else if (typeof result[chainAction.method] === 'function') {
                console.log("chainAction.method",chainAction.method)
                console.log("chainParams",chainParams)
                if (chainAction.method === 'promise') {
                    result = await result.promise();
                } else {
                    if (chainAction.new) {
                        result = new result[chainAction.method](...chainParams);
                    } else {
                        if (chainAction.method && chainAction.method.length != 0){
                            if (chainAction.method.startsWith('{{') && chainAction.method.endsWith('}}')) {
                                const methodName = chainAction.method.slice(2, -2);
                                const methodFunction = context[methodName];
                                if (typeof methodFunction === 'function') {
                                    if (chainAction.express){
                                        result = methodFunction(...chainParams)(req, res, next);
                                    } else {
                                        result = methodFunction(...chainParams);
                                    }
                                } else {
                                    console.error(`Method ${methodName} is not a function in context`);
                                    return;
                                }
                            } else {
                                if (chainAction.express){
                                    result = result[chainAction.method](...chainParams)(req, res, next);
                                } else {
                                    result = result[chainAction.method](...chainParams);
                                }
                            }
                        }
                    }
                }
            } else {
                console.error(`Method ${chainAction.method} is not a function on ${action.module}`);
                return;
            }
        }
    }

    return result;
}

async function processConfig(config, initialContext) {
    const context = { ...initialContext };
    for (const [key, value] of Object.entries(config.modules)) {
            let newPath = await downloadAndPrepareModule(value, context);
    }
    return context;
}

async function downloadAndPrepareModule(moduleName, context) {
    const modulePath = `/tmp/node_modules/${moduleName}`;
    if (!local.fs.existsSync(modulePath)) {
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
    local.fs.mkdirSync(modulePath, { recursive: true });
    const directory = await local.unzipper.Open.buffer(zipBuffer);
    await directory.extract({ path: modulePath });
}

module.exports = local.dyRouter;