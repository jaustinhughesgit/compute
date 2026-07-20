"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  GENERIC_BLUEPRINT_ID,
  buildComputeEntitySpec,
  canonicalizeProviderUrls,
  validateTrustedImplementation,
  isBlockedHostname,
} = require("../app/routes/capabilityBlueprints");
const { discoverComputeCapability, summarizeCapabilities } = require("../app/routes/capabilityDiscovery");
const { validateCapabilityManifest, IMPLEMENTATION_POLICY_VERSION } = require("../app/routes/capabilityManifest");
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
  assert.equal(spec.computeEntity.manifest.implementationPolicyVersion, IMPLEMENTATION_POLICY_VERSION);
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

test("generic compiler moves dynamic URL query values into declarative axios params", () => {
  const compiled = canonicalizeProviderUrls({
    published: {
      modules: { axios: "axios" },
      actions: [{
        target: "{|axios|}",
        chain: [{
          access: "get",
          params: [
            "https://api.example.com/conditions?place={|req=>body.location_code|}&date={|req=>body.date|}",
            {},
          ],
        }],
        assign: "{|providerResponse|}",
      }, {
        target: "{|res|}!",
        chain: [{ access: "send", params: [{ summary: "{|providerResponse=>data.summary|}" }] }],
      }],
    },
  });
  const request = compiled.published.actions[0].chain[0].params;
  assert.equal(request[0], "https://api.example.com/conditions");
  assert.deepEqual(request[1], { params: {
    place: "{|req=>body.location_code|}",
    date: "{|req=>body.date|}",
  } });
  assert.doesNotThrow(() => validateTrustedImplementation(compiled));
});

test("generic compiler may inline a declared literal URL but never a dynamic destination", () => {
  const compiled = canonicalizeProviderUrls({
    published: {
      modules: { axios: "axios" },
      data: { providerUrl: "https://api.example.com/data" },
      actions: [
        { target: "{|axios|}", chain: [{ access: "get", params: ["{|providerUrl|}", {}] }], assign: "{|x|}" },
        { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|x=>data|}" }] }] },
      ],
    },
  });
  assert.equal(compiled.published.actions[0].chain[0].params[0], "https://api.example.com/data");
  assert.doesNotThrow(() => validateTrustedImplementation(compiled));
  assert.throws(() => validateTrustedImplementation(canonicalizeProviderUrls({ published: {
    modules: { axios: "axios" },
    actions: [
      { target: "{|axios|}", chain: [{ access: "get", params: ["https://api.example.com/{|req=>body.path|}", {}] }], assign: "{|x|}" },
      { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|x=>data|}" }] }] },
    ],
  } })), /literal public HTTPS provider URL/);
  assert.throws(() => validateTrustedImplementation({ published: {
    modules: { axios: "axios" },
    actions: [
      { target: "{|axios|}", chain: [{ access: "get", params: ["https://api.example.com/data", { params: { q: "${location}" } }] }], assign: "{|x|}" },
      { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|x=>data|}" }] }] },
    ],
  } }), /only declarative/);
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

test("single-brace templates and omitted clarifications are repaired generically", () => {
  const request = validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "Place Conditions",
    description: "Return conditions for a place.",
    operations: [{
      operationId: "Lookup",
      inputs: [{ name: "Place Name", type: "string", required: true, bindingHint: { source: "utterance" } }],
      outputs: [{ name: "Conditions", type: "string", required: true }],
      utteranceExamples: [{ text: "Conditions in Raleigh?", inputs: { "Place Name": "Raleigh" } }],
      answerTemplate: "The conditions in {Place Name} are {Conditions}.",
    }],
  });
  assert.equal(request.operations[0].inputs[0].clarification, "What value should I use for place name?");
  assert.equal(request.operations[0].answerTemplate, "The conditions in {{place_name}} are {{conditions}}.");
});

