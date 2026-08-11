/**
 * Platform: Developer demonstration of vector lookup; it is not the platform's canonical lexical/entity search contract.
 * Technical: Express GET route that embeds one fixed query, searches one Pinecone namespace, and renders the result.
 */
var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default;
const { Pinecone } = require('@pinecone-database/pinecone');

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const embedding = await openai.embeddings.create({
        input: "/sports/football", model: "text-embedding-ada-002",
    });
    const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY
    });

    console.log(embedding.data[0].embedding)
    try {
        const index = await pinecone.index('categories').namespace('categories').query({ topK: 100, vector: embedding.data[0].embedding})

        res.render('pinecone', {
            title: 'Pinecone',
            message: JSON.stringify(index)
        });
    } catch (error) {
        res.render('error', {
            message: 'Failed to connect to Pinecone',
            error: error
        });
    }
});

module.exports = router;
