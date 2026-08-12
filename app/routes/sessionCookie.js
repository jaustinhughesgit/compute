/**
 * Platform: Recovers browser identity after a reset without leaking or reusing an invalid access token.
 * Technical: Validates cookie lookup rows and propagates a replacement token through nested entity composition.
 */
"use strict";

function cookieRecordFromQuery(result) {
  const row = result?.Items?.[0];
  return row && row.ak && row.gi ? row : null;
}

function propagateAuthenticatedCookie(ctx, cookie) {
  if (!ctx?.req || !cookie || typeof cookie !== "object") return false;
  ctx.cookie = cookie;
  ctx.req.cookies ||= {};
  Object.assign(ctx.req.cookies, cookie);
  if (cookie.ak) {
    ctx.xAccessToken = cookie.ak;
    ctx.req.headers ||= {};
    ctx.req.headers["x-accesstoken"] = cookie.ak;
    if (ctx.req.body && typeof ctx.req.body === "object") {
      ctx.req.body.headers ||= {};
      ctx.req.body.headers["X-accessToken"] = cookie.ak;
    }
  }
  return true;
}

module.exports = { cookieRecordFromQuery, propagateAuthenticatedCookie };
