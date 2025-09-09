// modules/map.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers (no refactors/renames)
    getSub, getEntity,
    incrementCounterAndGetNewValue,
    createWord, addVersion, createEntity, updateEntity,
    createSubdomain, createFile, convertToJSON,
    setIsPublic,
    getS3,
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  on("map", async (ctx, meta) => {
    const { req, path } = ctx;
    const cookie = (meta && meta.cookie) || {};

    // ── Legacy-identical path parsing (old code used reqPath.split("/")[3..6])
    // In the modular router, ctx.path starts AFTER the action segment.
    // So: [1]=referencedParent, [2]=newEntityName, [3]=mappedParent, [4]=headEntity
    const segs = String(path || "").split("/");
    const referencedParent = segs[1] || "";
    const newEntityName   = segs[2] || "";
    const mappedParent    = segs[3] || "";
    const headEntity      = segs[4] || "";

    // Raw deps (strict parity)
    const dynamodb   = deps.dynamodb;
    const dynamodbLL = deps.dynamodbLL;
    const uuidv4     = deps.uuidv4;           // used directly to keep UUID behavior
    const s3         = getS3();

    // ── Legacy logic verbatim (side effects preserved)
    const subRefParent = await getSub(referencedParent, "su", dynamodb);
    setIsPublic(subRefParent.Items[0].z);

    const subMapParent = await getSub(mappedParent, "su", dynamodb);
    const mpE = await getEntity(subMapParent.Items[0].e, dynamodb);
    const mrE = await getEntity(subRefParent.Items[0].e, dynamodb);

    const e    = await incrementCounterAndGetNewValue("eCounter", dynamodb);
    const aNew = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const a    = await createWord(aNew.toString(), newEntityName, dynamodb);
    const details = await addVersion(e.toString(), "a", a.toString(), null, dynamodb);

    await createEntity(
      e.toString(),
      a.toString(),
      details.v,
      mpE.Items[0].g,
      mpE.Items[0].h,
      mpE.Items[0].ai,
      dynamodb
    );

    const uniqueId = uuidv4();

    await createSubdomain(
      uniqueId,
      a.toString(),
      e.toString(),
      "0",
      true,                  // legacy kept this TRUE
      dynamodb
    );

    // Exact file payload preserved (including all string blobs)
    const filePayload = {
      "input": [{
        "physical": [
          [{}],
          ["ROWRESULT", "000", "NESTED", "000!!", "blocks", [{ "entity": uniqueId, "name": "Primary" }]],
          ["ROWRESULT", "000", "NESTED", "000!!", "modules", {}],
          ["ROWRESULT", "000", "NESTED", "000!!", "actions", [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }]],
          ["ROWRESULT", "000", "NESTED", "000!!", "menu", {}],
          ["ROWRESULT", "0",   "NESTED", "000!!", "function", {}],
          ["ROWRESULT", "0",   "NESTED", "000!!", "automation", []],
          ["ROWRESULT", "000", "NESTED", "000!!", "menu", {
            "ready": {
              "_name": "Ready",
              "_classes": ["Root"],
              "_show": false,
              "_selected": true,
              "options": {
                "_name": "Options",
                "_classes": ["ready"],
                "_show": true,
                "_selected": false,
                "back": {
                  "_name": "Back",
                  "_classes": ["options"],
                  "_show": false,
                  "_selected": false
                }
              },
              "close": {
                "_name": "Close",
                "_classes": ["ready"],
                "_show": false,
                "_selected": false
              }
            }
          }],
          ["ROWRESULT", "000", "NESTED", "000!!", "commands", {
            "ready":  { "call": "ready",  "ready": false, "updateSpeechAt": true, "timeOut": 0 },
            "back":   { "call": "back",   "ready": true,  "updateSpeechAt": true, "timeOut": 0 },
            "close":  { "call": "close",  "ready": false, "updateSpeechAt": true, "timeOut": 0 },
            "options":{ "call": "options","ready": false, "updateSpeechAt": true, "timeOut": 0 }
          }],
          ["ROWRESULT", "000", "NESTED", "000!!", "calls", {
            "ready":  [{ "if": [{ "key": ["ready","_selected"], "expression": "==", "value": true }],
                         "then": ["ready"], "show": ["ready"],
                         "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }],
            "back":   [{ "if": [{ "key": ["ready","_selected"], "expression": "!=", "value": true }],
                         "then": ["ready"], "show": ["ready"],
                         "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }],
            "close":  [{ "if": [], "then": ["ready"], "show": [],
                         "run": [{ "function": "hide", "args": ["menu", 0] }] }],
            "options":[{ "if": [{ "key": ["ready","_selected"], "expression": "==", "value": true }],
                         "then": ["ready","options"], "show": ["options"], "run": [] }]
          }],
          ["ROWRESULT", "000", "NESTED", "000!!", "templates", {
            "init":   { "1": { "rows": { "1": { "cols": ["a","b"] } } } },
            "second": { "2": { "rows": { "1": { "cols": ["c","d"] } } } }
          }],
          ["ROWRESULT", "000", "NESTED", "000!!", "assignments", {
            "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello5" }, "_mode": "_html" },
            "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello6" }, "_mode": "_html" },
            "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello7" }, "_mode": "_html" },
            "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Hello8" }, "_mode": "_html" }
          }]
        ]
      }, { "virtual": [] }],
      "published": {
        "blocks": [{ "entity": uniqueId, "name": "Primary" }],
        "modules": {},
        "actions": [{ "target": "{|res|}!", "chain": [{ "access": "send", "params": ["{|entity|}"] }], "assign": "{|send|}" }],
        "function": {},
        "automation": [],
        "menu": {
          "ready": {
            "_name": "Ready",
            "_classes": ["Root"],
            "_show": false,
            "_selected": true,
            "options": {
              "_name": "Options",
              "_classes": ["ready"],
              "_show": true,
              "_selected": false,
              "back": { "_name": "Back", "_classes": ["options"], "_show": false, "_selected": false }
            },
            "close": { "_name": "Close", "_classes": ["ready"], "_show": false, "_selected": false }
          }
        },
        "commands": {
          "ready":  { "call": "ready",  "ready": false, "updateSpeechAt": true, "timeOut": 0 },
          "back":   { "call": "back",   "ready": true,  "updateSpeechAt": true, "timeOut": 0 },
          "close":  { "call": "close",  "ready": false, "updateSpeechAt": true, "timeOut": 0 },
          "options":{ "call": "options","ready": false, "updateSpeechAt": true, "timeOut": 0 }
        },
        "calls": {
          "ready":  [{ "if": [{ "key": ["ready","_selected"], "expression": "==", "value": true }],
                       "then": ["ready"], "show": ["ready"],
                       "run": [{ "function": "show", "args": ["menu", 0], "custom": false }] }],
          "back":   [{ "if": [{ "key": ["ready","_selected"], "expression": "!=", "value": true }],
                       "then": ["ready"], "show": ["ready"],
                       "run": [{ "function": "highlight", "args": ["ready", 0], "custom": false }] }],
          "close":  [{ "if": [], "then": ["ready"], "show": [],
                       "run": [{ "function": "hide", "args": ["menu", 0] }] }],
          "options":[{ "if": [{ "key": ["ready","_selected"], "expression": "==", "value": true }],
                       "then": ["ready","options"], "show": ["options"], "run": [] }]
        },
        "templates": {
          "init":   { "1": { "rows": { "1": { "cols": ["a","b"] } } } },
          "second": { "2": { "rows": { "1": { "cols": ["c","d"] } } } }
        },
        "assignments": {
          "a": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 1" }, "_mode": "_html" },
          "b": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 2" }, "_mode": "_html" },
          "c": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 3" }, "_mode": "_html" },
          "d": { "_editable": false, "_movement": "move", "_owners": [], "_modes": { "_html": "Box 4" }, "_mode": "_html" }
        }
      },
      "skip": [],
      "sweeps": 1,
      "expected": []
    };

    await createFile(uniqueId, filePayload, s3);

    // mapping updates (unchanged)
    const newM = {};
    newM[mrE.Items[0].e] = e.toString();

    const details2a = await addVersion(
      mpE.Items[0].e.toString(),
      "m",
      newM,
      mpE.Items[0].c,
      dynamodb
    );

    const addM = {};
    addM[mrE.Items[0].e] = [e.toString()];

    await updateEntity(
      mpE.Items[0].e.toString(),
      "m",
      addM,
      details2a.v,
      details2a.c,
      dynamodb
    );

    // Request-body compatibility: support flattened req.body and legacy body.body
    let reqBodyCompat = {};
    const b = req && req.body;
    if (b && typeof b === "object") {
      reqBodyCompat = (b && typeof b.body === "object") ? b : { body: b };
    }

    const mainObj = await convertToJSON(
      headEntity,         // fileID
      [],                 // parentPath
      null,               // isUsing
      null,               // mapping
      cookie,             // cookie for permissions
      dynamodb,
      uuidv4,
      null,               // pathID
      [],                 // parentPath2
      {},                 // id2Path
      "",                 // usingID
      dynamodbLL,
      reqBodyCompat,      // keep legacy compatibility
      ""                  // substitutingID
    );

    // Preserve response shape fields
    mainObj.existing = cookie.existing;
    mainObj.file = String(uniqueId);

    // Old router wrapped in { ok: true, response }
    return { ok: true, response: mainObj };
  });

  return { name: "map" };
}

module.exports = { register };
