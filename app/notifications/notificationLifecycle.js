/**
 * Platform: Delivers durable, privacy-safe user notifications through the browser first and email only as a fallback.
 * Technical: Stores an authenticated inbox, encrypts verified delivery contacts with KMS, and processes delayed SQS reminders with a per-user latch.
 */
"use strict";

const crypto = require("node:crypto");

const NOTIFICATION_KINDS = new Set([
  "protected_access_request",
  "protected_access_decision",
]);

const principalId = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw === "0") throw new Error("notification principal is required");
  return raw.startsWith("u:") ? raw : `u:${raw}`;
};

const bounded = (value, max = 180) => String(value || "").trim().slice(0, max);

function safePayload(kind, raw = {}) {
  if (kind === "protected_access_request") {
    return {
      requestId: bounded(raw.requestId, 160),
      requesterId: principalId(raw.requesterId),
      reference: bounded(raw.reference, 220),
    };
  }
  if (kind === "protected_access_decision") {
    const decision = String(raw.decision || "").toLowerCase();
    if (!new Set(["approved", "denied"]).has(decision)) throw new Error("invalid protected access decision");
    const grantDuration = String(raw.grantDuration || "").toLowerCase();
    return {
      requestId: bounded(raw.requestId, 160),
      decision,
      reference: bounded(raw.reference, 220),
      grantDuration: new Set(["once", "15_minutes", "1_hour", "1_day", "forever"]).has(grantDuration)
        ? grantDuration
        : null,
      grantExpiresAt: raw.grantExpiresAt ? bounded(raw.grantExpiresAt, 64) : null,
      grantMaxUses: Number(raw.grantMaxUses || 0) || null,
    };
  }
  throw new Error("unsupported notification kind");
}

function publicNotification(item) {
  return {
    notificationId: item.notificationId,
    kind: item.kind,
    createdAt: item.createdAt,
    payload: safePayload(item.kind, item.payload),
  };
}

