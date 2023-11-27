const AWS = require('aws-sdk');
const fs = require('fs');
var express = require('express');
var router = express.Router();
const path = require('path');
const unzipper = require('unzipper');

const s3 = new AWS.S3();

const json = {
    "modules": {
        "express": "express"
    },
    "targets": {
        "router": "router"
    },
    "actions": [
        {
            "target": "router",
            "chain": [
                {
                    "method": "get",
                    "params": [
                        "/test",
                        {
                            "target": "res",
                            "chain": [
                                { "method": "render", "params": ["dynode2", { title: 'Dynode', result: "test" }] }
                            ]
                        }
                    ]
                }
            ]
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

    // Dynamically load modules specified in the config
    for (const [key, value] of Object.entries(config.modules)) {
        if (!isNativeModule(value)) {
            let newPath = await downloadAndPrepareModule(value, context);
            console.log(newPath);
        } else {
            // For native modules, require them directly
            context[key] = require(value);
        }
    }

    // Include other targets in the context
    if (config.targets) {
        for (const [key, value] of Object.entries(config.targets)) {
            // Here you can add logic to initialize or set up targets
            // For now, just assigning a placeholder object
            context[key] = {}; // Placeholder, replace with actual initialization if needed
        }
    }

    return context;
}

async function initializeModules(context, config) {
    require('module').Module._initPaths();

    config.actions.forEach(action => {
        processAction(action, context);
    });
}

function processAction(action, context) {
    let target;

    if (action.module) {
        target = require(action.module);
        if (action.module === 'moment') {
            target = target(); // Initialize moment if needed
        }
    }

    // If the action specifies a target, use it from the context
    if (action.target) {
        target = context[action.target];
    }

    let result = applyMethodChain(target, action, context);

    if (action.assignTo) {
        context[action.assignTo] = result;
    }
}

function isNativeModule(moduleName) {
    const nativeModules = ['express'];
    return nativeModules.includes(moduleName);
}

function applyMethodChain(target, action, context) {
    let result = target;

    // Apply the main method if specified
    if (action.method) {
        result = applyMethod(result, action, context);
    }

    // Process nested chain actions
    if (action.chain) {
        action.chain.forEach(chainAction => {
            result = applyMethodChain(result, chainAction, context);
        });
    }

    return result;
}

function applyMethod(target, action, context) {
    if (!target || typeof target[action.method] !== 'function') {
        console.error(`Method ${action.method} is not a function on ${action.module || action.target}`);
        return;
    }

    // Prepare parameters, resolving any targets specified within them
    let params = action.params ? action.params.map(param => {
        if (param && typeof param === 'object' && param.target) {
            return context[param.target];
        }
        return param;
    }) : [];

    return target[action.method](...params);
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
