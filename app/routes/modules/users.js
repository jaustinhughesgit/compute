// routes/modules/users.js
/**
 * Actions:
 *  - /cookies/createUser
 *  - /cookies/getUserPubKeys
 *
 * Table: users
 * PK:    userID (Number)
 */
module.exports.register = ({ on /*, use */ }) => {
  // Create
  on("createUser", async (ctx) => {
    const { dynamodb } = ctx.deps || {};
    const b = (ctx.req?.body || {}).body || {};

    if (
      b.userID === undefined ||
      !b.emailHash ||
      !b.pubEnc ||
      !b.pubSig
    ) {
      return { ok: false, error: "Missing required fields: userID, emailHash, pubEnc, pubSig." };
    }

    const now = Date.now();
    const item = {
      userID: Number(b.userID),
      emailHash: String(b.emailHash),
      pubEnc: String(b.pubEnc),
      pubSig: String(b.pubSig),
      created: now,
      revoked: !!b.revoked,
      latestKeyVersion: b.latestKeyVersion ?? 1,
    };

    try {
      await dynamodb.put({
        TableName: "users",
        Item: item,
        ConditionExpression: "attribute_not_exists(userID)",
      }).promise();
      return { ok: true, created: true, userID: item.userID };
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        return { ok: false, error: "User already exists." };
      }
      throw err;
    }
  });

  // Read public keys
  on("getUserPubKeys", async (ctx) => {
    const { dynamodb } = ctx.deps || {};
    const b = (ctx.req?.body || {}).body || {};
    const userID = b.userID;

    if (userID === undefined || userID === null || String(userID).trim() === "") {
      return { ok: false, error: "userID required." };
    }

    const { Item } = await dynamodb.get({
      TableName: "users",
      Key: { userID: Number(userID) },
      ProjectionExpression: "pubEnc, pubSig, latestKeyVersion",
    }).promise();

    if (!Item) return { ok: false, error: "user not found." };

    return {
      ok: true,
      pubEnc: Item.pubEnc,
      pubSig: Item.pubSig,
      latestKeyVersion: Item.latestKeyVersion,
      requestId: b.requestId,
    };
  });
};
