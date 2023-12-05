
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

/*

actions:
  - set
  - module
  - if
  - ifs
  - from
  - params
  - method
  - chain
  - run
  - assign
  - next
*/
const json = [
    {
       modules: {
            "passport": "passport"
        },
        actions: [
            {
                set:{"":true}
            },
            {
                params: ["{test}"],
                "chain":[
                    {"return":"{test}"}
                ],
                assign:"testing"
            },
            {
                params:[],
                chain:[
                    {method:"{{testing}}!", params:["123"]}
                ],
                assign:"run123"
            },
            {
                module:"console",
                chain:[
                    {method:"log", params:["{{run123}}"]}
                ],
                assign:"{{runNow}}!"
            },
            {
                "if":["{{urlpath}}","==","/hello"],
                module:"passport",
                chain:[],
                assign:"passport"
            },
            {
                "if":["{{urlpath}}","==","/hello"],
                module:"{{passport}}",
                chain:[
                    {method:"initialize", params:[]}
                ],
                assign:"passportInitialize"
            },
            {
                "if":["{{urlpath}}","==","/hello"],
                module:"dyRouter",
                chain:[
                    {method:"use", params:["{{passportInitialize}}"]}
                ],
                assign:"{{runDyRouterInit}}"
            },
            {
                "if":["{{urlpath}}","==","/hello"],
                module:"req",
                chain:[
                    {method:"isAuthenticated", params:[]}
                ],
                express:true,
                assign:"{{isAuth}}"
            },
            {
                "if":["{{urlpath}}","==","/hello"],
                module:"res",
                chain:[
                    {method:"json", params:["{{}}"]}
                ],
                assign:"{{getJson}}!"
            }
        ]
    }
]

