/**
 * Platform: Prevents concurrent retries from creating duplicate capability implementations for one contract.
 * Technical: DynamoDB-backed lease keyed by owner/capability/request hash with claim, renew, complete, and fail transitions.
 */
"use strict";

const crypto = require("node:crypto");

const DEFAULT_TABLE = process.env.SUBDOMAINS_TABLE || "subdomains";
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_FINALIZE_LEASE_SECONDS = 210;
const MAX_BUILD_ARTIFACT_BYTES = 192 * 1024;

function promiseOf(request) {
  return request && typeof request.promise === "function" ? request.promise() : request;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function cleanFailureMessage(value, limit = 800) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function boundedBuildArtifacts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind !== "convertArtifacts" || Number(value.schemaVersion) !== 1) return null;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_BUILD_ARTIFACT_BYTES) return null;
  return JSON.parse(serialized);
}

function failureReason(record) {
  const code = cleanFailureMessage(record?.capabilityBuildErrorCode, 120) || "BUILD_FAILED";
  const detail = cleanFailureMessage(record?.capabilityBuildErrorMessage);
  return detail
    ? `The capability build failed (${code}): ${detail}`
    : `The capability build failed (${code}).`;
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

  async function complete(claimResult, manifest, { convertArtifacts = null } = {}) {
    const now = new Date().toISOString();
    const names = {
      "#status": "capabilityBuildStatus",
      "#buildId": "capabilityBuildId",
      "#entity": "capabilityEntityId",
      "#version": "capabilityVersion",
      "#completed": "capabilityBuildCompletedAt",
    };
    const values = {
      ":building": "building",
      ":status": "completed",
      ":buildId": claimResult.buildId,
      ":entity": manifest.entityId,
      ":version": manifest.version,
      ":completed": now,
    };
    const artifacts = boundedBuildArtifacts(convertArtifacts);
    let updateExpression = "SET #status = :status, #entity = :entity, #version = :version, #completed = :completed";
    if (artifacts) {
      names["#artifacts"] = "capabilityBuildArtifacts";
      values[":artifacts"] = artifacts;
      updateExpression += ", #artifacts = :artifacts";
    }
    let condition = "#status = :building AND #buildId = :buildId";
    if (claimResult.finalizeToken) {
      names["#finalizeToken"] = "capabilityBuildFinalizeToken";
      values[":finalizeToken"] = claimResult.finalizeToken;
      condition += " AND #finalizeToken = :finalizeToken";
    }
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: claimResult.key },
      UpdateExpression: updateExpression,
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return { buildId: claimResult.buildId, status: "completed", entityId: manifest.entityId, completedAt: now };
  }

  async function renew(claimResult) {
    const now = Math.floor(Date.now() / 1000);
    const leaseExpiresAt = now + Math.max(30, Number(leaseSeconds) || DEFAULT_LEASE_SECONDS);
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: claimResult.key },
      UpdateExpression: "SET #lease = :lease",
      ConditionExpression: "#status = :building AND #buildId = :buildId",
      ExpressionAttributeNames: {
        "#lease": "capabilityBuildLeaseExpiresAt",
        "#status": "capabilityBuildStatus",
        "#buildId": "capabilityBuildId",
      },
      ExpressionAttributeValues: {
        ":lease": leaseExpiresAt,
        ":building": "building",
        ":buildId": claimResult.buildId,
      },
    }));
    return leaseExpiresAt;
  }

  async function beginFinalization(claimResult, { jobId } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const finalizeToken = crypto.randomUUID();
    const finalizeLeaseExpiresAt = now + DEFAULT_FINALIZE_LEASE_SECONDS;
    try {
      await promiseOf(dynamodb.update({
        TableName: tableName,
        Key: { su: claimResult.key },
        UpdateExpression: "SET #token = :token, #finalizeLease = :finalizeLease, #jobId = :jobId",
        ConditionExpression: [
          "#status = :building",
          "#buildId = :buildId",
          "(attribute_not_exists(#finalizeLease) OR #finalizeLease < :now)",
        ].join(" AND "),
        ExpressionAttributeNames: {
          "#status": "capabilityBuildStatus",
          "#buildId": "capabilityBuildId",
          "#token": "capabilityBuildFinalizeToken",
          "#finalizeLease": "capabilityBuildFinalizeLeaseExpiresAt",
          "#jobId": "capabilityBuildBackgroundJobId",
        },
        ExpressionAttributeValues: {
          ":building": "building",
          ":buildId": claimResult.buildId,
          ":token": finalizeToken,
          ":finalizeLease": finalizeLeaseExpiresAt,
          ":now": now,
          ":jobId": String(jobId || ""),
        },
      }));
      return { acquired: true, finalizeToken, finalizeLeaseExpiresAt };
    } catch (error) {
      if (error?.code !== "ConditionalCheckFailedException" && error?.name !== "ConditionalCheckFailedException") {
        throw error;
      }
      return { acquired: false, record: await get(claimResult) };
    }
  }

  async function releaseFinalization(claimResult) {
    if (!claimResult?.finalizeToken) return false;
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: claimResult.key },
      UpdateExpression: "REMOVE #token, #finalizeLease",
      ConditionExpression: "#status = :building AND #buildId = :buildId AND #token = :token",
      ExpressionAttributeNames: {
        "#status": "capabilityBuildStatus",
        "#buildId": "capabilityBuildId",
        "#token": "capabilityBuildFinalizeToken",
        "#finalizeLease": "capabilityBuildFinalizeLeaseExpiresAt",
      },
      ExpressionAttributeValues: {
        ":building": "building",
        ":buildId": claimResult.buildId,
        ":token": claimResult.finalizeToken,
      },
    }));
    return true;
  }

  async function fail(claimResult, code = "BUILD_FAILED", message = "") {
    const now = new Date().toISOString();
    const names = {
      "#status": "capabilityBuildStatus",
      "#code": "capabilityBuildErrorCode",
      "#message": "capabilityBuildErrorMessage",
      "#completed": "capabilityBuildCompletedAt",
      "#lease": "capabilityBuildLeaseExpiresAt",
    };
    const values = {
      ":status": "failed",
      ":code": String(code || "BUILD_FAILED").slice(0, 120),
      ":message": cleanFailureMessage(message),
      ":completed": now,
      ":lease": 0,
    };
    let condition;
    if (claimResult?.record) {
      names["#buildId"] = "capabilityBuildId";
      values[":building"] = "building";
      values[":buildId"] = claimResult.buildId;
      condition = "#status = :building AND #buildId = :buildId";
      if (claimResult.finalizeToken) {
        names["#finalizeToken"] = "capabilityBuildFinalizeToken";
        values[":finalizeToken"] = claimResult.finalizeToken;
        condition += " AND #finalizeToken = :finalizeToken";
      }
    }
    await promiseOf(dynamodb.update({
      TableName: tableName,
      Key: { su: claimResult.key },
      UpdateExpression: "SET #status = :status, #code = :code, #message = :message, #completed = :completed, #lease = :lease",
      ...(condition ? { ConditionExpression: condition } : {}),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  }

  return {
    identity,
    get,
    claim,
    renew,
    beginFinalization,
    releaseFinalization,
    complete,
    fail,
  };
}

module.exports = {
  DEFAULT_FINALIZE_LEASE_SECONDS,
  MAX_BUILD_ARTIFACT_BYTES,
  boundedBuildArtifacts,
  stableHash,
  cleanFailureMessage,
  failureReason,
  createCapabilityBuildCoordinator,
};
