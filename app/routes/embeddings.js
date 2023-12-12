var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Languages, Translation, English, Spanish, Chinese (Mandarin), Hindi, Arabic, Portuguese, Bengali, Russian, Japanese, Punjabi, German, Javanese, Wu (Shanghainese), Malay (including Indonesian), Telugu, Vietnamese, Korean, French, Turkish, Marathi, Tamil, Urdu, Persian, Italian, Gujarati, Polish, Ukrainian, Romanian, Dutch, Greek, Thai, Tagalog (Filipino), Czech, Serbian, Hungarian, Swedish, Danish, Finnish, Slovak, Norwegian, Bulgarian, Croatian, Lithuanian, Slovenian, Latvian, Estonian, Hebrew, Swahili, Armenian, Azerbaijani", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "language", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;