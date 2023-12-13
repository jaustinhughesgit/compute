var express = require('express');
var router = express.Router();
import { Pinecone } from '@pinecone-database/pinecone';

router.get('/', async function(req, res, next) {

    const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT,
      });



    try {
        // Connect to your Pinecone index
        const index = await pinecone.index('categories').describeIndexStats()

        // Perform operations with your index
        // Example: const queryResult = await index.query(yourQuery);

        // Render your view with Pinecone data
        res.render('pinecone', {
            title: 'Pinecone',
            message: JSON.stringify(index)
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
