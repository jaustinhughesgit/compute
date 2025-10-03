// modules/email.js
"use strict";

/*
Action: sendEmail
Body:
{
  "recipientEmail": "jane@example.com",                 // REQUIRED - real email address
  "recipientHash": "dc67...03ff3",                      // REQUIRED - lookup key (users GSI emailHashIndex)
  "senderHash": "ab12...9f",                            // REQUIRED - sender id/hash (client sends subdomain.su; server resolves)
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

  // --- Reputation constants + helpers -----------------------------------
  // Block-ratio tiers (unique recipients vs. % who blocked)
  const RATIO_TIER_BREAK = 50;          // switch at 50 unique recipients
  const RATIO_THRESHOLD_LOW = 0.05;    // < 50 uniques → 5%
  const RATIO_THRESHOLD_HIGH = 0.02;    // ≥ 50 uniques → 2%
  const DEFAULT_VERIFY_LINKS_HOST = process.env.VERIFY_LINKS_HOST || "https://email.1var.com";
  const DEFAULT_VERIFY_FROM_EMAIL = process.env.VERIFY_FROM_EMAIL || "noreply@email.1var.com";
  const DEFAULT_VERIFY_FROM_NAME = process.env.VERIFY_FROM_NAME || "1 VAR";

  function getBlockRatioThreshold(uniqueSentCount) {
    return (uniqueSentCount >= RATIO_TIER_BREAK) ? RATIO_THRESHOLD_HIGH : RATIO_THRESHOLD_LOW;
  }

  const CONFIG_SET = process.env.SES_CONFIG_SET || "ses-events";

  // NEW: deliverability + metrics configuration
  const SUPPRESS_TABLE = process.env.DELIVERABILITY_BLOCKS_TABLE || "deliverability_blocks"; // NEW
  const METRICS_TABLE = process.env.EMAIL_METRICS_TABLE || "email_metrics_daily";          // NEW
  const RATE_WINDOW_DAYS = 14;                                                              // NEW
  const MIN_RATE_VOLUME = 500;                                                             // NEW
  const BOUNCE_WARN_RATE = 0.02; // 2% → warn/limit                                        // NEW
  const BOUNCE_BLOCK_RATE = 0.05; // 5% → block + review                                   // NEW
  const BOUNCE_HARD_BLOCK_RATE = 0.10; // 10% → hard block                                 // NEW

  const safeNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const unwrapBody = (b) =>
    (b && typeof b === "object" && b.body && typeof b.body === "object") ? b.body : b;

  const setToArray = (maybeSet) => {
    if (!maybeSet) return [];
    if (Array.isArray(maybeSet)) return maybeSet;                 // already array
    if (maybeSet.values && Array.isArray(maybeSet.values)) return maybeSet.values; // DocumentClient Set
    return [];
  };

  // NEW: simple YYYY-MM-DD key
  const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10); // NEW

  // NEW: add to daily metrics (sends / bounces / complaints, etc.)
  async function addDailyMetric(ddb, senderUserID, fields) { // NEW
    if (!(senderUserID > 0) || !fields || typeof fields !== "object") return;
    const day = dayKey();
    const names = Object.keys(fields);
    if (!names.length) return;

    const expr = "ADD " + names.map((n, i) => `#f${i} :v${i}`).join(", ");
    const ExpressionAttributeNames = {};
    const ExpressionAttributeValues = {};
    names.forEach((n, i) => { ExpressionAttributeNames[`#f${i}`] = n; ExpressionAttributeValues[`:v${i}`] = safeNum(fields[n]); });

    await ddb.update({
      TableName: METRICS_TABLE,
      Key: { senderUserID: Number(senderUserID), day },
      UpdateExpression: expr,
      ExpressionAttributeNames,
      ExpressionAttributeValues
    }).promise();
  }

  // NEW: compute last-14-day hard-bounce rate
  async function getBounceRate14d(ddb, senderUserID) { // NEW
    if (!(senderUserID > 0)) return { sends14d: 0, bHard14d: 0, rate: 0 };
    const days = Array.from({ length: RATE_WINDOW_DAYS }, (_, i) => dayKey(Date.now() - i * 86400000));
    const keys = days.map(day => ({ senderUserID: Number(senderUserID), day }));

    const res = await ddb.batchGet({
      RequestItems: {
        [METRICS_TABLE]: { Keys: keys }
      }
    }).promise();

    const items = res?.Responses?.[METRICS_TABLE] || [];
    let sends14d = 0, bHard14d = 0;
    for (const it of items) {
      sends14d += safeNum(it.sends);
      bHard14d += safeNum(it.b_hard);
    }
    const rate = sends14d > 0 ? (bHard14d / sends14d) : 0;
    return { sends14d, bHard14d, rate };
  }

  // NEW: local deliverability suppression check
  async function isDeliverabilitySuppressed(ddb, recipientHash, senderUserID) { // NEW
    if (!recipientHash) return false;
    const keys = [{ recipientHash, scope: "*" }];
    if (senderUserID > 0) keys.push({ recipientHash, scope: String(senderUserID) });

    const res = await ddb.batchGet({
      RequestItems: { [SUPPRESS_TABLE]: { Keys: keys } }
    }).promise();

    const now = Date.now();
    const items = res?.Responses?.[SUPPRESS_TABLE] || [];
    for (const it of items) {
      if (safeNum(it.expiresAt) === 0) return true; // permanent
      if (safeNum(it.expiresAt) > now) return true; // active window
    }
    return false;
  }

  // NEW: scale daily limit if sender is in warn zone
  function scaleDailyLimit(base, sends14d, rate) { // NEW
    if (sends14d >= MIN_RATE_VOLUME && rate >= BOUNCE_WARN_RATE && rate < BOUNCE_BLOCK_RATE) {
      return Math.max(5, Math.ceil(base * 0.5)); // cut by 50% but keep a tiny floor
    }
    return base;
  }

  // Read blocks + uniqueSent count for a user
  async function getUserReputation(ddb, userID) {
    if (!(userID > 0)) return { blocks: 0, uniqueSentCount: 0 };
    const res = await ddb.get({
      TableName: "users",
      Key: { userID: Number(userID) },
      ProjectionExpression: "blocks, uniqueSent",
    }).promise();

    const blocks = safeNum(res?.Item?.blocks);
    const uniqueSentArr = setToArray(res?.Item?.uniqueSent);
    const uniqueSentCount = Array.isArray(uniqueSentArr) ? uniqueSentArr.length : 0;

    return { blocks, uniqueSentCount };
  }

  // ADD recipient userID to sender.uniqueSent (Number Set). Idempotent.
  async function addUniqueSent(ddb, senderUserID, recipientUserID) {
    if (!(senderUserID > 0) || !(recipientUserID > 0)) return;
    await ddb.update({
      TableName: "users",
      Key: { userID: Number(senderUserID) },
      UpdateExpression: "ADD uniqueSent :r",
      ExpressionAttributeValues: {
        ":r": ddb.createSet([Number(recipientUserID)]), // creates/merges NS
      },
      ReturnValues: "NONE",
    }).promise();
  }

  // Resolve a user by emailHash (GSI) → { userID, created }
  async function resolveUserIdByEmailHash(ddb, emailHash) {
    if (!emailHash) return null;
    try {
      const q = await ddb.query({
        TableName: "users",
        IndexName: "emailHashIndex",
        KeyConditionExpression: "emailHash = :eh",
        ExpressionAttributeValues: { ":eh": emailHash },
        ProjectionExpression: "userID, created",
        Limit: 1,
      }).promise();
      const item = q?.Items?.[0];
      if (!item) return null;
      return { userID: Number(item.userID), created: safeNum(item.created) || null };
    } catch (err) {
      console.warn("resolveUserIdByEmailHash failed", err);
      return null;
    }
  }

  const isBlocked = (user, senderHash) => {
    if (!user) return false;
    if (user.blockAll === true) return true;
    const blacklist = setToArray(user.blacklist);
    const whitelist = setToArray(user.whitelist);
    const listedB = senderHash && blacklist.includes(senderHash);
    const listedW = senderHash && whitelist.includes(senderHash);
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
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const escapeHeader = (s) => String(s).replace(/"/g, '\\"');




  // --- RATE LIMIT: reservation-based sliding 24h window (dynamic per-sender limit) ---
  async function reserveEmailSlot(ddb, senderHash, dailyLimit = 50) {
    const now = Date.now();                       // ms
    const cutoff = now - 24 * 60 * 60 * 1000;           // ms

    const q = await ddb.query({
      TableName: "email_sends",
      KeyConditionExpression: "senderHash = :s AND #ts >= :cutoff",
      ExpressionAttributeNames: { "#ts": "ts" },
      ExpressionAttributeValues: { ":s": senderHash, ":cutoff": cutoff },
      Select: "COUNT",
      ConsistentRead: true,
    }).promise();

    if ((q.Count || 0) >= dailyLimit) {
      const first = await ddb.query({
        TableName: "email_sends",
        KeyConditionExpression: "senderHash = :s AND #ts >= :cutoff",
        ExpressionAttributeNames: { "#ts": "ts" },
        ExpressionAttributeValues: { ":s": senderHash, ":cutoff": cutoff },
        ScanIndexForward: true, // oldest first
        Limit: 1,
        ConsistentRead: true,
        ProjectionExpression: "#ts",
      }).promise();

      const oldestTs = first.Items?.[0]?.ts ?? cutoff;
      const retryAfterMs = Math.max((oldestTs + 24 * 60 * 60 * 1000) - now, 0);
      return { ok: false, reason: "rate_limited", retryAfterMs };
    }

    const ts = now + Math.random();
    await ddb.put({
      TableName: "email_sends",
      Item: {
        senderHash,
        ts,
        ttl: Math.floor((now + 48 * 60 * 60 * 1000) / 1000),
      },
      ConditionExpression: "attribute_not_exists(senderHash) AND attribute_not_exists(#ts)",
      ExpressionAttributeNames: { "#ts": "ts" },
    }).promise();

    return { ok: true, ts };
  }

  async function releaseEmailSlot(ddb, senderHash, ts) {
    if (ts == null) return;
    try {
      await ddb.delete({
        TableName: "email_sends",
        Key: { senderHash, ts },
      }).promise();
    } catch (_) {
      // best-effort cleanup
    }
  }

  // Dynamic daily cap = 50 + days since sender.created
  async function getSenderDailyLimit(ddb, senderEmailHash, createdMsMaybe) {
    const BASE = 50;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    let createdMs = (typeof createdMsMaybe === "number" && isFinite(createdMsMaybe)) ? createdMsMaybe : null;

    if (createdMs == null) {
      try {
        const q = await ddb.query({
          TableName: "users",
          IndexName: "emailHashIndex",
          KeyConditionExpression: "emailHash = :eh",
          ExpressionAttributeValues: { ":eh": senderEmailHash },
          Limit: 1,
          ProjectionExpression: "created",
        }).promise();
        createdMs = (q.Items && q.Items[0] && Number(q.Items[0].created)) || null;
      } catch (err) {
        console.warn("getSenderDailyLimit: lookup by emailHashIndex failed", err);
      }
    }
    if (!(createdMs > 0) || createdMs > now) return BASE;
    const days = Math.floor((now - createdMs) / DAY_MS);
    return BASE + Math.max(0, days);
  }

  // --- INTERNAL: create/ensure user via manageCookie (no cookie sent back) & send invite ---
  async function initEmail(ddb, ses, input, ctx, senderUserID) { // CHANGED: added senderUserID
    console.log(">>>initEmail", initEmail);
    const {
      recipientEmail, recipientHash, senderHash, senderName = "A 1var user",
      previewText = "", fromEmail = senderHash + "@email.1var.com", fromName = "1 VAR",
      brand = "1var", linksHost = "https://email.1var.com", apiHost = "https://abc.api.1var.com",
    } = input;

    // BEFORE sending, enforce local deliverability suppression (global or per-sender) // NEW
    if (await isDeliverabilitySuppressed(ddb, recipientHash, senderUserID)) { // NEW
      return { ok: true, createdUser: true, sent: false, blocked: true, reason: "deliverability_suppressed" }; // NEW
    } // NEW

    const blockCookieBack = true;
    const mcMain = {
      reason: "sendEmail:initEmail",
      recipientEmail,
      recipientHash,
      senderHash,
      blockCookieBack,
    };
    const resForCookie = blockCookieBack ? null : ctx?.res || null;
    let mc;
    try {
      mc = await manageCookie(mcMain, null, resForCookie, ddb);
    } catch (err) {
      console.error("manageCookie failed during initEmail", err);
      throw err;
    }

    const e = mc?.e ? String(mc.e) : undefined; // recipient userID as string

    // Ensure GSI lookup by hashed recipient email continues to work
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

    // Invite links (unchanged) ...
    const allowUrl = `${linksHost}/opt-in/${encodeURIComponent(recipientHash)}/${encodeURIComponent(senderHash)}`;
    const blockSenderUrl = `${linksHost}/stop/${encodeURIComponent(recipientHash)}/${encodeURIComponent(senderHash)}`;
    const blockAllUrl = `${linksHost}/stop/${encodeURIComponent(recipientHash)}`;
    const listUnsubPost = `${apiHost}/cookies/stop/${encodeURIComponent(recipientHash)}`;

    const subject = `${senderName} invited you to receive messages from ${brand}`;
    const textBody = /* unchanged */ `You’re getting this one-time invite because ${senderName} entered your email on ${brand}.
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

    const htmlBody = /* unchanged */ `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">
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

    const sendRes = await ses.sendRawEmail(
      {
        RawMessage: { Data: Buffer.from(raw, "utf-8") },
        ConfigurationSetName: CONFIG_SET,
        Tags: [
          { Name: "senderHash", Value: String(senderHash || "") },
          { Name: "recipientHash", Value: String(recipientHash || "") },
        ]
      }).promise();

    // NEW: count successful, SES-accepted send in metrics
    if (senderUserID) await addDailyMetric(ddb, senderUserID, { sends: 1 }); // NEW

    return { ok: true, createdUser: true, sent: true, messageId: sendRes?.MessageId, userID: Number(e) };
  }

  // --- INTERNAL: for existing users (respect block/allow; send normal email content) ---
  async function generalEmail(ddb, ses, input, userRecord, senderUserID) { // CHANGED: added senderUserID
    console.log(">>>generalEmail", generalEmail);
    const {
      recipientEmail, recipientHash, senderHash,
      subject = "You have a new message on 1var",
      messageText = "",
      messageHtml = "",
      senderName = "A 1var user",
      fromEmail = senderHash + "@email.1var.com",
      fromName = "1 VAR",
      brand = "1var",
      linksHost = "https://email.1var.com",
      apiHost = "https://abc.api.1var.com",
    } = input;

    // Enforce user-managed block rules before anything else
    if (isBlocked(userRecord, senderHash)) {
      return { ok: true, createdUser: false, sent: false, blocked: true, reason: "recipient_has_block_rule" };
    }

    // NEW: local deliverability suppression (global/per-sender)
    if (await isDeliverabilitySuppressed(ddb, recipientHash, senderUserID)) { // NEW
      return { ok: true, createdUser: false, sent: false, blocked: true, reason: "deliverability_suppressed" }; // NEW
    } // NEW

    // Provide convenient block links in footer (unchanged)
    const blockSenderUrl = `${linksHost}/stop/${encodeURIComponent(recipientHash)}/${encodeURIComponent(senderHash)}`;
    const blockAllUrl = `${linksHost}/stop/${encodeURIComponent(recipientHash)}`;
    const listUnsubPost = `${apiHost}/cookies/stop/${encodeURIComponent(recipientHash)}`;

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
      .sendRawEmail(
        {
          RawMessage: { Data: Buffer.from(raw, "utf-8") },
          ConfigurationSetName: CONFIG_SET,
          Tags: [
            { Name: "senderHash", Value: String(senderHash || "") },
            { Name: "recipientHash", Value: String(recipientHash || "") },
          ]
        }
      )
      .promise();

    // NEW: count successful, SES-accepted send in metrics
    if (senderUserID) await addDailyMetric(ddb, senderUserID, { sends: 1 }); // NEW

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

      // 2) users.userID (= e) -> users.emailHash (+ created)
      const userRes = await ddb.get({
        TableName: "users",
        Key: { userID: e },
      }).promise();

      const emailHash = userRes?.Item?.emailHash;
      const created = userRes?.Item?.created;
      if (!emailHash) return { userID: e, created };
      return { emailHash, userID: e, created };
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
    const recipientHashFromClient = String(input.recipientHash || "").trim();
    const senderSu = String(input.senderHash || "").trim(); // client sends subdomain.su

    if (!recipientEmail || !senderSu) {
      return { ok: false, error: "recipientEmail and senderHash are required" };
    }

    // Always compute recipient hash server-side
    const serverHash = hashEmail(recipientEmail);
    const recipientHash = serverHash;
    if (recipientHashFromClient && recipientHashFromClient !== serverHash) {
      console.warn("sendEmail: recipientHash mismatch; using server-computed hash");
    }

    console.log("recipientEmail", recipientEmail);
    console.log("recipientHash", recipientHash);
    console.log("senderSu", senderSu);

    // Resolve subdomain.su -> sender's real emailHash (+ created) (+ userID)
    let senderEmailHash = senderSu; // fallback if resolution fails
    let senderCreatedMs = null;
    let senderUserID = null;
    let resolved = null;
    try {
      resolved = await resolveSenderEmailHash(ddb, senderSu);
      if (resolved?.emailHash) senderEmailHash = resolved.emailHash;
      if (resolved?.created != null) senderCreatedMs = Number(resolved.created);
      if (resolved?.userID != null) senderUserID = Number(resolved.userID);

      // Fallback: try to resolve userID from emailHash if userID missing but we do have an emailHash
      if (!senderUserID && senderEmailHash && senderEmailHash !== senderSu) {
        const viaEh = await resolveUserIdByEmailHash(ddb, senderEmailHash);
        if (viaEh?.userID) {
          senderUserID = Number(viaEh.userID);
          if (senderCreatedMs == null && viaEh.created != null) senderCreatedMs = Number(viaEh.created);
        }
      }
    } catch (e) {
      console.warn("sendEmail: could not resolve sender emailHash; using su fallback");
    }

    // Reputation gate: blocks / uniqueSentCount (tiered thresholds)
    if (senderUserID) {
      const rep = await getUserReputation(ddb, senderUserID);
      const ratio = rep.uniqueSentCount > 0 ? (rep.blocks / rep.uniqueSentCount) : 0;
      const threshold = getBlockRatioThreshold(rep.uniqueSentCount);
      if (ratio > threshold) {
        return {
          ok: false,
          error: "sender_reputation_blocked",
          reason: "blocks_over_threshold",
          uniqueSentCount: rep.uniqueSentCount,
          blocks: rep.blocks,
          ratio,
          threshold,
          tier: (rep.uniqueSentCount >= RATIO_TIER_BREAK) ? ">=50" : "<50",
        };
      }
    }

    // NEW: check sender bounce rate over last 14 days and gate
    let rateInfo = { sends14d: 0, bHard14d: 0, rate: 0 }; // NEW
    if (senderUserID) rateInfo = await getBounceRate14d(ddb, senderUserID); // NEW
    if (senderUserID && (rateInfo.rate >= BOUNCE_HARD_BLOCK_RATE || (rateInfo.sends14d >= MIN_RATE_VOLUME && rateInfo.rate >= BOUNCE_BLOCK_RATE))) { // NEW
      return { // NEW
        ok: false,
        error: "sender_reputation_blocked",
        reason: "bounce_rate_threshold",
        details: rateInfo,
        thresholds: { WARN: BOUNCE_WARN_RATE, BLOCK: BOUNCE_BLOCK_RATE, HARD: BOUNCE_HARD_BLOCK_RATE, WINDOW_DAYS: RATE_WINDOW_DAYS, MIN_RATE_VOLUME } // NEW
      }; // NEW
    } // NEW

    // Lookup recipient (decide path)
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

    // Dynamic per-sender daily limit (then scale if in warn zone)
    let DAILY_LIMIT = await getSenderDailyLimit(ddb, senderEmailHash, senderCreatedMs);
    console.log("DAILY_LIMIT(base)", DAILY_LIMIT);
    DAILY_LIMIT = scaleDailyLimit(DAILY_LIMIT, rateInfo.sends14d, rateInfo.rate); // NEW
    console.log("DAILY_LIMIT(scaled)", DAILY_LIMIT); // NEW

    if (!existingUser) {
      // New user → initEmail flow
      const reservation = await reserveEmailSlot(ddb, senderEmailHash, DAILY_LIMIT);
      if (!reservation.ok) {
        return { ok: false, error: "too_many_emails", retryAfterMs: reservation.retryAfterMs };
      }

      try {
        const res = await initEmail(
          ddb,
          ses,
          { ...input, recipientEmail, recipientHash, senderHash: senderEmailHash },
          ctx,
          senderUserID // NEW
        );

        // Add recipient userID to sender.uniqueSent on successful send
        if (res?.sent && senderUserID && res?.userID > 0) {
          await addUniqueSent(ddb, senderUserID, Number(res.userID));
        }

        return res;
      } catch (err) {
        await releaseEmailSlot(ddb, senderEmailHash, reservation.ts);
        console.error("sendEmail:initEmail failed", err);
        return { ok: false, error: "init_email_failed" };
      }
    } else {
      // Existing user
      if (isBlocked(existingUser, senderEmailHash)) {
        return { ok: true, createdUser: false, sent: false, blocked: true, reason: "recipient_has_block_rule" };
      }

      // Determine opt-in status
      const whitelist = setToArray(existingUser.whitelist);
      const optedIn = (existingUser.whitelistAll === true) ||
        (!!senderEmailHash && whitelist.includes(senderEmailHash));

      // Has this sender ever successfully sent this recipient before?
      let alreadyContacted = false;
      if (senderUserID && existingUser?.userID != null) {
        try {
          const sentRes = await ddb.get({
            TableName: "users",
            Key: { userID: Number(senderUserID) },
            ProjectionExpression: "uniqueSent",
          }).promise();
          const sentSet = setToArray(sentRes?.Item?.uniqueSent);
          alreadyContacted = Array.isArray(sentSet) && sentSet.includes(Number(existingUser.userID));
        } catch (err) {
          console.warn("sendEmail: uniqueSent lookup failed", err);
          // If we can't tell, treat as first contact to be safe (invite instead of general).
          alreadyContacted = false;
        }
      }

      // If not opted-in, send invite on first contact; otherwise block pending opt-in.
      if (!optedIn) {
        if (!alreadyContacted) {
          const reservation = await reserveEmailSlot(ddb, senderEmailHash, DAILY_LIMIT);
          if (!reservation.ok) {
            return { ok: false, error: "too_many_emails", retryAfterMs: reservation.retryAfterMs };
          }
          try {
            const res = await initEmail(
              ddb,
              ses,
              { ...input, recipientEmail, recipientHash, senderHash: senderEmailHash },
              ctx,
              senderUserID
            );
            if (res?.sent && senderUserID && res?.userID > 0) {
              await addUniqueSent(ddb, senderUserID, Number(res.userID));
            }
            return res;
          } catch (err) {
            await releaseEmailSlot(ddb, senderEmailHash, reservation.ts);
            console.error("sendEmail:initEmail (existing user, first contact) failed", err);
            return { ok: false, error: "init_email_failed" };
          }
        }
        // alreadyContacted but not opted in → do not send again
        return { ok: true, createdUser: false, sent: false, blocked: true, reason: "awaiting_opt_in" };
      }

      // Opted in → proceed with general email
      const reservation = await reserveEmailSlot(ddb, senderEmailHash, DAILY_LIMIT);
      if (!reservation.ok) {
        return { ok: false, error: "too_many_emails", retryAfterMs: reservation.retryAfterMs };
      }
      try {
        const res = await generalEmail(
          ddb,
          ses,
          { ...input, recipientEmail, recipientHash, senderHash: senderEmailHash },
          existingUser,
          senderUserID
        );
        if (res?.sent && senderUserID && res?.userID > 0) {
          await addUniqueSent(ddb, senderUserID, Number(res.userID));
        }
        return res;
      } catch (err) {
        await releaseEmailSlot(ddb, senderEmailHash, reservation.ts);
        console.error("sendEmail:generalEmail failed", err);
        return { ok: false, error: "general_email_failed" };
      }
    }
  });


  async function resolveUserIdBySu(ddb, su) {
    if (!su) return null;
    try {
      const q = await ddb.query({
        TableName: "subdomains",
        KeyConditionExpression: "su = :su",
        ExpressionAttributeValues: { ":su": su },
        Limit: 1,
        ProjectionExpression: "e",
        ConsistentRead: true
      }).promise();
      const e = q?.Items?.[0]?.e;
      return (e != null) ? Number(e) : null;
    } catch (err) {
      console.warn("resolveUserIdBySu failed", err);
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // ACTION: requestEmailVerify (owned by email.js)
  // Body: { email, entity|su?, linksHost?, fromEmail?, fromName? }
  on("requestEmailVerify", async (ctx) => {
    const { getDocClient, getSES, hashEmail, normalizeEmail } = use();
    const ddb = getDocClient();
    const ses = getSES();

    const outer = ctx?.req?.body || {};
    const body = unwrapBody(outer) || {};

    const emailRaw = String(body.email || "").trim();
    const email = normalizeEmail ? normalizeEmail(emailRaw) : emailRaw;
    const su = String(ctx?.req?.entity || body.entity || body.su || "").trim();

    if (!email || !su) {
      return { statusCode: 400, body: JSON.stringify({ error: "email and entity (su) are required" }) };
    }

    const userID = await resolveUserIdBySu(ddb, su);
    if (!(userID > 0)) {
      return { statusCode: 404, body: JSON.stringify({ error: "unknown entity (su)" }) };
    }

    // Load user
    const userRes = await ddb.get({ TableName: "users", Key: { userID } }).promise();
    if (!userRes?.Item) {
      return { statusCode: 404, body: JSON.stringify({ error: "user not found" }) };
    }

    const now = Date.now();
    const emailHash = hashEmail(email);
    const currentHash = userRes.Item.emailHash;
    const alreadyVer = !!userRes.Item.emailVerified;
    const alreadySent = !!userRes.Item.emailVerifySent;

    // If email changed → update + reset verification flags
    if (currentHash !== emailHash) {
      await ddb.update({
        TableName: "users",
        Key: { userID },
        UpdateExpression: "SET emailHash = :eh, emailVerified = :f, emailVerifiedAt = :nul, emailVerifySent = :f, emailVerifySentAt = :nul, #upd = :now",
        ExpressionAttributeNames: { "#upd": "updated" },
        ExpressionAttributeValues: { ":eh": emailHash, ":f": false, ":nul": null, ":now": now }
      }).promise();
    }

    const linksHost = String(body.linksHost || DEFAULT_VERIFY_LINKS_HOST);
    console.log("linksHost",linksHost)
    console.log("body.linksHost",body.linksHost)

    const verifyUrl = `${linksHost}/email-verify?eh=${encodeURIComponent(emailHash)}&su=${encodeURIComponent(su)}`;

    console.log("verifyUrl",verifyUrl)
    console.log("alreadyVer",alreadyVer)
    console.log("currentHash",currentHash)
    console.log("emailHash",emailHash)
    // If verified → do not send again
    if (alreadyVer && currentHash === emailHash) {
      return { ok: true, sent: false, alreadyVerified: true, verifyUrl, userID };
    }

    // If already sent for this hash → return same URL, don't re-send
    if (currentHash === emailHash && alreadySent) {
      return { ok: true, sent: false, alreadySent: true, verifyUrl, userID };
    }

    // Compose + send the verification email (transactional)
    const fromEmail = String(body.fromEmail || DEFAULT_VERIFY_FROM_EMAIL);
    const fromName = String(body.fromName || DEFAULT_VERIFY_FROM_NAME);
    const fromHdr = `"${escapeHeader(fromName)}" <${fromEmail}>`;

    const subject = "Welcome to 1 VAR! Confirm your email";
    const textBody = `Welcome to 1 VAR!

Please confirm your email to continue:
${verifyUrl}

If you didn't request this, you can ignore this email.`;
    const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">
  <p>Welcome to <b>1 VAR</b>!</p>
  <p>Please confirm your email to continue:</p>
  <p><a href="${verifyUrl}">Click here to confirm your email</a></p>
  <p style="word-break:break-all;color:#666;font-size:12px;">If the link doesn’t work, copy and paste:<br>${escapeHtml(verifyUrl)}</p>
</div>`;

    const raw = buildRawEmail({ from: fromHdr, to: email, subject, html: htmlBody, text: textBody });

    await ses.sendRawEmail({
      RawMessage: { Data: Buffer.from(raw, "utf-8") },
      Tags: [{ Name: "type", Value: "email_verify" }, { Name: "userID", Value: String(userID) }]
    }).promise();

    // Mark "sent once" for this hash
    await ddb.update({
      TableName: "users",
      Key: { userID },
      UpdateExpression: "SET emailVerifySent = :t, emailVerifySentAt = :now, #upd = :now",
      ExpressionAttributeNames: { "#upd": "updated" },
      ExpressionAttributeValues: { ":t": true, ":now": now }
    }).promise();

    return { ok: true, sent: true, verifyUrl, userID };
  });

  // NOTE: "blocks" is incremented in modules/stop.js on first-time per-recipient blocks.
  return { name: "email" };
}

module.exports = { register };