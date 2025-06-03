async function parseArrayLogic({
    arrayLogic = [],
    dynamodb,
    openai
} = {}) {
    const results = [];

    // arrayLogic Example
    /*
    [
{
    "/government/housing-and-urban-development/regulation/rent-control/tenant-protection/orders/by/order/number": {
        "input": {},
        "schema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "NYC\u202fDHCR\u202fRent‑Stabilization Guideline Archive",
            "type": "object",
            "properties": {
                "orders": {
                    "type": "object",
                    "description": "Keys are RGB order numbers (e.g. \"56\").",
                    "additionalProperties": {
                        "$ref": "#/$defs/order"
                    }
                }
            },
            "required": [
                "orders"
            ],
            "$defs": {
                "order": {
                    "type": "object",
                    "properties": {
                        "from": {
                            "type": "array",
                            "items": {
                                "type": "integer"
                            },
                            "minItems": 3,
                            "maxItems": 3
                        },
                        "to": {
                            "type": "array",
                            "items": {
                                "type": "integer"
                            },
                            "minItems": 3,
                            "maxItems": 3
                        },
                        "1year": {
                            "type": "array",
                            "items": {
                                "type": "number"
                            },
                            "minItems": 1
                        },
                        "2year": {
                            "type": "array",
                            "items": {
                                "type": "number"
                            },
                            "minItems": 1
                        },
                        "vacancy": {
                            "type": "array"
                        },
                        "fairMarket": {
                            "type": "array"
                        },
                        "conditions": {
                            "type": "array"
                        },
                        "MCI": {
                            "type": "object",
                            "properties": {
                                "cap_percent": {
                                    "type": "number"
                                },
                                "amortization_years": {
                                    "type": "integer"
                                },
                                "notes": {
                                    "type": "string"
                                }
                            },
                            "required": [
                                "cap_percent"
                            ]
                        },
                        "IAI": {
                            "type": "object",
                            "properties": {
                                "spending_cap": {
                                    "type": "integer"
                                },
                                "period_years": {
                                    "type": "integer"
                                },
                                "max_monthly_addition": {
                                    "type": "number"
                                },
                                "notes": {
                                    "type": "string"
                                }
                            },
                            "required": [
                                "spending_cap",
                                "period_years"
                            ]
                        },
                        "fuel_adjustment": {
                            "type": [
                                "string",
                                "object",
                                "null"
                            ]
                        }
                    },
                    "required": [
                        "from",
                        "to",
                        "1year",
                        "2year"
                    ]
                }
            }
        }
    }
}
]*/

    console.log("inside arrayLogic", arrayLogic)
    for (const element of arrayLogic) {
        console.log("element", element)

        const [breadcrumb] = Object.keys(element);
        const body = element[breadcrumb] ?? {};

        console.log("body", body)
        if (!body.input || !body.schema) continue;

        const {
            data: [{ embedding }]
        } = await openai.embeddings.create({
            model: 'text-embedding-3-small', 
            input: JSON.stringify(body)
        });

        const [domain, root, subroot] = breadcrumb.replace(/^\/+/, '').split('/');
        if (!domain || !root) {
            console.warn('Breadcrumb missing domain or root:', breadcrumb);
            continue;
        }

        console.log("domain", domain)
        console.log("root", root)
        console.log("subroot", subroot)

        let dynamoRecord = null;
        try {
            const { Item } =
                typeof dynamodb.get === 'function'
                    ? await dynamodb.get({
                        TableName: `i_${domain}`,
                        Key: { root }
                    }).promise?.() ?? await dynamodb.get({
                        TableName: `i_${domain}`,
                        Key: { root }
                    })
                    : {}; 

            dynamoRecord = Item ?? null;
            console.log("dynamoRecord",dynamoRecord)
        } catch (err) {
            console.error('DynamoDB error:', err);
        }

        results.push({ breadcrumb, domain, root, subroot, embedding, dynamoRecord });
    }

    console.log('results!!', results);
    return results;
}

module.exports = { parseArrayLogic };