"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { register } = require("../app/routes/modules/resetDB");

test("Reset DB clears both CloudFormation-named Protected Asset tables", async () => {
  const previousAssetsTable = process.env.PROTECTED_ASSETS_TABLE;
  const previousAuditTable = process.env.PROTECTED_ASSET_AUDIT_TABLE;
  process.env.PROTECTED_ASSETS_TABLE = "compute-ProtectedAssetsTable-SEKP3UPKPBA2";
  process.env.PROTECTED_ASSET_AUDIT_TABLE = "compute-ProtectedAssetAuditTable-SRJ00SECK5RQ";

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
  }
});

test("Compute template grants Reset DB access to retained Protected Asset tables", () => {
  const template = fs.readFileSync(path.join(__dirname, "../template.yaml"), "utf8");
  for (const action of ["DescribeTable", "Scan", "BatchWriteItem"]) {
    assert.match(template, new RegExp(`dynamodb:${action}`, "g"));
  }
  assert.match(template, /PROTECTED_ASSETS_TABLE:\s*!Ref ProtectedAssetsTable/);
  assert.match(template, /PROTECTED_ASSET_AUDIT_TABLE:\s*!Ref ProtectedAssetAuditTable/);
});
