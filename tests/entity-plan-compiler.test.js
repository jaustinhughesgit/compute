"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ENTITY_PLAN_SCHEMA,
  attachGeneratedInputs,
  buildComputeEntitySpec,
  declaredInputProjectionImplementation,
  hasDeclaredDeterministicImplementation,
} = require("../app/routes/capabilityBlueprints");
const { reconcileSingleResponseOutput } = require("../app/routes/capabilityEntityPlan");

const baseRequest = {
  schemaVersion: 1,
  kind: "computeCapabilityBuild",
  capabilityIdHint: "weather_lookup",
  name: "Weather lookup",
  description: "Fetches weather for a requested location.",
  operations: [{
    operationId: "get_weather",
    description: "Fetch weather.",
    inputs: [],
    outputs: [{
      name: "temperature",
      type: "number",
      required: true,
      description: "Temperature.",
    }],
    freshness: { mode: "none", ttlSeconds: 0 },
    answerTemplate: "{{temperature}}",
    utteranceExamples: ["What is the weather?"],
  }],
};

function locationInput() {
  return {
    name: "location",
    type: "string",
    required: true,
    description: "The explicit place from the utterance.",
    bindingHint: {
      source: "utterance",
      subject: null,
      property: null,
      resolver: "location",
      aliases: null,
      value: null,
    },
    clarification: "Which city or location should I use?",
    defaultValue: null,
    validation: null,
  };
}

function plan(parameterValue) {
  return {
    schemaVersion: 1,
    name: "Weather lookup",
    provider: "Weather provider",
    inputRequirements: [{
      operationId: "get_weather",
      inputs: [locationInput()],
      utteranceExamples: [{
        text: "What is the weather in New York?",
        inputValues: [{ name: "location", value: "New York" }],
      }],
    }],
    protectedAssetRequirements: [],
    executionPlan: {
      requests: [{
        operationId: "get_weather",
        requestId: "weather_response",
        method: "GET",
        url: "https://api.openweathermap.org/data/2.5/weather",
        parameters: [{
          location: "query",
          name: "q",
          value: parameterValue,
        }],
      }],
      response: {
        operationId: "get_weather",
        outputs: [{
          name: "temperature",
          value: {
            source: "provider_response",
            requestId: "weather_response",
            path: "main.temp",
            inputName: null,
            literal: null,
            prefix: "",
            suffix: "",
          },
        }],
      },
    },
  };
}

test("EntityPlan schema is strict and does not expose raw JPL containers", () => {
  assert.equal(ENTITY_PLAN_SCHEMA.additionalProperties, false);
  assert.ok(ENTITY_PLAN_SCHEMA.properties.executionPlan);
  assert.equal(
    ENTITY_PLAN_SCHEMA.properties.executionPlan.properties.requests.minItems,
    undefined
  );
  assert.equal(ENTITY_PLAN_SCHEMA.properties.published, undefined);
});

test("EntityPlan compiles a browser-resolved ContextDB input without a provider request", async () => {
  const request = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "register_status_report",
    name: "Register status report",
    description: "Reports the register status supplied by the browser.",
    operations: [{
      operationId: "generate_register_status_report",
      description: "Generate a register status report.",
      inputs: [{
        name: "status",
        type: "string",
        required: true,
        description: "Current register status.",
        bindingHint: {
          source: "contextdb",
          subject: "speaker",
          property: "register_status",
        },
      }],
      outputs: [{
        name: "report",
        type: "string",
        required: true,
        description: "Current status report.",
      }],
      freshness: { mode: "none", ttlSeconds: 0 },
      answerTemplate: "{{report}}",
      utteranceExamples: ["Give me the register status report"],
    }],
  };
  const result = await buildComputeEntitySpec({
    capabilityRequest: request,
    requestedBy: "u:2",
    originalUtterance: "Give me the register status report",
    generatedImplementation: {
      schemaVersion: 1,
      name: "Register status report",
      provider: "browser-resolved input",
      inputRequirements: [],
      protectedAssetRequirements: [],
      executionPlan: {
        requests: [],
        response: {
          operationId: "generate_register_status_report",
          outputs: [{
            name: "report",
            value: {
              source: "input",
              requestId: null,
              path: null,
              inputName: "status",
              literal: null,
              prefix: "The current register status is ",
              suffix: ".",
            },
          }],
        },
      },
    },
  });

  assert.deepEqual(result.computeEntity.published.modules, {});
  assert.deepEqual(result.computeEntity.published.data.allowedHosts, []);
  assert.deepEqual(result.computeEntity.published.actions, [{
    target: "{|res|}!",
    chain: [{
      access: "send",
      params: [{ report: "The current register status is {|req=>body.status|}." }],
    }],
  }]);
});

