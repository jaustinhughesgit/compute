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
  validateImplementationBindings,
  isBlockedHostname,
  CapabilityBuildRetryError,
} = require("../app/routes/capabilityBlueprints");
const {
  discoverComputeCapability,
  summarizeCapabilities,
  normalizeGeneratedBuildRequest,
  normalizeDiscoveryInputValues,
  semanticEvidenceContext,
  DISCOVERY_RESPONSE_SCHEMA,
} = require("../app/routes/capabilityDiscovery");
const { validateCapabilityManifest, IMPLEMENTATION_POLICY_VERSION } = require("../app/routes/capabilityManifest");
const { validateCapabilityBuildRequest } = require("../app/routes/capabilityManifest");
const { buildCapabilityPathDataset } = require("../app/routes/capabilityPaths");
const { createCapabilityRegistry, migrateStoredManifest } = require("../app/routes/capabilityRegistry");

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
        chain: [{ access: "get", params: ["https://httpbin.org/anything", { params: { place: "{|req=>body.location_code|}", date: "{|req=>body.date|}" } }] }],
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

function registryManifest(entityId, ownerId, capabilityId) {
  return {
    schemaVersion: 1,
    capabilityId,
    entityId,
    version: 1,
    status: "active",
    ownerId,
    description: `${capabilityId} capability`,
    execution: { type: "remote", readOnly: true, timeoutMs: 10_000 },
    implementationPolicyVersion: IMPLEMENTATION_POLICY_VERSION,
    operations: [{
      operationId: "lookup",
      description: "Look up a value.",
      inputs: [],
      outputs: [{ name: "value", type: "string", required: true }],
      utteranceExamples: ["Look it up."],
      answerTemplate: "{{value}}",
    }],
  };
}

test("capability discovery includes only owned, system, or use-granted definitions", async () => {
  const items = [
    registryManifest("entity-owned", "u:2", "owned.lookup"),
    registryManifest("entity-shared", "u:1", "shared.lookup"),
    registryManifest("entity-denied", "u:3", "denied.lookup"),
    registryManifest("entity-system", "system", "system.lookup"),
  ].map((manifest) => ({ su: manifest.entityId, computeCapability: manifest }));
  const dynamodb = {
    scan: () => ({ promise: async () => ({ Items: items }) }),
  };
  const persistence = {
    authorization: {
      batchGetGrants: async () => [{
        entityID: "entity-shared",
        principalID: "u:2",
        perms: "r",
        canonicalLifecycle: { state: "active", tombstone: false },
      }],
    },
  };
  const registry = createCapabilityRegistry({ dynamodb, persistence });
  const manifests = await registry.listAvailable({ ownerId: "u:2", activeOnly: false });

  assert.deepEqual(
    manifests.map((manifest) => manifest.entityId).sort(),
    ["entity-owned", "entity-shared", "entity-system"]
  );
});

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
  assert.deepEqual(spec.computeEntity.published.data.allowedHosts, ["httpbin.org"]);
  assert.equal(spec.computeEntity.manifest.implementationPolicyVersion, IMPLEMENTATION_POLICY_VERSION);
  assert.equal(JSON.stringify(spec).includes("function"), false);
});

test("generic entity builder accepts bounded local arithmetic without a provider", async () => {
  const request = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "math.increment.number",
    name: "Number incrementer",
    description: "Adds one to a number.",
    operations: [{
      operationId: "increment",
      inputs: [{ name: "number", type: "number", required: true, bindingHint: { source: "utterance" } }],
      outputs: [{ name: "result", type: "number", required: true }],
      utteranceExamples: [{ text: "Increment 4.", inputs: { number: 4 } }],
      answerTemplate: "{{result}}",
    }],
  };
  const result = await buildComputeEntitySpec({
    capabilityRequest: request,
    requestedBy: "u:7",
    generatedImplementation: { published: {
      modules: {},
      actions: [
        { target: "{|math|}", chain: [{ access: "add", params: ["{|req=>body.number|}", 1] }], assign: "{|result|}" },
        { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|result|}" }] }] },
      ],
      data: {},
    } },
  });
  assert.equal(result.computeEntity.published.actions[0].target, "{|math|}");
  assert.deepEqual(result.computeEntity.published.data.allowedHosts, []);
});

