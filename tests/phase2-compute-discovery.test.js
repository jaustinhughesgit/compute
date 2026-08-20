"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  discoverComputeCapability,
  localGraphOnlyDiscovery,
  normalizeEntityUseBindings,
  semanticEvidenceContext,
} = require("../app/routes/capabilityDiscovery");
const { buildComputeEntitySpec, GENERIC_BLUEPRINT_ID } = require("../app/routes/capabilityBlueprints");
const { validateCapabilityManifest } = require("../app/routes/capabilityManifest");

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

test("discovery preserves a declared generic calculation contract", async () => {
  const calculationRequest = structuredClone(request);
  calculationRequest.capabilityIdHint = "math.add.two_numbers";
  calculationRequest.operations = [{
    operationId: "add",
    description: "Add two numbers.",
    inputs: [
      { name: "left", type: "number", required: true, bindingHint: { source: "utterance", resolver: "number" } },
      { name: "right", type: "number", required: true, bindingHint: { source: "utterance", resolver: "number" } },
    ],
    outputs: [{ name: "sum", type: "number", required: true }],
    utteranceExamples: [{ text: "Add 5 and 9.", inputs: { left: 5, right: 9 } }],
    answerTemplate: "{{sum}}",
    calculation: {
      operator: "add",
      operands: [
        { source: "input", inputName: "left", literal: null },
        { source: "input", inputName: "right", literal: null },
      ],
      outputName: "sum",
    },
  }];
  const result = await discoverComputeCapability({
    openai: model({
      decision: "build_compute",
      confidence: 0.99,
      reason: "A deterministic calculation is required.",
      capabilityId: "math.add.two_numbers",
      entityId: null,
      operationId: "add",
      inputValues: [{ name: "left", value: 5 }, { name: "right", value: 9 }],
      capabilityRequest: calculationRequest,
    }),
    utterance: "Add 5 and 9.",
    requestedBy: "u:7",
  });
  assert.equal(result.buildCommand.capabilityRequest.operations[0].calculation.operator, "add");
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
  assert.equal(result.jurisdiction.effectClass, "read.graph");
  assert.equal(result.jurisdiction.artifactDecision, "query_data");
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
  assert.equal(result.jurisdiction.effectClass, "define.capability");
  assert.equal(result.evolution.outcome, "build");
  assert.equal(modelCalls, 1);
});

test("post-repair discovery preserves bounded jurisdiction evidence for an external capability decision", () => {
  const context = semanticEvidenceContext([{
    routing: {
      localGraphCandidate: false,
      computeEligible: true,
      localRepairExhausted: true,
      unclassifiedColdMiss: true,
      localRepairFailure: "No local query produced an answer.\nTry external work.",
      localRepairInterpretation: {
        inputKind: "question",
        hasSufficientInformation: false,
        summary: "The requested value belongs to an external provider.",
        explanation: "The local graph has no authoritative current value.",
      },
    },
  }]);

  assert.equal(context.routing.localRepairExhausted, true);
  assert.equal(context.routing.unclassifiedColdMiss, true);
  assert.equal(context.routing.localRepairFailure, "No local query produced an answer. Try external work.");
  assert.deepEqual(context.routing.localRepairInterpretation, {
    inputKind: "question",
    hasSufficientInformation: false,
    summary: "The requested value belongs to an external provider.",
    explanation: "The local graph has no authoritative current value.",
  });
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

test("entity use reconciliation accepts only exact IDs from the selected app and 20/200 evidence", () => {
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "vehicle.clean",
    entityId: "compute-carwash",
    version: 1,
    status: "active",
    execution: { type: "remote", readOnly: false, timeoutMs: 15000 },
    operations: [{
      operationId: "wash",
      inputs: [{
        name: "vehicle", type: "string", required: true,
        bindingHint: { source: "utterance", resolver: "entity_reference" },
      }],
      outputs: [{ name: "state", type: "string", required: true }],
      utteranceExamples: [{ text: "wash my car", inputs: { vehicle: "car" } }],
      answerTemplate: "Your {{vehicle}} is {{state}}",
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "vehicle",
        currentValue: "dirty",
        newValue: "clean",
      }],
    }],
  });
  const operation = manifest.operations[0];
  const semanticEvidence = [{
    recentInputs: ["I have a car", "My car is dirty", "Wash my car"],
    relatedContext: {
      entities: [
        { id: "car-id", names: ["car"], lemmas: ["car"] },
        { id: "condition-id", names: ["condition"], lemmas: ["condition"] },
        { id: "dirty-id", names: ["dirty"], lemmas: ["dirty"] },
      ],
      relations: [{ id: "car-condition-relation", subj: "car-id", prop: "condition-id", obj: "dirty-id" }],
    },
  }];
  const binding = {
    sourceDependencyId: operation.entityDependencies[0].dependencyId,
    targetEntityId: "condition-id",
    targetRelationId: "car-condition-relation",
    targetSubjectEntityId: "car-id",
    confidence: 0.99,
    reason: "The owned car's condition currently holds dirty.",
  };
  const normalized = normalizeEntityUseBindings({
    parsedBindings: [binding], operation, semanticEvidence,
  });
  assert.equal(normalized[0].sourceDependencyId, "compute-carwash::v1::wash::context_effect_1");
  assert.equal(normalized[0].targetRelationId, "car-condition-relation");
  assert.equal(normalized[0].access, "read_write");

  assert.throws(() => normalizeEntityUseBindings({
    parsedBindings: [{ ...binding, sourceDependencyId: "register-app::v1::report::context_effect_1" }],
    operation,
    semanticEvidence,
  }), /outside the chosen Compute operation/);
  assert.throws(() => normalizeEntityUseBindings({
    parsedBindings: [{ ...binding, targetRelationId: "invented-relation" }],
    operation,
    semanticEvidence,
  }), /exact entity and relation IDs/);
});