test("EntityPlan generation cannot split one declared effect referent into a required brand input", async () => {
  const request = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "vehicle_cleaner",
    name: "Vehicle cleaner",
    description: "Clean any user-selected vehicle.",
    operations: [{
      operationId: "wash",
      description: "Clean the selected vehicle.",
      inputs: [{
        name: "vehicle",
        type: "string",
        required: true,
        description: "The vehicle referent spoken by the user.",
        bindingHint: { source: "utterance", resolver: "entity_reference" },
        clarification: "Which vehicle should be cleaned?",
      }],
      outputs: [{ name: "status", type: "string", required: true, description: "The clean state." }],
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "vehicle",
        currentValue: "dirty",
        newValue: "clean",
      }],
      freshness: { mode: "none", ttlSeconds: 0 },
      answerTemplate: "Your {{vehicle}} is clean",
      utteranceExamples: [
        { text: "wash my car", inputs: { vehicle: "car" } },
        { text: "wash my Camry", inputs: { vehicle: "camry" } },
        { text: "wash my Toyota", inputs: { vehicle: "toyota" } },
      ],
    }],
  };
  const result = await buildComputeEntitySpec({
    capabilityRequest: request,
    requestedBy: "u:test",
    originalUtterance: [
      "I can say wash my car, wash my Camry, or wash my Toyota, or wash my Toyota Camry.",
      "I should be able to use any car, not just a Toyota Camry.",
    ].join("\n"),
    generatedImplementation: {
      schemaVersion: 1,
      name: "Vehicle cleaner",
      provider: "local state transition",
      inputRequirements: [{
        operationId: "wash",
        inputs: [{
          name: "car_brand",
          type: "string",
          required: true,
          description: "A model-invented specialization of the vehicle referent.",
          bindingHint: {
            source: "utterance",
            subject: null,
            property: null,
            resolver: "string",
            aliases: null,
            value: null,
          },
          clarification: "Which brand?",
          defaultValue: null,
          validation: null,
        }],
        utteranceExamples: [{
          text: "wash my Toyota",
          inputValues: [{ name: "car_brand", value: "Toyota" }],
        }],
      }],
      protectedAssetRequirements: [],
      executionPlan: {
        requests: [],
        response: {
          operationId: "wash",
          outputs: [{
            name: "status",
            value: {
              source: "literal",
              requestId: null,
              path: null,
              inputName: null,
              literal: "clean",
              prefix: "",
              suffix: "",
            },
          }],
        },
      },
    },
  });
  assert.deepEqual(
    result.computeEntity.manifest.operations[0].inputs.map((input) => input.name),
    ["vehicle"]
  );
  assert.equal(
    JSON.stringify(result.computeEntity.published.actions).includes("car_brand"),
    false
  );
});

test("a one-slot EntityPlan response adopts the contract's compatible output identity", async () => {
  const mismatched = plan({
    source: "input",
    requestId: null,
    path: null,
    inputName: "location",
    literal: null,
    prefix: "",
    suffix: "",
  });
  mismatched.executionPlan.response.outputs[0].name = "status";
  const result = await buildComputeEntitySpec({
    capabilityRequest: baseRequest,
    requestedBy: "u:2",
    originalUtterance: "What is the weather?",
    generatedImplementation: mismatched,
  });
  assert.deepEqual(
    result.computeEntity.published.actions.at(-1).chain[0].params[0],
    { temperature: "{|weather_response=>data.main.temp|}" }
  );
});

test("single-output reconciliation does not guess across incompatible or multi-slot contracts", () => {
  const generated = [{
    name: "status",
    value: { source: "literal", literal: "clean", prefix: "", suffix: "" },
  }];
  assert.equal(
    reconcileSingleResponseOutput(generated, { outputs: [{ name: "count", type: "number" }] })[0].name,
    "status"
  );
  assert.equal(reconcileSingleResponseOutput(generated, {
    outputs: [{ name: "state", type: "string" }, { name: "message", type: "string" }],
  })[0].name, "status");
});

