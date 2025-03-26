var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default;

function normalizeVector(vector) {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / norm);
}

//not updating 1

router.get('/', async function(req, res, next) {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const response = await openai.embeddings.create({
            input: `{
    "input": [
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/tuxedo",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shoes",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/socks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/belt-or-suspenders",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shirt",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/bowtie-or-tie",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/cufflinks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/pocket-square",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/jacket"
    ],
    "expecting": [
        "/event/wedding/people/groom/success/wedding-day/groomed-and-dressed"
    ],
    "performing": [
        "/event/wedding/people/groom/todo/wedding-day/attire/check-tux",
        "/event/wedding/people/groom/todo/wedding-day/attire/get-dressed"
    ]
}`,
            model: "text-embedding-3-large",
        });

        const embedding = response.data[0].embedding;
        const normalizedEmbedding = normalizeVector(embedding);

        res.render('embeddings', {
            category: `{
    "input": [
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/tuxedo",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shoes",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/socks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/belt-or-suspenders",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/shirt",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/bowtie-or-tie",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/cufflinks",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/pocket-square",
        "/event/wedding/people/groom/todo/wedding-day/gather-items/attire/jacket"
    ],
    "expecting": [
        "/event/wedding/people/groom/success/wedding-day/groomed-and-dressed"
    ],
    "performing": [
        "/event/wedding/people/groom/todo/wedding-day/attire/check-tux",
        "/event/wedding/people/groom/todo/wedding-day/attire/get-dressed"
    ]
}`,
            embedding: JSON.stringify(embedding),
            normalized: JSON.stringify(normalizedEmbedding),
        });
    } catch (error) {
        console.error("Error generating embeddings:", error);
        res.status(500).send("Failed to generate embeddings.");
    }
});

module.exports = router;