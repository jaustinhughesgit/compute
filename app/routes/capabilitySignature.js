/**
 * Platform: Gives compute contracts exact fingerprints and paraphrase-friendly Position documents without treating either as entity identity.
 * Technical: Canonicalizes semantic manifest fields, hashes the exact contract, and writes bounded anchor postings through canonical persistence.
 */
"use strict";

const crypto = require("node:crypto");
const anchors = require("./anchors");

const SIGNATURE_VERSION = 2;
const EMBEDDING_MODEL = process.env.EMB_MODEL || "text-embedding-3-large";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function exactContractDocument(manifest = {}) {
  return stableValue({
    schemaVersion: Number(manifest.schemaVersion || 1),
    capabilityId: String(manifest.capabilityId || ""),
    name: String(manifest.name || ""),
    description: String(manifest.description || ""),
    execution: manifest.execution || null,
    operations: Array.isArray(manifest.operations) ? manifest.operations : [],
    implementationPolicyVersion: Number(manifest.implementationPolicyVersion || 1),
  });
}

function fieldSemanticText(kind, field = {}) {
  const hint = field.bindingHint || {};
  return [
    kind,
    field.name,
    field.type,
    field.required === false ? "optional" : "required",
    field.description,
    hint.source,
    hint.resolver,
    hint.subject,
    hint.property,
  ].filter(Boolean).join(" ");
}

function cleanSemanticText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function exampleText(example) {
  return cleanSemanticText(typeof example === "string" ? example : example?.text || example?.utterance);
}

function annotatedExamplePattern(example, requiredInputNames = []) {
  if (!example || typeof example !== "object" || Array.isArray(example)) return "";
  let pattern = exampleText(example);
  if (!pattern) return "";
  const annotations = example.inputs && typeof example.inputs === "object" && !Array.isArray(example.inputs)
    ? Object.entries(example.inputs)
    : (Array.isArray(example.inputValues)
      ? example.inputValues.map((item) => [item?.name, item?.value])
      : []);
  const annotatedNames = new Set(annotations.map(([name]) => String(name || "").trim()));
  if (requiredInputNames.some((name) => !annotatedNames.has(String(name || "").trim()))) return "";
  for (const [rawName, rawValue] of annotations
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .sort((left, right) => String(right[1]).length - String(left[1]).length)) {
    const name = String(rawName || "").trim();
    const value = String(rawValue ?? "").trim();
    if (!name || !value) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = pattern.replace(
      new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, "gi"),
      (_match, leading) => `${leading}{${name}}`
    );
  }
  return /\{[^{}]+\}/.test(pattern) ? pattern : "";
}

function inferredExamplePatterns(examples, inputName) {
  const tokenized = (source) => ({
    source,
    tokens: [...source.matchAll(/[A-Za-z0-9]+/g)].map((match) => ({
      normalized: match[0].toLowerCase(),
      start: match.index,
      end: Number(match.index) + match[0].length,
    })),
  });
  const items = examples.map(exampleText).filter(Boolean).map(tokenized).filter((item) => item.tokens.length);
  const groups = new Map();
  const addGroup = (key, item) => {
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  };
  for (const item of items) {
    addGroup("all", item);
    addGroup(`first:${item.tokens[0].normalized}`, item);
    addGroup(`first2:${item.tokens.slice(0, 2).map((token) => token.normalized).join(" ")}`, item);
    addGroup(`length:${item.tokens.length}`, item);
  }
  const patterns = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let prefixLength = 0;
    while (
      prefixLength < group[0].tokens.length
      && group.every((item) => item.tokens[prefixLength]?.normalized === group[0].tokens[prefixLength].normalized)
    ) prefixLength += 1;
    let suffixLength = 0;
    while (
      suffixLength < group[0].tokens.length - prefixLength
      && group.every((item) =>
        item.tokens.length - suffixLength > prefixLength
        && item.tokens[item.tokens.length - 1 - suffixLength]?.normalized
          === group[0].tokens[group[0].tokens.length - 1 - suffixLength].normalized
      )
    ) suffixLength += 1;
    const varying = group.map((item) => item.tokens.slice(
      prefixLength,
      item.tokens.length - suffixLength
    ).map((token) => token.normalized).join(" "));
    if (varying.some((value) => !value) || new Set(varying).size < 2) continue;
    const first = group[0];
    const variableTokens = first.tokens.slice(prefixLength, first.tokens.length - suffixLength);
    patterns.push(`${first.source.slice(0, variableTokens[0].start)}{${inputName}}${first.source.slice(variableTokens.at(-1).end)}`);
  }
  return [...new Set(patterns.map(cleanSemanticText).filter(Boolean))];
}

function semanticUtterancePatterns(operation = {}) {
  const examples = Array.isArray(operation.utteranceExamples) ? operation.utteranceExamples.slice(0, 12) : [];
  const utteranceInputs = (Array.isArray(operation.inputs) ? operation.inputs : []).filter((input) =>
    String(input?.bindingHint?.source || "").toLowerCase() === "utterance"
  );
  const patterns = examples.map((example) => annotatedExamplePattern(
    example,
    utteranceInputs.filter((input) => input.required !== false).map((input) => input.name)
  )).filter(Boolean);
  if (utteranceInputs.length === 1) {
    patterns.push(...inferredExamplePatterns(examples, utteranceInputs[0].name));
  }
  return [...new Set(patterns.map(cleanSemanticText).filter((pattern) => /\{[^{}]+\}/.test(pattern)))].slice(0, 8);
}

