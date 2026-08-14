"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { register } = require("../app/routes/modules/notifications");

function routeWith(lifecycle) {
  const handlers = new Map();
  register({
    on: (name, handler) => handlers.set(name, handler),
    use: () => ({ deps: { notificationLifecycle: lifecycle }, expose() {} }),
  });
  return handlers.get("notifications");
}

test("notification inbox and acknowledgement expose the versioned delivery contract", async () => {
  const calls = [];
  const handler = routeWith({
    list: async (...args) => {
      calls.push(["list", ...args]);
      return [{
        notificationId: "n_0000000000001_a",
        kind: "protected_access_decision",
        createdAt: "2026-08-14T12:00:00.000Z",
        payload: { requestId: `par_${"a".repeat(40)}`, decision: "approved" },
      }];
    },
    acknowledge: async (...args) => {
      calls.push(["ack", ...args]);
      return {
        acknowledged: 1,
        notificationIds: ["n_0000000000001_a"],
        acknowledgedAt: "2026-08-14T12:00:01.000Z",
      };
    },
    resolve: async (...args) => {
      calls.push(["resolve", ...args]);
      return { resolved: true };
    },
  });
  const inbox = await handler({ path: "/inbox", cookie: { e: "3" }, req: { query: { limit: "10" } } });
  assert.equal(inbox.ok, true);
  assert.equal(inbox.schemaVersion, 1);
  assert.equal(inbox.kind, "notificationInbox");
  assert.equal(inbox.notifications.length, 1);
  assert.deepEqual(calls[0], ["list", "u:3", 10]);

  const acknowledgement = await handler({
    path: "/ack",
    cookie: { e: "3" },
    req: { body: { notificationIds: ["n_0000000000001_a"] } },
  });
  assert.equal(acknowledgement.schemaVersion, 1);
  assert.equal(acknowledgement.acknowledged, 1);
  assert.deepEqual(calls[1], ["ack", "u:3", ["n_0000000000001_a"]]);

  const resolution = await handler({
    path: "/resolve",
    cookie: { e: "3" },
    req: { body: { notificationId: "n_0000000000001_a" } },
  });
  assert.equal(resolution.schemaVersion, 1);
  assert.equal(resolution.notificationId, "n_0000000000001_a");
  assert.equal(resolution.resolved, true);
  assert.deepEqual(calls[2], ["resolve", "u:3", "n_0000000000001_a"]);
});
