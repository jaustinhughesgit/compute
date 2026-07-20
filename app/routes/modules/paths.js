// modules/paths.js
"use strict";

/**
 * DynamoDB tables
 *  - paths
 *      PK:  id (S)           e.g. "p1234"
 *      ATTR: e (S)           entity id the path belongs to
 *            by (S)          creator E (from cookie)
 *            sig (S)         signature (unique per e)
 *            left (S)        JSON string
 *            right (S)       JSON string
 *            createdAt (S)   ISO
 *            updatedAt (S)   ISO
 *    GSIs:
 *      - eSigIndex  (PK: e, SK: sig)         // fast idempotent upsert by (e,sig)
 *      - eIndex     (PK: e, SK: updatedAt)   // list paths for an entity page
 *      - byIndex    (PK: by, SK: updatedAt)  // optional auditing by creator
 *
 *  - pCounter
 *      PK: pk (S)       always "paths"
 *      ATTR: x (N)     monotonically increasing counter
 */



// ---------------------------------------------------------------------------
// Semantic-family safety and migration helpers
// ---------------------------------------------------------------------------

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

const V3_PATTERN_KINDS = new Set(["statement", "question", "command"]);
const V3_SEGMENT_KINDS = new Set(["literal", "lemma", "normal", "tag", "slot"]);
const V3_SLOT_TYPES = new Set([
  "person", "organization", "item", "quantity", "number", "activity_phrase",
  "event_type", "date", "time", "duration", "location", "status", "goal_type",
  "record_reference", "property_value", "frequency", "deadline", "reason",
  "entity_lemma", "entity_reference", "registered_target", "query", "string",
]);
const SAFE_COMMAND_ACTIONS = new Set(["open", "close", "show", "hide", "go_to", "select"]);
const EXECUTABLE_COMMAND_FIELDS = new Set(["function", "fn", "custom", "code", "script", "handler", "eval", "worker"]);
const COMPUTE_BINDING_SOURCES = new Set(["utterance", "contextdb", "environment", "default"]);

function patternId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function structuralPatternSignature(pattern) {
  const id = patternId(pattern?.patternId);
  return id ? `pattern:v3:${id}` : "";
}

function validatePatternSyntax(syntax, definitions, label) {
  if (!Array.isArray(syntax) || !syntax.length) {
    throw new Error(`${label} must contain at least one syntax segment`);
  }
  for (const [index, segment] of syntax.entries()) {
    const kind = String(segment?.kind || "");
    if (!V3_SEGMENT_KINDS.has(kind)) {
      throw new Error(`${label}[${index}] has unsupported kind ${kind || "(blank)"}`);
    }
    if (kind === "slot") {
      const slot = String(segment?.slot || "").trim();
      if (!slot || !definitions.has(slot)) {
        throw new Error(`${label}[${index}] references unknown slot ${slot || "(blank)"}`);
      }
    } else if (!String(segment?.value || "").trim()) {
      throw new Error(`${label}[${index}] requires value`);
    }
  }
}

function validateStructuralPattern(pattern) {
  if (!pattern || typeof pattern !== "object" || Array.isArray(pattern)) {
    throw new Error("left.state.pattern must be an object");
  }
  if (Number(pattern.schemaVersion || 0) !== 3) {
    throw new Error("left.state.pattern.schemaVersion must be 3");
  }
  if (!patternId(pattern.patternId)) throw new Error("left.state.pattern.patternId is required");
  if (!V3_PATTERN_KINDS.has(String(pattern.kind || ""))) {
    throw new Error("left.state.pattern.kind must be statement, question, or command");
  }
  if (!String(pattern.operation || "").trim()) {
    throw new Error("left.state.pattern.operation is required");
  }

  const definitions = new Map();
  for (const [index, definition] of (Array.isArray(pattern.slotDefinitions) ? pattern.slotDefinitions : []).entries()) {
    const name = String(definition?.name || "").trim();
    if (!name || definitions.has(name)) throw new Error(`slotDefinitions[${index}] needs a unique name`);
    if (!V3_SLOT_TYPES.has(String(definition?.type || ""))) {
      throw new Error(`slot definition ${name} has unsupported type`);
    }
    const min = Number(definition?.minTokens);
    const max = Number(definition?.maxTokens);
    if (!Number.isInteger(min) || min < 1 || !Number.isInteger(max) || max < min || max > 20) {
      throw new Error(`slot definition ${name} has an invalid token range`);
    }
    if (!Array.isArray(definition?.bindingNames)) {
      throw new Error(`slot definition ${name} requires bindingNames`);
    }
    definitions.set(name, definition);
  }

  validatePatternSyntax(pattern.core, definitions, "pattern.core");
  const modifierIds = new Set();
  for (const [index, modifier] of (Array.isArray(pattern.modifiers) ? pattern.modifiers : []).entries()) {
    const id = patternId(modifier?.modifierId);
    if (!id || modifierIds.has(id)) throw new Error(`modifiers[${index}] needs a unique modifierId`);
    modifierIds.add(id);
    if (!["before", "after"].includes(String(modifier?.position || ""))) {
      throw new Error(`modifier ${id} position must be before or after`);
    }
    validatePatternSyntax(modifier?.syntax, definitions, `modifier ${id}`);
  }

  if (pattern.projection != null) {
    if (!patternId(pattern.projection?.projectionId)) throw new Error("projection.projectionId is required");
    if (!String(pattern.projection?.type || "").trim()) throw new Error("projection.type is required");
    if (!["before", "after"].includes(String(pattern.projection?.position || ""))) {
      throw new Error("projection.position must be before or after");
    }
    validatePatternSyntax(pattern.projection?.syntax, definitions, "projection.syntax");
  }

  for (const [index, alias] of (Array.isArray(pattern.tokenizerAliases) ? pattern.tokenizerAliases : []).entries()) {
    const slot = String(alias?.slot || "").trim();
    const slotType = String(alias?.slotType || "").trim();
    if (slot && !definitions.has(slot)) throw new Error(`tokenizerAliases[${index}] references unknown slot ${slot}`);
    if (slotType && !V3_SLOT_TYPES.has(slotType)) throw new Error(`tokenizerAliases[${index}] has unsupported slotType`);
    if (!slot && !slotType) throw new Error(`tokenizerAliases[${index}] needs slot or slotType`);
    if (!String(alias?.lemma || "").trim() && !String(alias?.fromTag || "").trim()) {
      throw new Error(`tokenizerAliases[${index}] needs lemma or fromTag`);
    }
  }
  return { definitions };
}

