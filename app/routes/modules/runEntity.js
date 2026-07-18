// modules/runEntity.js
"use strict";

const {
  CapabilityError,
  buildExecutionError,
  buildExecutionSuccess,
  validateInvocationInputs,
  validateOperationResult,
} = require("../capabilityManifest");
const { createCapabilityRegistry } = require("../capabilityRegistry");

function requestObject(req) {
  const body = req && typeof req.body === "object" && req.body ? req.body : {};
  return body.body && typeof body.body === "object" && body.body ? body.body : body;
}

// Generated Shorthand entities substitute provider values into response
// templates. Scalar numbers therefore cross this boundary as strings even
// when the provider returned JSON numbers. Normalize only strict numeric
// scalars declared as numeric outputs; all other values remain untouched and
// are rejected by the manifest validator below.
function normalizeEntityTransportResult(operation, rawResult) {
  let result = rawResult;
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch (_) {}
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;

  const normalized = { ...result };
  for (const field of operation?.outputs || []) {
    const value = normalized[field.name];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (field.type === "number" && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) {
      const number = Number(text);
      if (Number.isFinite(number)) normalized[field.name] = number;
    } else if (field.type === "integer" && /^[-+]?\d+$/.test(text)) {
      const integer = Number(text);
      if (Number.isSafeInteger(integer)) normalized[field.name] = integer;
    }
  }
  return normalized;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new CapabilityError("EXECUTION_TIMEOUT", `Compute entity exceeded its ${timeoutMs}ms timeout`));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function register({ on, use }) {
  const shared = use();
  const { getSub } = shared;
  const dynamodb = shared?.deps?.dynamodb || shared?.getDocClient?.();
  const registry = createCapabilityRegistry({ dynamodb });

  on("runEntity", async (ctx) => {
    const { req, res, path, next } = ctx;

    // First segment after /runEntity/ is the generated entity id.
    const segs = String(path || "").split("?")[0].split("/").filter(Boolean);
    const actionFile = segs[0] || "";
    const request = requestObject(req);
    const requestedOperationId = String(request.operationId || "").trim().toLowerCase();
    const requestedCapabilityId = String(request.capabilityId || "").trim().toLowerCase();

    let manifest = null;
    try {
      manifest = await registry.getByEntity(actionFile, { includeInactive: true });
    } catch (error) {
      if (requestedCapabilityId) {
        return buildExecutionError(
          new CapabilityError("REGISTRY_UNAVAILABLE", "The capability registry is unavailable."),
          { capabilityId: requestedCapabilityId, operationId: requestedOperationId, entityId: actionFile }
        );
      }
      // A legacy entity must remain runnable even if capability metadata cannot be read.
      manifest = null;
    }

    // Keep legacy behavior for entities that have not opted into the capability contract.
    if (!manifest) {
      if (requestedCapabilityId || requestedOperationId) {
        return buildExecutionError(
          new CapabilityError("CAPABILITY_NOT_FOUND", `No capability is registered for entity ${actionFile}`),
          { capabilityId: requestedCapabilityId || null, operationId: requestedOperationId || null, entityId: actionFile }
        );
      }
      return runLegacyEntity({ getSub, actionFile, req, res, next, capabilityInvocation: null });
    }

    const context = {
      capabilityId: manifest.capabilityId,
      operationId: requestedOperationId || null,
      entityId: manifest.entityId,
      version: manifest.version,
    };

    try {
      if (requestedCapabilityId && requestedCapabilityId !== manifest.capabilityId) {
        throw new CapabilityError(
          "CAPABILITY_MISMATCH",
          `Entity ${actionFile} is registered as ${manifest.capabilityId}, not ${requestedCapabilityId}`
        );
      }
      if (manifest.status !== "active") {
        throw new CapabilityError("ENTITY_DISABLED", `Capability ${manifest.capabilityId} is ${manifest.status}`);
      }

      const operationId = requestedOperationId || manifest.operations[0]?.operationId;
      context.operationId = operationId || null;
      const { operation, inputs } = validateInvocationInputs(manifest, operationId, request.inputs);

      // Capability entities always execute. The legacy subdomains.output field is a
      // discovery label for generated entities and must not be mistaken for a live result.
      const capabilityInvocation = {
        capabilityId: manifest.capabilityId,
        operationId: operation.operationId,
        version: manifest.version,
        inputs,
      };
      const executionPromise = typeof shared.runComputeEntity === "function"
        ? shared.runComputeEntity({
            entityId: actionFile,
            manifest,
            operation,
            inputs,
            req,
            res,
            next,
          })
        : runLegacyEntity({
            getSub,
            actionFile,
            req,
            res,
            next,
            capabilityInvocation,
          });
      const rawResult = await withTimeout(
        executionPromise,
        manifest.execution.timeoutMs
      );
      const transportResult = normalizeEntityTransportResult(operation, rawResult);
      const result = validateOperationResult(operation, transportResult);
      return buildExecutionSuccess({
        manifest,
        operation,
        result,
        source: "compute-entity",
      });
    } catch (error) {
      console.error("compute capability execution failed", {
        entityId: actionFile,
        capabilityId: manifest.capabilityId,
        operationId: context.operationId,
        code: error?.code || "EXECUTION_FAILED",
      });
      return buildExecutionError(error, context);
    }
  });

  return { name: "runEntity" };
}

