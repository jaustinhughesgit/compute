/**
 * Platform: Keeps grammatical ownership separate from executable ordinary inputs in generated capability contracts.
 * Technical: Canonicalizes deictic ContextDB owners and removes only model-added current-speaker pseudo-inputs proven redundant.
 */
"use strict";

const {
  canonicalizeGeneratedIdentifier,
  normalizeContextBindingSubject,
} = require("./capabilityManifest");

const CURRENT_SPEAKER_IDS = new Set([
  "i",
  "me",
  "my",
  "myself",
  "self",
  "speaker",
  "user",
  "current_user",
  "current_speaker",
]);

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function isCurrentSpeakerIdentifier(value) {
  return CURRENT_SPEAKER_IDS.has(canonicalizeGeneratedIdentifier(value));
}

function isCurrentSpeakerValue(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set([
    "i", "me", "my", "myself", "self", "speaker", "user",
    "current user", "current speaker",
  ]).has(normalized);
}

function explicitInputDeclaration(requirementSegments, rawName) {
  const name = canonicalizeGeneratedIdentifier(rawName).replace(/[_-]+/g, " ");
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = (Array.isArray(requirementSegments) ? requirementSegments : [])
    .map((segment) => String(segment || "").toLowerCase().replace(/[_-]+/g, " "))
    .join("\n");
  if (!text) return false;
  return [
    new RegExp(`\\b(?:input|parameter|argument)\\s+(?:is\\s+)?(?:named|called)\\s+["']?${escaped}\\b`, "i"),
    new RegExp(`\\b(?:named|called)\\s+["']?${escaped}["']?\\s+(?:input|parameter|argument)\\b`, "i"),
    new RegExp(`\\b${escaped}\\s+(?:input|parameter|argument)\\b`, "i"),
  ].some((pattern) => pattern.test(text));
}

function contextAddress(input) {
  const hint = isObject(input?.bindingHint) ? input.bindingHint : null;
  if (String(hint?.source || "").toLowerCase() !== "contextdb") return null;
  const subject = normalizeContextBindingSubject(hint.subject || "speaker");
  const property = String(hint.property || "").trim();
  if (!subject || !property) return null;
  return {
    subject,
    property,
    key: `${String(subject).toLowerCase()}\n${property.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`,
  };
}

function exampleValuesForInput(operation, rawName) {
  const name = canonicalizeGeneratedIdentifier(rawName);
  const values = [];
  for (const example of Array.isArray(operation?.utteranceExamples) ? operation.utteranceExamples : []) {
    if (!isObject(example)) continue;
    if (Array.isArray(example.inputValues)) {
      for (const item of example.inputValues) {
        if (canonicalizeGeneratedIdentifier(item?.name) === name && item?.value != null) {
          values.push(item.value);
        }
      }
    }
    if (isObject(example.inputs)) {
      for (const [inputName, value] of Object.entries(example.inputs)) {
        if (canonicalizeGeneratedIdentifier(inputName) === name && value != null) values.push(value);
      }
    }
  }
  return values;
}

function remapInputReferences(operation, oldName, newName = null) {
  const oldId = canonicalizeGeneratedIdentifier(oldName);
  const newId = newName == null ? null : canonicalizeGeneratedIdentifier(newName);
  if (!oldId || oldId === newId) return;
  if (newId && operation.answerTemplate != null) {
    operation.answerTemplate = String(operation.answerTemplate).replace(
      /{{\s*([a-zA-Z0-9_.-]+)([^}]*)}}/g,
      (whole, rawReference, suffix) => canonicalizeGeneratedIdentifier(rawReference) === oldId
        ? `{{${newId}${suffix}}}`
        : whole
    );
  }
  for (const operand of Array.isArray(operation?.calculation?.operands)
    ? operation.calculation.operands
    : []) {
    if (canonicalizeGeneratedIdentifier(operand?.inputName) === oldId && newId) {
      operand.inputName = newId;
    }
  }
  operation.utteranceExamples = (Array.isArray(operation.utteranceExamples)
    ? operation.utteranceExamples
    : []).map((example) => {
    if (!isObject(example)) return example;
    const next = clone(example);
    if (Array.isArray(next.inputValues)) {
      next.inputValues = next.inputValues.flatMap((item) => {
        if (canonicalizeGeneratedIdentifier(item?.name) !== oldId) return [item];
        return newId ? [{ ...item, name: newId }] : [];
      });
    }
    if (isObject(next.inputs)) {
      const inputs = {};
      for (const [name, value] of Object.entries(next.inputs)) {
        if (canonicalizeGeneratedIdentifier(name) !== oldId) inputs[name] = value;
        else if (newId && !Object.prototype.hasOwnProperty.call(inputs, newId)) inputs[newId] = value;
      }
      next.inputs = inputs;
    }
    return next;
  });
}

