var express = require('express');
var router = express.Router();
const { OpenAIApi } = require("openai");

router.get('/', async function(req, res, next) {
    const openai = new OpenAIApi({
        apiKey: process.env.OPENAI_API_KEY, // Set your API key in environment variables
    });

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