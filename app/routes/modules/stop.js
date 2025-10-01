// modules/stop.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  const toBool = (v) => {
    if (v === undefined || v === null) return false;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
  };

  // Lookup a user by emailHash (GSI: emailHashIndex) and return userID if found
  async function getUserIdByEmailHash(ddb, emailHash) {
    if (!emailHash) return null;
    try {
      const q = await ddb.query({
        TableName: "users",
        IndexName: "emailHashIndex",
        KeyConditionExpression: "emailHash = :eh",
        ExpressionAttributeValues: { ":eh": emailHash },
        ProjectionExpression: "userID",
        Limit: 1,
        // IMPORTANT: ConsistentRead is NOT supported on GSIs; do NOT set it here.
      }).promise();
      const item = q?.Items?.[0];
      return item?.userID ?? null;
    } catch (err) {
      console.warn("getUserIdByEmailHash failed", err);
      return null;
    }
  }

  // Shared handler logic
  const handleStop = async (ctx) => {
    const ddb = getDocClient();
    const hostHeader = ctx?.req?.headers?.["x-original-host"];

    if (!hostHeader) {
      return { ok: false, error: "Missing X-Original-Host header" };
    }

    try {
      const url = new URL(hostHeader);

      // Try to extract from query params first
      let recipientHash = url.searchParams.get("email");
      let senderHash    = url.searchParams.get("sender");
      let blockAllFlag  = toBool(url.searchParams.get("blockAll"));

      // If not present, try path-based format: /stop/{recipientHash}/{senderHash?}
      if ((!recipientHash || !senderHash) && url.pathname.includes("/stop/")) {
        const parts = url.pathname.split("/").filter(Boolean); // drop empty segments
        const stopIndex = parts.indexOf("stop");
        if (stopIndex !== -1) {
          // expected order: /stop/{recipientHash}/{senderHash}
          recipientHash = recipientHash || parts[stopIndex + 1];
          senderHash    = senderHash    || parts[stopIndex + 2]; // may be undefined
        }
      }

      if (!recipientHash) {
        return { ok: false, error: "Missing recipientHash (email param)" };
      }

      // Find the recipient user by emailHash (GSI: emailHashIndex)
      const q = await ddb.query({
        TableName: "users",
        IndexName: "emailHashIndex",
        KeyConditionExpression: "emailHash = :eh",
        ExpressionAttributeValues: { ":eh": recipientHash },
        Limit: 1,
      }).promise();

      const recipient = q.Items && q.Items[0];
      if (!recipient) {
        return { ok: false, error: "Recipient not found" };
      }

      // If blockAll flag is present/true OR there is no senderHash, block all
      if (blockAllFlag || !senderHash) {
        await ddb.update({
          TableName: "users",
          Key: { userID: recipient.userID },
          UpdateExpression: "SET blockAll = :true",
          ExpressionAttributeValues: { ":true": true },
        }).promise();

        return {
          ok: true,
          message: `All senders blocked for recipient ${recipientHash}`,
        };
      }

      // Per-sender block:
      // 1) Find sender's userID by their emailHash (senderHash)
      const senderUserID = await getUserIdByEmailHash(ddb, senderHash);
      if (senderUserID == null) {
        console.warn("stop: could not resolve sender by emailHash; blocks will not increment", { senderHash });
      }

      // 2) Atomically:
      //   - ADD senderHash to recipient.blacklist (only if not already present)
      //   - ADD 1 to sender.blocks (only if we found a sender user)
      const transactItems = [
        {
          Update: {
            TableName: "users",
            Key: { userID: recipient.userID },
            UpdateExpression: "ADD blacklist :s",
            ConditionExpression:
              "attribute_not_exists(blacklist) OR NOT contains(blacklist, :senderHash)",
            ExpressionAttributeValues: {
              ":s": ddb.createSet([senderHash]),
              ":senderHash": senderHash,
            },
          },
        },
      ];

      if (senderUserID != null) {
        transactItems.push({
          Update: {
            TableName: "users",
            Key: { userID: senderUserID },
            UpdateExpression: "ADD blocks :one",
            ExpressionAttributeValues: { ":one": 1 },
          },
        });
      }

      try {
        await ddb.transactWrite({ TransactItems: transactItems }).promise();
        return {
          ok: true,
          message: `Sender ${senderHash} blocked for recipient ${recipientHash}`,
          blocksIncremented: senderUserID != null ? 1 : 0,
        };
      } catch (txErr) {
        if (txErr && txErr.code === "ConditionalCheckFailedException") {
          return {
            ok: true,
            message: `Sender ${senderHash} already blocked for recipient ${recipientHash}`,
            blocksIncremented: 0,
          };
        }
        console.error("stop transactWrite failed", txErr);
        return { ok: false, error: "Internal error during stop" };
      }
    } catch (err) {
      console.error("stop handler failed", err);
      return { ok: false, error: "Internal error during stop" };
    }
  };

  // Register both aliases with the same handler
  on("stop", handleStop);
  on("block", handleStop);

  return { name: "stop" };
}

module.exports = { register };
