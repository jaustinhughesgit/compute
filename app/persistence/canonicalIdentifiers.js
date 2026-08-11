/**
 * Platform: Allocates collision-resistant canonical IDs without shared counters and deterministically shards high-cardinality indexes.
 * Technical: Uses SHA-256 for replay-stable IDs and time/random entropy for unrelated new records; no allocation write is required.
 */
"use strict";

const crypto = require("node:crypto");

function normalizedPart(value) {
  return String(value == null ? "" : value).normalize("NFKC").trim();
}

function digest(...parts) {
  return crypto.createHash("sha256")
    .update(parts.map(normalizedPart).join("\u001f"))
    .digest();
}

function stableIdentifier(prefix, ...parts) {
  const safePrefix = normalizedPart(prefix).replace(/[^a-z0-9_-]/gi, "_") || "id";
  return `${safePrefix}_${digest(...parts).toString("base64url").slice(0, 32)}`;
}

function distributedIdentifier(prefix, options = {}) {
  const safePrefix = normalizedPart(prefix).replace(/[^a-z0-9_-]/gi, "_") || "id";
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const entropy = typeof options.entropy === "string"
    ? options.entropy
    : crypto.randomBytes(16).toString("base64url");
  return `${safePrefix}_${Math.max(0, now).toString(36).padStart(10, "0")}_${entropy}`;
}

function shardFor(value, shardCount) {
  const count = Math.max(1, Math.floor(Number(shardCount) || 1));
  return digest(value).readUInt32BE(0) % count;
}

function stableNumericKey(...parts) {
  return digest(...parts).readUIntBE(0, 6);
}

function normalizeLexeme(value) {
  return normalizedPart(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}@._' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordIdentifier(value, options = {}) {
  const normalized = normalizeLexeme(value);
  if (!normalized) return null;
  return stableIdentifier("w", options.language || "und", options.senseKey || "", normalized);
}

module.exports = {
  digest,
  distributedIdentifier,
  normalizeLexeme,
  shardFor,
  stableIdentifier,
  stableNumericKey,
  wordIdentifier,
};
