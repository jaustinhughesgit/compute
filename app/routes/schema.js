var express = require('express');
var router = express.Router();
var OpenAI = require("openai");
var { zodResponseFormat } = require("openai/helpers/zod");
var { z } = require("zod");

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });




// Define the schema for the dynamic _modes object
const ModesSchema = z.record(
    z.union([z.string(), z.array(z.string()), z.object({})]) // Can be a string, an array of strings, or an object
  );
  
  // Define the schema for the assignments with dynamic keys
  const AssignmentsSchema = z.record(z.object({
    _editable: z.boolean(),         // Boolean indicating if it's editable
    _movement: z.enum(['move', 'copy']), // "move" or "copy"
    _owners: z.array(z.string()),   // Array of owners
    _modes: ModesSchema,            // Dynamic modes with various types
    _mode: z.string(),              // One of the modes from _modes
  }));
  
  // Define the schema for rows with "divs" as an array of strings
  const RowsSchema = z.record(
    z.object({
      divs: z.array(z.string()),  // Array of divs in each row
    })
  );
  
  // Define the schema for columns, where each column has rows
  const ColumnsSchema = z.record(
    z.object({
      rows: RowsSchema,  // Each column contains rows, which in turn contain divs
    })
  );
  
  // Define the schema for templates with dynamic keys (columns with rows and divs)
  const TemplatesSchema = z.record(ColumnsSchema);
  
  const ActionSchema = z.object({
    set: z.record(z.string().optional(), z.string().optional()).optional(), 
    target: z.string().optional(), 
    chain: z.array(z.object({
      access: z.string().optional(),
      params: z.array(z.string().optional()).optional()
    })).optional(), 
  });

  // Define the full main schema, including the new "assignments" object
  const UI = z.object({

    modules: z.record(z.string().optional()).optional(), // Dynamic keys in `modules`
    actions: z.array(ActionSchema).optional(), // Use the updated ActionSchema
    
  });


    // Zod schema for the UI response
    /*const UI = z.object({
        type: z.enum(["jinga", "zelda", "puzzles", "jump rope", "hocky", "video"]),
    });*/




    try {
        const completion = await openai.beta.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
                {
                    role: "system",
                    content: `You create a json programming language that builds npm and express apps`,
                },
                { role: "user", content: "Create an app the uses moment-timezone to get the time in London." },
            ],
            response_format: zodResponseFormat(UI, "ui"),
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
