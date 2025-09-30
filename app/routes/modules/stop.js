// modules/stop.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  const toBool = (v) => {
    if (v === undefined || v === null) return false;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
  };

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
      const q = await ddb
        .query({
          TableName: "users",
          IndexName: "emailHashIndex",
          KeyConditionExpression: "emailHash = :eh",
          ExpressionAttributeValues: { ":eh": recipientHash },
          Limit: 1,
        })
        .promise();

      const user = q.Items && q.Items[0];
      if (!user) {
        return { ok: false, error: "Recipient not found" };
      }

      // If blockAll flag is present/true OR there is no senderHash, block all
      if (blockAllFlag || !senderHash) {
        await ddb
          .update({
            TableName: "users",
            Key: { userID: user.userID },
            UpdateExpression: "SET blockAll = :true",
            ExpressionAttributeValues: { ":true": true },
          })
          .promise();

        return {
          ok: true,
          message: `All senders blocked for recipient ${recipientHash}`,
        };
      }

      // Otherwise, block a specific sender by adding to blacklist (a String Set)
      await ddb
        .update({
          TableName: "users",
          Key: { userID: user.userID },
          UpdateExpression: "ADD blacklist :s",
          ExpressionAttributeValues: {
            ":s": ddb.createSet([senderHash]),
          },
        })
        .promise();

      return {
        ok: true,
        message: `Sender ${senderHash} blocked for recipient ${recipientHash}`,
      };
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
