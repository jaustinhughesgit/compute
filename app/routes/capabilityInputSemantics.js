/**
 * Platform: Keeps grammatical ownership separate from executable ordinary inputs in generated capability contracts.
 * Technical: Canonicalizes deictic ContextDB owners and removes only model-added current-speaker pseudo-inputs proven redundant.
 */
"use strict";

const {
  canonicalizeGeneratedIdentifier,
  normalizeContextBindingSubject,
} = require("./capabilityManifest");
const { declaredInvocationExamples } = require("./convertRequirements");

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

function explicitPropertyDeclaration(requirementSegments, rawProperty) {
  const property = canonicalizeGeneratedIdentifier(rawProperty).replace(/[_-]+/g, " ");
  if (!property) return false;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = (Array.isArray(requirementSegments) ? requirementSegments : [])
    .map((segment) => String(segment || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .toLowerCase())
    .join("\n");
  return [
    new RegExp(`\\bproperty\\s+(?:is|named|called)\\s+["']?${escaped}\\b`, "i"),
    new RegExp(`\\bproperty\\s+name\\s+(?:is|equals)\\s+["']?${escaped}\\b`, "i"),
  ].some((pattern) => pattern.test(text));
}

function currentSpeakerPropertyRequest(requirementSegments, rawProperty) {
  const property = canonicalizeGeneratedIdentifier(rawProperty).replace(/[_-]+/g, " ");
  if (!property) return false;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = (Array.isArray(requirementSegments) ? requirementSegments : [])
    .map((segment) => String(segment || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .toLowerCase())
    .join("\n");
  return [
    new RegExp(`\\b(?:my|my own)\\s+${escaped}\\b`, "i"),
    new RegExp(`\\b${escaped}\\s+(?:for|of)\\s+(?:me|myself|the current user)\\b`, "i"),
  ].some((pattern) => pattern.test(text));
}

function deicticPropertyValue(rawProperty) {
  const property = canonicalizeGeneratedIdentifier(rawProperty);
  const prefixes = ["my_", "speaker_", "current_user_", "current_speaker_"];
  const prefix = prefixes.find((value) => property.startsWith(value));
  return prefix ? property.slice(prefix.length) : "";
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
  operation.contextEffects = (Array.isArray(operation?.contextEffects)
    ? operation.contextEffects
    : []).map((effect) => {
    if (canonicalizeGeneratedIdentifier(effect?.subjectInput) !== oldId || !newId) return effect;
    return { ...effect, subjectInput: newId };
  });
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
  const contextEffectUse = (operation?.contextEffects || []).some((effect) =>
    canonicalizeGeneratedIdentifier(effect?.subjectInput) === name
  );
  return templateUse || calculationUse || contextEffectUse;
}

function semanticContractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeAnswerPlan(rawPlan) {
  if (!isObject(rawPlan)) return null;
  const source = String(rawPlan.source || "").trim().toLowerCase();
  const operationId = canonicalizeGeneratedIdentifier(rawPlan.operationId);
  const inputName = canonicalizeGeneratedIdentifier(rawPlan.inputName);
  const outputName = canonicalizeGeneratedIdentifier(rawPlan.outputName);
  const subject = source === "contextdb"
    ? normalizeContextBindingSubject(rawPlan.subject || "speaker")
    : String(rawPlan.subject || "").trim();
  const property = String(rawPlan.property || "").trim();
  return {
    source,
    operationId,
    inputName,
    outputName,
    subject,
    property,
    statement: String(rawPlan.statement || "").trim(),
  };
}

function repairFixedEffectAnswerPlan(rawPlan, operation) {
  if (rawPlan?.source !== "contextdb" || !rawPlan?.inputName) return rawPlan;
  const effect = (Array.isArray(operation?.contextEffects) ? operation.contextEffects : [])
    .find((candidate) => (
      candidate?.type === "contextdb.replace_object"
      && canonicalizeGeneratedIdentifier(candidate?.subjectInput) === rawPlan.inputName
      && String(candidate?.newValue ?? "").trim()
    ));
  if (!effect) return rawPlan;
  return {
    ...rawPlan,
    source: "literal",
    inputName: "",
    subject: "",
    property: "",
    statement: `The declared fixed transition result ${String(effect.newValue).trim()} answers the request.`,
  };
}

/**
 * Freezes the model's semantic answer decision before the executable contract
 * is accepted. This is deliberately generic: every plan must select a declared
 * operation/output, and browser-resolved sources must select a compatible input.
 */
function applyGeneratedAnswerPlan(rawRequest, rawPlan, requirementSegments = []) {
  const request = clone(rawRequest || {});
  let plan = normalizeAnswerPlan(rawPlan);
  if (!plan) return request;
  request.answerPlan = plan;
  if (!plan.operationId || !plan.outputName) {
    throw semanticContractError(
      "INCOMPLETE_ANSWER_PLAN",
      "an answer plan requires operationId and outputName"
    );
  }

  const operations = Array.isArray(request.operations) ? request.operations : [];
  const operation = operations.find((candidate) =>
    canonicalizeGeneratedIdentifier(candidate?.operationId) === plan.operationId
  );
  if (!operation) {
    throw semanticContractError(
      "ANSWER_PLAN_OPERATION_MISMATCH",
      `the answer plan references undeclared operation ${plan.operationId}`
    );
  }
  operation.inputs = Array.isArray(operation.inputs) ? operation.inputs : [];
  operation.outputs = Array.isArray(operation.outputs) ? operation.outputs : [];
  const output = operation.outputs.find((candidate) =>
    canonicalizeGeneratedIdentifier(candidate?.name) === plan.outputName
  );
  if (!output) {
    throw semanticContractError(
      "ANSWER_PLAN_OUTPUT_MISMATCH",
      `the answer plan references undeclared output ${plan.outputName}`
    );
  }

  plan = repairFixedEffectAnswerPlan(plan, operation);
  request.answerPlan = plan;

  if (plan.source === "calculation") {
    if (
      !isObject(operation.calculation)
      || canonicalizeGeneratedIdentifier(operation.calculation.outputName) !== plan.outputName
    ) {
      throw semanticContractError(
        "ANSWER_PLAN_CALCULATION_MISMATCH",
        `the answer plan output ${plan.outputName} is not produced by the declared calculation`
      );
    }
    return request;
  }
  if (plan.source === "none") {
    throw semanticContractError(
      "ANSWER_PLAN_SOURCE_MISSING",
      "a build answer plan must identify where its declared output comes from"
    );
  }
  if (["provider", "literal"].includes(plan.source)) return request;

  if (!plan.inputName) {
    throw semanticContractError(
      "INCOMPLETE_ANSWER_PLAN",
      `an answer plan with source ${plan.source || "(blank)"} requires inputName`
    );
  }
  if (plan.source !== "contextdb") {
    const input = operation.inputs.find((candidate) =>
      canonicalizeGeneratedIdentifier(candidate?.name) === plan.inputName
    );
    if (!input) {
      throw semanticContractError(
        "ANSWER_PLAN_INPUT_MISMATCH",
        `the answer plan input ${plan.inputName} is not represented by the generated operation`
      );
    }
    const generatedSource = String(input?.bindingHint?.source || "utterance").trim().toLowerCase();
    if (generatedSource !== plan.source) {
      throw semanticContractError(
        "ANSWER_PLAN_SOURCE_MISMATCH",
        `the answer plan source ${plan.source} disagrees with input ${plan.inputName} source ${generatedSource}`
      );
    }
    return request;
  }

  if (!plan.property) {
    throw semanticContractError(
      "INCOMPLETE_ANSWER_PLAN",
      "a ContextDB answer plan requires subject and property"
    );
  }
  if (plan.subject !== "speaker") {
    throw semanticContractError(
      "UNSUPPORTED_ANSWER_PLAN_SUBJECT",
      `the ContextDB answer plan subject ${plan.subject || "(blank)"} is not the current speaker`
    );
  }

  const plannedInput = operation.inputs.find((candidate) =>
    canonicalizeGeneratedIdentifier(candidate?.name) === plan.inputName
  );
  const addressedInput = operation.inputs.find((candidate) => {
    const address = contextAddress(candidate);
    return address
      && String(address.subject).toLowerCase() === "speaker"
      && canonicalizeGeneratedIdentifier(address.property) === canonicalizeGeneratedIdentifier(plan.property);
  });
  const deicticOwnerInput = operation.inputs.find((candidate) => {
    if (!isCurrentSpeakerIdentifier(candidate?.name)) return false;
    if (explicitInputDeclaration(requirementSegments, candidate?.name)) return false;
    const values = exampleValuesForInput(operation, candidate?.name);
    return values.length === 0 || values.every(isCurrentSpeakerValue);
  });
  const candidate = plannedInput || addressedInput || deicticOwnerInput;
  if (!candidate) {
    throw semanticContractError(
      "ANSWER_PLAN_INPUT_MISMATCH",
      `the answer plan input ${plan.inputName} is not represented by the generated operation`
    );
  }

  const conflictingInput = operation.inputs.find((other) =>
    other !== candidate
    && canonicalizeGeneratedIdentifier(other?.name) === plan.inputName
  );
  if (conflictingInput) {
    throw semanticContractError(
      "ANSWER_PLAN_INPUT_CONFLICT",
      `the answer plan input ${plan.inputName} conflicts with another generated input`
    );
  }

  const candidateAddress = contextAddress(candidate);
  if (!candidateAddress && explicitInputDeclaration(requirementSegments, candidate?.name)) {
    throw semanticContractError(
      "ANSWER_PLAN_SOURCE_MISMATCH",
      `the answer plan cannot rewrite explicitly declared input ${candidate.name} as ContextDB data`
    );
  }
  const candidateExamples = exampleValuesForInput(operation, candidate?.name);
  if (
    !candidateAddress
    && candidateExamples.some((value) => !isCurrentSpeakerValue(value))
    && !currentSpeakerPropertyRequest(requirementSegments, plan.property)
  ) {
    const isEffectSubject = (operation.contextEffects || []).some((effect) =>
      canonicalizeGeneratedIdentifier(effect?.subjectInput) === canonicalizeGeneratedIdentifier(candidate.name)
    );
    throw semanticContractError(
      "ANSWER_PLAN_SOURCE_MISMATCH",
      isEffectSubject
        ? `the answer plan cannot rewrite effect subject ${candidate.name} as ContextDB answer data; use source literal for its declared result output`
        : `the answer plan cannot rewrite input ${candidate.name} because its examples contain ordinary values`
    );
  }

  const oldName = candidate.name;
  candidate.name = plan.inputName;
  candidate.bindingHint = {
    source: "contextdb",
    subject: "speaker",
    property: plan.property,
    resolver: null,
    aliases: null,
    value: null,
  };
  candidate.required = true;
  candidate.clarification = null;
  candidate.defaultValue = null;
  remapInputReferences(operation, oldName, plan.inputName);

  // ContextDB values are resolved at invocation time. Model-authored example
  // annotations such as {user: "my"} are grammatical evidence, not values.
  operation.utteranceExamples = (operation.utteranceExamples || []).map((example) => {
    if (!isObject(example)) return example;
    const next = clone(example);
    if (isObject(next.inputs)) delete next.inputs[plan.inputName];
    if (Array.isArray(next.inputValues)) {
      next.inputValues = next.inputValues.filter((item) =>
        canonicalizeGeneratedIdentifier(item?.name) !== plan.inputName
      );
    }
    return next;
  });
  if (!String(operation.answerTemplate || "").trim()) {
    operation.answerTemplate = `{{${plan.outputName}}}`;
  }
  return request;
}

function normalizeGeneratedConvertOwnerBindings(rawRequest, requirementSegments = []) {
  const request = clone(rawRequest || {});
  if (!Array.isArray(requirementSegments) || !requirementSegments.length) return request;
  request.operations = (Array.isArray(request.operations) ? request.operations : []).map((rawOperation) => {
    const operation = isObject(rawOperation) ? rawOperation : {};
    operation.inputs = Array.isArray(operation.inputs) ? operation.inputs : [];

    for (const input of [...operation.inputs]) {
      const hint = isObject(input?.bindingHint) ? input.bindingHint : null;
      const subject = String(hint?.source || "").toLowerCase() === "contextdb"
        ? normalizeContextBindingSubject(hint.subject || "speaker")
        : "";
      const propertyValue = deicticPropertyValue(hint?.property);
      if (
        subject === "speaker"
        && propertyValue
        && propertyValue === canonicalizeGeneratedIdentifier(input?.name)
        && !explicitPropertyDeclaration(requirementSegments, hint?.property)
      ) {
        // A generated `myRegisterStatus` property confuses the grammatical
        // owner with the owned value. The owner is already the speaker subject;
        // the property address is the non-deictic input semantic.
        hint.property = propertyValue;
      }
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

function declaredSingleSlotFamilies(requirementSegments) {
  const groups = new Map();
  for (const text of declaredInvocationExamples(requirementSegments)) {
    const tokens = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    if (!tokens.length) continue;
    const group = groups.get(tokens.length) || [];
    group.push(tokens);
    groups.set(tokens.length, group);
  }
  const families = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let prefixLength = 0;
    while (
      prefixLength < group[0].length
      && group.every((tokens) => tokens[prefixLength] === group[0][prefixLength])
    ) prefixLength += 1;
    let suffixLength = 0;
    while (
      suffixLength < group[0].length - prefixLength
      && group.every((tokens) =>
        tokens[tokens.length - 1 - suffixLength]
          === group[0][group[0].length - 1 - suffixLength]
      )
    ) suffixLength += 1;
    const values = group.map((tokens) =>
      tokens.slice(prefixLength, tokens.length - suffixLength).join(" ")
    );
    if (values.some((value) => !value) || new Set(values).size < 2) continue;
    families.push(values);
  }
  return families;
}

function filterGeneratedEffectInputRequirements(rawBuildRequest, rawGroups, originalUtterance = "") {
  const buildRequest = clone(rawBuildRequest || {});
  const requirementSegments = String(originalUtterance || "").split(/\n+/).filter(Boolean);
  const families = declaredSingleSlotFamilies(requirementSegments);
  if (!families.length) return Array.isArray(rawGroups) ? clone(rawGroups) : [];
  return (Array.isArray(rawGroups) ? clone(rawGroups) : []).map((group) => {
    if (!isObject(group)) return group;
    const operationId = canonicalizeGeneratedIdentifier(group.operationId);
    const operation = (buildRequest.operations || []).find((candidate) =>
      canonicalizeGeneratedIdentifier(candidate?.operationId) === operationId
    );
    const effectSubjects = new Set((operation?.contextEffects || []).map((effect) =>
      canonicalizeGeneratedIdentifier(effect?.subjectInput)
    ).filter(Boolean));
    if (effectSubjects.size !== 1) return group;
    const [subjectInput] = effectSubjects;
    const subjectValues = new Set((operation?.utteranceExamples || []).flatMap((example) => {
      if (!isObject(example) || !isObject(example.inputs)) return [];
      return Object.entries(example.inputs)
        .filter(([name]) => canonicalizeGeneratedIdentifier(name) === subjectInput)
        .map(([, value]) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean);
    }));
    if (!families.some((values) => values.every((value) => subjectValues.has(value)))) return group;
    const existing = new Set((operation?.inputs || []).map((input) =>
      canonicalizeGeneratedIdentifier(input?.name)
    ).filter(Boolean));
    const effectFixedValues = new Set((operation?.contextEffects || []).flatMap((effect) => [
      String(effect?.currentValue ?? "").trim().toLowerCase(),
      String(effect?.newValue ?? "").trim().toLowerCase(),
    ]).filter(Boolean));
    const next = { ...group };
    next.inputs = (Array.isArray(group.inputs) ? group.inputs : []).filter((input) => {
      const name = canonicalizeGeneratedIdentifier(input?.name);
      if (
        !name
        || existing.has(name)
        || explicitInputDeclaration(requirementSegments, name)
      ) return true;
      const annotations = (Array.isArray(group.utteranceExamples)
        ? group.utteranceExamples
        : []).flatMap((example) => (Array.isArray(example?.inputValues)
        ? example.inputValues
            .filter((item) => canonicalizeGeneratedIdentifier(item?.name) === name)
            .map((item) => ({
              text: String(example?.text || ""),
              value: String(item?.value ?? "").trim(),
            }))
        : [])).filter((item) => item.value);
      const duplicatesFixedTransition = annotations.length > 0
        && annotations.every(({ text, value }) => {
          const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const normalizedText = ` ${String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
          return effectFixedValues.has(value.toLowerCase())
            && normalizedValue
            && !normalizedText.includes(` ${normalizedValue} `);
        });
      if (duplicatesFixedTransition) return false;
      if (String(input?.bindingHint?.source || "utterance").toLowerCase() !== "utterance") {
        return true;
      }
      // One declared varying referent already owns the effect subject. Do not
      // split that same surface into a second required specialization.
      return false;
    });
    const retained = new Set(next.inputs.map((input) =>
      canonicalizeGeneratedIdentifier(input?.name)
    ));
    next.utteranceExamples = (Array.isArray(group.utteranceExamples) ? group.utteranceExamples : [])
      .map((example) => ({
        ...example,
        inputValues: (Array.isArray(example?.inputValues) ? example.inputValues : []).filter((item) => {
          const name = canonicalizeGeneratedIdentifier(item?.name);
          return existing.has(name) || retained.has(name);
        }),
      }));
    return next;
  });
}

function filterGeneratedInputRequirements(rawBuildRequest, rawGroups, originalUtterance = "") {
  return filterGeneratedEffectInputRequirements(
    rawBuildRequest,
    filterGeneratedOwnerInputRequirements(rawBuildRequest, rawGroups, originalUtterance),
    originalUtterance
  );
}

module.exports = {
  explicitInputDeclaration,
  isCurrentSpeakerIdentifier,
  applyGeneratedAnswerPlan,
  normalizeGeneratedConvertOwnerBindings,
  declaredSingleSlotFamilies,
  filterGeneratedOwnerInputRequirements,
  filterGeneratedEffectInputRequirements,
  filterGeneratedInputRequirements,
};
