"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { register } = require("../app/routes/modules/resetDB");

test("Reset DB clears both CloudFormation-named Protected Asset tables", async () => {
  const previousAssetsTable = process.env.PROTECTED_ASSETS_TABLE;
  const previousAuditTable = process.env.PROTECTED_ASSET_AUDIT_TABLE;
  const previousResetEnabled = process.env.TEST_RESET_ENABLED;
  const previousResetEnvironment = process.env.TEST_RESET_ENVIRONMENT_ID;
  const previousResetUsers = process.env.TEST_RESET_ALLOWED_USER_IDS;
  process.env.PROTECTED_ASSETS_TABLE = "compute-ProtectedAssetsTable-SEKP3UPKPBA2";
  process.env.PROTECTED_ASSET_AUDIT_TABLE = "compute-ProtectedAssetAuditTable-SRJ00SECK5RQ";
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

test("Compute template grants Reset DB access to retained Protected Asset tables", () => {
  const template = fs.readFileSync(path.join(__dirname, "../template.yaml"), "utf8");
  for (const action of ["DescribeTable", "Scan", "BatchWriteItem"]) {
    assert.match(template, new RegExp(`dynamodb:${action}`, "g"));
  }
  assert.match(template, /PROTECTED_ASSETS_TABLE:\s*!Ref ProtectedAssetsTable/);
  assert.match(template, /PROTECTED_ASSET_AUDIT_TABLE:\s*!Ref ProtectedAssetAuditTable/);
  assert.match(template, /TEST_RESET_ENABLED:\s*!Ref TestResetEnabled/);
  assert.match(template, /TEST_RESET_ENVIRONMENT_ID:\s*!Ref TestResetEnvironmentId/);
  assert.match(template, /TEST_RESET_ALLOWED_USER_IDS:\s*!Ref TestResetAllowedUserIds/);
});
