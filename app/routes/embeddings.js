var express = require('express');
var router = express.Router();
var OpenAI = require("openai").default; // Changed to CommonJS require

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const chatCompletion = await openai.embeddings.create({
        input: "Financial, Banking, Credit, Credit Report, Loans, Stocks, Trading, Investments, Financials, Budgeting, Savings, Retirement, Stock Market Trends, Economic Indicators, Analyst Reports, Cryptocurrencies, NFTs, Blockchain Technology", model: "text-embedding-ada-002",
    });
    res.render('embeddings', { category: "financial", embeddings: JSON.stringify(chatCompletion) });
});

module.exports = router;