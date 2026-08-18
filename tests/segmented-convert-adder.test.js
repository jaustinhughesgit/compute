"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const {
  declaredInvocationExamples,
  normalizeConvertAuthoringContext,
  normalizeConvertPrompt,
} = require("../app/routes/convertRequirements");
const { discoverComputeCapability } = require("../app/routes/capabilityDiscovery");
const { buildComputeEntitySpec } = require("../app/routes/capabilityBlueprints");
const {
  validateInvocationInputs,
  validateOperationResult,
} = require("../app/routes/capabilityManifest");

const loadBeforeParser = Module._load;
Module._load = function loadParserWithoutLambdaSdk(request, parent, isMain) {
  if (request === "aws-sdk") {
    function DynamoDB() {}
    DynamoDB.Converter = {};
    return { DynamoDB };
  }
  return loadBeforeParser.call(this, request, parent, isMain);
};
const { parseArrayLogic } = require("../app/routes/parseArrayLogic");
Module._load = loadBeforeParser;

const requirementSegments = [
  "Create a compute entity that adds two numbers.",
  "Both numbers are required; ask for whichever number is missing.",
  "Return the sum as a number.",
];

function field(name, description) {
  return {
    name,
    type: "number",
    required: true,
    description,
    bindingHint: {
      source: "utterance",
      subject: null,
      property: null,
      resolver: "number",
      aliases: null,
      value: null,
    },
    clarification: `What ${name} number should I add?`,
    defaultValue: null,
    validation: null,
  };
}

const capabilityRequest = {
  schemaVersion: 1,
  kind: "computeCapabilityBuild",
  capabilityIdHint: "math.add.two_numbers",
  name: "Two-number adder",
  description: "Adds two required numbers and returns their numeric sum.",
  operations: [{
    operationId: "add",
    description: "Add two required numbers.",
    inputs: [field("left", "The first number."), field("right", "The second number.")],
    outputs: [{
      name: "sum",
      type: "number",
      required: true,
      description: "The numeric sum.",
      bindingHint: null,
      clarification: null,
      defaultValue: null,
      validation: null,
    }],
    freshness: { mode: "none", ttlSeconds: 0 },
    answerTemplate: "{{left}} plus {{right}} is {{sum}}.",
    utteranceExamples: [{
      text: "Add 4 and 7.",
      inputValues: [{ name: "left", value: 4 }, { name: "right", value: 7 }],
    }],
  }],
};

const generatedImplementation = {
  name: "Two-number adder",
  provider: "local declarative arithmetic",
  published: {
    modules: {},
    actions: [
      {
        target: "{|math|}",
        chain: [{ access: "add", params: ["{|req=>body.left|}", "{|req=>body.right|}"] }],
        assign: "{|sum|}",
      },
      {
        target: "{|res|}!",
        chain: [{ access: "send", params: [{ sum: "{|sum|}" }] }],
      },
    ],
    data: {},
  },
};

test("Convert authoring context is independently bounded at the Compute boundary", () => {
  const normalized = normalizeConvertAuthoringContext({
    recentInputs: Array.from({ length: 25 }, (_, index) => ({
      text: `Recent input ${index + 1}`,
      inputKind: "statement",
      ignored: "not part of the contract",
    })),
    essence: Array.from({ length: 125 }, (_, index) => [
      "present", "speaker", `property ${index + 1}`, `value ${index + 1}`,
    ]),
  });
  assert.equal(normalized.recentInputs.length, 20);
  assert.equal(normalized.recentInputs[0].text, "Recent input 6");
  assert.equal(normalized.essence.length, 120);
  assert.equal(Object.hasOwn(normalized.recentInputs[0], "ignored"), false);
});

