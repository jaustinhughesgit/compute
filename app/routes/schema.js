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
            model: "gpt-4-0613",
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
            message: ui
        });
    } catch (error) {
        next(error);
    }
});