var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Food: Chinese, American, Italian, Indian, Vietnamese, Vegan, Gluten-Free, Organic, Recipes, Cooking Classes, Culinary Techniques, Street Food, Fine Dining, Food Festivals", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "food", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;