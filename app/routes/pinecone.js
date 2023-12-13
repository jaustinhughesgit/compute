var express = require('express');
var router = express.Router();
const Pinecone = require('@pinecone-database/pinecone');

// Pinecone configuration
const apiKey = process.env.PINECONE_API_KEY; // Ensure this is set in your environment
const indexName = 'categories'; // Replace with your actual Pinecone index name

// Initialize Pinecone client
const pineconeConfig = {
    apiKey: apiKey,
    environment: process.env.PINECONE_ENVIRONMENT // Replace with your Pinecone environment
};
const pineconeClient = new Pinecone(pineconeConfig);

router.get('/', async function(req, res, next) {
    try {
        // Connect to your Pinecone index
        const index = await pineconeClient.index(indexName);

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
