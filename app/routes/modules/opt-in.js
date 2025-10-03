// modules/opt-in.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  // Shared handler logic
  const handleOptIn = async (ctx) => {
    const ddb = getDocClient();
    const hostHeader = ctx?.req?.headers?.["x-original-host"];

    if (!hostHeader) {
      return { ok: false, error: "Missing X-Original-Host header" };
    }

    try {
      const url = new URL(hostHeader);

      // Try to extract from query params first
      let recipientHash = url.searchParams.get("email");
      let senderHash = url.searchParams.get("sender");

      // If not present, try path-based format: /opt-in/{sender}/{email}
      if ((!recipientHash || !senderHash) && url.pathname.includes("/opt-in/")) {
        const parts = url.pathname.split("/").filter(Boolean); // drop empty segments
        const optInIndex = parts.indexOf("opt-in");
        if (optInIndex !== -1) {
          senderHash = senderHash || parts[optInIndex + 1];
          recipientHash = recipientHash || parts[optInIndex + 2];
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

      if (senderHash) {
        // Single-sender opt-in → also mark email verified
        await ddb.update({
          TableName: "users",
          Key: { userID: user.userID },
          UpdateExpression:
            "SET emailVerified = :true, emailVerifiedAt = :now, #upd = :now " +
            "ADD whitelist :s",
          ExpressionAttributeNames: { "#upd": "updated" },
          ExpressionAttributeValues: {
            ":true": true,
            ":now": Date.now(),
            ":s": ddb.createSet([senderHash]),
          },
        }).promise();

        return {
          ok: true,
          message: `Sender ${senderHash} allowed for recipient ${recipientHash}`,
        };
      } else {

        // Opt-in for all senders → also mark email verified
        await ddb.update({
          TableName: "users",
          Key: { userID: user.userID },
          UpdateExpression:
            "SET whitelistAll = :true, emailVerified = :true, emailVerifiedAt = :now, #upd = :now",
          ExpressionAttributeNames: { "#upd": "updated" },
          ExpressionAttributeValues: {
            ":true": true,
            ":now": Date.now(),
          },
        }).promise();

        return {
          ok: true,
          message: `All senders allowed for recipient ${recipientHash}`,
        };
      }
    } catch (err) {
      console.error("opt-in handler failed", err);
      return { ok: false, error: "Internal error during opt-in" };
    }
  };

  // Register both aliases with the same handler
  on("optIn", handleOptIn);
  on("opt-in", handleOptIn);

  return { name: "opt-in" };
}

module.exports = { register };