function createNotificationLifecycle({
  dynamodb,
  sqs,
  kms,
  ses,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  if (!dynamodb) throw new Error("notification lifecycle requires DynamoDB");

  const notificationsTable = process.env.NOTIFICATIONS_TABLE || "notifications";
  const contactsTable = process.env.NOTIFICATION_CONTACTS_TABLE || "notificationContacts";
  const queueUrl = process.env.NOTIFICATION_DELAY_QUEUE_URL || "";
  const contactKeyId = process.env.NOTIFICATION_CONTACT_KMS_KEY_ID || "";
  const suppressionTable = process.env.DELIVERABILITY_BLOCKS_TABLE || "deliverability_blocks";
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || "noreply@email.1var.com";
  const configurationSet = process.env.SES_CONFIG_SET || "ses-events";
  const stateKey = "$state";

  const kmsContext = (recipient) => ({
    purpose: "1var-notification-contact-v1",
    principalId: principalId(recipient),
  });

  async function stageContact({ recipient, email, emailHash }) {
    const target = principalId(recipient);
    const normalized = String(email || "").trim().toLowerCase();
    const hash = bounded(emailHash, 128);
    if (!normalized || !hash) throw new Error("verified email candidate is required");
    if (!kms?.encrypt || !contactKeyId) throw new Error("notification contact encryption is unavailable");
    const encrypted = await kms.encrypt({
      KeyId: contactKeyId,
      Plaintext: Buffer.from(normalized, "utf8"),
      EncryptionContext: kmsContext(target),
    }).promise();
    const timestamp = new Date(now()).toISOString();
    await dynamodb.update({
      TableName: contactsTable,
      Key: { principalId: target },
      UpdateExpression: "SET #pendingCiphertext = :ciphertext, #pendingHash = :hash, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#pendingCiphertext": "pendingCiphertext",
        "#pendingHash": "pendingEmailHash",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":ciphertext": Buffer.from(encrypted.CiphertextBlob || []).toString("base64"),
        ":hash": hash,
        ":updatedAt": timestamp,
      },
    }).promise();
    return { principalId: target, staged: true };
  }

  async function activateContact({ recipient, emailHash }) {
    const target = principalId(recipient);
    const hash = bounded(emailHash, 128);
    const timestamp = new Date(now()).toISOString();
    await dynamodb.update({
      TableName: contactsTable,
      Key: { principalId: target },
      UpdateExpression: "SET #ciphertext = #pendingCiphertext, #emailHash = #pendingHash, #verifiedAt = :now, #updatedAt = :now REMOVE #pendingCiphertext, #pendingHash",
      ConditionExpression: "#pendingHash = :hash AND attribute_exists(#pendingCiphertext)",
      ExpressionAttributeNames: {
        "#ciphertext": "encryptedEmail",
        "#emailHash": "emailHash",
        "#verifiedAt": "verifiedAt",
        "#updatedAt": "updatedAt",
        "#pendingCiphertext": "pendingCiphertext",
        "#pendingHash": "pendingEmailHash",
      },
      ExpressionAttributeValues: { ":hash": hash, ":now": timestamp },
    }).promise();
    return { principalId: target, active: true };
  }

  async function publish({
    recipient,
    kind,
    payload = {},
    emailFallback = true,
    dedupeKey = "",
    occurredAt = null,
  }) {
    const target = principalId(recipient);
    const normalizedKind = String(kind || "").trim().toLowerCase();
    if (!NOTIFICATION_KINDS.has(normalizedKind)) throw new Error("unsupported notification kind");
    const createdMs = now();
    const stableKey = bounded(dedupeKey, 240);
    const occurredMs = stableKey && Number.isFinite(Date.parse(String(occurredAt || "")))
      ? Date.parse(String(occurredAt))
      : createdMs;
    const notificationId = stableKey
      ? `n_${String(occurredMs).padStart(13, "0")}_${crypto.createHash("sha256")
        .update(`${target}\n${normalizedKind}\n${stableKey}`).digest("hex")}`
      : `n_${String(createdMs).padStart(13, "0")}_${randomUUID().replace(/-/g, "")}`;
    const item = {
      principalId: target,
      notificationId,
      recordType: "notification",
      schemaVersion: 1,
      kind: normalizedKind,
      payload: safePayload(normalizedKind, payload),
      createdAt: new Date(occurredMs).toISOString(),
      createdMs: occurredMs,
      emailFallback: emailFallback === true,
      expiresAt: Math.floor(createdMs / 1000) + 90 * 24 * 60 * 60,
    };
    try {
      await dynamodb.put({
        TableName: notificationsTable,
        Item: item,
        ConditionExpression: "attribute_not_exists(#principalId) AND attribute_not_exists(#notificationId)",
        ExpressionAttributeNames: {
          "#principalId": "principalId",
          "#notificationId": "notificationId",
        },
      }).promise();
    } catch (error) {
      if (error?.code !== "ConditionalCheckFailedException" || !stableKey) throw error;
      const existing = (await dynamodb.get({
        TableName: notificationsTable,
        Key: { principalId: target, notificationId },
        ConsistentRead: true,
      }).promise()).Item;
      if (!existing || existing.kind !== normalizedKind) throw error;
      return publicNotification(existing);
    }
    if (item.emailFallback) {
      if (!sqs?.sendMessage || !queueUrl) {
        await dynamodb.delete({
          TableName: notificationsTable,
          Key: { principalId: target, notificationId },
        }).promise().catch(() => {});
        throw new Error("notification delay queue is unavailable");
      }
      try {
        await sqs.sendMessage({
          QueueUrl: queueUrl,
          DelaySeconds: 60,
          MessageBody: JSON.stringify({ schemaVersion: 1, principalId: target, notificationId }),
        }).promise();
      } catch (error) {
        await dynamodb.delete({
          TableName: notificationsTable,
          Key: { principalId: target, notificationId },
        }).promise().catch(() => {});
        throw error;
      }
    }
    return publicNotification(item);
  }

  async function list(recipient, limit = 50) {
    const target = principalId(recipient);
    const requested = Math.max(1, Math.min(100, Number(limit || 50)));
    const items = [];
    let cursor;
    let pages = 0;
    do {
      const result = await dynamodb.query({
        TableName: notificationsTable,
        KeyConditionExpression: "#principalId = :principalId",
        FilterExpression: "#recordType = :notification AND attribute_not_exists(#resolvedAt)",
        ExpressionAttributeNames: {
          "#principalId": "principalId",
          "#recordType": "recordType",
          "#resolvedAt": "resolvedAt",
        },
        ExpressionAttributeValues: { ":principalId": target, ":notification": "notification" },
        ScanIndexForward: false,
        Limit: requested,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }).promise();
      items.push(...(result.Items || []));
      cursor = result.LastEvaluatedKey;
      pages += 1;
    } while (cursor && items.length < requested && pages < 10);
    return items.slice(0, requested).map(publicNotification);
  }

  async function acknowledge(recipient, notificationIds = []) {
    const target = principalId(recipient);
    const ids = [...new Set((Array.isArray(notificationIds) ? notificationIds : [])
      .map((value) => bounded(value, 220)).filter((value) => /^n_[a-zA-Z0-9_]+$/.test(value)))]
      .slice(0, 100);
    if (!ids.length) return { acknowledged: 0, notificationIds: [], acknowledgedAt: null };
    const acknowledgedAt = new Date(now()).toISOString();
    let acknowledged = 0;
    for (const notificationId of ids) {
      try {
        await dynamodb.update({
          TableName: notificationsTable,
          Key: { principalId: target, notificationId },
          UpdateExpression: "SET #acknowledgedAt = if_not_exists(#acknowledgedAt, :now)",
          ConditionExpression: "#recordType = :notification AND attribute_not_exists(#acknowledgedAt)",
          ExpressionAttributeNames: {
            "#acknowledgedAt": "acknowledgedAt",
            "#recordType": "recordType",
          },
          ExpressionAttributeValues: { ":now": acknowledgedAt, ":notification": "notification" },
          ReturnValues: "ALL_NEW",
        }).promise();
        acknowledged += 1;
      } catch (error) {
        if (error?.code !== "ConditionalCheckFailedException") throw error;
      }
    }
    if (acknowledged) {
      await dynamodb.update({
        TableName: notificationsTable,
        Key: { principalId: target, notificationId: stateKey },
        UpdateExpression: "SET #emailReminderOutstanding = :false, #updatedAt = :now REMOVE #emailNotificationId, #emailSentAt",
        ExpressionAttributeNames: {
          "#emailReminderOutstanding": "emailReminderOutstanding",
          "#updatedAt": "updatedAt",
          "#emailNotificationId": "emailNotificationId",
          "#emailSentAt": "emailSentAt",
        },
        ExpressionAttributeValues: { ":false": false, ":now": acknowledgedAt },
      }).promise();
    }
    return { acknowledged, notificationIds: ids, acknowledgedAt };
  }

  async function resolve(recipient, notificationId) {
    const target = principalId(recipient);
    const resolvedAt = new Date(now()).toISOString();
    try {
      await dynamodb.update({
        TableName: notificationsTable,
        Key: { principalId: target, notificationId: bounded(notificationId, 220) },
        UpdateExpression: "SET #resolvedAt = if_not_exists(#resolvedAt, :now)",
        ConditionExpression: "#recordType = :notification",
        ExpressionAttributeNames: { "#resolvedAt": "resolvedAt", "#recordType": "recordType" },
        ExpressionAttributeValues: { ":now": resolvedAt, ":notification": "notification" },
      }).promise();
      return { resolved: true };
    } catch (error) {
      if (error?.code === "ConditionalCheckFailedException") return { resolved: false };
      throw error;
    }
  }

  async function activeContact(target) {
    return (await dynamodb.get({
      TableName: contactsTable,
      Key: { principalId: target },
      ConsistentRead: true,
    }).promise()).Item || null;
  }

  async function suppressed(emailHash) {
    if (!emailHash) return true;
    const item = (await dynamodb.get({
      TableName: suppressionTable,
      Key: { recipientHash: emailHash, scope: "*" },
    }).promise()).Item;
    if (!item) return false;
    return !Number(item.expiresAt) || Number(item.expiresAt) > now();
  }

  async function decryptContact(target, contact) {
    if (!kms?.decrypt || !contact?.encryptedEmail) throw new Error("verified notification contact is unavailable");
    const result = await kms.decrypt({
      CiphertextBlob: Buffer.from(contact.encryptedEmail, "base64"),
      KeyId: contactKeyId || undefined,
      EncryptionContext: kmsContext(target),
    }).promise();
    return Buffer.from(result.Plaintext || []).toString("utf8").trim();
  }

  async function claimEmailLatch(target, notificationId, timestamp) {
    try {
      await dynamodb.update({
        TableName: notificationsTable,
        Key: { principalId: target, notificationId: stateKey },
        UpdateExpression: "SET #recordType = :state, #emailReminderOutstanding = :true, #emailNotificationId = :notificationId, #emailSentAt = :now, #updatedAt = :now",
        ConditionExpression: "attribute_not_exists(#emailReminderOutstanding) OR #emailReminderOutstanding = :false",
        ExpressionAttributeNames: {
          "#recordType": "recordType",
          "#emailReminderOutstanding": "emailReminderOutstanding",
          "#emailNotificationId": "emailNotificationId",
          "#emailSentAt": "emailSentAt",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":state": "notification-state",
          ":true": true,
          ":false": false,
          ":notificationId": notificationId,
          ":now": timestamp,
        },
      }).promise();
      return true;
    } catch (error) {
      if (error?.code === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async function releaseEmailLatch(target, notificationId) {
    try {
      await dynamodb.update({
        TableName: notificationsTable,
        Key: { principalId: target, notificationId: stateKey },
        UpdateExpression: "SET #emailReminderOutstanding = :false REMOVE #emailNotificationId, #emailSentAt",
        ConditionExpression: "#emailNotificationId = :notificationId",
        ExpressionAttributeNames: {
          "#emailReminderOutstanding": "emailReminderOutstanding",
          "#emailNotificationId": "emailNotificationId",
          "#emailSentAt": "emailSentAt",
        },
        ExpressionAttributeValues: { ":false": false, ":notificationId": notificationId },
      }).promise();
    } catch (error) {
      if (error?.code !== "ConditionalCheckFailedException") throw error;
    }
  }

  async function processDelayedReminder({ recipient, notificationId }) {
    const target = principalId(recipient);
    const notification = (await dynamodb.get({
      TableName: notificationsTable,
      Key: { principalId: target, notificationId: bounded(notificationId, 220) },
      ConsistentRead: true,
    }).promise()).Item;
    if (!notification || notification.recordType !== "notification" || notification.acknowledgedAt
      || notification.resolvedAt
      || notification.emailFallback !== true) return { sent: false, reason: "not-pending" };
    const contact = await activeContact(target);
    if (!contact?.verifiedAt || !contact?.encryptedEmail || await suppressed(contact.emailHash)) {
      return { sent: false, reason: "no-deliverable-contact" };
    }
    const timestamp = new Date(now()).toISOString();
    if (!await claimEmailLatch(target, notification.notificationId, timestamp)) {
      return { sent: false, reason: "email-already-outstanding" };
    }
    try {
      const email = await decryptContact(target, contact);
      if (!email || !ses?.sendEmail) throw new Error("notification email transport is unavailable");
      const request = {
        Source: fromEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Charset: "UTF-8", Data: "You have requests pending at 1var" },
          Body: {
            Text: { Charset: "UTF-8", Data: "You have request(s) pending to approve at 1var." },
            Html: { Charset: "UTF-8", Data: "<p>You have request(s) pending to approve at <a href=\"https://1var.com\">1var</a>.</p>" },
          },
        },
        Tags: [{ Name: "type", Value: "pending_notification" }],
      };
      if (configurationSet) request.ConfigurationSetName = configurationSet;
      await ses.sendEmail(request).promise();
      return { sent: true };
    } catch (error) {
      await releaseEmailLatch(target, notification.notificationId);
      throw error;
    }
  }

  async function processSqsEvent(event) {
    const failures = [];
    for (const record of event?.Records || []) {
      try {
        const message = JSON.parse(record.body || "{}");
        if (Number(message.schemaVersion) !== 1) throw new Error("unsupported notification message");
        await processDelayedReminder({
          recipient: message.principalId,
          notificationId: message.notificationId,
        });
      } catch (error) {
        console.error("notification reminder failed", {
          code: error?.code || "NOTIFICATION_REMINDER_FAILED",
          messageId: record?.messageId || null,
        });
        failures.push({ itemIdentifier: record?.messageId || "unknown" });
      }
    }
    return { batchItemFailures: failures };
  }

  return {
    acknowledge,
    activateContact,
    list,
    processDelayedReminder,
    processSqsEvent,
    publish,
    resolve,
    stageContact,
  };
}

function isNotificationSqsEvent(event) {
  return Array.isArray(event?.Records) && event.Records.length > 0
    && event.Records.every((record) => record?.eventSource === "aws:sqs");
}

module.exports = {
  NOTIFICATION_KINDS,
  createNotificationLifecycle,
  isNotificationSqsEvent,
  principalId,
  publicNotification,
  safePayload,
};