/*const json = [
    {
       modules: {
            "moment-timezone": "moment-timezone"
        },
        actions: [
            {
                "medule":"req",
                "chain":[
                    {"method":"isAuthenticated", "params":[]}
                ],
                "assign":"{{newAuth}}!"
            },
            {
                "module":"console",
                "chain":[
                    {"method":"log", "params":["{{newAuth}}"]}
                ],
                "assign":"logAuth"
            },
            {
                "ifs":[["{{newAuth}}"],["{{urlpath}}","==","/hello"]],
                module:"res",
                chain:[
                    {method:"send", params:["{{newAuth}}"]}
                ],
                assign:"{{hello}}!"
            },
            {
                if:[10, [{ condition: '>', right: 5 },{ condition: '<', right: 20 }], null, "&&"],
                "set":{"condition1":true}
            },
            {
                if:[10, [{ condition: '>', right: 25 },{ condition: '<', right: 20 }], null, "&&"],
                "set":{"condition2":true}
            },
            {
                module: "moment-timezone",
                chain: [
                    { method: "tz", params: ["Asia/Dubai"] },
                    { method: "format", params: ["YYYY-MM-DD HH:mm:ss"] }
                ],
                assign: "timeInDubai"
            },
            {
                module: "moment-timezone",
                assign: "justTime",
                "from": ["{{timeInDubai}}!"],
                chain: [
                    { method: "format", params: ["HH:mm"] }
                ]
            },
            {
                module: "moment-timezone",
                assign: "timeInDubai2",
                "from": ["{{timeInDubai}}"],
                chain: [
                    { method: "add", params: [1, "hours"] },
                    { method: "format", params: ["YYYY-MM-DD HH:mm:ss"] }
                ]
            },
            {
                "next":true
            }
        ]
    },



    {
       modules: {
            "moment-timezone": "moment-timezone"
        },
        actions: [

            {
                module: "moment-timezone",
                assign: "justTime2",
                "from": ["{{timeInDubai2}}!"],
                chain: [
                    { method: "format", params: ["HH:mm"] }
                ]
            },
            {
                module: "fs",
                chain: [
                    {
                        method: "readFileSync",
                        params: ["/var/task/app/routes/../example.txt", "utf8"],
                    }
                ],
                assign: "fileContents"
            },
            {
                module: "fs",
                method: "writeFileSync",
                params: [local.path.join('/tmp', 'tempFile.txt'), "This {{timeInDubai}} is a test file content {{timeInDubai}}", 'utf8']
            },
            {
                module: "fs",
                chain: [
                    {
                        method: "readFileSync",
                        params: [local.path.join('/tmp', 'tempFile.txt'), "utf8"],
                    }
                ],
                assign: "tempFileContents"
            },
            {
                module: "s3",
                chain: [
                    {
                        method: "upload",
                        params: [{
                            "Bucket": "public.1var.com",
                            "Key": "tempFile.txt",
                            "Body": "{{testFunction}}"
                        }]
                    },
                    {
                        method: "promise",
                        params: []
                    }
                ],
                assign: "s3UploadResult"
            },
            {
                "next":true
            }
        ]
    },



    {
       modules: {
            "passport":"passport",
            "passport-microsoft":"passport-microsoft"
        },
        actions: [
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                module:"passport",
                chain:[
                ],
                assign:"passport"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                params:["{accessToken}", "{refreshToken}", "{profile}", "{done}"], 
                chain:[],
                "run":[
                    {method:"{done}", params:[null, "{profile}"]}
                ],
                assign:"callbackFunction"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                module:"passport-microsoft",
                chain:[
                {method:"Strategy", params:[
                    {
                        clientID: process.env.MICROSOFT_CLIENT_ID,
                        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
                        callbackURL: "https://compute.1var.com/auth/microsoft/callback",
                        resource: "https://graph.microsoft.com/",
                        tenant: process.env.MICROSOFT_TENANT_ID,
                        prompt: "login",
                        state: false,
                        type: "Web",
                        scope: ["user.read"]
                    },"{{callbackFunction}}"
                ],
                    "new":true}
                ],
                assign:"passportmicrosoft"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                module:"{{passport}}",
                chain:[
                    {method:"use", params:["{{passportmicrosoft}}"]}
                ],
                assign:"newStrategy"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                params:["{user}", "{done}"], 
                chain:[],
                "run":[
                    {method:"{done}", params:[null, "{user}"]}
                ],
                assign:"serializeFunction"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                module:"{{passport}}",
                chain:[
                    {method:"serializeUser", params:["{{serializeFunction}}"]}
                ],
                assign:"serializeUser"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                params:["{user}", "{done}"], 
                chain:[],
                "run":[
                    {method:"{done}", params:[null, "{user}"]}
                ],
                assign:"deserializeFunction"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                module:"{{passport}}",
                chain:[
                    {method:"deserializeUser", params:["{{deserializeFunction}}"]}
                ],
                assign:"deserializeUser"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                module:"{{passport}}",
                chain:[
                    {method:"initialize", params:[]}
                ],
                assign:"passportInitialize"
            },
            {
                module:"dyRouter",
                chain:[
                    {method:"use", params:["{{passportInitialize}}"]}
                ],
                assign:"{{runDyRouterInit}}"
            },
            {
                //"if":["{{urlpath}}","!=","/microsoft/callback"],
                module:"{{passport}}",
                chain:[
                    {method:"session", params:[]}
                ],
                assign:"passportSession"
            },
            {
                module:"dyRouter",
                chain:[
                    {method:"use", params:["{{passportSession}}"]}
                ],
                assign:"{{runDyRouterSession}}"
            },
            {
                //"ifs":[["{{urlpath}}","!=","/microsoft/callback"]],
                module:"{{passport}}",
                chain:[
                    {method:"authenticate", params:["microsoft"], express:true},
                ],
                assign:"newAuthentication"
            }
        ]
    },
    

    {
       modules: {
            "passport":"passport",
            "passport-microsoft":"passport-microsoft"
        },
        actions: [
            {
                //"ifs":[["{{urlpath}}","==","/microsoft/callback"]],
                module:"req",
                chain:[
                    {method:"isAuthenticated", params:[]}
                ],
                express:true,
                assign:"{{isAuth}}"
            },
            {
                "ifs":[["{{urlpath}}","==","/microsoft/callback"]],
                module:"res",
                chain:[
                    {method:"json", params:["{{}}"]}
                ],
                assign:"{{getJson}}!"
            },
            {
                "ifs":[["{{urlpath}}","==","/hello"]],
                module:"res",
                chain:[
                    {method:"send", params:["Hello World!"]}
                ],
                assign:"hello"
            }
        ]
    }
]
*/


let middlewareFunctions = json.map(stepConfig => {
    return async (req, res, next) => {
        local.req = req;
        local.res = res;
        local.console = console;
        local.context = await processConfig(stepConfig, local.context);
        local.context["urlpath"] = req.path
        local.context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
        await initializeModules(local.context, stepConfig, req, res, next);
    };
});

local.dyRouter.all('/*', ...middlewareFunctions);

function testFunction(){
    return "hello world"
}

function newFunction(val){
return val + "!"
}

