"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  discoverComputeCapability,
  localGraphOnlyDiscovery,
} = require("../app/routes/capabilityDiscovery");
const { buildComputeEntitySpec, GENERIC_BLUEPRINT_ID } = require("../app/routes/capabilityBlueprints");

const request = {
  schemaVersion: 1,
  kind: "computeCapabilityBuild",
  capabilityIdHint: "color.rgb.lookup",
  name: "RGB lookup",
  description: "Returns RGB values for a named color.",
  operations: [{
    operationId: "lookup",
    inputs: [{ name: "color", type: "string", required: true, bindingHint: { source: "utterance" }, clarification: "Which color?" }],
    outputs: [{ name: "rgb", type: "string", required: true }],
    utteranceExamples: [{ text: "What is the RGB for purple?", inputs: { color: "purple" } }],
    answerTemplate: "{{rgb}}",
  }],
};

const model = (value) => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) } } });

test("generic discovery can request an uncatalogued entity capability", async () => {
  const result = await discoverComputeCapability({
    openai: model({ decision: "build_compute", confidence: 0.98, reason: "A lookup is required.", capabilityRequest: request }),
    utterance: "What is the RGB for purple?",
    requestedBy: "u:7",
  });
  assert.equal(result.decision, "build");
  assert.equal(result.buildCommand.blueprintId, GENERIC_BLUEPRINT_ID);
  assert.equal(result.buildCommand.capabilityRequest.capabilityIdHint, "color.rgb.lookup");
});

test("ContextDB recall misses cannot be promoted into JPL entities", async () => {
  let modelCalls = 0;
  const result = await discoverComputeCapability({
    openai: {
      chat: {
        completions: {
          create: async () => {
            modelCalls += 1;
            return model({
              decision: "build_compute",
              confidence: 0.99,
              reason: "Count locally stored fruit.",
              capabilityRequest: request,
            }).chat.completions.create();
          },
        },
      },
    },
    utterance: "How many limes are in the refrigerator?",
    requestedBy: "u:7",
    semanticEvidence: [{
      routing: {
        missCategory: "NEW_MODIFIER_COMBINATION",
        localGraphCandidate: true,
        computeEligible: false,
      },
    }],
  });

  assert.equal(result.decision, "not_compute");
  assert.equal(result.source, "local-graph-router");
  assert.equal(result.diagnostics.code, "LOCAL_GRAPH_PATH_REQUIRED");
  assert.equal(modelCalls, 0);
});

test("the local graph routing guard is reusable by background discovery", () => {
  const result = localGraphOnlyDiscovery({
    utterance: "How many limes are in the refrigerator?",
    semanticEvidence: [{
      routing: {
        missCategory: "NEW_SYNTAX_PATTERN",
        localGraphCandidate: true,
        computeEligible: false,
      },
    }],
  });
  assert.equal(result.decision, "not_compute");
  assert.equal(result.source, "local-graph-router");
});

test("compute discovery proceeds after the browser exhausts local graph repair", async () => {
  let modelCalls = 0;
  const result = await discoverComputeCapability({
    openai: {
      chat: {
        completions: {
          create: async () => {
            modelCalls += 1;
            return model({
              decision: "build_compute",
              confidence: 0.99,
              reason: "Fresh external data is required.",
              capabilityRequest: request,
              inputValues: [{ name: "color", value: "purple" }],
            }).chat.completions.create();
          },
        },
      },
    },
    utterance: "What is the RGB for purple?",
    requestedBy: "u:7",
    semanticEvidence: [{
      routing: {
        missCategory: "NEW_MODIFIER_COMBINATION",
        localGraphCandidate: true,
        computeEligible: true,
        localRepairExhausted: true,
      },
    }],
  });

  assert.equal(result.decision, "build");
  assert.equal(modelCalls, 1);
});

test("discovery preserves multiple explicit utterance inputs for the entity operation", async () => {
  const multiInputRequest = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "external.status.lookup",
    name: "External status lookup",
    description: "Looks up fresh external status for a location and date.",
    operations: [{
      operationId: "lookup",
      inputs: [
        {
          name: "location",
          type: "string",
          required: true,
          bindingHint: { source: "utterance", resolver: "location" },
          clarification: "Which location?",
        },
        {
          name: "time_reference",
          type: "string",
          required: true,
          bindingHint: { source: "utterance", resolver: "date" },
          clarification: "Which date?",
        },
      ],
      outputs: [{ name: "status", type: "string", required: true }],
      utteranceExamples: [{
        text: "What is the status today in New York?",
        inputValues: [
          { name: "location", value: "New York" },
          { name: "time_reference", value: "today" },
        ],
      }],
      answerTemplate: "The status in {{location}} for {{time_reference}} is {{status}}.",
    }],
  };
  const result = await discoverComputeCapability({
    openai: model({
      decision: "build_compute",
      confidence: 0.99,
      reason: "Fresh external data is required.",
      operationId: "lookup",
      capabilityRequest: multiInputRequest,
      inputValues: [
        { name: "location", value: "New York" },
        { name: "time_reference", value: "today" },
      ],
    }),
    utterance: "What is the status today in New York?",
    requestedBy: "u:7",
  });

  assert.equal(result.decision, "build");
  assert.deepEqual(result.inputValues, {
    location: "New York",
    time_reference: "today",
  });
});

test("the generic builder validates entity-owned declarative implementation data", async () => {
  const result = await buildComputeEntitySpec({
    capabilityRequest: request,
    requestedBy: "u:7",
    generatedImplementation: {
      name: "RGB lookup",
      provider: "public color provider",
      published: {
        modules: { axios: "axios" },
        actions: [
          { target: "{|axios|}", chain: [{ access: "get", params: ["https://httpbin.org/anything", { params: { name: "{|req=>body.color|}" } }] }], assign: "{|response|}" },
          { target: "{|res|}!", chain: [{ access: "send", params: [{ rgb: "{|response=>data.rgb|}" }] }] },
        ],
        data: {},
      },
    },
  });
  assert.equal(result.computeEntity.capabilityId, "color.rgb.lookup");
  assert.deepEqual(result.computeEntity.published.data.allowedHosts, ["httpbin.org"]);
});
