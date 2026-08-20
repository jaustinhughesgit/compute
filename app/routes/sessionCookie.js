/**
 * Platform: Recovers browser identity after a reset without leaking or reusing an invalid access token.
 * Technical: Validates cookie lookup rows and propagates a replacement token through nested entity composition.
 */
"use strict";

function cookieRecordFromQuery(result) {
  const row = result?.Items?.[0];
  return row && row.ak && row.gi ? row : null;
}

function isFreshBrowserIdentityRequest(ctx) {
  const path = String(ctx?.path || "").replace(/\/+$/, "").toLowerCase();
  return path === "/newuser/newuser"
    && ctx?.req?.body?.freshBrowserIdentity === true;
}

function prepareFreshBrowserIdentity(ctx) {
  if (!isFreshBrowserIdentityRequest(ctx)) return false;
  const req = ctx.req;
  ctx.xAccessToken = null;
  ctx.cookie = null;
  if (req.headers && typeof req.headers === "object") {
    delete req.headers["x-accesstoken"];
    delete req.headers["x-access-token"];
    delete req.headers.xAccessToken;
  }
  if (req.body?.headers && typeof req.body.headers === "object") {
    delete req.body.headers["X-accessToken"];
    delete req.body.headers["x-accesstoken"];
    delete req.body.headers["x-access-token"];
  }
  if (req.cookies && typeof req.cookies === "object") {
    delete req.cookies.accessToken;
  }
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "none",
  };
  // Old clients may retain both an API-host cookie and the current
  // domain-scoped cookie. Expire both before manageCookie installs the one
  // authoritative replacement for the fresh browser identity.
  ctx.res?.clearCookie?.("accessToken", cookieOptions);
  ctx.res?.clearCookie?.("accessToken", { ...cookieOptions, domain: ".1var.com" });
  return true;
}

function propagateAuthenticatedCookie(ctx, cookie, dispatchMeta = null) {
  if (!ctx?.req || !cookie || typeof cookie !== "object") return false;
  ctx.cookie = cookie;
  if (dispatchMeta && typeof dispatchMeta === "object") {
    // Action handlers authorize from dispatch metadata while middleware owns
    // cookie creation/recovery. Keep both views on the same principal so a
    // fresh new-user request cannot return a workspace created for the stale
    // cookie that arrived with the request.
    dispatchMeta.cookie = cookie;
  }
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

module.exports = {
  cookieRecordFromQuery,
  isFreshBrowserIdentityRequest,
  prepareFreshBrowserIdentity,
  propagateAuthenticatedCookie,
};
