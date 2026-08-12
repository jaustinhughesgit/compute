"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cookieRecordFromQuery,
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
  const ctx = {
    xAccessToken: "old-token",
    req: {
      headers: { "x-accesstoken": "old-token" },
      cookies: { accessToken: "old-token" },
      body: { headers: { "X-accessToken": "old-token" } },
    },
  };
  assert.equal(
    propagateAuthenticatedCookie(ctx, { ak: "new-token", gi: "7", e: "9", ci: "11" }),
    true
  );
  assert.equal(ctx.xAccessToken, "new-token");
  assert.equal(ctx.req.headers["x-accesstoken"], "new-token");
  assert.equal(ctx.req.body.headers["X-accessToken"], "new-token");
  assert.equal(ctx.req.cookies.gi, "7");
  assert.equal(ctx.req.cookies.e, "9");
});
