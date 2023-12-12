var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Social Media, Posts, Blog, Articles, Newsletter, Gallery, Comments, Likes, Shares, Followers, Podcasts, Videos, Webinars, Influencer Collaborations, Endorsements",
        model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "social", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;