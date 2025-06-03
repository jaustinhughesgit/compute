// ─── helpers ────────────────────────────────────────────────────────────
const cosineDistance = (a, b) => {
    const dot   = a.reduce((s, v, i) => s + v * b[i], 0);
    const normA = Math.hypot(...a);
    const normB = Math.hypot(...b);
    return 1 - dot / (normA * normB);          // 0 → identical, 1 → orthogonal
  };
  
  const toVector = v => {
    if (!v) return null;                       // empty field → null
    if (Array.isArray(v)) return v;            // already a list? great
    try {                                      // otherwise parse the string
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr.map(Number) : null;
    } catch {                                  // bad JSON → null
      return null;
    }
  };
  
  // ─── main ───────────────────────────────────────────────────────────────
  async function parseArrayLogic({ arrayLogic = [], dynamodb, openai } = {}) {
    const results = [];
  
    for (const element of arrayLogic) {
      const [breadcrumb] = Object.keys(element);
      const body = element[breadcrumb] ?? {};
      if (!body.input || !body.schema) continue;
  
      /* 1) fresh embedding for this breadcrumb’s JSON value */
      const {
        data: [{ embedding }]
      } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: JSON.stringify(body)
      });
  
      const [domain, root] = breadcrumb.replace(/^\/+/, '').split('/');
      if (!domain || !root) continue;
  
      /* 2) fetch the row that stores emb1 … emb5 */
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
        console.error('DynamoDB query failed:', err);
      }
  
      /* 3) convert the five strings → arrays and measure distance */
      let dist1, dist2, dist3, dist4, dist5;
      if (dynamoRecord) {
        const embKeys = ['emb1', 'emb2', 'emb3', 'emb4', 'emb5'];
        const vectors = embKeys.map(k => toVector(dynamoRecord[k]));
  
        [dist1, dist2, dist3, dist4, dist5] = vectors.map(vec =>
          vec ? cosineDistance(embedding, vec) : null
        );
      }
  
      results.push({
        breadcrumb,
        embedding,
        dist1, dist2, dist3, dist4, dist5,
        dynamoRecord          // keep if you still need path1 … path5, etc.
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

