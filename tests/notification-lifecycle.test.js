"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createNotificationLifecycle,
  safePayload,
} = require("../app/notifications/notificationLifecycle");

function withNotificationEnv(run) {
  const prior = { ...process.env };
  Object.assign(process.env, {
    NOTIFICATIONS_TABLE: "notifications-test",
    NOTIFICATION_CONTACTS_TABLE: "contacts-test",
    NOTIFICATION_DELAY_QUEUE_URL: "https://sqs.example/notification-delay",
    NOTIFICATION_CONTACT_KMS_KEY_ID: "kms-contact-test",
    DELIVERABILITY_BLOCKS_TABLE: "blocks-test",
    SES_CONFIG_SET: "",
  });
  return Promise.resolve(run()).finally(() => { process.env = prior; });
}

test("notification payloads retain only bounded lifecycle identifiers", () => {
  assert.deepEqual(safePayload("protected_access_request", {
    requestId: "request-1",
    requesterId: "7",
    reference: "protected_asset:pa_1234567890abcdef",
    plaintext: "never persist me",
    question: "private question",
  }), {
    requestId: "request-1",
    requesterId: "u:7",
    reference: "protected_asset:pa_1234567890abcdef",
  });
  assert.throws(() => safePayload("protected_access_decision", {
    requestId: "request-1", decision: "maybe",
  }), /invalid protected access decision/);
});

