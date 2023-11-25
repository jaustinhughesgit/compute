const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
var router = express.Router();
const path = require('path');
const unzipper = require('unzipper'); // You need to install this package

const s3 = new AWS.S3();

const json = {
    "modules": {
        "moment": "moment",
        "moment-timezone": "moment-timezone",
        "fs": "fs",
        "path": "path",
        "unzipper": "unzipper",
        "aws-sdk": "aws-sdk",
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
            "reinitialize": true, // Indicates to reinitialize the moment object
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
            "method": "readFile",
            "params": ["example.txt", "utf8"],
            "assignTo": "fileContents",
            "callback": true // Indicates that this method uses a callback
        }
    ]
}



router.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    await initializeModules(context, json);
    res.render('dynode2', { title: 'Dynode', result: JSON.stringify(context) });
});

async function processConfig(config) {
    const context = {};

    // Load modules
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

    // Require modules
    for (const [key, value] of Object.entries(config.modules)) {
        context[key] = require(value); // Assuming the module is now in node_modules
        console.log(context[key]);
    }

    // Apply actions
    config.actions.forEach(action => {
        if (action.module) {
            let result = action.valueFrom ? context[action.valueFrom] : context[action.module]();
            if (action.reinitialize && context[action.module]) {
                // Reinitialize the module object if required
                result = context[action.module](result);
            }
            result = applyMethodChain(result, action, context);
            if (action.assignTo) {
                context[action.assignTo] = result;
            }
        }
        // Additional actions like 'if' can be added here
    });
}

function isNativeModule(moduleName) {
    // List of Node.js native modules
    const nativeModules = ['fs', 'path', 'aws-sdk', 'express', 'unzipper'];
    return nativeModules.includes(moduleName);
}

function applyMethodChain(target, action, context) {
    let result = target;

    // If there's an initial method to call on the module, do it first
    if (action.method && result) {
        if (action.callback) {
            // Handle callback pattern
            result[action.method](...action.params, (err, data) => {
                if (err) {
                    console.error(`Error in method ${action.method}:`, err);
                    return;
                }
                context[action.assignTo] = data;
            });
        } else {
            // Handle promise or direct return
            result = result[action.method](...(action.params || []));
        }
    }

    // Then apply any additional methods in the chain
    if (action.chain && result) {
        action.chain.forEach(chainAction => {
            if (typeof result[chainAction.method] === 'function') {
                result = result[chainAction.method](...(chainAction.params || []));
            } else {
                // Reapply the module if the result is not a function
                // This is a risky operation and might not always work as expected
                if (context[action.module]) {
                    result = context[action.module](result);
                    if (typeof result[chainAction.method] === 'function') {
                        result = result[chainAction.method](...(chainAction.params || []));
                    } else {
                        console.error(`Method ${chainAction.method} is not a function on the result`);
                        return;
                    }
                } else {
                    console.error(`Module ${action.module} not found in context`);
                    return;
                }
            }
        });
    }

    return result;
}

async function downloadAndPrepareModule(moduleName, context) {
    const modulePath = `/tmp/node_modules/${moduleName}`;
    if (!fs.existsSync(modulePath)) {
        // The module is not in the cache, download it
        await downloadAndUnzipModuleFromS3(moduleName, modulePath);
    }
    // Add the module to the NODE_PATH
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}:${modulePath}` : modulePath;
    return modulePath; // Return the module path
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
