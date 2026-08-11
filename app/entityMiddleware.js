/**
 * Platform: Runs authorized entity middleware from root to target with first-response termination.
 * Technical: Enforces a versioned pass/respond/fail protocol, per-node checks, cancellation, and bounded traces.
 */
"use strict";

class MiddlewareError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MiddlewareError";
    this.code = code;
    this.details = details;
  }
}

const EFFECT_TYPES = new Set([
  "read", "write", "network", "communication", "navigation", "automation", "governance", "presentation",
]);

function decision(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MiddlewareError("MIDDLEWARE_RESULT_INVALID", "Middleware must return a decision object");
  }
  if (raw.contractVersion !== 1 || raw.recordType !== "entity-middleware-decision") {
    throw new MiddlewareError("MIDDLEWARE_DECISION_CONTRACT_INVALID", "Middleware decision contractVersion 1 is required");
  }
  const disposition = String(raw.disposition || "").toLowerCase();
  if (!["pass", "respond", "fail"].includes(disposition)) {
    throw new MiddlewareError("MIDDLEWARE_DISPOSITION_INVALID", `Unknown middleware disposition '${disposition}'`);
  }
  if (disposition === "respond" && !Object.hasOwn(raw, "result")) {
    throw new MiddlewareError("MIDDLEWARE_RESPONSE_REQUIRED", "A responding middleware must provide result");
  }
  if (disposition === "fail" && !raw.error?.code) {
    throw new MiddlewareError("MIDDLEWARE_ERROR_REQUIRED", "A failing middleware must provide a coded error");
  }
  const effects = Array.isArray(raw.effects) ? raw.effects : [];
  if (effects.length > 128 || effects.some((effect) => !effect || !EFFECT_TYPES.has(effect.type))) {
    throw new MiddlewareError("MIDDLEWARE_EFFECT_INVALID", "Middleware returned an undeclared effect type");
  }
  return {
    disposition,
    ...(Object.hasOwn(raw, "result") ? { result: raw.result } : {}),
    ...(raw.error ? { error: { code: String(raw.error.code), message: String(raw.error.message || "") } } : {}),
    effects,
  };
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new MiddlewareError("MIDDLEWARE_CANCELLED", "Middleware invocation was cancelled");
}

async function runEntityMiddleware({ invocation, lineage, authorize, invoke, signal, observe }) {
  if (!invocation || invocation.contractVersion !== 1
    || invocation.recordType !== "entity-middleware-invocation") {
    throw new MiddlewareError("MIDDLEWARE_CONTRACT_UNSUPPORTED", "Entity middleware contractVersion 1 is required");
  }
  if (!invocation.invocationId || !invocation.targetEntityId || !invocation.principal?.principalId
    || !Object.hasOwn(invocation, "input")) {
    throw new MiddlewareError("MIDDLEWARE_INVOCATION_INVALID", "Invocation identity, principal, target, and input are required");
  }
  if (!Array.isArray(lineage) || !lineage.length || lineage.length > 64) {
    throw new MiddlewareError("MIDDLEWARE_LINEAGE_REQUIRED", "Root-to-target lineage is required");
  }
  if (String(lineage[lineage.length - 1]?.entityId || "") !== String(invocation.targetEntityId)) {
    throw new MiddlewareError("MIDDLEWARE_TARGET_MISMATCH", "Lineage must terminate at the invoked target");
  }
  if (typeof authorize !== "function" || typeof invoke !== "function") {
    throw new TypeError("authorize and invoke functions are required");
  }
  const trace = [];
  const effects = [];
  for (let index = 0; index < lineage.length; index += 1) {
    abortIfNeeded(signal);
    const node = lineage[index];
    const entityId = String(node?.entityId || "").trim();
    if (!entityId || !Number.isInteger(node?.entityVersion) || node.entityVersion < 1) {
      throw new MiddlewareError("MIDDLEWARE_ENTITY_REQUIRED", "Each lineage node needs entityId and entityVersion");
    }
    const startedAt = Date.now();
    const auth = await authorize({ action: "execute", entityId, node, invocation });
    if (!auth?.allowed) {
      const result = { contractVersion: 1, recordType: "entity-middleware-result", disposition: "fail", effects, error: {
        code: String(auth?.code || "MIDDLEWARE_FORBIDDEN"), message: "Entity execution is not authorized",
      }, trace };
      observe?.({ entityId, index, disposition: "fail", durationMs: Date.now() - startedAt });
      return result;
    }
    const input = Object.freeze({
      contractVersion: 1, invocationId: String(invocation.invocationId),
      entityId, index, targetEntityId: String(lineage[lineage.length - 1].entityId),
      principal: invocation.principal, input: invocation.input, context: invocation.context || {},
    });
    const result = decision(await invoke(input, node));
    effects.push(...result.effects);
    const event = { entityId, index, disposition: result.disposition, durationMs: Date.now() - startedAt };
    trace.push(event);
    observe?.(event);
    if (result.disposition !== "pass") {
      return { contractVersion: 1, recordType: "entity-middleware-result", disposition: result.disposition, effects, trace,
        ...(Object.hasOwn(result, "result") ? { result: result.result } : {}),
        ...(result.error ? { error: result.error } : {}) };
    }
  }
  return { contractVersion: 1, recordType: "entity-middleware-result", disposition: "pass", effects, trace };
}

module.exports = { MiddlewareError, runEntityMiddleware };
