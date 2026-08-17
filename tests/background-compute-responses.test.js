"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  startComputeCapabilityDiscovery,
  retrieveComputeCapabilityDiscovery,
} = require("../app/routes/capabilityDiscovery");
const {
  backgroundImplementationInput,
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

test("background discovery drops mistyped teaching annotations and keeps literal numeric bindings", async () => {
  const completed = await retrieveComputeCapabilityDiscovery({
    jobId: "resp_discovery_numeric",
    utterance: "What is 8 plus 13?",
    requestedBy: "u:2",
    retrieveResponse: async () => ({
      id: "resp_discovery_numeric",
      status: "completed",
      output_text: JSON.stringify({
        decision: "build_compute",
        confidence: 0.99,
        reason: "A deterministic calculation is required.",
        capabilityId: "math.add.two_numbers",
        entityId: null,
        operationId: "add",
        inputValues: [
          { name: "number1", value: "8" },
          { name: "number2", value: "13" },
        ],
        capabilityRequest: {
          schemaVersion: 1,
          kind: "computeCapabilityBuild",
          capabilityIdHint: "math.add.two_numbers",
          name: "Add two numbers",
          description: "Adds two required numbers.",
          operations: [{
            operationId: "add",
            description: "Adds two required numbers.",
            inputs: [
              {
                name: "number1",
                type: "number",
                required: true,
                description: "First number.",
                bindingHint: { source: "utterance", subject: null, property: null, resolver: "number", aliases: null, value: null },
                clarification: "What is the first number?",
                defaultValue: null,
                validation: null,
              },
              {
                name: "number2",
                type: "number",
                required: true,
                description: "Second number.",
                bindingHint: { source: "utterance", subject: null, property: null, resolver: "number", aliases: null, value: null },
                clarification: "What is the second number?",
                defaultValue: null,
                validation: null,
              },
            ],
            outputs: [{
              name: "sum",
              type: "number",
              required: true,
              description: "Numeric sum.",
              bindingHint: null,
              clarification: null,
              defaultValue: null,
              validation: null,
            }],
            freshness: { mode: "none", ttlSeconds: 0 },
            answerTemplate: "{{number1}} plus {{number2}} is {{sum}}.",
            utteranceExamples: [{
              text: "Add the first number and the second number.",
              inputValues: [
                { name: "number1", value: "first number" },
                { name: "number2", value: "second number" },
              ],
            }],
            calculation: {
              operator: "add",
              operands: [
                { source: "input", inputName: "number1", literal: null },
                { source: "input", inputName: "number2", literal: null },
              ],
              outputName: "sum",
            },
          }],
        },
      }),
    }),
  });

  assert.equal(completed.discovery.decision, "build");
  assert.deepEqual(completed.discovery.inputValues, { number1: 8, number2: 13 });
  assert.deepEqual(
    completed.discovery.buildCommand.capabilityRequest.operations[0].utteranceExamples.at(-1),
    { text: "What is 8 plus 13?", inputs: { number1: 8, number2: 13 } }
  );
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
  assert.deepEqual(submitted.tools, [{ type: "web_search", search_context_size: "medium" }]);
  assert.equal(submitted.tool_choice, "auto");
  assert.match(
    submitted.input[0].content,
    /Never fetch contextdb, utterance, environment, or default binding sources/
  );
  assert.match(submitted.input[0].content, /Do not search when the operation only transforms/);

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

test("a provider build retry may research only the selected official provider domains", () => {
  const body = backgroundImplementationInput({
    capabilityRequest: buildRequest,
    originalUtterance: "What is the weather today?",
    buildContinuation: {
      schemaVersion: 1,
      attempt: 1,
      validationCode: "PROVIDER_RESPONSE_INVALID",
      validationMessage: "The provider response path is invalid.",
      previousOutput: JSON.stringify({
        url: "https://api.open-meteo.com/v1/forecast",
        acquisition: "https://open-meteo.com/en/docs",
      }),
    },
  });
  assert.deepEqual(body.tools, [{
    type: "web_search",
    search_context_size: "high",
    filters: { allowed_domains: ["api.open-meteo.com", "open-meteo.com"] },
  }]);
  assert.equal(body.tool_choice, "required");
  assert.deepEqual(body.include, ["web_search_call.action.sources"]);
});
