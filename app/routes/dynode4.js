const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
const path = require('path');
const unzipper = require('unzipper');
let context = {};
var router = express.Router();
context = { router }; // Add the router to the context

const s3 = new AWS.S3();


async function initialize() {

const json = {
    "modules": {
        "moment": "moment",
        "moment-timezone": "moment-timezone",
        "fs": "fs",
        "express":"express"
    },
    "actions": [
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
            "target":"router",
            "chain":[
                {"method":"get", "params":["/test", "=>testHandler"]}
            ]
        }
    ]
}
async function setupRoutes() {
    const newContext = await processConfig(json);
    Object.assign(context, newContext);
    await initializeModules(context, json);

    router.get('/', async function(req, res, next) {
        res.render('dynode2', { title: 'Dynode', result: JSON.stringify(context) });
    });
}
setupRoutes().catch(console.error);



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

    for (const action of config.actions) {
        if (action.module) {
            let moduleInstance = require(action.module);

            let result = typeof moduleInstance === 'function' 
                ? (action.valueFrom ? moduleInstance(context[action.valueFrom]) : moduleInstance())
                : moduleInstance;

            result = await applyMethodChain(result, action, context);
            if (action.assignTo) {
                context[action.assignTo] = result;
            }
        } else if (action.params && action.actions) {
            // Handling the creation of a handler function
            context[action.assignTo] = async (...args) => {
                for (const innerAction of action.actions) {
                    let target = args.find(arg => arg.constructor.name === innerAction.module);
                    await applyMethodChain(target, innerAction, context);
                }
            };
        } else if (action.target) {
            // Handling the router action
            let target = global[action.target] || context[action.target];
            if (target) {
                await applyMethodChain(target, action, context);
            } else {
                console.error(`Target ${action.target} not found`);
            }
        }
    }
}

function isNativeModule(moduleName) {
    const nativeModules = ['express'];
    return nativeModules.includes(moduleName);
}

async function applyMethodChain(target, action, context) {
    let result = target;

    if (action.method) {
        if (typeof result === 'function') {
            result = action.callback 
                ? handleCallbackMethod(result, action, context) 
                : result[action.method](...(action.params || []));
        } else if (result && typeof result[action.method] === 'function') {
            result = action.callback 
                ? handleCallbackMethod(result[action.method], action, context) 
                : result[action.method](...(action.params || []));
        } else {
            console.error(`Method ${action.method} is not a function on ${action.module}`);
            return;
        }
        if (result instanceof Promise) {
            result = await result;
        }
    }

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            // Replace '=>' references with actual functions from context
            const params = chainAction.params.map(param => 
                typeof param === 'string' && param.startsWith('=>') 
                    ? context[param.slice(2)] 
                    : param
            );

            if (typeof result[chainAction.method] === 'function') {
                result = result[chainAction.method](...params);

                // Await the result if it's a promise
                if (result instanceof Promise) {
                    result = await result;
                }
            } else {
                console.error(`Method ${chainAction.method} is not a function on ${action.module}`);
                return;
            }
        }
    }

    if (action.params) {
        action.params = action.params.map(param => {
            if (param.startsWith('=>')) {
                return context[param.slice(2)];
            }
            return param;
        });
    }

    return result;
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

}

module.exports = router;
module.exports.initialize = initialize;