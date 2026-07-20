"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  GENERIC_BLUEPRINT_ID,
  buildComputeEntitySpec,
  validateTrustedImplementation,
  isBlockedHostname,
} = require("../app/routes/capabilityBlueprints");
const { discoverComputeCapability, summarizeCapabilities } = require("../app/routes/capabilityDiscovery");
const { validateCapabilityManifest } = require("../app/routes/capabilityManifest");
const { validateCapabilityBuildRequest } = require("../app/routes/capabilityManifest");
const { buildCapabilityPathDataset } = require("../app/routes/capabilityPaths");

const genericRequest = {
  schemaVersion: 1,
  kind: "computeCapabilityBuild",
  capabilityIdHint: "environment.conditions.lookup",
  name: "Conditions lookup",
  requestedBy: "u:7",
  description: "Returns observed or predicted conditions for a requested place and date.",
  operations: [{
    operationId: "lookup",
    description: "Look up conditions.",
    inputs: [
      {
        name: "location_code",
        type: "string",
        required: true,
        bindingHint: { source: "contextdb", subject: "speaker", property: "location_code", aliases: ["home location"] },
        clarification: "What location code should I use?",
      },
      {
        name: "date",
        type: "date",
        required: true,
        bindingHint: { source: "environment", resolver: "relative_date" },
      },
    ],
    outputs: [{ name: "summary", type: "string", required: true }],
    freshness: { mode: "cache", ttlSeconds: 900 },
    utteranceExamples: ["What are the conditions today?"],
    answerTemplate: "{{summary}}",
  }],
};

const generatedImplementation = {
  name: "Conditions lookup",
  provider: "public-provider",
  published: {
    modules: { axios: "axios" },
    actions: [
      {
        target: "{|axios|}",
        chain: [{ access: "get", params: ["https://api.example.com/conditions", { params: { place: "{|req=>body.location_code|}", date: "{|req=>body.date|}" } }] }],
        assign: "{|providerResponse|}",
      },
      {
        target: "{|res|}!",
        chain: [{ access: "send", params: [{ summary: "{|providerResponse=>data.summary|}" }] }],
      },
    ],
    data: {},
  },
};

function modelReturning(value) {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) } },
  };
}

test("generic entity builder derives the manifest from the model-declared contract", async () => {
  const spec = await buildComputeEntitySpec({
    capabilityRequest: genericRequest,
    requestedBy: "u:7",
    originalUtterance: "Look up conditions.",
    generatedImplementation,
  });
  assert.equal(spec.computeEntity.blueprintId, GENERIC_BLUEPRINT_ID);
  assert.equal(spec.computeEntity.capabilityId, genericRequest.capabilityIdHint);
  assert.equal(spec.computeEntity.manifest.operations[0].inputs[0].bindingHint.property, "location_code");
  assert.deepEqual(spec.computeEntity.manifest.operations[0].inputs[0].bindingHint.aliases, ["home location"]);
  assert.deepEqual(spec.computeEntity.published.data.allowedHosts, ["api.example.com"]);
  assert.equal(JSON.stringify(spec).includes("function"), false);
});

test("generic entity builder repairs one invalid declarative implementation", async () => {
  let calls = 0;
  const openai = {
    chat: { completions: { create: async () => {
      calls += 1;
      const value = calls === 1
        ? {
            name: "Conditions lookup",
            provider: "invalid",
            published: {
              modules: { axios: "axios" },
              actions: [
                { target: "{|axios|}", chain: [{ access: "get", params: ["https://127.0.0.1/data", {}] }], assign: "{|x|}" },
                { target: "{|res|}!", chain: [{ access: "send", params: [{ summary: "{|x|}" }] }] },
              ],
            },
          }
        : generatedImplementation;
      return { choices: [{ message: { content: JSON.stringify(value) } }] };
    } } },
  };
  const spec = await buildComputeEntitySpec({
    capabilityRequest: genericRequest,
    requestedBy: "u:7",
    originalUtterance: "Look up conditions.",
    openai,
  });
  assert.equal(calls, 2);
  assert.equal(spec.computeEntity.capabilityId, genericRequest.capabilityIdHint);
});

