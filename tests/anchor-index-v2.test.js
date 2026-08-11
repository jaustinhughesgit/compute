"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makePosting, makePostingV2 } = require("../app/routes/anchors");

const assignment = { l0: 4, l1: 12, band: 93, dist_q16: 501 };

test("v2 anchor postings put the deterministic shard in the partition key", () => {
  const partitions = new Set(Array.from({ length: 1000 }, (_, index) => (
    makePostingV2({
      setId: "anchors_v1",
      su: `entity-${index}`,
      assign: assignment,
      shards: 8,
    }).pk
  )));
  assert.equal(partitions.size, 8);
  assert.ok([...partitions].every((pk) => /^AB2#anchors_v1#L0=4#L1=12#S=0[0-7]$/.test(pk)));
});

test("v2 tenant and global projections use compatible band sort keys", () => {
  const global = makePostingV2({ setId: "set", su: "cat", assign: assignment, shards: 8 });
  const tenant = makePostingV2({ setId: "set", su: "cat", assign: assignment, shards: 8, userId: "42" });
  assert.equal(global.sk, tenant.sk);
  assert.match(global.sk, /^B=00093#T=su#SU=cat$/);
  assert.match(tenant.pk, /^AB2#set#U=42#L0=4#L1=12#S=/);
  assert.equal(global.indexVersion, 2);
});

test("legacy posting keys remain readable while v2 is backfilled", () => {
  const legacy = makePosting({ setId: "set", su: "cat", assign: assignment, shards: 8 });
  assert.equal(legacy.pk, "AB#set#L0=4#L1=12");
  assert.match(legacy.sk, /^B=00093#S=\d{2}#T=su#SU=cat$/);
});
