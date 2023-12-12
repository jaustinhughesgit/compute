var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Digital: App, Game, SaaS, Software, AI, IoT, Cloud Computing, Design, Accessibility, Usability, Cybersecurity, Data Privacy, Encryption", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "digital", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;