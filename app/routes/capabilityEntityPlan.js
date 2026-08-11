/**
 * Platform: Keeps model-generated capability designs declarative before they become executable entities.
 * Technical: Validates an EntityPlan and deterministically compiles declared inputs, protected injections, requests, and responses into JPL.
 */
"use strict";

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };
const NULLABLE_SCALAR = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const BINDING_HINT_SCHEMA = {
  anyOf: [{
    type: "object",
    additionalProperties: false,
    properties: {
      source: { type: "string", enum: ["utterance", "contextdb", "environment", "default"] },
      subject: NULLABLE_STRING,
      property: NULLABLE_STRING,
      resolver: NULLABLE_STRING,
      aliases: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
      value: NULLABLE_SCALAR,
    },
    required: ["source", "subject", "property", "resolver", "aliases", "value"],
  }, { type: "null" }],
};

const VALIDATION_SCHEMA = {
  anyOf: [{
    type: "object",
    additionalProperties: false,
    properties: {
      minimum: { anyOf: [{ type: "number" }, { type: "null" }] },
      maximum: { anyOf: [{ type: "number" }, { type: "null" }] },
      minLength: { anyOf: [{ type: "integer" }, { type: "null" }] },
      maxLength: { anyOf: [{ type: "integer" }, { type: "null" }] },
      pattern: NULLABLE_STRING,
    },
    required: ["minimum", "maximum", "minLength", "maxLength", "pattern"],
  }, { type: "null" }],
};

const INPUT_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    type: {
      type: "string",
      enum: ["string", "number", "integer", "boolean", "date", "datetime", "object", "array", "file", "any"],
    },
    required: { type: "boolean" },
    description: NULLABLE_STRING,
    bindingHint: BINDING_HINT_SCHEMA,
    clarification: NULLABLE_STRING,
    defaultValue: NULLABLE_SCALAR,
    validation: VALIDATION_SCHEMA,
  },
  required: [
    "name",
    "type",
    "required",
    "description",
    "bindingHint",
    "clarification",
    "defaultValue",
    "validation",
  ],
};

const INPUT_REQUIREMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    operationId: { type: "string", minLength: 1 },
    inputs: { type: "array", items: INPUT_FIELD_SCHEMA },
    utteranceExamples: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 1 },
          inputValues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1 },
                value: NULLABLE_SCALAR,
              },
              required: ["name", "value"],
            },
          },
        },
        required: ["text", "inputValues"],
      },
    },
  },
  required: ["operationId", "inputs", "utteranceExamples"],
};

const PROTECTED_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1 },
    required: { type: "boolean" },
    injection: {
      type: "object",
      additionalProperties: false,
      properties: {
        location: { type: "string", enum: ["query", "header", "body"] },
        parameter: { type: "string", minLength: 1 },
        prefix: { type: "string" },
      },
      required: ["location", "parameter", "prefix"],
    },
  },
  required: ["name", "required", "injection"],
};

const PROTECTED_REQUIREMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    requirementId: { type: "string", minLength: 1 },
    operationId: { type: "string", minLength: 1 },
    assetType: {
      type: "string",
      enum: [
        "credential",
        "identity_data",
        "contact_data",
        "location",
        "private_document",
        "private_note",
        "access_token",
        "encryption_key",
        "arbitrary_secret",
      ],
    },
    providerId: NULLABLE_STRING,
    providerName: { type: "string", minLength: 1 },
    providerHost: { type: "string", minLength: 1 },
    purpose: { type: "string", minLength: 1 },
    use: { type: "string", enum: ["authenticate", "inject", "reveal", "compare", "send", "share", "derive"] },
    approvalMode: { type: "string", enum: ["every_use", "session", "preapproved"] },
    acquisition: {
      anyOf: [{
        type: "object",
        additionalProperties: false,
        properties: {
          url: NULLABLE_STRING,
          instructions: NULLABLE_STRING,
        },
        required: ["url", "instructions"],
      }, { type: "null" }],
    },
    fields: { type: "array", minItems: 1, items: PROTECTED_FIELD_SCHEMA },
  },
  required: [
    "requirementId",
    "operationId",
    "assetType",
    "providerId",
    "providerName",
    "providerHost",
    "purpose",
    "use",
    "approvalMode",
    "acquisition",
    "fields",
  ],
};

const REQUEST_VALUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: { type: "string", enum: ["input", "protected", "literal"] },
    inputName: NULLABLE_STRING,
    requirementId: NULLABLE_STRING,
    fieldName: NULLABLE_STRING,
    literal: NULLABLE_SCALAR,
    prefix: { type: "string" },
    suffix: { type: "string" },
  },
  required: [
    "source",
    "inputName",
    "requirementId",
    "fieldName",
    "literal",
    "prefix",
    "suffix",
  ],
};

