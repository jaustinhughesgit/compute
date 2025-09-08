// routes/modules/passphrases.js
/**
 * Actions:
 *  - /cookies/wrapPassphrase
 *  - /cookies/addPassphrase     (alias of wrapPassphrase)
 *  - /cookies/decryptPassphrase
 *
 * Table: passphrases
 * PK:    passphraseID (String)
 * Item:  { passphraseID, keyVersion: Number, wrapped: { [userID]: base64 }, created: ISO }
 */
module.exports.register = ({ on /*, use */ }) => {
  const putWrapped = async (dynamodb, { passphraseID, keyVersion, wrapped }) => {
    await dynamodb.put({
      TableName: "passphrases",
      Item: {
        passphraseID: String(passphraseID),
        keyVersion: Number(keyVersion),
        wrapped: wrapped,                // object: { [userID]: base64 }
        created: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(passphraseID)",
    }).promise();
    return { ok: true };
  };

  on("wrapPassphrase", async (ctx) => {
    const { dynamodb } = ctx.deps || {};
    const b = (ctx.req?.body || {}).body || {};
    const { passphraseID, keyVersion, wrapped } = b || {};

    if (!passphraseID || !keyVersion || !wrapped || typeof wrapped !== "object") {
      return { ok: false, error: "Invalid payload. Require passphraseID, keyVersion, wrapped(object)." };
    }
    try {
      await putWrapped(dynamodb, { passphraseID, keyVersion, wrapped });
      return { ok: true };
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        return { ok: false, error: "Passphrase already exists." };
      }
      throw err;
    }
  });

  // alias
  on("addPassphrase", async (ctx) => {
    const { dynamodb } = ctx.deps || {};
    const b = (ctx.req?.body || {}).body || {};
    const { passphraseID, keyVersion, wrapped } = b || {};

    if (!passphraseID || !keyVersion || !wrapped || typeof wrapped !== "object") {
      return { ok: false, error: "Invalid payload. Require passphraseID, keyVersion, wrapped(object)." };
    }
    try {
      await putWrapped(dynamodb, { passphraseID, keyVersion, wrapped });
      return { ok: true };
    } catch (err) {
      if (err && err.code === "ConditionalCheckFailedException") {
        return { ok: false, error: "Passphrase already exists." };
      }
      throw err;
    }
  });

  on("decryptPassphrase", async (ctx) => {
    const { dynamodb } = ctx.deps || {};
    const b = (ctx.req?.body || {}).body || {};
    const { passphraseID, userID, requestId } = b || {};

    if (!passphraseID || userID === undefined || userID === null) {
      return { ok: false, error: "passphraseID and userID required." };
    }

    const { Item } = await dynamodb.get({
      TableName: "passphrases",
      Key: { passphraseID: String(passphraseID) },
      ProjectionExpression: "#kv, #wr",
      ExpressionAttributeNames: {
        "#kv": "keyVersion",
        "#wr": "wrapped",
      },
    }).promise();

    if (!Item) return { ok: false, error: "passphrase not found." };

    const cipherB64 = Item.wrapped?.[String(userID)];
    if (!cipherB64) {
      return { ok: false, error: "no wrapped data for this user.", status: 403 };
    }

    return {
      ok: true,
      passphraseID: String(passphraseID),
      userID: String(userID),
      cipherB64,
      keyVersion: Item.keyVersion,
      requestId,
    };
  });
};
