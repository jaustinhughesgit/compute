// modules/passphrases.js
"use strict";

/** ───────────────────────────── Logger helpers ───────────────────────────── **/
const PFX = "[passphrases]";
const nowIso = () => new Date().toISOString();
const short = (s) => (typeof s === "string" && s.length > 32 ? s.slice(0, 8) + "…" : s);
const redactToken = (t) => (t ? `${String(t).slice(0, 4)}…${String(t).slice(-4)}` : "(null)");

function log(...args) {
  // one-line logs with consistent prefix & timestamp
  console.log(PFX, nowIso(), ...args);
}
function logStart(label, meta = {}) {
  const id = `${label}#${Math.random().toString(36).slice(2, 8)}`;
  const t0 = Date.now();
  log(`▶︎ ${label} start`, meta);
  return {
    id,
    endOk(extra = {}) {
      log(`✔ ${label} ok (${Date.now() - t0}ms)`, { ...meta, ...extra });
    },
    endErr(err) {
      log(`✖ ${label} error (${Date.now() - t0}ms)`, {
        ...meta,
        code: err?.code,
        name: err?.name,
        message: err?.message,
      });
    },
  };
}

/** ───────────────────── nextPpId (outside register) ─────────────────────── **/
async function nextPpId(dynamodb) {
  const op = logStart("nextPpId");
  try {
    const table = "counters";
    const key = { name: "ppCounter" };
    log("DDB update BEFORE", { table, key, update: "ADD #x :inc SET #u = :now" });

    const res = await dynamodb
      .update({
        TableName: table,
        Key: key,
        // ADD is atomic; creates "x" if missing and increments it
        UpdateExpression: "ADD #x :inc SET #u = :now",
        ExpressionAttributeNames: { "#x": "x", "#u": "updatedAt" },
        ExpressionAttributeValues: { ":inc": 1, ":now": new Date().toISOString() },
        ReturnValues: "UPDATED_NEW",
      })
      .promise();

    log("DDB update AFTER", {
      table,
      attributes: res?.Attributes ? Object.keys(res.Attributes) : "(none)",
    });

    const pp = Number(res?.Attributes?.x);
    if (!Number.isFinite(pp)) throw new Error("ppCounter.x is not a number");
    const id = `pp-${pp}`;
    op.endOk({ generatedId: id });
    return id;
  } catch (err) {
    op.endErr(err);
    throw err;
  }
}

