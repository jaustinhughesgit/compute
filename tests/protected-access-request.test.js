"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { register } = require("../app/routes/modules/protectedAssets");

const assetId = "pa_1234567890abcdef1234567890abcdef";
const asset = {
  assetId,
  ownerId: "u:1",
  version: 1,
  metadata: {
    label: "Protected quantity",
    assetType: "private_note",
    providerId: null,
    policy: { allowedUses: ["reveal"] },
  },
  envelope: { keyWraps: { user: {} } },
  createdAt: "2026-08-14T12:00:00.000Z",
  updatedAt: "2026-08-14T12:00:00.000Z",
};

function registeredWith({ getItem }) {
  const handlers = new Map();
  const writes = [];
  const transactions = [];
  const notifications = {
    published: [], resolved: [],
    publish: async (value) => {
      notifications.published.push(value);
      return { notificationId: "n_0001_owner" };
    },
    resolve: async (...value) => notifications.resolved.push(value),
  };
  const dynamodb = {
    get: (request) => ({ promise: async () => ({ Item: getItem(request) }) }),
    put: (request) => ({ promise: async () => { writes.push(request); } }),
    update: (request) => ({ promise: async () => { writes.push(request); return {}; } }),
    delete: (request) => ({ promise: async () => { writes.push(request); } }),
    transactWrite: (request) => ({ promise: async () => transactions.push(request) }),
  };
  const shared = {
    deps: { dynamodb },
    registry: { notificationLifecycle: notifications },
    expose() {},
  };
  register({ on: (name, handler) => handlers.set(name, handler), use: () => shared });
  return { handlers, notifications, transactions, writes };
}

test("a non-owner can request access without receiving metadata or plaintext", async () => {
  const state = registeredWith({
    getItem: (request) => request.TableName === "protectedAssets" ? asset : null,
  });
  const result = await state.handlers.get("protectedAsset:request-access")({
    req: {
      cookies: { e: "2" },
      body: { reference: `protected_asset:${assetId}`, idempotencyKey: "one-click" },
    },
    cookie: { e: "2" },
  });
  assert.equal(result.ok, true);
  assert.match(result.requestId, /^par_[a-f0-9]{40}$/);
  assert.equal(state.notifications.published.length, 1);
  assert.deepEqual(state.notifications.published[0], {
    recipient: "u:1",
    kind: "protected_access_request",
    payload: {
      requestId: result.requestId,
      requesterId: "u:2",
      reference: `protected_asset:${assetId}`,
    },
    dedupeKey: `access-request:${result.requestId}`,
    occurredAt: state.notifications.published[0].occurredAt,
  });
  assert.match(state.notifications.published[0].occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  const requestWrite = state.writes.find((write) => write.TableName === "protectedAssetAccessRequests" && write.Item);
  assert.equal(requestWrite.Item.status, "pending");
  assert.equal(JSON.stringify(requestWrite).includes("Protected quantity"), false);
});

test("only the owner can deny a pending request and the requester receives confirmation", async () => {
  const request = {
    requestId: `par_${"a".repeat(40)}`,
    assetId,
    ownerId: "u:1",
    requesterId: "u:2",
    status: "pending",
    ownerNotificationId: "n_0001_owner",
  };
  const state = registeredWith({
    getItem: (read) => read.TableName === "protectedAssetAccessRequests" ? request : asset,
  });
  const result = await state.handlers.get("protectedAsset:decide-access")({
    req: { cookies: { e: "1" }, body: { requestId: request.requestId, decision: "denied" } },
    cookie: { e: "1" },
  });
  assert.equal(result.decision, "denied");
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].TransactItems.length, 1);
  assert.deepEqual(state.notifications.resolved, [["u:1", "n_0001_owner"]]);
  assert.equal(state.notifications.published.at(-1).recipient, "u:2");
  assert.equal(state.notifications.published.at(-1).payload.decision, "denied");
  assert.equal(state.notifications.published.at(-1).dedupeKey, `access-decision:${request.requestId}:denied`);
});

test("a committed decision can be retried until its requester notification is confirmed", async () => {
  const request = {
    requestId: `par_${"b".repeat(40)}`,
    assetId,
    ownerId: "u:1",
    requesterId: "u:2",
    status: "denied",
    ownerNotificationId: "n_0002_owner",
  };
  const state = registeredWith({
    getItem: (read) => read.TableName === "protectedAssetAccessRequests" ? request : asset,
  });
  const result = await state.handlers.get("protectedAsset:decide-access")({
    req: { cookies: { e: "1" }, body: { requestId: request.requestId, decision: "denied" } },
    cookie: { e: "1" },
  });
  assert.equal(result.duplicate, true);
  assert.equal(state.transactions.length, 0);
  assert.equal(state.notifications.published.length, 1);
  assert.deepEqual(state.notifications.resolved, [["u:1", "n_0002_owner"]]);
  assert.equal(state.writes.some((write) => write.UpdateExpression?.includes("#decisionNotificationId")), true);
});

