// modules/groups.js
"use strict";

function register({ on, use }) {
  const {
    // toggles / utils / domain
    setIsPublic,
    incrementCounterAndGetNewValue,
    createWord,
    createGroup,
    createAccess,
    createVerified,
    createSubdomain,
    addVersion,
    createEntity,
    createFile,
    getUUID,
    convertToJSON,
    getSub,
    getEntity,
    updateEntity,
    manageCookie,
    getDocClient,
    deps, // { ses, uuidv4, ... }
  } = use();

  // ────────────────────────────────────────────────────────────────────────────
  // newGroup  → /<newGroupName>/<headEntityName>/<headUUID?>
  // ────────────────────────────────────────────────────────────────────────────
  on("newGroup", async (ctx, { cookie }) => {
    const dynamodb = getDocClient();
    const { uuidv4, ses } = deps;

    // Path args (same positions as legacy: [3]=name, [4]=head, [5]=uuid)
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const [newGroupName, headEntityName, headUUIDToShow] = segs;
    if (!newGroupName || !headEntityName) {
      throw new Error(`newGroup expects "/<name>/<head>/<uuid?>", got "${ctx.path}"`);
    }

    // Legacy: ensure cookie exists (route used manageCookie up-front)
    const ensuredCookie =
      cookie?.gi ? cookie : await manageCookie({}, ctx.xAccessToken, ctx.res, dynamodb, uuidv4);
    console.log(ensureCookie);
    // Legacy: set public toggle before creating resources
    setIsPublic(true);

    // Words & ids
    const aNewG = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aG    = await createWord(aNewG.toString(), newGroupName, dynamodb);

    const aNewE = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aE    = await createWord(aNewE.toString(), headEntityName, dynamodb);

    const gNew  = await incrementCounterAndGetNewValue("gCounter", dynamodb);
    const e     = await incrementCounterAndGetNewValue("eCounter", dynamodb);
    const ai    = await incrementCounterAndGetNewValue("aiCounter", dynamodb);

    // Access + verified (preserve exact values & order)
    await createAccess(
      ai.toString(),
      gNew.toString(),
      "0",
      { count: 1, metric: "year" },
      10,
      { count: 1, metric: "minute" },
      {},
      "rwado"
    );

    const ttlDurationInSeconds = 90000;
    const ex = Math.floor(Date.now() / 1000) + ttlDurationInSeconds;
    const vi = await incrementCounterAndGetNewValue("viCounter", dynamodb);

    await createVerified(
      vi.toString(),
      ensuredCookie.gi.toString(),
      gNew.toString(),
      "0",
      ai.toString(),
      "0",   // ← va (string "0") — legacy value, do not change
      ex,    // ← ex
      true,  // ← bo
      0,     // ← at
      0      // ← ti
    );

    // Group + head entity + subs
    await createGroup(gNew.toString(), aG, e.toString(), [ai.toString()], dynamodb);

    const suRoot = await getUUID(uuidv4);
    await createSubdomain(suRoot, "0", "0", gNew.toString(), true, dynamodb);

    const vHead = await addVersion(e.toString(), "a", aE.toString(), null, dynamodb);
    await createEntity(
      e.toString(),
      aE.toString(),
      vHead.v,
      gNew.toString(),
      e.toString(),
      [ai.toString()],
      dynamodb
    );

    const suDoc = await getUUID(uuidv4);

    // Keep dual body shape support
    const body = ctx.req?.body || {};
    const outputParam = (body && (body.output ?? body?.body?.output)) || undefined;

    const payload = {
      input: [],
      published: {
        blocks: [{ entity: suDoc, name: "Primary" }],
        modules: {},
        actions: [
          {
            target: "{|res|}!",
            chain: [{ access: "send", params: [outputParam] }],
            assign: "{|send|}",
          },
        ],
        function: {},
        automation: [],
        menu: {
          ready: {
            _name: "Ready",
            _classes: ["Root"],
            _show: false,
            _selected: true,
            options: {
              _name: "Options",
              _classes: ["ready"],
              _show: true,
              _selected: false,
              back: { _name: "Back", _classes: ["options"], _show: false, _selected: false },
            },
            close: { _name: "Close", _classes: ["ready"], _show: false, _selected: false },
          },
        },
        commands: {
          ready: { call: "ready", ready: false, updateSpeechAt: true, timeOut: 0 },
          back: { call: "back", ready: true, updateSpeechAt: true, timeOut: 0 },
          close: { call: "close", ready: false, updateSpeechAt: true, timeOut: 0 },
          options: { call: "options", ready: false, updateSpeechAt: true, timeOut: 0 },
        },
        calls: {
          ready: [
            {
              if: [{ key: ["ready", "_selected"], expression: "==", value: true }],
              then: ["ready"],
              show: ["ready"],
              run: [{ function: "show", args: ["menu", 0], custom: false }],
            },
          ],
          back: [
            {
              if: [{ key: ["ready", "_selected"], expression: "!=", value: true }],
              then: ["ready"],
              show: ["ready"],
              run: [{ function: "highlight", args: ["ready", 0], custom: false }],
            },
          ],
          close: [{ if: [], then: ["ready"], show: [], run: [{ function: "hide", args: ["menu", 0] }] }],
          options: [
            {
              if: [{ key: ["ready", "_selected"], expression: "==", value: true }],
              then: ["ready", "options"],
              show: ["options"],
              run: [],
            },
          ],
        },
        templates: {
          init: { "1": { rows: { "1": { cols: ["a", "b"] } } } },
          second: { "2": { rows: { "1": { cols: ["c", "d"] } } } },
        },
        assignments: {
          a: { _editable: false, _movement: "move", _owners: [], _modes: { _html: "Box 1" }, _mode: "_html" },
          b: { _editable: false, _movement: "move", _owners: [], _modes: { _html: "Box 2" }, _mode: "_html" },
          c: { _editable: false, _movement: "move", _owners: [], _modes: { _html: "Box 3" }, _mode: "_html" },
          d: { _editable: false, _movement: "move", _owners: [], _modes: { _html: "Box 4" }, _mode: "_html" },
        },
        mindsets: [],
        thoughts: {
          "1v4rdc3d72be-3e20-435c-a68b-3808f99af1b5": {
            owners: [],
            content: "",
            contentType: "text",
            moods: {},
            selectedMood: "",
          },
        },
        moods: [],
      },
      skip: [],
      sweeps: 1,
      expected: [],
    };

    await createSubdomain(suDoc, aE.toString(), e.toString(), "0", true, dynamodb);
    await createFile(suDoc, payload, deps.s3);

    // Email (exact legacy strings, including "recieved")
    const params = {
      Source: "noreply@email.1var.com",
      Destination: { ToAddresses: ["austin@1var.com"] },
      Message: {
        Subject: { Data: "1 VAR - Email Address Verification Request" },
        Body: {
          Text: {
            Data:
              "Dear 1 Var User, \n\n We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. \n\n http://1var.com/verify/" +
              suRoot,
          },
          Html: {
            Data:
              "Dear 1 Var User, <br><br> We have recieved a request to create a new group at 1 VAR. If you requested this verification, please go to the following URL to confirm that you are the authorized to use this email for your group. <br><br> http://1var.com/verify/" +
              suRoot,
          },
        },
      },
    };
    await ses.sendEmail(params).promise();

    // Return the new document view
    const mainObj = await convertToJSON(
      suDoc,
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

    // Parity: add existing + file
    mainObj.existing = ensuredCookie.existing;
    mainObj.file = suDoc + "";

    return { ok: true, response: mainObj };
  });

  // ────────────────────────────────────────────────────────────────────────────
  // useGroup → /<newUsingSU>/<headSU>
  // ────────────────────────────────────────────────────────────────────────────
  on("useGroup", async (ctx, { cookie }) => {
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

  // ────────────────────────────────────────────────────────────────────────────
  // substituteGroup → /<newSubstitutingSU>/<headSubstitutingSU>
  // ────────────────────────────────────────────────────────────────────────────
  on("substituteGroup", async (ctx, { cookie }) => {
    const dynamodb = getDocClient();
    const { uuidv4 } = deps;

    const ensuredCookie =
      cookie?.gi ? cookie : await manageCookie({}, ctx.xAccessToken, ctx.res, dynamodb, uuidv4);

    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const [newSubstitutingSU, headSubstitutingSU] = segs;
    if (!newSubstitutingSU || !headSubstitutingSU) {
      throw new Error(`substituteGroup expects "/<newSubstitutingSU>/<headSubstitutingSU>", got "${ctx.path}"`);
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

  return { name: "groups" };
}

module.exports = { register };
