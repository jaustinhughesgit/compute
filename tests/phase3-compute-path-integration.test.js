"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCapabilityPathDataset } = require("../app/routes/capabilityPaths");
const { validateCapabilityManifest } = require("../app/routes/capabilityManifest");

test("Compute does not create browser token Paths", () => {
  assert.equal(buildCapabilityPathDataset({}), null);
});

test("capability manifests reject server-authored recognition fields", () => {
  assert.throws(() => validateCapabilityManifest({
    schemaVersion: 1,
    capabilityId: "book.author.lookup",
    entityId: "book-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    execution: { type: "remote", readOnly: true, timeoutMs: 10000 },
    operations: [{
      operationId: "lookup",
      inputs: [],
      outputs: [{ name: "author", type: "string", required: true }],
      utteranceExamples: ["Who wrote the original book?"],
      pattern: { core: [] },
    }],
  }), /browser-owned Path fields/);
});
