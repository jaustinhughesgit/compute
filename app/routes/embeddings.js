var express = require('express');
var router = express.Router();

import OpenAI from "openai";



router.get('/', async function(req, res, next) {
	
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const chatCompletion = await openai.chat.completions.create({
    messages: [{ role: "user", content: "Say this is a test" }],
    model: "gpt-3.5-turbo",
});
	res.render('index', { embeddings: chatCompletion });
  });


module.exports = router;