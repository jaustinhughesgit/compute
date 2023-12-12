var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Date, Events, Place, Time, Football, Baseball, Soccer, Party, Sale, Festivals, Concerts, Art Exhibitions, Conferences, Meetups, Workshops, Birthdays, Anniversaries, Graduations", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "events", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;