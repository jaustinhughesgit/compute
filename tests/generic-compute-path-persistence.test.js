"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { register, __test: pathsTest } = require("../app/routes/modules/paths");

function approvedQuality() {
  return {
    schemaVersion: 1,
    score: 95,
    threshold: 75,
    approved: true,
    status: "approved",
    dimensions: { contractSafety: 100 },
    blockers: [],
    collisions: { conflicts: [] },
  };
}

function computePath(answerTemplate) {
  return {
    sig: "pattern:v3:generic_template_contract",
    left: {
      lib: "tokens",
      state: {
        pattern: {
          schemaVersion: 3,
          patternId: "generic_template_contract",
          kind: "question",
          operation: "invoke_compute_capability",
          core: [{ kind: "lemma", value: "conditions" }],
          modifiers: [],
          projection: null,
          slotDefinitions: [],
          tokenizerAliases: [],
        },
      },
    },
    right: {
      lib: "computeCapability",
      state: {
        schemaVersion: 3,
        mode: "question",
        familyId: "generic_template_contract",
        operation: "invoke_compute_capability",
        rows: [],
        levels: [],
        compute: {
          schemaVersion: 1,
          capabilityId: "place.conditions",
          entityId: "entity-1",
          version: 1,
          operationId: "lookup",
          inputs: [{
            name: "place",
            type: "string",
            required: true,
            bindingHint: { source: "utterance" },
          }],
          outputs: [{ name: "conditions", type: "string", required: true }],
          answerTemplate,
        },
      },
    },
    tests: {
      schemaVersion: 1,
      positive: [{ input: "Conditions in Raleigh?" }, { input: "Conditions in Durham?" }],
      negative: [{ input: "Open Raleigh" }, { input: "Save Durham" }],
    },
    quality: approvedQuality(),
  };
}

function composedComputePath(answerTemplate = "{{conditions}}") {
  const path = computePath(answerTemplate);
  path.sig = "pattern:v4:generic_template_contract";
  path.left.state.pattern = {
    schemaVersion: 4,
    patternId: "generic_template_contract",
    kind: "question",
    operation: "invoke_compute_capability",
    routingAnchors: ["conditions"],
    network: {
      coverage: "complete",
      components: [
        { id: "projection.conditions" },
        { id: "entity.place", optional: true },
      ],
    },
    slotDefinitions: [],
    tokenizerAliases: [],
  };
  return path;
}

test("compute Path persistence accepts answer templates using declared inputs and outputs", () => {
  assert.equal(
    pathsTest.validatePathForPersistence(
      computePath("The conditions in {{place}} are {{conditions}}.")
    ),
    true
  );
});

test("compute Path persistence accepts identity-scoped referent memory for a ContextDB input", () => {
  const path = computePath("{{conditions}}");
  path.right.state.compute.inputs[0].bindingHint = {
    source: "contextdb",
    subject: "speaker",
    property: "RegisterStatus",
  };
  path.right.state.compute.contextBindingHints = {
    place: {
      source: "contextdb",
      subject: "Austin",
      subjectEntityId: "usr_1",
      property: "RegisterStatus",
    },
  };
  path.right.state.compute.referentMemory = [{
    role: "context_subject",
    mentionKey: "austin",
    entityId: "usr_1",
    inputNames: ["place"],
    successfulUses: 1,
    corrections: 0,
  }];
  assert.equal(pathsTest.validatePathForPersistence(path), true);
  path.right.state.compute.referentMemory[0].inputNames = ["missing"];
  assert.throws(
    () => pathsTest.validatePathForPersistence(path),
    /referentMemory\[0\] is invalid/
  );
});

test("Path persistence accepts the shared repeated-role structural slot", () => {
  const path = computePath("{{conditions}}");
  path.left.state.pattern.core = [{ kind: "slot", slot: "objects" }];
  path.left.state.pattern.slotDefinitions = [{
    name: "objects",
    type: "entity_list",
    minTokens: 2,
    maxTokens: 20,
    allowStructuralCoercion: false,
    bindingValue: "nounList",
    bindingNames: [],
  }];
  assert.equal(pathsTest.validatePathForPersistence(path), true);
});

test("Path persistence accepts a browser-validated Pattern Schema v4 subpattern network", () => {
  const path = composedComputePath();
  assert.equal(pathsTest.structuralPatternSignature(path.left.state.pattern), path.sig);
  assert.equal(pathsTest.validatePathForPersistence(path), true);
});

