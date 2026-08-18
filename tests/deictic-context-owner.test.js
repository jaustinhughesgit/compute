"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  discoverComputeCapability,
  normalizeGeneratedBuildRequest,
} = require("../app/routes/capabilityDiscovery");
const {
  attachGeneratedInputs,
  buildComputeEntitySpec,
} = require("../app/routes/capabilityBlueprints");

const segments = [
  "Create a Compute entity that gets my register status from ContextDB and reports it.",
  "When I ask, give me the register status report, return the register status followed by the status.",
];

function input(name, bindingHint, extras = {}) {
  return {
    name,
    type: "string",
    required: true,
    description: `${name} value.`,
    bindingHint,
    clarification: null,
    defaultValue: null,
    validation: null,
    ...extras,
  };
}

function output(name = "report") {
  return {
    name,
    type: "string",
    required: true,
    description: "Rendered report.",
    bindingHint: null,
    clarification: null,
    defaultValue: null,
    validation: null,
  };
}

function discoveryParsed(inputs, { answerTemplate = "{{report}}", examples = [] } = {}) {
  return {
    decision: "build_compute",
    confidence: 0.99,
    reason: "A reusable browser-resolved report was requested.",
    capabilityId: "generic_property_report",
    entityId: null,
    operationId: "report",
    inputValues: [],
    capabilityRequest: {
      schemaVersion: 1,
      kind: "computeCapabilityBuild",
      capabilityIdHint: "generic_property_report",
      name: "Generic property report",
      description: "Reports a browser-resolved property.",
      operations: [{
        operationId: "report",
        description: "Return the browser-resolved property.",
        inputs,
        outputs: [output()],
        freshness: { mode: "none", ttlSeconds: 0 },
        answerTemplate,
        utteranceExamples: examples.length ? examples : ["Give me the register status report."],
        calculation: null,
      }],
    },
  };
}

test("Convert canonicalizes a model-confused current-speaker input to its ContextDB property value", () => {
  const request = normalizeGeneratedBuildRequest(
    discoveryParsed([
      input("user", {
        source: "contextdb",
        subject: "user",
        property: "register status",
        resolver: null,
        aliases: null,
        value: null,
      }),
    ], { answerTemplate: "The register status is {{user}}." }),
    segments.join("\n"),
    "u:test",
    segments
  );

  assert.equal(request.operations[0].inputs.length, 1);
  assert.equal(request.operations[0].inputs[0].bindingHint.source, "contextdb");
  assert.equal(request.operations[0].inputs[0].bindingHint.subject, "speaker");
  assert.equal(request.operations[0].inputs[0].bindingHint.property, "register status");
  assert.equal(request.operations[0].inputs[0].name, "register_status");
  assert.equal(request.operations[0].answerTemplate, "The register status is {{register_status}}.");
});

test("semantic-first discovery repairs the exact owner-as-value failure before entity code is built", async () => {
  const exactSegments = [
    "Create me a compute entity that tells me my register status.",
  ];
  const parsed = discoveryParsed([
    input("status", {
      source: "utterance",
      subject: null,
      property: null,
      resolver: "string",
      aliases: null,
      value: null,
    }),
  ], {
    answerTemplate: null,
    examples: [{
      text: "Create me a compute entity that tells me my register status.",
      inputValues: [{ name: "status", value: "open" }],
    }],
  });
  parsed.answerPlan = {
    source: "contextdb",
    operationId: "report",
    subject: "speaker",
    property: "register_status",
    inputName: "status",
    outputName: "report",
    statement: "The current speaker's register_status property answers the request.",
  };

  const request = normalizeGeneratedBuildRequest(
    parsed,
    exactSegments[0],
    "u:test",
    exactSegments
  );
  assert.deepEqual(request.operations[0].inputs.map((field) => ({
    name: field.name,
    source: field.bindingHint.source,
    subject: field.bindingHint.subject,
    property: field.bindingHint.property,
  })), [{
    name: "status",
    source: "contextdb",
    subject: "speaker",
    property: "register_status",
  }]);
  assert.equal(request.operations[0].answerTemplate, "{{report}}");
  assert.equal(request.operations[0].utteranceExamples[0].inputs.status, undefined);

  let modelCalls = 0;
  const spec = await buildComputeEntitySpec({
    capabilityRequest: request,
    requestedBy: "u:test",
    originalUtterance: exactSegments[0],
    openai: { responses: { create: async () => { modelCalls += 1; } } },
  });
  assert.equal(modelCalls, 0);
  assert.deepEqual(spec.computeEntity.published.actions, [{
    target: "{|res|}!",
    chain: [{ access: "send", params: [{ report: "{|req=>body.status|}" }] }],
  }]);
});

