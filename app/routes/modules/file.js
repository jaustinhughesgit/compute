// modules/file.js
"use strict";

function register({ on, use }) {
  const {
    // shared helpers we need
    getSub, getEntity, getTasks, getVerified,
    convertToJSON, fileLocation, manageCookie, getHead, sendBack,
    // extra helpers for bootstrap
    incrementCounterAndGetNewValue,
    createGroup, createEntity, createSubdomain,
    getTasksIOS, // may or may not exist on shared; we guard below
    // raw deps
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // ────────────────────────────────────────────────────────────
  // helpers kept close to preserve old behavior
  // ────────────────────────────────────────────────────────────

  function allVerified(list) {
    // list is an Array<boolean>
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

          // "ai" is "access index"? In legacy: if == "0" → public
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

  // Accept flattened req.body or legacy { body: {...} }
  function legacyWrapBody(req) {
    const b = req?.body;
    if (!b || typeof b !== "object") return { body: {} };
    if (b.body && typeof b.body === "object") return b; // already legacy shape
    return { body: b };
  }

  // ────────────────────────────────────────────────────────────
  // main action: file
  // ────────────────────────────────────────────────────────────
  on("file", async (ctx /*, meta */) => {
    const { req, res, path, type, signer } = ctx;
    const { dynamodb, dynamodbLL, uuidv4 } = deps;

    // 1) Cookie/auth (prefer the one minted by cookies.js middleware)
    const mainObj = {};
    // Use let and ensure we always have a plain object
    let cookie =
      ctx.cookie ??
      (await manageCookie(mainObj, ctx.xAccessToken, res, dynamodb, uuidv4)) ??
      {};
    if (cookie == null || typeof cookie !== "object") cookie = {};

    // 2) Authorization checks — strict parity with old logic
    // Guard: only query when we actually have a group id
    let verifications = { Items: [] };
    const cookieGi = cookie?.gi != null ? String(cookie.gi) : "";
    if (cookieGi && cookieGi !== "0") {
      verifications = await getVerified("gi", cookieGi, dynamodb);
    }
    const splitPath = String(path || "").split("/");
    const has1v4r = splitPath.some(seg => seg && seg.startsWith("1v4r"));
    const verified = has1v4r ? await verifyPath(splitPath, verifications, dynamodb) : [];

if (!has1v4r || !allVerified(verified)) {
  // ────────────────────────────────────────────────────────────
  // BOOTSTRAP for first-time / unauthenticated users
  // - ensure the visitor has a group id (gi)
  // - mint/return a valid subdomain uuid (1v4r…) via manageCookie
  // - return { existing: true, entity: <su>, cookie: <cookie> }
  //   so the worker can redirect
  // NOTE: We keep response.obj empty so worker won't try to GET the file yet.
  // ────────────────────────────────────────────────────────────

    // Let shared.manageCookie handle correct bootstrap (it uses getUUID → "1v4r...").
    if (!cookie?.entity || !String(cookie.entity).startsWith("1v4r")) {
      cookie = (await manageCookie({}, ctx.xAccessToken, res, dynamodb, uuidv4)) || {};
    }
    const su = String(cookie.entity); // guaranteed "1v4r..." here

    // Tell the worker this is a "new session" so it can redirect.
    // IMPORTANT: keep response.obj empty to avoid the normal load path.
    sendBack(
      res,
      "json",
      { ok: true, response: { existing: true, entity: su, cookie } },
      false
    );
    return { __handled: true };

}

    // 3) Extract the "file id" like old code: first segment after action
    const actionFile = (String(path || "").split("/")[1] || "").trim();

    // 4) convertToJSON with legacy-shaped body
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

    // 5) Tasks enrichment (guard if helper missing)
    const tasksUnix = await getTasks(actionFile, "su", dynamodb);
    const tasksISO = typeof getTasksIOS === "function" ? getTasksIOS(tasksUnix) : tasksUnix;
    converted.tasks = tasksISO;

    // 6) Legacy response container
    const response = converted;
    response.existing = cookie?.existing;
    response.file = actionFile + "";

    // 7) CloudFront signed URL / signed cookies
    const expires = 90_000;

    // Determine bucket from head.z (legacy parity)
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

    // When the route is /url/file/... or ?type=url we return a direct signed URL
    if (type === "url" || req?.type === "url" || req?.query?.type === "url") {
      const signedUrl = signer.getSignedUrl({ url, policy });
      sendBack(res, "json", { signedUrl }, false);
      return { __handled: true };
    }

    // Otherwise issue signed cookies for the CloudFront policy
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
