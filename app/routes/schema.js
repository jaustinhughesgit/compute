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
    if: z.array(z.array(z.union([z.string(), z.number()]))).optional(), // "if" is optional
    while: z.array(z.array(z.union([z.string(), z.number()]))).optional(), // "while" is optional
    set: z.record(z.string(), z.string()).optional(), // "set" is optional
    target: z.string().optional(), // "target" is optional
    chain: z.array(z.object({
      access: z.string(),
      params: z.array(z.string()),
      new: z.boolean().optional(), // "new" is optional
      express: z.boolean().optional(), // "express" is optional
    })).optional(), // "chain" is optional
    actions: z.lazy(() => z.array(z.object({}))).optional(), // "actions" is optional
    next: z.boolean().optional(), // "next" is optional
    express: z.boolean().optional() // "express" is optional
  });

  // Define the full main schema, including the new "assignments" object
  const UI = z.object({
    blocks: z.array(z.object({
      entity: z.string(),
      align: z.string(),
      subs: z.boolean().optional(),
      name: z.string().optional(),
    })),
    modules: z.record(z.string()), // Dynamic keys in `modules`
    actions: z.array(ActionSchema), // Use the updated ActionSchema
    commands: z.record(z.object({
      call: z.string(),
      ready: z.boolean(),
      updateSpeechAt: z.boolean(),
      timeOut: z.number(),
    })),
    calls: z.record(z.array(z.object({
      if: z.array(z.object({
        key: z.array(z.string()),
        expression: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()])
      })),
      then: z.array(z.string()),
      show: z.array(z.string()),
      run: z.array(z.object({
        function: z.string(),
        args: z.array(z.union([z.string(), z.number()])),
        custom: z.boolean().optional()
      }))
    }))),
    menu: z.record(z.object({
      _name: z.string(),
      _classes: z.array(z.string()),
      _show: z.boolean(),
      _selected: z.boolean(),
    }).catchall(z.lazy(() => z.object({})))),
    functions: z.record(z.object({
      parameters: z.array(z.string()),
      body: z.array(z.string())
    })),
    automation: z.array(z.object({
      _delay: z.string(),
      _speak: z.string(),
      command: z.array(z.string())
    })),
    templates: z.record(z.object({
      rows: z.record(z.object({
        divs: z.array(z.string())
      }))
    })),
    assignments: z.record(z.object({
      _editable: z.boolean(),
      _movement: z.enum(['move', 'copy']),
      _owners: z.array(z.string()),
      _modes: z.record(z.union([z.string(), z.array(z.string()), z.object({})])),
      _mode: z.string()
    }))
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