function collectTransformBindingReferences(value, out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTransformBindingReferences(entry, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  if (["binding", "instanceBinding"].includes(String(value.ref || ""))) {
    const name = String(value.name || "").trim();
    if (name) out.add(name);
  }
  if (String(value.ref || "") === "boundVar") {
    const name = String(value.base || "").trim();
    if (name) out.add(name);
  }
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === "object") collectTransformBindingReferences(entry, out);
  });
  return out;
}

function rejectExecutableCommandFields(value, location = "right.state") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExecutableCommandFields(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (EXECUTABLE_COMMAND_FIELDS.has(String(key).toLowerCase())) {
      throw new Error(`${location}.${key} is not allowed in a declarative command Path`);
    }
    if (entry && typeof entry === "object") rejectExecutableCommandFields(entry, `${location}.${key}`);
  }
}

function validateComputeCapabilityState(state, pattern) {
  const compute = state?.compute;
  if (!compute || typeof compute !== "object" || Array.isArray(compute)) {
    throw new Error("computeCapability Paths require right.state.compute");
  }
  if (Number(compute.schemaVersion || 0) !== 1) {
    throw new Error("right.state.compute.schemaVersion must be 1");
  }
  for (const [label, value] of [
    ["capabilityId", compute.capabilityId],
    ["entityId", compute.entityId],
    ["operationId", compute.operationId],
  ]) {
    const text = String(value || "").trim();
    if (!text || text.length > 160) throw new Error(`right.state.compute.${label} is required`);
  }
  if (!Number.isInteger(Number(compute.version)) || Number(compute.version) < 1) {
    throw new Error("right.state.compute.version must be a positive integer");
  }
  if (String(pattern?.kind || "") !== "question" || String(state?.mode || "") !== "question") {
    throw new Error("computeCapability Paths must be question Paths");
  }
  if (String(pattern?.operation || "") !== "invoke_compute_capability" || String(state?.operation || "") !== "invoke_compute_capability") {
    throw new Error("computeCapability Paths must use invoke_compute_capability");
  }
  if (!String(compute.answerTemplate || "").trim() || String(compute.answerTemplate).length > 1500) {
    throw new Error("computeCapability Paths require a bounded answerTemplate");
  }

  const inputNames = new Set();
  for (const [index, input] of (Array.isArray(compute.inputs) ? compute.inputs : []).entries()) {
    const name = String(input?.name || "").trim();
    if (!name || inputNames.has(name)) throw new Error(`compute input ${index + 1} needs a unique name`);
    inputNames.add(name);
    const hint = input?.bindingHint;
    if (hint != null) {
      if (!hint || typeof hint !== "object" || Array.isArray(hint)) throw new Error(`compute input ${name} bindingHint must be an object`);
      const source = String(hint.source || "").trim().toLowerCase();
      if (!COMPUTE_BINDING_SOURCES.has(source)) throw new Error(`compute input ${name} has unsupported binding source`);
      if (source === "contextdb" && (!String(hint.subject || "").trim() || !String(hint.property || "").trim())) {
        throw new Error(`compute input ${name} contextdb binding requires subject and property`);
      }
      if (source === "environment" && !String(hint.resolver || "").trim()) {
        throw new Error(`compute input ${name} environment binding requires resolver`);
      }
    }
  }
  if (!Array.isArray(compute.outputs) || !compute.outputs.length) {
    throw new Error("computeCapability Paths require declared outputs");
  }
  const outputNames = new Set();
  for (const [index, output] of compute.outputs.entries()) {
    const name = String(output?.name || "").trim();
    if (!name || outputNames.has(name)) throw new Error(`compute output ${index + 1} needs a unique name`);
    outputNames.add(name);
  }
  const placeholders = [...String(compute.answerTemplate).matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)]
    .map((match) => match[1]);
  if (placeholders.some((name) => !outputNames.has(name) && !inputNames.has(name))) {
    throw new Error("compute answerTemplate references an undeclared input or output");
  }
  if ((Array.isArray(state.rows) && state.rows.length) || (Array.isArray(state.levels) && state.levels.length)) {
    throw new Error("computeCapability Paths may not contain essence rows or executable menu levels");
  }
  rejectExecutableCommandFields(state, "right.state");
  return true;
}

