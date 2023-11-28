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
        "fs": "fs"
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
        }
    ]
}

router.get('/', async function(req, res, next) {
    let context = await processConfig(json);
    await initializeModules(context, json);
    res.json(context);
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
        }
    });
}

function isNativeModule(moduleName) {
    const nativeModules = ['fs'];
    return nativeModules.includes(moduleName);
}

function replacePlaceholders(str, context) {
    return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        return context[key] || match;
    });
}

function applyMethodChain(target, action, context) {
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
    }

    if (action.chain && result) {
        action.chain.forEach(chainAction => {
            if (result && typeof result[chainAction.method] === 'function') {
                result = result[chainAction.method](...(chainAction.params || []));
            } else {
                console.error(`Method ${chainAction.method} is not a function on ${action.module}`);
                return;
            }
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

module.exports = router;
