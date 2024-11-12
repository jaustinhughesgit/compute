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
    const actionSchema = z.lazy(() =>
        z.object({
            if: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
            while: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
            set: z.object({}).catchall(z.string()).optional(), // Updated set as a key-value structure
            target: z.string().optional(),
            chain: z.array(z.object({
                access: z.string(),
                params: z.array(z.string()),
                new: z.boolean().optional(),
                express: z.boolean().optional(),
            })),
            nestedActions: z.array(actionSchema).optional(),
            next: z.boolean().optional(),
            express: z.boolean().optional(),
        })
    );


    // Define the full main schema
    const MainSchema = z.object({
        blocks: z.array(z.object({
            entity: z.string(),
            align: z.string(),
            subs: z.boolean().optional(),
            name: z.string().optional(),
        })),
        modules: z.object({}).catchall(z.string()),
        actions: z.array(z.array(actionSchema)),
        commands: z.object({}).catchall(CommandSchema),
        calls: z.object({}).catchall(z.array(CallSchema)),
        menu: z.object({}).catchall(MenuSchema),
        functions: z.object({}).catchall(FunctionSchema),
        automation: AutomationSchema,
        templates: TemplatesSchema,
        assignments: z.object({}).catchall(AssignmentsSchema)
    });

    console.log("MainSchema", MainSchema)
    let zrf = zodResponseFormat(MainSchema, "MainSchema")
    console.log("zrf", JSON.stringify(zrf))


    //Make sure you populate the first object in actions with the entity id, or have it create one usnig a specific value.

    try {
        const completion = await openai.beta.chat.completions.parse({
            model: "gpt-4o-2024-08-06",
            messages: [
                {
                    role: "system",
                    content: `You create nodejs middleware logic using json. The express server is already setup. The user makes a request and provides an object and you update. It can be one middleware, or many. You are writing code that stores and executes targets; Here are some pre-created targets you don't need to create. targets:{"req":req,"res":res,"fs":fs,"axios":axios,"mathjs":mathjs,"JSON":JSON,"Buffer":Buffer,"util":util,"child_process":child_process,"path":path,"console":console}. Don't create logic that needs an API key unless I supply you with one. Else you need to create a page that gets an API key. Here is an example. USER => """Take the most recent email and send it to me. ReferenceLogic: [{"blocks": [{"entity": "1v4ra88b0eb9-95f0-4ac0-b7d2-bddb24ca19c4","width": "100","align": "center"}],"modules": {},"actions": [{"set": {"stripeJSON": {"headers": {"Authorization": "..."}},"gmailKey": {"service": "gmail","auth": {"user": "...","pass": "..."}}}},{"next": true}]}]  UpdatingLogic: [{"blocks": [{"entity": "1v4r644b6416-52a3-4383-b748-f3c8aa5fd9dc","width": "100","align": "center"}],"modules": {},"actions": [],"email": []}]""" RESPONOSE => """[{"blocks": [{"entity": "1v4r644b6416-52a3-4383-b748-f3c8aa5fd9dc","width": "100","align": "center"}],"modules": {},"actions": [{"target": "{|nodemailer|}","chain": [{"access": "createTransport","params": ["{|gmailKey|}"]}],"assign": "{|transporter|}!"},{"set": {"recentEmail": "{|email=>[0]|}","subject": "{|recentEmail=>subject|}","emailBody": {"from": "support@1var.com","to": "jaustinhughes@gmail.com","subject": "Testing","text": "Testing","html": ""},"emailHTML": "{|emailBody=>html|}","emailText": "{|emailBody=>text|}"}},{"set": {"emailHTML": "{|subject|}","emailText": "{|subject|}"}},{"target": "{|transporter|}","chain": [{"access": "sendMail","params": ["{|emailBody|}"]}],"assign": "{|send|}!"},{"target": "{|res|}","chain": [{"access": "send","params": ["Email Sent! <br> To: j...@gmail.com<br>Subject:{|emailBody=>subject|} <br> Body:{|emailBody=>text|}"]}],"assign": "{|showPage|}!"}]]}]""". Here is another example: USER => """get me the cnn rss feed and give me the top 6 articles. ReferenceLogic: [] UpdatingLogic: [{"blocks": [{"entity": "1v4r521f3e2f-97ac-48cd-a7c0-00115b1c2788","width": "100","align": "center"}],"modules": {},"actions": []}]""" RESPONOSE => """[{"blocks": [{"entity": "1v4r521f3e2f-97ac-48cd-a7c0-00115b1c2788","width": "100","align": "center"}],"modules": {"fast-xml-parser": "fast-xml-parser"},"actions": [{"target": "{|axios|}","chain": [{"access": "get","params": ["http://rss.cnn.com/rss/cnn_topstories.rss"],"new": true}],"assign": "{|response|}"},{"set": {"rss": "{|response=>data|}","options": {"ignoreAttributes": false,"attributeNamePrefix": "@_","allowBooleanAttributes": true,"parseAttributeValue": true,"processEntities": true}}},{"target": "{|fast-xml-parser|}","chain": [{"access": "XMLParser","params": ["{|options|}"],"new": true}],"assign": "{|parser|}!"},{"target": "{|parser|}","chain": [{"access": "parse","params": ["{|rss|}"]}],"assign": "{|jObj|}!"},{"set": {"html": "","channel": "{|jObj=>rss.channel|}"}},{"set": {"counter": 0,"limit": "{|={|~/channel=>item.length|}-1|}","fixedMax": 6}},{"target": "{|math|}","chain": [{"access": "number","params": ["{|limit|}"]}],"assign": "{|max|}!"},{"while": [["{|counter|}","<","{|fixedMax|}"]],"set": {"item": "{|channel=>item[{|~/counter|}]|}","img": "{|item=>media:group.media:content|}","image": "{|img=>[0]|}","~/html": "{|~/html|}<br><br><img src='{|image=>@_url|}' width='100%'/><a href='{|item=>link|}'>{|item=>title|}</a>","~/counter": "{|={|~/counter|}+1|}"}},{"target": "{|res|}","chain": [{"access": "send","params": ["{|html|}"]}],"assign": "{|send|}!"}]}]`,
                },
                { role: "user", content: `Create an app where i can enter a city name into a form and it tells me the current time in that city. ReferenceLogic:[]  UpdatingLogic: [{"blocks": [{"entity": "1v4r91c6267f-7d0f-403b-a654-075967f3b8e1","width": "100","align": "center"}],"modules": {},"actions": [],"email": []}]` },
        
            ],
            response_format:
            {
                "type": "json_schema",
                "json_schema": {

                    "name": "MainSchema",
                    "strict": false,
                    "schema": {
                        "$schema": "http://json-schema.org/draft-07/schema#",
                        "type": "object",
                        "properties": {
                            "blocks": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "entity": {
                                            "type": "string"
                                        },
                                        "align": {
                                            "type": "string"
                                        },
                                        "subs": {
                                            "type": "boolean"
                                        },
                                        "name": {
                                            "type": "string"
                                        }
                                    },
                                    "required": [
                                        "entity",
                                        "align",
                                        "subs",
                                        "name"
                                    ],
                                    "additionalProperties": false
                                }
                            },
                            "modules": {
                                "type": "object",
                                "properties": {},
                                "additionalProperties": {
                                    "type": "string"
                                }
                            },
                            "actions": {
                                "type": "array",
                                "items": {
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/$defs/action"
                                    }
                                }
                            },
                            "commands": {
                                "type": "object",
                                "properties": {},
                                "additionalProperties": {
                                    "type": "object",
                                    "properties": {
                                        "call": {
                                            "type": "string"
                                        },
                                        "ready": {
                                            "type": "boolean"
                                        },
                                        "updateSpeechAt": {
                                            "type": "boolean"
                                        },
                                        "timeOut": {
                                            "type": "number"
                                        }
                                    },
                                    "required": [
                                        "call",
                                        "ready",
                                        "updateSpeechAt",
                                        "timeOut"
                                    ],
                                    "additionalProperties": false
                                }
                            },
                            "calls": {
                                "type": "object",
                                "properties": {},
                                "additionalProperties": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "if": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "key": {
                                                            "type": "array",
                                                            "items": {
                                                                "type": "string"
                                                            }
                                                        },
                                                        "expression": {
                                                            "type": "string"
                                                        },
                                                        "value": {
                                                            "type": [
                                                                "string",
                                                                "number",
                                                                "boolean"
                                                            ]
                                                        }
                                                    },
                                                    "required": [
                                                        "key",
                                                        "expression",
                                                        "value"
                                                    ],
                                                    "additionalProperties": false
                                                }
                                            },
                                            "then": {
                                                "type": "array",
                                                "items": {
                                                    "type": "string"
                                                }
                                            },
                                            "show": {
                                                "type": "array",
                                                "items": {
                                                    "type": "string"
                                                }
                                            },
                                            "run": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "function": {
                                                            "type": "string"
                                                        },
                                                        "args": {
                                                            "type": "array",
                                                            "items": {
                                                                "type": [
                                                                    "string",
                                                                    "number"
                                                                ]
                                                            }
                                                        },
                                                        "custom": {
                                                            "type": "boolean"
                                                        }
                                                    },
                                                    "required": [
                                                        "function",
                                                        "args",
                                                        "custom"
                                                    ],
                                                    "additionalProperties": false
                                                }
                                            }
                                        },
                                        "required": [
                                            "if",
                                            "then",
                                            "show",
                                            "run"
                                        ],
                                        "additionalProperties": false
                                    }
                                }
                            },
                            "menu": {
                                "type": "object",
                                "additionalProperties": {
                                    "$ref": "#/$defs/menuItem"
                                }
                            },
                            "functions": {
                                "type": "object",
                                "properties": {},
                                "additionalProperties": {
                                    "type": "object",
                                    "properties": {
                                        "parameters": {
                                            "type": "array",
                                            "items": {
                                                "type": "string"
                                            }
                                        },
                                        "body": {
                                            "type": "array",
                                            "items": {
                                                "type": "string"
                                            }
                                        }
                                    },
                                    "required": [
                                        "parameters",
                                        "body"
                                    ],
                                    "additionalProperties": false
                                }
                            },
                            "automation": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "_delay": {
                                            "type": "string"
                                        },
                                        "_speak": {
                                            "type": "string"
                                        },
                                        "command": {
                                            "type": "array",
                                            "items": {
                                                "type": "string"
                                            }
                                        }
                                    },
                                    "required": [
                                        "_delay",
                                        "_speak",
                                        "command"
                                    ],
                                    "additionalProperties": false
                                }
                            },
                            "templates": {
                                "type": "object",
                                "properties": {
                                    "1": {
                                        "type": "object",
                                        "properties": {
                                            "rows": {
                                                "type": "object",
                                                "properties": {
                                                    "1": {
                                                        "type": "object",
                                                        "properties": {
                                                            "divs": {
                                                                "type": "array",
                                                                "items": {
                                                                    "type": "string"
                                                                }
                                                            }
                                                        },
                                                        "required": [
                                                            "divs"
                                                        ],
                                                        "additionalProperties": {
                                                            "type": "object",
                                                            "properties": {},
                                                            "additionalProperties": false
                                                        }
                                                    },
                                                    "2": {
                                                        "$ref": "#/properties_templates_properties_1_properties_rows_properties_1"
                                                    },
                                                    "3": {
                                                        "$ref": "#/properties_templates_properties_1_properties_rows_properties_1"
                                                    }
                                                },
                                                "required": [
                                                    "1",
                                                    "2",
                                                    "3"
                                                ],
                                                "additionalProperties": {
                                                    "$ref": "#/properties_templates_properties_1_properties_rows_properties_1"
                                                }
                                            }
                                        },
                                        "required": [
                                            "rows"
                                        ],
                                        "additionalProperties": {
                                            "type": "object",
                                            "properties": {},
                                            "additionalProperties": false
                                        }
                                    },
                                    "2": {
                                        "$ref": "#/properties_templates_properties_1"
                                    },
                                    "3": {
                                        "$ref": "#/properties_templates_properties_1"
                                    }
                                },
                                "required": [
                                    "1",
                                    "2",
                                    "3"
                                ],
                                "additionalProperties": {
                                    "$ref": "#/properties_templates_properties_1"
                                }
                            },
                            "assignments": {
                                "type": "object",
                                "properties": {},
                                "additionalProperties": {
                                    "type": "object",
                                    "properties": {
                                        "_editable": {
                                            "type": "boolean"
                                        },
                                        "_movement": {
                                            "type": "string",
                                            "enum": [
                                                "move",
                                                "copy"
                                            ]
                                        },
                                        "_owners": {
                                            "type": "array",
                                            "items": {
                                                "type": "string"
                                            }
                                        },
                                        "_modes": {
                                            "type": "object",
                                            "properties": {
                                                "mode1": {
                                                    "anyOf": [
                                                        {
                                                            "type": "string"
                                                        },
                                                        {
                                                            "type": "array",
                                                            "items": {
                                                                "type": "string"
                                                            }
                                                        },
                                                        {
                                                            "type": "object",
                                                            "properties": {},
                                                            "additionalProperties": false
                                                        }
                                                    ]
                                                }
                                            },
                                            "required": [
                                                "mode1"
                                            ],
                                            "additionalProperties": {
                                                "anyOf": [
                                                    {
                                                        "type": "string"
                                                    },
                                                    {
                                                        "type": "array",
                                                        "items": {
                                                            "type": "string"
                                                        }
                                                    },
                                                    {
                                                        "type": "object",
                                                        "properties": {},
                                                        "additionalProperties": false
                                                    }
                                                ]
                                            }
                                        },
                                        "_mode": {
                                            "type": "string"
                                        }
                                    },
                                    "required": [
                                        "_editable",
                                        "_movement",
                                        "_owners",
                                        "_modes",
                                        "_mode"
                                    ],
                                    "additionalProperties": false
                                }
                            }
                        },
                        "required": [
                            "blocks",
                            "modules",
                            "actions",
                            "commands",
                            "menu",
                            "functions",
                            "automation"
                        ],
                        "additionalProperties": false,
                        "$defs": {
                            "action": {
                                "type": "object",
                                "properties": {
                                    "if": {
                                        "type": "array",
                                        "items": {
                                            "type": "array",
                                            "items": {
                                                "type": ["string", "number"]
                                            }
                                        }
                                    },
                                    "while": {
                                        "type": "array",
                                        "items": {
                                            "type": "array",
                                            "items": {
                                                "type": ["string", "number"]
                                            }
                                        }
                                    },
                                    "set": {
                                        "type": "object",
                                        "additionalProperties": {
                                            "type": "string"
                                        }
                                    },
                                    "target": {
                                        "type": "string"
                                    },
                                    "chain": {
                                        "type": "array",
                                        "items": {
                                            "$ref": "#/$defs/chainItem"
                                        }
                                    },
                                    "nestedActions": {
                                        "type": "array",
                                        "items": {
                                            "$ref": "#/$defs/action"
                                        }
                                    },
                                    "assign": {
                                        "type": "string"
                                    },
                                    "next": {
                                        "type": "boolean"
                                    },
                                    "express": {
                                        "type": "boolean"
                                    }
                                },
                                "required": [
                                    "if",
                                    "while",
                                    "set",
                                    "target",
                                    "chain",
                                    "nestedActions",
                                    "assign",
                                    "next",
                                    "express"
                                ],
                                "additionalProperties": false
                            },
                            "menuItem": {
                                "type": "object",
                                "properties": {
                                    "_name": { "type": "string" },
                                    "_classes": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                    },
                                    "_show": { "type": "boolean" },
                                    "_selected": { "type": "boolean" },
                                    "_rgb": {
                                        "type": "array",
                                        "items": { "type": "number" }
                                    },
                                    "_color": {
                                        "type": "array",
                                        "items": { "type": "number" }
                                    }
                                },
                                "required": ["_name", "_classes", "_show", "_selected"],
                                "additionalProperties": {
                                    "anyOf": [
                                        { "$ref": "#/$defs/menuItem" },
                                        { "type": "null" }
                                    ]
                                }
                            },
                            "chainItem": {
                                "type": "object",
                                "properties": {
                                    "access": {
                                        "type": "string"
                                    },
                                    "params": {
                                        "type": "array",
                                        "items": {
                                            "type": "string"
                                        }
                                    },
                                    "new": {
                                        "type": "boolean"
                                    },
                                    "express": {
                                        "type": "boolean"
                                    }
                                },
                                "required": ["access", "params", "new", "express"],
                                "additionalProperties": false
                            },
                        }
                    }
                }
            }

        });


        res.render('schema', {
            title: 'Schema',
            message: completion
        });
    } catch (error) {
        next(error);
    }
});


module.exports = router;





