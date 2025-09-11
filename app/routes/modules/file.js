// modules/file.js
"use strict";

function register({ on, use }) {
  const {
    getSub, getEntity, getTasks, getVerified,
    convertToJSON, fileLocation, manageCookie, getHead, sendBack,
    incrementCounterAndGetNewValue,
    createGroup, createEntity, createSubdomain,
    getTasksIOS,
    getUUID, createWord,
    deps,
  } = use();


  function allVerified(list) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] !== true) return false;
    }
    return true;
  }

  async function verifyPath(splitPath, verifications, dynamodb) {
    const verified = [];
    let verCounter = 0;

    for (let idx = 0; idx < splitPath.length; idx++) {
      const seg = splitPath[idx];
      if (!seg || !seg.startsWith("1v4r")) continue;

      let verValue = false;
      verified.push(false);

      const sub = await getSub(seg, "su", dynamodb);
      let groupID = sub.Items?.[0]?.g;
      let entityID = sub.Items?.[0]?.e;

      if (sub.Items?.[0]?.z) verValue = true;

      for (let vi = 0; vi < (verifications.Items || []).length; vi++) {
        const row = verifications.Items[vi];

        if (entityID !== "0") {
          const eSub = await getEntity(sub.Items?.[0]?.e, dynamodb);
          groupID = eSub.Items?.[0]?.g;

          if (String(eSub.Items?.[0]?.ai) === "0") verValue = true;
        }

        if ((sub.Items || []).length > 0) {
          if (sub.Items[0].z === true) {
            verValue = true;
          } else {
            const now = Math.floor(Date.now() / 1000);
            if (entityID == row.e && row.bo && now < row.ex) verValue = true;
            else if (groupID == row.g && row.bo && now < row.ex) verValue = true;
            else if (entityID == "0" && groupID == "0") verValue = true;
          }
        }
      }

      verified[verCounter++] = verValue;
    }

    return verified;
  }

  function legacyWrapBody(req) {
    const b = req?.body;
    if (!b || typeof b !== "object") return { body: {} };
    if (b.body && typeof b.body === "object") return b;
    return { body: b };
  }

    on("file", async (ctx /*, meta */) => {
    const { req, res, path, type, signer } = ctx;
    const { dynamodb, dynamodbLL, uuidv4 } = deps;

    const mainObj = {};
    let cookie =
      ctx.cookie ??
      (await manageCookie(mainObj, ctx.xAccessToken, res, dynamodb, uuidv4)) ??
      {};
    if (cookie == null || typeof cookie !== "object") cookie = {};

    let verifications = { Items: [] };
    const cookieGi = cookie?.gi != null ? String(cookie.gi) : "";
    if (cookieGi && cookieGi !== "0") {
      verifications = await getVerified("gi", cookieGi, dynamodb);
    }
    const splitPath = String(path || "").split("/");
    const has1v4r = splitPath.some(seg => seg && seg.startsWith("1v4r"));
    const verified = has1v4r ? await verifyPath(splitPath, verifications, dynamodb) : [];

    if (!has1v4r || !allVerified(verified)) {
      // ✅ use existing gi if present; otherwise mint a new one from giCounter
      let gi = cookie?.gi && String(cookie.gi) !== "0" ? String(cookie.gi) : null;
      const createdNewGroup = !gi;
      if (!gi) {
        gi = String(await incrementCounterAndGetNewValue("giCounter", dynamodb));
        cookie.gi = gi;
      }

      // ✅ create a word (name) for the new entity
      const aId = String(await incrementCounterAndGetNewValue("aCounter", dynamodb));
      await createWord(aId, "Welcome", dynamodb);

      // ✅ create a proper entity: (e, a, v, g, h, ai)
      const eId = String(await incrementCounterAndGetNewValue("eCounter", dynamodb));
      await createEntity(eId, aId, "1", gi, eId, "0", dynamodb);

      // ✅ only create the group record if we just minted a new gi
      if (createdNewGroup) {
        await createGroup(gi, aId, eId, "0", dynamodb);
      }

      // ✅ subdomain must be a "1v4r..." uuid; and pass full signature
      const su = await getUUID(uuidv4); // returns "1v4r" + uuid
      await createSubdomain(su, aId, eId, gi, false, dynamodb);

      sendBack(
        res,
        "json",
        { ok: true, response: { existing: true, entity: su, cookie } },
        false
      );
      return { __handled: true };
    }
  });

  return { name: "file" };
}

module.exports = { register };
