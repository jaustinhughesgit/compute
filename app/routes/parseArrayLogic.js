// ─── 1.  Helper ─────────────────────────────────────────────────────────
function cosineDistance(a, b) {
    // 1 – (cosine-similarity)
    const dot   = a.reduce((s, v, i) => s + v * b[i], 0);
    const normA = Math.hypot(...a);   // √Σa²
    const normB = Math.hypot(...b);
    return 1 - dot / (normA * normB);
  }
  
  // ─── 2.  Main worker ────────────────────────────────────────────────────
  async function parseArrayLogic({
    arrayLogic = [],
    dynamodb,
    openai
  } = {}) {
    const results = [];
  
    for (const element of arrayLogic) {
      const [breadcrumb] = Object.keys(element);
      const body = element[breadcrumb] ?? {};
      if (!body.input || !body.schema) continue;
  
      // ▸ 2 a. fresh embedding for the doc we’re validating
      const {
        data: [{ embedding }]
      } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: JSON.stringify(body)
      });
  
      const [domain, root, subroot] = breadcrumb.replace(/^\/+/, '').split('/');
      if (!domain || !root) continue;
  
      // ▸ 2 b. fetch the row that has emb1…emb5
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
      } catch (err) {
        console.error('DynamoDB error:', err);
      }
  
      // ▸ 2 c. compute distances if we found a row
      let dist1, dist2, dist3, dist4, dist5;
      if (dynamoRecord) {
        const embKeys = ['emb1', 'emb2', 'emb3', 'emb4', 'emb5'];
        const stored  = embKeys.map(k => dynamoRecord[k]).filter(Boolean);
  
        // DynamoDB DocumentClient already unmarshals number-lists → JS arrays.
        // If your table is using string sets or something else, coerce here:
        //   stored = stored.map(arr => arr.map(Number));
  
        [dist1, dist2, dist3, dist4, dist5] =
          stored.map(storedEmb => cosineDistance(embedding, storedEmb));
      }
  
      results.push({
        breadcrumb,
        domain,
        root,
        subroot,
        embedding,          // the new embedding you just generated
        dynamoRecord,       // the whole row you fetched (optional)
        dist1,
        dist2,
        dist3,
        dist4,
        dist5
      });
    }
  
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

