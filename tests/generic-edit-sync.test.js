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

test("Compute request middleware does not log credentials or the dependency container", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/cookies.js"), "utf8");
  assert.doesNotMatch(source, /console\.log\(["']ctx["']/);
  assert.doesNotMatch(source, /console\.log\(["']ctx\.req\.headers["']/);
  assert.doesNotMatch(source, /console\.log\(["']xA["']/);
  const appSource = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  assert.doesNotMatch(appSource, /lambdaHandler event/);
  assert.doesNotMatch(appSource, /JSON\.stringify\(event/);
  assert.doesNotMatch(appSource, /console\.log\(["'](?:req|req\.body|isValid req|runApp req|getCookiesRouter)["']/);
  assert.doesNotMatch(appSource, /console\.log\(["'](?:embedding|dynamoRecord|chainParams55\.|libs\.root\.cntext)/);
  const shorthandSource = fs.readFileSync(path.join(__dirname, "../app/routes/modules/shorthand.js"), "utf8");
  assert.doesNotMatch(shorthandSource, /console\.log\(["'](?:req|req\.body|xAccessToken|newReq\.body|deepMerge newReq\.body)["']/);
  assert.doesNotMatch(shorthandSource, /console\.log\(["'](?:matrix|keywords ROUTE matrix|shorthand txt|resolvedArgs44)["']/);
});

test("Convert retires legacy generated implementations before generic reuse", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  assert.match(source, /IMPLEMENTATION_POLICY_VERSION/);
  assert.match(source, /minimumImplementationPolicyVersion/);
  assert.match(source, /IMPLEMENTATION_POLICY_UPGRADE/);
  assert.match(source, /setStatus\(legacy\.entityId, "failed"/);
});