test("Path persistence accepts a whenNone-only conditional row", () => {
  const path = composedComputePath();
  path.sig = "pattern:v4:negative_guard_contract";
  path.left.state.pattern.patternId = "negative_guard_contract";
  path.right.lib = "essenceTransform";
  path.right.state.familyId = "negative_guard_contract";
  path.right.state.bindings = [{
    name: "related_subject",
    source: "currentSpeaker",
    value: "resolvedEntity",
  }];
  path.right.state.rows = [];
  path.right.state.forEach = [];
  path.right.state.conditionalRows = [{
    whenAll: [],
    whenAny: [],
    whenNone: ["related_subject"],
    rows: [["present", "speaker", "{prop:status}", "open"]],
  }];
  delete path.right.state.compute;

  assert.equal(pathsTest.validatePathForPersistence(path), true);
});

test("Pattern Schema v4 persistence rejects an incomplete network contract", () => {
  const path = composedComputePath();
  path.left.state.pattern.network.components = [];
  assert.throws(
    () => pathsTest.validatePathForPersistence(path),
    /network\.components must contain 1 to 64 references/
  );
});

test("Pattern Schema versions must agree with their persisted signature namespace", () => {
  const path = composedComputePath();
  path.sig = "pattern:v3:generic_template_contract";
  assert.throws(
    () => pathsTest.validatePathForPersistence(path),
    /structural Path sig must be pattern:v4:generic_template_contract/
  );
});

test("compute Path persistence rejects answer templates using unknown values", () => {
  assert.throws(
    () => pathsTest.validatePathForPersistence(computePath("{{place}}: {{forecast}}")),
    /answerTemplate references an undeclared input or output/
  );
});

test("bulk Path persistence preflights the complete batch before any writes", () => {
  const valid = computePath("{{place}}: {{conditions}}");
  const invalid = structuredClone(valid);
  invalid.sig = "pattern:v3:invalid_conditional_binding";
  invalid.left.state.pattern.patternId = "invalid_conditional_binding";
  invalid.right.lib = "essenceTransform";
  invalid.right.state.familyId = "invalid_conditional_binding";
  invalid.right.state.bindings = [];
  invalid.right.state.rows = [["*", "speaker", "{prop:conditions}", "{ask}"]];
  invalid.right.state.forEach = [];
  delete invalid.right.state.compute;
  invalid.right.state.conditionalRows = [{
    whenAll: ["quality"],
    whenAny: [],
    rows: [["present", "{record}", "{prop:quality}", { ref: "binding", name: "quality" }]],
  }];
  const result = pathsTest.validatePathBatchForPersistence([valid, invalid]);
  assert.equal(result.ok, false);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].sig, invalid.sig);
  assert.match(result.rejected[0].error, /unknown binding quality/);
});

test("Path persistence omits an unavailable optional creator audit key", () => {
  assert.deepEqual(pathsTest.pathCreatorAudit({ cookie: {} }), {
    item: {},
    updateSuffix: "",
    names: {},
    values: {},
  });
  assert.deepEqual(pathsTest.pathCreatorAudit({ cookie: { e: "creator-1" } }), {
    item: { by: "creator-1" },
    updateSuffix: ", #by = if_not_exists(#by, :by)",
    names: { "#by": "by" },
    values: { ":by": "creator-1" },
  });
});

test("numeric question aliases survive semantic migration and remain installable", () => {
  const learnedSig = "pattern:v3:learned_lolqtx";
  const path = {
    id: "path-1",
    sig: "pattern:v3:quantity_remaining_query",
    left: { lib: "tokens", state: {} },
    right: {
      lib: "essenceTransform",
      state: {
        schemaVersion: 3,
        familyId: "quantity_observation_current_query",
        operation: "query_current_quantity",
        mode: "question",
        bindings: [],
        rows: [
          ["*", "{owner}", "observe_quantity", "{quantity_record}"],
          ["present", "{quantity_record}", "{prop:quantity_delta}", "{delta}"],
          ["*", "{ask}", "{op:sum}", ["{delta}", "{quantity_record}"]],
        ],
      },
    },
    family: {
      id: "quantity_observation_current_query",
      canonicalSig: "pattern:v3:quantity_remaining_query",
      role: "canonical",
      active: true,
      aliases: [{
        sig: learnedSig,
        active: true,
        example: "How many ballots did Priya count?",
        left: { lib: "tokens", state: { pattern: { schemaVersion: 3 } } },
        bindings: [],
      }],
    },
  };

  assert.equal(pathsTest.pathAnswerCategory(path), "quantity");
  const migrated = pathsTest.migrateAliasesAcrossPaths([path]);
  assert.deepEqual(
    migrated.paths[0].family.aliases.map((alias) => alias.sig),
    [learnedSig]
  );
  assert.deepEqual(migrated.migrations, []);
});

