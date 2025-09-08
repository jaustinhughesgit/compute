// routes/modules/runEntity.js
/**
 * Run an entity (by subdomain su). If subdomain has a cached .output in DynamoDB,
 * return it; otherwise delegate to app.runApp() and return its chainParams.
 *
 * @param {{ su: string }} args
 * @param {{ dynamodb: AWS.DynamoDB.DocumentClient, req: any, res: any, next: Function }} ctx
 * @returns {Promise<any>}
 */
const { getSub } = require('../cookies');

module.exports = async function runEntity(args, ctx) {
  const { su } = args || {};
  const { dynamodb, req, res, next } = ctx || {};
  if (!su) throw new Error('runEntity: su required');

  const subBySU = await getSub(su, 'su', dynamodb);

  if (!subBySU.Items || !subBySU.Items.length) {
    throw new Error(`runEntity: no subdomain found for ${su}`);
  }

  const out = subBySU.Items[0].output;
  if (out !== undefined && out !== '') {
    // Use persisted output if present
    return out;
  }

  // Fall back to the main app runner
  const { runApp } = require('../../app');      // same file you call inside the route
  const result = await runApp(req, res, next);
  // The route returns `ot?.chainParams`; mirror that:
  return result?.chainParams ?? result ?? null;
};
