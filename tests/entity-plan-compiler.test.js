"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ENTITY_PLAN_SCHEMA,
  buildComputeEntitySpec,
} = require("../app/routes/capabilityBlueprints");

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
  assert.equal(ENTITY_PLAN_SCHEMA.properties.published, undefined);
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
