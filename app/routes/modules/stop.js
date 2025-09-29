//modules/stop.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  // Stop one sender or all
  on("stop", async (ctx) => {
    const { req } = ctx;
    const segs = (req.path || "").split("/").filter(Boolean);
    // Expect path: /stop/{recipientHash}/{senderHash?}
    const recipientHash = segs[1];
    const senderHash = segs[2]; // optional

    if (!recipientHash) {
      return { ok: false, error: "recipientHash required" };
    }

    const docClient = getDocClient();

    if (senderHash) {
      // Add senderHash to recipient’s blacklist
      const params = {
        TableName: "users",
        Key: { emailHash: recipientHash },
        UpdateExpression: "ADD blacklist :s",
        ExpressionAttributeValues: {
          ":s": docClient.createSet([senderHash]),
        },
        ReturnValues: "UPDATED_NEW",
      };
      await docClient.update(params).promise();
      return { ok: true, message: `Sender ${senderHash} blocked for ${recipientHash}` };
    } else {
      // Block all senders: mark an attribute like `blockAll`
      const params = {
        TableName: "users",
        Key: { emailHash: recipientHash },
        UpdateExpression: "SET blockAll = :true",
        ExpressionAttributeValues: {
          ":true": true,
        },
        ReturnValues: "UPDATED_NEW",
      };
      await docClient.update(params).promise();
      return { ok: true, message: `All senders blocked for ${recipientHash}` };
    }
  });

  return { name: "stop" };
}

module.exports = { register };
