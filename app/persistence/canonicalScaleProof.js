/**
 * Platform: Turns scale and compatibility claims into repeatable evidence before canonical cutover.
 * Technical: Measures partition distribution and enforces bounded latency, fan-out, security, and failure-regression gates.
 */
"use strict";

function percentile(values, fraction) {
  const sorted = [...values].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function partitionDistribution(partitionKeys = []) {
  const counts = new Map();
  for (const key of partitionKeys) counts.set(String(key), (counts.get(String(key)) || 0) + 1);
  const values = [...counts.values()];
  const mean = values.length ? partitionKeys.length / values.length : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  return {
    partitions: values.length,
    records: partitionKeys.length,
    mean,
    maximum,
    maxToMean: mean ? maximum / mean : 0,
  };
}

function evaluateScaleProof(input = {}) {
  const latency = Array.isArray(input.latencyMs) ? input.latencyMs : [];
  const distribution = partitionDistribution(input.partitionKeys || []);
  const gates = {
    sampleSize: latency.length >= Number(input.minimumSamples || 1000),
    p95Latency: (percentile(latency, 0.95) ?? Infinity) <= Number(input.maximumP95Ms || 500),
    boundedFanout: Number(input.maximumObservedFanout) <= Number(input.maximumAllowedFanout || 64),
    partitionSkew: distribution.partitions > 1
      && distribution.maxToMean <= Number(input.maximumMaxToMean || 2.5),
    security: input.crossPrincipalLeakCount === 0 && input.protectedPlaintextLeakCount === 0,
    compatibility: Number(input.regressionCount) === 0,
    failurePipeline: Number(input.unclassifiedFailureCount) === 0,
  };
  return {
    schemaVersion: 1,
    passed: Object.values(gates).every(Boolean),
    gates,
    evidence: { distribution, p50LatencyMs: percentile(latency, 0.5), p95LatencyMs: percentile(latency, 0.95) },
  };
}

module.exports = { evaluateScaleProof, partitionDistribution, percentile };
