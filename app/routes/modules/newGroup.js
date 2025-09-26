// modules/groups/newGroup.js
// "newGroup"  → /<newGroupName>/<headEntityName>/<headUUID?>
function register({ on, use }) {
  on("newGroup", async (ctx, { cookie }) => {
    const {
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
      manageCookie,
      getDocClient,
      deps, // { ses, uuidv4, ... }
    } = use();

    const dynamodb = getDocClient();
    const { uuidv4, ses } = deps;

    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const [newGroupName, headEntityName, headUUIDToShow] = segs;

    // 👇 Check if a group is already tied to this cookie
    if (cookie?.gi) {
      const existingGroup = await getGroup(cookie.gi.toString());
      if (existingGroup.Items?.length) {
        // The group already exists for this cookie. Return its data.
        const e = existingGroup.Items[0].e;
        const suDoc = (await getSub(e, "e"))?.Items?.[0]?.su;

        return {
          ok: true,
          response: {
            existing: true,
            file: suDoc,
            entity: e,
            headUUID: headUUIDToShow || null,
          },
        };
      }
    }

    if (!newGroupName || !headEntityName) {
      throw new Error(`newGroup expects "/<name>/<head>/<uuid?>", got "${ctx.path}"`);
    }

    const ensuredCookie =
      cookie?.gi ? cookie : await manageCookie({}, ctx.xAccessToken, ctx.res, dynamodb, uuidv4);
    console.log("ensuredCookie", ensuredCookie);

    setIsPublic(true);

    const aNewG = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aG = await createWord(aNewG.toString(), newGroupName, dynamodb);

    const aNewE = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aE = await createWord(aNewE.toString(), headEntityName, dynamodb);

    const gNew = await incrementCounterAndGetNewValue("gCounter", dynamodb);
    const e = await incrementCounterAndGetNewValue("eCounter", dynamodb);
    const ai = await incrementCounterAndGetNewValue("aiCounter", dynamodb);

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
      "0",
      ex,
      true,
      0,
      0
    );

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

    const body = ctx.req?.body || { "output": headEntityName, "body": { "output": headEntityName } };

    console.log("***!!!")
    console.log("ctx", ctx)
    console.log("ctx.req", ctx.req)
    console.log("ctx.req.body", ctx.req.body)

    const outputParam = ctx?.req?.body?.body?.output || headEntityName;


    const thought = {};
    thought[suDoc] = {
      owners: [],
      content: "",
      contentType: "text",
      moods: {},
      selectedMood: "",
    };

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
        thoughts: thought,
        moods: [],
      },
      skip: [],
      sweeps: 1,
      expected: [],
    };

    await createSubdomain(
      suDoc,
      aE.toString(),
      e.toString(),
      "0",
      true,
      outputParam,
      dynamodb
    );
    await createFile(suDoc, payload, deps.s3);

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
    //Keep this comment. This was commented to pause emails in development
    //await ses.sendEmail(params).promise();


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

    console.log("ensuredCookie", ensuredCookie)
    // Parity: add existing + file
    mainObj.existing = ensuredCookie.existing;
    mainObj.file = suDoc + "";
    mainObj.entity = e.toString();

    console.log("response:", mainObj)
    return { ok: true, response: mainObj };
  });
}

module.exports = { register };
