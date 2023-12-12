var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Economics, Food logistics, Plants, Reports, GDP, Financials, Agricultural, Economical, Technology, Energy, Manufacturing, Bull Market, Bear Market, IPOs, Renewable Energy, Conservation, Eco-friendly Practices", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "economics", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;