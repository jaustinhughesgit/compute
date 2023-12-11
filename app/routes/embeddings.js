var express = require('express');
var router = express.Router();
const { Configuration, OpenAIApi } = require("openai");


router.get('/', async function(req, res, next){
    const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY, // Set your API key in Lambda's environment variables
    });
    const openai = await new OpenAIApi(configuration);
    const response = await openai.createEmbedding({
        model: "text-embedding-ada-002", 
        input: "/animals/live/ocean" 
    });

    res.render('embeddings', {text:JSON.stringify(response.data)})





});


module.exports = router;