
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
        "passport":"passport",
        "passport-microsoft":"passport-microsoft"
    },
    "actions": [
        {
            "module":"passport",
            "chain":[
            ],
            "assignTo":"passport"
        },
        {
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
                },(token, tokenSecret, profile, done) => {
                    done(null, profile);
                }
               ], "new":true}
            ],
            "assignTo":"passportmicrosoft"
        }/*,
        {
            "module":"passport",
            "chain":[
                {"method":"use", "params":[
                    "microsoft", "{{passportmicrosoft}}!"
                ]}
            ],
            "assignTo":"newStrategy"
        }*/
    ]
}


local.dyRouter.all('/*', async function(req, res, next) {
    let context = await processConfig(json);
    context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
    context["callback"] = (token, tokenSecret, profile, done) => {
        done(null, profile);
    }
    context["strategyConfig"] = {
        "clientID": process.env.MICROSOFT_CLIENT_ID,
        "clientSecret": process.env.MICROSOFT_CLIENT_SECRET,
        "callbackURL": "https://compute.1var.com/auth/microsoft/callback",
        "resource": "https://graph.microsoft.com/",
        "tenant": process.env.MICROSOFT_TENANT_ID,
        "prompt": "login",
        "state": false,
        "type": "Web",
        "scope": ["user.read"]
    }
    await initializeModules(context, json, req, res, next); 
    console.log(context.passportmicrosoft);
    context.passport.use(context.passportmicrosoft);
        context.passport.authenticate("microsoft")(req, res, next);
});


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

function testFunction(){
    return "hello world"
}

function newFunction(val){
return val + "!"
}


async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
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
            let result = createFunctionFromAction(action, context, req, res, next);
            if (action.assignTo.includes('{{')) {
                let isFunctionExecution = action.assignTo.endsWith('!');
                let assignKey = isFunctionExecution ? action.assignTo.slice(2, -3) : action.assignTo.slice(2, -2);
                
                if (isFunctionExecution) {
                    // Execute the function and assign its return value
                    context[assignKey] = result();
                } else {
                    // Assign the function itself
                    context[assignKey] = result;
                }
            } else {
                // Assign the function or result directly
                context[action.assignTo] = result;
            }
            continue;
        }

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
        console.log(">action", action)
        console.log(">result", JSON.stringify(result));
        console.log(">context",context)
        result = await applyMethodChain(result, action, context);
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
                if ('return' in chainAction) {
                    return replaceParams(chainAction.return, context, scope, args);
                }

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
        return result;
    };
}


function replaceParams(param, context, scope, args) {
    if (typeof param === 'string') {
        if (param.startsWith('{') && param.endsWith('}')) {
            const paramName = param.slice(1, -1);
            if (!isNaN(paramName)) {
                return args[parseInt(paramName, 10)];
            }
            return scope[paramName] || context[paramName] || param;
        }
        return param;
    } else if (Array.isArray(param)) {
        return param.map(item => replaceParams(item, context, scope, args));
    } else if (typeof param === 'object' && param !== null) {
        const processedParam = {};
        for (const [key, value] of Object.entries(param)) {
            processedParam[key] = replaceParams(value, context, scope, args);
        }
        return processedParam;
    } else {
        return param;
    }
}

function replacePlaceholders(str, context) {
    console.log("1",str,context)
    if (typeof str === 'string') {
        console.log("2", str, "=== string")
        return str.replace(/\{\{([^}]+)\}\}(!?)/g, (match, key, isFunctionExecution) => {
            console.log("3", key)
            console.log("4", match)
            console.log("5",isFunctionExecution)
            let value = context[key];
            console.log("6", value)
            console.log(typeof value)
            if (isFunctionExecution === '!' && typeof value === 'function') {
                console.log("7", value())
                return value();
            }
            console.log("8",value)
            console.log("9",key)
            return value !== undefined ? value : key;
        });
    }
    console.log("10", str)
    return str;
}

async function applyMethodChain(target, action, context) {
    let result = target;

    function processParam(param) {
        console.log("->param", param)
        if (typeof param === 'string') {
            console.log("param is a string returning replacePlaceholders")
            return replacePlaceholders(param, context);
        } else if (Array.isArray(param)) {
            console.log("param is an array")
            return param.map(item => processParam(item));
        } else if (typeof param === 'object' && param !== null) {
            console.log("param is an object")
            const processedParam = {};
            for (const [key, value] of Object.entries(param)) {
                console.log("for", param)
                console.log("->value",value)
                processedParam[key] = processParam(value);
            }
            return processedParam;
        } else {
            console.log("param is something else ")
            console.log(typeof param)
            return param;
        }
    }

    function instantiateWithNew(constructor, args) {
        return new constructor(...args);
    }

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return; // Directly return the value specified in 'return'
            }
            console.log(chainAction.params);
            const chainParams = chainAction.params ? chainAction.params.map(param => processParam(param)) : [];
            if (chainAction.new) {
                // Instantiate with 'new' if specified
                if (typeof result[chainAction.method] === 'function') {
                    // Instantiate with 'new' if specified
                    result = instantiateWithNew(result[chainAction.method], chainParams);
                } else {
                    console.error(`Method ${chainAction.method} is not a constructor function on ${action.module}`);
                    return;
                }
            } else if (typeof result[chainAction.method] === 'function') {
                result = chainAction.method === 'promise' ? await result.promise() : result[chainAction.method](...chainParams);
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