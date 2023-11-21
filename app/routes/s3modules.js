const AWS = require('aws-sdk');
const fs = require('fs');
const express = require('express');
const router = express.Router();
const path = require('path');
const unzipper = require('unzipper'); // You need to install this package

const s3 = new AWS.S3();

router.get('/', async function(req, res, next) {
    try {
        // Example: Download and load the 'debug' module
        await downloadAndPrepareModule('debug');
        require('module').Module._initPaths();
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
        await downloadAndUnzipModuleFromS3(moduleName, modulePath);
    }
    // Add the module to the NODE_PATH
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}:${modulePath}` : modulePath;
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