// modules/opt-in.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  // Convert DynamoDB DocumentClient Set or array → JS array
  const setToArray = (maybeSet) => {
    if (!maybeSet) return [];
    if (Array.isArray(maybeSet)) return maybeSet;
    if (maybeSet.values && Array.isArray(maybeSet.values)) return maybeSet.values;
    return [];
  };

  on("optIn", async (ctx) => {
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

      // Update expressions depending on type of opt-in
      if (senderHash) {
        // Opt-in for one sender → add to whitelist
        await ddb
          .update({
            TableName: "users",
            Key: { userID: user.userID },
            UpdateExpression: "ADD whitelist :s",
            ExpressionAttributeValues: {
              ":s": ddb.createSet([senderHash]),
            },
          })
          .promise();

        return {
          ok: true,
          message: `Sender ${senderHash} allowed for recipient ${recipientHash}`,
        };
      } else {
        // Opt-in for all senders
        await ddb
          .update({
            TableName: "users",
            Key: { userID: user.userID },
            UpdateExpression: "SET whitelistAll = :true",
            ExpressionAttributeValues: { ":true": true },
          })
          .promise();

        return {
          ok: true,
          message: `All senders allowed for recipient ${recipientHash}`,
        };
      }
    } catch (err) {
      console.error("opt-in handler failed", err);
      return { ok: false, error: "Internal error during opt-in" };
    }
  });

  // Register dash-form too, so both work
  on("opt-in", (ctx) => {
    return ctx && ctx.req ? register({ on, use }).on("optIn", ctx) : { ok: false };
  });

  return { name: "opt-in" };
}

module.exports = { register };
