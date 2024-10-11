var express = require('express');
var router = express.Router();
var OpenAI = require("openai");
var { zodResponseFormat } = require("openai/helpers/zod");
var { z } = require("zod");

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });


  const ActionSchema = z.object({
    set: z.enum(["hand", "foot", "mouth", "arm", "head", "knee"])
  });

    // Zod schema for the UI response
    const UI = z.object({
        type: z.enum(["jinga", "zelda", "puzzles", "jump rope", "hocky", "video"]),
        options: z.array(ActionSchema).optional()
    });




    try {
        const completion = await openai.beta.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
                {
                    role: "system",
                    content: `You create choose types and groups of options`,
                },
                { role: "user", content: "Choose a type and build options." }
            ],
            response_format: zodResponseFormat(UI, "ui")
        });

        const ui = completion.choices[0].message.parsed;
        console.log(ui)

        res.render('schema', {
            title: 'Schema',
            message: JSON.stringify(ui)
        });
    } catch (error) {
        next(error);
    }
});


module.exports = router;