test("a quality-gated Path with an originating sentence can be promoted to reset-exempt foundation", () => {
  const path = computePath("{{place}}: {{conditions}}");
  const result = pathsTest.validateFoundationPathPromotion(
    path,
    "What are the conditions in Raleigh?"
  );
  assert.equal(result.sentence, "What are the conditions in Raleigh?");
  assert.equal(result.evidence.kind, "dataset-quality-gate");
  assert.equal(result.evidence.passed, true);
});

test("foundation promotion requires both local proof and the originating sentence", () => {
  const path = computePath("{{place}}: {{conditions}}");
  delete path.tests;
  delete path.quality;
  assert.throws(
    () => pathsTest.validateFoundationPathPromotion(path, "What are the conditions?"),
    /browser-tested or approved dataset Path/
  );

  path.repair = { candidateTestReport: { passed: true, score: 91 } };
  assert.throws(
    () => pathsTest.validateFoundationPathPromotion(path, ""),
    /originating sentence/
  );
});

test("shared foundation confirmation is restricted to an explicitly enabled test author", () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    allowAny: process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER,
    allowed: process.env.TEST_RESET_ALLOWED_USER_IDS,
  };
  try {
    delete process.env.TEST_RESET_ENABLED;
    delete process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER;
    delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    assert.equal(pathsTest.foundationConfirmationAuthorized("2"), false);
    process.env.TEST_RESET_ENABLED = "true";
    process.env.TEST_RESET_ALLOWED_USER_IDS = "2";
    assert.equal(pathsTest.foundationConfirmationAuthorized("2"), true);
    assert.equal(pathsTest.foundationConfirmationAuthorized("3"), false);
    process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER = "true";
    assert.equal(pathsTest.foundationConfirmationAuthorized("3"), true);
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.allowAny == null) delete process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER;
    else process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER = previous.allowAny;
    if (previous.allowed == null) delete process.env.TEST_RESET_ALLOWED_USER_IDS;
    else process.env.TEST_RESET_ALLOWED_USER_IDS = previous.allowed;
  }
});

test("confirmed exact Paths round-trip through the retained shared foundation API", async () => {
  const previous = {
    enabled: process.env.TEST_RESET_ENABLED,
    allowAny: process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER,
    table: process.env.PATH_FOUNDATION_TABLE,
  };
  process.env.TEST_RESET_ENABLED = "true";
  process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER = "true";
  process.env.PATH_FOUNDATION_TABLE = "testPathFoundation";
  const handlers = {};
  const items = new Map();
  const doc = {
    get: ({ Key }) => ({ promise: async () => ({ Item: items.get(Key.sig) }) }),
    put: ({ Item }) => ({ promise: async () => { items.set(Item.sig, structuredClone(Item)); } }),
    scan: () => ({ promise: async () => ({ Items: [...items.values()] }) }),
  };
  try {
    register({
      on: (name, callback) => { handlers[name] = callback; },
      use: () => ({
        getDocClient: () => doc,
        deps: { AWS: { DynamoDB: function DynamoDB() {} } },
        getSub: async () => ({ Items: [] }),
        incrementCounterAndGetNewValue: async () => 1,
      }),
    });
    const path = computePath("{{place}}: {{conditions}}");
    const confirmed = await handlers.confirmFoundationPath({
      path: "",
      req: { body: {
        e: "source-entity",
        path,
        sourceSentence: "What are the conditions in Raleigh?",
        sourceStorageSignature: path.sig,
      } },
    }, { cookie: { e: "2" } });
    assert.equal(confirmed.response.path.foundation.status, "confirmed");
    assert.equal(confirmed.response.path.foundation.sourceSentence, "What are the conditions in Raleigh?");

    const listed = await handlers.listConfirmedFoundationPaths({}, { cookie: { e: "3" } });
    assert.equal(listed.response.paths.length, 1);
    assert.equal(listed.response.paths[0].sig, path.sig);
    assert.equal(listed.response.paths[0].foundation.confirmedBy, "2");
  } finally {
    if (previous.enabled == null) delete process.env.TEST_RESET_ENABLED;
    else process.env.TEST_RESET_ENABLED = previous.enabled;
    if (previous.allowAny == null) delete process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER;
    else process.env.TEST_RESET_ALLOW_ANY_AUTHENTICATED_USER = previous.allowAny;
    if (previous.table == null) delete process.env.PATH_FOUNDATION_TABLE;
    else process.env.PATH_FOUNDATION_TABLE = previous.table;
  }
});
