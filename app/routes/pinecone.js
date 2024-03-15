var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require
const { Pinecone } = require('@pinecone-database/pinecone');

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const embedding = await openai.embeddings.create({
        input: "/sports/football", model: "text-embedding-ada-002",
    });
    const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT,
    });

    console.log(embedding.data[0].embedding)
    try {
        // Connect to your Pinecone index
        //const social = await pinecone.index('categories').namespace('social').fetch(['1']);
        const index = await pinecone.index('categories').namespace('categories').query({ topK: 3, vector: embedding.data[0].embedding})

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
