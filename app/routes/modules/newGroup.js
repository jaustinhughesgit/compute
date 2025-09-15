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

    // --- Atomic reservation helper: bumps a counter by `count` and returns the IDs reserved ---
    // Requires your counters table to be the same one used by incrementCounterAndGetNewValue
    // (i.e., process.env.COUNTERS_TABLE with key { name } and attribute `value`).
    async function reserveIds(counterName, count) {
      const res = await dynamodb
        .update({
          TableName: process.env.COUNTERS_TABLE,
          Key: { name: counterName },
          UpdateExpression: "SET #v = if_not_exists(#v, :zero) + :n",
          ExpressionAttributeNames: { "#v": "value" },
          ExpressionAttributeValues: { ":zero": 0, ":n": count },
          ReturnValues: "UPDATED_NEW",
        })
        .promise();

      const end = res.Attributes.value; // new value after bump
      const start = end - count + 1;
      return Array.from({ length: count }, (_, i) => String(start + i));
    }

    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const [newGroupName, headEntityName, headUUIDToShow] = segs;
    if (!newGroupName || !headEntityName) {
      throw new Error(`newGroup expects "/<name>/<head>/<uuid?>", got "${ctx.path}"`);
    }

    const ensuredCookie =
      cookie?.gi ? cookie : await manageCookie({}, ctx.xAccessToken, ctx.res, dynamodb, uuidv4);
    console.log("ensuredCookie", ensuredCookie);

    setIsPublic(true);

    // Words (unchanged)
    const aNewG = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aG    = await createWord(aNewG.toString(), newGroupName, dynamodb);

    const aNewE = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aE    = await createWord(aNewE.toString(), headEntityName, dynamodb);

    // Group, Access, Verified counters (unchanged)
    const gNew = await incrementCounterAndGetNewValue("gCounter", dynamodb);
    const ai   = await incrementCounterAndGetNewValue("aiCounter", dynamodb);

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

    // --- Reserve two entity IDs atomically: [headEntityId, entityId] ---
    const [headEntityId, entityId] = await reserveIds("eCounter", 2);

    // Group uses the head entity id (same role your previous `e` had)
    await createGroup(gNew.toString(), aG, headEntityId, [ai.toString()], dynamodb);

    const suRoot = await getUUID(uuidv4);
    await createSubdomain(suRoot, "0", "0", gNew.toString(), true, dynamodb);

    // Version is created for the HEAD entity (mirrors your previous flow)
    const vHead = await addVersion(headEntityId, "a", aE.toString(), null, dynamodb);

    // Create the actual entity you want to return (child/new entity)
    await createEntity(
      entityId,           // NEW entity id (second from the reservation)
      aE.toString(),
      vHead.v,            // reuse the head version (keeps your prior wiring)
      gNew.toString(),
      headEntityId,       // owner is the head entity
      [ai.toString()],
      dynamodb
    );

    // savedE is the second reserved id we just created
    const savedE = entityId;
    console.log("savedE", savedE);

    const suDoc = await getUUID(uuidv4);

    const body = ctx.req?.body || {};

    console.log("***!!!");
    console.log("ctx", ctx);
    console.log("ctx.req", ctx.req);
    console.log("ctx.req.body", ctx.req.body);

    const outputParam = ctx?.req?.body?.body?.output;

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

    // IMPORTANT: Point this subdomain at the newly created entity (entityId),
    // since that's what you're returning / working with now.
    await createSubdomain(
      suDoc,
      aE.toString(),
      savedE,          // use entityId instead of headEntityId here
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

    console.log("ensuredCookie", ensuredCookie);
    // Parity: add existing + file
    mainObj.existing = ensuredCookie.existing;
    mainObj.file = suDoc + "";
    mainObj.entity = savedE; // already a string

    console.log("response:", mainObj);
    return { ok: true, response: mainObj };
  });
}

module.exports = { register };
