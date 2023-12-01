
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
            "params": [local.path.join('/tmp', 'tempFile.txt'), "This is a test file content {{timeInDubai}}", 'utf8']
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
            "module":"passport",
            "chain":[
            ],
            "assignTo":"passport"
        },
        {
            "params":["{accessToken}", "{refreshToken}", "{profile}", "{done}"], 
            "chain":[],
            "run":[
                {"method":"{done}", "params":[null, "{profile}"]}
            ],
            "assignTo":"callbackFunction"
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
                },"{{callbackFunction}}"
               ]}
            ],
            "assignTo":"passportmicrosoft"
        },
        {
            "module":"passport",
            "chain":[
                {"method":"use", "params":["{{passportmicrosoft}}"]}
            ],
            "assignTo":"newStrategy"
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

local.dyRouter.all('/*', async function(req, res, next) {
    let context = await processConfig(json);
    context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
    
    await initializeModules(context, json, req, res, next);
        console.log("-------------------AFTER initializeModules---------------------")
 
        context.passport.authenticate("microsoft")(req, res, next); //<<<<<

    //res.json(context);
});


async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        if (action.execute) {
            const functionName = action.execute;
            if (typeof context[functionName] === 'function') {
                // Execute the function and continue to the next action
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

        // Process the chain of actions
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

        // Process the run actions
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
        return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
            let value = context[key];
            console.log("value", value)
            console.log(typeof value)
            if (typeof value === 'function') {
                console.log("function")
                return value;
            } else {
                console.log("not function")
                if (value !== undefined) {
                    console.log("value is not undefined")
                    return value;
                } else {
                    console.log("value is undefined")
                    return key;
                }
            }
        });
    }
    return str;
}

async function applyMethodChain(target, action, context) {
    let result = target;

    // Helper function to process each parameter
    function processParam(param) {
        if (typeof param === 'string') {
            console.log("param is string", param, context)
            // Check if the parameter is a function reference placeholder
            if (param.startsWith('{{') && param.endsWith('}}')) {
                console.log("param is {{")
                const key = param.slice(2, -2);
                console.log("key",key)
                console.log("context", context)
                const value = context[key];
                console.log("value?", value)
                console.log("param typeof vvvv")
                console.log(typeof value)
                if (typeof value === 'function') {
                    console.log("value >",value)
                    return value; // Return the function reference directly
                }
                console.log("default value returning")
                if (value !== undefined) {
                    console.log("value is not undefined")
                    return value;
                } else {
                    console.log("value is undefined")
                    return key;
                }
            }
            return param; // Return the string as is
        } else if (Array.isArray(param)) {
            console.log("param is array", param)
            return param.map(item => processParam(item));
        } else if (typeof param === 'object' && param !== null) {
            const processedParam = {};
            console.log("param is object", param)
            for (const [key, value] of Object.entries(param)) {
                console.log("processedParam value", value)
                processedParam[key] = processParam(value);
                console.log("processedParam value", processedParam[key])
                console.log("typeof", typeof processedParam[key])
            }
            console.log("processedParam >>", processedParam)
            return processedParam;
        } else {
            return param;
        }
    }

    function instantiateWithNew(constructor, args) {
        return new constructor(...args);
    }

    if (action.method) {
        let params = action.params ? action.params.map(param => processParam(param)) : [];
        if (action.new) {
            // Use 'new' to instantiate the class
            result = instantiateWithNew(result, params);
        } else {
            result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : null;
        }
    }

    if (action.chain && result) {
        console.log("action  --------->", action)
        console.log("action.chaini  --------->", action.chain)
        for (const chainAction of action.chain) {
            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return; // Directly return the value specified in 'return'
            }

            const chainParams = chainAction.params ? chainAction.params.map(param => processParam(param)) : [];
            console.log("result", result)
            console.log("chainAction", chainAction)
            try{
                console.log("trying typeof vvvvv")
                console.log(typeof result[chainAction.method])
            } catch (err){
                console.log("error", err)
            }
            if (chainAction.new) {
                // Instantiate with 'new' if specified
                console.log("new", chainAction.method)
                console.log("typeof", typeof result[chainAction.method])
                result = instantiateWithNew(result[chainAction.method], chainParams);
            } else if (typeof result[chainAction.method] === 'function') {
                console.log("not new", chainAction.method)
                console.log("typeof", typeof result[chainAction.method])
                if (chainAction.method == "use"){
                    console.log("method is use and testing new vvvvv")
                    console.log(chainParams)
                    console.log(result[chainAction.method])
                    console.log("context", context)
                    console.log("context.passportmicrosoft", context.passportmicrosoft)
                    result = result[chainAction.method](context.passportmicrosoft);
                } else {
                    console.log("method is not use")
                    console.log("chainAction.method", chainAction.method)
                    console.log("chainParams", chainParams)
                    console.log("context",context)
                    
                    if (chainAction.method === 'promise') {
                        result = await result.promise();
                    } else {
                        if (chainAction.method === 'Strategy') {
                            // Assuming chainParams[0] is the options object and chainParams[1] is the callback function
                            let options = chainParams[0];
                            let callbackFunction = chainParams[1]; // Ensure this is a function reference
                            console.log("typeof callbackFunction vvvvv")
                            console.log(typeof callbackFunction)
                            result = result[chainAction.method](options, callbackFunction);
                        } else {
                            // Existing handling for other methods
                            result = result[chainAction.method](...chainParams);
                        }
                    }
                }
                console.log("AFTER PASSING FUNCTION", result)
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