test("one exact invocation subject and transition derive using IDs without model ID copying", () => {
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "vehicle.clean",
    entityId: "compute-carwash",
    version: 1,
    status: "active",
    execution: { type: "remote", readOnly: false, timeoutMs: 15000 },
    operations: [{
      operationId: "wash",
      inputs: [{
        name: "vehicle", type: "string", required: true,
        bindingHint: { source: "utterance", resolver: "entity_reference" },
      }],
      outputs: [{ name: "state", type: "string", required: true }],
      utteranceExamples: [{ text: "wash my car", inputs: { vehicle: "car" } }],
      answerTemplate: "Your {{vehicle}} is {{state}}",
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "vehicle",
        currentValue: "dirty",
        newValue: "clean",
      }],
    }],
  });
  const operation = manifest.operations[0];
  const evidence = [{
    invocationReferents: [{
      mention: "Austin", mentionKey: "austin", entityId: "owner-austin-id", resolvedLocally: true,
      targetMention: "Austin's car", targetEntityId: "car-id", targetResolvedLocally: true,
      targetResolution: "qualified-owner-edge",
    }],
    relatedContext: {
      entities: [
        { id: "car-id", names: ["car"] },
        { id: "clean-status-id", names: ["clean status"] },
        { id: "dirty-id", names: ["dirty"] },
      ],
      relations: [{
        id: "car-clean-status-relation",
        subj: "car-id",
        prop: "clean-status-id",
        obj: "dirty-id",
        publisherId: "u:austin",
        version: 4,
        contextSource: "named-hydration",
      }],
    },
  }];
  const bindings = normalizeEntityUseBindings({
    parsedBindings: [{
      sourceDependencyId: "invented dependency",
      targetEntityId: "current_status",
      targetRelationId: "invented relation",
      targetSubjectEntityId: "car",
    }],
    operation,
    semanticEvidence: evidence,
  });
  assert.deepEqual(bindings.map((item) => ({
    sourceDependencyId: item.sourceDependencyId,
    targetEntityId: item.targetEntityId,
    targetRelationId: item.targetRelationId,
    targetSubjectEntityId: item.targetSubjectEntityId,
    targetPublisherId: item.targetPublisherId,
    targetRelationVersion: item.targetRelationVersion,
    targetContextSource: item.targetContextSource,
  })), [{
    sourceDependencyId: "compute-carwash::v1::wash::context_effect_1",
    targetEntityId: "clean-status-id",
    targetRelationId: "car-clean-status-relation",
    targetSubjectEntityId: "car-id",
    targetPublisherId: "u:austin",
    targetRelationVersion: 4,
    targetContextSource: "named-hydration",
  }]);

  evidence[0].relatedContext.relations.push({
    id: "second-dirty-relation",
    subj: "car-id",
    prop: "clean-status-id",
    obj: "dirty-id",
  });
  assert.throws(() => normalizeEntityUseBindings({
    parsedBindings: [], operation, semanticEvidence: evidence,
  }), /one exact entity use binding/);
});

