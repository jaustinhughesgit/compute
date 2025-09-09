// modules/extend.js
"use strict";

function register({ on, use }) {
  const {
    // toggles
    setIsPublic,
    // domain/helpers
    getSub, getEntity,
    incrementCounterAndGetNewValue,
    createWord, addVersion, createEntity, createSubdomain,
    // utils/files
    getUUID, createFile,
    // tree
    convertToJSON,
    // cookies/auth
    manageCookie,
    // raw deps
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // unwrap helper: preserve legacy behavior (support flattened req.body or legacy body.body)
  const unwrapBody = (rb) => {
    if (!rb || typeof rb !== "object") return { body: rb };
    if (rb.body && typeof rb.body === "object") return { body: rb.body };
    return { body: rb };
  };

  on("extend", async (ctx, meta) => {
    const { req, res, path } = ctx;
    const { dynamodb, dynamodbLL, uuidv4, s3 } = deps;

    const reqBody = unwrapBody(req?.body || {});
    // Ensure legacy cookie behavior for convertToJSON calls
    const cookie = await manageCookie({}, ctx.xAccessToken, res, dynamodb, uuidv4);

    // path normalization from NEW router gives "/<fileID>/<newEntityName>/<headUUID>"
    const segs = String(path || "").split("/").filter(Boolean);
    const fileID = segs[0];
    const newEntityName = segs[1];
    const headUUID = segs[2];

    // ── Legacy logic unchanged ────────────────────────────────────────────────
    const parent = await getSub(fileID, "su", dynamodb);
    setIsPublic(parent.Items[0].z);
    const eParent = await getEntity(parent.Items[0].e, dynamodb);

    const e = await incrementCounterAndGetNewValue("eCounter", dynamodb);
    const aNew = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const a = await createWord(aNew.toString(), newEntityName, dynamodb);
    const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);

    await createEntity(
      e.toString(),
      a.toString(),
      details.v,
      eParent.Items[0].g,
      eParent.Items[0].h,
      eParent.Items[0].ai,
      dynamodb
    );

    const uniqueId = await getUUID(uuidv4);

    await createSubdomain(uniqueId, a.toString(), e.toString(), "0", true, dynamodb);

    await createFile(
      uniqueId,
      {
        "input": [{
          "physical": [
            [{}],
            ["ROWRESULT", "000", "NESTED", "000!!", "blocks", [{ "entity": uniqueId, "name": "Primary" }]],
            ["ROWRESULT", "000", "NESTED", "000!!", "modules", {}],
            ["ROWRESULT", "000", "NESTED", "000!!", "actions", [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }]],
            ["ROWRESULT", "000", "NESTED", "000!!", "menu", {}], ["ROWRESULT", "0", "NESTED", "000!!", "function", {}], ["ROWRESULT", "0", "NESTED", "000!!", "automation", []],
            ["ROWRESULT", "000", "NESTED", "000!!", "menu", { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } }],
            ["ROWRESULT", "000", "NESTED", "000!!", "commands", { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } }],
            ["ROWRESULT", "000", "NESTED", "000!!", "calls", { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] }],
            ["ROWRESULT", "000", "NESTED", "000!!", "templates", { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } }],
            ["ROWRESULT", "000", "NESTED", "000!!", "assignments", { "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello5" }, "_mode": "_html" }, "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello6" }, "_mode": "_html" }, "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello7" }, "_mode": "_html" }, "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello8" }, "_mode": "_html" } }]
          ]
        }, { "virtual": [] }], "published": {
          "blocks": [{ "entity": uniqueId, "name": "Primary" }],
          "modules": {},
          "actions": [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }],
          "function": {},
          "automation": [],
          "menu": { "ready": { "_name": "Ready", "_classes": ["Root"], "_show": false, "_selected": true, "options": { "_name": "Options", "_classes": ["ready"], "_show": true, "_selected": false, "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false } }, "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false } } },
          "commands": { "ready": { "call": "ready", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "back": { "call": "back", "ready": true, "updateSpeechAt": true, "timeOut": 0 }, "close": { "call": "close", "ready": false, "updateSpeechAt": true, "timeOut": 0 }, "options": { "call": "options", "ready": false, "updateSpeechAt": true, "timeOut": 0 } },
          "calls": { "ready": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }], "back": [{ "if": [{ "key": ["ready", "_selected"], "expression": "!=", "value": true }], "then": ["ready"], "show": ["ready"], "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }], "close": [{ "if": [], "then": ["ready"], "show": [], "run": [{ "function": "hide", "args": ["menu", 0] }] }], "options": [{ "if": [{ "key": ["ready", "_selected"], "expression": "==", "value": true }], "then": ["ready", "options"], "show": ["options"], "run": [] }] },
          "templates": { "init": { "1": { "rows": { "1": { "cols": ["a", "b"] } } } }, "second": { "2": { "rows": { "1": { "cols": ["c", "d"] } } } } },
          "assignments": {
            "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 1" }, "_mode": "_html" },
            "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 2" }, "_mode": "_html" },
            "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 3" }, "_mode": "_html" },
            "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 4" }, "_mode": "_html" }
          }
        }, "skip": [], "sweeps": 1, "expected": []
      },
      s3
    );

    const updateList = eParent.Items[0].t;
    if (updateList) {
      for (let u in updateList) {
        const target = updateList[u];

        const details24 = await addVersion(target, "-f", eParent.Items[0].e, "1", dynamodb);
        await createOrUpdateEntity(updateList, target); // kept inline with legacy style
        await updateEntityCall(target, "-f", eParent.Items[0].e, details24);

        const details25 = await addVersion(eParent.Items[0].e, "-t", target, "1", dynamodb);
        await updateEntityCall(eParent.Items[0].e, "-t", target, details25);

        const details26 = await addVersion(target, "f", e.toString(), "1", dynamodb);
        await updateEntityCall(target, "f", e.toString(), details26);

        const details27 = await addVersion(e.toString(), "t", target, "1", dynamodb);
        await updateEntityCall(e.toString(), "t", target, details27);
      }
    }

    const details28 = await addVersion(eParent.Items[0].e, "t", e.toString(), "1", dynamodb);
    await updateEntityCall(eParent.Items[0].e, "t", e.toString(), details28);

    const group = eParent.Items[0].g;
    const details3 = await addVersion(e.toString(), "g", group, "1", dynamodb);
    await updateEntityCall(e.toString(), "g", group, details3);

    // final payload mirrors legacy (convertToJSON call & return)
    const mainObj = await convertToJSON(
      headUUID,
      [],
      null,
      null,
      cookie,
      dynamodb,
      uuidv4,
      null,
      [],
      {},
      "",
      dynamodbLL,
      reqBody
    );

    return mainObj;

    // ── tiny in-scope helpers to avoid renames/refactors (keep call sites identical) ──
    async function updateEntityCall(eId, col, val, det) {
      // re-imported via use(); keeping name parity with legacy updateEntity is intentional
      const { updateEntity } = use();
      return updateEntity(eId, col, val, det.v, det.c, dynamodb);
    }
    async function createOrUpdateEntity() { /* noop placeholder matching legacy control flow */ }
  });

  return { name: "extend" };
}

module.exports = { register };
