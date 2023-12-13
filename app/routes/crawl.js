var express = require('express');
var router = express.Router();
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { diff } = require('deep-object-diff'); // Ensure this package is installed

let changes = [];

// Function to crawl a website and track changes
async function crawlWebsite(url) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);

    const getPageState = async () => {
        const content = await page.content();
        const $ = cheerio.load(content);
        return $('body').html();
    };

    let initialState = await getPageState();

    const content = await page.content();
    const $ = cheerio.load(content);
    const forms = $('form');

    if (forms.length > 0) {
        for (let i = 0; i < forms.length; i++) {
            // Logic to fill and submit the form
            // ...

            let newState = await getPageState();
            let difference = diff(initialState, newState);

            if (Object.keys(difference).length > 0) {
                changes.push(difference);
            }

            initialState = newState;
        }
    }

    await browser.close();
}

router.get('/', async function(req, res, next) {
    const url = "https://www.nationalfirefighter.com/store/p/4261-TruGuard-300-FR-Work-Shirt.aspx";//req.query.url; // Assuming the URL is passed as a query parameter

    if (url) {
        await crawlWebsite(url);
    }

    res.render('crawl', { title: 'Crawl', content: JSON.stringify(changes) });
});

module.exports = router;