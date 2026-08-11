/**
 * Platform: Migrates an isolated test deployment off legacy residue once, then resets its active canonical system.
 * Technical: a control marker records the one-time purge before repeatable canonical and identity cleanup.
 */
"use strict";

function register({ on, use }) {
  const { getDocClient, getCookie, deps } = use();
  const RESET_CONTRACT_VERSION = 1;
  const RESET_MODE = "canonical";
  const resetControlTable = String(process.env.TEST_RESET_CONTROL_TABLE || "").trim();

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
    process.env.PROTECTED_ASSET_AUDIT_TABLE,
    process.env.CONTEXT_GRAPH_TABLE,
    process.env.CANONICAL_PROJECTION_TABLE,
    process.env.CANONICAL_AUDIT_TABLE,
  ]);

  // Identity is last so a failed data reset normally leaves the caller able to
  // retry. Cookies are last within the phase for the same reason.
  const identityTables = ["passphrases", "users", "cookies"];

  // Active dual-write adapters remain recurring cleanup until their writers
  // are retired. Their physical layouts are not the new persistence contract.
  const compatibilityTables = uniqueNames([
    "access",
    "verified",
    process.env.EMBPATHS_TABLE || "embPaths",
  ]);

  // The first reset explicitly purges the old authorization, retrieval, and
  // Context sidecar stores before entering the canonical phase.
  const legacyTables = uniqueNames([
    ...compatibilityTables,
    process.env.CONTEXT_GRAPH_TABLE,
  ]);
  const legacyTableSet = new Set(legacyTables);

  const countersToReset = [
    ["aiCounter", "aiCounter"],
    ["ciCounter", "ciCounter"],
    ["eCounter", "eCounter"],
    ["enCounter", "enCounter"],
    ["gCounter", "gCounter"],
    ["giCounter", "giCounter"],
    ["siCounter", "siCounter"],
    ["tiCounter", "tiCounter"],
    ["vCounter", "vCounter"],
    ["viCounter", "viCounter"],
    ["wCounter", "wCounter"],
    ["pCounter", "pCounter"],
    ["ppCounter", "ppCounter"],
  ].map(([tableName, primaryKey]) => ({ tableName, primaryKey }));

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
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
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
    const caller = await resolveCaller(ctx);
    if (!access.allowAnyAuthenticatedUser && (!caller || !access.allowedUsers.has(caller))) {
      return { allowed: false, code: "TEST_RESET_FORBIDDEN" };
    }
    if (String(body.mode || RESET_MODE).trim() !== RESET_MODE) {
      return { allowed: false, code: "TEST_RESET_MODE_UNSUPPORTED" };
    }
    if (!access.resetControlTable) {
      return { allowed: false, code: "TEST_RESET_CONTROL_UNAVAILABLE" };
    }
    return { allowed: true, access, caller };
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

  async function clearTable(tableName, dynamodb, dynamodbLL) {
    let description;
    try {
      description = await dynamodbLL.describeTable({ TableName: tableName }).promise();
    } catch (error) {
      if (isMissingTable(error)) return { tableName, deleted: 0, skipped: true };
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

    let deleted = 0;
    while (true) {
      const page = await dynamodb.scan({
        TableName: tableName,
        ConsistentRead: true,
        ProjectionExpression: projection,
        ExpressionAttributeNames: expressionNames,
      }).promise();
      if (!page.Items?.length) break;

      const requests = page.Items.map((item) => ({
        DeleteRequest: {
          Key: Object.fromEntries(keyNames.map((keyName) => {
            if (item[keyName] === undefined) throw new Error(`Key '${keyName}' missing in ${tableName}`);
            return [keyName, item[keyName]];
          })),
        },
      }));
      for (let index = 0; index < requests.length; index += 25) {
        const batch = requests.slice(index, index + 25);
        await writeDeleteBatch(tableName, batch, dynamodb);
        deleted += batch.length;
      }
    }
    return { tableName, deleted, skipped: false };
  }

  async function clearTables(tableNames, dynamodb, dynamodbLL) {
    const report = { clearedTables: [], skippedTables: [], failures: [] };
    for (const tableName of tableNames) {
      try {
        const result = await clearTable(tableName, dynamodb, dynamodbLL);
        if (result.skipped) report.skippedTables.push(tableName);
        else report.clearedTables.push({ tableName, deleted: result.deleted });
      } catch (error) {
        console.error(`Error clearing table ${tableName}:`, error);
        report.failures.push({ tableName, error: error.message });
      }
    }
    return report;
  }

  async function resetCounters(dynamodb) {
    const report = { resetCounters: [], skippedTables: [], failures: [] };
    for (const counter of countersToReset) {
      try {
        await dynamodb.update({
          TableName: counter.tableName,
          Key: { pk: counter.primaryKey },
          UpdateExpression: "SET #x = :zero",
          ExpressionAttributeNames: { "#x": "x" },
          ExpressionAttributeValues: { ":zero": 0 },
        }).promise();
        report.resetCounters.push(counter.tableName);
      } catch (error) {
        if (isMissingTable(error)) report.skippedTables.push(counter.tableName);
        else report.failures.push({ tableName: counter.tableName, error: error.message });
      }
    }
    return report;
  }

  async function readResetMarker(dynamodb, environmentId) {
    return (await dynamodb.get({
      TableName: resetControlTable,
      Key: { environmentId },
      ConsistentRead: true,
    }).promise()).Item || null;
  }

  async function writeResetMarker(dynamodb, { environmentId, caller, previous }) {
    const now = new Date().toISOString();
    const item = {
      environmentId,
      contractVersion: RESET_CONTRACT_VERSION,
      legacyPurgeCompletedAt: previous?.legacyPurgeCompletedAt || now,
      completedBy: caller || "temporary-any-caller-mode",
    };
    await dynamodb.put({ TableName: resetControlTable, Item: item }).promise();
    return item;
  }

  function combineReports(...reports) {
    return {
      clearedTables: reports.flatMap((report) => report.clearedTables || []),
      skippedTables: reports.flatMap((report) => report.skippedTables || []),
      failures: reports.flatMap((report) => report.failures || []),
    };
  }

  on("resetDBStatus", async (ctx) => {
    const access = resetConfiguration();
    const caller = access.enabled && access.configuredEnvironment && !access.productionLike
      ? await resolveCaller(ctx)
      : "";
    const callerAllowed = access.allowAnyAuthenticatedUser || (!!caller && access.allowedUsers.has(caller));
    let available = access.enabled && !!access.configuredEnvironment
      && !access.productionLike && callerAllowed && !!access.resetControlTable;
    let reasonCode = null;
    if (!access.enabled || !access.configuredEnvironment || access.productionLike) {
      reasonCode = "TEST_RESET_DISABLED";
    } else if (!callerAllowed) {
      reasonCode = "TEST_RESET_FORBIDDEN";
    } else if (!access.resetControlTable) {
      reasonCode = "TEST_RESET_CONTROL_UNAVAILABLE";
    }

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
    const dynamodbLL = deps.dynamodbLL;
    let marker;
    try {
      marker = await readResetMarker(dynamodb, authorization.access.configuredEnvironment);
    } catch {
      return {
        ok: false,
        error: {
          code: "TEST_RESET_CONTROL_UNAVAILABLE",
          message: "The reset migration marker could not be read; no reset was attempted.",
        },
      };
    }

    const legacyPurgeRequired = marker?.contractVersion !== RESET_CONTRACT_VERSION;
    const emptyReport = { clearedTables: [], skippedTables: [], failures: [] };
    const legacyPurge = legacyPurgeRequired
      ? await clearTables(legacyTables, dynamodb, dynamodbLL)
      : emptyReport;
    if (legacyPurge.failures.length) {
      return {
        ok: true,
        response: {
          alert: "failed",
          mode: RESET_MODE,
          contractVersion: RESET_CONTRACT_VERSION,
          legacyPurge: { performed: true, completed: false, ...legacyPurge },
          canonicalReset: { performed: false },
          ...combineReports(legacyPurge),
        },
      };
    }

    let completedMarker = marker;
    if (legacyPurgeRequired) {
      try {
        completedMarker = await writeResetMarker(dynamodb, {
          environmentId: authorization.access.configuredEnvironment,
          caller: authorization.caller,
          previous: marker,
        });
      } catch (error) {
        const markerFailure = {
          clearedTables: [],
          skippedTables: [],
          failures: [{ tableName: resetControlTable, error: error.message }],
        };
        return {
          ok: true,
          response: {
            alert: "failed",
            mode: RESET_MODE,
            contractVersion: RESET_CONTRACT_VERSION,
            legacyPurge: { performed: true, completed: false, ...legacyPurge },
            canonicalReset: { performed: false },
            ...combineReports(legacyPurge, markerFailure),
          },
        };
      }
    }

    const canonical = await clearTables(
      legacyPurgeRequired
        ? canonicalTables.filter((tableName) => !legacyTableSet.has(tableName))
        : canonicalTables,
      dynamodb,
      dynamodbLL
    );
    const compatibility = legacyPurgeRequired
      ? { performed: false, ...emptyReport }
      : { performed: true, ...await clearTables(compatibilityTables, dynamodb, dynamodbLL) };
    const counters = await resetCounters(dynamodb);
    const beforeIdentity = combineReports(canonical, compatibility, counters);
    const identity = beforeIdentity.failures.length
      ? { performed: false, ...emptyReport }
      : { performed: true, ...await clearTables(identityTables, dynamodb, dynamodbLL) };
    const canonicalReset = combineReports(canonical, identity);
    const combined = combineReports(legacyPurge, canonical, compatibility, counters, identity);

    const success = combined.failures.length === 0;
    if (success) {
      ctx.res?.setHeader?.(
        "Set-Cookie",
        "accessToken=; Max-Age=0; Path=/; Domain=.1var.com; HttpOnly; Secure; SameSite=None"
      );
    }
    return {
      ok: true,
      response: {
        alert: success ? "success" : "failed",
        mode: RESET_MODE,
        contractVersion: RESET_CONTRACT_VERSION,
        legacyPurge: {
          performed: legacyPurgeRequired,
          completed: true,
          completedAt: completedMarker.legacyPurgeCompletedAt,
          ...legacyPurge,
        },
        canonicalReset: { performed: true, ...canonicalReset },
        identityCleanup: identity,
        compatibilityCleanup: compatibility,
        resetCounters: counters.resetCounters,
        ...combined,
      },
    };
  });

  return { name: "resetDB" };
}

module.exports = { register };