function semanticCapabilityText(manifest = {}) {
  const rows = [
    `capability ${String(manifest.name || manifest.capabilityId || "compute")}`,
    String(manifest.description || ""),
  ];
  for (const operation of Array.isArray(manifest.operations) ? manifest.operations : []) {
    rows.push(`operation ${String(operation.operationId || "")} ${String(operation.description || "")}`);
    for (const pattern of semanticUtterancePatterns(operation)) {
      rows.push(`utterance pattern ${pattern}`);
    }
    for (const input of Array.isArray(operation.inputs) ? operation.inputs : []) {
      rows.push(fieldSemanticText("input", input));
    }
    for (const output of Array.isArray(operation.outputs) ? operation.outputs : []) {
      rows.push(fieldSemanticText("output", output));
    }
    if (operation.calculation?.operator) {
      rows.push(`deterministic calculation ${operation.calculation.operator}`);
    }
    if (operation.freshness?.mode) rows.push(`freshness ${operation.freshness.mode}`);
    for (const requirement of Array.isArray(operation.protectedAssetRequirements)
      ? operation.protectedAssetRequirements : []) {
      rows.push([
        "protected requirement",
        requirement.assetType,
        requirement.providerId,
        requirement.purpose,
        requirement.use,
      ].filter(Boolean).join(" "));
    }
  }
  return cleanSemanticText(rows.join("\n")).slice(0, 6000);
}

function semanticCapabilityDocuments(manifest = {}) {
  const documents = [{ kind: "contract", text: semanticCapabilityText(manifest) }];
  for (const operation of Array.isArray(manifest.operations) ? manifest.operations : []) {
    for (const pattern of semanticUtterancePatterns(operation)) {
      documents.push({
        kind: "utterance-pattern",
        text: cleanSemanticText([
          `capability ${String(manifest.name || manifest.capabilityId || "compute")}`,
          `operation ${String(operation.operationId || "")} ${String(operation.description || "")}`,
          `utterance pattern ${pattern}`,
        ].join(" ")).slice(0, 2000),
      });
      if (documents.length >= 16) return documents;
    }
  }
  return documents;
}

function createCapabilitySignature(manifest) {
  const contract = exactContractDocument(manifest);
  return Object.freeze({
    schemaVersion: SIGNATURE_VERSION,
    algorithm: "sha256",
    contractHash: crypto.createHash("sha256").update(JSON.stringify(contract)).digest("hex"),
    semanticText: semanticCapabilityText(manifest),
  });
}

async function indexCapabilityManifest({ manifest, signature, persistence, s3, openai } = {}) {
  if (!manifest?.entityId || !persistence?.retrieval?.batchPut || !persistence?.foundation?.addresses ||
      !s3 || !openai?.embeddings?.create) {
    return { indexed: false, reason: "INDEX_DEPENDENCIES_UNAVAILABLE" };
  }
  const currentSignature = signature || createCapabilitySignature(manifest);
  if (!currentSignature.semanticText) return { indexed: false, reason: "EMPTY_SEMANTIC_DOCUMENT" };
  const addressResult = await persistence.foundation.addresses.byId(String(manifest.entityId));
  const address = addressResult?.Item || addressResult?.Items?.[0] || null;
  if (!address) return { indexed: false, reason: "ADDRESS_NOT_FOUND" };

  const documents = semanticCapabilityDocuments(manifest).filter((document) => document.text);
  const embeddingResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: documents.map((document) => document.text),
  });
  const anchorSet = await anchors.loadAnchors({ s3 });
  const assignmentMap = new Map();
  for (const [index] of documents.entries()) {
    const embedding = embeddingResponse?.data?.[index]?.embedding;
    const unit = anchors.unit(embedding);
    if (!unit) throw new Error("capability signature embedding was invalid");
    const assigned = anchors.assign(unit, anchorSet, {
      topL0: Math.max(1, Math.min(4, Number(process.env.ANCHORS_TOP_L0 || 3))),
    });
    for (const assign of assigned) {
      const key = `${assign.l0}\n${assign.l1}\n${assign.band}`;
      const existing = assignmentMap.get(key);
      if (!existing || Number(assign.dist_q16) < Number(existing.dist_q16)) assignmentMap.set(key, assign);
    }
  }
  const assigns = [...assignmentMap.values()];
  const owner = String(manifest.ownerId || "").replace(/^u:/, "");
  const isPublic = address.z === true || address.z === "true";
  const scopes = [owner || null, ...(isPublic ? [null] : [])];
  const postings = [];
  for (const userId of new Set(scopes)) {
    for (const assign of assigns) {
      postings.push({
        ...anchors.makePostingV2({
          setId: anchorSet.setId,
          su: String(manifest.entityId),
          assign,
          type: "capability",
          shards: anchorSet.num_shards,
          userId,
        }),
        capabilityContractHash: currentSignature.contractHash,
        capabilityVersion: Number(manifest.version || 1),
      });
    }
  }
  await persistence.retrieval.batchPut(postings);
  const position = {
    setId: anchorSet.setId,
    band_scale: anchorSet.band_scale,
    num_shards: anchorSet.num_shards,
    signatureVersion: currentSignature.schemaVersion,
    contractHash: currentSignature.contractHash,
    semanticProjectionCount: documents.length,
    assigns: assigns.map(({ l0, l1, band, dist_q16 }) => ({ l0, l1, band, dist_q16 })),
  };
  await persistence.foundation.addresses.setPosition(String(manifest.entityId), position);
  return { indexed: true, postings: postings.length, position };
}

module.exports = {
  SIGNATURE_VERSION,
  stableValue,
  exactContractDocument,
  semanticUtterancePatterns,
  semanticCapabilityText,
  semanticCapabilityDocuments,
  createCapabilitySignature,
  indexCapabilityManifest,
};
