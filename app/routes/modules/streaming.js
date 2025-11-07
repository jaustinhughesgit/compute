// modules/streaming.js
"use strict";

/**
 * Actions (all under /cookies/* via your router):
 *
 *   POST  /cookies/presence/online         { displayName? }
 *   POST  /cookies/presence/heartbeat      (no body)
 *   POST  /cookies/presence/offline        (no body)
 *   GET   /cookies/presence/active         (?limit=50)
 *   GET   /cookies/presence/me             → { userID, su? }
 *
 *   POST  /cookies/live/start              { displayName? }
 *   POST  /cookies/live/stop               { displayName? }
 *
 *   GET   /cookies/webrtc/bootstrap        → { region, identityPoolId|null }
 *
 * Notes:
 * - This relies on your manageCookie() middleware already running in setupRouter()
 *   so req.cookies contains { e: <userID>, su: <subdomain> }.
 */

function register({ on, use }) {
  const {
    getDocClient,
    deps,            // { AWS, openai, Anthropic, dynamodb, ... }
    moment,          // (from shared) optional, not required here
  } = use();

  const AWS = deps?.AWS || require("aws-sdk");
  const ddb = getDocClient();

  const REGION = process.env.AWS_REGION || "us-east-1";
  const PRESENCE_TABLE = process.env.PRESENCE_TABLE || "presence";
  const PRESENCE_TTL_SECONDS = parseInt(process.env.PRESENCE_TTL_SECONDS || "120", 10);
  const KVS_CHANNEL_PREFIX = process.env.KVS_CHANNEL_PREFIX || "myapp-";
  const COGNITO_IDENTITY_POOL_ID = process.env.COGNITO_IDENTITY_POOL_ID || null;

  const kv = new AWS.KinesisVideo({ apiVersion: "2017-09-30", region: REGION });

  // ---------- helpers ----------
  const nowSecs = () => Math.floor(Date.now() / 1000);
  const unwrapBody = (b) => (b && typeof b === "object" && b.body && typeof b.body === "object") ? b.body : b;

  function requireUserId(ctx) {
  const uid = Number(ctx?.req?.cookies?.e);
  if (!Number.isFinite(uid)) {
    return { statusCode: 401, body: JSON.stringify({ error: "no_user_cookie" }) };
  }
  return { userID: uid };
}

  async function upsertPresence({ userID, su, displayName, status, channelName = null, channelArn = null }) {
    const ttl = nowSecs() + PRESENCE_TTL_SECONDS;
    const item = {
      userID: Number(userID),
      su: su || null,
      displayName: (displayName || "Anonymous").toString().slice(0, 80),
      status, // "online" | "live"
      updatedAt: Date.now(),
      ttl,
      channelName,
      channelArn,
      region: REGION,
    };
    await ddb.put({ TableName: PRESENCE_TABLE, Item: item }).promise();
    return item;
  }

  async function heartbeatPresence(userID) {
    const ttl = nowSecs() + PRESENCE_TTL_SECONDS;
    await ddb.update({
      TableName: PRESENCE_TABLE,
      Key: { userID: Number(userID) },
      UpdateExpression: "SET #u = :u, #ttl = :ttl",
      ExpressionAttributeNames: { "#u": "updatedAt", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":u": Date.now(), ":ttl": ttl },
    }).promise();
  }

  async function setOffline(userID) {
    // expire quickly; status back to "online" (so future online writes are consistent)
    await ddb.update({
      TableName: PRESENCE_TABLE,
      Key: { userID: Number(userID) },
      UpdateExpression: "SET #ttl = :ttl, #u = :u, #s = :s",
      ExpressionAttributeNames: { "#ttl": "ttl", "#u": "updatedAt", "#s": "status" },
      ExpressionAttributeValues: { ":ttl": nowSecs() - 1, ":u": Date.now(), ":s": "online" },
    }).promise();
  }

  async function queryActiveByStatus(status, limit = 50) {
    const params = {
      TableName: PRESENCE_TABLE,
      IndexName: "status-updatedAt-index", // create this GSI
      KeyConditionExpression: "#s = :status",
      ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":status": status, ":now": nowSecs() },
      FilterExpression: "attribute_not_exists(#ttl) OR #ttl > :now",
      ScanIndexForward: false, // newest first
      Limit: limit,
    };
    const out = await ddb.query(params).promise();
    return out.Items || [];
  }

  async function ensureSignalingChannelForUser(userID) {
    const channelName = `${KVS_CHANNEL_PREFIX}${userID}`;
    let channelArn;
    try {
      const desc = await kv.describeSignalingChannel({ ChannelName: channelName }).promise();
      channelArn = desc.ChannelInfo.ChannelARN;
    } catch (e) {
      if (e && e.code === "ResourceNotFoundException") {
        const created = await kv.createSignalingChannel({
          ChannelName: channelName,
          ChannelType: "SINGLE_MASTER",
          SingleMasterConfiguration: { MessageTtlSeconds: 60 },
        }).promise();
        channelArn = created.ChannelARN;
      } else {
        throw e;
      }
    }
    return { channelName, channelArn };
  }

  function subPath(ctx) {
    // ctx.path is the tail string beginning with "/" (e.g. "/online" or "/active")
    const segs = String(ctx?.path || "/").split("/").filter(Boolean);
    return segs[0] || ""; // first tail segment after the action
  }

  // ---------- presence ----------
  on("presence", async (ctx) => {
    const sp = subPath(ctx);
    const outer = ctx?.req?.body || {};
    const body = unwrapBody(outer) || {};

    const idRes = requireUserId(ctx);

    if (idRes.statusCode) return idRes; // early 401
    const userID = idRes.userID;
    const su = String(ctx?.req?.cookies?.su || "").trim() || null;

    if (sp === "online") {
      const displayName = (body.displayName || "").toString().slice(0, 80) || "Anonymous";
      const item = await upsertPresence({ userID, su, displayName, status: "online" });
      return { ok: true, me: { userID, su, displayName: item.displayName } };
    }

    if (sp === "heartbeat") {
      await heartbeatPresence(userID);
      return { ok: true };
    }

    if (sp === "offline") {
      await setOffline(userID);
      return { ok: true };
    }

    if (sp === "active") {
      const limit = Math.max(1, Math.min(200, Number(ctx?.req?.query?.limit || 50)));
      const [online, live] = await Promise.all([
        queryActiveByStatus("online", limit),
        queryActiveByStatus("live", limit),
      ]);
      const filteredOnline = online.filter(u => Number(u.userID) !== Number(userID));
      const filteredLive = live.filter(u => Number(u.userID) !== Number(userID));
      return { ok: true, me: { userID, su }, active: { online: filteredOnline, live: filteredLive, allCount: filteredOnline.length + filteredLive.length } };
    }

    if (sp === "me") {
      return { ok: true, me: { userID, su } };
    }

    return { statusCode: 404, body: JSON.stringify({ error: "unknown_presence_path" }) };
  });

  // ---------- live ----------
  on("live", async (ctx) => {
    const sp = subPath(ctx);
    const outer = ctx?.req?.body || {};
    const body = unwrapBody(outer) || {};

    const idRes = requireUserId(ctx);
    if (idRes.error) return idRes.error;
    const userID = idRes.userID;
    const su = String(ctx?.req?.cookies?.su || "").trim() || null;

    if (sp === "start") {
      const displayName = (body.displayName || "").toString().slice(0, 80) || "Anonymous";
      const { channelName, channelArn } = await ensureSignalingChannelForUser(userID);
      const item = await upsertPresence({ userID, su, displayName, status: "live", channelName, channelArn });
      return {
        ok: true,
        me: { userID, su, displayName: item.displayName },
        channel: { region: REGION, channelName, channelArn, role: "MASTER" },
      };
    }

    if (sp === "stop") {
      const displayName = (body.displayName || "").toString().slice(0, 80) || "Anonymous";
      const item = await upsertPresence({ userID, su, displayName, status: "online", channelName: null, channelArn: null });
      return { ok: true, me: { userID, su, displayName: item.displayName } };
    }

    return { statusCode: 404, body: JSON.stringify({ error: "unknown_live_path" }) };
  });

  // ---------- lightweight bootstrap ----------
  on("webrtc", async (ctx) => {
    const sp = subPath(ctx);
    if (sp === "bootstrap") {
      return { region: REGION, identityPoolId: COGNITO_IDENTITY_POOL_ID };
    }
    return { statusCode: 404, body: JSON.stringify({ error: "unknown_webrtc_path" }) };
  });

  return { name: "streaming" };
}

module.exports = { register };
