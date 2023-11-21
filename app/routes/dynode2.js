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
        "moment-timezone": "moment-timezone"
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
        }
    ]
}



router.get('/', async function(req, res, next) {
    let context = processConfig(json);
    res.render('dynode2', { title: 'Dynode', result: JSON.stringify(context) });
});

async function processConfig(config) {
    const context = {};

    // Load modules
    for (const [key, value] of Object.entries(config.modules)) {
        context[key] = await downloadAndPrepareModule(value);
        require('module').Module._initPaths();
        //require(value);
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

    return context;
}


function applyMethodChain(target, action, context) {
    let result = target;

    // If there's an initial method to call on the module, do it first
    if (action.method && result) {
        result = result[action.method](...(action.params || []));
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

async function downloadAndPrepareModule(moduleName) {
    const modulePath = `/tmp/node_modules/${moduleName}`;
    if (!fs.existsSync(modulePath)) {
        // The module is not in the cache, download it
        await downloadAndUnzipModuleFromS3(moduleName, modulePath);
    }
    // Add the module to the NODE_PATH
    return process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}:${modulePath}` : modulePath;
}

async function downloadAndUnzipModuleFromS3(moduleName, modulePath) {
    const zipKey = `node_modules/${moduleName}.zip`;
    const params = {
        Bucket: "1var-node-modules",
        Key: zipKey,
    };
    console.log(params)
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
    await unzipper.Open.buffer(zipBuffer)
        .then(d => d.extract({ path: modulePath }));
}

module.exports = router;
