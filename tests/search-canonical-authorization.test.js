"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchors = require("../app/routes/anchors");
const { register } = require("../app/routes/modules/search");

test("Search derives identity and policy from server state before applying topK", async (t) => {
  const originalLoad = anchors.loadAnchors;
  const originalAssign = anchors.assign;
  t.after(() => {
    anchors.loadAnchors = originalLoad;
    anchors.assign = originalAssign;
  });
  anchors.loadAnchors = async () => ({ d: 2 });
  anchors.assign = () => [{ l0: 1, l1: 2, band: 100 }];

  const queryPartitions = [];
  const persistence = {
    retrieval: {
      queryWindow: async ({ partitionKey }) => {
        queryPartitions.push(partitionKey);
        if (partitionKey === "AB2#anchors_v1#L0=1#L1=2#S=00") {
          return { Items: [
            { pk: partitionKey, sk: "B=00100#T=su#SU=secret", su: "secret", band: 100, policy_id: "pub" },
            { pk: partitionKey, sk: "B=00102#T=su#SU=allowed", su: "allowed", band: 102 },
          ] };
        }
        return { Items: [] };
      },
    },
    foundation: {
      addresses: {
        batchGet: async () => ([
          { su: "secret", e: "99", z: false, output: "Secret" },
          { su: "allowed", e: "7", z: false, output: "Allowed" },
        ]),
      },
    },
    authorization: { batchGetGrants: async () => [] },
  };
  const handlers = new Map();
  register({
    on: (name, handler) => handlers.set(name, handler),
    use: () => ({
      getCanonicalPersistence: () => persistence,
      getCookie: async () => { throw new Error("cookie fallback should not run"); },
      deps: { s3: {}, openai: {} },
    }),
  });

  const result = await handlers.get("search")({
    req: { body: { embedding: [1, 0], e: 99, topK: 1 } },
    res: {},
  }, { cookie: { e: "7" } });
  assert.equal(result.ok, true);
  assert.equal(result.response.query.e, 7);
  assert.deepEqual(result.response.results.map((row) => row.su), ["allowed"]);
  assert.ok(queryPartitions.some((pk) => pk.includes("#U=7#")));
  assert.equal(queryPartitions.some((pk) => pk.includes("#U=99#")), false);
});

test("Search reports public visibility separately from an explicit public use grant", async (t) => {
  const originalLoad = anchors.loadAnchors;
  const originalAssign = anchors.assign;
  t.after(() => {
    anchors.loadAnchors = originalLoad;
    anchors.assign = originalAssign;
  });
  anchors.loadAnchors = async () => ({ d: 2 });
  anchors.assign = () => [{ l0: 1, l1: 2, band: 100 }];
  const persistence = {
    retrieval: { queryWindow: async ({ partitionKey }) => ({
      Items: partitionKey === "AB2#anchors_v1#L0=1#L1=2#S=00"
        ? [{ pk: partitionKey, sk: "B=00100#T=capability#SU=entity-add", su: "entity-add", band: 100 }]
        : [],
    }) },
    foundation: { addresses: { batchGet: async () => [{ su: "entity-add", e: "10", z: true }] } },
    authorization: { batchGetGrants: async (keys) => keys.some((key) => key.principalID === "pub")
      ? [{ entityID: "entity-add", principalID: "pub", canonicalActions: ["use"] }]
      : [] },
  };
  const handlers = new Map();
  register({
    on: (name, handler) => handlers.set(name, handler),
    use: () => ({
      getCanonicalPersistence: () => persistence,
      getCookie: async () => null,
      deps: { s3: {}, openai: {} },
    }),
  });
  const result = await handlers.get("search")({
    req: { body: { embedding: [1, 0], topK: 1 } },
    res: {},
  }, { cookie: { e: "12" } });
  assert.equal(result.response.results[0].policy_id, "pub");
  assert.equal(result.response.results[0].perm, "r");
  assert.equal(result.response.results[0].canUse, true);
});
