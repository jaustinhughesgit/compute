const AWS = require('aws-sdk');
const { execSync } = require('child_process');
const fs = require('fs');
const express = require('express');
const router = express.Router();

const s3 = new AWS.S3();

router.get('/', async function(req, res, next){
    try {
        await downloadAndUnzipNodeModules('new_modules.zip'); // Replace with the correct key if needed
        const debug = require('debug')('myapp');
        debug('Debug module is working!');
        res.render('s3modules', {title: 's3 modules', message: 'Debug module loaded successfully!'});
    } catch (error) {
        console.error('Error:', error);
        res.render('s3modules', {title: 's3 modules', error: 'Failed to load module.'});
    }
});

async function downloadAndUnzipNodeModules(key) {
    const params = {
        Bucket: "1var-node-modules",
        Key: key,
    };

    // Download the zip file from S3
    const zipFile = await s3.getObject(params).promise();

    // Write the zip file to the /tmp directory
    fs.writeFileSync(`/tmp/${key}`, zipFile.Body);

    // Unzip the file
    execSync(`unzip -o /tmp/${key} -d /tmp/`, { stdio: 'inherit' });

    // Set NODE_PATH to use /tmp/node_modules
    process.env.NODE_PATH = '/tmp/node_modules';
    require('module').Module._initPaths();
}

module.exports = router;