test("a literal command frame selects the exact operation before deriving using", async () => {
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "vehicle.service",
    entityId: "compute-car-service",
    version: 1,
    status: "active",
    ownerId: "u:1",
    execution: { type: "remote", readOnly: false, timeoutMs: 15000 },
    operations: [{
      operationId: "wash_car",
      description: "Wash the selected car.",
      inputs: [{
        name: "car", type: "string", required: true,
        bindingHint: { source: "utterance", resolver: "entity_reference" },
      }],
      outputs: [{ name: "state", type: "string", required: true }],
      utteranceExamples: [{ text: "wash my car", inputs: { car: "my car" } }],
      answerTemplate: "{{car}} is {{state}}",
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "car",
        currentValue: "dirty",
        newValue: "clean",
      }],
    }, {
      operationId: "get_car_clean_status",
      description: "Get the selected car's current clean status.",
      inputs: [{
        name: "car", type: "string", required: true,
        bindingHint: { source: "utterance", resolver: "entity_reference" },
      }],
      outputs: [{ name: "state", type: "string", required: true }],
      utteranceExamples: [{ text: "wash my car", inputs: { car: "my car" } }],
      answerTemplate: "{{car}} is {{state}}",
    }],
  });
  const wash = manifest.operations.find((operation) => operation.operationId === "wash_car");
  const evidence = [{
    invocationReferents: [{
      mention: "Austin",
      entityId: "usr_austin",
      resolvedLocally: true,
      targetMention: "Austin's car",
      targetEntityId: "ctx_car",
      targetResolvedLocally: true,
    }],
    relatedContext: {
      entities: [
        { id: "ctx_car", names: ["Toyota Camry"], lemmas: ["car"] },
        { id: "term_condition", names: [], lemmas: ["condition"] },
        { id: "ctx_dirty", names: [], lemmas: ["dirty"] },
      ],
      relations: [{
        id: "rel_condition",
        subj: "ctx_car",
        prop: "term_condition",
        obj: "ctx_dirty",
        publisherId: "u:1",
        version: 4,
        contextSource: "named-hydration",
      }],
    },
  }];
  const result = await discoverComputeCapability({
    openai: model({
      decision: "reuse_existing",
      confidence: 0.98,
      reason: "Use the existing car service.",
      capabilityId: manifest.capabilityId,
      entityId: manifest.entityId,
      operationId: "get_car_clean_status",
      inputValues: [{ name: "car", value: "ctx_car" }],
      entityUseBindings: [],
      capabilityRequest: null,
      answerPlan: null,
    }),
    utterance: "Wash Austin's car.",
    requestedBy: "u:2",
    availableCapabilities: [manifest],
    semanticEvidence: evidence,
  });
  assert.equal(result.decision, "reuse");
  assert.equal(result.essence.operationId, "wash_car");
  assert.deepEqual(result.inputValues, { car: "Austin's car" });
  assert.equal(result.entityUseBindings.length, wash.entityDependencies.length);
  assert.equal(result.entityUseBindings[0].targetRelationId, "rel_condition");
});

test("a model cannot turn a new value for an open entity referent into an app extension", async () => {
  const manifest = validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "vehicle.clean",
    entityId: "compute-carwash",
    version: 1,
    status: "active",
    execution: { type: "remote", readOnly: false, timeoutMs: 15000 },
    operations: [{
      operationId: "wash",
      inputs: [{
        name: "vehicle", type: "string", required: true,
        bindingHint: { source: "utterance", resolver: "entity_reference" },
      }],
      outputs: [{ name: "state", type: "string", required: true }],
      utteranceExamples: [
        { text: "wash my car", inputs: { vehicle: "car" } },
        { text: "wash my Camry", inputs: { vehicle: "Camry" } },
      ],
      answerTemplate: "Your {{vehicle}} is clean",
      contextEffects: [{
        type: "contextdb.replace_object",
        subjectInput: "vehicle",
        currentValue: "dirty",
        newValue: "clean",
      }],
    }],
  });
  const operation = manifest.operations[0];
  const result = await discoverComputeCapability({
    openai: model({
      decision: "extend_existing",
      confidence: 0.92,
      reason: "The Ford F150 needs a new confirmation boundary.",
      capabilityId: manifest.capabilityId,
      entityId: manifest.entityId,
      operationId: "wash",
      inputValues: [{ name: "vehicle", value: "Ford F150" }],
      entityUseBindings: [],
      capabilityRequest: null,
    }),
    utterance: "Wash my Ford F150",
    requestedBy: "u:2",
    availableCapabilities: [manifest],
    semanticEvidence: [{
      invocationReferents: [{
        mention: "Ford F150",
        mentionKey: "ford f150",
        entityId: "ford-id",
        resolvedLocally: true,
      }],
      relatedContext: {
        entities: [
          { id: "ford-id", names: ["Ford F150"] },
          { id: "condition-id", names: ["clean status"] },
          { id: "dirty-id", names: ["dirty"] },
        ],
        relations: [{
          id: "ford-condition-relation",
          subj: "ford-id",
          prop: "condition-id",
          obj: "dirty-id",
        }],
      },
    }],
  });
  assert.equal(result.decision, "reuse");
  assert.equal(result.source, "contract-reconciled");
  assert.equal(result.inputValues.vehicle, "Ford F150");
  assert.equal(result.entityUseBindings.length, 1);
  assert.equal(result.entityUseBindings[0].sourceDependencyId, operation.entityDependencies[0].dependencyId);
  assert.equal(result.entityUseBindings[0].targetRelationId, "ford-condition-relation");
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
