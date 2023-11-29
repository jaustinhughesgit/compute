const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
global.dyRouter = express.Router();
const path = require('path');
const unzipper = require('unzipper');
const session = require('express-session');

global.s3 = new AWS.S3();

global.dyRouter.use(session({
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
                {"method":"initialize", "params":[]}
            ],
            "assignTo":"passportInit"
        },
        {
            "module":"dyRouter",
            "chain":[
                {"method":"use", "params":["{{passportInit}}"]}
            ],
            "assignTo":"dyInit"
        },
        {
            "module":"passport",
            "chain":[
                {"method":"session", "params":[]}
            ],
            "assignTo":"passportSession"
        },
        {
            "module":"dyRouter",
            "chain":[
                {"method":"use", "params":["{{passportSession}}"]}
            ],
            "assignTo":"dySession"
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
                {"method":"use", "params":["microsoft", "{{microsoftStrategy}}"]}
            ],
            "assignTo":"something1"
        },
        {
            "module":"passport",
            "chain":[
                {"method":"authenticate", "params":["{{strategy}}"]}
            ],
            "callback":["{req}","{res}","{next}"],
            "assignTo":"something2"
        }
    ]
}

global.dyRouter.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    await initializeModules(context, json, req, res, next);
    res.json(context);
});

global.dyRouter.all('/*', async function(req, res, next) {
    let context = await processConfig(json);
    context["strategy"] = req.path.startsWith('/auth') ? req.path.split("/")[2] : "";
    await initializeModules(context, json, req, res, next);
    res.json(context);
});

async function processConfig(config) {
    const context = {};
    for (const [key, value] of Object.entries(config.modules)) {
            let newPath = await downloadAndPrepareModule(value, context);
    }
    return context;
}

async function initializeModules(context, config, req, res, next) {
    require('module').Module._initPaths();
    for (const action of config.actions) {

        console.log("1",!action.module)
        console.log("2",action.assignTo)
        console.log("3",action.params)
        console.log("4",action.chain)
        if (!action.module && action.assignTo && action.params && action.chain) {
            // Create the function and assign it to the context
            context[action.assignTo] = createFunctionFromAction(action, context, req, res, next);
            console.log("context",context)
            continue; // Skip the rest of the loop for this action
        }


        let moduleInstance 
        if (action.module) {
            moduleInstance = global[action.module] ? global[action.module] : require(action.module);
        }



        let result;
        if (typeof moduleInstance === 'function') {
            console.log("action",action)
            if (action.valueFrom) {
                result = moduleInstance(context[action.valueFrom]);
            } else {
                console.log("moduleInstance",moduleInstance)
                result = moduleInstance(?????); //<<<<<
            }
        } else {
            result = moduleInstance;
        }
        result = await applyMethodChain(result, action, context);
        if (action.assignTo) {
            context[action.assignTo] = result;
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
                const chainParams = chainAction.params.map(param => {
                    return replaceParams(param, context, scope, args);
                });

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
        const value = context[key];
        return typeof value !== 'undefined' ? value : match;
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

module.exports = global.dyRouter;