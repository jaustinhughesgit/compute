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
 *   GET   /cookies/webrtc/bootstrap        → { region, identityPoolId: null }
 *   GET   /cookies/webrtc/creds?channelName=<name>
 *   POST  /cookies/webrtc/link-storage     { channelArn, streamArn }
 *   POST  /cookies/webrtc/unlink-storage   { channelArn }
 *   POST  /cookies/webrtc/join-storage     { channelArn }  // usually called by MASTER client
 *
 * Notes:
 * - Relies on manageCookie() middleware (req.cookies contains { e: <userID>, su: <subdomain> }).
 * - No Cognito. Browsers receive short-lived STS credentials to sign KVS WebRTC requests.
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

  // STS role that the server will assume on behalf of the browser
  const KVS_BROWSER_ROLE_ARN = process.env.KVS_BROWSER_ROLE_ARN || "arn:aws:iam::536814921035:role/KVSBrowserSessionRole";
  const KVS_BROWSER_EXTERNAL_ID = process.env.KVS_BROWSER_EXTERNAL_ID || null; // optional, if trust requires it
  const STS_DURATION_SECS = parseInt(process.env.KVS_STS_DURATION_SECS || "900", 10);

  const kv  = new AWS.KinesisVideo({ apiVersion: "2017-09-30", region: REGION });
  const kvsStorage = new AWS.KinesisVideoWebRTCStorage({ apiVersion: "2019-12-31", region: REGION });
  const STS = new AWS.STS();

  // ---------- helpers ----------
  const nowSecs = () => Math.floor(Date.now() / 1000);
  const unwrapBody = (b) => (b && typeof b === "object" && b.body && typeof b.body === "object") ? b.body : b;
  const asID = (v) => String(v ?? "").trim();

  function requireUserId(ctx) {
    const raw = ctx?.req?.cookies?.e;
    const uid = asID(raw);
    if (!uid) {
      return { error: { statusCode: 401, body: JSON.stringify({ error: "no_user_cookie" }) } };
    }
    return { userID: uid };
  }

  async function upsertPresence({ userID, su, displayName, status, channelName = null, channelArn = null }) {
    const ttl = nowSecs() + PRESENCE_TTL_SECONDS;
    const item = {
      userID: asID(userID),
      su: su || null,
      displayName: (displayName || "Anonymous").toString().slice(0, 80),
      status,                                     // "online" | "live"
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
      Key: { userID: asID(userID) },
      UpdateExpression: "SET #u = :u, #ttl = :ttl",
      ExpressionAttributeNames: { "#u": "updatedAt", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":u": Date.now(), ":ttl": ttl },
    }).promise();
  }

  async function setOffline(userID) {
    await ddb.update({
      TableName: PRESENCE_TABLE,
      Key: { userID: asID(userID) },
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
    const idStr = asID(userID);
    const channelName = `${KVS_CHANNEL_PREFIX}${idStr}`;
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

  async function issueKvsCreds({ userID, channelArn = null }) {
    if (!KVS_BROWSER_ROLE_ARN) {
      return {
        error: {
          statusCode: 500,
          body: JSON.stringify({ error: "server_not_configured", message: "KVS_BROWSER_ROLE_ARN not set" })
        }
      };
    }

    // Scope the browser session to minimal permissions. You can further restrict Resource to channelArn/*.
    const sessionPolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "kinesisvideo:DescribeSignalingChannel",
            "kinesisvideo:GetSignalingChannelEndpoint",
            "kinesisvideo:GetIceServerConfig",
            "kinesisvideo:ConnectAsMaster",
            "kinesisvideo:ConnectAsViewer",
            "kinesisvideo:DescribeMediaStorageConfiguration",
            "kinesisvideo:UpdateMediaStorageConfiguration"
          ],
          Resource: channelArn ? [channelArn, `${channelArn}/*`] : "*"
        },
        {
          Effect: "Allow",
          Action: [
            "kinesisvideo:JoinStorageSession",
            "kinesisvideo:JoinStorageSessionAsViewer"
          ],
          Resource: channelArn ? [channelArn, `${channelArn}/*`] : "*"
        }
      ]
    };

    const params = {
      RoleArn: KVS_BROWSER_ROLE_ARN,
      RoleSessionName: `kvs-${asID(userID)}`,
      DurationSeconds: STS_DURATION_SECS,
      Policy: JSON.stringify(sessionPolicy),
      Tags: [{ Key: "uid", Value: asID(userID) }],
      TransitiveTagKeys: ["uid"]
    };
    if (KVS_BROWSER_EXTERNAL_ID) params.ExternalId = KVS_BROWSER_EXTERNAL_ID;

    const out = await STS.assumeRole(params).promise();
    return { creds: out.Credentials };
  }

  // ---------- presence ----------
  on("presence", async (ctx) => {
    const sp = subPath(ctx);
    const outer = ctx?.req?.body || {};
    const body = unwrapBody(outer) || {};

    const idRes = requireUserId(ctx);
    if (idRes.error) return idRes.error;
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
      const meStr = asID(userID);
      const filteredOnline = online.filter(u => asID(u.userID) !== meStr);
      const filteredLive   = live.filter(u => asID(u.userID) !== meStr);
      return {
        ok: true,
        me: { userID: meStr, su },
        active: { online: filteredOnline, live: filteredLive, allCount: filteredOnline.length + filteredLive.length }
      };
    }

    if (sp === "me") {
      const meStr = asID(userID);
      return { ok: true, me: { userID: meStr, su } };
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

  // ---------- WebRTC / Storage (no Cognito) ----------
  on("webrtc", async (ctx) => {
    const sp = subPath(ctx);
    const idRes = requireUserId(ctx);
    if (idRes.error) return idRes.error;

    if (sp === "bootstrap") {
      // Keep signature identical for callers; identityPoolId is intentionally null
      return { region: REGION, identityPoolId: null };
    }

    if (sp === "creds") {
      // Issue short-lived STS creds for browser to sign KVS WebRTC calls
      const channelName = ctx?.req?.query?.channelName || null;
      let channelArn = null;
      if (channelName) {
        try {
          const d = await kv.describeSignalingChannel({ ChannelName: channelName }).promise();
          channelArn = d.ChannelInfo.ChannelARN;
        } catch (e) {
          if (!(e && e.code === "ResourceNotFoundException")) throw e;
        }
      }
      const out = await issueKvsCreds({ userID: idRes.userID, channelArn });
      if (out.error) return out.error;
      return { region: REGION, channelArn, creds: out.creds };
    }

    if (sp === "link-storage") {
      const outer = ctx?.req?.body || {};
      const body = unwrapBody(outer) || {};
      const { channelArn, streamArn } = body || {};
      if (!channelArn || !streamArn) {
        return { statusCode: 400, body: JSON.stringify({ error: "channelArn_and_streamArn_required" }) };
      }
      await kv.updateMediaStorageConfiguration({
        ChannelARN: channelArn,
        MediaStorageConfiguration: { Status: "ENABLED", StreamARN: streamArn }
      }).promise();
      return { ok: true };
    }

    if (sp === "unlink-storage") {
      const outer = ctx?.req?.body || {};
      const body = unwrapBody(outer) || {};
      const { channelArn } = body || {};
      if (!channelArn) {
        return { statusCode: 400, body: JSON.stringify({ error: "channelArn_required" }) };
      }
      await kv.updateMediaStorageConfiguration({
        ChannelARN: channelArn,
        MediaStorageConfiguration: { Status: "DISABLED", StreamARN: "null" }
      }).promise();
      return { ok: true };
    }

    if (sp === "join-storage") {
      const outer = ctx?.req?.body || {};
      const body = unwrapBody(outer) || {};
      const { channelArn } = body || {};
      if (!channelArn) {
        return { statusCode: 400, body: JSON.stringify({ error: "channelArn_required" }) };
      }
      await kvsStorage.joinStorageSession({ ChannelArn: channelArn }).promise();
      return { ok: true };
    }

    return { statusCode: 404, body: JSON.stringify({ error: "unknown_webrtc_path" }) };
  });

  return { name: "streaming" };
}

module.exports = { register };