test("generated generic type and binding aliases normalize without domain rules", () => {
  const request = validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "terrain elevation lookup",
    description: "Return elevation for a remembered location.",
    operations: [{
      operationId: "lookup elevation",
      inputs: [{ name: "Home Area", type: "text", required: true, bindingHint: { source: "context" } }],
      outputs: [{ name: "Elevation", type: "float", required: true }],
      utteranceExamples: ["What is my elevation?"],
      answerTemplate: "{{Elevation}}",
    }],
  });
  const input = request.operations[0].inputs[0];
  assert.equal(input.type, "string");
  assert.deepEqual(input.bindingHint, {
    source: "contextdb",
    subject: "speaker",
    property: "home_area",
  });
  assert.equal(request.operations[0].outputs[0].type, "number");
});

test("missing generated operation fields use stable generic aliases and fallbacks", () => {
  const request = validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    name: "External data lookup",
    description: "Return external data.",
    operations: [{
      id: "Fetch Data",
      inputs: [{ key: "Search Term", type: "text", bindingHint: { source: "utterance" } }],
      outputs: [{ label: "Result Value", type: "text" }],
      utteranceExamples: [{ text: "Find purple", inputs: { "Search Term": "purple" } }],
    }],
  });
  assert.equal(request.capabilityIdHint, "external_data_lookup");
  assert.equal(request.operations[0].operationId, "fetch_data");
  assert.equal(request.operations[0].inputs[0].name, "search_term");
  assert.equal(request.operations[0].outputs[0].name, "result_value");
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
  assert.throws(() => validateTrustedImplementation({ published: {
    modules: { axios: "axios" },
    actions: [
      { target: "{|axios|}", chain: [{ access: "get", params: ["https://api.example.com/data", { params: { key: "YOUR_API_KEY", q: "{|req=>body.location|}" } }] }], assign: "{|x|}" },
      { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|x=>data|}" }] }] },
    ],
  } }), /credential placeholders/);
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

test("discovery carries top-level semantic IDs into an incomplete generated build request", async () => {
  const incomplete = JSON.parse(JSON.stringify(genericRequest));
  delete incomplete.capabilityIdHint;
  delete incomplete.operations[0].operationId;
  const discovery = await discoverComputeCapability({
    openai: modelReturning({
      decision: "build_compute",
      confidence: 0.9,
      capabilityId: "environment conditions lookup",
      operationId: "Current Conditions",
      capabilityRequest: incomplete,
    }),
    utterance: "Look up conditions.",
    requestedBy: "u:7",
  });
  assert.equal(discovery.decision, "build");
  assert.equal(discovery.buildCommand.capabilityRequest.capabilityIdHint, "environment_conditions_lookup");
  assert.equal(discovery.buildCommand.capabilityRequest.operations[0].operationId, "current_conditions");
});

test("discovery recovers descriptive metadata and examples without inventing behavior", async () => {
  const incomplete = JSON.parse(JSON.stringify(genericRequest));
  delete incomplete.name;
  delete incomplete.description;
  delete incomplete.operations[0].description;
  delete incomplete.operations[0].utteranceExamples;
  const discovery = await discoverComputeCapability({
    openai: modelReturning({
      decision: "build_compute",
      confidence: 0.9,
      reason: "Fresh conditions data is required for the question.",
      capabilityId: "environment.conditions.lookup",
      operationId: "lookup",
      capabilityRequest: incomplete,
    }),
    utterance: "What are the conditions today?",
    requestedBy: "u:7",
  });
  const request = discovery.buildCommand.capabilityRequest;
  assert.equal(discovery.decision, "build");
  assert.equal(request.description, "Fresh conditions data is required for the question.");
  assert.equal(request.operations[0].description, "Handle lookup.");
  assert.deepEqual(request.operations[0].utteranceExamples, ["What are the conditions today?"]);
});

test("build validation accepts generic descriptive aliases", () => {
  const request = JSON.parse(JSON.stringify(genericRequest));
  delete request.description;
  request.summary = "A concise semantic capability summary.";
  assert.equal(
    validateCapabilityBuildRequest(request).description,
    "A concise semantic capability summary."
  );
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
  assert.equal(discovery.diagnostics.code, "INACTIVE_CAPABILITY_REUSE");
  assert.match(discovery.diagnostics.message, /inactive entity capability/);
  assert.match(discovery.reason, /inactive entity capability/);
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