test("a declared calculation compiles to local JPL without calling a provider or builder model", async () => {
  const request = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "math.add.two_numbers",
    name: "Add two numbers",
    description: "Adds two supplied numbers.",
    operations: [{
      operationId: "add",
      description: "Add two numbers.",
      inputs: [
        { name: "left", type: "number", required: true, bindingHint: { source: "utterance", resolver: "number" } },
        { name: "right", type: "number", required: true, bindingHint: { source: "utterance", resolver: "number" } },
      ],
      outputs: [{ name: "sum", type: "number", required: true }],
      utteranceExamples: [{ text: "Add 4 and 7.", inputs: { left: 4, right: 7 } }],
      answerTemplate: "{{sum}}",
      calculation: {
        operator: "add",
        operands: [
          { source: "input", inputName: "left" },
          { source: "input", inputName: "right" },
        ],
        outputName: "sum",
      },
    }],
  };
  let modelCalls = 0;
  const result = await buildComputeEntitySpec({
    capabilityRequest: request,
    requestedBy: "u:7",
    openai: { chat: { completions: { create: async () => { modelCalls += 1; } } } },
  });
  assert.equal(modelCalls, 0);
  assert.deepEqual(result.computeEntity.published.actions, [
    {
      target: "{|math|}",
      chain: [{ access: "add", params: ["{|req=>body.left|}", "{|req=>body.right|}"] }],
      assign: "{|calculation_result|}",
    },
    {
      target: "{|res|}!",
      chain: [{ access: "send", params: [{ sum: "{|calculation_result|}" }] }],
    },
  ]);
  assert.equal(result.computeEntity.manifest.operations[0].calculation.operator, "add");
});

test("a single-operation implementation must use every required ordinary input", () => {
  const implementation = structuredClone(generatedImplementation);
  implementation.published.actions[0].chain[0].params[1].params = {
    place: "{|location_code|}",
  };
  assert.throws(
    () => validateImplementationBindings(implementation, genericRequest),
    /does not use required ordinary input date/
  );
  implementation.published.actions[0].chain[0].params[1].params.date = "{|date|}";
  assert.doesNotThrow(() => validateImplementationBindings(implementation, genericRequest));
});

test("a provider request cannot depend on an uncollected optional ordinary input", () => {
  const request = structuredClone(genericRequest);
  const location = request.operations[0].inputs.find((input) => input.name === "location_code");
  location.required = false;
  assert.throws(
    () => validateImplementationBindings(structuredClone(generatedImplementation), request),
    /provider request input location_code must be required or declare a defaultValue/
  );
  location.defaultValue = "default-location";
  assert.doesNotThrow(
    () => validateImplementationBindings(structuredClone(generatedImplementation), request)
  );
});

test("a closed semantic selector may select an operation without becoming a provider parameter", () => {
  const request = structuredClone(genericRequest);
  const operation = request.operations[0];
  const date = operation.inputs.find((input) => input.name === "date");
  date.bindingHint = { source: "utterance", resolver: "date" };
  date.validation = { pattern: "^(?:today|current|now)$" };
  operation.answerTemplate = "The result for {{date}} is {{summary}}.";
  const implementation = structuredClone(generatedImplementation);
  delete implementation.published.actions[0].chain[0].params[1].params.date;
  assert.doesNotThrow(() => validateImplementationBindings(implementation, request));

  delete date.validation;
  assert.throws(
    () => validateImplementationBindings(implementation, request),
    /does not use required ordinary input date/
  );
  date.validation = { pattern: "^.*$" };
  assert.throws(
    () => validateImplementationBindings(implementation, request),
    /does not use required ordinary input date/
  );
});

test("generic entity builder removes a generated result envelope around declared outputs", async () => {
  const wrapped = structuredClone(generatedImplementation);
  wrapped.published.actions[1].chain[0].params[0] = {
    result: { summary: "{|providerResponse=>data.summary|}" },
  };
  const spec = await buildComputeEntitySpec({
    capabilityRequest: genericRequest,
    requestedBy: "u:7",
    originalUtterance: "Look up conditions.",
    generatedImplementation: wrapped,
  });
  assert.deepEqual(
    spec.computeEntity.published.actions[1].chain[0].params[0],
    { summary: "{|providerResponse=>data.summary|}" }
  );
});

