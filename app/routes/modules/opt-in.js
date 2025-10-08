// modules/opt-in.js
"use strict";

function register({ on, use }) {
  // pull helpers from shared.js
  const shared = use();
  const {
    getDocClient,
    getCookie,
    incrementCounterAndGetNewValue,
    getUUID,
    createCookie,
  } = shared;

  const COOKIE_DOMAIN = ".1var.com";
  const DEFAULT_TTL_SECONDS = 86400; // 24h

  // ---- cookie helpers ----
  async function fetchCookieByUserE(ddb, userID) {
    // Prefer shared.getCookie(..., "e"), fall back to a direct query if needed
    if (typeof getCookie === "function") {
      const res = await getCookie(String(userID), "e", ddb);
      return res?.Items || [];
    }
    const res = await ddb.query({
      TableName: "cookies",
      IndexName: "eIndex",
      KeyConditionExpression: "e = :e",
      ExpressionAttributeValues: { ":e": String(userID) },
    }).promise();
    return res?.Items || [];
  }

  async function createNewCookieForUser(ddb, userID) {
    const nowSec = Math.floor(Date.now() / 1000);
    const ex = nowSec + DEFAULT_TTL_SECONDS;
    const ak = await getUUID();
    const ci = await incrementCounterAndGetNewValue("ciCounter", ddb);
    const gi = await incrementCounterAndGetNewValue("giCounter", ddb);
    await createCookie(String(ci), String(gi), ex, ak, String(userID), ddb);
    return { ci: String(ci), gi: String(gi), ex, ak, e: String(userID) };
  }

 async function getBestCookieRecord(ddb, userID) {
    const nowSec = Math.floor(Date.now() / 1000);
    const items = await fetchCookieByUserE(ddb, userID);
    // Prefer the earliest cookie (smallest ci) that is still valid.
    const typed = (items || [])
      .filter(it => it && typeof it.ex === "number" && it.ak && it.ex > nowSec)
      .map(it => ({ ...it, _ciNum: Number(it.ci) || 0 }));
    if (!typed.length) return null;
    typed.sort((a, b) => a._ciNum - b._ciNum);
    return typed[0];
  }

  function browserAlreadyHasCookie(req) {
    if (req?.cookies?.accessToken) return true;
    const raw = req?.headers?.cookie;
    return typeof raw === "string" && /(^|;\s*)accessToken=/.test(raw);
  }

  function setAccessTokenCookie(res, ak, maxAgeMs) {
    // conservative clamp: never set negative or zero maxAge
    const safeMaxAge = Math.max(maxAgeMs | 0, 1 * 60 * 1000); // at least 1 minute
    res?.cookie?.("accessToken", ak, {
      domain: COOKIE_DOMAIN,
      maxAge: safeMaxAge,
      httpOnly: true,
      secure: true,
      sameSite: "None",
    });
  }

  async function maybeGiveAccountCookie(ctx, userID) {
    const ddb = getDocClient();

    if (browserAlreadyHasCookie(ctx?.req)) {
      return { cookieSet: false, reason: "already-present" };
    }

    // try to reuse an existing unexpired cookie
    let record = await getBestCookieRecord(ddb, userID);

    // otherwise create a fresh one for this user
    if (!record) {
      record = await createNewCookieForUser(ddb, userID);
    }

    const msRemaining = Math.max(0, (record.ex * 1000) - Date.now());
    setAccessTokenCookie(ctx?.res, record.ak, msRemaining || (DEFAULT_TTL_SECONDS * 1000));
    return { cookieSet: true, cookieExpiresAt: record.ex };
  }

  // ---- Existing handler with cookie hand-off added ----
  const handleOptIn = async (ctx) => {
    const ddb = getDocClient();
    const hostHeader = ctx?.req?.headers?.["x-original-host"];

    if (!hostHeader) {
      return { ok: false, error: "Missing X-Original-Host header" };
    }

    try {
      const url = new URL(hostHeader);

      // Try to extract from query params first
      let recipientHash = url.searchParams.get("email");
      let senderHash = url.searchParams.get("sender");

      // If not present, try path-based format: /opt-in/{sender}/{email}
      if ((!recipientHash || !senderHash) && url.pathname.includes("/opt-in/")) {
        const parts = url.pathname.split("/").filter(Boolean); // drop empty segments
        const optInIndex = parts.indexOf("opt-in");
        if (optInIndex !== -1) {
          senderHash = senderHash || parts[optInIndex + 1];
          recipientHash = recipientHash || parts[optInIndex + 2];
        }
      }

      if (!recipientHash) {
        return { ok: false, error: "Missing recipientHash (email param)" };
      }

      // Find the recipient user by emailHash (GSI: emailHashIndex)
      const q = await ddb
        .query({
          TableName: "users",
          IndexName: "emailHashIndex",
          KeyConditionExpression: "emailHash = :eh",
          ExpressionAttributeValues: { ":eh": recipientHash },
          Limit: 1,
        })
        .promise();

      const user = q.Items && q.Items[0];
      if (!user) {
        return { ok: false, error: "Recipient not found" };
      }

      // --- perform whitelist/verification as before ---
      if (senderHash) {
        await ddb.update({
          TableName: "users",
          Key: { userID: user.userID },
          UpdateExpression:
            "SET emailVerified = :true, emailVerifiedAt = :now, #upd = :now " +
            "ADD whitelist :s",
          ExpressionAttributeNames: { "#upd": "updated" },
          ExpressionAttributeValues: {
            ":true": true,
            ":now": Date.now(),
            ":s": ddb.createSet([senderHash]),
          },
        }).promise();

        // NEW: Give them their account cookie if the browser doesn't have one yet
        const cookieOutcome = await maybeGiveAccountCookie(ctx, user.userID);

        return {
          ok: true,
          message: `Sender ${senderHash} allowed for recipient ${recipientHash}`,
          ...(cookieOutcome.cookieSet
            ? { cookie: { set: true, expiresAt: cookieOutcome.cookieExpiresAt } }
            : { cookie: { set: false, reason: cookieOutcome.reason } }),
        };
      } else {
        await ddb.update({
          TableName: "users",
          Key: { userID: user.userID },
          UpdateExpression:
            "SET whitelistAll = :true, emailVerified = :true, emailVerifiedAt = :now, #upd = :now",
          ExpressionAttributeNames: { "#upd": "updated" },
          ExpressionAttributeValues: {
            ":true": true,
            ":now": Date.now(),
          },
        }).promise();

        // NEW: Give them their account cookie if the browser doesn't have one yet
        const cookieOutcome = await maybeGiveAccountCookie(ctx, user.userID);

        return {
          ok: true,
          message: `All senders allowed for recipient ${recipientHash}`,
          ...(cookieOutcome.cookieSet
            ? { cookie: { set: true, expiresAt: cookieOutcome.cookieExpiresAt } }
            : { cookie: { set: false, reason: cookieOutcome.reason } }),
        };
      }
    } catch (err) {
      console.error("opt-in handler failed", err);
      return { ok: false, error: "Internal error during opt-in" };
    }
  };

  on("optIn", handleOptIn);
  on("opt-in", handleOptIn);

  return { name: "opt-in" };
}

module.exports = { register };
