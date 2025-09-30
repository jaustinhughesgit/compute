// modules/email.js
"use strict";

/*
Action: sendEmail
Body:
{
  "recipientEmail": "jane@example.com",                 // REQUIRED - real email address
  "recipientHash": "dc67...03ff3",                      // REQUIRED - lookup key (users GSI emailHashIndex)
  "senderHash": "ab12...9f",                            // REQUIRED - sender id/hash
  "senderName": "John Smith",                           // OPTIONAL (default "A 1var user")
  "subject": "Hello from John",                         // OPTIONAL (generalEmail)
  "messageText": "Hey!",                                // OPTIONAL (generalEmail)
  "messageHtml": "<p>Hey!</p>",                         // OPTIONAL (generalEmail)
  "previewText": "Hey Austin. Are we biking today?",    // OPTIONAL (initEmail invite preview)
  "fromEmail": "noreply@email.1var.com",                // OPTIONAL (SES verified)
  "fromName": "1 VAR",                                  // OPTIONAL
  "brand": "1var",                                      // OPTIONAL
  "linksHost": "https://email.1var.com",                // OPTIONAL - for /opt-in and /stop links
  "apiHost": "https://abc.api.1var.com"                 // OPTIONAL - for one-click POST unsubscribe
}
*/

function register({ on, use }) {
  const {
    getDocClient,
    getSES,
    hashEmail,
    normalizeEmail,
    manageCookie,
  } = use();

  const unwrapBody = (b) => (b && typeof b === "object" && b.body && typeof b.body === "object") ? b.body : b;

  const setToArray = (maybeSet) => {
    if (!maybeSet) return [];
    if (Array.isArray(maybeSet)) return maybeSet;                 // already array
    if (maybeSet.values && Array.isArray(maybeSet.values)) return maybeSet.values; // DocumentClient Set
    return [];
  };

  const isBlocked = (user, senderHash) => {
    if (!user) return false;
    if (user.blockAll === true) return true;
    const blacklist = setToArray(user.blacklist);
    const whitelist = setToArray(user.whitelist);
    const listedB  = senderHash && blacklist.includes(senderHash);
    const listedW  = senderHash && whitelist.includes(senderHash);
    if (user.whitelistAll === true) return false; // allow all
    if (listedW) return false;                    // explicit allow
    if (listedB) return true;                     // explicit block
    return false;                                 // default allow
  };

  const buildRawEmail = ({ from, to, subject, html, text, listUnsubUrl, listUnsubPost }) => {
    const boundary = "=_1var_" + Date.now();
    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      listUnsubUrl ? `List-Unsubscribe: <${listUnsubUrl}>` : null,
      listUnsubPost ? `List-Unsubscribe-Post: List-Unsubscribe=One-Click` : null,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter(Boolean).join("\r\n");

    const parts = [
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      text || "",
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      html || "",
      ``,
      `--${boundary}--`,
      ``,
    ].join("\r\n");

    return `${headers}\r\n\r\n${parts}`;
  };

  const escapeHtml = (s) =>
    String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const escapeHeader = (s) => String(s).replace(/"/g, '\\"');

  // --- INTERNAL: create/ensure user via manageCookie (no cookie sent back) & send invite ---
  async function initEmail(ddb, ses, input, ctx) {
    console.log(">>>initEmail",initEmail)
    const {
      recipientEmail, recipientHash, senderHash, senderName = "A 1var user",
      previewText = "", fromEmail = "noreply@email.1var.com", fromName = "1 VAR",
      brand = "1var", linksHost = "https://email.1var.com", apiHost = "https://abc.api.1var.com",
    } = input;

    // Standardize new-user setup via manageCookie.
    // IMPORTANT: do not set a browser cookie on the SENDER. We pass blockCookieBack: true
    // and provide a null `res` so manageCookie won’t call `res.cookie(...)`.
    const blockCookieBack = true;
    const mcMain = {
      reason: "sendEmail:initEmail",
      recipientEmail,
      recipientHash,
      senderHash,
      blockCookieBack, // future-proofing: also passed into manageCookie
    };
    // If you later want to conditionally allow cookie setting, swap null with ctx?.res
    const resForCookie = blockCookieBack ? null : ctx?.res || null;
    let mc;
    try {
      mc = await manageCookie(mcMain, null, resForCookie, ddb);
    } catch (err) {
      console.error("manageCookie failed during initEmail", err);
      throw err;
    }

    const e = mc?.e ? String(mc.e) : undefined;

    // Ensure GSI lookup by hashed recipient email continues to work:
    // upsert the users row for this userID with emailHash = recipientHash.
    if (e) {
      try {
        await ddb.update({
          TableName: "users",
          Key: { userID: Number(e) },
          UpdateExpression:
            "SET emailHash = :eh, " +
            "    pubEnc = if_not_exists(pubEnc, :ne), " +
            "    pubSig = if_not_exists(pubSig, :ns), " +
            "    created = if_not_exists(created, :now), " +
            "    revoked = if_not_exists(revoked, :rv), " +
            "    latestKeyVersion = if_not_exists(latestKeyVersion, :kv)",
          ExpressionAttributeValues: {
            ":eh": recipientHash,
            ":ne": null,
            ":ns": null,
            ":now": Date.now(),
            ":rv": false,
            ":kv": 1,
          },
        }).promise();
      } catch (err) {
        console.warn("users upsert after manageCookie failed (non-fatal)", err);
      }
    }

    // Invite links
    const allowUrl       = `${linksHost}/opt-in/${encodeURIComponent(recipientHash)}/${encodeURIComponent(senderHash)}`;
    const blockSenderUrl = `${linksHost}/stop/${encodeURIComponent(recipientHash)}/${encodeURIComponent(senderHash)}`;
    const blockAllUrl    = `${linksHost}/stop/${encodeURIComponent(recipientHash)}`;
    const listUnsubPost  = `${apiHost}/cookies/stop/${encodeURIComponent(recipientHash)}`;

    const subject = `${senderName} invited you to receive messages from ${brand}`;
    const textBody =
`You’re getting this one-time invite because ${senderName} entered your email on ${brand}.
We won’t email you again about ${senderName} unless you choose to allow messages.

Preview of ${senderName}'s message:
${previewText ? `"${previewText}"` : "(no preview provided)"}

Do you want to receive messages from ${senderName}?
Allow: ${allowUrl}

Don’t want messages from ${senderName}?
Block ${senderName}: ${blockSenderUrl}

Stop all emails from ${brand}:
Block all: ${blockAllUrl}

${brand.toUpperCase()} • 11010 Lake Grove Blvd Ste 100-440, Morrisville, NC 27560
Privacy: https://1var.com/privacy`;

    const htmlBody =
`<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">
  <p>You’re getting this one-time invite because <b>${escapeHtml(senderName)}</b> entered your email on ${escapeHtml(brand)}.
     We won’t email you again about ${escapeHtml(senderName)} unless you choose to allow messages.</p>
  <p><b>Preview of ${escapeHtml(senderName)}’s message:</b><br>
     ${previewText ? `<em>"${escapeHtml(previewText)}"</em>` : "(no preview provided)"}
  </p>
  <p><b>Do you want to receive messages from ${escapeHtml(senderName)}?</b><br>
     <a href="${allowUrl}">Allow</a>
  </p>
  <p><b>Don’t want messages from ${escapeHtml(senderName)}?</b><br>
     <a href="${blockSenderUrl}">Block ${escapeHtml(senderName)}</a>
  </p>
  <p><b>Stop all emails from ${escapeHtml(brand)}:</b><br>
     <a href="${blockAllUrl}">Block all</a>
  </p>
  <hr>
  <p style="color:#666;font-size:12px;">
    ${brand.toUpperCase()} • 11010 Lake Grove Blvd Ste 100-440, Morrisville, NC 27560<br>
    Privacy: <a href="https://1var.com/privacy">https://1var.com/privacy</a>
  </p>
</div>`;

    const fromHeader = fromName ? `"${escapeHeader(fromName)}" <${fromEmail}>` : fromEmail;
    const raw = buildRawEmail({
      from: fromHeader,
      to: recipientEmail,
      subject,
      html: htmlBody,
      text: textBody,
      listUnsubUrl: blockAllUrl,
      listUnsubPost,
    });

    const sendRes = await ses.sendRawEmail({ RawMessage: { Data: Buffer.from(raw, "utf-8") } }).promise();

    return { ok: true, createdUser: true, sent: true, messageId: sendRes?.MessageId, userID: Number(e) };
  }

  // --- INTERNAL: for existing users (respect block/allow; send normal email content) ---
  async function generalEmail(ddb, ses, input, userRecord) {
    console.log(">>>generalEmail",generalEmail)
    const {
      recipientEmail, recipientHash, senderHash,
      subject = "You have a new message on 1var",
      messageText = "",
      messageHtml = "",
      senderName = "A 1var user",
      fromEmail = "noreply@email.1var.com",
      fromName = "1 VAR",
      brand = "1var",
      linksHost = "https://email.1var.com",
      apiHost = "https://abc.api.1var.com",
    } = input;

    // Enforce rules
    if (isBlocked(userRecord, senderHash)) {
      return { ok: true, createdUser: false, sent: false, blocked: true, reason: "recipient_has_block_rule" };
    }

    // Provide convenient block links in footer
    const blockSenderUrl = `${linksHost}/stop/${encodeURIComponent(recipientHash)}/${encodeURIComponent(senderHash)}`;
    const blockAllUrl    = `${linksHost}/stop/${encodeURIComponent(recipientHash)}`;
    const listUnsubPost  = `${apiHost}/cookies/stop/${encodeURIComponent(recipientHash)}`;

    const finalText =
`${messageText || "(no text provided)"}

—
Don’t want more from ${senderName}? ${blockSenderUrl}
Block all ${brand} emails: ${blockAllUrl}
`;

    const finalHtml =
messageHtml && messageHtml.trim()
  ? `${messageHtml}
<hr>
<p style="font:12px/1.5 Arial,Helvetica,sans-serif;color:#666;">
Don’t want more from ${escapeHtml(senderName)}? <a href="${blockSenderUrl}">Block ${escapeHtml(senderName)}</a><br>
Block all ${escapeHtml(brand)} emails: <a href="${blockAllUrl}">Block all</a>
</p>`
  : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">
<p>(no HTML content provided)</p>
<hr>
<p style="font:12px/1.5 Arial,Helvetica,sans-serif;color:#666;">
Don’t want more from ${escapeHtml(senderName)}? <a href="${blockSenderUrl}">Block ${escapeHtml(senderName)}</a><br>
Block all ${escapeHtml(brand)} emails: <a href="${blockAllUrl}">Block all</a>
</p>
</div>`;

    const fromHeader = fromName ? `"${escapeHeader(fromName)}" <${fromEmail}>` : fromEmail;
    const raw = buildRawEmail({
      from: fromHeader,
      to: recipientEmail,
      subject,
      html: finalHtml,
      text: finalText,
      listUnsubUrl: blockAllUrl,
      listUnsubPost,
    });

    const sendRes = await ses
      .sendRawEmail({ RawMessage: { Data: Buffer.from(raw, "utf-8") } })
      .promise();
    return {
      ok: true,
      createdUser: false, // existing user path
      sent: true,
      messageId: sendRes?.MessageId,
      userID: (userRecord?.userID != null) ? Number(userRecord.userID) : undefined,
    };  
  }

  // Resolve the sender's *real* emailHash from a subdomain 'su'
async function resolveSenderEmailHash(ddb, senderSu) {
  if (!senderSu) return null;

  try {
    // 1) subdomains.su -> subdomains.e
    const sub = await ddb.query({
      TableName: "subdomains",
      KeyConditionExpression: "su = :su",
      ExpressionAttributeValues: { ":su": senderSu },
      Limit: 1,
    }).promise();

    const subItem = sub.Items?.[0];
    if (!subItem || !subItem.e) return null;

    const e = Number(subItem.e);

    // 2) users.userID (= e) -> users.emailHash
    // Prefer get() since userID is the table key
    const userRes = await ddb.get({
      TableName: "users",
      Key: { userID: e },
    }).promise();

    const emailHash = userRes?.Item?.emailHash;
    if (!emailHash) return null;

    return { emailHash, userID: e };
  } catch (err) {
    console.warn("resolveSenderEmailHash failed", err);
    return null;
  }
}


  // --- ACTION: decide path → initEmail (new) vs generalEmail (existing) ---
on("sendEmail", async (ctx /*, meta */) => {
  const ddb = getDocClient();
  const ses = getSES();
  const input = unwrapBody(ctx.req?.body) || {};

  const recipientEmail = normalizeEmail(input.recipientEmail);
  const serverHash     = hashEmail(recipientEmail);
  const recipientHashFromClient = String(input.recipientHash || "").trim();
  const recipientHash  = serverHash; // always use server-computed hash
  if (recipientHashFromClient && recipientHashFromClient !== serverHash) {
    console.warn("sendEmail: recipientHash mismatch; using server-computed hash");
  }

  // The client-supplied "senderHash" is actually subdomain.su
  const senderSu = String(input.senderHash || "").trim();

  console.log("recipientEmail", recipientEmail);
  console.log("recipientHash", recipientHash);
  console.log("senderSu", senderSu);

  if (!recipientEmail || !senderSu) {
    return { ok: false, error: "recipientEmail and senderHash are required" };
  }

  // --- NEW: resolve subdomain.su -> users.emailHash (the *real* sender hash) ---
  let senderEmailHash = senderSu; // safe fallback if resolution fails
  try {
    const resolved = await resolveSenderEmailHash(ddb, senderSu);
    if (resolved?.emailHash) senderEmailHash = resolved.emailHash;
  } catch (e) {
    console.warn("sendEmail: could not resolve sender emailHash; using su fallback");
  }

  // Lookup by GSI emailHashIndex for RECIPIENT (unchanged)
  let existingUser = null;
  try {
    const q = await ddb.query({
      TableName: "users",
      IndexName: "emailHashIndex",
      KeyConditionExpression: "emailHash = :eh",
      ExpressionAttributeValues: { ":eh": recipientHash },
      Limit: 1,
    }).promise();
    existingUser = (q.Items && q.Items[0]) || null;
  } catch (err) {
    console.error("sendEmail: emailHashIndex lookup failed", err);
    return { ok: false, error: "lookup_failed" };
  }

  if (!existingUser) {
    // New user → initEmail
    try {
      // IMPORTANT: pass the *resolved* senderEmailHash downstream
      return await initEmail(
        ddb,
        ses,
        { ...input, recipientEmail, recipientHash, senderHash: senderEmailHash },
        ctx
      );
    } catch (err) {
      console.error("sendEmail:initEmail failed", err);
      return { ok: false, error: "init_email_failed" };
    }
  } else {
    // Existing user → generalEmail
    try {
      // IMPORTANT: pass the *resolved* senderEmailHash downstream
      return await generalEmail(
        ddb,
        ses,
        { ...input, recipientEmail, senderHash: senderEmailHash },
        existingUser
      );
    } catch (err) {
      console.error("sendEmail:generalEmail failed", err);
      return { ok: false, error: "general_email_failed" };
    }
  }
});


  return { name: "email" };
}

module.exports = { register };