test("Convert discovery sees bounded recent inputs and browser-proven ContextDB rows", async () => {
  const exactSegments = ["What is my register status?"];
  const parsed = discoveryParsed([
    input("status", {
      source: "utterance",
      subject: null,
      property: null,
      resolver: "string",
      aliases: null,
      value: null,
    }),
  ], {
    answerTemplate: null,
    examples: [{
      text: "What is my register status?",
      inputValues: [{ name: "status", value: "open" }],
    }],
  });
  parsed.answerPlan = {
    source: "contextdb",
    operationId: "report",
    subject: "speaker",
    property: "register_status",
    inputName: "status",
    outputName: "report",
    statement: "The current speaker's register_status property answers the request.",
  };
  let modelInput;
  const discovery = await discoverComputeCapability({
    openai: { chat: { completions: { create: async (request) => {
      modelInput = JSON.parse(request.messages.find((message) => message.role === "user").content);
      return { choices: [{ message: { content: JSON.stringify(parsed) } }] };
    } } } },
    utterance: exactSegments[0],
    requestedBy: "u:test",
    requirementSegments: exactSegments,
    semanticEvidence: [{
      kind: "convertAuthoringContext",
      recentInputs: [
        { text: "My name is Austin.", inputKind: "statement", semanticEntity: null },
        { text: "My register status is open.", inputKind: "statement", semanticEntity: null },
      ],
      essence: [["present", "speaker", "register status", "open"]],
    }],
  });

  assert.deepEqual(modelInput.semanticEvidence.recentInputs.map((entry) => entry.text), [
    "My name is Austin.",
    "My register status is open.",
  ]);
  assert.deepEqual(modelInput.semanticEvidence.rows, [[
    "present", "speaker", "register status", "open",
  ]]);
  assert.equal(discovery.decision, "build");
  assert.deepEqual(
    discovery.buildCommand.capabilityRequest.operations[0].inputs[0].bindingHint,
    { source: "contextdb", subject: "speaker", property: "register_status" }
  );
});

test("Convert authoring corrects a model that declines a browser-resolved capability as local recall", async () => {
  const exactSegments = ["What is my register status?"];
  const corrected = discoveryParsed([
    input("status", {
      source: "contextdb",
      subject: "speaker",
      property: "register_status",
      resolver: null,
      aliases: null,
      value: null,
    }),
  ]);
  corrected.answerPlan = {
    source: "contextdb",
    operationId: "report",
    subject: "speaker",
    property: "register_status",
    inputName: "status",
    outputName: "report",
    statement: "The browser-resolved speaker property supplies the report.",
  };
  let calls = 0;
  const discovery = await discoverComputeCapability({
    openai: { chat: { completions: { create: async () => {
      calls += 1;
      const response = calls === 1 ? {
        decision: "not_compute",
        confidence: 0.9,
        reason: "This is local recall.",
        capabilityId: null,
        entityId: null,
        operationId: null,
        answerPlan: null,
        inputValues: [],
        capabilityRequest: null,
      } : corrected;
      return { choices: [{ message: { content: JSON.stringify(response) } }] };
    } } } },
    utterance: exactSegments[0],
    requestedBy: "u:test",
    requirementSegments: exactSegments,
  });

  assert.equal(calls, 2);
  assert.equal(discovery.decision, "build");
});

test("Convert removes a deictic prefix fused into a generated speaker property", () => {
  const request = normalizeGeneratedBuildRequest(
    discoveryParsed([
      input("register_status", {
        source: "contextdb",
        subject: "speaker",
        property: "myRegisterStatus",
        resolver: null,
        aliases: null,
        value: null,
      }),
    ], { answerTemplate: "The register status is {{register_status}}." }),
    segments.join("\n"),
    "u:test",
    segments
  );

  assert.equal(request.operations[0].inputs[0].bindingHint.subject, "speaker");
  assert.equal(request.operations[0].inputs[0].bindingHint.property, "register_status");
});

test("Convert preserves an explicitly declared property even when its name begins with my", () => {
  const explicitSegments = [
    "Create a generic property report.",
    "Its required input is named status. Its ContextDB subject is speaker and its property is my status.",
  ];
  const request = normalizeGeneratedBuildRequest(
    discoveryParsed([
      input("status", {
        source: "contextdb",
        subject: "speaker",
        property: "myStatus",
        resolver: null,
        aliases: null,
        value: null,
      }),
    ]),
    explicitSegments.join("\n"),
    "u:test",
    explicitSegments
  );
  assert.equal(request.operations[0].inputs[0].bindingHint.property, "myStatus");
});