/** ───────────────────────────── register() ──────────────────────────────── **/
function register({ on, use }) {
  const { getDocClient } = use();
  const dynamodb = getDocClient();
  log("register() init");

  // Support both flattened req.body and legacy body.body
  const pickBody = (req) => {
    const b = req?.body;
    if (!b || typeof b !== "object") return b || {};
    if (b.body && typeof b.body === "object") return b.body; // legacy
    return b; // flattened
  };

  /** ─────────────── addPassphrase / wrapPassphrase ─────────────── **/
  const upsertWrappedPassphrase = async (ctx) => {
    const fx = logStart("upsertWrappedPassphrase", { path: ctx?.req?.path });
    try {
      const { req } = ctx;
      const body = pickBody(req);
      let { passphraseID, keyVersion, wrapped } = body || {};

      // normalize and allow blank (server will mint)
      if (typeof passphraseID === "string") passphraseID = passphraseID.trim();
      if (!passphraseID) passphraseID = null;

      log("payload received", {
        passphraseID,
        keyVersion,
        wrappedType: typeof wrapped,
        wrappedUserCount: wrapped && typeof wrapped === "object" ? Object.keys(wrapped).length : 0,
      });

      // Validation (keyVersion optional; wrapped required)
      if (!wrapped || typeof wrapped !== "object") {
        fx.endOk({ result: "reject invalid payload (wrapped missing)" });
        return { error: "Invalid payload" };
      }
      if (Object.keys(wrapped).length === 0) {
        fx.endOk({ result: "reject invalid payload (wrapped empty)" });
        return { error: "Invalid payload: wrapped map is empty" };
      }

      // Mint a new ID iff missing
      if (!passphraseID) {
        log("no passphraseID provided → minting new");
        passphraseID = await nextPpId(dynamodb);
      }

      const now = new Date().toISOString();

      // Branch 1: auto-minted ID → version is always 1 (create only)
      if (body.keyVersion == null || body.keyVersion === "") {
        if (!body.passphraseID) {
          const table = "passphrases";
          const item = {
            passphraseID,
            keyVersion: 1,
            wrapped,
            created: now,
            updated: now,
          };
          log("DDB put BEFORE", { table, key: { passphraseID } });
          try {
            await dynamodb
              .put({
                TableName: table,
                Item: item,
                ConditionExpression: "attribute_not_exists(passphraseID)",
              })
              .promise();
            log("DDB put AFTER", { table, key: { passphraseID } });
            fx.endOk({ result: "created v1 (auto-minted id)", passphraseID, keyVersion: 1 });
            return { success: true, passphraseID, keyVersion: 1 };
          } catch (err) {
            log("DDB put ERROR", { table, key: { passphraseID }, code: err?.code, msg: err?.message });
            throw err;
          }
        }
      }

      // Branch 2: user supplied existing passphraseID and left keyVersion blank → increment atomically
      if (body.keyVersion == null || body.keyVersion === "") {
        const table = "passphrases";
        log("DDB update (increment kv) BEFORE", { table, key: { passphraseID } });
        try {
          const { Attributes } = await dynamodb
            .update({
              TableName: table,
              Key: { passphraseID },
              UpdateExpression: "ADD #kv :one SET #wr = :wrapped, #upd = :now",
              ExpressionAttributeNames: { "#kv": "keyVersion", "#wr": "wrapped", "#upd": "updated" },
              ExpressionAttributeValues: { ":one": 1, ":wrapped": wrapped, ":now": now },
              ConditionExpression: "attribute_exists(passphraseID)",
              ReturnValues: "UPDATED_NEW",
            })
            .promise();
          log("DDB update (increment kv) AFTER", {
            table,
            key: { passphraseID },
            newVersion: Attributes?.keyVersion,
          });
          const newVersion = Number(Attributes?.keyVersion);
          fx.endOk({ result: "updated increment", passphraseID, keyVersion: newVersion });
          return { success: true, passphraseID, keyVersion: newVersion };
        } catch (err) {
          log("DDB update (increment kv) ERROR", {
            table,
            key: { passphraseID },
            code: err?.code,
            msg: err?.message,
          });
          if (err && err.code === "ConditionalCheckFailedException") {
            // Passphrase doesn't exist yet → create as v1
            const item = {
              passphraseID,
              keyVersion: 1,
              wrapped,
              created: now,
              updated: now,
            };
            log("DDB put (fallback create v1) BEFORE", { table, key: { passphraseID } });
            await dynamodb
              .put({
                TableName: table,
                Item: item,
                ConditionExpression: "attribute_not_exists(passphraseID)",
              })
              .promise();
            log("DDB put (fallback create v1) AFTER", { table, key: { passphraseID } });
            fx.endOk({ result: "created v1 (fallback)", passphraseID, keyVersion: 1 });
            return { success: true, passphraseID, keyVersion: 1 };
          }
          fx.endErr(err);
          throw err;
        }
      }

      // Branch 3: explicit keyVersion provided → set to that value
      const kv = Number(keyVersion);
      if (!Number.isFinite(kv) || kv < 1) {
        fx.endOk({ result: "reject invalid keyVersion", keyVersion });
        return { error: "Invalid keyVersion" };
      }

      // Try update-if-exists; otherwise create
      {
        const table = "passphrases";
        log("DDB update (set explicit kv) BEFORE", { table, key: { passphraseID }, kv });
        try {
          await dynamodb
            .update({
              TableName: table,
              Key: { passphraseID },
              UpdateExpression: "SET #kv = :kv, #wr = :wrapped, #upd = :now",
              ExpressionAttributeNames: { "#kv": "keyVersion", "#wr": "wrapped", "#upd": "updated" },
              ExpressionAttributeValues: { ":kv": kv, ":wrapped": wrapped, ":now": now },
              ConditionExpression: "attribute_exists(passphraseID)",
            })
            .promise();
          log("DDB update (set explicit kv) AFTER", { table, key: { passphraseID } });
        } catch (err) {
          log("DDB update (set explicit kv) ERROR", {
            table,
            key: { passphraseID },
            code: err?.code,
            msg: err?.message,
          });
          if (err && err.code === "ConditionalCheckFailedException") {
            log("DDB put (create with explicit kv) BEFORE", { table, key: { passphraseID }, kv });
            await dynamodb
              .put({
                TableName: table,
                Item: {
                  passphraseID,
                  keyVersion: kv,
                  wrapped,
                  created: now,
                  updated: now,
                },
                ConditionExpression: "attribute_not_exists(passphraseID)",
              })
              .promise();
            log("DDB put (create with explicit kv) AFTER", { table, key: { passphraseID } });
          } else {
            fx.endErr(err);
            throw err;
          }
        }
      }

      fx.endOk({ result: "set explicit", passphraseID, keyVersion: kv });
      return { success: true, passphraseID, keyVersion: kv };
    } catch (err) {
      fx.endErr(err);
      throw err;
    }
  };

  on("addPassphrase", upsertWrappedPassphrase);
  on("wrapPassphrase", upsertWrappedPassphrase);

  /** ─────────────────────────── decryptPassphrase ─────────────────────────── **/
  on("decryptPassphrase", async (ctx) => {
    const fx = logStart("decryptPassphrase", { path: ctx?.req?.path });
    try {
      const { req } = ctx;
      const body = pickBody(req);
      const { passphraseID, userID, requestId } = body || {};
      log("payload received", { passphraseID, userID, requestId: short(requestId) });

      if (!passphraseID || !userID) {
        fx.endOk({ result: "reject bad request" });
        return { statusCode: 400, body: JSON.stringify({ error: "passphraseID and userID required" }) };
      }

      // --- enforce cookie.e === userID before proceeding ---
      let cookieE = ctx?.cookie?.e;
      const getAccessToken = () =>
        ctx?.xAccessToken ||
        req?.get?.("X-accessToken") ||
        req?.headers?.["x-accesstoken"] ||
        req?.headers?.["x-accessToken"] ||
        req?.cookies?.accessToken ||
        req?.cookies?.ak ||
        null;

      if (!cookieE) {
        const ak = getAccessToken();
        log("cookie missing; try lookup via ak", { ak: redactToken(ak) });
        if (ak) {
          const table = "cookies";
          const indexName = "akIndex";
          log("DDB query BEFORE", { table, indexName, keyExpr: "ak = :ak" });
          try {
            const q = await dynamodb
              .query({
                TableName: table,
                IndexName: indexName,
                KeyConditionExpression: "ak = :ak",
                ExpressionAttributeValues: { ":ak": ak },
                ProjectionExpression: "e",
              })
              .promise();
            log("DDB query AFTER", { table, count: q?.Count, items: q?.Items?.length });
            cookieE = q.Items?.[0]?.e;
          } catch (err) {
            log("DDB query ERROR", { table, indexName, code: err?.code, msg: err?.message });
            throw err;
          }
        }
      }

      if (!cookieE) {
        fx.endOk({ result: "unauthorized (no cookieE)" });
        return { statusCode: 401, body: JSON.stringify({ error: "missing or invalid session" }) };
      }
      if (String(cookieE) !== String(userID)) {
        fx.endOk({ result: "forbidden (cookieE mismatch)" });
        return { statusCode: 403, requestId, body: JSON.stringify({ error: "passphrase access denied" }) };
      }
      // --- END CHECK ---

      const table = "passphrases";
      const key = { passphraseID };
      log("DDB get BEFORE", { table, key, proj: ["keyVersion", "wrapped"] });
      let Item;
      try {
        const res = await dynamodb
          .get({
            TableName: table,
            Key: key,
            ProjectionExpression: "#kv, #wr",
            ExpressionAttributeNames: { "#kv": "keyVersion", "#wr": "wrapped" },
          })
          .promise();
        Item = res?.Item;
        log("DDB get AFTER", { table, found: !!Item });
      } catch (err) {
        log("DDB get ERROR", { table, key, code: err?.code, msg: err?.message });
        throw err;
      }

      if (!Item) {
        fx.endOk({ result: "not found" });
        return { statusCode: 404, body: JSON.stringify({ error: "passphrase not found" }) };
      }

      const cipherB64 = Item.wrapped?.[userID];
      if (!cipherB64) {
        fx.endOk({ result: "forbidden (no wrapped for user)" });
        return { statusCode: 403, body: JSON.stringify({ error: "no wrapped data for this user" }) };
      }

      fx.endOk({ result: "ok", passphraseID, keyVersion: Item.keyVersion });
      return {
        passphraseID,
        userID,
        cipherB64, // BASE64 string: [ephemeralPub||IV||ciphertext]
        keyVersion: Item.keyVersion,
        requestId, // echo for caller correlation
      };
    } catch (err) {
      fx.endErr(err);
      throw err;
    }
  });

  return { name: "passphrases" };
}

module.exports = { register };
