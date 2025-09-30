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
      // Example: https://***.com/opt-in?email=HASH&sender=HASH
      const url = new URL(hostHeader);
      const recipientHash = url.searchParams.get("email");
      const senderHash = url.searchParams.get("sender");

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

      const user = q.Items && q.Items[0];
      if (!user) {
        return { ok: false, error: "Recipient not found" };
      }

      if (senderHash) {
        // Single-sender opt-in
        await ddb.update({
          TableName: "users",
          Key: { userID: user.userID },
          UpdateExpression: "ADD whitelist :s",
          ExpressionAttributeValues: {
            ":s": ddb.createSet([senderHash]),
          },
        }).promise();

        return {
          ok: true,
          message: `Sender ${senderHash} allowed for recipient ${recipientHash}`,
        };
      } else {
        // Opt-in for all senders
        await ddb.update({
          TableName: "users",
          Key: { userID: user.userID },
          UpdateExpression: "SET whitelistAll = :true",
          ExpressionAttributeValues: { ":true": true },
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
