// modules/add.js
"use strict";

/**
 * Creates a new child Entity + Word under a parent Subdomain (su),
 * creates a new subdomain for the child, seeds an initial file,
 * links parent<->child (t/f), sets child's group (g), and
 * (optionally) returns the refreshed tree for a provided head su.
 *
 * Route shape it expects (already normalized by router):
 *   /<parentSU>/<newEntityName>/<headSU?>
 *
 * Examples:
 *   /1v4rabc123/New%20Thing/1v4rroot999
 *   /1v4rabc123/New%20Thing               // no head su → no tree emitted
 */
function register({ on, use }) {
  const {
    // domain
    getSub, getEntity,
    // versions/entities/words/groups
    incrementCounterAndGetNewValue, addVersion, updateEntity,
    createWord, createEntity, createSubdomain,
    // files / s3
    createFile,
    // utils
    getUUID,
    // tree
    convertToJSON,
    // raw deps if ever needed
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  on("add", async (ctx /*, meta */) => {
    const { path } = ctx;

    // Parse: "/<parentSU>/<newEntityName>/<headSU?>"
    const segs = String(path || "/").split("/").filter(Boolean);
    const parentSU = segs[0] || "";
    const rawName  = segs[1] || "";
    const headSU   = segs[2] || ""; // optional

    if (!parentSU || !rawName) {
      return { ok: false, error: "usage: /<parentSU>/<newEntityName>/<headSU?>" };
    }

    const newEntityName = decodeURIComponent(rawName).trim();
    if (!newEntityName) {
      return { ok: false, error: "newEntityName empty" };
    }

    // Look up parent sub + entity
    const parentSub = await getSub(parentSU, "su");
    if (!parentSub?.Items?.length) {
      return { ok: false, error: "parent-subdomain-not-found", parentSU };
    }

    const parentEId = String(parentSub.Items[0].e);
    const parentZ   = !!parentSub.Items[0].z; // visibility
    const eParent   = await getEntity(parentEId);
    if (!eParent?.Items?.length) {
      return { ok: false, error: "parent-entity-not-found", parentEId };
    }

    const parentEntity = eParent.Items[0];

    // Allocate ids
    const eIdNum = await incrementCounterAndGetNewValue("eCounter");
    const wIdNum = await incrementCounterAndGetNewValue("wCounter");
    const eId    = String(eIdNum);
    const aId    = String(wIdNum);

    // Create the word for the new entity
    await createWord(aId, newEntityName);

    // Version the new entity's "a" (word) field
    const aDetails = await addVersion(eId, "a", aId, null);

    // Create the new entity in same group/head/ai as parent
    await createEntity(
      eId,
      aId,
      aDetails.v,
      String(parentEntity.g),
      String(parentEntity.h),
      parentEntity.ai,
    );

    // Create a new subdomain id for the child + seed an initial file
    const childSU = await getUUID(deps?.uuidv4); // shared helper accepts uuidv4 from deps
    await createSubdomain(childSU, aId, eId, "0", parentZ);

    // Seed the file (kept close to the legacy structure for compatibility)
    const initialFile = {
      input: [],
      published: {
        blocks: [{ entity: childSU, name: "Primary" }],
        modules: {},
        actions: [
          {
            target: "{|res|}!",
            chain: [{ access: "send", params: ["{|entity|}"] }],
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
          ready:  { call: "ready",  ready: false, updateSpeechAt: true, timeOut: 0 },
          back:   { call: "back",   ready: true,  updateSpeechAt: true, timeOut: 0 },
          close:  { call: "close",  ready: false, updateSpeechAt: true, timeOut: 0 },
          options:{ call: "options",ready: false, updateSpeechAt: true, timeOut: 0 },
        },
        calls: {
          ready:  [{ if: [{ key: ["ready","_selected"], expression: "==", value: true }], then: ["ready"],  show: ["ready"],  run: [{ function: "show", args: ["menu", 0], custom: false }] }],
          back:   [{ if: [{ key: ["ready","_selected"], expression: "!=", value: true }], then: ["ready"],  show: ["ready"],  run: [{ function: "highlight", args: ["ready", 0], custom: false }] }],
          close:  [{ if: [], then: ["ready"], show: [], run: [{ function: "hide", args: ["menu", 0] }] }],
          options:[{ if: [{ key: ["ready","_selected"], expression: "==", value: true }], then: ["ready","options"], show: ["options"], run: [] }],
        },
        templates: {
          init:   { "1": { rows: { "1": { cols: ["a","b"] } } } },
          second: { "2": { rows: { "1": { cols: ["c","d"] } } } },
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

    await createFile(childSU, initialFile);

    // Link parent → child (t) and child → parent (f)
    {
      const linkToChild = await addVersion(parentEId, "t", eId, String(parentEntity.c));
      await updateEntity(parentEId, "t", eId, linkToChild.v, linkToChild.c);

      const linkToParent = await addVersion(eId, "f", parentEId, "1");
      await updateEntity(eId, "f", parentEId, linkToParent.v, linkToParent.c);
    }

    // Put child into parent's group (g)
    {
      const gDetails = await addVersion(eId, "g", String(parentEntity.g), "1");
      await updateEntity(eId, "g", String(parentEntity.g), gDetails.v, gDetails.c);
    }

    // Optionally emit a refreshed tree for headSU (keeps legacy behavior)
    let tree = null;
    if (headSU) {
      try {
        // shared.convertToJSON has a few legacy signatures across codepaths;
        // prefer the simplest call; ignore failure (still return created ids).
        tree = await convertToJSON(headSU);
      } catch (err) {
        // Non-fatal: just omit tree if helper signature differs in your build.
        tree = null;
      }
    }

    return {
      ok: true,
      action: "add",
      parent: { su: parentSU, e: parentEId, public: parentZ },
      created: { su: childSU, e: eId, a: aId, name: newEntityName },
      head: headSU || null,
      tree, // may be null if convertToJSON signature differs
    };
  });

  return { name: "add" };
}

module.exports = { register };
