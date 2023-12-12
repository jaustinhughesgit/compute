var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "About, Profile, Resume, Gallery, Icon, Company, First Name, Last Name, Description, Education, Work History, Clients, Employees, Departments, Awards, Certifications, Honors, Hobbies, Volunteering, Public Speaking, Ethnicity, Nationality, Cultural Influences, email, phone",
        model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "about", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;