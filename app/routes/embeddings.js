var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Fitness: Trainer, Routine, Equipment, Health, Diet, Weight Loss, Weight Gain, Yoga, Martial Arts, Sports, Meditation, Mindfulness, Stress Management, Supplements, Meal Plans, Superfoods", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "fitness", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;