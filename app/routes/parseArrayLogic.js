const toVector = v => {
    if (!v) return null;
    const arr = Array.isArray(v) ? v : JSON.parse(v);
    if (!Array.isArray(arr)) return null;
  
    const len = Math.hypot(...arr);
    return len ? arr.map(x => x / len) : null;
  };
  
  const scaledEuclidean = (a, b) =>
    Math.hypot(...a.map((v, i) => v - b[i])) / 2; 
  
  async function parseArrayLogic({ arrayLogic = [], dynamodb, openai } = {}) {
    const results = [];
  
    for (const element of arrayLogic) {
      const [breadcrumb] = Object.keys(element);
      const body = element[breadcrumb] ?? {};
      if (!body.input || !body.schema) continue;
  
      const {
        data: [{ embedding: rawEmb }]
      } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: JSON.stringify(body)
      });
      const embedding = toVector(rawEmb);
  
      const [domain, root] = breadcrumb.replace(/^\/+/, '').split('/');
      if (!domain || !root) continue;
  
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
  
      let dist1, dist2, dist3, dist4, dist5;
      if (dynamoRecord) {
        const embKeys = ['emb1', 'emb2', 'emb3', 'emb4', 'emb5'];
        const vectors = embKeys.map(k => toVector(dynamoRecord[k]));
        [dist1, dist2, dist3, dist4, dist5] = vectors.map(vec =>
          vec ? scaledEuclidean(embedding, vec) : null
        );
      }
  

      const pathKey = `${domain}/${root}`; 
      const delta   = 0.03; 
      let subdomainMatches = [];

      if (dist1 != null) {         // still need dist1 for the GSI range query
        try {
          // Build the query once we know which distances we actually calculated
          const params = {
            TableName: 'subdomains',
            IndexName: 'path-index',
            KeyConditionExpression: '#p = :path AND #d1 BETWEEN :d1lo AND :d1hi',
            ExpressionAttributeNames: {
              '#p' : 'path',
              '#d1': 'dist1',
              '#d2': 'dist2',
              '#d3': 'dist3',
              '#d4': 'dist4',
              '#d5': 'dist5'
            },
            ExpressionAttributeValues: {
              ':path': pathKey,
              ':d1lo': dist1 - delta,
              ':d1hi': dist1 + delta,
              ':d2lo': dist2 - delta,
              ':d2hi': dist2 + delta,
              ':d3lo': dist3 - delta,
              ':d3hi': dist3 + delta,
              ':d4lo': dist4 - delta,
              ':d4hi': dist4 + delta,
              ':d5lo': dist5 - delta,
              ':d5hi': dist5 + delta
            },
            // All four other dists must fall in-range as well
            FilterExpression:
              '#d2 BETWEEN :d2lo AND :d2hi AND ' +
              '#d3 BETWEEN :d3lo AND :d3hi AND ' +
              '#d4 BETWEEN :d4lo AND :d4hi AND ' +
              '#d5 BETWEEN :d5lo AND :d5hi',
            ScanIndexForward: true
          };
      
          const { Items } = await dynamodb.query(params).promise();
          subdomainMatches = Items ?? [];
        } catch (err) {
          console.error('subdomains GSI query failed:', err);
        }
      }
  

      results.push({
        breadcrumb,
        embedding,
        dist1, dist2, dist3, dist4, dist5,
        dynamoRecord,
        subdomainMatches
      });
    }
  
    return results;
  }
  
  module.exports = { parseArrayLogic };
  
/*
  //subdomains
  path: government/housing-and-urban-development
  dist1: 0.6489446243324009
  dist2: 0.656507456056785
  dist3: 0.6491281990852866
  dist4: 0.6587096673385807
  dist5: 0.6515440174627098
  su: 1v4r365440a9-9282-445e-87c8-454s17169bb2
*/


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