test("a one-input local projection compiles without asking a model to rewrite its contract", async () => {
  const request = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "generic_property_report",
    name: "Generic property report",
    description: "Reports a value resolved by the browser.",
    operations: [{
      operationId: "report",
      description: "Return the resolved value.",
      inputs: [{
        name: "status",
        type: "string",
        required: true,
        description: "A current property value.",
        bindingHint: { source: "contextdb", subject: "speaker", property: "register_status" },
      }],
      outputs: [{ name: "report", type: "string", required: true, description: "The report value." }],
      freshness: { mode: "none", ttlSeconds: 0 },
      answerTemplate: "Your register status is {{report}}.",
      utteranceExamples: ["What is my register status?"],
    }],
  };
  let modelCalls = 0;
  const spec = await buildComputeEntitySpec({
    capabilityRequest: request,
    requestedBy: "u:2",
    originalUtterance: "What is my register status?",
    openai: { responses: { create: async () => { modelCalls += 1; throw new Error("must not run"); } } },
  });

  assert.equal(hasDeclaredDeterministicImplementation(request), true);
  assert.equal(modelCalls, 0);
  assert.equal(spec.computeEntity.provider, "local-declarative-input-projection");
  assert.deepEqual(spec.computeEntity.published.actions, [{
    target: "{|res|}!",
    chain: [{ access: "send", params: [{ report: "{|req=>body.status|}" }] }],
  }]);
});

test("a multi-input semantic transformation is not guessed as a local projection", () => {
  const request = structuredClone(baseRequest);
  request.operations[0].inputs = [locationInput(), {
    ...locationInput(), name: "date", bindingHint: { source: "utterance", resolver: "date" },
  }];
  request.operations[0].outputs = [{ name: "summary", type: "string", required: true }];
  assert.equal(declaredInputProjectionImplementation(request), null);
  assert.equal(hasDeclaredDeterministicImplementation(request), false);
});

test("a provider answer plan prevents a shape-compatible input from being mistaken for the answer", () => {
  const request = {
    schemaVersion: 1,
    kind: "computeCapabilityBuild",
    capabilityIdHint: "generic_lookup",
    name: "Generic lookup",
    description: "Looks up a provider value.",
    answerPlan: {
      source: "provider",
      operationId: "lookup",
      subject: null,
      property: null,
      inputName: "query",
      outputName: "result",
      statement: "A provider response supplies the result for the query.",
    },
    operations: [{
      operationId: "lookup",
      description: "Look up the query.",
      inputs: [{
        name: "query",
        type: "string",
        required: true,
        bindingHint: { source: "utterance", resolver: "string" },
        clarification: "What should I look up?",
      }],
      outputs: [{ name: "result", type: "string", required: true }],
      utteranceExamples: [{ text: "Look up purple.", inputs: { query: "purple" } }],
      answerTemplate: "{{result}}",
    }],
  };
  assert.equal(declaredInputProjectionImplementation(request), null);
  assert.equal(hasDeclaredDeterministicImplementation(request), false);
});

test("generated duplicate examples keep the literal spoken temporal value", () => {
  const request = JSON.parse(JSON.stringify(baseRequest));
  request.operations[0].inputs = [{
    name: "date",
    type: "string",
    required: true,
    bindingHint: { source: "utterance", resolver: "date" },
  }];
  request.operations[0].utteranceExamples = [{
    text: "What is the weather today?",
    inputs: { date: "today" },
  }];
  const merged = attachGeneratedInputs(request, [{
    operationId: "get_weather",
    inputs: [],
    utteranceExamples: [{
      text: "what is the weather today",
      inputValues: [{ name: "date", value: "2026-08-12" }],
    }],
  }]);
  assert.equal(merged.operations[0].utteranceExamples.length, 1);
  assert.deepEqual(merged.operations[0].utteranceExamples[0].inputs, { date: "today" });
});

test("provider research can strengthen an existing optional input required by execution", () => {
  const request = JSON.parse(JSON.stringify(baseRequest));
  request.operations[0].inputs = [{
    name: "location",
    type: "string",
    required: false,
    bindingHint: { source: "utterance", resolver: "location" },
    clarification: "Which location should I use?",
  }];
  request.operations[0].utteranceExamples = ["What is the weather today?"];
  const merged = attachGeneratedInputs(request, [{
    operationId: "get_weather",
    inputs: [locationInput()],
    utteranceExamples: [{
      text: "What is the weather in New York?",
      inputValues: [{ name: "location", value: "New York" }],
    }],
  }]);
  assert.equal(merged.operations[0].inputs[0].required, true);
  assert.deepEqual(
    merged.operations[0].utteranceExamples.at(-1).inputs,
    { location: "New York" }
  );
});

