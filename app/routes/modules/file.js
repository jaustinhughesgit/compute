"use strict";

function register({ on, use }) {
  on("file", async (ctx, { cookie }) => {
    const {
      // shared helpers (REUSE, don’t duplicate)
      verifyThis, convertToJSON, getTasks, getTasksIOS,
      fileLocation, getSub, sendBack, // sendBack only if you *really* need to short-circuit
      deps, // { uuidv4, ... }
    } = use();

    const su = String(ctx.path || "").split("/").filter(Boolean)[0];
    if (!su) return { ok: true, response: {} };

    // Ensure we know public/private for signing
    const v = await verifyThis(su, cookie);
    if (!v.verified) return { ok: true, response: {} }; // legacy: empty on no access
    

    // Build the unified tree (enforces permissions)
    const tree = await convertToJSON(
      su, [], null, null, cookie, undefined, deps.uuidv4,
      undefined, [], {}, "", deps.dynamodbLL, ctx.req?.body
    );

    // Attach tasks (normalized)
    const t = await getTasks(su, "su");
    tree.tasks = getTasksIOS(t);

    // Parity fields
    tree.existing = cookie?.existing;
    tree.file = su + "";

    // CloudFront grant (url vs signed cookies)
    const host = `${fileLocation(v.isPublic)}.1var.com`;
    const url  = `https://${host}/${su}`;
    const expiresMs = 90_000;
    const policy = JSON.stringify({
      Statement: [{
        Resource: url,
        Condition: { "DateLessThan": { "AWS:EpochTime": Math.floor((Date.now()+expiresMs)/1000) } }
      }]
    });

    if (ctx.type === "url") {
      const signedUrl = ctx.signer.getSignedUrl({ url, policy });
      return { ok: true, response: { signedUrl } };
    } else {
      const cookies = ctx.signer.getSignedCookie({ policy });
      // set cookies on the response (same options as legacy)
      for (const [name, val] of Object.entries(cookies)) {
        ctx.res.cookie(name, val, {
          maxAge: expiresMs,
          httpOnly: true,
          domain: ".1var.com",
          secure: true,
          sameSite: "None",
        });
      }
      return { ok: true, response: tree };
    }
  });

  return { name: "file" };
}

module.exports = { register };
