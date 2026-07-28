"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  startComputeCapabilityDiscovery,
  retrieveComputeCapabilityDiscovery,
} = require("../app/routes/capabilityDiscovery");
const {
  startComputeEntitySpecBackground,
  retrieveComputeEntitySpecBackground,
} = require("../app/routes/capabilityBlueprints");
const {
  backgroundResponseState,
} = require("../app/routes/openAiBackgroundResponse");

const buildRequest = {
  schemaVersion: 1,
  kind: "computeCapabilityBuild",
  capabilityIdHint: "generic_lookup",
  name: "Generic lookup",
  description: "Looks up a value.",
  operations: [{
    operationId: "lookup",
    description: "Looks up a value.",
    inputs: [],
    outputs: [{
      name: "value",
      type: "string",
      required: true,
      description: "The value.",
      bindingHint: null,
      clarification: null,
      defaultValue: null,
      validation: null,
    }],
    freshness: { mode: "none", ttlSeconds: 0 },
    answerTemplate: "{{value}}",
    utteranceExamples: ["Look up the value"],
  }],
};

test("background discovery starts once and returns a resumable response id", async () => {
  let submitted;
  const started = await startComputeCapabilityDiscovery({
    utterance: "Look up the value",
    requestedBy: "u:2",
    startResponse: async (body) => {
      submitted = body;
      return { id: "resp_discovery_123", status: "queued" };
    },
  });

  assert.equal(started.jobId, "resp_discovery_123");
  assert.equal(started.pending, true);
  assert.equal(submitted.background, true);
  assert.equal(submitted.store, true);
  assert.equal(submitted.text.format.type, "json_schema");
  assert.equal(submitted.input[1].role, "user");
});

test("fresh Lambdas can retrieve pending and completed discovery responses", async () => {
  const pending = await retrieveComputeCapabilityDiscovery({
    jobId: "resp_discovery_123",
    utterance: "Look up the value",
    retrieveResponse: async () => ({ id: "resp_discovery_123", status: "in_progress" }),
  });
  assert.equal(pending.pending, true);
  assert.equal(pending.status, "in_progress");

  const completed = await retrieveComputeCapabilityDiscovery({
    jobId: "resp_discovery_123",
    utterance: "Look up the value",
    retrieveResponse: async () => ({
      id: "resp_discovery_123",
      status: "completed",
      output_text: JSON.stringify({
        decision: "not_compute",
        confidence: 0.9,
        reason: "No compute is needed.",
        capabilityId: null,
        entityId: null,
        operationId: null,
        inputValues: [],
        capabilityRequest: null,
      }),
    }),
  });
  assert.equal(completed.pending, false);
  assert.equal(completed.discovery.decision, "not_compute");
});

test("background entity generation returns JSON for server validation after polling", async () => {
  let submitted;
  const started = await startComputeEntitySpecBackground({
    capabilityRequest: buildRequest,
    originalUtterance: "Look up the value",
    startResponse: async (body) => {
      submitted = body;
      return { id: "resp_builder_123", status: "queued" };
    },
  });
  assert.equal(started.jobId, "resp_builder_123");
  assert.equal(submitted.background, true);
  assert.equal(submitted.model, "gpt-5.6-terra");
  assert.equal(submitted.text.format.type, "json_schema");
  assert.equal(submitted.text.format.strict, true);
  assert.ok(submitted.text.format.schema.properties.executionPlan);

  const pending = await retrieveComputeEntitySpecBackground({
    jobId: started.jobId,
    retrieveResponse: async () => ({ id: started.jobId, status: "queued" }),
  });
  assert.equal(pending.pending, true);

  const json = JSON.stringify({
    schemaVersion: 1,
    name: "Generic lookup",
    provider: "provider",
    inputRequirements: [],
    protectedAssetRequirements: [],
    executionPlan: {
      requests: [{
        operationId: "lookup",
        requestId: "lookup_response",
        method: "GET",
        url: "https://api.example.dev/lookup",
        parameters: [],
      }],
      response: {
        operationId: "lookup",
        outputs: [{
          name: "value",
          value: {
            source: "provider_response",
            requestId: "lookup_response",
            path: "value",
            inputName: null,
            literal: null,
            prefix: "",
            suffix: "",
          },
        }],
      },
    },
  });
  const completed = await retrieveComputeEntitySpecBackground({
    jobId: started.jobId,
    retrieveResponse: async () => ({
      id: started.jobId,
      status: "completed",
      output: [{ content: [{ type: "output_text", text: json }] }],
    }),
  });
  assert.equal(completed.pending, false);
  assert.equal(completed.generatedImplementation, json);
});

test("terminal background failures remain explicit instead of polling forever", () => {
  assert.throws(
    () => backgroundResponseState({
      status: "failed",
      error: { message: "provider model failed" },
    }),
    /provider model failed/
  );
});
