const AWS = require('aws-sdk');
const fs = require('fs');
const express = require('express');
const router = express.Router();
const path = require('path');

const s3 = new AWS.S3();

router.get('/', async function(req, res, next) {
    try {
        // Example: Download and load the 'debug' module
        await downloadAndPrepareModule('debug');
        const debug = require('debug')('myapp');
        debug('Debug module is working!');
        res.render('s3modules', { title: 's3 modules', message: 'Debug module loaded successfully!' });
    } catch (error) {
        console.error('Error:', error);
        res.render('s3modules', { title: 's3 modules', error: 'Failed to load module.' });
    }
});

async function downloadAndPrepareModule(moduleName) {
    const modulePath = `/tmp/node_modules/${moduleName}`;
    if (!fs.existsSync(modulePath)) {
        // The module is not in the cache, download it
        await downloadModuleFromS3(moduleName, modulePath);
    }
    // Add the module to the NODE_PATH
    process.env.NODE_PATH = `/tmp/node_modules`;
    require('module').Module._initPaths();
}

async function downloadModuleFromS3(moduleName, modulePath) {
    const params = {
        Bucket: "1var-node-modules",
        Key: `node_modules/${moduleName}`,
        // If your modules are stored in a nested structure, adjust the Key accordingly
    };
    console.log(params)
    try {
        const data = await s3.getObject(params).promise();
        fs.mkdirSync(path.dirname(modulePath), { recursive: true });
        fs.writeFileSync(modulePath, data.Body);
    } catch (error) {
        console.error(`Error downloading module ${moduleName}:`, error);
        throw error;
    }
}

module.exports = router;