function validateQualityContract(path) {
  const tests = path?.tests;
  const quality = path?.quality;
  const contractSupplied = tests != null || quality != null;
  const importedStructuralPath = !!path?.repair?.importedDataset && !!path?.left?.state?.pattern;
  if (!contractSupplied && !importedStructuralPath) return true;
  if (!tests || typeof tests !== "object" || Array.isArray(tests)) {
    throw new Error("tested structural Paths require tests");
  }
  if (Number(tests.schemaVersion || 0) !== 1) {
    throw new Error("tests.schemaVersion must be 1");
  }
  if (!Array.isArray(tests.positive) || tests.positive.length < 2) {
    throw new Error("tested structural Paths require at least two positive tests");
  }
  if (!Array.isArray(tests.negative) || tests.negative.length < 2) {
    throw new Error("tested structural Paths require at least two negative tests");
  }
  for (const [kind, list] of [["positive", tests.positive], ["negative", tests.negative]]) {
    for (const [index, test] of list.entries()) {
      if (!String(test?.input || "").trim()) {
        throw new Error(`${kind} test ${index + 1} requires input`);
      }
    }
  }
  if (!quality || typeof quality !== "object" || Array.isArray(quality)) {
    throw new Error("tested structural Paths require quality results");
  }
  if (Number(quality.schemaVersion || 0) !== 1) {
    throw new Error("quality.schemaVersion must be 1");
  }
  if (!quality.approved || String(quality.status || "") !== "approved") {
    throw new Error("quality gate must approve the Path before installation");
  }
  if (Number(quality.score || 0) < Number(quality.threshold || 75)) {
    throw new Error("quality score is below its installation threshold");
  }
  const dimensions = quality.dimensions && typeof quality.dimensions === "object"
    ? quality.dimensions
    : null;
  if (!dimensions || Object.values(dimensions).some((value) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
    throw new Error("quality dimensions must contain scores from 0 to 100");
  }
  if (Array.isArray(quality.blockers) && quality.blockers.length) {
    throw new Error("quality results contain installation blockers");
  }
  if (Array.isArray(quality?.collisions?.conflicts) && quality.collisions.conflicts.length) {
    throw new Error("quality results contain structural collisions");
  }
  return true;
}

function validatePathForPersistence(path) {
  const sig = String(path?.sig || path?.signature || "").trim();
  if (!sig) throw new Error("missing sig");
  if (!path?.left || !path?.right) throw new Error("left and right are required");

  const pattern = path.left?.state?.pattern;
  if (pattern == null) return true; // Existing schema-v2 exact Paths remain valid.

  const { definitions } = validateStructuralPattern(pattern);
  const expectedSignature = structuralPatternSignature(pattern);
  if (sig !== expectedSignature) {
    throw new Error(`structural Path sig must be ${expectedSignature}`);
  }

  const right = path.right || {};
  const state = right.state || {};
  if (Number(state.schemaVersion || 0) < 3) {
    throw new Error("structural Paths require right.state.schemaVersion 3");
  }
  if (!String(state.familyId || path?.family?.id || "").trim()) {
    throw new Error("structural Paths require a semantic familyId");
  }
  if (String(state.operation || "").trim() !== String(pattern.operation || "").trim()) {
    throw new Error("left pattern operation must equal right transform operation");
  }

  if (String(right.lib || "").toLowerCase() === "classifier") {
    if (String(state.stage || "") !== "identify") {
      throw new Error("structural classifier Paths require stage identify");
    }
    if (String(state.kind || "") !== String(pattern.kind || "")) {
      throw new Error("structural classifier kind must equal pattern kind");
    }
    if (String(path?.family?.role || "classifier").toLowerCase() !== "classifier") {
      throw new Error("structural classifier family role must be classifier");
    }
    return true;
  }

  validateQualityContract(path);

  const patternKind = String(pattern.kind || "");
  const mode = String(state.mode || "");
  if (
    (patternKind === "statement" && mode !== "statement")
    || (patternKind === "question" && mode !== "question")
    || (patternKind === "command" && !["command", "question"].includes(mode))
  ) {
    throw new Error(`pattern kind ${patternKind} is incompatible with transform mode ${mode || "(blank)"}`);
  }

  if (String(right.lib || "").toLowerCase() === "menu" && patternKind === "command") {
    const command = state.command && typeof state.command === "object" && !Array.isArray(state.command)
      ? state.command
      : null;
    if (!command || Number(command.schemaVersion || 0) !== 1) {
      throw new Error("structural menu Paths require right.state.command schemaVersion 1");
    }
    const action = String(command.action || "").trim().toLowerCase();
    if (!SAFE_COMMAND_ACTIONS.has(action)) {
      throw new Error(`unsupported declarative command action ${action || "(blank)"}`);
    }
    const targetType = String(command.targetType || "registered").trim().toLowerCase();
    if (!["registered", "any", "menu", "application"].includes(targetType)) {
      throw new Error("declarative command targetType must be registered, menu, or application");
    }
    const targetSlot = String(command.targetSlot || "").trim();
    if (!targetSlot || String(definitions.get(targetSlot)?.type || "") !== "registered_target") {
      throw new Error("declarative command targetSlot must reference a registered_target slot");
    }
    if (Array.isArray(state.levels) && state.levels.length) {
      throw new Error("structural menu Paths must use a command object instead of executable menu levels");
    }
    rejectExecutableCommandFields(state, "right.state");
    return true;
  }

  if (String(right.lib || "").toLowerCase() === "computecapability") {
    return validateComputeCapabilityState(state, pattern);
  }

  const bindings = Array.isArray(state.bindings) ? state.bindings : [];
  const bindingNames = new Set();
  for (const binding of bindings) {
    const name = String(binding?.name || "").trim();
    if (!name || bindingNames.has(name)) throw new Error("right bindings must have unique names");
    bindingNames.add(name);
  }

  const capturedBindingNames = new Set();
  for (const [slotName, definition] of definitions.entries()) {
    capturedBindingNames.add(slotName);
    for (const name of Array.isArray(definition.bindingNames) ? definition.bindingNames : []) {
      if (String(name || "").trim()) capturedBindingNames.add(String(name).trim());
    }
  }
  for (const binding of bindings) {
    if (String(binding?.source || "") === "token" && !capturedBindingNames.has(String(binding?.name || ""))) {
      throw new Error(`token binding ${binding.name || "(blank)"} is not supplied by a typed pattern slot`);
    }
  }

  const conditionalRows = Array.isArray(state.conditionalRows) ? state.conditionalRows : [];
  if (right.lib === "essenceTransform" && !Array.isArray(state.conditionalRows)) {
    throw new Error("structural essence transforms require conditionalRows");
  }
  for (const condition of conditionalRows) {
    if (!Array.isArray(condition?.rows)) throw new Error("each conditionalRows item requires rows");
    const names = [
      ...(Array.isArray(condition?.whenAll) ? condition.whenAll : []),
      ...(Array.isArray(condition?.whenAny) ? condition.whenAny : []),
    ];
    if (!names.length) throw new Error("conditionalRows requires whenAll or whenAny");
    for (const name of names) {
      if (!bindingNames.has(String(name))) throw new Error(`conditionalRows references unknown binding ${name}`);
    }
  }

  const referenced = collectTransformBindingReferences([
    state.rows || [],
    conditionalRows,
    state.forEach || [],
  ]);
  for (const name of referenced) {
    if (!bindingNames.has(name)) throw new Error(`transform references unknown binding ${name}`);
  }
  return true;
}

function normalizePredicateName(value) {
  let text = String(value == null ? "" : value).trim().toLowerCase();
  if (/^\{[^{}]+\}$/.test(text)) text = text.slice(1, -1).trim();
  text = text.replace(/^action:/, "").trim();
  text = text.replace(/^(?:prop|property):/, "").trim();
  return text;
}

function rightMode(path) {
  return String(path?.right?.state?.mode || "statement").trim().toLowerCase();
}

function pathFamilyId(path) {
  return String(path?.right?.state?.familyId || path?.family?.id || "").trim();
}

function walkRows(right) {
  const state = right?.state || {};
  const rows = [];
  for (const row of Array.isArray(state.rows) ? state.rows : []) {
    if (Array.isArray(row)) rows.push(row);
  }
  for (const loop of Array.isArray(state.forEach) ? state.forEach : []) {
    for (const row of Array.isArray(loop?.rows) ? loop.rows : []) {
      if (Array.isArray(row)) rows.push(row);
    }
  }
  return rows;
}

function rowContainsAsk(row) {
  return (Array.isArray(row) ? row : []).some((cell) => {
    if (typeof cell === "string") return cell.trim().toLowerCase() === "{ask}";
    return !!cell && typeof cell === "object" && String(cell.ref || "").toLowerCase() === "ask";
  });
}

function pathAnswerTargets(path) {
  if (rightMode(path) !== "question") return [];
  const targets = [];
  for (const row of walkRows(path?.right)) {
    if (!rowContainsAsk(row)) continue;
    const predicate = normalizePredicateName(row[2]);
    if (predicate && !targets.includes(predicate)) targets.push(predicate);
  }
  return targets;
}

function answerCategory(target) {
  const value = normalizePredicateName(target);
  if (["with", "person", "people", "participant", "participants", "attendee", "attendees"].includes(value)) {
    return "person";
  }
  if ([
    "time", "time_reference", "time_start_iso", "time_end_iso", "time_tz",
    "time_granularity", "date", "date_iso", "by_day", "weekday"
  ].includes(value)) {
    return "time";
  }
  if (["location", "address", "live_at", "where"].includes(value)) return "location";
  if (["age", "age_value", "age_at_event"].includes(value)) return "age";
  if (["quantity", "count", "number", "total"].includes(value)) return "quantity";
  return value || "unknown";
}

function pathAnswerCategory(path) {
  const familyId = pathFamilyId(path).toLowerCase();
  if (/meeting.*person.*time|meeting.*time/.test(familyId)) return "time";
  if (/meeting.*person.*query|meeting.*with.*query/.test(familyId)) return "person";
  const categories = pathAnswerTargets(path).map(answerCategory).filter(Boolean);
  return categories[0] || "unknown";
}

function aliasExamples(alias) {
  return [
    alias?.example,
    ...(Array.isArray(alias?.examples) ? alias.examples : []),
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function aliasIntentCategory(alias) {
  const text = aliasExamples(alias).join(" ").toLowerCase();
  const sig = String(alias?.sig || "").toLowerCase();
  const source = `${text} ${sig}`;

  if (/^(?:who|whom)\b/.test(text) || /(?:^|\|)lemma:(?:who|whom)(?:\||$)/.test(sig)) {
    return "person";
  }
  if (/^(?:when|what time)\b/.test(text) || /(?:^|\|)lemma:when(?:\||$)/.test(sig)) {
    return "time";
  }
  if (/^(?:where)\b/.test(text) || /(?:^|\|)lemma:where(?:\||$)/.test(sig)) {
    return "location";
  }
  if (/^(?:how old|what age|at what age)\b/.test(text) || /lemma:how\|lemma:old/.test(sig)) {
    return "age";
  }
  if (/^(?:how many|what number|total number)\b/.test(text) || /lemma:how\|lemma:many/.test(sig)) {
    return "quantity";
  }

  // If a generated alias includes a meeting and a date but starts with WHO,
  // the answer target is still the person, not the date constraint.
  if (/\bmeeting\b/.test(source) && /\bwho\b|lemma:who/.test(source)) return "person";
  return "unknown";
}

function collectBindingReferences(value, out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectBindingReferences(entry, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const ref = String(value.ref || "");
  if (ref === "binding" || ref === "instanceBinding") {
    const name = String(value.name || "").trim();
    if (name) out.add(name);
  }
  if (ref === "boundVar") {
    const base = String(value.base || "").trim();
    if (base) out.add(base);
  }
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === "object") collectBindingReferences(entry, out);
  });
  return out;
}

function requiredBindingNames(path) {
  const out = new Set();
  collectBindingReferences(path?.right?.state?.rows || [], out);
  collectBindingReferences(path?.right?.state?.forEach || [], out);
  return out;
}

function ensureAliasBindingsForTarget(alias, targetPath) {
  const next = cloneJson(alias);
  const bindings = Array.isArray(next.bindings) ? next.bindings : [];
  const byName = new Map(bindings.map((binding) => [String(binding?.name || "").trim(), binding]));
  const canonicalBindings = new Map(
    (Array.isArray(targetPath?.right?.state?.bindings) ? targetPath.right.state.bindings : [])
      .map((binding) => [String(binding?.name || "").trim(), binding])
  );

  for (const name of requiredBindingNames(targetPath)) {
    if (byName.has(name)) continue;
    const canonical = canonicalBindings.get(name);
    // Current-speaker and literal bindings are syntax independent and can be
    // copied safely. Token bindings must be supplied by the alias itself.
    if (canonical && ["currentSpeaker", "literal"].includes(String(canonical.source || ""))) {
      const copy = cloneJson(canonical);
      bindings.push(copy);
      byName.set(name, copy);
      continue;
    }
    return null;
  }

  next.bindings = bindings;
  return next;
}

function bindingRef(name) {
  return {
    ref: "binding",
    token: null,
    name,
    base: null,
    index: null,
  };
}

function ensureCurrentSpeakerBinding(bindings, name) {
  const list = Array.isArray(bindings) ? bindings : [];
  if (!list.some((binding) => String(binding?.name || "") === name)) {
    list.push({
      name,
      source: "currentSpeaker",
      token: null,
      tokenEnd: null,
      value: "resolvedEntity",
      literal: null,
    });
  }
  return list;
}

function normalizeMeetingQuestionPath(path) {
  const next = cloneJson(path);
  if (next?.right?.lib !== "essenceTransform" || rightMode(next) !== "question") return next;

  const familyId = pathFamilyId(next).toLowerCase();
  const category = pathAnswerCategory(next);
  const isMeeting = familyId.includes("meeting")
    || JSON.stringify(next?.right?.state?.rows || []).toLowerCase().includes("meeting_record");
  if (!isMeeting || !["person", "time"].includes(category)) return next;

  const state = next.right.state || (next.right.state = {});
  let bindings = Array.isArray(state.bindings) ? state.bindings : [];
  bindings = ensureCurrentSpeakerBinding(bindings, "owner");

  if (category === "person") {
    state.familyId = "personal_meeting_person_query";
    state.rows = [
      ["*", bindingRef("owner"), "have", "{meeting_record}"],
      ["present", "{meeting_record}", "{prop:with}", "{ask}"],
    ];
  } else {
    state.familyId = "personal_meeting_person_time_query";
    state.rows = [
      ["*", bindingRef("owner"), "have", "{meeting_record}"],
      ["present", "{meeting_record}", "{prop:with}", bindingRef("person")],
      ["present", "{meeting_record}", "{prop:time_reference}", "{ask}"],
    ];
  }

  state.bindings = bindings;
  state.answerTemplate = "{{ask|join:, }}";
  state.metadata = {
    ...(state.metadata || {}),
    pathsSemanticRepair: "meeting-question-answer-target-v1",
  };
  next.family = {
    ...(next.family || {}),
    id: state.familyId,
  };
  return next;
}

function pathLooksLikeMeeting(path) {
  return pathFamilyId(path).toLowerCase().includes("meeting")
    || JSON.stringify(path?.right?.state?.rows || []).toLowerCase().includes("meeting_record");
}

function chooseAliasDestination(paths, alias, sourcePath) {
  const intent = aliasIntentCategory(alias);
  if (intent === "unknown") return null;
  const sourceMeeting = pathLooksLikeMeeting(sourcePath)
    || aliasExamples(alias).some((example) => /\bmeeting\b/i.test(example));

  const candidates = paths.filter((path) => {
    if (rightMode(path) !== "question") return false;
    if (pathAnswerCategory(path) !== intent) return false;
    if (sourceMeeting && !pathLooksLikeMeeting(path)) return false;
    return true;
  });

  candidates.sort((a, b) => {
    const aFamily = pathFamilyId(a).toLowerCase();
    const bFamily = pathFamilyId(b).toLowerCase();
    const exact = intent === "person" ? "personal_meeting_person_query" : "personal_meeting_person_time_query";
    return Number(bFamily === exact) - Number(aFamily === exact);
  });
  return candidates[0] || null;
}

function migrateAliasesAcrossPaths(inputPaths) {
  const paths = (Array.isArray(inputPaths) ? inputPaths : []).map(normalizeMeetingQuestionPath);
  const migrations = [];

  for (const source of paths) {
    const family = source.family || (source.family = {});
    const aliases = Array.isArray(family.aliases) ? family.aliases : [];
    const canonicalCategory = pathAnswerCategory(source);
    const kept = [];

    for (const originalAlias of aliases) {
      const alias = cloneJson(originalAlias);
      const intent = aliasIntentCategory(alias);
      const compatible = rightMode(source) !== "question"
        || intent === "unknown"
        || canonicalCategory === "unknown"
        || intent === canonicalCategory;

      if (compatible) {
        kept.push(alias);
        continue;
      }

      const destination = chooseAliasDestination(paths, alias, source);
      const prepared = destination ? ensureAliasBindingsForTarget(alias, destination) : null;
      if (!destination || !prepared) {
        migrations.push({
          sig: alias.sig || null,
          fromFamilyId: pathFamilyId(source),
          toFamilyId: null,
          action: "deactivated-incompatible-alias",
          intent,
          canonicalCategory,
        });
        continue;
      }

      const destinationFamily = destination.family || (destination.family = {});
      const destinationAliases = Array.isArray(destinationFamily.aliases)
        ? destinationFamily.aliases
        : [];
      const canonicalSig = String(destination.sig || destination.signature || "");
      if (
        String(prepared.sig || "") !== canonicalSig
        && !destinationAliases.some((entry) => String(entry?.sig || "") === String(prepared.sig || ""))
      ) {
        destinationAliases.push({
          ...prepared,
          active: prepared.active !== false,
          source: "semantic-intent-migration-v1",
          migratedFromFamilyId: pathFamilyId(source),
          migratedAt: new Date().toISOString(),
        });
        destinationFamily.aliases = destinationAliases.slice(-250);
      }

      migrations.push({
        sig: prepared.sig || null,
        fromFamilyId: pathFamilyId(source),
        toFamilyId: pathFamilyId(destination),
        action: "moved-incompatible-alias",
        intent,
        canonicalCategory,
      });
    }

    family.aliases = kept;
  }

  // Final dedupe: one active signature may belong to only one semantic family.
  const canonicalSignatures = new Set(paths.map((path) => String(path.sig || path.signature || "")).filter(Boolean));
  const aliasOwner = new Map();
  for (const path of paths) {
    const family = path.family || (path.family = {});
    const aliases = Array.isArray(family.aliases) ? family.aliases : [];
    family.aliases = aliases.filter((alias) => {
      const sig = String(alias?.sig || "").trim();
      if (!sig || canonicalSignatures.has(sig)) return false;
      if (aliasOwner.has(sig) && aliasOwner.get(sig) !== pathFamilyId(path)) return false;
      aliasOwner.set(sig, pathFamilyId(path));
      return true;
    });
  }

  return { paths, migrations };
}

function register({ on, use }) {
  const {
    getDocClient,
    deps,
    getSub,                          // su/e lookup
    incrementCounterAndGetNewValue,  // << reuse your shared counter helper
  } = use();

  const TableName = "paths";
  const CounterTable = "pCounter";

  // ---------- helpers ----------
  const withEnv = () => {
    const { AWS: AWSFromUse, dynamodbLL: ddbLLFromUse } = deps || {};
    const AWS = AWSFromUse || require("aws-sdk");
    const doc = getDocClient();
    const ddbLL = ddbLLFromUse || new AWS.DynamoDB({ region: "us-east-1" });
    return { doc, ddbLL, AWS };
  };

  const wrap = (payload, meta, file = "") => {
    const cookie = meta?.cookie || {};
    const response = { ...(payload || {}), existing: cookie.existing, file };
    return { ok: true, response };
  };


  // ID minting now uses your shared { pk: <tableName>, x: <number> } pattern.
  async function nextPathId() {
    const x = await incrementCounterAndGetNewValue(CounterTable); // returns updated x
    return `${Number(x)}`; // e.g. "p36"
  }

  async function resolveE({ body, segs, meta }) {
    // 1) explicit body.e
    let e = String(body?.e || "").trim();
    if (e) return e;

    // 2) path[0] = primarySu → e
    const primarySu = String(segs?.[0] || "").trim();
    if (primarySu) {
      try {
        const sub = await getSub(primarySu, "su");
        e = String(sub?.Items?.[0]?.e || "");
        if (e) return e;
      } catch {}
    }

    // 3) fallback to cookie.e
    e = String(meta?.cookie?.e || "");
    return e;
  }

  async function loadPathsForEntity(doc, e) {
    const out = [];
    let ExclusiveStartKey;
    do {
      const res = await doc.query({
        TableName,
        IndexName: "eIndex",
        KeyConditionExpression: "#e = :e",
        ExpressionAttributeNames: { "#e": "e" },
        ExpressionAttributeValues: { ":e": e },
        ExclusiveStartKey,
        ScanIndexForward: false,
      }).promise();
      out.push(...(res.Items || []).map((it) => ({
        id: it.id,
        e: it.e,
        by: it.by,
        sig: it.sig,
        left: it.left ? JSON.parse(it.left) : null,
        right: it.right ? JSON.parse(it.right) : null,
        family: it.family ? JSON.parse(it.family) : null,
        repair: it.repair ? JSON.parse(it.repair) : null,
        tests: it.tests ? JSON.parse(it.tests) : null,
        quality: it.quality ? JSON.parse(it.quality) : null,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      })));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  async function repairAndPersistPathsForEntity(doc, e) {
    const rawPaths = await loadPathsForEntity(doc, e);
    const originalById = new Map(rawPaths.map((path) => [String(path.id), cloneJson(path)]));
    const repaired = migrateAliasesAcrossPaths(rawPaths);
    const now = new Date().toISOString();

    for (const path of repaired.paths) {
      const original = originalById.get(String(path.id));
      if (!original) continue;
      const rightChanged = JSON.stringify(original.right ?? null) !== JSON.stringify(path.right ?? null);
      const familyChanged = JSON.stringify(original.family ?? null) !== JSON.stringify(path.family ?? null);
      if (!rightChanged && !familyChanged) continue;

      await doc.update({
        TableName,
        Key: { id: path.id },
        UpdateExpression: "SET #right = :right, #family = :family, #updatedAt = :now",
        ExpressionAttributeNames: {
          "#right": "right",
          "#family": "family",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":right": JSON.stringify(path.right ?? null),
          ":family": JSON.stringify(path.family ?? null),
          ":now": now,
        },
      }).promise();
      path.updatedAt = now;
    }

    return repaired;
  }

  // ---------- bootstrap ----------
  on("createPaths", async (_ctx, meta) => {
    const { ddbLL } = withEnv();

    let info = {};
    try {
      // paths
      const ensureTable = async () => {
        let exists = false;
        try {
          await ddbLL.describeTable({ TableName }).promise();
          exists = true;
        } catch (err) {
          if (err.code !== "ResourceNotFoundException") throw err;
        }
        if (!exists) {
          await ddbLL
            .createTable({
              TableName,
              BillingMode: "PAY_PER_REQUEST",
              AttributeDefinitions: [
                { AttributeName: "id", AttributeType: "S" },
                { AttributeName: "e", AttributeType: "S" },
                { AttributeName: "sig", AttributeType: "S" },
                { AttributeName: "by", AttributeType: "S" },
                { AttributeName: "updatedAt", AttributeType: "S" },
              ],
              KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
              GlobalSecondaryIndexes: [
                {
                  IndexName: "eSigIndex",
                  KeySchema: [
                    { AttributeName: "e", KeyType: "HASH" },
                    { AttributeName: "sig", KeyType: "RANGE" },
                  ],
                  Projection: { ProjectionType: "ALL" },
                },
                {
                  IndexName: "eIndex",
                  KeySchema: [
                    { AttributeName: "e", KeyType: "HASH" },
                    { AttributeName: "updatedAt", KeyType: "RANGE" },
                  ],
                  Projection: { ProjectionType: "ALL" },
                },
                {
                  IndexName: "byIndex",
                  KeySchema: [
                    { AttributeName: "by", KeyType: "HASH" },
                    { AttributeName: "updatedAt", KeyType: "RANGE" },
                  ],
                  Projection: { ProjectionType: "ALL" },
                },
              ],
            })
            .promise();
          await ddbLL.waitFor("tableExists", { TableName }).promise();
        }
      };

      const ensureCounter = async () => {
        let exists = false;
        try {
          await ddbLL.describeTable({ TableName: CounterTable }).promise();
          exists = true;
        } catch (err) {
          if (err.code !== "ResourceNotFoundException") throw err;
        }
        if (!exists) {
          await ddbLL
            .createTable({
              TableName: CounterTable,
              BillingMode: "PAY_PER_REQUEST",
              // match aiCounter/eCounter shape: pk (S) is the HASH key
              AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
              KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
            })
            .promise();
          await ddbLL.waitFor("tableExists", { TableName: CounterTable }).promise();
          // (Optional) no need to seed; your shared increment will create the item on first ADD.
        }
      };

      await ensureTable();
      await ensureCounter();
      info = { alert: "ok", tables: [TableName, CounterTable] };
    } catch (e) {
      info = { alert: "failed", error: String(e?.message || e) };
    }
    return wrap(info, meta, "");
  });

  // ---------- list for an entity (by e or primarySu path seg) ----------
  // Path: /listPaths/:primarySu?   Body: { e?:string }
  on("listPaths", async (ctx, meta) => {
    const { doc } = withEnv();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const body = (ctx?.req?.body && ctx.req.body.body) || ctx?.req?.body || {};
    const e = await resolveE({ body, segs, meta });
    if (!e) return wrap({ paths: [], note: "no-e" }, meta, "");

    const repaired = await repairAndPersistPathsForEntity(doc, e);
    return wrap({
      paths: repaired.paths,
      semanticMigrations: repaired.migrations,
    }, meta, "");
  });

  // ---------- save (create or update by (e,sig)) ----------
  // Path: /savePath/:primarySu?   Body: { e?:string, sig, left, right }
  on("savePath", async (ctx, meta) => {
    const { doc } = withEnv();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const rb = (ctx?.req?.body && ctx.req.body.body) || ctx?.req?.body || {};
    const now = new Date().toISOString();
    const sig = String(rb.sig || "").trim();
    const e = await resolveE({ body: rb, segs, meta });
    if (!sig || !e) return wrap({ ok: false, error: "missing sig or e" }, meta, "");
    try {
      validatePathForPersistence({
        sig,
        left: rb.left,
        right: rb.right,
        family: rb.family,
        repair: rb.repair,
        tests: rb.tests,
        quality: rb.quality,
      });
    } catch (error) {
      return wrap({ ok: false, error: String(error?.message || error) }, meta, "");
    }

    // idempotent upsert by (e, sig)
    const found = await doc
      .query({
        TableName,
        IndexName: "eSigIndex",
        KeyConditionExpression: "#e = :e AND #sig = :sig",
        ExpressionAttributeNames: { "#e": "e", "#sig": "sig" },
        ExpressionAttributeValues: { ":e": e, ":sig": sig },
        Limit: 1,
      })
      .promise();

    const by = String(meta?.cookie?.e || "");
    const leftStr = JSON.stringify(rb.left ?? null);
    const rightStr = JSON.stringify(rb.right ?? null);
    const familyStr = JSON.stringify(rb.family ?? null);
    const repairStr = JSON.stringify(rb.repair ?? null);
    const testsStr = JSON.stringify(rb.tests ?? null);
    const qualityStr = JSON.stringify(rb.quality ?? null);

    if (found?.Items?.length) {
      const it = found.Items[0];
      const upd = await doc
        .update({
          TableName,
          Key: { id: it.id },
          UpdateExpression:
            "SET #left = :left, #right = :right, #family = :family, #repair = :repair, #tests = :tests, #quality = :quality, #updatedAt = :now, #by = if_not_exists(#by, :by)",
          ExpressionAttributeNames: {
            "#left": "left",
            "#right": "right",
            "#family": "family",
            "#repair": "repair",
            "#tests": "tests",
            "#quality": "quality",
            "#updatedAt": "updatedAt",
            "#by": "by",
          },
          ExpressionAttributeValues: {
            ":left": leftStr,
            ":right": rightStr,
            ":family": familyStr,
            ":repair": repairStr,
            ":tests": testsStr,
            ":quality": qualityStr,
            ":now": now,
            ":by": by,
          },
          ReturnValues: "ALL_NEW",
        })
        .promise();

      const repaired = await repairAndPersistPathsForEntity(doc, e);
      const finalPath = repaired.paths.find((path) => String(path.id) === String(upd.Attributes.id)) || {
        id: upd.Attributes.id,
        e: upd.Attributes.e,
        by: upd.Attributes.by,
        sig: upd.Attributes.sig,
        left: JSON.parse(upd.Attributes.left || "null"),
        right: JSON.parse(upd.Attributes.right || "null"),
        family: JSON.parse(upd.Attributes.family || "null"),
        repair: JSON.parse(upd.Attributes.repair || "null"),
        tests: JSON.parse(upd.Attributes.tests || "null"),
        quality: JSON.parse(upd.Attributes.quality || "null"),
        createdAt: upd.Attributes.createdAt,
        updatedAt: upd.Attributes.updatedAt,
      };
      return wrap(
        { path: finalPath, semanticMigrations: repaired.migrations },
        meta,
        upd.Attributes.id
      );
    }

    const id = await nextPathId();
    await doc
      .put({
        TableName,
        Item: {
          id,
          e,
          by,
          sig,
          left: leftStr,
          right: rightStr,
          family: familyStr,
          repair: repairStr,
          tests: testsStr,
          quality: qualityStr,
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression: "attribute_not_exists(#id)",
        ExpressionAttributeNames: { "#id": "id" },
      })
      .promise();

    const repaired = await repairAndPersistPathsForEntity(doc, e);
    const finalPath = repaired.paths.find((path) => String(path.id) === String(id)) || {
      id,
      e,
      by,
      sig,
      left: JSON.parse(leftStr),
      right: JSON.parse(rightStr),
      family: JSON.parse(familyStr),
      repair: JSON.parse(repairStr),
      tests: JSON.parse(testsStr),
      quality: JSON.parse(qualityStr),
      createdAt: now,
      updatedAt: now,
    };
    return wrap(
      { path: finalPath, semanticMigrations: repaired.migrations },
      meta,
      id
    );
  });

  // ---------- bulk save classifier/Path datasets ----------
  // Path: /bulkSavePaths/:primarySu? Body: { e?:string, paths:[{sig,left,right,family,repair}] }
  on("bulkSavePaths", async (ctx, meta) => {
    const { doc } = withEnv();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const rb = (ctx?.req?.body && ctx.req.body.body) || ctx?.req?.body || {};
    const e = await resolveE({ body: rb, segs, meta });
    if (!e) return wrap({ ok: false, error: "missing e" }, meta, "");

    const incoming = Array.isArray(rb.paths) ? rb.paths : [];
    if (!incoming.length) return wrap({ ok: false, error: "paths are required" }, meta, "");
    if (incoming.length > 500) return wrap({ ok: false, error: "bulk upload limit is 500 paths" }, meta, "");

    const unique = new Map();
    for (const path of incoming) {
      const sig = String(path?.sig || path?.signature || "").trim();
      if (!sig) continue;
      unique.set(sig, { ...path, sig });
    }

    const by = String(meta?.cookie?.e || "");
    const saved = [];
    const rejected = [];
    const queue = [...unique.values()];
    const concurrency = Math.min(8, queue.length);

    async function saveOne(path) {
      const now = new Date().toISOString();
      const sig = String(path.sig || "").trim();
      try {
        validatePathForPersistence(path);
        const found = await doc.query({
          TableName,
          IndexName: "eSigIndex",
          KeyConditionExpression: "#e = :e AND #sig = :sig",
          ExpressionAttributeNames: { "#e": "e", "#sig": "sig" },
          ExpressionAttributeValues: { ":e": e, ":sig": sig },
          Limit: 1,
        }).promise();

        const values = {
          left: JSON.stringify(path.left ?? null),
          right: JSON.stringify(path.right ?? null),
          family: JSON.stringify(path.family ?? null),
          repair: JSON.stringify(path.repair ?? null),
          tests: JSON.stringify(path.tests ?? null),
          quality: JSON.stringify(path.quality ?? null),
        };

        if (found?.Items?.length) {
          const existing = found.Items[0];
          await doc.update({
            TableName,
            Key: { id: existing.id },
            UpdateExpression:
              "SET #left = :left, #right = :right, #family = :family, #repair = :repair, #tests = :tests, #quality = :quality, #updatedAt = :now, #by = if_not_exists(#by, :by)",
            ExpressionAttributeNames: {
              "#left": "left",
              "#right": "right",
              "#family": "family",
              "#repair": "repair",
              "#tests": "tests",
              "#quality": "quality",
              "#updatedAt": "updatedAt",
              "#by": "by",
            },
            ExpressionAttributeValues: {
              ":left": values.left,
              ":right": values.right,
              ":family": values.family,
              ":repair": values.repair,
              ":tests": values.tests,
              ":quality": values.quality,
              ":now": now,
              ":by": by,
            },
          }).promise();
          saved.push({ id: existing.id, sig, updated: true });
          return;
        }

        const id = await nextPathId();
        await doc.put({
          TableName,
          Item: {
            id,
            e,
            by,
            sig,
            left: values.left,
            right: values.right,
            family: values.family,
            repair: values.repair,
            tests: values.tests,
            quality: values.quality,
            createdAt: now,
            updatedAt: now,
          },
          ConditionExpression: "attribute_not_exists(#id)",
          ExpressionAttributeNames: { "#id": "id" },
        }).promise();
        saved.push({ id, sig, updated: false });
      } catch (error) {
        rejected.push({ sig, error: String(error?.message || error) });
      }
    }

    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const index = cursor++;
        await saveOne(queue[index]);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    const repaired = await repairAndPersistPathsForEntity(doc, e);
    return wrap({
      ok: true,
      complete: rejected.length === 0,
      paths: repaired.paths,
      saved,
      rejected,
      counts: {
        requested: incoming.length,
        unique: queue.length,
        saved: saved.length,
        rejected: rejected.length,
      },
      semanticMigrations: repaired.migrations,
    }, meta, "");
  });

  // ---------- delete by id ----------
  // Path: /deletePath/:id
  on("deletePath", async (ctx, meta) => {
    const { doc } = withEnv();
    const segs = String(ctx.path || "").split("/").filter(Boolean);
    const id = String(segs?.[0] || "").trim();
    if (!id) return wrap({ ok: false, error: "missing id" }, meta, "");
    await doc.delete({ TableName, Key: { id } }).promise();
    return wrap({ ok: true, id }, meta, id);
  });

  return { name: "paths" };
}

module.exports = {
  register,
  __test: {
    migrateAliasesAcrossPaths,
    normalizeMeetingQuestionPath,
    aliasIntentCategory,
    pathAnswerCategory,
    validateStructuralPattern,
    validatePathForPersistence,
    validateQualityContract,
    structuralPatternSignature,
  },
};
