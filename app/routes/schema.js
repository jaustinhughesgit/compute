var express = require('express');
var router = express.Router();
var OpenAI = require("openai");
var { zodResponseFormat } = require("openai/helpers/zod");
var { z } = require("zod");

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    // Zod schema for the UI response
    const UI = z.object({
        type: z.enum(["div", "button", "header", "section", "field", "form"]),
    });

    try {
        // Make a request to OpenAI's API
        const completion = await openai.beta.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
                {
                    role: "system",
                    content: `You pick types at random from the following options: "div", "button", "header", "section", "field", "form".
Respond with a JSON object containing a single field "type" set to one of these options.
For example: {"type": "div"}`,
                },
                { role: "user", content: "Give me a type." },
            ],
            // Ensures the response conforms to the provided Zod schema
            response_format: zodResponseFormat(UI, "ui"),
        });

        // Extract the parsed result from the response
        const ui = completion.choices[0].message.parsed;

        // Render the result
        res.render('schema', {
            title: 'Schema',
            message: JSON.stringify(ui)
        });
    } catch (error) {
        next(error);
    }
});


module.exports = router;
