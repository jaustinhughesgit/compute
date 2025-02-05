var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "<div><input id=\"name\">", model: "text-embedding-3-small",
    });
    res.render('embeddings', { category: "cricket", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;