test("three Convert hard stops discover and materialize one arithmetic compute entity", async () => {
  const prompt = normalizeConvertPrompt({
    requirementSegments,
    relevantItems: [{ essence: [["speaker", "has", "unrelated", "context"]] }],
    authoringContext: {
      schemaVersion: 1,
      kind: "convertAuthoringContext",
      recentInputs: [{ text: "I recently checked a different workflow.", inputKind: "statement", semanticEntity: null }],
      essence: [["present", "speaker", "workflow", "different"]],
    },
  });
  assert.deepEqual(prompt.requirementSegments, requirementSegments);
  assert.deepEqual(prompt.relevantItems, []);
  assert.equal(prompt.authoringContext.recentInputs[0].text, "I recently checked a different workflow.");

  let discoveryUserPayload = null;
  const openai = {
    chat: {
      completions: {
        create: async (request) => {
          discoveryUserPayload = JSON.parse(request.messages.find((message) => message.role === "user").content);
          return {
            choices: [{ message: { content: JSON.stringify({
              decision: "build_compute",
              confidence: 0.99,
              reason: "A reusable deterministic calculation was explicitly requested.",
              capabilityId: capabilityRequest.capabilityIdHint,
              entityId: null,
              operationId: "add",
              inputValues: [],
              capabilityRequest,
            }) } }],
          };
        },
      },
    },
  };
  const discovery = await discoverComputeCapability({
    openai,
    utterance: prompt.userRequest,
    requestedBy: "u:test",
    availableCapabilities: [],
    semanticEvidence: [prompt.authoringContext],
    requirementSegments: prompt.requirementSegments,
  });

  assert.equal(discovery.decision, "build");
  assert.deepEqual(discoveryUserPayload.requirements, requirementSegments);
  assert.deepEqual(discoveryUserPayload.semanticEvidence.rows, [
    ["present", "speaker", "workflow", "different"],
  ]);
  assert.equal(
    discoveryUserPayload.semanticEvidence.recentInputs[0].text,
    "I recently checked a different workflow."
  );
  assert.equal(discovery.buildCommand.capabilityRequest.operations[0].inputs.length, 2);
  assert.match(discovery.buildCommand.capabilityRequest.operations[0].inputs[0].clarification, /left/i);
  assert.match(discovery.buildCommand.capabilityRequest.operations[0].inputs[1].clarification, /right/i);

  const computeSpec = await buildComputeEntitySpec({
    capabilityRequest: discovery.buildCommand.capabilityRequest,
    requestedBy: "u:test",
    originalUtterance: prompt.userRequest,
    generatedImplementation,
  });
  assert.deepEqual(computeSpec.computeEntity.published.data.allowedHosts, []);
  assert.deepEqual(
    computeSpec.computeEntity.published.actions[0].chain[0].params,
    ["{|req=>body.left|}", "{|req=>body.right|}"],
  );
  assert.deepEqual(computeSpec.computeEntity.manifest.operations[0].protectedAssetRequirements, []);
  assert.throws(
    () => validateInvocationInputs(computeSpec.computeEntity.manifest, "add", {}),
    (error) => error.code === "MISSING_INPUT"
      && error.details.field === "left"
      && /left/i.test(error.details.clarification),
  );
  assert.throws(
    () => validateInvocationInputs(computeSpec.computeEntity.manifest, "add", { left: 4 }),
    (error) => error.code === "MISSING_INPUT"
      && error.details.field === "right"
      && /right/i.test(error.details.clarification),
  );
  const invocation = validateInvocationInputs(
    computeSpec.computeEntity.manifest,
    "add",
    { left: 4, right: 7 },
  );
  assert.deepEqual(invocation.inputs, { left: 4, right: 7 });
  assert.deepEqual(validateOperationResult(invocation.operation, { sum: 11 }), { sum: 11 });

  const parsed = await parseArrayLogic({
    arrayLogic: [computeSpec],
    sourceType: "arrayLogic",
    dynamodb: {},
    e: "test",
  });
  assert.equal(parsed.details[0].type, "computeEntity");
  assert.ok(parsed.shorthand.some((row) => row[0] === "ROUTE" && row[3] === "newGroup"));
  assert.ok(parsed.shorthand.some((row) => row[0] === "NESTED" && row[2] === "published" && row[3] === "actions"));
  assert.ok(parsed.shorthand.some((row) => row[0] === "ROUTE" && row[3] === "saveFile"));
});

