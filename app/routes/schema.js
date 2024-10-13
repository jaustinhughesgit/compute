var express = require('express');
var router = express.Router();
var OpenAI = require("openai");
var { zodResponseFormat } = require("openai/helpers/zod");
var { z } = require("zod");

router.get('/', async function(req, res, next) {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });



    const ModesSchema = z.object({
        mode1: z.union([z.string(), z.array(z.string()), z.object({})]),
      }).catchall(z.union([z.string(), z.array(z.string()), z.object({})]));
      
      const AssignmentsSchema = z.object({
        _editable: z.boolean(), 
        _movement: z.enum(['move', 'copy']), 
        _owners: z.array(z.string()),  
        _modes: ModesSchema,           
        _mode: z.string(),              
      });
      
      const RowsSchema = z.object({
        divs: z.array(z.string()), 
      }).catchall(z.object({}));
      
      const ColumnsSchema = z.object({
        rows: z.object({
          "1": RowsSchema,
          "2": RowsSchema,
          "3": RowsSchema
        }).catchall(RowsSchema)
      }).catchall(z.object({}));
      
      const TemplatesSchema = z.object({
        "1": ColumnsSchema,
        "2": ColumnsSchema,
        "3": ColumnsSchema
      }).catchall(ColumnsSchema);
      
      const ActionSchema = z.lazy(() =>
        z.object({
          if: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
          while: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
          set: z.object({}).catchall(z.string()).optional(),
          target: z.string().optional(),
          chain: z.array(
            z.object({
              access: z.string(),
              params: z.array(z.string()),
              new: z.boolean().optional(),
              express: z.boolean().optional(),
            })
          ).optional(),
          nestedActions: z.array(ActionSchema).optional(),
          next: z.boolean().optional(),
          express: z.boolean().optional(),
        })
      );
      
      const CommandSchema = z.object({
        call: z.string(),
        ready: z.boolean(),
        updateSpeechAt: z.boolean(),
        timeOut: z.number(),
      });
      
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
      
      const MenuSchema = z.object({
        _name: z.string(),
        _classes: z.array(z.string()),
        _show: z.boolean(),
        _selected: z.boolean(),
      }).catchall(z.lazy(() => z.object({})));
      
      const FunctionSchema = z.object({
        parameters: z.array(z.string()),
        body: z.array(z.string()),
      });
      
      const AutomationSchema = z.array(z.object({
        _delay: z.string(),
        _speak: z.string(),
        command: z.array(z.string()),
      }));
      
      const UI = z.object({
        blocks: z.array(z.object({
          entity: z.string(),
          align: z.string(),
          subs: z.boolean().optional(),
          name: z.string().optional(),
        })),
        modules: z.object({}).catchall(z.string()),  
        actions: z.array(ActionSchema),
        commands: z.object({}).catchall(CommandSchema),
        calls: z.object({}).catchall(z.array(CallSchema)),
        menu: z.object({}).catchall(MenuSchema),
        functions: z.object({}).catchall(FunctionSchema),
        automation: AutomationSchema,
        templates: TemplatesSchema,
        assignments: z.object({}).catchall(AssignmentsSchema),
      });

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