const RESPONSE_VALUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: { type: "string", enum: ["provider_response", "input", "literal"] },
    requestId: NULLABLE_STRING,
    path: NULLABLE_STRING,
    inputName: NULLABLE_STRING,
    literal: NULLABLE_SCALAR,
    prefix: { type: "string" },
    suffix: { type: "string" },
  },
  required: ["source", "requestId", "path", "inputName", "literal", "prefix", "suffix"],
};

const ENTITY_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    name: { type: "string", minLength: 1 },
    provider: { type: "string", minLength: 1 },
    inputRequirements: { type: "array", items: INPUT_REQUIREMENT_SCHEMA },
    protectedAssetRequirements: { type: "array", items: PROTECTED_REQUIREMENT_SCHEMA },
    executionPlan: {
      type: "object",
      additionalProperties: false,
      properties: {
        requests: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              operationId: { type: "string", minLength: 1 },
              requestId: { type: "string", pattern: "^[a-z][a-z0-9_.-]{1,127}$" },
              method: { type: "string", enum: ["GET"] },
              url: { type: "string", pattern: "^https://" },
              parameters: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    location: { type: "string", enum: ["query", "header", "body"] },
                    name: { type: "string", minLength: 1 },
                    value: REQUEST_VALUE_SCHEMA,
                  },
                  required: ["location", "name", "value"],
                },
              },
            },
            required: ["operationId", "requestId", "method", "url", "parameters"],
          },
        },
        response: {
          type: "object",
          additionalProperties: false,
          properties: {
            operationId: { type: "string", minLength: 1 },
            outputs: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string", minLength: 1 },
                  value: RESPONSE_VALUE_SCHEMA,
                },
                required: ["name", "value"],
              },
            },
          },
          required: ["operationId", "outputs"],
        },
      },
      required: ["requests", "response"],
    },
  },
  required: [
    "schemaVersion",
    "name",
    "provider",
    "inputRequirements",
    "protectedAssetRequirements",
    "executionPlan",
  ],
};

function cleanId(value, label) {
  const id = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(id)) {
    throw new Error(`${label} is invalid`);
  }
  return id;
}

function decorate(value, prefix = "", suffix = "") {
  if (!prefix && !suffix) return value;
  return `${prefix}${value == null ? "" : value}${suffix}`;
}

function compileRequestValue(raw, declaredInputs, protectedFields) {
  const source = String(raw?.source || "");
  if (source === "input") {
    const name = cleanId(raw.inputName, "request input name");
    if (!declaredInputs.has(name)) throw new Error(`entity plan references undeclared ordinary input ${name}`);
    return decorate(`{|req=>body.${name}|}`, raw.prefix, raw.suffix);
  }
  if (source === "protected") {
    const requirementId = cleanId(raw.requirementId, "protected requirement id");
    const fieldName = cleanId(raw.fieldName, "protected field name");
    if (!protectedFields.has(`${requirementId}.${fieldName}`)) {
      throw new Error(`entity plan references undeclared protected field ${requirementId}.${fieldName}`);
    }
    return decorate(`{|protected=>${requirementId}.${fieldName}|}`, raw.prefix, raw.suffix);
  }
  if (source === "literal") return decorate(raw.literal, raw.prefix, raw.suffix);
  throw new Error(`entity plan request value source ${source || "(blank)"} is unsupported`);
}

function compileResponseValue(raw, requestIds, declaredInputs) {
  const source = String(raw?.source || "");
  if (source === "provider_response") {
    const requestId = cleanId(raw.requestId, "response request id");
    if (!requestIds.has(requestId)) throw new Error(`entity plan response references unknown request ${requestId}`);
    const path = String(raw.path || "").trim().replace(/^data\./, "");
    if (!path || /[|{}]/.test(path)) throw new Error("entity plan provider response path is invalid");
    return decorate(`{|${requestId}=>data.${path}|}`, raw.prefix, raw.suffix);
  }
  if (source === "input") {
    const name = cleanId(raw.inputName, "response input name");
    if (!declaredInputs.has(name)) throw new Error(`entity plan response references undeclared input ${name}`);
    return decorate(`{|req=>body.${name}|}`, raw.prefix, raw.suffix);
  }
  if (source === "literal") return decorate(raw.literal, raw.prefix, raw.suffix);
  throw new Error(`entity plan response value source ${source || "(blank)"} is unsupported`);
}

