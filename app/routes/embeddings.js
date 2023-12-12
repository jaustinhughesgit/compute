var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Software Games: Sports, Fighting, Strategy, Adventure, Puzzle, Simulation, Console, PC, Mobile, VR, Online Multiplayer, eSports, Gaming Communities", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "games", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;