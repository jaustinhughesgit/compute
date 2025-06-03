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

        //table "i_government"
        //partition key "root" = "housing-and-urban-development"
        //sort key "id" = 1747148573952
        //"emb1" = [-0.02554481,...]   //embedding 1
        //"emb2" = [-0.043630313,...]  //embedding 2
        //"emb3" = [-0.022157108,...]  //embedding 3
        //"emb4" = [-0.04161819,...]   //embedding 4
        //"emb5" = [-0.0004759276,...] //embedding 5
        //"path1" = "affordable-housing/projects/funding-applications/state/illinois/development-id/3209/status/approved" //breadcrumb 1
        //"path2" = "public-housing/waitlists/city/philadelphia/unit-type/2-bedroom/average-wait-time/months/18" //breadcrumb 2
        //"path3" = "zoning-laws/changes/residential-density/ordinance-update/city/denver/public-hearing/date/2025-06-14" //breadcrumb 3
        //"path4" = "interdepartmental-collaboration/task-groups/climate-planning/lead-agency/epa/task-id/17/assigned-staff/5" //breadcrumb 4
        //"path5" = "urban-renewal/programs/community-input-sessions/neighborhood/westside-round-3/attendance-count/64" //breadcrumb 5

        let dynamoRecord = null;

try {
  const { Items } = await dynamodb.query({
    TableName: `i_${domain}`,
    KeyConditionExpression: '#r = :pk',
    ExpressionAttributeNames:  { '#r': 'root' },
    ExpressionAttributeValues: { ':pk': root },
    Limit: 1
  }).promise();

  dynamoRecord = Items?.[0] ?? null;
  console.log('dynamoRecord', dynamoRecord);
} catch (err) {
  console.error('DynamoDB error:', err);
}

        results.push({ breadcrumb, domain, root, subroot, embedding, dynamoRecord });
    }

    console.log('results!!', results);
    return results;
}

module.exports = { parseArrayLogic };