/**
 * Platform: Publishes and authorizes canonical Context while the browser-facing sidecar remains a migration adapter.
 * Technical: Writes compiled batches and pages sharded audience, profile, and Word projections through the persistence port.
 */
"use strict";

const { shardFor } = require("./canonicalIdentifiers");
const { grantActions } = require("../governance");
const { compileContextRecords } = require("./canonicalContextCompiler");
const {
  DEFAULT_SHARDS,
  audiencePartition,
  configuredShards,
  grantPrincipal,
  mappingPartition,
  padShard,
  profilePartition,
  uniqueStrings,
  wordPartition,
} = require("./canonicalContextProjection");

function createCanonicalContextStore({ persistence, env = process.env, now = () => new Date().toISOString() }) {
  if (!persistence?.canonical) throw new TypeError("canonical persistence namespace is required");
  const shards = configuredShards(env);

  async function publish(input) {
    const records = compileContextRecords({ ...input, updatedAt: now(), shards });
    const written = await persistence.canonical.batchPut(records, { maxAttempts: 7 });
    return { written, records };
  }

  async function hasPublication(principalId, idempotencyKey) {
    if (!persistence.canonical.enabled) return false;
    const pk = `SYNC#${principalId}#${padShard(shardFor(idempotencyKey, shards.mapping), shards.mapping)}`;
    const result = await persistence.canonical.getProjection(pk, `IDEMPOTENCY#${idempotencyKey}`);
    return result?.Item?.recordType === "canonical-publication" && result.Item.status === "applied";
  }

  async function readProjectionPage(audienceId, { cursor, limit = 300 } = {}) {
    const maximum = Math.max(1, Math.min(500, Number(limit) || 300));
    const state = cursor?.source === "canonical-projection-v1"
      ? cursor : { source: "canonical-projection-v1", shard: 0, key: null };
    let shard = Math.max(0, Number(state.shard || 0));
    let key = state.key || null;
    const items = [];
    while (shard < shards.audience && items.length < maximum) {
      const page = await persistence.canonical.queryProjection(
        audiencePartition(audienceId, shard, shards.audience),
        { cursor: key, limit: maximum - items.length }
      );
      items.push(...(page?.Items || []));
      if (page?.LastEvaluatedKey) {
        return { items, cursor: { source: "canonical-projection-v1", shard, key: page.LastEvaluatedKey } };
      }
      shard += 1;
      key = null;
    }
    return {
      items,
      cursor: shard < shards.audience ? { source: "canonical-projection-v1", shard, key: null } : null,
    };
  }

  async function hydrateAudience(audienceId, options = {}) {
    if (!persistence.canonical.enabled) return { nodes: [], relations: [], cursor: null };
    const page = await readProjectionPage(audienceId, options);
    const principalID = grantPrincipal(audienceId);
    const candidates = page.items.filter((item) => (
      item?.tombstone !== true
      && (item?.recordType === "audience-node" || item?.recordType === "audience-relation")
    ));
    const grants = principalID
      ? await persistence.authorization.batchGetGrants(candidates.map((item) => ({
          entityID: item.canonicalId, principalID,
        }))) : [];
    const allowed = new Set(grants.filter((grant) => (
      grantActions(grant).has("use")
      && (!Number.isFinite(grant.expires) || grant.expires >= Math.floor(Date.now() / 1000))
    )).map((grant) => `${grant.entityID}\u001f${grant.principalID}`));
    const visible = candidates.filter((item) => allowed.has(`${item.canonicalId}\u001f${principalID}`));
    const [entityRows, relationRows] = await Promise.all([
      persistence.foundation.entities.batchGet(
        visible.filter((item) => item.recordType === "audience-node").map((item) => item.canonicalId)
      ),
      persistence.foundation.relations.batchGet(
        visible.filter((item) => item.recordType === "audience-relation").map((item) => item.canonicalId)
      ),
    ]);
    return {
      nodes: entityRows.map((item) => ({
        serverId: String(item.e), lemmas: uniqueStrings(item.lemmas), names: uniqueStrings(item.names),
        ...(item.protectedAssetReference
          ? { protectedAssetReference: String(item.protectedAssetReference) }
          : {}),
        version: Math.max(1, Number(item.canonicalVersion || 1)),
      })),
      relations: relationRows.map((item) => ({
        serverId: String(item.id), subject: String(item.whole), predicate: String(item.prop), object: String(item.part),
        version: Math.max(1, Number(item.canonicalVersion || 1)), tombstone: item.tombstone === true,
        publisherId: String(item.canonicalOwnerId || item.by || ""),
        source: item.source && typeof item.source === "object" ? item.source : null,
      })),
      cursor: page.cursor,
    };
  }

  async function findProfiles(label, limit = 12) {
    if (!persistence.canonical.enabled) return [];
    const pages = await Promise.all(Array.from({ length: shards.profile }, (_, shard) => (
      persistence.canonical.queryProjection(
        profilePartition(label, shard, shards.profile),
        { limit: Math.max(1, Math.min(3, Number(limit) || 3)) }
      )
    )));
    const profiles = new Map();
    for (const item of pages.flatMap((page) => page?.Items || [])) {
      if (item?.recordType !== "public-profile" || !item.principalId) continue;
      profiles.set(String(item.principalId), {
        principalId: String(item.principalId),
        serverEntityId: String(item.serverEntityId),
        displayName: String(item.displayName || ""),
      });
    }
    return [...profiles.values()].slice(0, Math.max(1, Math.min(12, Number(limit) || 12)));
  }

  async function findEntityIdsByWord(wordId, { cursor, limit = 100 } = {}) {
    if (!persistence.canonical.enabled) return { entityIds: [], cursor: null };
    const maximum = Math.max(1, Math.min(500, Number(limit) || 100));
    const state = cursor?.source === "canonical-word-v2"
      ? cursor : { source: "canonical-word-v2", nextShard: 0, retry: [] };
    let nextShard = Math.max(0, Number(state.nextShard || 0));
    const retry = Array.isArray(state.retry) ? [...state.retry] : [];
    const entityIds = [];
    while (entityIds.length < maximum && (retry.length || nextShard < shards.word)) {
      const wave = [];
      const waveSize = Math.min(16, maximum - entityIds.length);
      while (wave.length < waveSize && (retry.length || nextShard < shards.word)) {
        if (retry.length) wave.push(retry.shift());
        else wave.push({ shard: nextShard++, key: null });
      }
      const pages = await Promise.all(wave.map((entry) => persistence.canonical.queryProjection(
        wordPartition(wordId, entry.shard, shards.word), { cursor: entry.key, limit: 1 }
      )));
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        entityIds.push(...(page?.Items || []).filter((item) => item?.recordType === "word-entity")
          .map((item) => String(item.canonicalId)));
        if (page?.LastEvaluatedKey) {
          retry.push({ shard: wave[index].shard, key: page.LastEvaluatedKey });
        }
      }
    }
    const next = retry.length || nextShard < shards.word
      ? { source: "canonical-word-v2", nextShard, retry } : null;
    return {
      entityIds: [...new Set(entityIds)],
      cursor: next,
    };
  }

  return Object.freeze({ enabled: persistence.canonical.enabled, findEntityIdsByWord, findProfiles,
    hasPublication, hydrateAudience, publish, shards });
}

module.exports = {
  DEFAULT_SHARDS, audiencePartition, compileContextRecords, configuredShards,
  createCanonicalContextStore, mappingPartition, profilePartition, wordPartition,
};
