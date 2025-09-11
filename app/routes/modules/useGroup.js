// modules/groups/useGroup.js
// "useGroup" → /<newUsingSU>/<headSU>
function register({ on, use }) {
  on("useGroup", async (ctx, { cookie }) => {
    const {
      manageCookie,
      getDocClient,
      getSub,
      getEntity,
      addVersion,
      updateEntity,
      convertToJSON,
      deps, // { uuidv4, ... }
    } = use();

    const dynamodb = getDocClient();
    const { uuidv4 } = deps;

    // Ensure cookie parity for convertToJSON
    const ensuredCookie =
      cookie?.gi ? cookie : await manageCookie({}, ctx.xAccessToken, ctx.res, dynamodb, uuidv4);

    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const [newUsingSU, headSU] = segs;
    if (!newUsingSU || !headSU) {
      throw new Error(`useGroup expects "/<newUsingSU>/<headSU>", got "${ctx.path}"`);
    }

    const usingSub = await getSub(newUsingSU, "su", dynamodb);
    const usedSub  = await getSub(headSU, "su", dynamodb);
    if (!usingSub.Items?.length || !usedSub.Items?.length) {
      throw new Error(`useGroup: subdomain not found`);
    }

    const ug = await getEntity(usingSub.Items[0].e, dynamodb);
    const ud = await getEntity(usedSub.Items[0].e, dynamodb);

    const v = await addVersion(
      ug.Items[0].e.toString(),
      "u",
      ud.Items[0].e.toString(),
      ug.Items[0].c,
      dynamodb
    );
    await updateEntity(
      ug.Items[0].e.toString(),
      "u",
      ud.Items[0].e.toString(),
      v.v,
      v.c,
      dynamodb
    );

    const headOfUsing = await getSub(ug.Items[0].h, "e", dynamodb);
    const body = ctx.req?.body || {};
    const mainObj = await convertToJSON(
      headOfUsing.Items[0].su,
      [],
      null,
      null,
      ensuredCookie,
      dynamodb,
      uuidv4,
      null,
      [],
      {},
      "",
      deps.dynamodbLL,
      body
    );

    // Parity: existing + file (legacy set file=newUsingSU)
    mainObj.existing = ensuredCookie.existing;
    mainObj.file = newUsingSU + "";

    return { ok: true, response: mainObj };
  });
}

module.exports = { register };
