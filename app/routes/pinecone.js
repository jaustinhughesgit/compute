var express = require('express');
var router = express.Router();
const { Pinecone } = require('@pinecone-database/pinecone');

router.get('/', async function(req, res, next) {
    const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT,
    });

    try {
        // Connect to your Pinecone index
        const index = await pinecone.index('categories').query({
            vectorIds: ["1"],
            namespace: "social",
            includeValues: true // Set this to true to include the vector values in the response
        });
        //const index = await pinecone.index('categories').query({ topK: 3, vector: [ ]})

        // Render your view with Pinecone data
        res.render('pinecone', {
            title: 'Pinecone',
            message: JSON.stringify(index)
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
