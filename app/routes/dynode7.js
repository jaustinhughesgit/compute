const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
var router = express.Router();
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
            "module": "moment",
            "reinitialize": true,
            "assignTo": "justTime",
            "valueFrom": "timeInDubai",
            "chain": [
                { "method": "format", "params": ["HH:mm"] }
            ]
        },
        {
            "module": "moment",
            "reinitialize": true,
            "assignTo": "timeInDubai",
            "valueFrom": "timeInDubai",
            "chain": [
                { "method": "add", "params": [1, "hours"] },
                { "method": "format", "params": ["YYYY-MM-DD HH:mm:ss"] }
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
            "params": [path.join('/tmp', 'tempFile.txt'), "This is a test file content {{timeInDubai}}", 'utf8'],
            "assignTo": "fileWriteResult"
        },
        {
            "module": "fs",
            "chain": [
                {
                    "method": "readFileSync",
                    "params": [path.join('/tmp', 'tempFile.txt'), "utf8"],
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
                        "Body": "{{tempFileContents}}"
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
                {"method":"{done}", "params":[null, "{profile}"], "new":true}
            ],
            "assignTo":"callbackFunction"
        }
    ]
}

router.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    await initializeModules(context, json, req, res, next);
    res.json(context);
});

dyRouter.all('/*', async function(req, res, next) {
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
        let moduleInstance 
        if (action.module) {
            moduleInstance = global[action.module] ? global[action.module] : require(action.module);
        } else if (action.assignTo && action.params) {
            moduleInstance = createFunctionFromAction(action, context, req, res, next);
        }
        let result;
        if (typeof moduleInstance === 'function') {
            console.log("action",action)
            if (action.valueFrom) {
                result = moduleInstance(context[action.valueFrom]);
            } else {
                console.log("moduleInstance",moduleInstance)
                result = moduleInstance();
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

function createFunctionFromAction(action, context) {
    return function(...args) {
        let result;

        if (action.chain) {
            for (const chainAction of action.chain) {

                console.log("chainAction",chainAction)
                const chainParams = chainAction.params.map(param => {
                    return replaceParams(param, context, args);

                });
                console.log("chainParams",chainParams)
                console.log("result",result)
                console.log("chainAction.method",chainAction.method)
                if (chainAction.method.startsWith('{') && chainAction.method.endsWith('}')) {
                    const methodName = chainAction.method.slice(1, -1);
                    console.log("-----1", methodName)
                    console.log("-----2",context)
                    
                }
                
                
                
                
                /*if (chainAction.method.startsWith('{') && chainAction.method.endsWith('}')) {
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
                }*/
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

module.exports = router;