test("approval atomically stores the requester wrap and a version-bound recipient use grant", async () => {
  const request = {
    requestId: `par_${"c".repeat(40)}`,
    assetId,
    ownerId: "u:1",
    requesterId: "u:2",
    status: "pending",
    ownerNotificationId: "n_0003_owner",
  };
  const ownerWrap = {
    algorithm: "ECDH-ES+A256KW", keyId: "1", ephemeralPublicKey: "A".repeat(64),
    iv: "A".repeat(16), salt: "A".repeat(43), wrappedKey: "A".repeat(48),
  };
  const recipientWrap = {
    algorithm: "ECDH-ES+A256KW", keyId: "2:v1", ephemeralPublicKey: "B".repeat(64),
    iv: "B".repeat(16), salt: "B".repeat(43), wrappedKey: "B".repeat(48),
  };
  const approvalAsset = {
    ...asset,
    envelope: {
      schemaVersion: 1,
      algorithm: "A256GCM",
      iv: "A".repeat(16),
      ciphertext: "A".repeat(32),
      aad: "A".repeat(16),
      keyWraps: { user: { "1": ownerWrap }, executor: null },
    },
  };
  const state = registeredWith({
    getItem: (read) => read.TableName === "protectedAssetAccessRequests" ? request : approvalAsset,
  });
  const result = await state.handlers.get("protectedAsset:decide-access")({
    req: { cookies: { e: "1" }, body: {
      requestId: request.requestId,
      decision: "approved",
      keyVersion: 1,
      recipientWrap,
      grantDuration: "15_minutes",
    } },
    cookie: { e: "1" },
  });
  assert.equal(result.decision, "approved");
  assert.equal(state.transactions[0].TransactItems.length, 3);
  const assetUpdate = state.transactions[0].TransactItems[0].Update;
  const grant = state.transactions[0].TransactItems[1].Put.Item;
  assert.equal(assetUpdate.ExpressionAttributeValues[":wrap"].keyId, "2:v1");
  assert.equal(grant.principalId, "u:2");
  assert.deepEqual(grant.canonicalActions, ["use"]);
  assert.deepEqual(grant.deliveries, ["recipient"]);
  assert.equal(grant.assetVersion, 1);
  assert.equal(grant.lifecycle.grantDuration, "15_minutes");
  assert.equal(Date.parse(grant.lifecycle.expiresAt) - Date.parse(grant.createdAt), 15 * 60_000);
  assert.equal(grant.lifecycle.maxUses, null);
  assert.deepEqual(state.notifications.published.at(-1).payload, {
    requestId: request.requestId,
    decision: "approved",
    reference: `protected_asset:${assetId}`,
    grantDuration: "15_minutes",
    grantExpiresAt: grant.lifecycle.expiresAt,
    grantMaxUses: null,
  });
});

test("an approved recipient query returns only that recipient wrap and consumes one grant use", async () => {
  const recipientWrap = {
    algorithm: "ECDH-ES+A256KW", keyId: "2:v1", ephemeralPublicKey: "B".repeat(64),
    iv: "B".repeat(16), salt: "B".repeat(43), wrappedKey: "B".repeat(48),
  };
  const sharedAsset = {
    ...asset,
    metadata: {
      ...asset.metadata,
      policy: {
        allowedUses: ["reveal"], destinations: [], capabilityIds: [], moduleIds: [],
        approvalMode: "every_use", trustMode: "local-zero-knowledge", plaintextRetention: "never",
      },
    },
    envelope: {
      schemaVersion: 1, algorithm: "A256GCM", iv: "A".repeat(16), ciphertext: "A".repeat(32),
      aad: "A".repeat(16), keyWraps: { user: { "2": recipientWrap }, executor: null },
    },
  };
  const grant = {
    principalId: "u:2", assetId, ownerId: "u:1", assetVersion: 1,
    canonicalActions: ["use"], deliveries: ["recipient"],
    lifecycle: { state: "active", tombstone: false, grantDuration: "once", maxUses: 1, useCount: 0 },
  };
  const state = registeredWith({
    getItem: (read) => {
      if (read.TableName === "protectedAssets") return sharedAsset;
      if (read.TableName === "protectedAssetGrants") return grant;
      return null;
    },
  });
  const result = await state.handlers.get("protectedAsset:envelope")({
    req: { cookies: { e: "2" }, body: {
      reference: `protected_asset:${assetId}`,
      purpose: "recipient_query",
      approved: true,
    } },
    cookie: { e: "2" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.envelope.keyWraps.user), ["2"]);
  const consume = state.writes.find((write) => (
    write.TableName === "protectedAssetGrants" && write.UpdateExpression?.includes("#useCount")
  ));
  assert.ok(consume);
});
