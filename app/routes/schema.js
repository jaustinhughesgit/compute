var express = require('express');
var router = express.Router();
var OpenAI = require("openai");
var z = require("zod");

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    // Zod schema for the UI response
    const UISchema = z.object({
        type: z.enum(["div", "button", "header", "section", "field", "form"]),
    });

    try {
        // Make a request to OpenAI's API
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You pick types at random.",
                },
                { role: "user", content: "Give me a type" },
            ],
        });

        // Get the response content
        const responseText = completion.choices[0].message.content;

        console.log("responseText",  responseText)

        // Parse the response using Zod schema
        const parsedUI = UISchema.safeParse(JSON.parse(responseText));

        if (parsedUI.success) {
            // Render if the response matches the schema
            res.render('schema', {
                title: 'Schema',
                message: parsedUI.data,
            });
        } else {
            // If the validation fails, show an error
            res.render('schema', {
                title: 'Schema',
                message: "Invalid response format: " + parsedUI.error.message,
            });
        }
    } catch (error) {
        next(error);
    }
});

module.exports = router;
