/**
 * Platform: Exposes each authenticated user's durable notification inbox without exposing another user's records.
 * Technical: Registers inbox and acknowledgement actions over the shared notification lifecycle; publication remains server-internal.
 */
"use strict";

const { createNotificationLifecycle, principalId } = require("../../notifications/notificationLifecycle");

function register({ on, use }) {
  const shared = use();
  let lifecycle = shared?.deps?.notificationLifecycle || null;
  if (!lifecycle) {
    const AWS = shared?.deps?.AWS || require("aws-sdk");
    lifecycle = createNotificationLifecycle({
      dynamodb: shared?.getDocClient?.(),
      sqs: new AWS.SQS({ region: process.env.AWS_REGION || "us-east-1" }),
      kms: new AWS.KMS({ region: process.env.AWS_REGION || "us-east-1" }),
      ses: shared?.getSES?.(),
    });
  }
  shared.expose?.("notificationLifecycle", lifecycle);

  const requestBody = (ctx) => {
    const body = ctx?.req?.body;
    return body?.body && typeof body.body === "object" ? body.body : (body || {});
  };
  const pathAction = (ctx) => String(ctx?.path || "")
    .split("?")[0].split("/").filter(Boolean)[0]?.toLowerCase() || "inbox";
  const recipient = (ctx) => principalId(ctx?.cookie?.e ?? ctx?.req?.cookies?.e);

  on("notifications", async (ctx) => {
    try {
      const action = pathAction(ctx);
      const target = recipient(ctx);
      if (action === "inbox") {
        const limit = Number(ctx?.req?.query?.limit || requestBody(ctx).limit || 50);
        return { ok: true, schemaVersion: 1, kind: "notificationInbox", notifications: await lifecycle.list(target, limit) };
      }
      if (action === "ack") {
        const result = await lifecycle.acknowledge(target, requestBody(ctx).notificationIds);
        return { ok: true, schemaVersion: 1, kind: "notificationsAcknowledged", ...result };
      }
      if (action === "resolve") {
        const notificationId = String(requestBody(ctx).notificationId || "").trim();
        const result = await lifecycle.resolve(target, notificationId);
        return { ok: true, schemaVersion: 1, kind: "notificationResolved", notificationId, ...result };
      }
      return { ok: false, error: { code: "UNKNOWN_NOTIFICATION_ACTION", message: "Unknown notification action." } };
    } catch (error) {
      const authentication = /principal is required/.test(String(error?.message || ""));
      return {
        ok: false,
        error: {
          code: authentication ? "AUTHENTICATION_REQUIRED" : "NOTIFICATION_OPERATION_FAILED",
          message: authentication ? "Authentication is required." : "Notification operation failed.",
        },
      };
    }
  });

  return { name: "notifications" };
}

module.exports = { register };