function inputUsedBySemanticContract(operation, rawName) {
  const name = canonicalizeGeneratedIdentifier(rawName);
  if (!name) return false;
  const templateUse = [...String(operation?.answerTemplate || "").matchAll(/{{\s*([a-zA-Z0-9_.-]+)/g)]
    .some((match) => canonicalizeGeneratedIdentifier(match[1]) === name);
  const calculationUse = (operation?.calculation?.operands || []).some((operand) =>
    String(operand?.source || "") === "input"
    && canonicalizeGeneratedIdentifier(operand?.inputName) === name
  );
  return templateUse || calculationUse;
}

function normalizeGeneratedConvertOwnerBindings(rawRequest, requirementSegments = []) {
  const request = clone(rawRequest || {});
  if (!Array.isArray(requirementSegments) || !requirementSegments.length) return request;
  request.operations = (Array.isArray(request.operations) ? request.operations : []).map((rawOperation) => {
    const operation = isObject(rawOperation) ? rawOperation : {};
    operation.inputs = Array.isArray(operation.inputs) ? operation.inputs : [];

    for (const input of [...operation.inputs]) {
      const oldName = input?.name;
      const address = contextAddress(input);
      if (address && String(address.subject).toLowerCase() === "speaker") {
        input.bindingHint.subject = "speaker";
      }
      if (
        !address
        || String(address.subject).toLowerCase() !== "speaker"
        || !isCurrentSpeakerIdentifier(input?.name)
        || explicitInputDeclaration(requirementSegments, input?.name)
      ) continue;
      const duplicate = operation.inputs.find((candidate) =>
        candidate !== input && contextAddress(candidate)?.key === address.key
      );
      const propertyName = canonicalizeGeneratedIdentifier(address.property);
      const replacementName = duplicate?.name
        || (propertyName && !isCurrentSpeakerIdentifier(propertyName)
          && !operation.inputs.some((candidate) =>
            candidate !== input
            && canonicalizeGeneratedIdentifier(candidate?.name) === propertyName
          ) ? propertyName : null);
      if (!replacementName) continue;
      if (duplicate) {
        operation.inputs = operation.inputs.filter((candidate) => candidate !== input);
      } else {
        input.name = replacementName;
      }
      remapInputReferences(operation, oldName, replacementName);
    }

    const speakerContextInputs = operation.inputs.filter((input) => {
      const address = contextAddress(input);
      return address && String(address.subject).toLowerCase() === "speaker";
    });
    if (!speakerContextInputs.length) return operation;

    for (const input of [...operation.inputs]) {
      if (
        !isCurrentSpeakerIdentifier(input?.name)
        || contextAddress(input)
        || explicitInputDeclaration(requirementSegments, input?.name)
        || inputUsedBySemanticContract(operation, input?.name)
      ) continue;
      const examples = exampleValuesForInput(operation, input.name);
      if (examples.some((value) => !isCurrentSpeakerValue(value))) continue;
      operation.inputs = operation.inputs.filter((candidate) => candidate !== input);
      remapInputReferences(operation, input.name, null);
    }
    return operation;
  });
  return request;
}

function filterGeneratedOwnerInputRequirements(rawBuildRequest, rawGroups, originalUtterance = "") {
  const buildRequest = clone(rawBuildRequest || {});
  const requirementSegments = String(originalUtterance || "").split(/\n+/).filter(Boolean);
  return (Array.isArray(rawGroups) ? clone(rawGroups) : []).map((group) => {
    if (!isObject(group)) return group;
    const operationId = canonicalizeGeneratedIdentifier(group.operationId);
    const operation = (buildRequest.operations || []).find((candidate) =>
      canonicalizeGeneratedIdentifier(candidate?.operationId) === operationId
    );
    const hasSpeakerContext = (operation?.inputs || []).some((input) => {
      const address = contextAddress(input);
      return address && String(address.subject).toLowerCase() === "speaker";
    });
    if (!hasSpeakerContext) return group;
    const next = { ...group };
    next.inputs = (Array.isArray(group.inputs) ? group.inputs : []).filter((input) => {
      const name = canonicalizeGeneratedIdentifier(input?.name);
      if (
        !isCurrentSpeakerIdentifier(name)
        || (operation?.inputs || []).some((existing) =>
          canonicalizeGeneratedIdentifier(existing?.name) === name
        )
        || explicitInputDeclaration(requirementSegments, name)
      ) return true;
      const values = [];
      for (const example of Array.isArray(group.utteranceExamples) ? group.utteranceExamples : []) {
        for (const item of Array.isArray(example?.inputValues) ? example.inputValues : []) {
          if (canonicalizeGeneratedIdentifier(item?.name) === name && item?.value != null) values.push(item.value);
        }
      }
      return values.some((value) => !isCurrentSpeakerValue(value));
    });
    const retained = new Set(next.inputs.map((input) => canonicalizeGeneratedIdentifier(input?.name)));
    next.utteranceExamples = (Array.isArray(group.utteranceExamples) ? group.utteranceExamples : []).map((example) => ({
      ...example,
      inputValues: (Array.isArray(example?.inputValues) ? example.inputValues : []).filter((item) => {
        const name = canonicalizeGeneratedIdentifier(item?.name);
        return (operation?.inputs || []).some((input) => canonicalizeGeneratedIdentifier(input?.name) === name)
          || retained.has(name);
      }),
    }));
    return next;
  });
}

module.exports = {
  isCurrentSpeakerIdentifier,
  normalizeGeneratedConvertOwnerBindings,
  filterGeneratedOwnerInputRequirements,
};
