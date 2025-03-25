var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "/event/wedding/people/groom/bachelor-party/itinerary/day-1/arrival/flight-info/individual-arrivals/best-man/arrival-time/4pm", model: "text-embedding-3-large",
    });
    res.render('embeddings', { category: "/event/wedding/people/groom/bachelor-party/itinerary/day-1/arrival/flight-info/individual-arrivals/best-man/arrival-time/4pm", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;