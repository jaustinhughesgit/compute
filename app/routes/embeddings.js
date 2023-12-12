var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Offerings: Products, Services, Cars, Trucks, Games, Skateboards, Clothes, Computers, Devices, Monitors, Books, Furniture, SaaS, E-books, Online Courses, Digital Art, Beauty Products, Fitness Gear, Home Decor, Travel Packages, Adventure Sports, Culinary Tours", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "offerings", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;