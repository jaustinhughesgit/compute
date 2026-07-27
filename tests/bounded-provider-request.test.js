"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBoundedAxios } = require("../app/routes/boundedAxios");
const { providerRequestTimeoutMs, register } = require("../app/routes/modules/runEntity");

function fakeAxios(calls) {
  const client = {
    constructor: function Axios() {},
    request: async (config) => { calls.push(["request", config]); },
    _request: async (...args) => { calls.push(["_request", ...args]); },
    getUri: () => "",
    create: () => client,
    isCancel: () => false,
    toFormData: () => ({}),
    all: Promise.all.bind(Promise),
    spread: (callback) => callback,
    isAxiosError: () => false,
    mergeConfig: Object.assign,
    defaults: {},
    interceptors: {},
  };
  for (const method of ["delete", "get", "head", "options"]) {
    client[method] = async (url, config) => { calls.push([method, url, config]); };
  }
  for (const method of ["post", "postForm", "put", "putForm", "patch", "patchForm"]) {
    client[method] = async (url, data, config) => { calls.push([method, url, data, config]); };
  }
  return client;
}

test("generated provider requests receive a bounded Axios timeout", async () => {
  const calls = [];
  const client = createBoundedAxios(fakeAxios(calls), 10000);
  await client.get("https://provider.example/data");
  await client.get("https://provider.example/data", { timeout: 30000, params: { q: "Raleigh" } });
  await client.post("https://provider.example/data", { q: "Raleigh" }, { timeout: 5000 });

  assert.equal(calls[0][2].timeout, 10000);
  assert.equal(calls[1][2].timeout, 10000);
  assert.deepEqual(calls[1][2].params, { q: "Raleigh" });
  assert.equal(calls[2][3].timeout, 5000);
});

test("provider timeout leaves cleanup and response headroom inside the entity deadline", () => {
  assert.equal(providerRequestTimeoutMs(15000), 10000);
  assert.equal(providerRequestTimeoutMs(10000), 7500);
  assert.equal(providerRequestTimeoutMs(2000), 250);
});

test("the entity boundary passes its provider deadline into existing entity execution", async () => {
  let handler;
  let execution;
  const manifest = {
    schemaVersion: 1,
    capabilityId: "conditions",
    entityId: "conditions-entity",
    version: 1,
    status: "active",
    ownerId: "u:7",
    execution: { type: "remote", readOnly: true, timeoutMs: 15000 },
    operations: [{
      operationId: "lookup",
      inputs: [],
      outputs: [{ name: "summary", type: "string", required: true }],
    }],
    implementationPolicyVersion: 10,
  };
  const dynamodb = {
    get: () => ({ promise: async () => ({ Item: { su: manifest.entityId, computeCapability: manifest } }) }),
  };
  const shared = {
    getSub: async () => ({ Items: [] }),
    deps: { dynamodb },
    runComputeEntity: async (args) => {
      execution = args;
      return { summary: "Clear" };
    },
  };
  register({
    on: (name, callback) => {
      assert.equal(name, "runEntity");
      handler = callback;
    },
    use: () => shared,
  });

  const response = await handler({
    path: manifest.entityId,
    req: { body: { capabilityId: manifest.capabilityId, operationId: "lookup", inputs: {} }, cookies: { e: "7" } },
    res: {},
    next: () => {},
  });

  assert.equal(response.ok, true);
  assert.equal(execution.providerRequestTimeoutMs, 10000);
});
