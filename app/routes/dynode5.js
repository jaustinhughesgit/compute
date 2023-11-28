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
            let newPath = await downloadAndPrepareModule(value, context);
    }
    return context;
}

async function initializeModules(context, config) {
    require('module').Module._initPaths();

    for (const action of config.actions) {
        let moduleInstance;

        if (global[action.module]) {
            moduleInstance = global[action.module];
        } else {
            moduleInstance = require(action.module);
        }

        let result = typeof moduleInstance === 'function' 
            ? (action.valueFrom ? moduleInstance(context[action.valueFrom]) : moduleInstance())
            : moduleInstance;

        result = await applyMethodChain(result, action, context);
        if (action.assignTo) {
            context[action.assignTo] = result;
        }
    }
}

function replacePlaceholders(str, context) {
    return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        return context[key] || match;
    });
}

async function applyMethodChain(target, action, context) {
    let result = target;

    const processAction = async (act, res) => {
        if (!act.method) return res;

        let params = act.params?.map(param => 
            typeof param === 'string' ? replacePlaceholders(param, context) : param
        ) || [];

        if (typeof res === 'function') {
            return res(...params);
        }

        if (res && typeof res[act.method] === 'function') {
            return act.method === 'promise' ? await res.promise() : res[act.method](...params);
        }

        console.error(`Method ${act.method} is not a function on ${action.module}`);
        return null;
    };

    result = await processAction(action, result);

    if (action.chain && result) {
        for (const chainAction of action.chain) {
            result = await processAction(chainAction, result);
            if (result === null) break;
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