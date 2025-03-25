var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default;

function normalizeVector(vector) {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / norm);
}

router.get('/', async function(req, res, next) {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const response = await openai.embeddings.create({
            input: "/event/wedding/attire/bride/accessories/veil/embellishments/floral-appliqué/colors/ivory",
            model: "text-embedding-3-large",
        });

        const embedding = response.data[0].embedding;
        const normalizedEmbedding = normalizeVector(embedding);

        res.render('embeddings', {
            category: "/event/wedding/attire/bride/accessories/veil/embellishments/floral-appliqué/colors/ivory",
            embedding: JSON.stringify(embedding),
            normalized: JSON.stringify(normalizedEmbedding),
        });
    } catch (error) {
        console.error("Error generating embeddings:", error);
        res.status(500).send("Failed to generate embeddings.");
    }
});

module.exports = router;