var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "characteristics, Family, Pets, Corporate, Celebrity, Founder, CEO, Introvert, Extrovert, Leader, Thinker, Manager, Director, Intern, Freelancer, Minimalist, Traveler, Philanthropist", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "characteristics", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;