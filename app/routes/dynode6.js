const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
global.dyRouter = express.Router();
const path = require('path');
const unzipper = require('unzipper');

global.s3 = new AWS.S3();

const json = {
    "modules": {
        "moment": "moment",
        "moment-timezone": "moment-timezone",
        "passport":"passport",
        "passport-microsoft":"passport-microsoft"
    },
    "actions": [
        {
            "module": "moment",
            "chain": [
                { "method": "tz", "params": ["Asia/Dubai"] },
                { "method": "format", "params": ["YYYY-MM-DD HH:mm:ss"] }
            ],
            "assignTo": "timeInDubai"
        },
        {
            "params":["{accessToken}", "{refreshToken}", "{profile}", "{done}"], 
            "chain":[
                {"method":"{done}", "params":[null, "{profile}"], "new":true}
            ],
            "assignTo":"callbackFunction"
        },
        {
            "module":"passport-microsoft",
            "chain":[
                {"method":"Strategy", "params":[
                    {
                        clientID: process.env.MICROSOFT_CLIENT_ID,
                        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
                        callbackURL: "https://compute.1var.com/auth/microsoft/callback",
                        resource: 'https://graph.microsoft.com/',
                        tenant: process.env.MICROSOFT_TENANT_ID,
                        prompt: 'login',
                        state: false,
                        type: 'Web',
                        scope: ['user.read']
                    },
                    "{{callbackFunction}}"
                ]}
            ],
            "assignTo":"microsoftStrategy"
        },
        {
            "module":"passport",
            "chain":[
                {"method":"use", "params":["{{microsoftStrategy}}"]}
            ]
        },
        {
            "module":"passport",
            "chain":[
                {"method":"authenticate", "params":["{{strategy}}"]}
            ],
            "callback":["{req}","{res}","{next}"]
        }
    ]
}

dyRouter.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    await initializeModules(context, json);
    res.json(context);
});

dyRouter.all('/*', async function(req, res, next) {
    let context = await processConfig(json);
    // /auth/microsoft
    context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
    await initializeModules(context, json);
    res.json(context);
});

async function processConfig(config) {
    const context = {};
    for (const [key, value] of Object.entries(config.modules)) {
            let newPath = await downloadAndPrepareModule(value, context);
    }
    return context;
}

async function initializeModules(context, config) {
    require('module').Module._initPaths();
    for (const action of config.actions) {
        let moduleInstance;

        if (action.module) {
            // If module is specified, use it
            moduleInstance = global[action.module] ? global[action.module] : require(action.module);
        } else if (action.assignTo && action.params) {
            // If no module but assignTo and params are specified, create a function
            moduleInstance = createFunctionFromAction(action, context);
        }

        let result = typeof moduleInstance === 'function' ? (action.valueFrom ? moduleInstance(context[action.valueFrom]) : moduleInstance()) : moduleInstance;
        result = await applyMethodChain(result, action, context);

        if (action.assignTo) {
            context[action.assignTo] = result;
        }
    }
}

function createFunctionFromAction(action, context) {
    return function(...args) {
        let result;

        if (action.chain) {
            for (const chainAction of action.chain) {
                const chainParams = chainAction.params.map(param => {
                    // Replace placeholders with actual arguments from context or args
                    return replaceParams(param, context, args);
                });

                // Handle special case where method is a callback
                if (chainAction.method.startsWith('{') && chainAction.method.endsWith('}')) {
                    const methodName = chainAction.method.slice(1, -1);
                    if (typeof context[methodName] === 'function') {
                        result = context[methodName](...chainParams);
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
        return result;
    };
}

function replaceParams(param, context, args) {
    if (param) {
        if (param.startsWith('{') && param.endsWith('}')) {
            const paramName = param.slice(1, -1);
            // Check if paramName is a number (indicating an index in args)
            if (!isNaN(paramName)) {
                return args[paramName];
            }
            return context[paramName] || args[paramName] || param;
        }
    }
    return param;
}

function replacePlaceholders(str, context) {
    if (str){
        return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
            return context[key] || match;
        });
    } else {
        return str
    }
}

function replaceLocalParams(str, localParams) {
    if (str){
        return str.replace(/\{([^}]+)\}/g, (match, key) => {
            return localParams[key] || match;
        });
    } else {
        return str
    }
}

async function applyMethodChain(target, action, context) {
    let result = target;
    if (action.method) {
        let params = action.params ? action.params.map(param => typeof param === 'string' ? replacePlaceholders(param, context) : param) : [];
        result = typeof result === 'function' ? result(...params) : result && typeof result[action.method] === 'function' ? result[action.method](...params) : null;
    }
    if (action.chain && result) {
        for (const chainAction of action.chain) {
            let chainParams = chainAction.params?.map(param => {
                if (typeof param === 'string') {
                    return replacePlaceholders(param, context);
                }
                return param; // Keep non-string params as-is
            }) || [];
            // Check if this chain action is for creating a callback function
            if (!action.module && action.params && action.assignTo) {
                const callbackFunction = createFunctionFromAction(action, context);
                context[action.assignTo] = callbackFunction;
                continue; // Skip further processing for this chain action
            }

            // Replace placeholders for callback functions in parameters
            chainParams = chainParams.map(param => {
                if (typeof param === 'string' && param.startsWith('{{') && param.endsWith('}}')) {
                    const callbackName = param.slice(2, -2);
                    return context[callbackName];
                }
                return param;
            });

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

function createGenericCallback(callbackActions, context) {
    return function(...args) {
        let localParams = {};
        args.forEach((arg, index) => {
            localParams[`{${index}}`] = arg;
        });

        let result;
        for (const callbackAction of callbackActions) {
            const callbackParams = callbackAction.params?.map(param => {
                // Replace global placeholders
                param = typeof param === 'string' ? replacePlaceholders(param, context) : param;
                // Replace local placeholders
                return replaceLocalParams(param, localParams);
            }) || [];

            if (result && typeof result[callbackAction.method] === 'function') {
                result = result[callbackAction.method](...callbackParams);
            } else if (typeof global[callbackAction.method] === 'function') {
                // If the method is a global function, call it directly
                result = global[callbackAction.method](...callbackParams);
            } else {
                console.error(`Callback method ${callbackAction.method} is not a function`);
                return;
            }
        }
        return result;
    };
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
        const data = await s3.getObject(params).promise();
        await unzipModule(data.Body, modulePath);
    } catch (error) {
        console.error(`Error downloading and unzipping module ${moduleName}:`, error);
        throw error;
    }
}

async function unzipModule(zipBuffer, modulePath) {
    fs.mkdirSync(modulePath, { recursive: true });
    const directory = await unzipper.Open.buffer(zipBuffer);
    await directory.extract({ path: modulePath });
}

module.exports = dyRouter;