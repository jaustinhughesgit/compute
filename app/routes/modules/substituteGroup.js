// modules/groups/substituteGroup.js
// "substituteGroup" → /<newSubstitutingSU>/<headSubstitutingSU>
function register({ on, use }) {
  on("substituteGroup", async (ctx, { cookie }) => {
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

    const ensuredCookie =
      cookie?.gi ? cookie : await manageCookie({}, ctx.xAccessToken, ctx.res, dynamodb, uuidv4);

    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const [newSubstitutingSU, headSubstitutingSU] = segs;
    if (!newSubstitutingSU || !headSubstitutingSU) {
      throw new Error(
        `substituteGroup expects "/<newSubstitutingSU>/<headSubstitutingSU>", got "${ctx.path}"`
      );
    }

    const sg = await getSub(newSubstitutingSU, "su", dynamodb);
    const sd = await getSub(headSubstitutingSU, "su", dynamodb);
    if (!sg.Items?.length || !sd.Items?.length) {
      throw new Error(`substituteGroup: subdomain not found`);
    }

    const sge = await getEntity(sg.Items[0].e, dynamodb);
    const sde = await getEntity(sd.Items[0].e, dynamodb);

    const v = await addVersion(
      sge.Items[0].e.toString(),
      "z",
      sde.Items[0].e.toString(),
      sge.Items[0].c,
      dynamodb
    );
    await updateEntity(
      sge.Items[0].e.toString(),
      "z",
      sde.Items[0].e.toString(),
      v.v,
      v.c,
      dynamodb
    );

    const headOfSub = await getSub(sge.Items[0].h, "e", dynamodb);
    const body = ctx.req?.body || {};
    const mainObj = await convertToJSON(
      headOfSub.Items[0].su,
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

    // Parity: existing + file (legacy set file=newSubstitutingSU)
    mainObj.existing = ensuredCookie.existing;
    mainObj.file = newSubstitutingSU + "";

    return { ok: true, response: mainObj };
  });
}

module.exports = { register };
