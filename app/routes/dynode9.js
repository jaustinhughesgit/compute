
var express = require('express');
let local = {};
local.AWS = require('aws-sdk');
local.dyRouter = express.Router();
local.path = require('path');
local.unzipper = require('unzipper');
local.fs = require('fs');

local.s3 = new local.AWS.S3();

const json = {
    "modules": {
        "moment-timezone": "moment-timezone"
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
                {"return":"Hi"}
            ],
            "assignTo":"customFunction"
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
    context["customFunctionResult"] = context["customFunction"]("yoyo"); //<<<<<
    res.json(context);
});


async function initializeModules(context, config) {
    require('module').Module._initPaths();
    for (const action of config.actions) {

        if (!action.module && action.assignTo && action.params && action.chain) {
            context[action.assignTo] = createFunctionFromAction(action, context);
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

function createFunctionFromAction(action, context) {
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
                // Check if chainAction.params is defined and is an array
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
    return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        let isFunctionExecution = str.endsWith('!');
        let value = context[key];
        if (isFunctionExecution && typeof value === 'function') {
            return value();
        }
        return value || match;
    });
}

async function applyMethodChain(target, action, context) {
    let result = target;

    // Helper function to process each parameter
    function processParam(param) {
        if (typeof param === 'string') {
            return replacePlaceholders(param, context);
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

    if (action.method) {
        let params = action.params ? action.params.map(param => processParam(param)) : [];
        result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : null;
    }

    if (action.chain && result) {
        for (const chainAction of action.chain) {

            if (chainAction.hasOwnProperty('return')) {
                return chainAction.return; // Directly return the value specified in 'return'
            }

            const chainParams = chainAction.params ? chainAction.params.map(param => processParam(param)) : [];
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