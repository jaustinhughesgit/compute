async function parseArrayLogic ({
    arrayLogic = [],
    dynamodb,        // v2 DocumentClient  *or*  v3 DynamoDBDocumentClient
    openai
  } = {}) {
    const results = [];
  
    console.log("inside arrayLogic", arrayLogic)
    for (const element of arrayLogic) {
        console.log("element", element)
      const [breadcrumb] = Object.keys(element);
      const body = element[breadcrumb] ?? {};
  
      // Guard: need *both* keys and non-empty input
      if (!body.input || !Object.keys(body.input).length || !body.schema) continue;
  
      /* 1. ─ Create embedding */
      const {
        data: [{ embedding }]
      } = await openai.embeddings.create({
        model : 'text-embedding-3-small',   // swap if you have “large” access
        input : JSON.stringify(body)
      });
  
      /* 2. ─ Break out domain / root / subroot */
      const [domain, root, subroot] = breadcrumb.replace(/^\/+/, '').split('/');
      if (!domain || !root) {
        console.warn('Breadcrumb missing domain or root:', breadcrumb);
        continue;
      }
  
      /* 3. ─ Fetch from DynamoDB (DocumentClient style) */
      let dynamoRecord = null;
      try {
        const { Item } =
          typeof dynamodb.get === 'function'
            ? await dynamodb.get({                // v2 or v3 doc client
                TableName : `i_${domain}`,
                Key       : { root }
              }).promise?.() ?? await dynamodb.get({
                TableName : `i_${domain}`,
                Key       : { root }
              })
            : {}; // fallback for wrong client type
  
        dynamoRecord = Item ?? null;
      } catch (err) {
        console.error('DynamoDB error:', err);
      }
  
      /* 4. ─ Collect response */
      results.push({ breadcrumb, domain, root, subroot, embedding, dynamoRecord });
    }
  
    console.log('results!!', results);
    return results;
  }
  
  module.exports = { parseArrayLogic };

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