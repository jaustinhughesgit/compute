"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  distributedIdentifier,
  normalizeLexeme,
  shardFor,
  stableIdentifier,
  wordIdentifier,
} = require("../app/persistence/canonicalIdentifiers");

test("stable canonical IDs replay without a shared allocation record", () => {
  const first = stableIdentifier("ent", "publisher-1", "local-42");
  assert.equal(first, stableIdentifier("ent", "publisher-1", "local-42"));
  assert.notEqual(first, stableIdentifier("ent", "publisher-2", "local-42"));
  assert.match(first, /^ent_[A-Za-z0-9_-]{32}$/);
});

test("distributed IDs retain time ordering while independent entropy prevents collisions", () => {
  const first = distributedIdentifier("ent", { now: 1000, entropy: "aaaaaaaa" });
  const second = distributedIdentifier("ent", { now: 1001, entropy: "bbbbbbbb" });
  assert.notEqual(first, second);
  assert.ok(first < second);
});

test("word IDs normalize compatible surface forms but remain lexical identities", () => {
  assert.equal(normalizeLexeme("  Cat’s!!!  "), "cat's");
  assert.equal(wordIdentifier("Cats"), wordIdentifier("  cats  "));
  assert.notEqual(wordIdentifier("cats", { senseKey: "animal" }), wordIdentifier("cats", { senseKey: "musical" }));
});

test("deterministic shards distribute a large identifier set without a hot allocator", () => {
  const counts = Array.from({ length: 32 }, () => 0);
  for (let index = 0; index < 10000; index += 1) {
    counts[shardFor(`entity-${index}`, counts.length)] += 1;
  }
  assert.ok(Math.max(...counts) < 390);
  assert.ok(Math.min(...counts) > 230);
});
