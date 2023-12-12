var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "File Downloads: Files, Documents, pdf, zip, pictures, Music, Videos, E-books, Open Source, Freeware, Demos, Online Courses, Tutorials, Academic Papers", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "downloads", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;