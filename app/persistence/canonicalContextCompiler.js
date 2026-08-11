/**
 * Platform: Converts one browser Context publication into established canonical record families.
 * Technical: Coordinates node/relation compilers and adds profile plus idempotency projections without issuing I/O.
 */
"use strict";

const { shardFor, stableIdentifier, wordIdentifier } = require("./canonicalIdentifiers");
const { addNodeRecords } = require("./canonicalContextNodes");
const { addRelationRecords } = require("./canonicalContextRelations");
const {
  DEFAULT_SHARDS,
  addGrant,
  padShard,
  profilePartition,
  uniqueStrings,
  versionRow,
} = require("./canonicalContextProjection");

function emptyRecords() {
  return {
    words: new Map(),
    entities: new Map(),
    addresses: new Map(),
    groups: new Map(),
    relations: new Map(),
    versions: new Map(),
    grants: new Map(),
    projections: new Map(),
  };
}

function compileContextRecords({
  principalId,
  workspaceSu,
  idempotencyKey,
  nodes,
  relations,
  profile,
  updatedAt,
  shards = DEFAULT_SHARDS,
}) {
  const ownerId = String(principalId);
  const timestamp = updatedAt || new Date().toISOString();
  const records = emptyRecords();
  const nodeInputs = new Map(
    (Array.isArray(nodes) ? nodes : []).map((node) => [node.serverId, { ...node }])
  );

  if (profile?.serverEntityId && profile?.displayName) {
    const existing = nodeInputs.get(profile.serverEntityId) || {
      localId: `profile:${ownerId}`,
      serverId: profile.serverEntityId,
      version: 1,
      resolution: "current-user",
      lemmas: [],
      names: [],
      payloadHash: stableIdentifier("hash", profile.serverEntityId, profile.displayName),
      visibility: "public-workspace",
      audienceIds: [`u:${ownerId}`, `public:${ownerId}`],
    };
    existing.names = uniqueStrings([profile.displayName, ...(existing.names || [])]);
    existing.audienceIds = [
      ...new Set([...(existing.audienceIds || []), `u:${ownerId}`, `public:${ownerId}`]),
    ];
    existing.visibility = "public-workspace";
    nodeInputs.set(profile.serverEntityId, existing);
  }

  const groupId = stableIdentifier("grp", "context", ownerId, workspaceSu);
  const groupWordId = wordIdentifier("context");
  const headId = profile?.serverEntityId
    || [...nodeInputs.values()].find((node) => node.resolution === "current-user")?.serverId
    || [...nodeInputs.keys()][0];
  const groupPayloadHash = stableIdentifier("hash", groupId, headId, workspaceSu);
  const groupVersion = versionRow(groupId, 1, groupPayloadHash, ownerId, timestamp, "group");
  records.words.set(groupWordId, {
    a: groupWordId, r: "Context", s: "context", canonicalSchemaVersion: 1,
    canonicalRecordType: "word", language: "und", updatedAt: timestamp,
  });
  records.versions.set(`${groupVersion.v}\u001f${groupVersion.d}`, groupVersion);
  records.groups.set(groupId, {
    g: groupId, a: groupWordId, e: headId, ai: [], canonicalSchemaVersion: 1,
    canonicalRecordType: "group", canonicalKind: "context", canonicalVersion: 1,
    canonicalOwnerId: ownerId, canonicalWorkspaceId: workspaceSu,
    canonicalPayloadHash: groupPayloadHash, updatedAt: timestamp,
  });
  addGrant(records.grants, groupId, `u:${ownerId}`, ownerId, timestamp);

  for (const node of nodeInputs.values()) {
    addNodeRecords({ node, ownerId, workspaceSu, groupId, timestamp, shards, records });
  }
  for (const relation of Array.isArray(relations) ? relations : []) {
    addRelationRecords({ relation, ownerId, workspaceSu, timestamp, shards, records });
  }

  if (profile?.displayName && profile?.principalId) {
    const profileShard = shardFor(profile.principalId, shards.profile);
    const projection = {
      pk: profilePartition(profile.displayName, profileShard, shards.profile),
      sk: `PRINCIPAL#${profile.principalId}`,
      recordType: "public-profile",
      principalId: String(profile.principalId),
      serverEntityId: profile.serverEntityId,
      displayName: profile.displayName,
      updatedAt: timestamp,
    };
    records.projections.set(`${projection.pk}\u001f${projection.sk}`, projection);
  }
  const syncProjection = {
    pk: `SYNC#${ownerId}#${padShard(shardFor(idempotencyKey, shards.mapping), shards.mapping)}`,
    sk: `IDEMPOTENCY#${idempotencyKey}`,
    recordType: "canonical-publication",
    principalId: ownerId,
    idempotencyKey,
    status: "applied",
    updatedAt: timestamp,
  };
  records.projections.set(`${syncProjection.pk}\u001f${syncProjection.sk}`, syncProjection);

  return Object.fromEntries(
    Object.entries(records).map(([key, values]) => [key, [...values.values()]])
  );
}

module.exports = { compileContextRecords };
