
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
            "params":["{accessToken}", "{refreshToken}", "{profile}", "{done}"], 
            "chain":[
                {"method":"{done}", "params":[null, "{profile}"]}
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
    res.json(context);
});


async function initializeModules(context, config) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        if (action.module) {
            let moduleInstance = local[action.module] ? local[action.module] : require(action.module);

            let args = [];
            if (action.valueFrom) {
                args = action.valueFrom.map(item => {
                    let isFunctionExecution = item.endsWith('!');
                    let key = isFunctionExecution ? item.slice(2, -3) : item.slice(2, -2); // Adjusted for '!'
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
                    let assignKey = isFunctionExecution ? action.assignTo.slice(2, -3) : action.assignTo.slice(2, -2); // Adjusted for '!'
                    
                    if (isFunctionExecution) {
                        context[assignKey] = typeof result === 'function' ? result() : result;
                    } else {
                        context[assignKey] = result;
                    }
                } else {
                    context[action.assignTo] = result;
                }
            }
        } else {
            // Handling custom function
            if (action.params && action.chain) {
                const customFunction = async (...args) => {
                    let localContext = { ...context };
                    // Map params to localContext for use in chain
                    action.params.forEach((param, index) => {
                        const paramName = param.replace(/[{}]/g, '');
                        localContext[paramName] = args[index];
                    });

                    // Apply method chain
                    for (const chainAction of action.chain) {
                        const chainParams = chainAction.params ? chainAction.params.map(param => processParam(param, localContext)) : [];
                        const methodName = chainAction.method.replace(/[{}]/g, '');
                        if (typeof localContext[methodName] === 'function') {
                            localContext = await localContext[methodName](...chainParams);
                        } else {
                            console.error(`Method ${methodName} is not a function in custom action`);
                            return;
                        }
                    }
                    return localContext;
                };

                // Assign the custom function to context
                if (action.assignTo) {
                    context[action.assignTo] = customFunction;
                }
            }
        }
    }
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

function processParam(param, context) {
    if (typeof param === 'string') {
        // Check for local parameters (single curly brackets)
        if (param.startsWith('{') && param.endsWith('}')) {
            const isFunctionExecution = param.endsWith('}!');
            const key = isFunctionExecution ? param.slice(1, -2) : param.slice(1, -1);
            const value = context[key];

            if (isFunctionExecution && typeof value === 'function') {
                return value();
            }
            return value;
        }
        // Handle context parameters (double curly brackets)
        return replacePlaceholders(param, context);
    } else if (Array.isArray(param)) {
        return param.map(item => processParam(item, context));
    } else if (typeof param === 'object' && param !== null) {
        const processedParam = {};
        for (const [key, value] of Object.entries(param)) {
            processedParam[key] = processParam(value, context);
        }
        return processedParam;
    } else {
        return param;
    }
}

async function applyMethodChain(target, action, context) {
    let result = target;

    if (action.method) {
        let params = action.params ? action.params.map(param => processParam(param)) : [];
        result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : null;
    }

    if (action.chain && result) {
        for (const chainAction of action.chain) {
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