test("verified email is KMS-encrypted before it enters the contact table", async () => withNotificationEnv(async () => {
  const updates = [];
  const lifecycle = createNotificationLifecycle({
    dynamodb: { update: (request) => ({ promise: async () => updates.push(request) }) },
    kms: {
      encrypt: (request) => ({ promise: async () => {
        assert.equal(Buffer.from(request.Plaintext).toString("utf8"), "person@example.com");
        assert.equal(request.EncryptionContext.principalId, "u:3");
        return { CiphertextBlob: Buffer.from("ciphertext") };
      } }),
    },
  });
  await lifecycle.stageContact({ recipient: "3", email: "Person@Example.com", emailHash: "hash-3" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].ExpressionAttributeValues[":ciphertext"], Buffer.from("ciphertext").toString("base64"));
  assert.equal(JSON.stringify(updates[0]).includes("person@example.com"), false);

  await lifecycle.activateContact({ recipient: "u:3", emailHash: "hash-3" });
  assert.match(updates[1].ConditionExpression, /#pendingHash = :hash/);
  assert.match(updates[1].UpdateExpression, /REMOVE #pendingCiphertext/);
}));

test("publication writes the browser inbox before scheduling one-minute fallback", async () => withNotificationEnv(async () => {
  const writes = [];
  const messages = [];
  const lifecycle = createNotificationLifecycle({
    dynamodb: {
      put: (request) => ({ promise: async () => writes.push(request) }),
      delete: () => ({ promise: async () => {} }),
    },
    sqs: { sendMessage: (request) => ({ promise: async () => messages.push(request) }) },
    now: () => Date.parse("2026-08-14T12:00:00.000Z"),
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
  });
  const result = await lifecycle.publish({
    recipient: "u:9",
    kind: "protected_access_request",
    payload: { requestId: "req-1", requesterId: "u:2", reference: "protected_asset:pa_1234567890abcdef" },
  });
  assert.equal(writes[0].Item.principalId, "u:9");
  assert.equal(writes[0].Item.payload.plaintext, undefined);
  assert.equal(messages[0].DelaySeconds, 60);
  assert.equal(JSON.parse(messages[0].MessageBody).notificationId, result.notificationId);
}));

test("a stable publication key returns the existing notification without scheduling another email", async () => withNotificationEnv(async () => {
  let stored = null;
  let queueCount = 0;
  const dynamodb = {
    put: (request) => ({ promise: async () => {
      if (stored) {
        const error = new Error("duplicate");
        error.code = "ConditionalCheckFailedException";
        throw error;
      }
      stored = request.Item;
    } }),
    get: () => ({ promise: async () => ({ Item: stored }) }),
    delete: () => ({ promise: async () => {} }),
  };
  const lifecycle = createNotificationLifecycle({
    dynamodb,
    sqs: { sendMessage: () => ({ promise: async () => { queueCount += 1; } }) },
    now: () => Date.parse("2026-08-14T12:00:00.000Z"),
  });
  const input = {
    recipient: "u:9",
    kind: "protected_access_decision",
    payload: { requestId: `par_${"a".repeat(40)}`, decision: "approved" },
    dedupeKey: "access-decision:one:approved",
  };
  const first = await lifecycle.publish(input);
  const second = await lifecycle.publish(input);
  assert.equal(second.notificationId, first.notificationId);
  assert.equal(queueCount, 1);
}));

test("delayed fallback sends generic email once until browser acknowledgement clears the latch", async () => withNotificationEnv(async () => {
  let latchOutstanding = false;
  let emailCount = 0;
  const notification = {
    principalId: "u:8", notificationId: "n_1", recordType: "notification",
    kind: "protected_access_request", payload: {}, emailFallback: true,
  };
  const contact = {
    principalId: "u:8", verifiedAt: "2026-08-14T12:00:00.000Z",
    encryptedEmail: Buffer.from("cipher").toString("base64"), emailHash: "hash-8",
  };
  const updates = [];
  const dynamodb = {
    get: (request) => ({ promise: async () => {
      if (request.TableName === "notifications-test") return { Item: notification };
      if (request.TableName === "contacts-test") return { Item: contact };
      return {};
    } }),
    update: (request) => ({ promise: async () => {
      updates.push(request);
      if (request.Key.notificationId === "$state" && request.ConditionExpression?.includes("attribute_not_exists")) {
        if (latchOutstanding) {
          const error = new Error("claimed"); error.code = "ConditionalCheckFailedException"; throw error;
        }
        latchOutstanding = true;
      }
      if (request.Key.notificationId === "$state" && request.ExpressionAttributeValues?.[":false"] === false
        && !request.ConditionExpression) latchOutstanding = false;
    } }),
  };
  const lifecycle = createNotificationLifecycle({
    dynamodb,
    kms: { decrypt: () => ({ promise: async () => ({ Plaintext: Buffer.from("person@example.com") }) }) },
    ses: { sendEmail: (request) => ({ promise: async () => {
      emailCount += 1;
      assert.equal(request.Message.Body.Text.Data, "You have request(s) pending to approve at 1var.");
      assert.equal(JSON.stringify(request).includes("protected_asset"), false);
    } }) },
  });
  assert.deepEqual(await lifecycle.processDelayedReminder({ recipient: "u:8", notificationId: "n_1" }), { sent: true });
  assert.equal((await lifecycle.processDelayedReminder({ recipient: "u:8", notificationId: "n_1" })).reason, "email-already-outstanding");
  assert.equal(emailCount, 1);

  const acknowledgement = await lifecycle.acknowledge("u:8", ["n_1"]);
  assert.deepEqual(acknowledgement.notificationIds, ["n_1"]);
  assert.match(acknowledgement.acknowledgedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(latchOutstanding, false);
  assert.equal(updates.some((request) => request.Key.notificationId === "n_1"), true);
}));

test("SQS partial-batch response retries only malformed or failed reminders", async () => withNotificationEnv(async () => {
  const lifecycle = createNotificationLifecycle({
    dynamodb: {
      get: () => ({ promise: async () => ({}) }),
    },
  });
  const result = await lifecycle.processSqsEvent({ Records: [
    { messageId: "ok", body: JSON.stringify({ schemaVersion: 1, principalId: "u:1", notificationId: "n_1" }) },
    { messageId: "bad", body: "not-json" },
  ] });
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "bad" }]);
}));
