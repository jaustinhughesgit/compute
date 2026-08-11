"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { register } = require("../app/routes/modules/resetDB");

test("Reset DB clears CloudFormation-named identity data tables including Context graph", async () => {
  const previousAssetsTable = process.env.PROTECTED_ASSETS_TABLE;
  const previousAuditTable = process.env.PROTECTED_ASSET_AUDIT_TABLE;
  const previousContextGraphTable = process.env.CONTEXT_GRAPH_TABLE;
  const previousResetEnabled = process.env.TEST_RESET_ENABLED;
  const previousResetEnvironment = process.env.TEST_RESET_ENVIRONMENT_ID;
  const previousResetUsers = process.env.TEST_RESET_ALLOWED_USER_IDS;
  process.env.PROTECTED_ASSETS_TABLE = "compute-ProtectedAssetsTable-SEKP3UPKPBA2";
  process.env.PROTECTED_ASSET_AUDIT_TABLE = "compute-ProtectedAssetAuditTable-SRJ00SECK5RQ";
  process.env.CONTEXT_GRAPH_TABLE = "compute-ContextGraphTable-CTX123";
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";

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
  ]);
  const deletedTables = [];
  let handler;
  const documentClient = {
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
      req: { body: { testEnvironmentId: "test-a" } },
      cookie: { e: "42" },
      res: { setHeader: (name, value) => cookies.push([name, value]) },
    });
    assert.equal(result.response.alert, "success");
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
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";
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
    assert.equal(accessed, false);
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.environment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previous.environment;
    if (previous.users == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.users;
  }
});

test("Reset DB status gives an authorized portal the configured identity without user input", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    environment: process.env.TEST_RESET_ENVIRONMENT_ID,
    users: process.env.TEST_RESET_ALLOWED_USER_IDS,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "42";
  const handlers = {};
  try {
    register({
      on: (name, callback) => { handlers[name] = callback; },
      use: () => ({
        getDocClient: () => ({}),
        getCookie: async (value, key) => ({ Items: value === "session-42" && key === "ak" ? [{ e: "42" }] : [] }),
        deps: { dynamodbLL: {} },
      }),
    });
    const authorized = await handlers.resetDBStatus({ req: { cookies: { accessToken: "session-42" } } });
    assert.deepEqual(authorized, {
      ok: true,
      response: { available: true, reasonCode: null, accountId: "42", environmentId: "test-a" },
    });
    const forbidden = await handlers.resetDBStatus({ cookie: { e: "99" } });
    assert.deepEqual(forbidden, {
      ok: true,
      response: { available: false, reasonCode: "TEST_RESET_FORBIDDEN", accountId: "99", environmentId: null },
    });
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.environment == null) delete process.env.TEST_RESET_ENVIRONMENT_ID;
    else process.env.TEST_RESET_ENVIRONMENT_ID = previous.environment;
    if (previous.users == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.users;
  }
});

test("Reset DB can temporarily allow any caller on an explicitly configured test deployment", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    environment: process.env.TEST_RESET_ENVIRONMENT_ID,
    allowAny: process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER,
    users: process.env.TEST_RESET_ALLOWED_USER_IDS,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ENVIRONMENT_ID = "test-a";
  process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER = "true";
  process.env.TEST_RESET_ALLOWED_USER_IDS = "";
  const handlers = {};
  try {
    register({
      on: (name, callback) => { handlers[name] = callback; },
      use: () => ({
        getDocClient: () => ({}),
        getCookie: async (value, key) => ({ Items: value === "session-2" && key === "ak" ? [{ e: "2" }] : [] }),
        deps: { dynamodbLL: {} },
      }),
    });
    const authenticated = await handlers.resetDBStatus({ req: { cookies: { accessToken: "session-2" } } });
    assert.deepEqual(authenticated, {
      ok: true,
      response: { available: true, reasonCode: null, accountId: "2", environmentId: "test-a" },
    });
    const anonymous = await handlers.resetDBStatus({ req: { cookies: {} } });
    assert.deepEqual(anonymous, {
      ok: true,
      response: { available: true, reasonCode: null, accountId: null, environmentId: "test-a" },
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