test("semantic utterance examples annotate values without prescribing browser tokens", () => {
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "color.code.lookup",
    entityId: "color-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    description: "Looks up a color code.",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: [{
      operationId: "lookup",
      inputs: [{ name: "color", type: "string", required: true, bindingHint: { source: "utterance", resolver: "color" } }],
      outputs: [{ name: "code", type: "string", required: true }],
      utteranceExamples: [{ text: "What is the code for purple?", inputs: { color: "purple" } }],
      answerTemplate: "{{code}}",
    }],
  });
  assert.deepEqual(manifest.operations[0].utteranceExamples[0], {
    text: "What is the code for purple?",
    inputs: { color: "purple" },
  });
  assert.equal(JSON.stringify(manifest).includes("pattern"), false);
});

test("required spoken inputs cannot be published without a learnable semantic example", () => {
  assert.throws(() => validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "color.code.lookup",
    entityId: "color-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: [{
      operationId: "lookup",
      inputs: [{ name: "color", type: "string", required: true, bindingHint: { source: "utterance" } }],
      outputs: [{ name: "code", type: "string", required: true }],
      utteranceExamples: ["What is the code for a color?"],
    }],
  }), /annotated utterance example for input color/);
});

test("model-generated human labels are canonicalized across the semantic contract", () => {
  const request = validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "Environment Conditions Lookup",
    description: "Look up conditions.",
    operations: [{
      operationId: "Current Conditions",
      inputs: [{ name: "Location Code", type: "string", required: true, bindingHint: { source: "utterance" } }],
      outputs: [{ name: "Condition Summary", type: "string", required: true }],
      utteranceExamples: [{ text: "Conditions for ABC?", inputs: { "Location Code": "ABC" } }],
      answerTemplate: "{{Condition Summary}}",
    }],
  });
  assert.equal(request.capabilityIdHint, "environment_conditions_lookup");
  assert.equal(request.operations[0].operationId, "current_conditions");
  assert.equal(request.operations[0].inputs[0].name, "location_code");
  assert.deepEqual(request.operations[0].utteranceExamples[0].inputs, { location_code: "ABC" });
  assert.equal(request.operations[0].answerTemplate, "{{condition_summary}}");
});

test("generic network validation rejects private, credentialed, and dynamic provider targets", () => {
  assert.equal(isBlockedHostname("127.0.0.1"), true);
  assert.equal(isBlockedHostname("169.254.169.254"), true);
  assert.throws(() => validateTrustedImplementation({ published: {
    modules: { axios: "axios" },
    actions: [
      { target: "{|axios|}", chain: [{ access: "get", params: ["https://127.0.0.1/data", {}] }], assign: "{|x|}" },
      { target: "{|res|}!", chain: [{ access: "send", params: [{}] }] },
    ],
  } }), /unsafe provider URL/);
  assert.throws(() => validateTrustedImplementation({ published: {
    modules: { axios: "axios" },
    actions: [
      { target: "{|axios|}", chain: [{ access: "get", params: ["{|req=>body.url|}", {}] }], assign: "{|x|}" },
      { target: "{|res|}!", chain: [{ access: "send", params: [{}] }] },
    ],
  } }), /literal public HTTPS/);
});

test("discovery can propose any validated entity contract without a catalog", async () => {
  const discovery = await discoverComputeCapability({
    openai: modelReturning({
      decision: "build_compute",
      confidence: 0.96,
      reason: "Fresh external data is required.",
      capabilityId: genericRequest.capabilityIdHint,
      operationId: "lookup",
      capabilityRequest: genericRequest,
    }),
    utterance: "Look up the conditions.",
    requestedBy: "u:7",
  });
  assert.equal(discovery.decision, "build");
  assert.equal(discovery.buildCommand.blueprintId, GENERIC_BLUEPRINT_ID);
  assert.equal(discovery.buildCommand.capabilityRequest.capabilityIdHint, genericRequest.capabilityIdHint);
  assert.equal(JSON.stringify(discovery).includes("https://"), false);
});

