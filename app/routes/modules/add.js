// routes/modules/add.js
/**
 * Simple child creation + linkage (minimal path):
 * - create word for childName (dedupes by lowercase)
 * - create entity inheriting g/h/ai from parent
 * - create subdomain for child
 * - link parentE → childE using the "links" table
 *
 * @param {{ parentSU: string, childName: string }} args
 * @param {{ dynamodb: AWS.DynamoDB.DocumentClient, uuidv4: Function }} ctx
 * @returns {Promise<{su:string,e:string,parentE:string}>}
 */
const {
  getSub, getEntity, createWord, addVersion, updateEntity,
  createEntity, createSubdomain, incrementCounterAndGetNewValue,
  putLink, getUUID
} = require('../cookies');

module.exports = async function add(args, ctx) {
  const { parentSU, childName } = args || {};
  const { dynamodb, uuidv4 } = ctx || {};
  if (!parentSU) throw new Error('add: parentSU required');
  if (!childName) throw new Error('add: childName required');

  // 1) resolve parent
  const parent = await getSub(parentSU, 'su', dynamodb);
  if (!parent.Items?.length) throw new Error('add: parent su not found');
  const parentE = String(parent.Items[0].e);
  const pEntity = await getEntity(parentE, dynamodb);
  if (!pEntity.Items?.length) throw new Error('add: parent entity not found');

  // 2) create word + entity
  const eId  = String(await incrementCounterAndGetNewValue('eCounter', dynamodb));
  const wId  = String(await incrementCounterAndGetNewValue('wCounter', dynamodb));
  const aId  = await createWord(wId, childName, dynamodb);

  // create a version row capturing "a"
  const vMeta = await addVersion(eId, 'a', aId, null, dynamodb);

  // inherit group/head/ai from parent
  const g = pEntity.Items[0].g;
  const h = pEntity.Items[0].h;
  const ai = pEntity.Items[0].ai || '0';

  await createEntity(eId, aId, vMeta.v, g, h, ai, dynamodb);

  // 3) subdomain mirrors parent visibility
  const su = await getUUID(uuidv4);
  const z  = !!parent.Items[0].z;
  await createSubdomain(su, aId, eId, '0', z, dynamodb);

  // 4) link: parentE → childE
  await putLink(parentE, eId, dynamodb);

  // Optional: keep lightweight version history of linkage on parent/child
  try {
    const v1 = await addVersion(parentE, 't', eId, pEntity.Items[0].c || '1', dynamodb);
    await updateEntity(parentE, 't', eId, v1.v, v1.c, dynamodb);

    const v2 = await addVersion(eId, 'f', parentE, '1', dynamodb);
    await updateEntity(eId, 'f', parentE, v2.v, v2.c, dynamodb);
  } catch { /* non-fatal for "simple" path */ }

  return { su, e: eId, parentE };
};