async function runLegacyEntity({ getSub, actionFile, req, res, next, capabilityInvocation }) {
  const subBySU = await getSub(actionFile, "su");
  const out = subBySU.Items?.[0]?.output;

  // Preserve precomputed-output behavior for legacy callers only.
  if (!capabilityInvocation && out != null && out !== "") return out;

  const rawBody = req && typeof req.body === "object" && req.body ? req.body : {};
  const fromBodyHeaders =
    rawBody.headers ||
    (rawBody.body && rawBody.body.headers) ||
    undefined;

  const mergedHeaders = Object.assign({}, req?.headers || {});
  if (fromBodyHeaders && typeof fromBodyHeaders === "object") {
    for (const [key, value] of Object.entries(fromBodyHeaders)) {
      mergedHeaders[key] = value;
      mergedHeaders[key.toLowerCase()] = value;
    }
  }

  const getHeader = (name) => {
    if (!name) return undefined;
    const lower = String(name).toLowerCase();
    return mergedHeaders[name] ?? mergedHeaders[lower];
  };
  const xOriginalHost = getHeader("X-Original-Host") || "";
  const xAccessTokenHeader =
    getHeader("X-accessToken") ||
    getHeader("x-accessToken") ||
    getHeader("x-accesstoken") ||
    "";

  const invocationBody = capabilityInvocation
    ? {
        ...rawBody,
        body: capabilityInvocation.inputs,
        inputs: capabilityInvocation.inputs,
        capabilityId: capabilityInvocation.capabilityId,
        operationId: capabilityInvocation.operationId,
        capabilityVersion: capabilityInvocation.version,
        _isFunction: true,
      }
    : rawBody;

  const bodyForLegacy = {
    ...invocationBody,
    headers: {
      ...(fromBodyHeaders || {}),
      "X-Original-Host": xOriginalHost,
      "x-original-host": xOriginalHost,
      "X-accessToken": xAccessTokenHeader,
      "x-accesstoken": xAccessTokenHeader,
    },
  };

  const reqLite = {
    method: req?.method,
    path: req?.path,
    originalUrl: req?.originalUrl || req?.path,
    type: req?.type,
    _headerSent: req?._headerSent ?? res?.headersSent ?? false,
    body: bodyForLegacy,
    headers: mergedHeaders,
    get: getHeader,
    cookies: req?.cookies || {},
    query: req?.query || {},
    params: req?.params || {},
  };

  const { runApp } = require("../../app");
  const execution = await runApp(reqLite, res, next);
  if (execution) execution.existing = true;
  return execution?.chainParams;
}

module.exports = { register, normalizeEntityTransportResult };
