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
  DEFAULT_MAX_PENDING_AGE_MS,
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

test("background discovery gets one semantic correction when the answer plan contradicts the contract", async () => {
  const invalid = {
    decision: "build_compute",
    confidence: 0.99,
    reason: "Return a remembered property.",
    capabilityId: "property_report",
    entityId: null,
    operationId: "report",
    answerPlan: {
      source: "contextdb",
      operationId: "report",
      subject: "speaker",
      property: "register_status",
      inputName: "status",
      outputName: "report",
      statement: "The speaker's register_status property answers the request.",
    },
    inputValues: [],
    capabilityRequest: {
      ...buildRequest,
      capabilityIdHint: "property_report",
      operations: [{ ...buildRequest.operations[0], operationId: "different_operation" }],
    },
  };
  let correctionBody;
  const corrected = await retrieveComputeCapabilityDiscovery({
    jobId: "resp_invalid_semantics",
    utterance: "Create an entity that tells me my register status.",
    requestedBy: "u:2",
    requirementSegments: ["Create an entity that tells me my register status."],
    retrieveResponse: async () => ({
      id: "resp_invalid_semantics",
      status: "completed",
      output_text: JSON.stringify(invalid),
    }),
    startResponse: async (body) => {
      correctionBody = body;
      return { id: "resp_corrected_semantics", status: "queued" };
    },
  });

  assert.equal(corrected.pending, true);
  assert.equal(corrected.jobId, "compute-discovery-correction:1:resp_corrected_semantics");
  assert.match(correctionBody.input.at(-1).content, /Reconsider the answerPlan first/);
  assert.match(correctionBody.input.at(-1).content, /ANSWER_PLAN_OPERATION_MISMATCH/);
});

test("a second invalid background discovery result fails closed instead of starting a loop", async () => {
  let starts = 0;
  await assert.rejects(
    retrieveComputeCapabilityDiscovery({
      jobId: "compute-discovery-correction:1:resp_still_invalid",
      utterance: "Build the requested capability.",
      retrieveResponse: async (jobId) => ({
        id: jobId,
        status: "completed",
        output_text: "not json",
      }),
      startResponse: async () => {
        starts += 1;
        return { id: "must_not_start", status: "queued" };
      },
    }),
    (error) => error?.code === "INVALID_MODEL_JSON"
  );
  assert.equal(starts, 0);
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
  assert.match(submitted.input[0].content, /grammatical owner used only as a ContextDB binding subject/);
  assert.match(submitted.input[0].content, /never add a separate user or speaker input/);
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

test("a model response cannot remain pending beyond the bounded job lifetime", () => {
  const nowMs = Date.UTC(2026, 7, 20, 12, 0, 0);
  const createdAtSeconds = (nowMs - DEFAULT_MAX_PENDING_AGE_MS - 1) / 1_000;
  assert.throws(
    () => backgroundResponseState({
      status: "in_progress",
      created_at: createdAtSeconds,
    }, { nowMs }),
    (error) => {
      assert.equal(error.code, "OPENAI_BACKGROUND_RESPONSE_STALLED");
      assert.equal(error.status, 408);
      assert.equal(error.pendingStatus, "in_progress");
      return true;
    }
  );
});

test("a recent or timestamp-free pending response remains resumable", () => {
  const nowMs = Date.UTC(2026, 7, 20, 12, 0, 0);
  assert.equal(backgroundResponseState({
    status: "queued",
    created_at: (nowMs - DEFAULT_MAX_PENDING_AGE_MS) / 1_000,
  }, { nowMs }).pending, true);
  assert.equal(backgroundResponseState({ status: "in_progress" }, { nowMs }).pending, true);
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
