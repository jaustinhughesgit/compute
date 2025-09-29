// modules/opt-in.js
"use strict";

function register({ on, use }) {
  const { getDocClient } = use();

  // Helper: extract pathname from X-Original-Host header or req.path
  function getPathFromReq(req) {
    // 1) start with req.path if it's already there

    // 2) otherwise look for X-Original-Host (frameworks lowercase headers)
    const headers = req?.headers || {};
    const headerKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === "x-original-host"
    );
    const headerVal = headerKey ? headers[headerKey] : null;

    if (!headerVal) return "";

    // headerVal might be a full URL or just a path; try URL first
    try {
      const u = new URL(String(headerVal));
      return u.pathname || "";
    } catch {
      // Not a full URL. Normalize to a path-ish string.
      const s = String(headerVal);
      if (s.startsWith("/")) return s;
      return `/${s}`;
    }
  }

  // Helper: from a pathname, locate 'opt-in' and read the next segments
  function parseOptInSegments(pathname) {
    const segs = String(pathname)
      .split("/")
      .filter(Boolean); // remove empty

    // Find 'opt-in' anywhere in the path (e.g., /cookies/opt-in/...)
    const optIdx = segs.findIndex((s) => s.toLowerCase() === "opt-in");
    if (optIdx < 0) return { recipientHash: "", senderHash: "" };

    const recipientHash = decodeURIComponent(segs[optIdx + 1] || "");
    const senderHash = decodeURIComponent(segs[optIdx + 2] || "");
    return { recipientHash, senderHash };
  }

  // Opt-in one sender or all
  on("opt-in", async (ctx) => {
    const { req } = ctx;

    const pathname = getPathFromReq(req);
    const { recipientHash, senderHash } = parseOptInSegments(pathname);

    if (!recipientHash) {
      // Keep the same error text expected by the client
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
      return {
        ok: true,
        message: `Sender ${senderHash} allowed for ${recipientHash}`,
      };
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
      return {
        ok: true,
        message: `All senders allowed for ${recipientHash}`,
      };
    }
  });

  return { name: "opt-in" };
}

module.exports = { register };
