/**
 * Platform: Defines the rebuildable projection vocabulary used to address canonical Context records at scale.
 * Technical: Centralizes shard counts, partition keys, compact values, grants, and version rows for Context compilation.
 */
"use strict";

const {
  normalizeLexeme,
  shardFor,
  stableIdentifier,
  stableNumericKey,
} = require("./canonicalIdentifiers");

const DEFAULT_SHARDS = Object.freeze({ audience: 32, word: 256, profile: 64, mapping: 32 });

function positiveInt(value, fallback, maximum = 1024) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function configuredShards(env = process.env) {
  return Object.freeze({
    audience: positiveInt(env.CANONICAL_AUDIENCE_SHARDS, DEFAULT_SHARDS.audience),
    word: positiveInt(env.CANONICAL_WORD_SHARDS, DEFAULT_SHARDS.word),
    profile: positiveInt(env.CANONICAL_PROFILE_SHARDS, DEFAULT_SHARDS.profile),
    mapping: positiveInt(env.CANONICAL_MAPPING_SHARDS, DEFAULT_SHARDS.mapping),
  });
}

function padShard(shard, count) {
  return String(shard).padStart(Math.max(2, String(Math.max(0, count - 1)).length), "0");
}

const audiencePartition = (audienceId, shard, count) => (
  `AUD#${audienceId}#${padShard(shard, count)}`
);
const profilePartition = (label, shard, count) => (
  `PROFILE#${normalizeLexeme(label)}#${padShard(shard, count)}`
);
const wordPartition = (wordId, shard, count) => (
  `WORD#${wordId}#${padShard(shard, count)}`
);
const mappingPartition = (principalId, localId, count) => (
  `MAP#${principalId}#${padShard(shardFor(localId, count), count)}`
);

function uniqueStrings(values, maximum = 32) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const display = String(value == null ? "" : value).trim();
    const normalized = normalizeLexeme(display);
    if (!display || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(display.slice(0, 200));
    if (output.length >= maximum) break;
  }
  return output;
}

function literalProperty(labels) {
  const normalized = normalizeLexeme(labels?.[0]);
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return {};
  const value = Number(normalized);
  return Number.isFinite(value) ? { literalValue: { valueType: "number", value } } : {};
}

function grantPrincipal(audienceId) {
  if (String(audienceId).startsWith("u:")) return String(audienceId);
  if (String(audienceId).startsWith("public:")) return "pub";
  return null;
}

function addGrant(grants, resourceId, principalId, ownerId, updatedAt) {
  if (!principalId) return;
  const owner = principalId === `u:${ownerId}`;
  grants.set(`${resourceId}\u001f${principalId}`, {
    entityID: resourceId,
    principalID: principalId,
    perms: owner ? "rwdop" : "r",
    canonicalActions: owner
      ? ["find", "read", "aggregate", "use", "set", "edit", "delete", "delegate", "publish", "govern"]
      : ["find", "read", "aggregate"],
    canonicalSchemaVersion: 1,
    created: Math.floor(Date.parse(updatedAt) / 1000),
    updatedAt,
  });
}

function versionRow(resourceId, resourceVersion, payloadHash, ownerId, updatedAt, resourceType) {
  const v = stableIdentifier("ver", resourceType, resourceId, resourceVersion, payloadHash);
  return {
    v,
    d: stableNumericKey(v),
    e: resourceId,
    c: String(resourceVersion),
    s: "1",
    canonicalSchemaVersion: 1,
    canonicalResourceType: resourceType,
    canonicalPayloadHash: payloadHash,
    canonicalOwnerId: String(ownerId),
    canonicalUpdatedAt: updatedAt,
  };
}

module.exports = {
  DEFAULT_SHARDS,
  addGrant,
  audiencePartition,
  configuredShards,
  grantPrincipal,
  literalProperty,
  mappingPartition,
  padShard,
  profilePartition,
  uniqueStrings,
  versionRow,
  wordPartition,
};
