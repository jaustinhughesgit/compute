var express = require('express');
var router = express.Router();
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.get('/', async function(req, res, next) {
    try {
        const response = await openai.createEmbedding({
            model: "text-embedding-ada-002",
            input: "/animals/live/ocean"
        });

        console.log(response.data);
        res.render('embeddings', { embeddings: response.data });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error processing your request");
    }
});

module.exports = router;