test("generic entity builder rejects response payloads without declared outputs", async () => {
  const invalid = structuredClone(generatedImplementation);
  invalid.published.actions[1].chain[0].params[0] = {
    result: "{|providerResponse=>data.summary|}",
  };
  await assert.rejects(
    buildComputeEntitySpec({
      capabilityRequest: genericRequest,
      requestedBy: "u:7",
      originalUtterance: "Look up conditions.",
      generatedImplementation: invalid,
    }),
    /declared operation outputs at the top level/
  );
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

test("generic builder carries validation repair across bounded HTTP phases", async () => {
  let calls = 0;
  const requests = [];
  const openai = {
    chat: { completions: { create: async (request, options) => {
      calls += 1;
      requests.push({ request, options });
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

  let continuation;
  await assert.rejects(
    buildComputeEntitySpec({
      capabilityRequest: genericRequest,
      requestedBy: "u:7",
      originalUtterance: "Look up conditions.",
      openai,
      generationAttemptLimit: 1,
    }),
    (error) => {
      assert.equal(error instanceof CapabilityBuildRetryError, true);
      continuation = error.continuation;
      assert.equal(continuation.attempt, 1);
      return true;
    }
  );

  const spec = await buildComputeEntitySpec({
    capabilityRequest: genericRequest,
    requestedBy: "u:7",
    originalUtterance: "Look up conditions.",
    openai,
    generationAttemptLimit: 1,
    buildContinuation: continuation,
  });
  assert.equal(calls, 2);
  assert.equal(spec.computeEntity.capabilityId, genericRequest.capabilityIdHint);
  assert.equal(requests[0].options.maxRetries, 0);
  assert.equal(requests[0].options.timeout, 18_000);
  assert.equal(requests[1].request.messages.some((message) => message.role === "assistant"), true);
  assert.equal(requests[1].request.messages.some((message) =>
    message.role === "system" && /Validation failed/.test(message.content)
  ), true);
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
            "https://httpbin.org/anything?place={|req=>body.location_code|}&date={|req=>body.date|}",
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
  assert.equal(request[0], "https://httpbin.org/anything");
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
      data: { providerUrl: "https://httpbin.org/anything" },
      actions: [
        { target: "{|axios|}", chain: [{ access: "get", params: ["{|providerUrl|}", {}] }], assign: "{|x|}" },
        { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|x=>data|}" }] }] },
      ],
    },
  });
  assert.equal(compiled.published.actions[0].chain[0].params[0], "https://httpbin.org/anything");
  assert.doesNotThrow(() => validateTrustedImplementation(compiled));
  assert.throws(() => validateTrustedImplementation(canonicalizeProviderUrls({ published: {
    modules: { axios: "axios" },
    actions: [
      { target: "{|axios|}", chain: [{ access: "get", params: ["https://httpbin.org/{|req=>body.path|}", {}] }], assign: "{|x|}" },
      { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|x=>data|}" }] }] },
    ],
  } })), /literal public HTTPS provider URL/);
  assert.throws(() => validateTrustedImplementation({ published: {
    modules: { axios: "axios" },
    actions: [
      { target: "{|axios|}", chain: [{ access: "get", params: ["https://httpbin.org/anything", { params: { q: "${location}" } }] }], assign: "{|x|}" },
      { target: "{|res|}!", chain: [{ access: "send", params: [{ result: "{|x=>data|}" }] }] },
    ],
  } }), /only declarative/);
});

test("data-driven provider credentials remain protected and are never ordinary inputs", async () => {
  const spec = await buildComputeEntitySpec({
    capabilityRequest: genericRequest,
    requestedBy: "u:7",
    originalUtterance: "What are the conditions today?",
    generatedImplementation: {
      name: "Conditions lookup",
      provider: "Public conditions provider",
      inputRequirements: [],
      protectedAssetRequirements: [{
        requirementId: "conditions_provider_credentials",
        operationId: "lookup",
        assetType: "credential",
        providerId: "conditions_provider",
        providerName: "Public conditions provider",
        providerHost: "httpbin.org",
        purpose: "environment.conditions.lookup",
        use: "inject",
        approvalMode: "every_use",
        acquisition: {
          url: "https://httpbin.org/forms/post",
          instructions: "Create a provider account and copy its API key.",
        },
        fields: [{
          name: "api_key",
          required: true,
          injection: { location: "query", parameter: "appid", prefix: "" },
        }],
      }],
      published: {
        modules: { axios: "axios" },
        actions: [
          {
            target: "{|axios|}",
            chain: [{
              access: "get",
              params: ["https://httpbin.org/anything", {
                params: {
                  place: "{|req=>body.location_code|}",
                  date: "{|req=>body.date|}",
                  appid: "{|req=>body.api_key|}",
                },
              }],
            }],
            assign: "{|providerResponse|}",
          },
          {
            target: "{|res|}!",
            chain: [{ access: "send", params: [{ summary: "{|providerResponse=>data.summary|}" }] }],
          },
        ],
        data: {},
      },
    },
  });
  const operation = spec.computeEntity.manifest.operations[0];
  assert.equal(operation.inputs.some((input) => input.name === "api_key"), false);
  assert.equal(operation.protectedAssetRequirements[0].requirementId, "conditions_provider_credentials");
  assert.equal(
    spec.computeEntity.published.actions[0].chain[0].params[1].params.appid,
    "{|protected=>conditions_provider_credentials.api_key|}"
  );
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

test("utterance bindings cannot smuggle a constant into a reusable semantic slot", () => {
  const request = JSON.parse(JSON.stringify(genericRequest));
  request.operations[0].inputs[0].bindingHint = {
    source: "utterance",
    value: "fixed",
  };
  assert.throws(
    () => validateCapabilityBuildRequest(request),
    /binding value is allowed only when source is default/
  );
});

test("legacy utterance constants migrate into closed validation constraints", () => {
  const stored = JSON.parse(JSON.stringify(genericRequest));
  stored.capabilityId = stored.capabilityIdHint;
  delete stored.capabilityIdHint;
  stored.entityId = "entity-legacy";
  stored.version = 1;
  stored.status = "active";
  stored.execution = { type: "remote" };
  stored.operations[0].inputs[0].bindingHint = {
    source: "utterance",
    value: "today",
  };
  stored.operations[0].utteranceExamples = [{
    text: "Use current conditions.",
    inputs: { location_code: "current" },
  }];
  const migrated = migrateStoredManifest(stored);
  const input = migrated.operations[0].inputs[0];
  assert.equal(Object.prototype.hasOwnProperty.call(input.bindingHint, "value"), false);
  assert.equal(input.validation.pattern, "^(?:today|current)$");
});

test("entity revisions preserve semantic resolvers and closed operation boundaries", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../app/routes/modules/editEntity.js"),
    "utf8"
  );
  assert.match(source, /bindingHint\.resolver/);
  assert.match(source, /bindingHint\.value only when bindingHint\.source is default/);
  assert.match(source, /anchored validation\.pattern/);
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

test("answer templates may use declared inputs and outputs but reject unknown values", () => {
  const valid = validateCapabilityBuildRequest({
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "place.conditions",
    description: "Return conditions for a place.",
    operations: [{
      operationId: "lookup",
      inputs: [{
        name: "place",
        type: "string",
        required: true,
        bindingHint: { source: "utterance" },
      }],
      outputs: [{ name: "conditions", type: "string", required: true }],
      utteranceExamples: [{ text: "Conditions in Raleigh?", inputs: { place: "Raleigh" } }],
      answerTemplate: "The conditions in {{place}} are {{conditions}}.",
    }],
  });
  assert.equal(valid.operations[0].answerTemplate, "The conditions in {{place}} are {{conditions}}.");

  const invalid = structuredClone(valid);
  invalid.operations[0].answerTemplate = "{{place}}: {{forecast}}";
  assert.throws(
    () => validateCapabilityBuildRequest(invalid),
    /answerTemplate references undeclared value forecast/
  );
});

test("answer templates cannot hard-code one relative day when a temporal input supports another", () => {
  const request = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "generic.forecast",
    description: "Return a value for a requested date.",
    operations: [{
      operationId: "lookup",
      inputs: [{
        name: "time_reference",
        type: "date",
        required: true,
        bindingHint: { source: "utterance", resolver: "date" },
      }],
      outputs: [{ name: "summary", type: "string", required: true }],
      utteranceExamples: [
        { text: "Result today?", inputs: { time_reference: "today" } },
        { text: "Result tomorrow?", inputs: { time_reference: "tomorrow" } },
      ],
      answerTemplate: "The result today is {{summary}}.",
    }],
  };
  assert.throws(
    () => validateCapabilityBuildRequest(request),
    /answerTemplate hard-codes today/
  );
  request.operations[0].answerTemplate = "The result for {{time_reference}} is {{summary}}.";
  assert.equal(
    validateCapabilityBuildRequest(request).operations[0].answerTemplate,
    "The result for {{time_reference}} is {{summary}}."
  );
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
      { target: "{|axios|}", chain: [{ access: "get", params: ["https://httpbin.org/anything", { params: { key: "YOUR_API_KEY", q: "{|req=>body.location|}" } }] }], assign: "{|x|}" },
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

test("discovery uses strict Structured Outputs with nonempty operations and outputs", async () => {
  let request = null;
  let options = null;
  const openai = {
    chat: { completions: { create: async (value, requestOptions) => {
      request = value;
      options = requestOptions;
      return { choices: [{ message: { content: JSON.stringify({
        decision: "build_compute",
        confidence: 0.95,
        reason: "Fresh data is required.",
        capabilityId: genericRequest.capabilityIdHint,
        entityId: null,
        operationId: "lookup",
        capabilityRequest: genericRequest,
      }) } }] };
    } } },
  };
  const result = await discoverComputeCapability({
    openai,
    utterance: "Look up conditions.",
    requestedBy: "u:7",
    semanticEvidence: [{
      essence: [["*", "speaker", "live", "{location_code}"]],
      resolvedContextBindings: { location_code: ["north carolina"] },
      matchedEssenceRows: [0],
    }],
  });
  assert.equal(result.decision, "build");
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(options.timeout <= 18_000, true);
  assert.equal(options.timeout >= 17_900, true);
  assert.equal(options.maxRetries, 0);
  assert.equal(request.response_format.json_schema.schema, DISCOVERY_RESPONSE_SCHEMA);
  assert.match(request.messages[0].content, /semantic domain/);
  assert.match(request.messages[0].content, /bindingHint\.value to null/);
  assert.match(request.messages[0].content, /anchored validation\.pattern/);
  const discoveryEvidence = JSON.parse(request.messages[1].content).semanticEvidence;
  assert.deepEqual(discoveryEvidence.resolvedContextBindings, {
    location_code: ["north carolina"],
  });
  assert.deepEqual(discoveryEvidence.matchedEssenceRows, [0]);
  assert.equal(DISCOVERY_RESPONSE_SCHEMA.type, "object");
  assert.equal(DISCOVERY_RESPONSE_SCHEMA.anyOf, undefined);
  assert.ok(DISCOVERY_RESPONSE_SCHEMA.required.includes("inputValues"));
  const buildContract = DISCOVERY_RESPONSE_SCHEMA.properties.capabilityRequest.anyOf.find((schema) => schema.type === "object");
  assert.equal(buildContract.properties.operations.minItems, 1);
  assert.equal(buildContract.properties.operations.items.properties.outputs.minItems, 1);
});

test("discovery turns LLM semantic evidence into validated literal utterance bindings", () => {
  const operation = {
    operationId: "fetch_weather",
    inputs: [{
      name: "location",
      type: "string",
      required: true,
      description: "Requested location.",
      bindingHint: { source: "utterance" },
    }],
  };
  assert.deepEqual(normalizeDiscoveryInputValues({
    parsedValues: [],
    utterance: "what is the weather in Raleigh North Carolina?",
    operation,
    semanticEvidence: [{
      essence: [["present", "{ask}", "{prop:location}", "raleigh north carolina"]],
    }],
  }), {
    location: "raleigh north carolina",
  });
  assert.throws(() => normalizeDiscoveryInputValues({
    parsedValues: [{ name: "location", value: "New York" }],
    utterance: "what is the weather in Raleigh North Carolina?",
    operation,
  }), /must occur literally/);
});

test("discovery restores a normalized date to its explicit relative-day surface", () => {
  const operation = {
    operationId: "fetch_weather",
    inputs: [{
      name: "date",
      type: "date",
      required: true,
      description: "Requested date.",
      bindingHint: { source: "utterance", resolver: "date" },
    }],
  };
  assert.deepEqual(normalizeDiscoveryInputValues({
    parsedValues: [{ name: "date", value: "2026-08-12" }],
    utterance: "What is the weather today?",
    operation,
  }), { date: "today" });
});

test("discovery preserves ContextDB bindings separately from utterance input values", () => {
  const evidence = semanticEvidenceContext([{
    essence: [
      ["*", "speaker", "live", "{location}"],
      ["present", "{location}", "{prop:weather}", "{ask}"],
    ],
    resolvedContextBindings: { location: ["north carolina"] },
    matchedEssenceRows: [0],
  }]);
  assert.deepEqual(evidence, {
    rows: [
      ["*", "speaker", "live", "{location}"],
      ["present", "{location}", "{prop:weather}", "{ask}"],
    ],
    resolvedContextBindings: { location: ["north carolina"] },
    matchedEssenceRows: [0],
  });
});

test("discovery separates the concrete Austin referent from the reusable capability query", () => {
  const evidence = semanticEvidenceContext([{
    capabilityQuery: "register status report",
    invocationReferents: [{
      role: "qualified_owner",
      mention: "Austin",
      mentionKey: "austin",
      resolvedLocally: true,
      resolution: "contextdb-unique",
      entityId: "must-not-cross",
    }],
  }]);
  assert.deepEqual(evidence, {
    rows: [],
    resolvedContextBindings: {},
    matchedEssenceRows: [],
    capabilityQuery: "register status report",
    invocationReferents: [{
      role: "qualified_owner",
      mention: "Austin",
      mentionKey: "austin",
      resolvedLocally: true,
      resolution: "contextdb-unique",
    }],
  });
  const convertSource = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  assert.match(convertSource, /utterance:\s*semanticContext\.capabilityQuery \|\| originalUtterance/);
});

test("discovery discards a ContextDB value copied into utterance inputValues", () => {
  const operation = {
    operationId: "fetch_weather",
    inputs: [{
      name: "location",
      type: "string",
      required: true,
      description: "Requested location.",
      bindingHint: {
        source: "utterance",
        subject: "speaker",
        property: "live",
        resolver: "location",
      },
    }],
  };
  assert.deepEqual(normalizeDiscoveryInputValues({
    parsedValues: [{ name: "location", value: "new york" }],
    utterance: "what is the weather where my mom lives today?",
    operation,
    semanticEvidence: [{
      essence: [
        ["*", "mom", "live", "{location}"],
        ["present", "{location}", "{prop:weather}", "{ask}"],
      ],
      resolvedContextBindings: { location: ["new york"] },
      matchedEssenceRows: [0],
    }],
  }), {});
  assert.throws(() => normalizeDiscoveryInputValues({
    parsedValues: [{ name: "location", value: "boston" }],
    utterance: "what is the weather where my mom lives today?",
    operation,
    semanticEvidence: [{
      resolvedContextBindings: { location: ["new york"] },
    }],
  }), /must occur literally/);
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

test("discovery recovers model-declared operations placed beside capabilityRequest", async () => {
  const discovery = await discoverComputeCapability({
    openai: modelReturning({
      decision: "build_compute",
      confidence: 0.9,
      reason: "Fresh data is required.",
      capabilityId: genericRequest.capabilityIdHint,
      operationId: "lookup",
      capabilityRequest: {
        schemaVersion: 1,
        kind: "computeCapabilityBuild",
        name: genericRequest.name,
        description: genericRequest.description,
      },
      operations: genericRequest.operations,
    }),
    utterance: "Look up conditions.",
    requestedBy: "u:7",
  });
  assert.equal(discovery.decision, "build");
  assert.equal(discovery.buildCommand.capabilityRequest.operations[0].operationId, "lookup");
});

test("flat operation fields are wrapped only when declared outputs exist", () => {
  const recovered = normalizeGeneratedBuildRequest({
    decision: "build_compute",
    capabilityId: "color.lookup",
    operationId: "lookup",
    capabilityRequest: {
      description: "Look up a color value.",
      inputs: [{ name: "color", type: "string", required: true, bindingHint: { source: "utterance" } }],
      outputs: [{ name: "code", type: "string", required: true }],
      utteranceExamples: [{ text: "Code for purple?", inputs: { color: "purple" } }],
      answerTemplate: "{{code}}",
    },
  }, "Code for purple?", "u:7");
  assert.equal(recovered.operations.length, 1);
  assert.equal(recovered.operations[0].operationId, "lookup");
  const incomplete = normalizeGeneratedBuildRequest({
    decision: "build_compute",
    capabilityId: "incomplete.lookup",
    capabilityRequest: { description: "Incomplete contract." },
  }, "Use it.", "u:7");
  assert.equal(Array.isArray(incomplete.operations), false);
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
  assert.equal(discovery.jurisdiction.effectClass, "repair.capability");
  assert.equal(discovery.evolution.outcome, "repair");
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
