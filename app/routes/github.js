// routes/github.js
const express = require('express');
const router = express.Router();
const { Octokit } = require("@octokit/rest");
const AWS = require('aws-sdk');

router.get('/', async (req, res) => {
    const secretsManager = new AWS.SecretsManager();
    let secret;
    try {
        const data = await secretsManager.getSecretValue({ SecretId: 'public/1var/s3' }).promise();
        secret = JSON.parse(data.SecretString);
    } catch (err) {
        console.error("Error retrieving secret", err);
        return res.render('github', { error: "Error retrieving GitHub token." });
    }

    const octokit = new Octokit({ auth: secret.githubToken });

    try {
        await octokit.repos.createDispatchEvent({
            owner: 'jaustinhughesgit',
            repo: 'compute',
            event_type: 'install-npm-package',
            client_payload: { packageName: "moment-timezone" } 
        });

        res.render('github', { message: "GitHub Actions workflow triggered successfully.", error: null });
    } catch (error) {
        console.error("Error triggering GitHub Actions", error);
        res.render('github', { error: "Error triggering GitHub Actions.", message: null });
    }
});

module.exports = router;
