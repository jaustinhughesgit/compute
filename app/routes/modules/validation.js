// server/modules/validation.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers
    getSub, getEntity, getVerified, manageCookie, convertToJSON, sendBack,
    setIsPublic,
    incrementCounterAndGetNewValue,
    createWord, createGroup, createAccess, createVerified,
    createSubdomain, addVersion, createEntity, createFile,
    getUUID, fileLocation, getHead,
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  async function verifyForEntity(entityId, cookie, dynamodb) {
    // Mirrors logic in modules/file.js (shortened for entity-only check)
    const verifications = await getVerified("gi", cookie?.gi?.toString?.(), dynamodb);
    let verValue = false;

    const sub = await getSub(entityId, "su", dynamodb);
    if ((sub.Items || []).length === 0) return false;

    const groupID  = sub.Items[0].g;
    const entityID = sub.Items[0].e;

    // public?
    if (sub.Items[0].z) return true;

    // entity public?
    if (entityID !== "0") {
      const eSub = await getEntity(entityID, dynamodb);
      if (String(eSub.Items?.[0]?.ai) === "0") return true;
    }

    // check verified rows
    const now = Math.floor(Date.now() / 1000);
    for (const row of (verifications.Items || [])) {
      if (entityID !== "0") {
        if (entityID == row.e && row.bo && now < row.ex) { verValue = true; break; }
      }
      if (groupID == row.g && row.bo && now < row.ex) { verValue = true; break; }
      if (entityID == "0" && groupID == "0") { verValue = true; break; }
    }
    return verValue;
  }

  async function makeNewGroupAndEntity(ctx, ensuredCookie) {
    const { dynamodb, dynamodbLL, uuidv4, s3, ses } = deps;

    // keep public creation parity with newGroup.js
    setIsPublic(true);

    // names: use compact predictable defaults
    const newGroupName  = "Group";
    const headEntityName= "Home";

    // Create words/ids
    const aNewG = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aG    = await createWord(aNewG.toString(), newGroupName, dynamodb);

    const aNewE = await incrementCounterAndGetNewValue("wCounter", dynamodb);
    const aE    = await createWord(aNewE.toString(), headEntityName, dynamodb);

    const gNew  = await incrementCounterAndGetNewValue("gCounter", dynamodb);
    const e     = await incrementCounterAndGetNewValue("eCounter", dynamodb);
    const ai    = await incrementCounterAndGetNewValue("aiCounter", dynamodb);

    // Access + verified (same values as newGroup.js)
    await createAccess(
      ai.toString(), gNew.toString(), "0",
      { count: 1, metric: "year" }, 10,
      { count: 1, metric: "minute" }, {}, "rwado"
    );

    const ttlSeconds = 90000;
    const ex = Math.floor(Date.now() / 1000) + ttlSeconds;
    const vi = await incrementCounterAndGetNewValue("viCounter", dynamodb);

    await createVerified(
      vi.toString(),
      ensuredCookie.gi.toString(),
      gNew.toString(),
      "0",
      ai.toString(),
      "0",
      ex,    // expiry
      true,  // bo
      0,     // at
      0      // ti
    );

    // Group + head entity + doc
    await createGroup(gNew.toString(), aG, e.toString(), [ai.toString()], dynamodb);

    const suRoot = await getUUID(uuidv4);
    await createSubdomain(suRoot, "0", "0", gNew.toString(), true, dynamodb);

    const vHead = await addVersion(e.toString(), "a", aE.toString(), null, dynamodb);
    await createEntity(
      e.toString(), aE.toString(), vHead.v,
      gNew.toString(), e.toString(), [ai.toString()], dynamodb
    );

    const suDoc = await getUUID(uuidv4);

    const payload = {
      input: [],
      published: {
        blocks: [{ entity: suDoc, name: "Primary" }],
        modules: {}, actions: [], function: {}, automation: [],
        menu: { ready: { _name: "Ready", _classes: ["Root"], _show: false, _selected: true, options: { _name:"Options", _classes:["ready"], _show:true, _selected:false, back:{_name:"Back", _classes:["options"], _show:false, _selected:false}}, close: { _name:"Close", _classes:["ready"], _show:false, _selected:false } } },
        commands: { ready:{call:"ready",ready:false,updateSpeechAt:true,timeOut:0}, back:{call:"back",ready:true,updateSpeechAt:true,timeOut:0}, close:{call:"close",ready:false,updateSpeechAt:true,timeOut:0}, options:{call:"options",ready:false,updateSpeechAt:true,timeOut:0} },
        calls: { ready:[{if:[{key:["ready","_selected"],expression:"==",value:true}],then:["ready"],show:["ready"],run:[{function:"show",args:["menu",0],custom:false}]}] },
        templates:{}, assignments:{}, mindsets:[], thoughts:{ [suDoc]: { owners:[], content:"", contentType:"text", moods:{}, selectedMood:"" } }, moods:[]
      },
      skip:[], sweeps:1, expected:[]
    };

    await createSubdomain(suDoc, aE.toString(), e.toString(), "0", true, dynamodb);
    await createFile(suDoc, payload, s3);

    // Build URL (public bucket if head.z true)
    const url = `https://${fileLocation(true)}.1var.com/${suDoc}`; // we’ll redirect to pretty path below
    return { newEntityId: suDoc, prettyUrl: `https://1var.com/${suDoc}` };
  }

  on("validation", async (ctx, { cookie }) => {
    const { req, res } = ctx;
    const { dynamodb, uuidv4 } = deps;

    // Ensure/mint cookie (also attaches Set-Cookie if needed)
    const ensuredCookie =
      cookie?.gi ? cookie : await manageCookie({}, ctx.xAccessToken, ctx.res, dynamodb, uuidv4);

    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const entity = segs[0]; // /validation/<entity>
    if (!entity) {
      return sendBack(res, "json", { ok: true, response: { valid: false, reason: "missing_entity", obj: {} } }, false);
    }

    const isValid = await verifyForEntity(entity, ensuredCookie, dynamodb);

    if (isValid) {
      // mirror shape worker expects: obj[entity].verified === true
      return sendBack(res, "json", {
        ok: true,
        response: {
          valid: true,
          obj: { [entity]: { verified: true } }
        }
      }, false);
    }

    // invalid → create new group+entity and refresh cookie (manageCookie above already ensured)
    const { newEntityId, prettyUrl } = await makeNewGroupAndEntity(ctx, ensuredCookie);

    return sendBack(res, "json", {
      ok: true,
      response: {
        valid: false,
        reason: "expired",
        redirect: { entity: newEntityId, url: prettyUrl },
        obj: {} // no verified entity here
      }
    }, false);
  });

  return { name: "validation" };
}

module.exports = { register };