test("Convert preserves a declared command-shaped invocation instead of a generated paraphrase", async () => {
  const segments = [
    "Create a compute entity that produces a register status report.",
    "Its required status input comes from ContextDB.",
    "When I ask, give me the register status report, return the current register status.",
  ];
  assert.deepEqual(declaredInvocationExamples(segments), [
    "give me the register status report",
  ]);

  const generatedRequest = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "register_status_report",
    name: "Register status report",
    description: "Reports a browser-resolved register status.",
    operations: [{
      operationId: "report",
      description: "Return the register status.",
      inputs: [{
        name: "status",
        type: "string",
        required: true,
        description: "Current register status.",
        bindingHint: {
          source: "contextdb", subject: "speaker", property: "register_status",
          resolver: null, aliases: null, value: null,
        },
        clarification: null,
        defaultValue: null,
        validation: null,
      }],
      outputs: [{
        name: "report", type: "string", required: true,
        description: "Rendered report.", bindingHint: null,
        clarification: null, defaultValue: null, validation: null,
      }],
      freshness: { mode: "none", ttlSeconds: 0 },
      answerTemplate: "{{report}}",
      utteranceExamples: ["What is the current register status?"],
      calculation: null,
    }],
  };
  const openai = {
    chat: { completions: { create: async () => ({
      choices: [{ message: { content: JSON.stringify({
        decision: "build_compute",
        confidence: 0.99,
        reason: "A reusable input transformation was requested.",
        capabilityId: "register_status_report",
        entityId: null,
        operationId: "report",
        inputValues: [],
        capabilityRequest: generatedRequest,
      }) } }],
    }) } },
  };
  const discovery = await discoverComputeCapability({
    openai,
    utterance: segments.join("\n\n"),
    requestedBy: "u:test",
    requirementSegments: segments,
  });
  assert.equal(discovery.decision, "build");
  assert.deepEqual(
    discovery.buildCommand.capabilityRequest.operations[0].utteranceExamples,
    ["What is the current register status?", "give me the register status report"],
  );
});

test("Convert preserves every quoted invocation in an I-can-say requirement", () => {
  assert.deepEqual(declaredInvocationExamples([
    "I can say, \"wash my car\", \"wash my camry\" or \"wash my toyota\".",
  ]), ["wash my car", "wash my camry", "wash my toyota"]);
});

test("the generated Shorthand materializes the validated JPL into the created entity", async () => {
  const materializeRequest = structuredClone(capabilityRequest);
  materializeRequest.operations[0].utteranceExamples = [{
    text: "Add 4 and 7.",
    inputs: { left: 4, right: 7 },
  }];
  const computeSpec = await buildComputeEntitySpec({
    capabilityRequest: materializeRequest,
    requestedBy: "u:test",
    originalUtterance: requirementSegments.join("\n\n"),
    generatedImplementation,
  });
  const parsed = await parseArrayLogic({
    arrayLogic: [computeSpec],
    sourceType: "arrayLogic",
    dynamodb: {},
    e: "test",
  });

  const cookiesPath = require.resolve("../app/routes/cookies");
  const previousModule = require.cache[cookiesPath];
  const originalLoad = Module._load;
  let savedEntity = null;
  Module._load = function loadWithRouteStub(request, parent, isMain) {
    if (request === "mathjs") return { evaluate: Number };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.cache[cookiesPath] = {
    id: cookiesPath,
    filename: cookiesPath,
    loaded: true,
    exports: {
      route: async (...args) => {
        const request = args[0];
        const action = args[18];
        if (action === "newGroup") {
          return { response: { oai: { html: { response: { file: "1v4r-two-number-adder" } } } } };
        }
        if (action === "getFile") return { response: { published: {} } };
        if (action === "saveFile") {
          savedEntity = request?.body?.body || null;
          return { response: { ok: true, file: "1v4r-two-number-adder" } };
        }
        throw new Error(`unexpected route ${action}`);
      },
    },
  };

  try {
    const { shorthand } = require("../app/routes/modules/shorthand");
    await shorthand(
      {
        input: [
          { physical: [[{ published: {} }]] },
          { virtual: parsed.shorthand },
        ],
      },
      { body: {}, headers: {}, cookies: {} },
      {},
      undefined,
      undefined,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      "/cookies/convert/test",
      { body: {} },
      "POST",
      "cookies",
    );
  } finally {
    Module._load = originalLoad;
    if (previousModule) require.cache[cookiesPath] = previousModule;
    else delete require.cache[cookiesPath];
  }

  assert.ok(savedEntity);
  assert.equal(savedEntity.published.computeCapability.capabilityId, "math.add.two_numbers");
  assert.deepEqual(savedEntity.published.actions, computeSpec.computeEntity.published.actions);
});
