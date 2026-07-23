"use strict";

const {
  CapabilityError,
  buildExecutionError,
  buildExecutionSuccess,
  validateInvocationInputs,
  validateOperationResult,
} = require("../capabilityManifest");
const { createCapabilityRegistry } = require("../capabilityRegistry");
const { createProtectedAssetBroker } = require("../protectedAssetBroker");

function requestObject(req) {
  const body = req && typeof req.body === "object" && req.body ? req.body : {};
  return body.body && typeof body.body === "object" && body.body ? body.body : body;
}

function principalFor(ctx, manifest) {
  const user = ctx?.cookie?.e ?? ctx?.req?.cookies?.e ?? null;
  if (user != null && String(user) !== "0") return `u:${String(user)}`;
  return String(manifest?.ownerId || "system");
}

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

function protectedProvider(operation) {
  const requirement = operation?.protectedAssetRequirements?.[0];
  return requirement ? {
    name: requirement.providerName || requirement.providerId || "The provider",
    host: requirement.providerHost || "",
  } : null;
}

function normalizeProviderExecutionError(error, operation) {
  if (error instanceof CapabilityError || error?.name === "ProtectedAssetError") return error;
  const provider = protectedProvider(operation);
  const status = Number(error?.response?.status || error?.status || 0);
  const providerFailure = !!provider && (
    error?.isAxiosError === true
    || (Number.isFinite(status) && status > 0)
    || ["ECONNABORTED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(String(error?.code || "").toUpperCase())
  );
  if (!providerFailure) return error;
  const details = { provider: provider.name, providerHost: provider.host || null, status: status || null };
  if ([401, 403].includes(status)) {
    return new CapabilityError("PROVIDER_CREDENTIAL_REJECTED", `${provider.name} rejected the protected credential.`, details);
  }
  if (status === 404) return new CapabilityError("PROVIDER_REQUEST_REJECTED", `${provider.name} could not find data for that request.`, details);
  if (status === 429) return new CapabilityError("RATE_LIMITED", `${provider.name} is temporarily rate limiting requests.`, details);
  if (status >= 500 || !status) return new CapabilityError("PROVIDER_UNAVAILABLE", `${provider.name} could not complete the request.`, details);
  return new CapabilityError("PROVIDER_REQUEST_REJECTED", `${provider.name} rejected the request with HTTP ${status}.`, details);
}

function validateEntityResult(operation, rawResult) {
  const transport = normalizeEntityTransportResult(operation, rawResult);
  try {
    return validateOperationResult(operation, transport);
  } catch (error) {
    const provider = protectedProvider(operation);
    if (provider && error instanceof CapabilityError && error.code === "INVALID_RESULT") {
      throw new CapabilityError("PROVIDER_RESPONSE_INVALID", `${provider.name} did not return usable data.`, {
        provider: provider.name,
        providerHost: provider.host || null,
      });
    }
    throw error;
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CapabilityError("EXECUTION_TIMEOUT", `Compute entity exceeded its ${timeoutMs}ms timeout`)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function kmsClient(shared) {
  if (shared?.deps?.kms) return shared.deps.kms;
  return shared?.deps?.AWS?.KMS
    ? new shared.deps.AWS.KMS({ region: process.env.AWS_REGION || "us-east-1" })
    : null;
}

function register({ on, use }) {
  const shared = use();
  const { getSub } = shared;
  const dynamodb = shared?.deps?.dynamodb || shared?.getDocClient?.();
  const registry = createCapabilityRegistry({ dynamodb });
  const broker = shared?.registry?.protectedAssetBroker || createProtectedAssetBroker({
    dynamodb,
    kms: kmsClient(shared),
    kmsKeyId: process.env.PROTECTED_ASSET_KMS_KEY_ID || "",
  });

  on("runEntity", async (ctx) => {
    const { req, res, path, next } = ctx;
    const actionFile = String(path || "").split("?")[0].split("/").filter(Boolean)[0] || "";
    const request = requestObject(req);
    const requestedOperationId = String(request.operationId || "").trim().toLowerCase();
    const requestedCapabilityId = String(request.capabilityId || "").trim().toLowerCase();
    let manifest = null;
    try {
      manifest = await registry.getByEntity(actionFile, { includeInactive: true });
    } catch (error) {
      if (requestedCapabilityId) {
        return buildExecutionError(new CapabilityError("REGISTRY_UNAVAILABLE", "The capability registry is unavailable."), {
          capabilityId: requestedCapabilityId,
          operationId: requestedOperationId,
          entityId: actionFile,
        });
      }
    }

    if (!manifest) {
      if (requestedCapabilityId || requestedOperationId) {
        return buildExecutionError(new CapabilityError("CAPABILITY_NOT_FOUND", `No capability is registered for entity ${actionFile}`), {
          capabilityId: requestedCapabilityId || null,
          operationId: requestedOperationId || null,
          entityId: actionFile,
        });
      }
      return runLegacyEntity({ getSub, actionFile, req, res, next, capabilityInvocation: null });
    }

    const context = {
      capabilityId: manifest.capabilityId,
      operationId: requestedOperationId || null,
      entityId: manifest.entityId,
      version: manifest.version,
    };
    let protectedUse = null;
    try {
      if (requestedCapabilityId && requestedCapabilityId !== manifest.capabilityId) {
        throw new CapabilityError("CAPABILITY_MISMATCH", `Entity ${actionFile} is registered as ${manifest.capabilityId}`);
      }
      if (manifest.status !== "active") throw new CapabilityError("ENTITY_DISABLED", `Capability ${manifest.capabilityId} is ${manifest.status}`);
      const operationId = requestedOperationId || manifest.operations[0]?.operationId;
      context.operationId = operationId || null;
      const { operation, inputs } = validateInvocationInputs(manifest, operationId, request.inputs);
      const requirements = operation.protectedAssetRequirements || [];
      if (requirements.length) {
        protectedUse = await broker.resolveCapabilityBindings({
          manifest,
          operation,
          references: request.protectedAssets,
          ownerId: principalFor(ctx, manifest),
          approvedRequirements: Array.isArray(request.approvedProtectedAssets) ? request.approvedProtectedAssets : [],
          unattended: request.unattended === true,
        });
      }
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
            protectedAssetBindings: protectedUse?.bindings || null,
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
            protectedAssetBindings: protectedUse?.bindings || null,
          });
      const rawResult = await withTimeout(executionPromise, manifest.execution.timeoutMs);
      return buildExecutionSuccess({
        manifest,
        operation,
        result: validateEntityResult(operation, rawResult),
        source: "compute-entity",
      });
    } catch (error) {
      const normalized = normalizeProviderExecutionError(
        error,
        manifest?.operations?.find((item) => item.operationId === context.operationId)
      );
      console.error("compute capability execution failed", {
        entityId: actionFile,
        capabilityId: manifest.capabilityId,
        operationId: context.operationId,
        code: normalized?.code || "EXECUTION_FAILED",
      });
      return buildExecutionError(normalized, context);
    } finally {
      protectedUse?.dispose?.();
    }
  });
  return { name: "runEntity" };
}

async function runLegacyEntity({
  getSub,
  actionFile,
  req,
  res,
  next,
  capabilityInvocation,
  protectedAssetBindings = null,
}) {
  const subBySU = await getSub(actionFile, "su");
  const out = subBySU.Items?.[0]?.output;
  if (!capabilityInvocation && out != null && out !== "") return out;
  const rawBody = req && typeof req.body === "object" && req.body ? req.body : {};
  const fromBodyHeaders = rawBody.headers || rawBody.body?.headers || undefined;
  const mergedHeaders = { ...(req?.headers || {}), ...(fromBodyHeaders || {}) };
  const getHeader = (name) => mergedHeaders[name] ?? mergedHeaders[String(name).toLowerCase()];
  const invocationBody = capabilityInvocation ? {
    ...rawBody,
    body: capabilityInvocation.inputs,
    inputs: capabilityInvocation.inputs,
    capabilityId: capabilityInvocation.capabilityId,
    operationId: capabilityInvocation.operationId,
    capabilityVersion: capabilityInvocation.version,
    _isFunction: true,
  } : rawBody;
  const reqLite = {
    method: req?.method,
    path: req?.path,
    originalUrl: req?.originalUrl || req?.path,
    type: req?.type,
    _headerSent: req?._headerSent ?? res?.headersSent ?? false,
    body: {
      ...invocationBody,
      headers: {
        ...(fromBodyHeaders || {}),
        "X-Original-Host": getHeader("X-Original-Host") || "",
        "x-original-host": getHeader("X-Original-Host") || "",
        "X-accessToken": getHeader("X-accessToken") || "",
        "x-accesstoken": getHeader("X-accessToken") || "",
      },
    },
    // This non-transport slot is installed into the entity root context by
    // app.js. It is never merged into body or serialized.
    protectedAssetBindings,
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

module.exports = {
  register,
  normalizeEntityTransportResult,
  normalizeProviderExecutionError,
  validateEntityResult,
};
