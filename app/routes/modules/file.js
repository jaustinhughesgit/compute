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


    console.log("!has1v4r",!has1v4r)
    console.log("!allVerified(verified)",!allVerified(verified))
    if (!has1v4r || !allVerified(verified)) {

      let gi = cookie?.gi && String(cookie.gi) !== "0" ? String(cookie.gi) : null;
      if (!gi) {
        gi = String(await incrementCounterAndGetNewValue("gCounter"));
        await createGroup(gi);
        cookie.gi = gi;
      }

      const eId = String(await incrementCounterAndGetNewValue("eCounter"));
      await createEntity(eId, gi);
      const suID = await getUUID(deps?.uuidv4);
      const su = await createSubdomain(suID, eId);
      sendBack(
        res,
        "json",
        { ok: true, response: { existing: true, entity: su, cookie } },
        false
      );
      return { __handled: true };

    }

    const actionFile = (String(path || "").split("/")[1] || "").trim();

    const reqBody = legacyWrapBody(req);
    const converted = await convertToJSON(
      actionFile,
      [],                 // parentPath
      null,               // isUsing
      null,               // mapping
      cookie,
      dynamodb,
      uuidv4,
      null,               // pathID
      [],                 // parentPath2
      {},                 // id2Path
      "",                 // usingID
      dynamodbLL,
      reqBody,            // body (legacy-compatible)
      ""                  // substitutingID
    );

    const tasksUnix = await getTasks(actionFile, "su", dynamodb);
    const tasksISO = typeof getTasksIOS === "function" ? getTasksIOS(tasksUnix) : tasksUnix;
    converted.tasks = tasksISO;

    const response = converted;
    response.existing = cookie?.existing;
    response.file = actionFile + "";

    const expires = 90_000;

    const head = await getHead("su", actionFile, dynamodb);
    const isPublic = !!(head?.Items?.[0]?.z);
    const url = `https://${fileLocation(isPublic)}.1var.com/${actionFile}`;

    const policy = JSON.stringify({
      Statement: [{
        Resource: url,
        Condition: {
          DateLessThan: { "AWS:EpochTime": Math.floor((Date.now() + expires) / 1000) }
        }
      }]
    });

    if (type === "url" || req?.type === "url" || req?.query?.type === "url") {
      const signedUrl = signer.getSignedUrl({ url, policy });
      sendBack(res, "json", { signedUrl }, false);
      return { __handled: true };
    }

    const cookies = signer.getSignedCookie({ policy });
    Object.entries(cookies).forEach(([name, val]) => {
      res.cookie(name, val, {
        maxAge: expires,
        httpOnly: true,
        domain: ".1var.com",
        secure: true,
        sameSite: "None",
      });
    });

    sendBack(res, "json", { ok: true, response }, false);
    return { __handled: true };
  });

  return { name: "file" };
}

module.exports = { register };
