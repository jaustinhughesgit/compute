var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "News: Positive, Negative, Local, National, Emergency, Family, Business, Technology, Sports, Entertainment, Science, Editorial, Opinion Pieces, Fact-Checking, International Affairs, Global Economy, World Politics", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "news", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;