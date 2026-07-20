"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { discoverComputeCapability } = require("../app/routes/capabilityDiscovery");
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
          { target: "{|axios|}", chain: [{ access: "get", params: ["https://api.example.com/colors", { params: { name: "{|req=>body.color|}" } }] }], assign: "{|response|}" },
          { target: "{|res|}!", chain: [{ access: "send", params: [{ rgb: "{|response=>data.rgb|}" }] }] },
        ],
        data: {},
      },
    },
  });
  assert.equal(result.computeEntity.capabilityId, "color.rgb.lookup");
  assert.deepEqual(result.computeEntity.published.data.allowedHosts, ["api.example.com"]);
});
