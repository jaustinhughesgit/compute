var express = require('express');
var router = express.Router();
var OpenAI = require("openai");
var { zodResponseFormat } = require("openai/helpers/zod");
var { z } = require("zod");

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });


// Define suggestions for modules but allow any string as well
const ModuleSuggestions = z.union([
    z.enum(["moment-timezone", "ge", "mathjs"]), // Suggested values
    z.string() // Allows any other string
  ]);
  
  // Define the schema for dynamic _modes object
  const ModesSchema = z.object({
    mode1: z.union([z.string(), z.array(z.string()), z.object({})]), // Can be a string, an array of strings, or an object
  }).catchall(z.union([z.string(), z.array(z.string()), z.object({})]));
  
  // Define the schema for the assignments with dynamic keys
  const AssignmentsSchema = z.object({
    _editable: z.boolean(),         // Boolean indicating if it's editable
    _movement: z.enum(['move', 'copy']), // "move" or "copy"
    _owners: z.array(z.string()),   // Array of owners
    _modes: ModesSchema,            // Dynamic modes with various types
    _mode: z.string(),              // One of the modes from _modes
  });
  
  // Define the schema for rows with "divs" as an array of strings
  const RowsSchema = z.object({
    divs: z.array(z.string()),  // Array of divs in each row
  }).catchall(z.object({}));
  
  // Define the schema for columns, where each column has rows
  const ColumnsSchema = z.object({
    rows: z.object({
      "1": RowsSchema,
      "2": RowsSchema,
      "3": RowsSchema
    }).catchall(RowsSchema) // Rows are dynamic
  }).catchall(z.object({}));
  
  // Define the schema for templates with dynamic keys (columns with rows and divs)
  const TemplatesSchema = z.object({
    "1": ColumnsSchema,
    "2": ColumnsSchema,
    "3": ColumnsSchema
  }).catchall(ColumnsSchema); // Dynamic columns
  
  // Define the schema for actions
  const ActionSchema = z.object({
    if: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
    while: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
    set: z.object({}).catchall(z.string()).optional(), // Updated set as a key-value structure
    target: z.string().optional(),
    chain: z.array(z.object({
      access: z.string(),
      params: z.array(z.string()),
      new: z.boolean().optional(),
      express: z.boolean().optional(),
    })).optional(),
    actions: z.lazy(() => z.array(z.object({}))).optional(),
    next: z.boolean().optional(),
    express: z.boolean().optional(),
  });
  
  // Define the schema for commands with known keys
  const CommandSchema = z.object({
    call: z.string(),
    ready: z.boolean(),
    updateSpeechAt: z.boolean(),
    timeOut: z.number(),
  });
  
  // Define the calls schema
  const CallSchema = z.object({
    if: z.array(z.object({
      key: z.array(z.string()),
      expression: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })),
    then: z.array(z.string()),
    show: z.array(z.string()),
    run: z.array(z.object({
      function: z.string(),
      args: z.array(z.union([z.string(), z.number()])),
      custom: z.boolean().optional(),
    })),
  });
  
  // Define the menu schema with dynamic menu settings
  const MenuSchema = z.object({
    _name: z.string(),
    _classes: z.array(z.string()),
    _show: z.boolean(),
    _selected: z.boolean(),
  }).catchall(z.lazy(() => z.object({})));
  
  // Define the functions schema with parameters and body
  const FunctionSchema = z.object({
    parameters: z.array(z.string()),
    body: z.array(z.string()),
  });
  
  // Define the automation schema with fields like _delay, _speak, and command
  const AutomationSchema = z.array(z.object({
    _delay: z.string(),
    _speak: z.string(),
    command: z.array(z.string()),
  }));
  
  // Define the full main schema
  const UI = z.object({
    blocks: z.array(z.object({
      entity: z.string(),
      align: z.string(),
      subs: z.boolean().optional(),
      name: z.string().optional(),
    })),
    modules: z.object({}).catchall(ModuleSuggestions),  // Modules allow suggested or custom values
    actions: z.array(ActionSchema), // Use the updated ActionSchema
    commands: z.object({}).catchall(CommandSchema), // Commands with dynamic structure
    calls: z.object({}).catchall(z.array(CallSchema)), // Calls with dynamic structure
    menu: z.object({}).catchall(MenuSchema),  // Menu with dynamic keys
    functions: z.object({}).catchall(FunctionSchema),  // Functions with dynamic keys
    automation: AutomationSchema, // Automation array
    templates: TemplatesSchema,  // Templates structure with dynamic columns and rows
    assignments: z.object({}).catchall(AssignmentsSchema), // Dynamic assignments with modes and movement
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