test("Convert removes a redundant deictic owner while preserving the ContextDB value input", () => {
  const request = normalizeGeneratedBuildRequest(
    discoveryParsed([
      input("user", {
        source: "utterance",
        subject: null,
        property: null,
        resolver: "person",
        aliases: null,
        value: null,
      }),
      input("status", {
        source: "contextdb",
        subject: "speaker",
        property: "register status",
        resolver: null,
        aliases: null,
        value: null,
      }),
    ], {
      examples: [{
        text: "Give me the register status report.",
        inputValues: [{ name: "user", value: "me" }],
      }],
    }),
    segments.join("\n"),
    "u:test",
    segments
  );

  assert.deepEqual(request.operations[0].inputs.map((field) => field.name), ["status"]);
  assert.equal(request.operations[0].utteranceExamples[0].text, "Give me the register status report.");
  assert.deepEqual(request.operations[0].utteranceExamples[0].inputs, {});
});

test("Convert preserves a real non-deictic person input beside a speaker ContextDB binding", () => {
  const targetSegments = [
    "Create a report for a requested user using my preferred format.",
    "The user input names the requested person.",
  ];
  const request = normalizeGeneratedBuildRequest(
    discoveryParsed([
      input("user", {
        source: "utterance",
        subject: null,
        property: null,
        resolver: "person",
        aliases: null,
        value: null,
      }),
      input("preferred_format", {
        source: "contextdb",
        subject: "speaker",
        property: "preferred format",
        resolver: null,
        aliases: null,
        value: null,
      }),
    ], {
      examples: [{
        text: "Create Austin's report.",
        inputValues: [{ name: "user", value: "Austin" }],
      }],
    }),
    targetSegments.join("\n"),
    "u:test",
    targetSegments
  );

  assert.deepEqual(
    request.operations[0].inputs.map((field) => field.name),
    ["user", "preferred_format"]
  );
});

test("Convert preserves an explicitly named user input instead of guessing that it is an owner", () => {
  const explicitSegments = [
    "Create a current account report.",
    "It has one required string input named user. Its source is ContextDB, subject speaker, and property account owner.",
  ];
  const request = normalizeGeneratedBuildRequest(
    discoveryParsed([
      input("user", {
        source: "contextdb",
        subject: "speaker",
        property: "account owner",
        resolver: null,
        aliases: null,
        value: null,
      }),
    ]),
    explicitSegments.join("\n"),
    "u:test",
    explicitSegments
  );

  assert.deepEqual(request.operations[0].inputs.map((field) => field.name), ["user"]);
  assert.equal(request.operations[0].inputs[0].bindingHint.subject, "speaker");
});

test("EntityPlan generation cannot re-add the current speaker as a redundant ordinary input", async () => {
  const buildRequest = normalizeGeneratedBuildRequest(
    discoveryParsed([
      input("status", {
        source: "contextdb",
        subject: "speaker",
        property: "register status",
        resolver: null,
        aliases: null,
        value: null,
      }),
    ]),
    segments.join("\n"),
    "u:test",
    segments
  );
  const generatedInputs = [{
    operationId: "report",
    inputs: [input("user", {
      source: "utterance",
      subject: null,
      property: null,
      resolver: "person",
      aliases: null,
      value: null,
    })],
    utteranceExamples: [{
      text: "Give me the register status report.",
      inputValues: [{ name: "user", value: "me" }],
    }],
  }];

  const attached = attachGeneratedInputs(buildRequest, generatedInputs, {
    originalUtterance: segments.join("\n"),
  });
  assert.deepEqual(attached.operations[0].inputs.map((field) => field.name), ["status"]);

  const plan = {
    schemaVersion: 1,
    name: "Register status report",
    provider: "browser-resolved inputs",
    inputRequirements: generatedInputs,
    protectedAssetRequirements: [],
    executionPlan: {
      requests: [],
      response: {
        operationId: "report",
        outputs: [{
          name: "report",
          value: {
            source: "input",
            requestId: null,
            path: null,
            inputName: "status",
            literal: null,
            prefix: "The register status is ",
            suffix: ".",
          },
        }],
      },
    },
  };
  const spec = await buildComputeEntitySpec({
    capabilityRequest: buildRequest,
    requestedBy: "u:test",
    originalUtterance: segments.join("\n"),
    generatedImplementation: JSON.stringify(plan),
  });
  assert.deepEqual(
    spec.computeEntity.manifest.operations[0].inputs.map((field) => field.name),
    ["status"]
  );
  assert.match(
    JSON.stringify(spec.computeEntity.published.actions),
    /req=>body\.status/
  );
});
