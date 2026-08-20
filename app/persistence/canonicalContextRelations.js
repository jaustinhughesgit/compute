/**
 * Platform: Compiles Context facts into typed, versioned, governed canonical relations.
 * Technical: Adds link, version, grant, and sharded audience rows while preserving source and tombstone evidence.
 */
"use strict";

const { shardFor, stableIdentifier } = require("./canonicalIdentifiers");
const {
  addGrant,
  audiencePartition,
  grantPrincipal,
  versionRow,
} = require("./canonicalContextProjection");

function addRelationRecords({ relation, ownerId, workspaceSu, timestamp, shards, records }) {
  const version = Math.max(1, Number(relation.version || 1));
  const payloadHash = String(
    relation.payloadHash || stableIdentifier("hash", relation.serverId, version)
  );
  const versionItem = versionRow(
    relation.serverId, version, payloadHash, ownerId, timestamp, "relation"
  );
  records.versions.set(`${versionItem.v}\u001f${versionItem.d}`, versionItem);
  records.relations.set(relation.serverId, {
    id: relation.serverId,
    whole: relation.subject,
    part: relation.object,
    prop: relation.predicate,
    ckey: `${relation.subject}|${relation.object}`,
    type: "context",
    by: ownerId,
    canonicalSchemaVersion: 1,
    canonicalRecordType: "relation",
    canonicalKind: "fact",
    canonicalVersion: version,
    canonicalOwnerId: ownerId,
    canonicalWorkspaceId: workspaceSu,
    canonicalPayloadHash: payloadHash,
    canonicalLifecycle: {
      state: relation.tombstone ? "deleted" : "active",
      tombstone: relation.tombstone === true,
    },
    audienceIds: [...new Set(relation.audienceIds || [`u:${ownerId}`])],
    source: relation.source || null,
    tombstone: relation.tombstone === true,
    updatedAt: timestamp,
  });
  for (const audienceId of relation.audienceIds || [`u:${ownerId}`]) {
    const shard = shardFor(relation.serverId, shards.audience);
    const projection = {
      pk: audiencePartition(audienceId, shard, shards.audience),
      sk: `RELATION#${relation.serverId}`,
      recordType: "audience-relation",
      audienceId,
      canonicalId: relation.serverId,
      canonicalVersion: version,
      tombstone: relation.tombstone === true,
      updatedAt: timestamp,
    };
    records.projections.set(`${projection.pk}\u001f${projection.sk}`, projection);
    addGrant(records.grants, relation.serverId, grantPrincipal(audienceId), ownerId, timestamp);
  }
  const activeAudienceIds = new Set(relation.audienceIds || [`u:${ownerId}`]);
  for (const audienceId of relation.revokedAudienceIds || []) {
    if (!audienceId || activeAudienceIds.has(audienceId)) continue;
    const shard = shardFor(relation.serverId, shards.audience);
    const projection = {
      pk: audiencePartition(audienceId, shard, shards.audience),
      sk: `RELATION#${relation.serverId}`,
      recordType: "audience-relation",
      audienceId,
      canonicalId: relation.serverId,
      canonicalVersion: version,
      tombstone: true,
      updatedAt: timestamp,
    };
    records.projections.set(`${projection.pk}\u001f${projection.sk}`, projection);
  }
}

module.exports = { addRelationRecords };
