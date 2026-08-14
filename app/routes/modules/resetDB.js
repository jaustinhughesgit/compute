/**
 * Platform: Purges legacy test residue once, then resets the canonical system through a resumable job.
 * Technical: each authorized continuation deletes one DynamoDB page and checkpoints its signed job step.
 */
"use strict";

const crypto = require("node:crypto");

function register({ on, use }) {
  const { getDocClient, getCookie, deps } = use();
  const RESET_CONTRACT_VERSION = 1;
  const RESET_MODE = "canonical";
  const DELETE_PAGE_SIZE = 25;
  const resetControlTable = String(process.env.TEST_RESET_CONTROL_TABLE || "").trim();
  const resetTokenSecret = String(process.env.SESSION_SECRET || "");

  const uniqueNames = (values) => values
    .map((value) => String(value || "").trim())
    .filter((value, index, all) => value && all.indexOf(value) === index);

  const canonicalTables = uniqueNames([
    "versions",
    "paths",
    process.env.PRESENCE_TABLE || "presence",
    process.env.INVITES_TABLE || "presence_invites",
    "entities",
    "groups",
    "links",
    "schedules",
    "subdomains",
    "tasks",
    "words",
    process.env.PERM_GRANTS_TABLE || "perm_grants",
    "enabled",
    "email_bounce_events",
    "email_sends",
    process.env.DELIVERABILITY_BLOCKS_TABLE || "deliverability_blocks",
    process.env.EMAIL_METRICS_TABLE || "email_metrics_daily",
    "anchor_bands",
    process.env.PROTECTED_ASSETS_TABLE,
    process.env.PROTECTED_ASSET_GRANTS_TABLE,
    process.env.PROTECTED_ASSET_AUDIT_TABLE,
    process.env.PROTECTED_ASSET_ACCESS_REQUESTS_TABLE,
    process.env.NOTIFICATIONS_TABLE,
    process.env.NOTIFICATION_CONTACTS_TABLE,
    process.env.CONTEXT_GRAPH_TABLE,
    process.env.CANONICAL_PROJECTION_TABLE,
    process.env.CANONICAL_AUDIT_TABLE,
  ]);

  // Identity is last so the authorized browser normally survives until the
  // final phase. The signed continuation also survives a deleted cookie row.
  const identityTables = ["passphrases", "users", "cookies"];
  const compatibilityTables = uniqueNames([
    "access",
    "verified",
    process.env.EMBPATHS_TABLE || "embPaths",
  ]);
  const legacyTables = uniqueNames([
    ...compatibilityTables,
    process.env.CONTEXT_GRAPH_TABLE,
  ]);
  const legacyTableSet = new Set(legacyTables);
  const countersToReset = [
    ["aiCounter", "aiCounter"], ["ciCounter", "ciCounter"],
    ["eCounter", "eCounter"], ["enCounter", "enCounter"],
    ["gCounter", "gCounter"], ["giCounter", "giCounter"],
    ["siCounter", "siCounter"], ["tiCounter", "tiCounter"],
    ["vCounter", "vCounter"], ["viCounter", "viCounter"],
    ["wCounter", "wCounter"], ["pCounter", "pCounter"],
    ["ppCounter", "ppCounter"],
  ].map(([tableName, primaryKey]) => ({ tableName, primaryKey }));
  const phaseNames = ["legacy", "canonical", "compatibility", "counters", "identity"];

  function readBody(ctx) {
    const outer = ctx?.req?.body || {};
    if (typeof outer === "string") {
      try { return JSON.parse(outer); } catch { return {}; }
    }
    return outer && typeof outer.body === "object" ? outer.body : outer;
  }

  function resetConfiguration() {
    const configuredEnvironment = String(process.env.TEST_RESET_ENVIRONMENT_ID || "").trim();
    return {
      enabled: process.env.TEST_RESET_ENABLED === "true",
      allowAnyAuthenticatedUser: process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER === "true",
      configuredEnvironment,
      allowedUsers: new Set(
        String(process.env.TEST_RESET_ALLOWED_USER_IDS || "")
          .split(",").map((value) => value.trim()).filter(Boolean)
      ),
      productionLike: /(^|[._-])(prod|production|live)([._-]|$)/i.test(configuredEnvironment),
      resetControlTable,
    };
  }

  async function resolveCaller(ctx) {
    const direct = String(ctx?.req?.cookies?.e || ctx?.cookie?.e || "").trim();
    if (direct) return direct;
    const accessToken = String(ctx?.xAccessToken || ctx?.req?.cookies?.accessToken || "").trim();
    if (!accessToken || typeof getCookie !== "function") return "";
    const record = await getCookie(accessToken, "ak", getDocClient());
    return String(record?.Items?.[0]?.e || "").trim();
  }

  function signContinuation(environmentId, jobId) {
    if (!resetTokenSecret) return "";
    return crypto.createHmac("sha256", resetTokenSecret)
      .update(`1var-reset-v1\n${environmentId}\n${jobId}`)
      .digest("base64url");
  }

  function continuationIsValid(body, environmentId) {
    const jobId = String(body.jobId || "").trim();
    const supplied = String(body.continuationToken || "").trim();
    const expected = signContinuation(environmentId, jobId);
    if (!jobId || !supplied || !expected || supplied.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }

  async function authorizeReset(ctx) {
    const access = resetConfiguration();
    const body = readBody(ctx);
    const requestedEnvironment = String(body.testEnvironmentId || "").trim();
    if (!access.enabled || !access.configuredEnvironment || access.productionLike) {
      return { allowed: false, code: "TEST_RESET_DISABLED" };
    }
    if (!requestedEnvironment || requestedEnvironment !== access.configuredEnvironment) {
      return { allowed: false, code: "TEST_RESET_ENVIRONMENT_MISMATCH" };
    }
    if (String(body.mode || RESET_MODE).trim() !== RESET_MODE) {
      return { allowed: false, code: "TEST_RESET_MODE_UNSUPPORTED" };
    }
    if (!access.resetControlTable || !resetTokenSecret) {
      return { allowed: false, code: "TEST_RESET_CONTROL_UNAVAILABLE" };
    }
    if (continuationIsValid(body, access.configuredEnvironment)) {
      return { allowed: true, access, body, continuation: true, caller: "" };
    }
    const caller = await resolveCaller(ctx);
    if (!access.allowAnyAuthenticatedUser && (!caller || !access.allowedUsers.has(caller))) {
      return { allowed: false, code: "TEST_RESET_FORBIDDEN" };
    }
    return { allowed: true, access, body, continuation: false, caller };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isMissingTable = (error) => error && error.code === "ResourceNotFoundException";

  async function writeDeleteBatch(tableName, batch, dynamodb) {
    let pending = batch;
    for (let attempt = 0; pending.length && attempt < 8; attempt += 1) {
      const result = await dynamodb.batchWrite({ RequestItems: { [tableName]: pending } }).promise();
      pending = result.UnprocessedItems?.[tableName] || [];
      if (pending.length) await sleep(Math.min(50 * (2 ** attempt), 1000));
    }
    if (pending.length) throw new Error(`Unable to delete ${pending.length} item(s) from ${tableName}`);
  }

  async function clearTablePage(tableName, dynamodb, dynamodbLL) {
    let description;
    try {
      description = await dynamodbLL.describeTable({ TableName: tableName }).promise();
    } catch (error) {
      if (isMissingTable(error)) return { tableName, deleted: 0, skipped: true, done: true };
      throw error;
    }
    const keyNames = (description.Table?.KeySchema || [])
      .sort((a, b) => (a.KeyType === "HASH" ? -1 : 1) - (b.KeyType === "HASH" ? -1 : 1))
      .map((key) => key.AttributeName);
    if (!keyNames.length) throw new Error(`No key schema found for table ${tableName}`);

    const expressionNames = {};
    const projection = keyNames.map((keyName, index) => {
      const placeholder = `#k${index}`;
      expressionNames[placeholder] = keyName;
      return placeholder;
    }).join(", ");
    const page = await dynamodb.scan({
      TableName: tableName,
      ConsistentRead: true,
      Limit: DELETE_PAGE_SIZE,
      ProjectionExpression: projection,
      ExpressionAttributeNames: expressionNames,
    }).promise();
    if (!page.Items?.length) return { tableName, deleted: 0, skipped: false, done: true };

    const requests = page.Items.map((item) => ({
      DeleteRequest: {
        Key: Object.fromEntries(keyNames.map((keyName) => {
          if (item[keyName] === undefined) throw new Error(`Key '${keyName}' missing in ${tableName}`);
          return [keyName, item[keyName]];
        })),
      },
    }));
    await writeDeleteBatch(tableName, requests, dynamodb);
    return {
      tableName,
      deleted: requests.length,
      skipped: false,
      done: !page.LastEvaluatedKey,
    };
  }

  async function resetCounter(counter, dynamodb) {
    try {
      await dynamodb.update({
        TableName: counter.tableName,
        Key: { pk: counter.primaryKey },
        UpdateExpression: "SET #x = :zero",
        ExpressionAttributeNames: { "#x": "x" },
        ExpressionAttributeValues: { ":zero": 0 },
      }).promise();
      return { skipped: false };
    } catch (error) {
      if (isMissingTable(error)) return { skipped: true };
      throw error;
    }
  }

  async function readResetMarker(dynamodb, environmentId) {
    return (await dynamodb.get({
      TableName: resetControlTable,
      Key: { environmentId },
      ConsistentRead: true,
    }).promise()).Item || null;
  }

  async function writeResetMarker(dynamodb, marker) {
    await dynamodb.put({ TableName: resetControlTable, Item: marker }).promise();
  }

  function phaseItems(job) {
    const phase = phaseNames[job.phaseIndex];
    if (phase === "legacy") return job.includeLegacy ? legacyTables : [];
    if (phase === "canonical") {
      return job.includeLegacy
        ? canonicalTables.filter((tableName) => !legacyTableSet.has(tableName))
        : canonicalTables;
    }
    if (phase === "compatibility") return job.includeLegacy ? [] : compatibilityTables;
    if (phase === "counters") return countersToReset;
    if (phase === "identity") return identityTables;
    return [];
  }

  function finishEmptyPhases(marker, job) {
    while (job.phaseIndex < phaseNames.length && job.itemIndex >= phaseItems(job).length) {
      if (phaseNames[job.phaseIndex] === "legacy" && job.includeLegacy) {
        marker.contractVersion = RESET_CONTRACT_VERSION;
        marker.legacyPurgeCompletedAt = marker.legacyPurgeCompletedAt || new Date().toISOString();
        marker.completedBy = job.startedBy;
      }
      job.phaseIndex += 1;
      job.itemIndex = 0;
    }
    if (job.phaseIndex >= phaseNames.length) {
      job.state = "completed";
      job.completedAt = new Date().toISOString();
    }
  }

  function newResetJob(marker, environmentId, caller) {
    const now = new Date().toISOString();
    const job = {
      jobId: crypto.randomUUID(),
      state: "running",
      includeLegacy: marker?.contractVersion !== RESET_CONTRACT_VERSION,
      phaseIndex: 0,
      itemIndex: 0,
      step: 0,
      completedUnits: 0,
      deletedByTable: {},
      skippedTables: [],
      resetCounters: [],
      failures: [],
      startedAt: now,
      updatedAt: now,
      startedBy: caller || "temporary-any-caller-mode",
    };
    const nextMarker = { ...(marker || {}), environmentId, resetJob: job };
    finishEmptyPhases(nextMarker, job);
    return nextMarker;
  }

  function addOnce(values, value) {
    if (!values.includes(value)) values.push(value);
  }

  function addDeleted(job, tableName, count) {
    job.deletedByTable[tableName] = Number(job.deletedByTable[tableName] || 0) + Number(count || 0);
  }

  function totalUnits(job) {
    return phaseNames.reduce((total, _phase, phaseIndex) => {
      const original = job.phaseIndex;
      job.phaseIndex = phaseIndex;
      const count = phaseItems(job).length;
      job.phaseIndex = original;
      return total + count;
    }, 0);
  }

  function publicJobResponse(marker, job) {
    const phase = job.state === "running" ? phaseNames[job.phaseIndex] : null;
    const item = job.state === "running" ? phaseItems(job)[job.itemIndex] : null;
    const currentTable = typeof item === "string" ? item : item?.tableName || null;
    const clearedTables = Object.entries(job.deletedByTable)
      .map(([tableName, deleted]) => ({ tableName, deleted }));
    const response = {
      alert: job.state === "completed" ? "success" : job.state === "failed" ? "failed" : "pending",
      mode: RESET_MODE,
      contractVersion: RESET_CONTRACT_VERSION,
      jobId: job.jobId,
      step: job.step,
      progress: {
        phase,
        currentTable,
        completedUnits: job.completedUnits,
        totalUnits: totalUnits(job),
        deleted: clearedTables.reduce((sum, row) => sum + row.deleted, 0),
      },
      legacyPurge: {
        performed: job.includeLegacy,
        completed: marker.contractVersion === RESET_CONTRACT_VERSION,
        completedAt: marker.legacyPurgeCompletedAt || null,
      },
      canonicalReset: { performed: job.phaseIndex >= 1, completed: job.state === "completed" },
      identityCleanup: { performed: job.phaseIndex >= 4, completed: job.state === "completed" },
      compatibilityCleanup: { performed: !job.includeLegacy && job.phaseIndex >= 2 },
      resetCounters: job.resetCounters,
      clearedTables,
      skippedTables: job.skippedTables,
      failures: job.failures,
    };
    if (job.state === "running") {
      response.continuationToken = signContinuation(marker.environmentId, job.jobId);
    }
    return { ok: true, response };
  }

  async function processOneJobStep(marker, dynamodb, dynamodbLL) {
    const job = marker.resetJob;
    finishEmptyPhases(marker, job);
    if (job.state !== "running") return;

    const phase = phaseNames[job.phaseIndex];
    const item = phaseItems(job)[job.itemIndex];
    const tableName = typeof item === "string" ? item : item.tableName;
    try {
      if (phase === "counters") {
        const result = await resetCounter(item, dynamodb);
        if (result.skipped) addOnce(job.skippedTables, tableName);
        else addOnce(job.resetCounters, tableName);
        job.itemIndex += 1;
        job.completedUnits += 1;
      } else {
        const result = await clearTablePage(tableName, dynamodb, dynamodbLL);
        if (result.skipped) addOnce(job.skippedTables, tableName);
        else addDeleted(job, tableName, result.deleted);
        if (result.done) {
          job.itemIndex += 1;
          job.completedUnits += 1;
        }
      }
    } catch (error) {
      console.error(`Error resetting table ${tableName}:`, error);
      job.state = "failed";
      job.failures = [{ tableName, error: error.message }];
    }
    job.step += 1;
    job.updatedAt = new Date().toISOString();
    finishEmptyPhases(marker, job);
  }

  on("resetDBStatus", async (ctx) => {
    const access = resetConfiguration();
    const caller = access.enabled && access.configuredEnvironment && !access.productionLike
      ? await resolveCaller(ctx)
      : "";
    const callerAllowed = access.allowAnyAuthenticatedUser || (!!caller && access.allowedUsers.has(caller));
    let available = access.enabled && !!access.configuredEnvironment
      && !access.productionLike && callerAllowed && !!access.resetControlTable && !!resetTokenSecret;
    let reasonCode = null;
    if (!access.enabled || !access.configuredEnvironment || access.productionLike) reasonCode = "TEST_RESET_DISABLED";
    else if (!callerAllowed) reasonCode = "TEST_RESET_FORBIDDEN";
    else if (!access.resetControlTable || !resetTokenSecret) reasonCode = "TEST_RESET_CONTROL_UNAVAILABLE";

    let marker = null;
    if (available) {
      try {
        marker = await readResetMarker(getDocClient(), access.configuredEnvironment);
      } catch (error) {
        console.error("Unable to read test reset control marker:", error);
        available = false;
        reasonCode = "TEST_RESET_CONTROL_UNAVAILABLE";
      }
    }
    const activeJob = marker?.resetJob?.state === "running" ? marker.resetJob : null;
    return {
      ok: true,
      response: {
        available,
        reasonCode,
        accountId: caller || null,
        environmentId: available ? access.configuredEnvironment : null,
        mode: RESET_MODE,
        contractVersion: RESET_CONTRACT_VERSION,
        legacyPurgeRequired: available ? marker?.contractVersion !== RESET_CONTRACT_VERSION : null,
        legacyPurgeCompletedAt: marker?.legacyPurgeCompletedAt || null,
        resetInProgress: !!activeJob,
        activePhase: activeJob ? phaseNames[activeJob.phaseIndex] || null : null,
      },
    };
  });

  on("resetDB", async (ctx) => {
    const authorization = await authorizeReset(ctx);
    if (!authorization.allowed) {
      return {
        ok: false,
        error: {
          code: authorization.code,
          message: "Database reset is available only when explicitly enabled for this test environment.",
        },
      };
    }

    const dynamodb = getDocClient();
    const environmentId = authorization.access.configuredEnvironment;
    let marker;
    try {
      marker = await readResetMarker(dynamodb, environmentId);
    } catch {
      return {
        ok: false,
        error: {
          code: "TEST_RESET_CONTROL_UNAVAILABLE",
          message: "The reset job checkpoint could not be read; no reset step was attempted.",
        },
      };
    }

    const requestedJobId = String(authorization.body.jobId || "").trim();
    const activeJob = marker?.resetJob;
    if (requestedJobId) {
      if (!activeJob || activeJob.jobId !== requestedJobId) {
        return { ok: false, error: { code: "TEST_RESET_JOB_MISMATCH", message: "Reset job is not active." } };
      }
      if (activeJob.state !== "running") {
        const replay = publicJobResponse(marker, activeJob);
        if (replay.response.alert === "success") {
          ctx.res?.setHeader?.(
            "Set-Cookie",
            "accessToken=; Max-Age=0; Path=/; Domain=.1var.com; HttpOnly; Secure; SameSite=None"
          );
        }
        return replay;
      }
      const requestedStep = Number(authorization.body.step);
      if (!Number.isInteger(requestedStep) || requestedStep < 0 || requestedStep > activeJob.step) {
        return { ok: false, error: { code: "TEST_RESET_STEP_MISMATCH", message: "Reset step is invalid." } };
      }
      if (requestedStep === activeJob.step) {
        await processOneJobStep(marker, dynamodb, deps.dynamodbLL);
        try {
          await writeResetMarker(dynamodb, marker);
        } catch {
          return {
            ok: false,
            error: {
              code: "TEST_RESET_CONTROL_UNAVAILABLE",
              message: "The reset step ran but its checkpoint could not be saved; retry the same step.",
            },
          };
        }
      }
    } else if (activeJob?.state === "running") {
      // An authorized caller can resume a job whose first response was lost.
    } else {
      marker = newResetJob(marker, environmentId, authorization.caller);
      try {
        await writeResetMarker(dynamodb, marker);
      } catch {
        return {
          ok: false,
          error: { code: "TEST_RESET_CONTROL_UNAVAILABLE", message: "Reset job could not be started." },
        };
      }
    }

    const result = publicJobResponse(marker, marker.resetJob);
    if (result.response.alert === "success") {
      ctx.res?.setHeader?.(
        "Set-Cookie",
        "accessToken=; Max-Age=0; Path=/; Domain=.1var.com; HttpOnly; Secure; SameSite=None"
      );
    }
    return result;
  });

  return { name: "resetDB" };
}

module.exports = { register };
