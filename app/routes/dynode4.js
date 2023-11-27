const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
var router = express.Router();
const path = require('path');
const unzipper = require('unzipper');

const s3 = new AWS.S3();

const json = {
    "modules": {
        "moment": "moment",
        "moment-timezone": "moment-timezone",
        "fs": "fs",
        "express": "express"
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
            "module":"express",
            "chain":[
                {"method":"Router"},
            ],
            "assignTo":"dynodeRouter"
        },
        {
            "params":["req","res","next"],
            "actions":[
                {"module":"res", "chain":[
                    {"method":"send", "params":["Response from /dynode4/test"]}
                ]}
            ],
            "assignTo":"testHandler"
        },
        {
            "target":"dynodeRouter",
            "chain":[
                {"method":"get", "params":["/test", "testHandler"]}
            ]
        }
    ]
}


router.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    await initializeModules(context, json);
    res.render('dynode2', { title: 'Dynode', result: JSON.stringify(context) });
});


router.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    await initializeModules(context, json);
    res.render('dynode2', { title: 'Dynode', result: JSON.stringify(context) });
});

async function processConfig(config) {
    const context = {};
    for (const [key, value] of Object.entries(config.modules)) {
        if (!isNativeModule(value)) {
            let newPath = await downloadAndPrepareModule(value, context);
            console.log(newPath);
        }
    }
    return context;
}

async function initializeModules(context, config) {
    require('module').Module._initPaths();

    config.actions.forEach(action => {
        if (action.module) {
            let moduleInstance = require(action.module);
            let result = typeof moduleInstance === 'function' 
                ? (action.valueFrom ? moduleInstance(context[action.valueFrom]) : moduleInstance())
                : moduleInstance;

            result = applyMethodChain(result, action, context);
            if (action.assignTo) {
                context[action.assignTo] = result;
            }
        } else if (action.params && action.actions) {
            context[action.assignTo] = createDynamicFunction(action, context);
        }
    });

    // Integrate dynamic routers
    if (context.dynodeRouter) {
        router.use(context.dynodeRouter);
    }
}

function createDynamicFunction(action, context) {
    return (...args) => {
        let localContext = { ...context };
        // Map params to localContext for use in actions
        action.params.forEach((param, index) => {
            localContext[param] = args[index];
        });

        // Execute each action in the dynamic function
        action.actions.forEach(action => {
            if (action.module === 'res' && localContext.res) {
                // Special handling for Express response object
                applyMethodChain(localContext.res, action, localContext);
            } else if (context[action.module]) {
                // Handle other modules
                let result = applyMethodChain(context[action.module], action, localContext);
                if (action.assignTo) {
                    localContext[action.assignTo] = result;
                }
            }
        });
    };
}

function isNativeModule(moduleName) {
    const nativeModules = ['fs', 'express'];
    return nativeModules.includes(moduleName);
}

function applyMethodChain(target, action, context) {
    let result = target;

    if (action.method) {
        result = executeMethod(result, action, context);
    }

    if (action.chain) {
        action.chain.forEach(chainAction => {
            result = executeMethod(result, chainAction, context);
        });
    }

    return result;
}

function executeMethod(target, action, context) {
    if (typeof target === 'function') {
        // Direct function call
        return target(...resolveParams(action.params, context));
    } else if (target && typeof target[action.method] === 'function') {
        // Method call on an object
        return target[action.method](...resolveParams(action.params, context));
    } else {
        console.error(`Method ${action.method} is not a function on ${action.module}`);
    }
}

function resolveParams(params, context) {
    return (params || []).map(param => {
        if (typeof param === 'string' && context[param]) {
            return context[param];
        }
        return param;
    });
}

function handleCallbackMethod(method, action, context) {
    method(...action.params, (err, data) => {
        if (err) {
            console.error(`Error in method ${action.method}:`, err);
            return;
        }
        context[action.assignTo] = data;
    });
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
