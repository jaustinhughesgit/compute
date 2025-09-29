//modules/opt-in.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  // Opt-in one sender or all
  on("opt-in", async (ctx) => {
    const { req } = ctx;
    const segs = (req.path || "").split("/").filter(Boolean);
    // Expect path: /opt-in/{recipientHash}/{senderHash?}
    const recipientHash = segs[1];
    const senderHash = segs[2]; // optional

    if (!recipientHash) {
      return { ok: false, error: "recipientHash required" };
    }

    const docClient = getDocClient();

    if (senderHash) {
      // Add senderHash to recipient’s whitelist
      const params = {
        TableName: "users",
        Key: { emailHash: recipientHash },
        UpdateExpression: "ADD whitelist :s",
        ExpressionAttributeValues: {
          ":s": docClient.createSet([senderHash]),
        },
        ReturnValues: "UPDATED_NEW",
      };
      await docClient.update(params).promise();
      return { ok: true, message: `Sender ${senderHash} allowed for ${recipientHash}` };
    } else {
      // Opt-in all senders: mark an attribute like `whitelistAll`
      const params = {
        TableName: "users",
        Key: { emailHash: recipientHash },
        UpdateExpression: "SET whitelistAll = :true",
        ExpressionAttributeValues: {
          ":true": true,
        },
        ReturnValues: "UPDATED_NEW",
      };
      await docClient.update(params).promise();
      return { ok: true, message: `All senders allowed for ${recipientHash}` };
    }
  });

  return { name: "opt-in" };
}

module.exports = { register };
