"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cookieRecordFromQuery,
  isFreshBrowserIdentityRequest,
  prepareFreshBrowserIdentity,
  installFreshBrowserIdentityCookies,
  propagateAuthenticatedCookie,
} = require("../app/routes/sessionCookie");

test("an unresolved access token is not treated as authenticated", () => {
  assert.equal(cookieRecordFromQuery({ Items: [] }), null);
  assert.equal(cookieRecordFromQuery({ Items: [{ ak: "old-token" }] }), null);
  assert.deepEqual(
    cookieRecordFromQuery({ Items: [{ ak: "new-token", gi: "7", e: "9" }] }),
    { ak: "new-token", gi: "7", e: "9" }
  );
});

test("a recovered cookie replaces the stale token for nested composition", () => {
  const dispatchMeta = { cookie: { ak: "old-token", gi: "4", e: "5" } };
  const ctx = {
    xAccessToken: "old-token",
    req: {
      headers: { "x-accesstoken": "old-token" },
      cookies: { accessToken: "old-token" },
      body: { headers: { "X-accessToken": "old-token" } },
    },
  };
  assert.equal(
    propagateAuthenticatedCookie(
      ctx,
      { ak: "new-token", gi: "7", e: "9", ci: "11" },
      dispatchMeta
    ),
    true
  );
  assert.equal(ctx.xAccessToken, "new-token");
  assert.equal(ctx.req.headers["x-accesstoken"], "new-token");
  assert.equal(ctx.req.body.headers["X-accessToken"], "new-token");
  assert.equal(ctx.req.cookies.gi, "7");
  assert.equal(ctx.req.cookies.e, "9");
  assert.equal(dispatchMeta.cookie.ak, "new-token");
  assert.equal(dispatchMeta.cookie.e, "9");
});

test("only the explicit new-user bootstrap may request a fresh browser identity", () => {
  assert.equal(isFreshBrowserIdentityRequest({
    path: "/newUser/newUser",
    req: { body: { freshBrowserIdentity: true } },
  }), true);
  assert.equal(isFreshBrowserIdentityRequest({
    path: "/newUser/newUser",
    req: { body: {} },
  }), false);
  assert.equal(isFreshBrowserIdentityRequest({
    path: "/contextGraphHydrateNamed/workspace",
    req: { body: { freshBrowserIdentity: true } },
  }), false);
});

test("fresh browser bootstrap removes stale host and domain identity cookies", () => {
  const cleared = [];
  const ctx = {
    path: "/newUser/newUser",
    xAccessToken: "stale-token",
    cookie: { ak: "stale-token", gi: "4", e: "5" },
    res: { clearCookie: (...args) => cleared.push(args) },
    req: {
      headers: {
        "x-accesstoken": "stale-token",
        "x-access-token": "stale-token",
        xAccessToken: "stale-token",
      },
      cookies: { accessToken: "stale-token", unrelated: "keep" },
      body: {
        freshBrowserIdentity: true,
        headers: {
          "X-accessToken": "stale-token",
          "x-accesstoken": "stale-token",
        },
      },
    },
  };
  assert.equal(prepareFreshBrowserIdentity(ctx), true);
  assert.equal(ctx.xAccessToken, null);
  assert.equal(ctx.cookie, null);
  assert.equal(ctx.req.cookies.accessToken, undefined);
  assert.equal(ctx.req.cookies.unrelated, "keep");
  assert.equal(ctx.req.headers["x-accesstoken"], undefined);
  assert.equal(ctx.req.body.headers["X-accessToken"], undefined);
  assert.equal(cleared.length, 2);
  assert.equal(cleared[0][1].domain, undefined);
  assert.equal(cleared[1][1].domain, ".1var.com");
});

test("fresh browser bootstrap rotates host and domain scopes to one principal", () => {
  const installed = [];
  const ctx = {
    path: "/newUser/newUser",
    req: { body: { freshBrowserIdentity: true } },
    res: { cookie: (...args) => installed.push(args) },
  };
  assert.equal(installFreshBrowserIdentityCookies(ctx, {
    ak: "replacement-token",
    ex: Math.floor(Date.now() / 1000) + 3600,
  }), true);
  assert.equal(installed.length, 2);
  assert.deepEqual(installed.map(([name, value]) => [name, value]), [
    ["accessToken", "replacement-token"],
    ["accessToken", "replacement-token"],
  ]);
  assert.equal(installed[0][2].domain, undefined);
  assert.equal(installed[1][2].domain, ".1var.com");
  assert.equal(installed[0][2].httpOnly, true);
  assert.equal(installed[1][2].sameSite, "none");
});
