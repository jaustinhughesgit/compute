"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  convertErrorDetails,
  markBackgroundBuildError,
  markBackgroundDiscoveryError,
} = require("../app/routes/modules/convert");

test("Convert returns a sanitized retry contract for background discovery failures", () => {
  const retryable = new Error("provider rejected https://example.test/data?appid=private-value");
  retryable.code = "INVALID_DISCOVERY_CONTRACT";
  markBackgroundDiscoveryError(retryable);
  const details = convertErrorDetails(retryable);
  assert.deepEqual({
    kind: details.kind,
    schemaVersion: details.schemaVersion,
    code: details.code,
    stage: details.stage,
    retryable: details.retryable,
  }, {
    kind: "computeError",
    schemaVersion: 1,
    code: "INVALID_DISCOVERY_CONTRACT",
    stage: "compute_discovery",
    retryable: true,
  });
  assert.doesNotMatch(details.message, /private-value/);

  const invalidId = new Error("invalid OpenAI background response id");
  invalidId.code = "OPENAI_BACKGROUND_ID_INVALID";
  assert.equal(markBackgroundDiscoveryError(invalidId).retryable, false);

  const transientBuild = new Error("OpenAI Responses request failed (503)");
  transientBuild.code = "OPENAI_RESPONSES_REQUEST_FAILED";
  const buildDetails = convertErrorDetails(markBackgroundBuildError(transientBuild));
  assert.equal(buildDetails.stage, "compute_build");
  assert.equal(buildDetails.retryable, true);

  const stalledBuild = new Error("OpenAI background response exceeded its bounded pending lifetime");
  stalledBuild.code = "OPENAI_BACKGROUND_RESPONSE_STALLED";
  stalledBuild.status = 408;
  const stalledDetails = convertErrorDetails(markBackgroundBuildError(stalledBuild));
  assert.equal(stalledDetails.code, "OPENAI_BACKGROUND_RESPONSE_STALLED");
  assert.equal(stalledDetails.retryable, true);
  assert.equal(stalledDetails.status, 408);

  const invalidImplementation = new Error("Generated response omitted a declared output");
  invalidImplementation.code = "INVALID_IMPLEMENTATION";
  assert.equal(markBackgroundBuildError(invalidImplementation).retryable, false);
});

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
  assert.match(source, /editEntityPrepared/);
  assert.match(source, /revision-finalize/);
  assert.match(source, /semanticBundle/);
  assert.match(source, /pathSemanticContractChanged/);
  assert.match(source, /PROVIDER_REPAIR_MODEL/);
  assert.match(source, /DEFAULT_PROVIDER_REPAIR_MODEL\s*=\s*"gpt-5\.6-terra"/);
  assert.match(source, /type:\s*"web_search"/);
  assert.match(source, /web_search_call\.action\.sources/);
  assert.match(source, /providerResearchSources/);
  assert.match(source, /mayRetryRevisionValidation/);
});

test("Convert uses generic discovery, reuse, extension, and model-built entity paths", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  assert.match(source, /loadCapabilityCandidates/);
  assert.match(source, /searchEntities/);
  assert.match(source, /CAPABILITY_EXTENSION_REQUIRED/);
  assert.match(source, /await buildComputeEntitySpec/);
  assert.match(source, /capabilityRequest:\s*capabilityBuildRequest/);
  assert.match(source, /status:\s*"CAPABILITY_BUILD_REQUIRED"/);
  assert.match(source, /status:\s*"BUILD_RETRY_REQUIRED"/);
  assert.match(source, /pendingStartedAt:\s*claim\.record\?\.capabilityBuildStartedAt/);
  assert.match(source, /kind:\s*"computeDeterministicBuild"/);
  assert.match(source, /Another Lambda is materializing this deterministic capability build/);
  assert.match(source, /generationAttemptLimit/);
  assert.match(source, /buildComputeCapability === true/);
  assert.match(source, /capabilityBuildId === buildId/);
  assert.doesNotMatch(source, /weather/i);
});

test("a resumed build reconnects before its completed entity can look like a collision", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  const resumeValidation = source.indexOf("const validResume = record");
  const collisionLookup = source.indexOf("await capabilityRegistry.findByCapability", resumeValidation);
  assert.ok(resumeValidation >= 0 && collisionLookup > resumeValidation);
  assert.match(source, /const existing = resumedClaim \? \[\] : await capabilityRegistry\.findByCapability/);
  assert.match(source, /if \(resumedClaim\) \{\s*claim = resumedClaim;\s*await buildCoordinator\.renew\(claim\)/);
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
  const sharedSource = fs.readFileSync(path.join(__dirname, "../app/routes/shared.js"), "utf8");
  assert.doesNotMatch(sharedSource, /console\.log\(["'](?:xAccessToken|ddb|uuid|mainObj)["']/);
  for (const moduleName of ["groups.js", "newGroup.js", "links.js"]) {
    const moduleSource = fs.readFileSync(path.join(__dirname, `../app/routes/modules/${moduleName}`), "utf8");
    assert.doesNotMatch(moduleSource, /console\.log\(["'](?:ctx|ctx\.req|req|ensuredCookie|response:)["']/);
  }
});

test("Convert retires legacy generated implementations before generic reuse", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  assert.match(source, /IMPLEMENTATION_POLICY_VERSION/);
  assert.match(source, /minimumImplementationPolicyVersion/);
  assert.match(source, /IMPLEMENTATION_POLICY_UPGRADE/);
  assert.match(source, /setStatus\(legacy\.entityId, "failed"/);
});

test("Convert stops after discovery contract failure instead of creating a fallback entity", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/routes/modules/convert.js"), "utf8");
  assert.match(source, /computeDiscovery\.source === "model-error"/);
  assert.match(source, /status:\s*"DISCOVERY_FAILED"/);
});
