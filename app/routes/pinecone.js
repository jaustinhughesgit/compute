var express = require('express');
var router = express.Router();
const pinecone = require('@pinecone-database/pinecone');

router.get('/', async function(req, res, next) {

    // Pinecone configuration
    const apiKey = process.env.PINECONE_API_KEY; // Ensure this is set in your environment
    const indexName = 'categories'; // Replace with your actual Pinecone index name

    // Set the API key for Pinecone
    pinecone.configuration.apiKey = apiKey;

    try {
        // Connect to your Pinecone index
        const index = pinecone.index(indexName);

        // Perform operations with your index
        // Example: const queryResult = await index.query(yourQuery);

        // Render your view with Pinecone data
        res.render('pinecone', {
            title: 'Pinecone',
            message: 'Connected to Pinecone successfully!'
            //, queryResult: queryResult
        });
    } catch (error) {
        // Handle any errors
        res.render('error', {
            message: 'Failed to connect to Pinecone',
            error: error
        });
    }
});

module.exports = router;
