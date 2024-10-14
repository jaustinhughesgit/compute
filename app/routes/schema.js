var express = require('express');
var router = express.Router();
var OpenAI = require("openai");
var { zodResponseFormat } = require("openai/helpers/zod");
var { z } = require("zod");

router.get('/', async function (req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });



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


      // Define the schema for actions
      const action1Schema2 = z.object({
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
        next: z.boolean().optional(),
        express: z.boolean().optional(),
      });

      // Define the schema for actions
      const action2Schema2 = z.object({
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
        next: z.boolean().optional(),
        express: z.boolean().optional(),
      });

      // Define the schema for actions
      const action1Schema = z.object({
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
        nestedActions: z.array(action1Schema2).optional(),
        next: z.boolean().optional(),
        express: z.boolean().optional(),
      });

      // Define the schema for actions
      const action2Schema = z.object({
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
        nestedActions: z.array(action2Schema2).optional(),
        next: z.boolean().optional(),
        express: z.boolean().optional(),
      });

      

      
      // Define the full main schema
      const MainSchema = z.object({
        blocks: z.array(z.object({
          entity: z.string(),
          align: z.string(),
          subs: z.boolean().optional(),
          name: z.string().optional(),
        })),
        modules: z.object({}).catchall(z.string()),  
        actions1: z.array(action1Schema),   
        actions2: z.array(action2Schema),
        actions3: z.array(z.object()),
        actions4: z.array(z.object()),
        commands: z.object({}).catchall(CommandSchema),
        calls: z.object({}).catchall(z.array(CallSchema)),
        menu: z.object({}).catchall(MenuSchema), 
        functions: z.object({}).catchall(FunctionSchema), 
        automation: AutomationSchema,
        templates: TemplatesSchema,
        assignments: z.object({}).catchall(AssignmentsSchema)
      });



    try {
        const completion = await openai.beta.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
                {
                    role: "system",
                    content: `You create a json programming language that nodejs express middleware. Each object in the array are middleware functions that continue to the next function or respoond to the user. It can be one middleware, or many. Here is an example: Create a microsoft oath login. { "blocks": [], "modules": { "passport": "passport", "passport-microsoft": "passport-microsoft" }, "actions1": [ { "target": "{|passport|}", "chain": [ { "access": "initialize", "params": [], "express": true, "next": true } ], "assign": "{|session|}!" } ], "actions2": [ { "target": "{|passport|}", "chain": [ { "access": "session", "params": [], "express": true, "next": true } ], "assign": "{|passportSession|}!" } ], "actions3": [ { "target": "{|passport|}", "chain": [ { "access": "initialize", "params": [], "express": true, "next": true } ], "assign": "session" }, { "target": "{|passport|}", "chain": [ { "access": "session", "params": [], "express": true, "next": true } ], "assign": "{|passportSession|}!" }, { "params": [ "{|user|}", "{|done|}" ], "chain": [], "run": [ { "target": "{|done|}", "params": [ null, "{|user|}" ], "assign": "serialized" } ], "assign": "{|serializeFunction|}!" }, { "target": "passport", "chain": [ { "access": "serializeUser", "params": [ "{|~/serializeFunction|}" ] } ], "assign": "{|serializeUser|}!" }, { "params": [ "{|obj|}", "{|done|}" ], "chain": [], "nestedActions": [ { "target": "{|done|}", "params": [ null, "{|obj|}" ], "assign": "{|deserialized|}!" } ], "assign": "{|deserializeFunction|}!" }, { "target": "{|passport|}", "chain": [ { "access": "deserializeUser", "params": [ "{|deserializeFunction|}" ] } ], "assign": "{|deserializeUser|}!" }, { "set": { "user": "" } }, { "params": [ "{|accessToken|}", "{|refreshToken|}", "{|profile|}", "{|done|}" ], "actions": [ { "target": "{|done|}", "params": [ null, "{|profile|}" ], "actions": [ { "set": { "{|~/user|}": "{|profile|}" } } ], "assign": "{|doneZo|}!" } ], "assign": "{|callbackFunction|}!" }, { "target": "passport-microsoft", "chain": [ { "access": "Strategy", "params": [ { "clientID": "123456-1234-1234-1234-123456", "clientSecret": "abcdefghijklmnop", "callbackURL": "https://1var.com/blank/1234567890", "scope": [ "user.read" ] }, "{|callbackFunction|}" ], "new": true } ], "assign": "{|passportmicrosoft|}!" }, { "target": "{|passport|}", "chain": [ { "access": "use", "params": [ "{|passportmicrosoft|}" ] } ], "assign": "{|newStrategy|}!" }, { "target": "{|passport|}", "chain": [ { "access": "authenticate", "params": [ "microsoft", { "scope": [ "user.read" ] } ], "express": true, "next": false } ], "assign": "{|newAuthentication|}!" }, { "target": "{|res|}", "chain": [ { "access": "send", "params": [ "FORWARDING TO MICROSOFT" ], "assign": "{|send|}!" } ] } ] }`,
                },
                { role: "user", content: "Create an app the uses moment-timezone to get the time in London." },
            ],
            response_format: zodResponseFormat(MainSchema, "MainSchema"),
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