/*local.dyRouter.get('/', async function(req, res, next) {
    let context = {};
    context["testFunction"] = testFunction;
    context["newFunction"] = newFunction;
    context = await processConfig(json, context);
    await initializeModules(context, json);
    context["testFunctionResult"] = testFunction();
    context["newFunctionResult"] = newFunction("test");
    context["customFunctionResult"] = context["customFunction"]("yoyo");
    res.json(context);
});*/

/*function condition(left, condition, right, context){
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
}*/

function condition(left, conditions, right, operator = "&&", context) {
    if (arguments.length === 1) {
        return !!left;
    }

    if (!Array.isArray(conditions)) {
        conditions = [{ condition: conditions, right: right }];
    }

    return conditions.reduce((result, cond) => {
        const currentResult = checkCondition(left, cond.condition, cond.right, context);
        if (operator === "&&") {
            return result && currentResult;
        } else if (operator === "||") {
            return result || currentResult;
        } else {
            throw new Error("Invalid operator");
        }
    }, operator === "&&");
}

function checkCondition(left, condition, right, context) {
    left = replacePlaceholders(left, context)
    right = replacePlaceholders(right, context)
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


async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {

        let runAction = true
        if (action.if) {
                runAction = condition(action.if[0],action.if[1],action.if[2], action.if[3], context)
        } else if (action.ifs) {
                for (const ifObject of action.ifs){
                    runAction = condition(ifObject[0],ifObject[1],ifObject[2], ifObject[3], context)
                    if (!runAction){
                        break;
                    }
                }
        }
        
        if (runAction){
            if (action.set){
                for (key in action.set){
                    context[key] = replacePlaceholders(action.set[key], context)
                }
            }

            if (action.module){
                let moduleInstance
                console.log("action",action)
                if (action.module.startsWith("{{")){
                    console.log("<-- context")
                    moduleInstance = context[action.module.replace("{{","").replace("}}","")]
                 } else if (local[action.module]){
                    console.log("<-- local")
                    moduleInstance = local[action.module]
                 } else {
                    console.log("<-- require")
                    moduleInstance = require(action.module);
                 }

                let args = [];
                if (action.from) {
                    args = action.from.map(item => {
                        let isFunctionExecution = item.endsWith('!');
                        let key = isFunctionExecution ? item.slice(2, -3) : item.slice(2, -2);
                        let value = context[key];
                
                        if (isFunctionExecution && typeof value === 'function') {
                            return value();
                        }
                        return value;
                    });
                }
                console.log("typeof moduleInstance", typeof moduleInstance)
                console.log("action.method", action.method)
                console.log("moduleInstance", moduleInstance)
                let result
                    if (typeof moduleInstance === 'function'){
                        console.log(args);
                        if (args.length == 0){
                            result = moduleInstance;
                        } else {
                            result = moduleInstance(...args)
                        }
                    } else {
                        result = moduleInstance;
                    }
                console.log("result", result);
                result = await applyMethodChain(result, action, context, res, req, next);
                if (action.assign) {
                    if (action.assign.includes('{{')) {
                        let isFunctionExecution = action.assign.endsWith('!');
                        let assignKey = isFunctionExecution ? action.assign.slice(2, -3) : action.assign.slice(2, -2);
                        
                        if (isFunctionExecution) {
                            context[assignKey] = typeof result === 'function' ? result() : result;
                        } else {
                            context[assignKey] = result;
                        }
                    } else {
                        console.log("moduleInstance", result)
                        context[action.assign] = result;
                    }
                }
            } else if (action.assign && action.params) {
                context[action.assign] = createFunctionFromAction(action, context, req, res, next)
                continue;
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

            if (action.next){
                next();
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
                    if (action.assign.includes('{{')) {
                        
                        ////////////////////
                        //goal is to pass a local value to the param directly instead of having to add another function to pass it.
                        ////////////////////


                    } else if (runAction.method.startsWith('{') && runAction.method.endsWith('}')) {
                        const methodName = runAction.method.slice(1, -1);
                        if (typeof scope[methodName] === 'function') {
                            result = scope[methodName](...runParams);
                        } else {
                            console.error(`Callback method ${methodName} is not a function`);
                            return;
                        }
                    } else {

                        ////////////////////
                        //static text added to param for function calling with params
                        // goal is to loop through the params and assign that value to a string param so that it can be called
                        ///////////////////
                        
                        
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
        if (str == "{{}}"){
            return context
        }
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
            if (param == "{{}}"){
                return context
            }
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
            result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : result[action.method] === 'object' ? result[action.method] : null;
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
                                        console.log("deep auth => ", req.isAuthenticated())
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