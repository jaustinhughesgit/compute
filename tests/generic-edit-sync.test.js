"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Edit revises and registers an entity-owned capability contract atomically", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/editEntity.js"), "utf8");
  assert.match(source, /currentCapabilityManifest/);
  assert.match(source, /updatedCapabilityManifest/);
  assert.match(source, /canonicalizeGeneratedOperations/);
  assert.match(source, /published\.computeCapability\s*=\s*revisedManifest/);
  assert.match(source, /capabilityRegistry\.register\(revisedManifest/);
  assert.match(source, /capabilityManifest:\s*revisedManifest/);
  assert.match(source, /validateTrustedImplementation/);
  assert.match(source, /capability revision cannot add or modify executable field/);
  assert.match(source, /capabilityRegistry\.register\(originalManifest/);
});

test("Convert uses generic discovery, reuse, extension, and model-built entity paths", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  assert.match(source, /listAvailable/);
  assert.match(source, /CAPABILITY_EXTENSION_REQUIRED/);
  assert.match(source, /await buildComputeEntitySpec/);
  assert.match(source, /capabilityRequest:\s*capabilityBuildRequest/);
  assert.doesNotMatch(source, /weather/i);
});
