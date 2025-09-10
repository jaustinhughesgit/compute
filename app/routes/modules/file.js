// modules/file.js
//"use strict";

function register({ on, use }) {
  const {
    // shared helpers we need
    getSub, getEntity, getTasks, getVerified,
    convertToJSON, fileLocation, manageCookie, getHead, sendBack,
    getTasksIOS, // ← pulled from shared
    // raw deps (unchanged signatures where used)
    deps, // { dynamodb, dynamodbLL, uuidv4, s3, ses, AWS, openai, Anthropic }
  } = use();

  // ────────────────────────────────────────────────────────────
  // helpers copied verbatim in spirit from old cookies.js
  // (kept local to this module to preserve behavior)
  // ────────────────────────────────────────────────────────────

  function allVerified(list) {
    let v = true;
    for (let l in list) {
      if (list[l] != true) v = false;
    }
    return v;
  }

  async function verifyPath(splitPath, verifications, dynamodb) {
    let verified = [];
    let verCounter = 0;
    for (let ver in splitPath) {
      if (splitPath[ver].startsWith("1v4r")) {
        let verValue = false;
        verified.push(false);

        const sub = await getSub(splitPath[ver], "su", dynamodb);
        let groupID = sub.Items[0]?.g;
        let entityID = sub.Items[0]?.e;

        if (sub.Items[0]?.z) {
          verValue = true;
        }

        for (let veri in (verifications.Items || [])) {
          if (entityID != "0") {
            let eSub = await getEntity(sub.Items[0].e, dynamodb);
            groupID = eSub.Items[0].g;

            if (eSub.Items[0].ai.toString() == "0") {
              verValue = true;
            }
          }
          if (sub.Items.length > 0) {
            if (sub.Items[0].z == true) {
              verValue = true;
            } else if (entityID == verifications.Items[veri].e && verifications.Items[veri].bo) {
              const ex = Math.floor(Date.now() / 1000);
              if (ex < verifications.Items[veri].ex) verValue = true;
            } else if (groupID == verifications.Items[veri].g && verifications.Items[veri].bo) {
              const ex = Math.floor(Date.now() / 1000);
              if (ex < verifications.Items[veri].ex) verValue = true;
            } else if (entityID == "0" && groupID == "0") {
              verValue = true;
            }
          }
        }

        verified[verCounter] = verValue;
        verCounter++;
      }
    }
    return verified;
  }

  // Legacy body compatibility: accept flattened req.body or legacy { body: {...} }
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

    // 1) Legacy cookie/auth & path verification (strict parity)
    const mainObj = {};
    const cookie = await manageCookie(mainObj, ctx.xAccessToken, res, dynamodb, uuidv4);
    const verifications = await getVerified("gi", cookie.gi?.toString?.(), dynamodb);

    // Use the module-tail path for verification; still matches legacy behavior
    const splitPath = String(path || "").split("/");
    const verified = await verifyPath(splitPath, verifications, dynamodb);
    const allV = allVerified(verified);
    if (!allV) {
      // same empty fall-through as legacy when not verified
      sendBack(res, "json", {}, false);
      return { __handled: true };
    }

    // 2) Extract the "file id" as in old code: reqPath.split("/")[3]
    //    Here, modules get "/<su>[/...]" so index 1 is the id.
    const actionFile = (String(path || "").split("/")[1] || "").trim();

    // 3) Convert to JSON (unchanged signature; pass legacy-shaped body)
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

    // 4) Tasks enrichment (strict parity)
    const tasksUnix = await getTasks(actionFile, "su", dynamodb);
    const tasksISO = getTasksIOS(tasksUnix);
    converted["tasks"] = tasksISO;

    // 5) Build legacy response container
    const response = converted;
    response["existing"] = cookie.existing;
    response["file"] = actionFile + "";

    // 6) CloudFront signed URL / signed cookies (identical logic/shape)
    const expires = 90_000;

    // Preserve original bucket selection semantics by deriving from head.z
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

    if (type === "url") {
      const signedUrl = signer.getSignedUrl({ url, policy });
      sendBack(res, "json", { signedUrl }, false);
      return { __handled: true };
    }

    // signed-cookies branch
    const cookies = signer.getSignedCookie({ policy });
    Object.entries(cookies).forEach(([name, val]) => {
      res.cookie(name, val, {
        maxAge: expires,
        httpOnly: true,
        domain: ".1var.com",
        secure: true,
        sameSite: "None"
      });
    });

    sendBack(res, "json", { ok: true, response }, false);
    return { __handled: true };
  });

  return { name: "file" };
}

module.exports = { register };
