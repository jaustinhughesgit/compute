"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const MAX_NODES = 96;
const MAX_RELATIONS = 192;
const MAX_LABELS = 12;
const MAX_LABEL_LENGTH = 160;
const MAX_SOURCE_SENTENCE = 1200;
const GENERIC_PROFILE_NAMES = new Set([
  "newuser",
  "new user",
  "user",
  "primary",
  "content",
]);
const PROFILE_PROPERTY_NAMES = new Set(["name", "display name", "full name"]);

function text(value, max = MAX_LABEL_LENGTH) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizedLabel(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9@._' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableId(prefix, ...parts) {
  const digest = crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part == null ? "" : part)).join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function payloadHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function principalEntityId(principalId) {
  return `usr_${text(principalId, 80).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function unwrapBody(raw) {
  if (typeof raw === "string") {
    try { return unwrapBody(JSON.parse(raw)); } catch { return {}; }
  }
  if (!raw || typeof raw !== "object") return {};
  if (raw.body && typeof raw.body === "object" && !Array.isArray(raw.body)) return raw.body;
  return raw;
}

function uniqueStrings(values, max = MAX_LABELS) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const item = text(value);
    const key = normalizedLabel(item);
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function normalizedNode(raw) {
  const localId = text(raw?.localId, 180);
  if (!localId) return null;
  return {
    localId,
    lemmas: uniqueStrings(raw?.lemmas),
    names: uniqueStrings(raw?.names),
  };
}

function normalizedRelation(raw) {
  const localId = text(raw?.localId, 180);
  const subjectLocalId = text(raw?.subjectLocalId, 180);
  const predicateLocalId = text(raw?.predicateLocalId, 180);
  const objectLocalId = text(raw?.objectLocalId, 180);
  if (!localId || !subjectLocalId || !predicateLocalId || !objectLocalId) return null;
  return {
    localId,
    subjectLocalId,
    predicateLocalId,
    objectLocalId,
    tombstone: raw?.tombstone === true,
  };
}

function normalizedUserReference(raw) {
  const localId = text(raw?.localId, 180);
  const label = text(raw?.label, MAX_LABEL_LENGTH);
  if (!localId || !label) return null;
  return { localId, label };
}

function profileCandidates(subdomain, word) {
  const candidates = uniqueStrings([
    subdomain?.output,
    word?.r,
    word?.s,
  ]);
  return candidates.filter((candidate) => !GENERIC_PROFILE_NAMES.has(normalizedLabel(candidate)));
}

function publicWorkspace(subdomain) {
  return subdomain?.z === true || subdomain?.z === "true";
}

function declaredProfileName(nodes, relations, resolutions, principalId) {
  const nodeById = new Map((Array.isArray(nodes) ? nodes : []).map((node) => [node.localId, node]));
  const selfServerId = principalEntityId(principalId);
  for (const relation of Array.isArray(relations) ? relations : []) {
    if (relation?.tombstone === true) continue;
    if (resolutions.get(relation.subjectLocalId)?.serverId !== selfServerId) continue;
    const predicate = nodeById.get(relation.predicateLocalId);
    const predicateLabels = uniqueStrings([...(predicate?.lemmas || []), ...(predicate?.names || [])])
      .map(normalizedLabel);
    if (!predicateLabels.some((label) => PROFILE_PROPERTY_NAMES.has(label))) continue;
    const object = nodeById.get(relation.objectLocalId);
    const displayName = uniqueStrings([...(object?.names || []), ...(object?.lemmas || [])])
      .find((label) => {
        const normalized = normalizedLabel(label);
        return normalized && !GENERIC_PROFILE_NAMES.has(normalized)
          && !["speaker", "current speaker", "me", "myself", "i"].includes(normalized);
      });
    if (displayName) return displayName;
  }
  return null;
}

function componentAudiences(relations, nodePrincipals, ownerAudience) {
  const adjacency = new Map();
  const add = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  for (const relation of relations) {
    add(relation.subjectLocalId, relation.predicateLocalId);
    add(relation.predicateLocalId, relation.subjectLocalId);
    add(relation.subjectLocalId, relation.objectLocalId);
    add(relation.objectLocalId, relation.subjectLocalId);
  }

  const byNode = new Map();
  const visited = new Set();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    const nodes = [];
    const audiences = new Set([ownerAudience]);
    visited.add(start);
    while (queue.length) {
      const current = queue.shift();
      nodes.push(current);
      const principal = nodePrincipals.get(current);
      if (principal) audiences.add(`u:${principal}`);
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    const resolved = Array.from(audiences).sort();
    for (const nodeId of nodes) byNode.set(nodeId, resolved);
  }
  return byNode;
}

function selfConnectedNodeIds(relations, nodePrincipals, principalId) {
  const adjacency = new Map();
  const add = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  for (const relation of Array.isArray(relations) ? relations : []) {
    add(relation.subjectLocalId, relation.predicateLocalId);
    add(relation.predicateLocalId, relation.subjectLocalId);
    add(relation.subjectLocalId, relation.objectLocalId);
    add(relation.objectLocalId, relation.subjectLocalId);
  }
  const selected = new Set();
  const queue = Array.from(nodePrincipals)
    .filter(([, nodePrincipalId]) => String(nodePrincipalId) === String(principalId))
    .map(([localId]) => localId);
  for (const localId of queue) selected.add(localId);
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (selected.has(next)) continue;
      selected.add(next);
      queue.push(next);
    }
  }
  return selected;
}

function encodeCursor(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  const value = text(cursor, 2048);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function errorEnvelope(code, message, statusCode = 400) {
  return { ok: false, statusCode, error: { code, message } };
}

function register({ on, use }) {
  const { getDocClient, getSub, getWord } = use();
  const tableName = () => process.env.CONTEXT_GRAPH_TABLE || "context_graph";

  async function requirePrincipal(meta) {
    const principalId = text(meta?.cookie?.e, 80);
    if (!principalId || principalId === "0") return null;
    return principalId;
  }

  async function verifyWorkspace(workspaceSu, principalId) {
    const su = text(workspaceSu, 180);
    if (!su) return { ok: false, code: "CONTEXT_WORKSPACE_REQUIRED" };
    const record = await getSub(su, "su");
    const subdomain = record?.Items?.[0] || null;
    if (!subdomain || text(subdomain.e, 80) !== principalId) {
      return { ok: false, code: "CONTEXT_WORKSPACE_FORBIDDEN" };
    }
    return { ok: true, subdomain };
  }

  async function registerCurrentProfile(doc, principalId, subdomain, declaredName = null) {
    if (!publicWorkspace(subdomain)) return null;
    if (!declaredName) {
      const existing = await doc.get({
        TableName: tableName(),
        Key: { audienceId: `u:${principalId}`, recordKey: "profile#self" },
        ConsistentRead: true,
      }).promise();
      if (existing?.Item?.profileSource === "context-graph") return existing.Item;
    }
    let word = null;
    if (subdomain?.a && typeof getWord === "function") {
      try { word = (await getWord(String(subdomain.a)))?.Items?.[0] || null; } catch {}
    }
    const candidates = uniqueStrings([declaredName, ...profileCandidates(subdomain, word)])
      .filter((candidate) => !GENERIC_PROFILE_NAMES.has(normalizedLabel(candidate)));
    if (!candidates.length) return null;
    const displayName = candidates[0];
    const handle = normalizedLabel(displayName);
    const now = new Date().toISOString();
    const item = {
      audienceId: `u:${principalId}`,
      recordKey: "profile#self",
      recordType: "profile",
      principalId,
      serverEntityId: principalEntityId(principalId),
      displayName,
      lookupKey: `handle#${handle}`,
      profileSource: declaredName ? "context-graph" : "workspace",
      updatedAt: now,
    };
    await doc.put({ TableName: tableName(), Item: item }).promise();
    return item;
  }

  async function findProfiles(doc, label) {
    const handle = normalizedLabel(label);
    if (!handle) return [];
    const result = await doc.query({
      TableName: tableName(),
      IndexName: "lookupKey-index",
      KeyConditionExpression: "#lookup = :lookup",
      ExpressionAttributeNames: { "#lookup": "lookupKey" },
      ExpressionAttributeValues: { ":lookup": `handle#${handle}` },
      Limit: 12,
    }).promise();
    const byPrincipal = new Map();
    for (const item of result?.Items || []) {
      const principalId = text(item?.principalId, 80);
      if (!principalId || byPrincipal.has(principalId)) continue;
      byPrincipal.set(principalId, {
        principalId,
        serverEntityId: text(item?.serverEntityId, 180) || principalEntityId(principalId),
        displayName: text(item?.displayName),
      });
    }
    // Backfill compatibility for accounts that predate the Context profile
    // index. The legacy word/subdomain records are already exact-indexed and a
    // matching entity is accepted only when it is public and has a users row.
    if (byPrincipal.size === 0) {
      try {
        const words = await doc.query({
          TableName: "words",
          IndexName: "sIndex",
          KeyConditionExpression: "#surface = :surface",
          ExpressionAttributeNames: { "#surface": "s" },
          ExpressionAttributeValues: { ":surface": handle },
          Limit: 12,
        }).promise();
        for (const word of words?.Items || []) {
          const subdomains = await getSub(String(word.a), "a");
          for (const subdomain of subdomains?.Items || []) {
            const principalId = text(subdomain?.e, 80);
            if (!principalId || principalId === "0" || subdomain?.z !== true) continue;
            const user = await doc.get({
              TableName: "users",
              Key: { userID: Number(principalId) },
              ConsistentRead: true,
            }).promise();
            if (!user?.Item || byPrincipal.has(principalId)) continue;
            byPrincipal.set(principalId, {
              principalId,
              serverEntityId: principalEntityId(principalId),
              displayName: text(subdomain.output || word.r || word.s),
            });
          }
        }
      } catch {}
    }
    return Array.from(byPrincipal.values());
  }

  async function resolveNode(doc, node, principalId, predicateIds, userReferenceLabels = []) {
    const labels = uniqueStrings([...(node.lemmas || []), ...(node.names || [])]);
    const normalized = labels.map(normalizedLabel).filter(Boolean);
    const currentSpeaker = normalized.some((label) => ["speaker", "current speaker", "me", "myself", "i"].includes(label));
    if (currentSpeaker) {
      return {
        serverId: principalEntityId(principalId),
        principalId,
        resolution: "current-user",
      };
    }

    if (/^(?:usr_[0-9]+|ctx_[a-f0-9]{32}|term_[a-f0-9]{32})$/.test(node.localId)) {
      const prior = await doc.get({
        TableName: tableName(),
        Key: { audienceId: `u:${principalId}`, recordKey: `node#${node.localId}` },
        ConsistentRead: true,
      }).promise();
      if (prior?.Item?.recordType === "node" && text(prior.Item.serverId, 180) === node.localId) {
        const userMatch = node.localId.match(/^usr_([0-9]+)$/);
        const referencedPrincipal = userMatch?.[1] || null;
        const priorAudiences = Array.isArray(prior.Item.audienceIds) ? prior.Item.audienceIds : [];
        return {
          serverId: node.localId,
          principalId: referencedPrincipal && priorAudiences.includes(`u:${referencedPrincipal}`)
            ? referencedPrincipal : null,
          resolution: "previously-acknowledged",
        };
      }
    }

    if (predicateIds.has(node.localId)) {
      return {
        serverId: stableId("term", normalized[0] || node.localId),
        principalId: null,
        resolution: "predicate-term",
      };
    }

    for (const label of uniqueStrings(userReferenceLabels)) {
      const matches = await findProfiles(doc, label);
      if (matches.length === 1) {
        return {
          serverId: matches[0].serverEntityId,
          principalId: matches[0].principalId,
          resolution: "user-handle",
          displayName: matches[0].displayName,
        };
      }
      if (matches.length > 1) {
        return {
          serverId: stableId("ctx", principalId, node.localId),
          principalId: null,
          resolution: "ambiguous-user-handle",
          warning: `The name '${text(label, 80)}' matches more than one user.`,
        };
      }
    }

    return {
      serverId: stableId("ctx", principalId, node.localId),
      principalId: null,
      resolution: "publisher-entity",
    };
  }

  async function writeBatches(doc, items) {
    const byKey = new Map();
    for (const item of items) {
      if (!item?.audienceId || !item?.recordKey) continue;
      byKey.set(`${item.audienceId}\u001f${item.recordKey}`, item);
    }
    const uniqueItems = Array.from(byKey.values());
    for (let index = 0; index < uniqueItems.length; index += 25) {
      let pending = uniqueItems.slice(index, index + 25).map((Item) => ({ PutRequest: { Item } }));
      for (let attempt = 0; pending.length && attempt < 7; attempt += 1) {
        const result = await doc.batchWrite({
          RequestItems: { [tableName()]: pending },
        }).promise();
        pending = result?.UnprocessedItems?.[tableName()] || [];
      }
      if (pending.length) throw new Error(`Context graph left ${pending.length} writes unprocessed`);
    }
  }

  on("contextGraphFindUser", async (ctx, meta) => {
    const principalId = await requirePrincipal(meta);
    if (!principalId) return errorEnvelope("CONTEXT_AUTH_REQUIRED", "A signed-in context identity is required.", 401);
    const body = unwrapBody(ctx?.req?.body);
    const query = text(body.query || body.name);
    if (!query) return errorEnvelope("CONTEXT_USER_QUERY_REQUIRED", "A user name is required.");
    const matches = await findProfiles(getDocClient(), query);
    return {
      ok: true,
      response: {
        schemaVersion: SCHEMA_VERSION,
        query,
        ambiguous: matches.length > 1,
        matches,
      },
    };
  });

  on("contextGraphPublish", async (ctx, meta) => {
    const principalId = await requirePrincipal(meta);
    if (!principalId) return errorEnvelope("CONTEXT_AUTH_REQUIRED", "A signed-in context identity is required.", 401);

    const body = unwrapBody(ctx?.req?.body);
    if (Number(body.schemaVersion || 0) !== SCHEMA_VERSION) {
      return errorEnvelope("CONTEXT_SCHEMA_UNSUPPORTED", "Context publication schemaVersion 1 is required.");
    }
    const workspaceSu = text((ctx?.path || "").split("/").filter(Boolean)[0] || body.workspaceSu, 180);
    const workspace = await verifyWorkspace(workspaceSu, principalId);
    if (!workspace.ok) return errorEnvelope(workspace.code, "The active workspace does not belong to this context identity.", 403);

    const idempotencyKey = text(body.idempotencyKey, 180);
    if (!idempotencyKey) return errorEnvelope("CONTEXT_IDEMPOTENCY_REQUIRED", "An idempotency key is required.");

    const nodes = (Array.isArray(body.nodes) ? body.nodes : []).map(normalizedNode).filter(Boolean);
    const relations = (Array.isArray(body.relations) ? body.relations : []).map(normalizedRelation).filter(Boolean);
    const userReferences = (Array.isArray(body.userReferences) ? body.userReferences : [])
      .map(normalizedUserReference).filter(Boolean).slice(0, 24);
    if (!nodes.length || !relations.length) {
      return errorEnvelope("CONTEXT_DELTA_REQUIRED", "At least one node and relation are required.");
    }
    if (nodes.length > MAX_NODES || relations.length > MAX_RELATIONS) {
      return errorEnvelope("CONTEXT_DELTA_TOO_LARGE", "The Context graph delta exceeds the publication limit.", 413);
    }
    const nodeById = new Map(nodes.map((node) => [node.localId, node]));
    for (const relation of relations) {
      for (const localId of [relation.subjectLocalId, relation.predicateLocalId, relation.objectLocalId]) {
        if (!nodeById.has(localId)) return errorEnvelope("CONTEXT_NODE_REFERENCE_INVALID", "A relation references a node that was not supplied.");
      }
    }

    const doc = getDocClient();
    await registerCurrentProfile(doc, principalId, workspace.subdomain);
    const ownerAudience = `u:${principalId}`;
    const ownerSyncAudience = `sync:${principalId}`;
    const idempotencyRecord = await doc.get({
      TableName: tableName(),
      Key: { audienceId: ownerSyncAudience, recordKey: `idem#${idempotencyKey}` },
      ConsistentRead: true,
    }).promise();
    if (idempotencyRecord?.Item?.acknowledgement) {
      return { ok: true, response: idempotencyRecord.Item.acknowledgement };
    }

    const predicateIds = new Set(relations.map((relation) => relation.predicateLocalId));
    const userLabelsByNode = new Map();
    for (const reference of userReferences) {
      if (!nodeById.has(reference.localId)) {
        return errorEnvelope("CONTEXT_USER_REFERENCE_INVALID", "A user reference names a node that was not supplied.");
      }
      const labels = userLabelsByNode.get(reference.localId) || [];
      labels.push(reference.label);
      userLabelsByNode.set(reference.localId, labels);
    }
    const resolutions = new Map();
    for (const node of nodes) {
      resolutions.set(node.localId, await resolveNode(
        doc,
        node,
        principalId,
        predicateIds,
        userLabelsByNode.get(node.localId) || []
      ));
    }
    const assertedProfileName = declaredProfileName(nodes, relations, resolutions, principalId);
    const assertedProfile = assertedProfileName
      ? await registerCurrentProfile(doc, principalId, workspace.subdomain, assertedProfileName)
      : null;
    if (assertedProfile) {
      for (const resolution of resolutions.values()) {
        if (resolution.serverId === assertedProfile.serverEntityId) {
          resolution.displayName = assertedProfile.displayName;
        }
      }
    }
    const nodePrincipals = new Map(
      Array.from(resolutions, ([localId, resolution]) => [localId, resolution.principalId]).filter(([, value]) => value)
    );
    const audiencesByNode = componentAudiences(relations, nodePrincipals, ownerAudience);
    const publicAudience = publicWorkspace(workspace.subdomain) ? `public:${principalId}` : null;
    if (publicAudience) {
      const publicNodeIds = selfConnectedNodeIds(relations, nodePrincipals, principalId);
      for (const [localId, audiences] of audiencesByNode) {
        if (publicNodeIds.has(localId)) {
          audiencesByNode.set(localId, Array.from(new Set([...audiences, publicAudience])).sort());
        }
      }
    }
    const now = new Date().toISOString();
    const source = {
      requestId: text(body?.source?.requestId, 180) || null,
      sentence: text(body?.source?.sentence, MAX_SOURCE_SENTENCE) || null,
      contextId: text(body?.source?.contextId, 120) || null,
      pathSignature: text(body?.source?.pathSignature, 300) || null,
    };
    const writes = [];
    const nodeAcks = [];
    const warnings = [];

    for (const node of nodes) {
      const resolution = resolutions.get(node.localId);
      const audienceIds = audiencesByNode.get(node.localId) || [ownerAudience];
      const publicRecord = !!publicAudience && audienceIds.includes(publicAudience);
      const nodePayload = {
        serverId: resolution.serverId,
        lemmas: node.lemmas,
        names: uniqueStrings([resolution.displayName, ...(node.names || [])]),
        resolution: resolution.resolution,
        visibility: publicRecord ? "public-workspace" : "participants",
      };
      const nodePayloadHash = payloadHash(nodePayload);
      const existingNode = await doc.get({
        TableName: tableName(),
        Key: { audienceId: ownerAudience, recordKey: `node#${resolution.serverId}` },
        ConsistentRead: true,
      }).promise();
      const nodeVersion = existingNode?.Item?.payloadHash === nodePayloadHash
        ? Number(existingNode.Item.version || 1)
        : Math.max(1, Number(existingNode?.Item?.version || 0) + 1);
      const canonicalNode = {
        recordType: "node",
        publisherId: principalId,
        audienceIds,
        ...nodePayload,
        payloadHash: nodePayloadHash,
        version: nodeVersion,
        updatedAt: now,
      };
      for (const audienceId of audienceIds) {
        writes.push({ audienceId, recordKey: `node#${resolution.serverId}`, ...canonicalNode });
      }
      writes.push({
        audienceId: ownerSyncAudience,
        recordKey: `map#${stableId("local", node.localId)}`,
        recordType: "mapping",
        localId: node.localId,
        serverId: resolution.serverId,
        version: 1,
        updatedAt: now,
      });
      nodeAcks.push({
        localId: node.localId,
        serverId: resolution.serverId,
        version: nodeVersion,
        resolution: resolution.resolution,
      });
      if (resolution.warning) warnings.push({ localId: node.localId, message: resolution.warning });
    }

    const relationAcks = [];
    for (const relation of relations) {
      const subject = resolutions.get(relation.subjectLocalId).serverId;
      const predicate = resolutions.get(relation.predicateLocalId).serverId;
      const object = resolutions.get(relation.objectLocalId).serverId;
      const serverId = stableId("rel", principalId, relation.localId);
      const currentAudienceIds = audiencesByNode.get(relation.subjectLocalId) || [ownerAudience];
      const publicRecord = !!publicAudience && currentAudienceIds.includes(publicAudience);
      const relationPayload = {
        serverId,
        subject,
        predicate,
        object,
        source,
        visibility: publicRecord ? "public-workspace" : "participants",
        tombstone: relation.tombstone,
      };
      const relationPayloadHash = payloadHash(relationPayload);
      const existingRelation = await doc.get({
        TableName: tableName(),
        Key: { audienceId: ownerAudience, recordKey: `relation#${serverId}` },
        ConsistentRead: true,
      }).promise();
      const previousAudienceIds = Array.isArray(existingRelation?.Item?.audienceIds)
        ? existingRelation.Item.audienceIds : [];
      const audienceIds = Array.from(new Set([
        ...currentAudienceIds,
        ...(relation.tombstone ? previousAudienceIds : []),
      ])).sort();
      const relationVersion = existingRelation?.Item?.payloadHash === relationPayloadHash
        ? Number(existingRelation.Item.version || 1)
        : Math.max(1, Number(existingRelation?.Item?.version || 0) + 1);
      const canonicalRelation = {
        recordType: "relation",
        publisherId: principalId,
        audienceIds,
        ...relationPayload,
        payloadHash: relationPayloadHash,
        version: relationVersion,
        updatedAt: now,
      };
      for (const audienceId of audienceIds) {
        const revokedForAudience = relation.tombstone || !currentAudienceIds.includes(audienceId);
        writes.push({
          audienceId,
          recordKey: `relation#${serverId}`,
          ...canonicalRelation,
          tombstone: revokedForAudience,
        });
      }
      relationAcks.push({ localId: relation.localId, serverId, version: relationVersion, tombstone: relation.tombstone });
    }

    const acknowledgement = {
      schemaVersion: SCHEMA_VERSION,
      kind: "context-publication-ack",
      idempotencyKey,
      principalId,
      selfServerId: principalEntityId(principalId),
      nodes: nodeAcks,
      relations: relationAcks,
      warnings,
      acknowledgedAt: now,
    };
    writes.push({
      audienceId: ownerSyncAudience,
      recordKey: `idem#${idempotencyKey}`,
      recordType: "idempotency",
      acknowledgement,
      updatedAt: now,
      expiresAt: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
    });
    await writeBatches(doc, writes);
    return { ok: true, response: acknowledgement };
  });

  on("contextGraphHydrate", async (ctx, meta) => {
    const principalId = await requirePrincipal(meta);
    if (!principalId) return errorEnvelope("CONTEXT_AUTH_REQUIRED", "A signed-in context identity is required.", 401);
    const body = unwrapBody(ctx?.req?.body);
    if (body.schemaVersion != null && Number(body.schemaVersion) !== SCHEMA_VERSION) {
      return errorEnvelope("CONTEXT_SCHEMA_UNSUPPORTED", "Context hydration schemaVersion 1 is required.");
    }
    const workspaceSu = text((ctx?.path || "").split("/").filter(Boolean)[0] || body.workspaceSu, 180);
    const workspace = await verifyWorkspace(workspaceSu, principalId);
    if (!workspace.ok) return errorEnvelope(workspace.code, "The active workspace does not belong to this context identity.", 403);

    const doc = getDocClient();
    await registerCurrentProfile(doc, principalId, workspace.subdomain);
    const limit = Math.max(25, Math.min(500, Number(body.limit || 300)));
    const page = await doc.query({
      TableName: tableName(),
      KeyConditionExpression: "#audience = :audience",
      ExpressionAttributeNames: { "#audience": "audienceId" },
      ExpressionAttributeValues: { ":audience": `u:${principalId}` },
      ExclusiveStartKey: decodeCursor(body.cursor),
      Limit: limit,
      ConsistentRead: true,
    }).promise();

    const nodes = [];
    const relations = [];
    for (const item of page?.Items || []) {
      if (item?.recordType === "node") {
        nodes.push({
          serverId: text(item.serverId, 180),
          lemmas: uniqueStrings(item.lemmas),
          names: uniqueStrings(item.names),
          version: Number(item.version || 1),
        });
      } else if (item?.recordType === "relation") {
        relations.push({
          serverId: text(item.serverId, 180),
          subject: text(item.subject, 180),
          predicate: text(item.predicate, 180),
          object: text(item.object, 180),
          version: Number(item.version || 1),
          tombstone: item.tombstone === true,
          publisherId: text(item.publisherId, 80),
          source: item.source && typeof item.source === "object" ? item.source : null,
        });
      }
    }
    return {
      ok: true,
      response: {
        schemaVersion: SCHEMA_VERSION,
        kind: "context-hydration-page",
        principalId,
        selfServerId: principalEntityId(principalId),
        nodes,
        relations,
        cursor: encodeCursor(page?.LastEvaluatedKey),
        hydratedAt: new Date().toISOString(),
      },
    };
  });

  on("contextGraphHydrateNamed", async (ctx, meta) => {
    const principalId = await requirePrincipal(meta);
    if (!principalId) return errorEnvelope("CONTEXT_AUTH_REQUIRED", "A signed-in context identity is required.", 401);
    const body = unwrapBody(ctx?.req?.body);
    if (body.schemaVersion != null && Number(body.schemaVersion) !== SCHEMA_VERSION) {
      return errorEnvelope("CONTEXT_SCHEMA_UNSUPPORTED", "Context hydration schemaVersion 1 is required.");
    }
    const workspaceSu = text((ctx?.path || "").split("/").filter(Boolean)[0] || body.workspaceSu, 180);
    const workspace = await verifyWorkspace(workspaceSu, principalId);
    if (!workspace.ok) return errorEnvelope(workspace.code, "The active workspace does not belong to this context identity.", 403);

    const query = text(body.query || body.name);
    if (!query) return errorEnvelope("CONTEXT_USER_QUERY_REQUIRED", "A user name is required.");
    const doc = getDocClient();
    const matches = await findProfiles(doc, query);
    if (matches.length !== 1) {
      return {
        ok: true,
        response: {
          schemaVersion: SCHEMA_VERSION,
          kind: "context-named-hydration-page",
          query,
          found: false,
          ambiguous: matches.length > 1,
          matches: matches.map(({ serverEntityId, displayName }) => ({ serverEntityId, displayName })),
          selfServerId: principalEntityId(principalId),
          nodes: [],
          relations: [],
          cursor: null,
          hydratedAt: new Date().toISOString(),
        },
      };
    }

    const target = matches[0];
    const limit = Math.max(25, Math.min(500, Number(body.limit || 300)));
    const page = await doc.query({
      TableName: tableName(),
      KeyConditionExpression: "#audience = :audience",
      ExpressionAttributeNames: { "#audience": "audienceId" },
      ExpressionAttributeValues: { ":audience": `public:${target.principalId}` },
      ExclusiveStartKey: decodeCursor(body.cursor),
      Limit: limit,
      ConsistentRead: true,
    }).promise();
    const nodes = [];
    const relations = [];
    for (const item of page?.Items || []) {
      if (item?.recordType === "node") {
        const serverId = text(item.serverId, 180);
        const lemmas = uniqueStrings(item.lemmas).filter((label) => (
          serverId !== target.serverEntityId
          || !["speaker", "current speaker", "i", "me", "myself"].includes(normalizedLabel(label))
        ));
        nodes.push({
          serverId,
          lemmas,
          names: uniqueStrings([
            ...(item.names || []),
            ...(serverId === target.serverEntityId ? [target.displayName] : []),
          ]),
          version: Number(item.version || 1),
        });
      } else if (item?.recordType === "relation") {
        relations.push({
          serverId: text(item.serverId, 180),
          subject: text(item.subject, 180),
          predicate: text(item.predicate, 180),
          object: text(item.object, 180),
          version: Number(item.version || 1),
          tombstone: item.tombstone === true,
          publisherId: text(item.publisherId, 80),
          source: item.source && typeof item.source === "object" ? item.source : null,
        });
      }
    }
    if (!nodes.some((node) => node.serverId === target.serverEntityId)) {
      nodes.push({
        serverId: target.serverEntityId,
        lemmas: [],
        names: uniqueStrings([target.displayName]),
        version: 1,
      });
    }
    return {
      ok: true,
      response: {
        schemaVersion: SCHEMA_VERSION,
        kind: "context-named-hydration-page",
        query,
        found: true,
        ambiguous: false,
        namedServerId: target.serverEntityId,
        displayName: target.displayName,
        selfServerId: principalEntityId(principalId),
        nodes,
        relations,
        cursor: encodeCursor(page?.LastEvaluatedKey),
        hydratedAt: new Date().toISOString(),
      },
    };
  });

  return { name: "contextGraph" };
}

module.exports = {
  register,
  __test: {
    normalizedLabel,
    stableId,
    payloadHash,
    principalEntityId,
    normalizedNode,
    normalizedRelation,
    normalizedUserReference,
    profileCandidates,
    publicWorkspace,
    declaredProfileName,
    componentAudiences,
    selfConnectedNodeIds,
    encodeCursor,
    decodeCursor,
  },
};
