/**
 * Platform: Compiles Context nodes into independently governed lexical and entity records.
 * Technical: Adds Word, entity, address, version, grant, audience, lexical, and local-mapping rows to caller-owned maps.
 */
"use strict";

const { normalizeLexeme, shardFor, stableIdentifier, wordIdentifier } = require("./canonicalIdentifiers");
const {
  addGrant,
  audiencePartition,
  grantPrincipal,
  literalProperty,
  mappingPartition,
  uniqueStrings,
  versionRow,
  wordPartition,
} = require("./canonicalContextProjection");

function addNodeRecords({ node, ownerId, workspaceSu, groupId, timestamp, shards, records }) {
  const labels = uniqueStrings([...(node.names || []), ...(node.lemmas || [])]);
  const primaryLabel = labels[0] || node.serverId;
  const wordIds = [];
  for (const label of labels.length ? labels : [node.serverId]) {
    const normalized = normalizeLexeme(label);
    const wordId = wordIdentifier(normalized);
    if (!wordId) continue;
    wordIds.push(wordId);
    records.words.set(wordId, {
      a: wordId,
      r: label,
      s: normalized,
      canonicalSchemaVersion: 1,
      canonicalRecordType: "word",
      language: "und",
      updatedAt: timestamp,
    });
    const wordShard = shardFor(node.serverId, shards.word);
    const projection = {
      pk: wordPartition(wordId, wordShard, shards.word),
      sk: `ENTITY#${node.serverId}`,
      recordType: "word-entity",
      wordId,
      canonicalId: node.serverId,
      canonicalVersion: Number(node.version || 1),
      updatedAt: timestamp,
    };
    records.projections.set(`${projection.pk}\u001f${projection.sk}`, projection);
  }

  const primaryWordId = wordIds[0] || wordIdentifier(node.serverId);
  const version = Math.max(1, Number(node.version || 1));
  const payloadHash = String(node.payloadHash || stableIdentifier("hash", node.serverId, labels.join("|")));
  const entityKind = String(node.serverId).startsWith("usr_")
    ? "person" : String(node.serverId).startsWith("term_") ? "structural" : "data";
  const versionItem = versionRow(node.serverId, version, payloadHash, ownerId, timestamp, "entity");
  records.versions.set(`${versionItem.v}\u001f${versionItem.d}`, versionItem);
  records.entities.set(node.serverId, {
    e: node.serverId,
    a: primaryWordId,
    v: versionItem.v,
    g: groupId,
    h: node.serverId,
    ai: [],
    canonicalSchemaVersion: 1,
    canonicalRecordType: "entity",
    canonicalKind: entityKind,
    canonicalVersion: version,
    canonicalOwnerId: ownerId,
    canonicalWorkspaceId: workspaceSu,
    canonicalPayloadHash: payloadHash,
    canonicalLifecycle: { state: "active", tombstone: false },
    wordIds: [...new Set(wordIds)],
    lemmas: uniqueStrings(node.lemmas),
    names: uniqueStrings(node.names),
    properties: literalProperty(labels),
    visibility: node.visibility || "participants",
    audienceIds: [...new Set(node.audienceIds || [`u:${ownerId}`])],
    updatedAt: timestamp,
  });
  const addressId = stableIdentifier("addr", node.serverId);
  records.addresses.set(addressId, {
    su: addressId,
    a: primaryWordId,
    e: node.serverId,
    g: groupId,
    z: node.visibility === "public-workspace",
    output: primaryLabel,
    path: `/context/${node.serverId}`,
    canonicalSchemaVersion: 1,
    canonicalRecordType: "address",
    canonicalVersion: version,
    canonicalOwnerId: ownerId,
    updatedAt: timestamp,
  });

  for (const audienceId of node.audienceIds || [`u:${ownerId}`]) {
    const shard = shardFor(node.serverId, shards.audience);
    const projection = {
      pk: audiencePartition(audienceId, shard, shards.audience),
      sk: `NODE#${node.serverId}`,
      recordType: "audience-node",
      audienceId,
      canonicalId: node.serverId,
      canonicalVersion: version,
      tombstone: false,
      updatedAt: timestamp,
    };
    records.projections.set(`${projection.pk}\u001f${projection.sk}`, projection);
    addGrant(records.grants, node.serverId, grantPrincipal(audienceId), ownerId, timestamp);
  }
  if (node.localId) {
    const projection = {
      pk: mappingPartition(ownerId, node.localId, shards.mapping),
      sk: `LOCAL#${node.localId}`,
      recordType: "local-mapping",
      principalId: ownerId,
      localId: node.localId,
      canonicalId: node.serverId,
      canonicalVersion: version,
      updatedAt: timestamp,
    };
    records.projections.set(`${projection.pk}\u001f${projection.sk}`, projection);
  }
}

module.exports = { addNodeRecords };
