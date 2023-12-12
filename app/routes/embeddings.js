var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Knowledge: Science, Chemistry, Biology, Mathematics, History, Cosmology, AI, Robotics, Software Development, Climate Change, Biodiversity, Sustainability, Moral Philosophy, Political Theory, Logic", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "Knowledge", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;