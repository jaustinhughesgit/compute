"use strict";

const { CapabilityError, validateCapabilityManifest } = require("../capabilityManifest");
const { createCapabilityRegistry } = require("../capabilityRegistry");
const { listCapabilityBlueprints } = require("../capabilityBlueprints");
const { discoverComputeCapability } = require("../capabilityDiscovery");
const { interpretCapabilityInput } = require("../capabilityInputInterpretation");

function bodyObject(req) {
  const body = req?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body.body && typeof body.body === "object" && !Array.isArray(body.body) ? body.body : body;
}
function principalFor(ctx) {
  const e = ctx?.cookie?.e ?? ctx?.req?.cookies?.e ?? null;
  return e != null && String(e) !== "0" ? `u:${String(e)}` : "system";
}
function routeError(error) {
  const known = error instanceof CapabilityError;
  return {
    ok: false,
    kind: "capabilityRegistryError",
    error: {
      code: known ? error.code : "REGISTRY_FAILED",
      message: known ? error.message : "Capability registry operation failed.",
      details: known ? error.details : null,
    },
  };
}

function register({ on, use }) {
  const shared = use();
  const dynamodb = shared?.deps?.dynamodb || shared?.getDocClient?.();
  const registry = createCapabilityRegistry({ dynamodb });
  on("capabilities", async (ctx) => {
    try {
      const segments = String(ctx?.path || "").split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
      const action = String(segments.shift() || "").toLowerCase();
      const body = bodyObject(ctx?.req);
      const ownerId = principalFor(ctx);
      if (action === "blueprints") return { ok: true, kind: "capabilityBlueprints", blueprints: listCapabilityBlueprints() };
      if (action === "discover") {
        const availableCapabilities = await registry.listAvailable({ activeOnly: false, limit: 100, ownerId });
        const discovery = await discoverComputeCapability({
          openai: shared?.deps?.openai,
          utterance: body.utterance || body.userRequest || "",
          requestedBy: ownerId,
          useModel: body.deterministicOnly !== true,
          availableCapabilities,
        });
        return { ok: true, kind: "capabilityDiscovery", discovery };
      }
      if (action === "interpret-input") {
        // This endpoint is for non-sensitive ordinary inputs only. Protected
        // values must use the browser Protected Asset collection flow.
        if (body.field?.sensitive || body.field?.credential || body.field?.protectedAsset) {
          throw new CapabilityError(
            "PROTECTED_ASSET_COLLECTION_REQUIRED",
            "Protected values may not be interpreted by the language model"
          );
        }
        const interpretation = await interpretCapabilityInput({
          openai: shared?.deps?.openai,
          field: body.field,
          originalQuestion: body.originalQuestion,
          previousQuestion: body.previousQuestion,
          userResponse: body.userResponse,
          attempt: body.attempt,
        });
        return { ok: true, kind: "capabilityInputInterpretationResult", interpretation };
      }
      if (action === "register") {
        const manifest = validateCapabilityManifest(body.manifest || body, { ownerId });
        return { ok: true, kind: "capabilityRegistered", manifest: await registry.register(manifest, { ownerId }) };
      }
      if (action === "get") {
        const entityId = String(segments[0] || body.entityId || "").trim();
        const manifest = await registry.getByEntity(entityId, { includeInactive: true });
        if (!manifest) throw new CapabilityError("CAPABILITY_NOT_FOUND", `No capability is registered for entity ${entityId}`);
        return { ok: true, kind: "capabilityManifest", manifest };
      }
      if (action === "find") {
        const capabilityId = String(segments.join("/") || body.capabilityId || "").trim();
        return {
          ok: true,
          kind: "capabilityMatches",
          capabilityId,
          manifests: await registry.findByCapability(capabilityId, {
            activeOnly: body.includeInactive !== true,
            limit: Number(body.limit || 25),
            ownerId,
          }),
        };
      }
      if (["activate", "disable", "testing", "fail"].includes(action)) {
        const entityId = String(segments[0] || body.entityId || "").trim();
        const status = action === "activate" ? "active" : action === "disable" ? "disabled" : action === "fail" ? "failed" : "testing";
        return { ok: true, kind: "capabilityStatusChanged", manifest: await registry.setStatus(entityId, status, { ownerId }) };
      }
      return {
        ok: true,
        kind: "capabilityRegistryHelp",
        actions: ["register", "blueprints", "discover", "interpret-input", "get/:entityId", "find/:capabilityId", "activate/:entityId", "disable/:entityId", "testing/:entityId", "fail/:entityId"],
      };
    } catch (error) {
      console.error("capability registry error", { code: error?.code || "REGISTRY_FAILED" });
      return routeError(error);
    }
  });
  return { name: "capabilities" };
}

module.exports = { register };
