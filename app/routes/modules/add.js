// routes/modules/add.js
"use strict";

/**
 * Simple child creation + linkage (minimal path):
 * - create word for childName (dedupes by lowercase)
 * - create entity inheriting g/h/ai from parent
 * - create subdomain for child
 * - link parentE → childE using the "links" table
 *
 * Accepts either:
 *   Path:  /cookies/add/:parentSU/:childName
 *   Body:  { body: { parentSU, childName } }
 */

async function addHandle(ctx, use) {
  const { dynamodb, uuidv4 } = (ctx.deps || {});
  const parts = (ctx.path || "").split("?")[0].split("/");

  // Prefer path args; fall back to body
  const body = ctx.req?.body || {};
  const b = body.body || {};
  const parentSU =
    (parts[3] && decodeURIComponent(parts[3])) || b.parentSU || "";
  const childName =
    (parts[4] && decodeURIComponent(parts[4])) || b.childName || "";

  if (!parentSU) return { ok: false, error: "add: parentSU required" };
  if (!childName) return { ok: false, error: "add: childName required" };

  const {
    getSub,
    getEntity,
    createWord,
    addVersion,
    updateEntity,
    createEntity,
    createSubdomain,
    incrementCounterAndGetNewValue,
    putLink,
    getUUID,
  } = use;

  // 1) resolve parent
  const parent = await getSub(parentSU, "su", dynamodb);
  if (!parent.Items?.length) return { ok: false, error: "add: parent su not found" };

  const parentE = String(parent.Items[0].e);
  const pEntity = await getEntity(parentE, dynamodb);
  if (!pEntity.Items?.length) return { ok: false, error: "add: parent entity not found" };

  // 2) create word + entity
  const eId = String(await incrementCounterAndGetNewValue("eCounter", dynamodb));
  const wId = String(await incrementCounterAndGetNewValue("wCounter", dynamodb));
  const aId = await createWord(wId, childName, dynamodb);

  // capture "a" in versions
  const vMeta = await addVersion(eId, "a", aId, null, dynamodb);

  // inherit g/h/ai from parent
  const g  = pEntity.Items[0].g;
  const h  = pEntity.Items[0].h;
  const ai = pEntity.Items[0].ai || "0";

  await createEntity(eId, aId, vMeta.v, g, h, ai, dynamodb);

  // 3) subdomain mirrors parent visibility
  const su = await getUUID(uuidv4);
  const z = !!parent.Items[0].z;
  await createSubdomain(su, aId, eId, "0", z, dynamodb);

  // 4) link parent → child (links table)
  await putLink(parentE, eId, dynamodb);

  // Optional lightweight version history of linkage (best-effort)
  try {
    const v1 = await addVersion(parentE, "t", eId, pEntity.Items[0].c || "1", dynamodb);
    await updateEntity(parentE, "t", eId, v1.v, v1.c, dynamodb);

    const v2 = await addVersion(eId, "f", parentE, "1", dynamodb);
    await updateEntity(eId, "f", parentE, v2.v, v2.c, dynamodb);
  } catch {
    // ignore — linkage recorded in `links` table already
  }

  return { ok: true, su, e: eId, parentE };
}

// Back-compat export (if something calls this module directly)
module.exports.handle = async function handle(ctx) {
  const use = ctx.use || {}; // if the caller injected helpers on ctx
  return addHandle(ctx, use);
};

// New loader hook
module.exports.register = ({ on, use }) => {
  on("add", (ctx) => addHandle(ctx, use));
};
