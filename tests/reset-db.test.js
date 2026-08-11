"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { register } = require("../app/routes/modules/resetDB");

test("first canonical reset purges legacy data, clears active stores, and records completion", async () => {
  const previousAssetsTable = process.env.PROTECTED_ASSETS_TABLE;
  const previousAuditTable = process.env.PROTECTED_ASSET_AUDIT_TABLE;
  const previousContextGraphTable = process.env.CONTEXT_GRAPH_TABLE;
  const previousResetEnabled = process.env.TEST_RESET_ENABLED;
  const previousResetEnvironment = process.env.TEST_RESET_ENVIRONMENT_ID;
  const previousResetUsers = process.env.TEST_RESET_ALLOWED_USER_IDS;
  const previousResetControl = process.env.TEST_RESET_CONTROL_TABLE;
  process.env.PROTECTED_ASSETS_TABLE = "compute-ProtectedAssetsTable-SEKP3UPKPBA2";
  process.env.PROTECTED_ASSET_AUDIT_TABLE = "compute-ProtectedAssetAuditTable-SRJ00SECK5RQ";
  process.env.CONTEXT_GRAPH_TABLE = "compute-ContextGraphTable-CTX123";
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";
  process.env.TEST_RESET_CONTROL_TABLE = "compute-TestResetControlTable-RESET1";

  const protectedTables = new Map([
    [process.env.PROTECTED_ASSETS_TABLE, {
      keySchema: [{ AttributeName: "assetId", KeyType: "HASH" }],
      items: [{ assetId: "asset-1" }],
    }],
    [process.env.PROTECTED_ASSET_AUDIT_TABLE, {
      keySchema: [
        { AttributeName: "assetId", KeyType: "HASH" },
        { AttributeName: "eventKey", KeyType: "RANGE" },
      ],
      items: [{ assetId: "asset-1", eventKey: "event-1" }],
    }],
    [process.env.CONTEXT_GRAPH_TABLE, {
      keySchema: [
        { AttributeName: "audienceId", KeyType: "HASH" },
        { AttributeName: "recordKey", KeyType: "RANGE" },
      ],
      items: [{ audienceId: "u:42", recordKey: "node#usr_42" }],
    }],
    ["embPaths", {
      keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      items: [{ id: "legacy-path-1" }],
    }],
  ]);
  const deletedTables = [];
  let resetMarker = null;
  let handler;
  const documentClient = {
    get: () => ({ promise: async () => ({ Item: resetMarker }) }),
    put: ({ Item }) => ({
      promise: async () => { resetMarker = Item; },
    }),
    scan: ({ TableName }) => ({
      promise: async () => {
        const table = protectedTables.get(TableName);
        const items = table?.items.splice(0) || [];
        return { Items: items };
      },
    }),
    batchWrite: ({ RequestItems }) => ({
      promise: async () => {
        deletedTables.push(...Object.keys(RequestItems));
        return { UnprocessedItems: {} };
      },
    }),
    update: () => ({
      promise: async () => {
        const error = new Error("missing");
        error.code = "ResourceNotFoundException";
        throw error;
      },
    }),
  };
  const dynamodbLL = {
    describeTable: ({ TableName }) => ({
      promise: async () => {
        const table = protectedTables.get(TableName);
        if (!table) {
          const error = new Error("missing");
          error.code = "ResourceNotFoundException";
          throw error;
        }
        return { Table: { KeySchema: table.keySchema } };
      },
    }),
  };

  try {
    register({
      on: (name, callback) => {
        if (name === "resetDB") handler = callback;
      },
      use: () => ({
        getDocClient: () => documentClient,
        deps: { dynamodbLL },
      }),
    });
    const cookies = [];
    const result = await handler({
      req: { body: { testEnvironmentId: "test-a", mode: "canonical" } },
      cookie: { e: "42" },
      res: { setHeader: (name, value) => cookies.push([name, value]) },
    });
    assert.equal(result.response.alert, "success");
    assert.equal(result.response.mode, "canonical");
    assert.equal(result.response.legacyPurge.performed, true);
    assert.equal(resetMarker.contractVersion, 1);
    assert.deepEqual(deletedTables.sort(), [...protectedTables.keys()].sort());
    assert.deepEqual(
      result.response.clearedTables.map(({ tableName }) => tableName).sort(),
      [...protectedTables.keys()].sort()
    );
    assert.equal(cookies[0][0], "Set-Cookie");
  } finally {
    if (previousAssetsTable == null) delete process.env.PROTECTED_ASSETS_TABLE;
    else process.env.PROTECTED_ASSETS_TABLE = previousAssetsTable;
    if (previousAuditTable == null) delete process.env.PROTECTED_ASSET_AUDIT_TABLE;
    else process.env.PROTECTED_ASSET_AUDIT_TABLE = previousAuditTable;
    if (previousContextGraphTable == null) delete process.env.CONTEXT_GRAPH_TABLE;
    else process.env.CONTEXT_GRAPH_TABLE = previousContextGraphTable;
    if (previousResetEnabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previousResetEnabled;
    if (previousResetEnvironment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previousResetEnvironment;
    if (previousResetUsers == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previousResetUsers;
    if (previousResetControl == null) delete process.env.TEST_RESET_CONTROL_TABLE;
    else process.env.TEST_RESET_CONTROL_TABLE = previousResetControl;
  }
});

test("later canonical resets skip the migration phase but clear active compatibility data", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    environment: process.env.TEST_RESET_ENVIRONMENT_ID,
    users: process.env.TEST_RESET_ALLOWED_USER_IDS,
    control: process.env.TEST_RESET_CONTROL_TABLE,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";
  process.env.TEST_RESET_CONTROL_TABLE = "reset-control";

  const tableItems = new Map([
    ["users", [{ userID: 42 }]],
    ["embPaths", [{ id: "must-not-be-touched" }]],
  ]);
  const described = [];
  let marker = {
    environmentId: "test-a",
    contractVersion: 1,
    legacyPurgeCompletedAt: "2026-08-11T12:00:00.000Z",
  };
  let handler;
  const missing = () => {
    const error = new Error("missing");
    error.code = "ResourceNotFoundException";
    throw error;
  };
  const documentClient = {
    get: () => ({ promise: async () => ({ Item: marker }) }),
    put: ({ Item }) => ({ promise: async () => { marker = Item; } }),
    scan: ({ TableName }) => ({
      promise: async () => ({ Items: tableItems.get(TableName)?.splice(0) || [] }),
    }),
    batchWrite: () => ({ promise: async () => ({ UnprocessedItems: {} }) }),
    update: () => ({ promise: async () => missing() }),
  };
  const dynamodbLL = {
    describeTable: ({ TableName }) => ({
      promise: async () => {
        described.push(TableName);
        if (!tableItems.has(TableName)) return missing();
        return {
          Table: {
            KeySchema: [{
              AttributeName: TableName === "users" ? "userID" : "id",
              KeyType: "HASH",
            }],
          },
        };
      },
    }),
  };

  try {
    register({
      on: (name, callback) => { if (name === "resetDB") handler = callback; },
      use: () => ({ getDocClient: () => documentClient, deps: { dynamodbLL } }),
    });
    const result = await handler({
      req: { body: { testEnvironmentId: "test-a", mode: "canonical" } },
      cookie: { e: "42" },
      res: { setHeader: () => {} },
    });
    assert.equal(result.response.alert, "success");
    assert.equal(result.response.legacyPurge.performed, false);
    assert.equal(described.includes("users"), true);
    assert.equal(described.includes("embPaths"), true);
    assert.deepEqual(tableItems.get("embPaths"), []);
    assert.equal(marker.legacyPurgeCompletedAt, "2026-08-11T12:00:00.000Z");
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.environment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previous.environment;
    if (previous.users == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.users;
    if (previous.control == null) delete process.env.TEST_RESET_CONTROL_TABLE;
    else process.env.TEST_RESET_CONTROL_TABLE = previous.control;
  }
});

test("a failed legacy purge blocks canonical deletion and marker creation", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    environment: process.env.TEST_RESET_ENVIRONMENT_ID,
    users: process.env.TEST_RESET_ALLOWED_USER_IDS,
    control: process.env.TEST_RESET_CONTROL_TABLE,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";
  process.env.TEST_RESET_CONTROL_TABLE = "reset-control";
  const described = [];
  let markerWrites = 0;
  let handler;

  try {
    register({
      on: (name, callback) => { if (name === "resetDB") handler = callback; },
      use: () => ({
        getDocClient: () => ({
          get: () => ({ promise: async () => ({}) }),
          put: () => ({ promise: async () => { markerWrites += 1; } }),
        }),
        deps: {
          dynamodbLL: {
            describeTable: ({ TableName }) => ({
              promise: async () => {
                described.push(TableName);
                throw new Error("legacy purge denied");
              },
            }),
          },
        },
      }),
    });
    const result = await handler({
      req: { body: { testEnvironmentId: "test-a", mode: "canonical" } },
      cookie: { e: "42" },
      res: {},
    });
    assert.equal(result.response.alert, "failed");
    assert.equal(result.response.legacyPurge.completed, false);
    assert.equal(result.response.canonicalReset.performed, false);
    assert.deepEqual(described, ["access", "verified", "embPaths"]);
    assert.equal(described.includes("versions"), false);
    assert.equal(markerWrites, 0);
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.environment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previous.environment;
    if (previous.users == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.users;
    if (previous.control == null) delete process.env.TEST_RESET_CONTROL_TABLE;
    else process.env.TEST_RESET_CONTROL_TABLE = previous.control;
  }
});

test("Reset DB fails closed before accessing DynamoDB", async () => {
  const previousResetEnabled = process.env.TEST_RESET_ENABLED;
  delete process.env.TEST_RESET_ENABLED;
  let handler;
  let accessed = false;
  try {
    register({
      on: (name, callback) => { if (name === "resetDB") handler = callback; },
      use: () => ({
        getDocClient: () => { accessed = true; return {}; },
        deps: { dynamodbLL: {} }
      })
    });
    const result = await handler({ req: { body: { testEnvironmentId: "test-a" } }, cookie: { e: "42" }, res: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TEST_RESET_DISABLED");
    assert.equal(accessed, false);
  } finally {
    if (previousResetEnabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previousResetEnabled;
  }
});

test("Reset DB denies environment mismatches and users outside the allow-list", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    environment: process.env.TEST_RESET_ENVIRONMENT_ID,
    users: process.env.TEST_RESET_ALLOWED_USER_IDS,
    control: process.env.TEST_RESET_CONTROL_TABLE,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";
  process.env.TEST_RESET_CONTROL_TABLE = "reset-control";
  let handler;
  let accessed = false;
  try {
    register({
      on: (name, callback) => { if (name === "resetDB") handler = callback; },
      use: () => ({
        getDocClient: () => { accessed = true; return {}; },
        deps: { dynamodbLL: {} }
      })
    });
    const mismatch = await handler({ req: { body: { testEnvironmentId: "test-b" } }, cookie: { e: "42" }, res: {} });
    assert.equal(mismatch.error.code, "TEST_RESET_ENVIRONMENT_MISMATCH");
    const forbidden = await handler({ req: { body: { testEnvironmentId: "test-a" } }, cookie: { e: "99" }, res: {} });
    assert.equal(forbidden.error.code, "TEST_RESET_FORBIDDEN");
    const unsupported = await handler({
      req: { body: { testEnvironmentId: "test-a", mode: "legacy" } },
      cookie: { e: "42" },
      res: {},
    });
    assert.equal(unsupported.error.code, "TEST_RESET_MODE_UNSUPPORTED");
    assert.equal(accessed, false);
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.environment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previous.environment;
    if (previous.users == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.users;
    if (previous.control == null) delete process.env.TEST_RESET_CONTROL_TABLE;
    else process.env.TEST_RESET_CONTROL_TABLE = previous.control;
  }
});

test("Reset DB status gives an authorized portal the configured identity without user input", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    environment: process.env.TEST_RESET_ENVIRONMENT_ID,
    users: process.env.TEST_RESET_ALLOWED_USER_IDS,
    control: process.env.TEST_RESET_CONTROL_TABLE,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";
  process.env.TEST_RESET_CONTROL_TABLE = "reset-control";
  const handlers = {};
  try {
    register({
      on: (name, callback) => { handlers[name] = callback; },
      use: () => ({
        getDocClient: () => ({
          get: () => ({ promise: async () => ({}) }),
        }),
        getCookie: async (value, key) => ({ Items: value === "session-42" && key === "ak" ? [{ e: "42" }] : [] }),
        deps: { dynamodbLL: {} },
      }),
    });
    const authorized = await handlers.resetDBStatus({ req: { cookies: { accessToken: "session-42" } } });
    assert.deepEqual(authorized, {
      ok: true,
      response: {
        available: true,
        reasonCode: null,
        accountId: "42",
        environmentId: "test-a",
        mode: "canonical",
        contractVersion: 1,
        legacyPurgeRequired: true,
        legacyPurgeCompletedAt: null,
      },
    });
    const forbidden = await handlers.resetDBStatus({ cookie: { e: "99" } });
    assert.deepEqual(forbidden, {
      ok: true,
      response: {
        available: false,
        reasonCode: "TEST_RESET_FORBIDDEN",
        accountId: "99",
        environmentId: null,
        mode: "canonical",
        contractVersion: 1,
        legacyPurgeRequired: null,
        legacyPurgeCompletedAt: null,
      },
    });
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.environment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previous.environment;
    if (previous.users == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.users;
    if (previous.control == null) delete process.env.TEST_RESET_CONTROL_TABLE;
    else process.env.TEST_RESET_CONTROL_TABLE = previous.control;
  }
});

test("Reset DB can temporarily allow any caller on an explicitly configured test deployment", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    environment: process.env.TEST_RESET_ENVIRONMENT_ID,
    allowAny: process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER,
    users: process.env.TEST_RESET_ALLOWED_USER_IDS,
    control: process.env.TEST_RESET_CONTROL_TABLE,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER = "true";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "";
  process.env.TEST_RESET_CONTROL_TABLE = "reset-control";
  const handlers = {};
  try {
    register({
      on: (name, callback) => { handlers[name] = callback; },
      use: () => ({
        getDocClient: () => ({
          get: () => ({
            promise: async () => ({
              Item: {
                environmentId: "test-a",
                contractVersion: 1,
                legacyPurgeCompletedAt: "2026-08-11T12:00:00.000Z",
              },
            }),
          }),
        }),
        getCookie: async (value, key) => ({ Items: value === "session-2" && key === "ak" ? [{ e: "2" }] : [] }),
        deps: { dynamodbLL: {} },
      }),
    });
    const authenticated = await handlers.resetDBStatus({ req: { cookies: { accessToken: "session-2" } } });
    assert.deepEqual(authenticated, {
      ok: true,
      response: {
        available: true,
        reasonCode: null,
        accountId: "2",
        environmentId: "test-a",
        mode: "canonical",
        contractVersion: 1,
        legacyPurgeRequired: false,
        legacyPurgeCompletedAt: "2026-08-11T12:00:00.000Z",
      },
    });
    const anonymous = await handlers.resetDBStatus({ req: { cookies: {} } });
    assert.deepEqual(anonymous, {
      ok: true,
      response: {
        available: true,
        reasonCode: null,
        accountId: null,
        environmentId: "test-a",
        mode: "canonical",
        contractVersion: 1,
        legacyPurgeRequired: false,
        legacyPurgeCompletedAt: "2026-08-11T12:00:00.000Z",
      },
    });
    const resetAuthorization = await handlers.resetDB({
      req: { body: { testEnvironmentId: "wrong" }, cookies: {} },
      res: {},
    });
    assert.equal(resetAuthorization.error.code, "TEST_RESET_ENVIRONMENT_MISMATCH");
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.environment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previous.environment;
    if (previous.allowAny == null) delete process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER;
    else process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER = previous.allowAny;
    if (previous.users == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.users;
    if (previous.control == null) delete process.env.TEST_RESET_CONTROL_TABLE;
    else process.env.TEST_RESET_CONTROL_TABLE = previous.control;
  }
});

test("Compute template grants Reset DB access to retained Protected Asset tables", () => {
  const template = fs.readFileSync(path.join(__dirname, "../template.yaml"), "utf8");
  for (const action of ["DescribeTable", "Scan", "BatchWriteItem"]) {
    assert.match(template, new RegExp(`dynamodb:${action}`, "g"));
  }
  assert.match(template, /PROTECTED_ASSETS_TABLE:\s*!Ref ProtectedAssetsTable/);
  assert.match(template, /PROTECTED_ASSET_AUDIT_TABLE:\s*!Ref ProtectedAssetAuditTable/);
  assert.match(template, /TEST_RESET_ENABLED:\s*!Ref TestResetEnabled/);
  assert.match(template, /TEST_RESET_ENVIRONMENT_ID:\s*!Ref TestResetEnvironmentId/);
  assert.match(template, /TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER:\s*!Ref TestResetAllowAnyAuthenticatedUser/);
  assert.match(template, /TEST_RESET_ALLOWED_USER_IDS:\s*!Ref TestResetAllowedUserIds/);
  assert.match(template, /TEST_RESET_CONTROL_TABLE:\s*!Ref TestResetControlTable/);
  assert.match(template, /TestResetControlTable:\s*\n\s+Type: AWS::DynamoDB::Table/);
  assert.match(template, /UseTestResetControlTable[\s\S]*?dynamodb:GetItem[\s\S]*?dynamodb:PutItem/);
});

test("canonical reset covers new substrate and active operational stores", () => {
  const resetSource = fs.readFileSync(path.join(__dirname, "../app/routes/modules/resetDB.js"), "utf8");
  for (const table of ["perm_grants", "presence_invites", "enabled", "access", "verified"]) {
    assert.equal(resetSource.includes(`"${table}"`), true, `missing ${table}`);
  }
  assert.match(resetSource, /CONTEXT_GRAPH_TABLE/);
  assert.match(resetSource, /EMBPATHS_TABLE/);
});

test("confirmed Path foundation storage is retained and excluded from test database reset", () => {
  const template = fs.readFileSync(path.join(__dirname, "../template.yaml"), "utf8");
  const resetSource = fs.readFileSync(
    path.join(__dirname, "../app/routes/modules/resetDB.js"),
    "utf8"
  );
  assert.match(template, /PathFoundationTable:\s*\n\s+Type: AWS::DynamoDB::Table/);
  assert.match(template, /PATH_FOUNDATION_TABLE:\s*!Ref PathFoundationTable/);
  assert.match(template, /PathFoundationTable:[\s\S]*?DeletionPolicy: Retain/);
  assert.doesNotMatch(resetSource, /PATH_FOUNDATION_TABLE|pathFoundation/);
});

test("Context graph storage is retained across stacks and included in identity reset", () => {
  const template = fs.readFileSync(path.join(__dirname, "../template.yaml"), "utf8");
  const resetSource = fs.readFileSync(
    path.join(__dirname, "../app/routes/modules/resetDB.js"),
    "utf8"
  );
  assert.match(template, /ContextGraphTable:\s*\n\s+Type: AWS::DynamoDB::Table/);
  assert.match(template, /CONTEXT_GRAPH_TABLE:\s*!Ref ContextGraphTable/);
  assert.match(template, /ContextGraphTable:[\s\S]*?DeletionPolicy: Retain/);
  assert.match(resetSource, /CONTEXT_GRAPH_TABLE/);
});

test("canonical projections are retained, encrypted, and included in isolated identity reset", () => {
  const template = fs.readFileSync(path.join(__dirname, "../template.yaml"), "utf8");
  const resetSource = fs.readFileSync(
    path.join(__dirname, "../app/routes/modules/resetDB.js"),
    "utf8"
  );
  assert.match(template, /CanonicalProjectionTable:\s*\n\s+Type: AWS::DynamoDB::Table/);
  assert.match(template, /CANONICAL_PROJECTION_TABLE:\s*!Ref CanonicalProjectionTable/);
  assert.match(template, /CanonicalProjectionTable:[\s\S]*?DeletionPolicy: Retain/);
  assert.match(template, /CanonicalProjectionTable:[\s\S]*?SSEEnabled: true/);
  assert.match(resetSource, /CANONICAL_PROJECTION_TABLE/);
});

test("canonical governance audit is retained, encrypted, and included in isolated identity reset", () => {
  const template = fs.readFileSync(path.join(__dirname, "../template.yaml"), "utf8");
  const resetSource = fs.readFileSync(path.join(__dirname, "../app/routes/modules/resetDB.js"), "utf8");
  assert.match(template, /CanonicalAuditTable:\s*\n\s+Type: AWS::DynamoDB::Table/);
  assert.match(template, /CANONICAL_AUDIT_TABLE:\s*!Ref CanonicalAuditTable/);
  assert.match(template, /CanonicalAuditTable:[\s\S]*?DeletionPolicy: Retain/);
  assert.match(template, /CanonicalAuditTable:[\s\S]*?SSEEnabled: true/);
  assert.match(resetSource, /CANONICAL_AUDIT_TABLE/);
});
