/**
 * Platform: Narrows large capability catalogs through authorized Position/Search candidates before model adjudication.
 * Technical: Queries the shared semantic index, reloads exact manifests, and retains a bounded scan only when indexed search is unavailable.
 */
"use strict";

function candidateQueryText(utterance, requirementSegments = []) {
  return [String(utterance || ""), ...(Array.isArray(requirementSegments) ? requirementSegments : [])]
    .map((value) => String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

async function loadCapabilityCandidates({
  searchEntities,
  registry,
  utterance,
  requirementSegments = [],
  ownerId,
  minimumImplementationPolicyVersion = 1,
  limit = 60,
  meta = {},
} = {}) {
  if (!registry) throw new TypeError("capability candidate loading requires a registry");
  if (typeof searchEntities === "function") {
    const rows = await searchEntities({
      text: candidateQueryText(utterance, requirementSegments),
      topK: Math.max(1, Math.min(100, Number(limit) || 60)),
    }, meta);
    const ids = (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.canUse === true)
      .map((row) => String(row.su || "").trim())
      .filter(Boolean);
    return registry.listAvailableByEntityIds(ids, {
      activeOnly: false,
      ownerId,
      minimumImplementationPolicyVersion,
      limit,
    });
  }
  // Compatibility for isolated tests and deployments predating the semantic
  // index. Once Search is registered, an empty result is authoritative and
  // never expands into a table scan.
  return registry.listAvailable({
    activeOnly: false,
    ownerId,
    minimumImplementationPolicyVersion,
    limit: Math.min(100, Math.max(1, Number(limit) || 60)),
  });
}

module.exports = { candidateQueryText, loadCapabilityCandidates };
