"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createGrantItems,
  createProtectedAssetGrantStore,
  normalizeGrantRequests,
} = require("../app/routes/protectedAssetGrants");
const { register } = require("../app/routes/modules/protectedAssets");

const assetId = "pa_1234567890abcdef1234567890abcdef";
const envelope = {
  keyWraps: { user: {
    "2": { keyId: "2" },
    "3": { keyId: "3" },
  } },
};

function storeWith(grants) {
  const calls = [];
  const dynamodb = {
    get: ({ Key }) => ({ promise: async () => ({ Item: grants.get(`${Key.principalId}|${Key.assetId}`) }) }),
    query: (request) => ({ promise: async () => ({
      Items: [...grants.values()].filter((grant) => grant.principalId === request.ExpressionAttributeValues[":principal"]),
    }) }),
    update: (request) => ({ promise: async () => { calls.push(request); } }),
  };
  return { calls, grants: createProtectedAssetGrantStore({ dynamodb }) };
}

test("recipient salts/wraps are paired with explicit canonical use grants", () => {
  const requests = normalizeGrantRequests([
    { userID: "2", deliveries: ["provider"] },
    { principalId: "u:3", delivery: "recipient" },
  ], { ownerId: "u:1", envelope });
  const items = createGrantItems({
    asset: { assetId, ownerId: "u:1", version: 4, envelope },
    requests,
    now: "2026-08-11T12:00:00.000Z",
  });
  assert.deepEqual(items.map((item) => item.canonicalActions), [["use"], ["use"]]);
  assert.deepEqual(items.map((item) => item.deliveries), [["provider"], ["recipient"]]);
  assert.deepEqual(items.map((item) => item.assetVersion), [4, 4]);
});

test("a listed recipient wrap alone is never authorization", () => {
  assert.throws(
    () => normalizeGrantRequests([{ userID: "7", delivery: "provider" }], { ownerId: "u:1", envelope }),
    (error) => error.code === "ASSET_RECIPIENT_WRAP_REQUIRED"
  );
  const wrongKey = structuredClone(envelope);
  wrongKey.keyWraps.user["2"].keyId = "7:v1";
  assert.throws(
    () => normalizeGrantRequests([{ userID: "2", delivery: "provider" }], { ownerId: "u:1", envelope: wrongKey }),
    (error) => error.code === "ASSET_RECIPIENT_KEY_MISMATCH"
  );
});

test("provider-only use cannot retrieve a recipient envelope or manage the asset", async () => {
  const item = createGrantItems({
    asset: { assetId, ownerId: "u:1", version: 1, envelope },
    requests: normalizeGrantRequests([{ userID: "2", delivery: "provider" }], { ownerId: "u:1", envelope }),
  })[0];
  const state = storeWith(new Map([[`u:2|${assetId}`, item]]));
  assert.equal((await state.grants.requireUse({ assetId, ownerId: "u:1", version: 1 }, "u:2", "provider")).source, "grant");
  await assert.rejects(
    state.grants.requireUse({ assetId, ownerId: "u:1", version: 1 }, "u:2", "recipient"),
    (error) => error.code === "ASSET_ACCESS_DENIED"
  );
  assert.equal(Object.hasOwn(item, "edit"), false);
  assert.equal(Object.hasOwn(item, "delete"), false);
  assert.equal(Object.hasOwn(item, "delegate"), false);
});

test("asset rotation invalidates an older recipient grant until it is rewrapped", async () => {
  const item = createGrantItems({
    asset: { assetId, ownerId: "u:1", version: 1, envelope },
    requests: normalizeGrantRequests([{ userID: "2", delivery: "recipient" }], { ownerId: "u:1", envelope }),
  })[0];
  const state = storeWith(new Map([[`u:2|${assetId}`, item]]));
  await assert.rejects(
    state.grants.requireUse({ assetId, ownerId: "u:1", version: 2 }, "u:2", "recipient"),
    (error) => error.code === "ASSET_ACCESS_DENIED"
  );
});

test("asset creation atomically stores the envelope and explicit recipient use grant", async () => {
  const handlers = new Map();
  const transactions = [];
  const dynamodb = {
    transactWrite: (request) => ({ promise: async () => transactions.push(request) }),
    put: () => ({ promise: async () => ({}) }),
  };
  register({
    on: (name, handler) => handlers.set(name, handler),
    use: () => ({ deps: { dynamodb }, expose: () => {} }),
  });
  const policy = {
    allowedUses: ["reveal"], destinations: [], capabilityIds: [], moduleIds: [],
    approvalMode: "preapproved", unattendedAutomation: false, expiresAt: null, maxUses: null,
    redaction: { revealLast: 0, label: "Protected" },
  };
  const metadata = {
    label: "Shared note", assetType: "private_note", providerId: null, providerHost: null,
    fields: [{ name: "value", type: "string", required: true, displayLabel: "Value", validation: null }],
    policy,
    lifecycle: { expiresAt: null, rotationDays: null, recoverable: false }, tags: [],
  };
  const aad = Buffer.from(JSON.stringify({
    schemaVersion: 1, assetId, ownerIDs: ["2"], assetType: "private_note", providerId: null, policy,
  })).toString("base64url");
  const response = await handlers.get("protectedAsset:create")({
    req: { body: {
      assetId,
      metadata,
      envelope: {
        algorithm: "A256GCM", iv: "AAAAAAAAAAAAAAAA", ciphertext: "A".repeat(32), aad,
        keyWraps: { user: { "2": {
          algorithm: "ECDH-ES+A256KW", keyId: "2", ephemeralPublicKey: "A".repeat(64),
          iv: "A".repeat(16), salt: "A".repeat(43), wrappedKey: "A".repeat(48),
        } }, executor: null },
      },
      recipientGrants: [{ userID: "2", delivery: "recipient" }],
    }, cookies: { e: "1" } },
    cookie: { e: "1" },
  });
  assert.equal(response.ok, true);
  assert.equal(response.grantsCreated, 1);
  assert.equal(transactions.length, 1);
  const grant = transactions[0].TransactItems[1].Put.Item;
  assert.deepEqual(grant.canonicalActions, ["use"]);
  assert.deepEqual(grant.deliveries, ["recipient"]);
});