test("discovery compacts duplicate entity records before calling the model", () => {
  const manifests = Array.from({ length: 60 }, (_, index) => ({
    capabilityId: index < 50 ? "duplicate.lookup" : `unique.${index}`,
    entityId: `entity-${index}`,
    version: index + 1,
    status: index === 49 ? "active" : "testing",
    description: "x".repeat(1000),
    operations: [],
  }));
  const summarized = summarizeCapabilities(manifests);
  assert.equal(summarized.filter((item) => item.capabilityId === "duplicate.lookup").length, 1);
  assert.equal(summarized.find((item) => item.capabilityId === "duplicate.lookup").entityId, "entity-49");
  assert.ok(summarized.length <= 30);
  assert.equal(summarized[0].description.length <= 600, true);
});

test("discovery repairs one invalid model contract before failing closed", async () => {
  let calls = 0;
  const openai = {
    chat: { completions: { create: async () => {
      calls += 1;
      const value = calls === 1
        ? { decision: "make_something" }
        : { decision: "build_compute", confidence: 0.9, reason: "Lookup required.", capabilityRequest: genericRequest };
      return { choices: [{ message: { content: JSON.stringify(value) } }] };
    } } },
  };
  const discovery = await discoverComputeCapability({
    openai,
    utterance: "Look up conditions.",
    requestedBy: "u:7",
  });
  assert.equal(calls, 2);
  assert.equal(discovery.decision, "build");
});

test("discovery identifies an existing entity that should be extended", async () => {
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: genericRequest.capabilityIdHint,
    entityId: "entity-1",
    version: 1,
    status: "active",
    ownerId: "u:7",
    description: genericRequest.description,
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: genericRequest.operations,
  });
  const discovery = await discoverComputeCapability({
    openai: modelReturning({
      decision: "extend_existing",
      confidence: 0.99,
      reason: "The same entity owns the requested behavior but lacks this utterance and date behavior.",
      capabilityId: manifest.capabilityId,
      entityId: manifest.entityId,
      operationId: "lookup",
      capabilityRequest: null,
    }),
    utterance: "Use a different supported date.",
    requestedBy: "u:7",
    availableCapabilities: [manifest],
  });
  assert.equal(discovery.decision, "extend");
  assert.equal(discovery.existingManifest.entityId, "entity-1");
  assert.equal(discovery.buildCommand, null);
});

test("discovery fails closed when a model attempts to reuse an inactive entity", async () => {
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: genericRequest.capabilityIdHint,
    entityId: "entity-disabled",
    version: 1,
    status: "disabled",
    ownerId: "u:7",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: genericRequest.operations,
  });
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};
  let discovery;
  try {
    discovery = await discoverComputeCapability({
      openai: modelReturning({
        decision: "reuse_existing",
        confidence: 1,
        capabilityId: manifest.capabilityId,
        entityId: manifest.entityId,
        operationId: "lookup",
      }),
      utterance: "Use it.",
      requestedBy: "u:7",
      availableCapabilities: [manifest],
    });
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.equal(discovery.decision, "not_compute");
  assert.equal(discovery.source, "model-error");
});

test("Compute no longer creates browser Path datasets or contains domain fixtures", () => {
  assert.equal(buildCapabilityPathDataset({}), null);
  const root = path.resolve(__dirname, "../app/routes");
  const files = [
    "capabilityBlueprints.js",
    "capabilityDiscovery.js",
    "capabilityManifest.js",
    "capabilityPaths.js",
  ];
  const combined = files.map((name) => fs.readFileSync(path.join(root, name), "utf8")).join("\n");
  for (const term of ["open-meteo", "weather.current_conditions", "register-weather", "WEATHER_CAPABILITY_ID"]) {
    assert.equal(combined.toLowerCase().includes(term.toLowerCase()), false, `unexpected domain fixture: ${term}`);
  }
});
