// routes/capabilityBuildCoordinator.js
"use strict";

const crypto = require("node:crypto");

const DEFAULT_TABLE = process.env.SUBDOMAINS_TABLE || "subdomains";
const DEFAULT_LEASE_SECONDS = 120;

function promiseOf(request) {
  return request && typeof request.promise === "function" ? request.promise() : request;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function createCapabilityBuildCoordinator({ dynamodb, tableName = DEFAULT_TABLE, leaseSeconds = DEFAULT_LEASE_SECONDS } = {}) {
  if (!dynamodb) throw new Error("capability build coordinator requires a DynamoDB DocumentClient");

  function identity({ ownerId, capabilityId }) {
    const owner = String(ownerId || "system");
    const capability = String(capabilityId || "").trim().toLowerCase();
    const digest = stableHash(`${owner}\n${capability}`);
    return {
      buildId: `build_${digest.slice(0, 24)}`,
      key: `capbuild#${digest}`,
      ownerId: owner,
      capabilityId: capability,
    };
  }

  async function get(identityOrKey) {
    const key = typeof identityOrKey === "string" ? identityOrKey : identityOrKey?.key;
    if (!key) return null;
    const result = await promiseOf(dynamodb.get({ TableName: tableName, Key: { su: key } }));
    return result?.Item || null;
  }

  async function claim({ ownerId, capabilityId, requestHash = "" } = {}) {
    const id = identity({ ownerId, capabilityId });
    const now = Math.floor(Date.now() / 1000);
    const item = {
      su: id.key,
      recordType: "computeCapabilityBuild",
      capabilityBuildId: id.buildId,
      capabilityBuildStatus: "building",
      capabilityId: id.capabilityId,
      capabilityOwnerId: id.ownerId,
      capabilityRequestHash: String(requestHash || ""),
      capabilityBuildStartedAt: new Date(now * 1000).toISOString(),
      capabilityBuildLeaseExpiresAt: now + Math.max(30, Number(leaseSeconds) || DEFAULT_LEASE_SECONDS),
    };
    try {
      await promiseOf(dynamodb.put({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(#su) OR #lease < :now",
        ExpressionAttributeNames: { "#su": "su", "#lease": "capabilityBuildLeaseExpiresAt" },
        ExpressionAttributeValues: { ":now": now },
      }));
      return { acquired: true, ...id, record: item };
    } catch (error) {
      if (error?.code !== "ConditionalCheckFailedException" && error?.name !== "ConditionalCheckFailedException") throw error;
      const record = await get(id);
      return { acquired: false, ...id, record };
    }
  }

  async function complete(claimResult, manifest) {
    const now = new Date().toISOString();
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: claimResult.key },
      UpdateExpression: "SET #status = :status, #entity = :entity, #version = :version, #completed = :completed",
      ExpressionAttributeNames: {
        "#status": "capabilityBuildStatus",
        "#entity": "capabilityEntityId",
        "#version": "capabilityVersion",
        "#completed": "capabilityBuildCompletedAt",
      },
      ExpressionAttributeValues: {
        ":status": "completed",
        ":entity": manifest.entityId,
        ":version": manifest.version,
        ":completed": now,
      },
    }));
    return { buildId: claimResult.buildId, status: "completed", entityId: manifest.entityId, completedAt: now };
  }

  async function fail(claimResult, code = "BUILD_FAILED") {
    const now = new Date().toISOString();
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: claimResult.key },
      UpdateExpression: "SET #status = :status, #code = :code, #completed = :completed",
      ExpressionAttributeNames: {
        "#status": "capabilityBuildStatus",
        "#code": "capabilityBuildErrorCode",
        "#completed": "capabilityBuildCompletedAt",
      },
      ExpressionAttributeValues: {
        ":status": "failed",
        ":code": String(code || "BUILD_FAILED"),
        ":completed": now,
      },
    }));
  }

  return { identity, get, claim, complete, fail };
}

module.exports = { stableHash, createCapabilityBuildCoordinator };