function compileEntityPlan(rawPlan, buildRequest) {
  const plan = rawPlan && typeof rawPlan === "object" && !Array.isArray(rawPlan)
    ? JSON.parse(JSON.stringify(rawPlan))
    : null;
  if (!plan || Number(plan.schemaVersion) !== 1 || !plan.executionPlan) {
    throw new Error("entity plan schemaVersion 1 and executionPlan are required");
  }
  const operations = new Map((buildRequest?.operations || []).map((operation) => [
    String(operation.operationId),
    operation,
  ]));
  const declaredInputs = new Set((buildRequest?.operations || [])
    .flatMap((operation) => operation.inputs || [])
    .map((input) => String(input.name)));
  for (const group of plan.inputRequirements || []) {
    for (const input of group.inputs || []) declaredInputs.add(cleanId(input.name, "input requirement name"));
  }
  const protectedFields = new Set();
  for (const requirement of plan.protectedAssetRequirements || []) {
    const requirementId = cleanId(requirement.requirementId, "protected requirement id");
    for (const field of requirement.fields || []) {
      protectedFields.add(`${requirementId}.${cleanId(field.name, "protected field name")}`);
    }
  }

  const actions = [];
  const requestIds = new Set();
  for (const request of plan.executionPlan.requests || []) {
    const operationId = cleanId(request.operationId, "request operation id");
    if (!operations.has(operationId)) throw new Error(`entity plan request references unknown operation ${operationId}`);
    const requestId = cleanId(request.requestId, "request id");
    if (requestIds.has(requestId)) throw new Error(`entity plan contains duplicate request ${requestId}`);
    requestIds.add(requestId);
    const config = {};
    for (const parameter of request.parameters || []) {
      const containerName = parameter.location === "query"
        ? "params"
        : parameter.location === "header"
          ? "headers"
          : parameter.location === "body"
            ? "data"
            : null;
      if (!containerName) throw new Error(`entity plan parameter location ${parameter.location || "(blank)"} is unsupported`);
      config[containerName] ||= {};
      if (Object.prototype.hasOwnProperty.call(config[containerName], parameter.name)) {
        throw new Error(`entity plan contains duplicate ${parameter.location} parameter ${parameter.name}`);
      }
      config[containerName][parameter.name] = compileRequestValue(
        parameter.value,
        declaredInputs,
        protectedFields
      );
    }
    actions.push({
      target: "{|axios|}",
      chain: [{
        access: "get",
        params: [String(request.url || ""), config],
      }],
      assign: `{|${requestId}|}`,
    });
  }

  const response = plan.executionPlan.response || {};
  const responseOperationId = cleanId(response.operationId, "response operation id");
  const operation = operations.get(responseOperationId);
  if (!operation) throw new Error(`entity plan response references unknown operation ${responseOperationId}`);
  const unrelatedRequest = (plan.executionPlan.requests || []).find((request) =>
    String(request.operationId || "").trim().toLowerCase() !== responseOperationId
  );
  if (unrelatedRequest) {
    throw new Error(
      `entity plan request ${unrelatedRequest.requestId || "(unnamed)"} does not belong to response operation ${responseOperationId}`
    );
  }
  const declaredOutputs = new Set((operation.outputs || []).map((output) => String(output.name)));
  const payload = {};
  for (const output of response.outputs || []) {
    const name = cleanId(output.name, "response output name");
    if (!declaredOutputs.has(name)) throw new Error(`entity plan response contains undeclared output ${name}`);
    if (Object.prototype.hasOwnProperty.call(payload, name)) throw new Error(`entity plan contains duplicate output ${name}`);
    payload[name] = compileResponseValue(output.value, requestIds, declaredInputs);
  }
  actions.push({
    target: "{|res|}!",
    chain: [{ access: "send", params: [payload] }],
  });

  const actionText = JSON.stringify(actions);
  for (const input of operation.inputs || []) {
    if (input.required === false) continue;
    const escaped = String(input.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(
      String.raw`\{\|(?:req=>body\.)?${escaped}(?:=>[^|{}]+)?\|\}`,
      "i"
    ).test(actionText)) continue;
    const source = String(input?.bindingHint?.source || "").toLowerCase();
    const pattern = String(input?.validation?.pattern || "");
    const closedSelector = ["utterance", "environment", "default"].includes(source)
      && pattern.startsWith("^")
      && pattern.endsWith("$")
      && new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "i")
        .test(String(operation.answerTemplate || ""));
    if (!closedSelector) {
      throw new Error(`entity plan does not use required ordinary input ${input.name}`);
    }
  }

  return {
    name: String(plan.name || "").trim(),
    provider: String(plan.provider || "").trim(),
    inputRequirements: plan.inputRequirements || [],
    protectedAssetRequirements: plan.protectedAssetRequirements || [],
    published: {
      modules: { axios: "axios" },
      actions,
      data: {},
    },
  };
}

function isEntityPlan(value) {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number(value.schemaVersion) === 1
    && value.executionPlan
    && !value.published;
}

module.exports = {
  ENTITY_PLAN_SCHEMA,
  compileEntityPlan,
  isEntityPlan,
};