test("EntityPlan compiler adds a missing explicit input and generates JPL deterministically", async () => {
  const result = await buildComputeEntitySpec({
    capabilityRequest: baseRequest,
    requestedBy: "u:2",
    originalUtterance: "What is the weather in New York?",
    generatedImplementation: plan({
      source: "input",
      inputName: "location",
      requirementId: null,
      fieldName: null,
      literal: null,
      prefix: "",
      suffix: "",
    }),
  });
  const entity = result.computeEntity;
  assert.equal(entity.manifest.operations[0].inputs[0].name, "location");
  assert.equal(
    entity.published.actions[0].chain[0].params[1].params.q,
    "{|req=>body.location|}"
  );
  assert.deepEqual(
    entity.published.actions.at(-1).chain[0].params[0],
    { temperature: "{|weather_response=>data.main.temp|}" }
  );
});

test("EntityPlan compiler rejects an execution plan that drops its declared utterance input", async () => {
  await assert.rejects(
    buildComputeEntitySpec({
      capabilityRequest: baseRequest,
      requestedBy: "u:2",
      originalUtterance: "What is the weather in New York?",
      generatedImplementation: plan({
        source: "literal",
        inputName: null,
        requirementId: null,
        fieldName: null,
        literal: "New York",
        prefix: "",
        suffix: "",
      }),
    }),
    /does not use required ordinary input location/
  );
});

test("EntityPlan compiler rejects an optional input wired into every provider request", async () => {
  const request = JSON.parse(JSON.stringify(baseRequest));
  request.operations[0].inputs = [{
    ...locationInput(),
    required: false,
  }];
  request.operations[0].utteranceExamples = ["What is the weather today?"];
  const invalidPlan = plan({
    source: "input",
    inputName: "location",
    requirementId: null,
    fieldName: null,
    literal: null,
    prefix: "",
    suffix: "",
  });
  invalidPlan.inputRequirements = [];
  await assert.rejects(
    buildComputeEntitySpec({
      capabilityRequest: request,
      requestedBy: "u:2",
      originalUtterance: "What is the weather today?",
      generatedImplementation: invalidPlan,
    }),
    /provider request input location must be required or declare a defaultValue/
  );
});

test("EntityPlan composes an earlier provider response into a later provider request", async () => {
  const chained = plan({
    source: "input", inputName: "location", requirementId: null, fieldName: null,
    requestId: null, path: null, literal: null, prefix: "", suffix: "",
  });
  chained.executionPlan.requests = [{
    operationId: "get_weather", requestId: "geocode", method: "GET",
    url: "https://geocoding-api.open-meteo.com/v1/search",
    parameters: [{ location: "query", name: "name", value: {
      source: "input", inputName: "location", requirementId: null, fieldName: null,
      requestId: null, path: null, literal: null, prefix: "", suffix: "",
    } }],
  }, {
    operationId: "get_weather", requestId: "weather", method: "GET",
    url: "https://api.open-meteo.com/v1/forecast",
    parameters: ["latitude", "longitude"].map((name) => ({
      location: "query", name, value: {
        source: "provider_response", inputName: null, requirementId: null, fieldName: null,
        requestId: "geocode", path: `results.0.${name}`, literal: null, prefix: "", suffix: "",
      },
    })).concat({
      location: "query", name: "current", value: {
        source: "literal", inputName: null, requirementId: null, fieldName: null,
        requestId: null, path: null, literal: "temperature_2m", prefix: "", suffix: "",
      },
    }),
  }];
  chained.executionPlan.response.outputs[0].value.requestId = "weather";
  chained.executionPlan.response.outputs[0].value.path = "current.temperature_2m";
  const result = await buildComputeEntitySpec({
    capabilityRequest: baseRequest,
    requestedBy: "u:2",
    originalUtterance: "What is the weather in Raleigh?",
    generatedImplementation: chained,
  });
  assert.equal(
    result.computeEntity.published.actions[1].chain[0].params[1].params.latitude,
    "{|geocode=>data.results.0.latitude|}"
  );
});

test("EntityPlan cannot read a future provider response", async () => {
  const invalid = plan({
    source: "provider_response", inputName: null, requirementId: null, fieldName: null,
    requestId: "future", path: "value", literal: null, prefix: "", suffix: "",
  });
  await assert.rejects(buildComputeEntitySpec({
    capabilityRequest: baseRequest,
    requestedBy: "u:2",
    originalUtterance: "What is the weather?",
    generatedImplementation: invalid,
  }), /unavailable prior request future/);
});
