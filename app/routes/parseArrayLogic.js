async function parseArrayLogic (params = {}) {
    const { arrayLogic = [], dynamodb, openai } = params;
    const results = [];
  
    for (const element of arrayLogic) {
      // Each element is expected to be { "<breadcrumb>": { input, schema } }
      const [breadcrumb] = Object.keys(element);
      const body         = element[breadcrumb] ?? {};
  
      // Only continue if the element has both “input” and “schema” keys
      if (!body.input || !body.schema) continue;
  
      /* ── 2 · 1 — Create an embedding of the entire object ─────────────── */
      const embeddingResp = await openai.embeddings.create({
        model : 'text-embedding-3-large',     // or whatever model you standardise on
        input : JSON.stringify(body)
      });
      const embedding = embeddingResp.data[0].embedding;   // 1536-d array
  
      /* ── 2 · 2 — Pull domain · root · subroot from the breadcrumb ─────── */
      //   "/domain/root/subroot/…/…"
      const parts   = breadcrumb.replace(/^\/+/, '').split('/');
      const domain  = parts[0];
      const root    = parts[1] ?? null;
      const subroot = parts[2] ?? null;       // may be null if not present
  
      if (!domain || !root) {
        console.warn('Breadcrumb missing domain or root:', breadcrumb);
        continue;
      }
  
      /* ── 2 · 3 — Fetch the matching record from DynamoDB ──────────────── */
      //   Table name pattern:  i_<domain>
      //   Partition key:       "root"
      // If your table also has a sort key (e.g. "subroot"), add it here.
      const command = new GetCommand({
        TableName : `i_${domain}`,
        Key       : { root }                  // add `subroot` if you have one
      });
  
      let dynamoRecord;
      try {
        const { Item } = await dynamodb.send(command);
        dynamoRecord = Item ?? null;
        console.log('DynamoDB →', dynamoRecord);
      } catch (err) {
        console.error('DynamoDB error:', err);
        dynamoRecord = null;
      }
  
      /* ── 2 · 4 — Accumulate the response ─────────────────────────────── */
      results.push({
        breadcrumb,
        domain,
        root,
        subroot,
        embedding,
        dynamoRecord
      });
    }
  
    return results;
  }

  module.exports = { parseArrayLogic };