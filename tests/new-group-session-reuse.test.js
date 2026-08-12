"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  register,
  shouldReuseAuthenticatedEntity,
} = require("../app/routes/modules/newGroup");

test("internal entity composition does not reuse the authenticated root entity", () => {
  assert.equal(shouldReuseAuthenticatedEntity({ req: { body: { _isFunction: true } } }), false);
  assert.equal(shouldReuseAuthenticatedEntity({ req: { body: {} } }), true);
});

test("newGroup reuses the authenticated cookie installed by request middleware", async () => {
  let handler;
  let manageCookieCalls = 0;
  register({
    on: (name, callback) => { if (name === "newGroup") handler = callback; },
    use: () => ({
      getDocClient: () => ({}),
      deps: { uuidv4: () => "unused", dynamodbLL: {} },
      manageCookie: async () => { manageCookieCalls += 1; return {}; },
      setIsPublic: () => {},
      getSub: async () => ({ Items: [{ su: "1v4r-existing", g: "0" }] }),
      convertToJSON: async () => ({ obj: {}, groups: [] })
    })
  });

  const result = await handler({
    path: "/newUser/newUser",
    req: { body: {} },
    res: {},
    cookie: { gi: "7", e: "7", existing: true }
  }, { cookie: {} });

  assert.equal(manageCookieCalls, 0);
  assert.equal(result.response.existing, true);
  assert.equal(result.response.entity, "7");
  assert.equal(result.response.file, "1v4r-existing");
});
