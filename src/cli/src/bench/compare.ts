/**
 * src/cli/src/bench/compare.ts
 *
 * Comparable-report validation for the Forgewright cheap-model uplift
 * evaluation harness.
 *
 * Two benchmark result files are only comparable when they were produced with
 * the same provider, model, task suite, attempt count, and verifier version.
 * Comparing a mock run to a live run is explicitly forbidden because the mock
 * always produces perfect scores that do not reflect real model capability.
 */

import { createHash } from "node:crypto";
import type { MeasurementRecord, PairedComparisonReceipt } from "./types.js";

export interface ComparableReport {
  /** "mock" | "live" — mock runs are never comparable to anything. */
  mode: string;
  /** Provider identifier (e.g. "agy", "gemini", "codex"). */
  provider: string;
  /** Model identifier string as passed to the adapter. */
  model: string;
  /** Suite JSON version field. */
  suiteVersion: string;
  /** Suite name — must match exactly so apples-to-apples is guaranteed. */
  suiteName: string;
  /** Number of attempts per task (k). Must be ≥ 3 for statistical validity. */
  defaultAttempts: number;
  /** Total number of tasks evaluated. */
  totalTasks: number;
  /**
   * Verifier version token. Bump this whenever verifier commands change so
   * stale comparisons are automatically rejected.
   */
  verifierVersion: string;
  /** ISO-8601 timestamp of when the report was produced. */
  timestamp: string;
  /** Optional to preserve comparison support for legacy reports. */
  measurementRecord?: MeasurementRecord;
  suiteFingerprint?: string;
  verifierFingerprint?: string;
  summary?: { passAt1Rate: number; passAtKRate: number };
}

function roundedDelta(candidate: number, baseline: number): number {
  return Number((candidate - baseline).toFixed(12));
}

function requireMeasurement(
  report: ComparableReport,
  label: string,
): MeasurementRecord {
  const measurement = report.measurementRecord;
  if (!measurement) throw new Error(`${label} measurement receipt is missing`);
  if (
    measurement.provider !== report.provider ||
    measurement.model !== report.model
  ) {
    throw new Error(`${label} provider/model receipt mismatch`);
  }
  if (
    report.suiteFingerprint !== undefined &&
    measurement.suite_sha256 !== report.suiteFingerprint
  ) {
    throw new Error(`${label} suite fingerprint receipt mismatch`);
  }
  if (
    report.verifierFingerprint !== undefined &&
    measurement.verifier_sha256 !== report.verifierFingerprint
  ) {
    throw new Error(`${label} verifier fingerprint receipt mismatch`);
  }
  if (!/^[0-9a-f]{64}$/.test(measurement.resolved_snapshot_sha256)) {
    throw new Error(`${label} resolved snapshot receipt is invalid`);
  }
  if (!/^[0-9a-f]{64}$/.test(measurement.provider_topology_sha256)) {
    throw new Error(`${label} provider topology receipt is invalid`);
  }
  return measurement;
}

export function createPairedComparison(
  baseline: ComparableReport,
  candidate: ComparableReport,
): PairedComparisonReceipt {
  if (baseline.mode !== "live" || candidate.mode !== "live") {
    throw new Error("Paired comparison requires two live local reports");
  }
  const baselineMeasurement = requireMeasurement(baseline, "Baseline");
  const candidateMeasurement = requireMeasurement(candidate, "Candidate");
  if (baselineMeasurement.run_id === candidateMeasurement.run_id) {
    throw new Error("Paired comparison rejects a self-pair receipt");
  }
  if (
    baseline.provider === "mixed" ||
    candidate.provider === "mixed" ||
    baseline.model === "mixed" ||
    candidate.model === "mixed"
  ) {
    throw new Error(
      "Paired comparison requires one resolved provider and model per run",
    );
  }
  if (baseline.provider !== candidate.provider) {
    throw new Error("Paired comparison requires one provider ecosystem");
  }
  if (
    baseline.suiteName !== candidate.suiteName ||
    baseline.suiteVersion !== candidate.suiteVersion ||
    baseline.totalTasks !== candidate.totalTasks ||
    baseline.defaultAttempts !== candidate.defaultAttempts
  ) {
    throw new Error("Paired reports describe different benchmark suites");
  }
  if (baseline.defaultAttempts < 3) {
    throw new Error("Paired reports require at least three attempts per task");
  }
  if (baseline.verifierVersion !== candidate.verifierVersion) {
    throw new Error("Paired reports use different verifier versions");
  }
  if (baselineMeasurement.suite_sha256 !== candidateMeasurement.suite_sha256) {
    throw new Error("Paired suite fingerprint mismatch");
  }
  if (
    baselineMeasurement.verifier_sha256 !== candidateMeasurement.verifier_sha256
  ) {
    throw new Error("Paired verifier fingerprint mismatch");
  }
  if (
    baselineMeasurement.provider_topology_sha256 !==
    candidateMeasurement.provider_topology_sha256
  ) {
    throw new Error("Paired provider topology mismatch");
  }
  if (!baseline.summary || !candidate.summary) {
    throw new Error("Paired reports require quality summaries");
  }
  const usageComparable =
    baselineMeasurement.usage_source === "reported" &&
    candidateMeasurement.usage_source === "reported" &&
    baselineMeasurement.cost_usd !== null &&
    candidateMeasurement.cost_usd !== null &&
    baselineMeasurement.provider_latency_ms !== null &&
    candidateMeasurement.provider_latency_ms !== null;
  const pairMaterial = JSON.stringify({
    baseline_run_id: baselineMeasurement.run_id,
    candidate_run_id: candidateMeasurement.run_id,
    suite_sha256: baselineMeasurement.suite_sha256,
    verifier_sha256: baselineMeasurement.verifier_sha256,
    provider_topology_sha256: baselineMeasurement.provider_topology_sha256,
  });
  return {
    version: "1",
    pair_id: createHash("sha256").update(pairMaterial).digest("hex"),
    baseline: {
      run_id: baselineMeasurement.run_id,
      provider: baseline.provider,
      model: baseline.model,
      resolved_snapshot_sha256: baselineMeasurement.resolved_snapshot_sha256,
    },
    candidate: {
      run_id: candidateMeasurement.run_id,
      provider: candidate.provider,
      model: candidate.model,
      resolved_snapshot_sha256: candidateMeasurement.resolved_snapshot_sha256,
    },
    suite_sha256: baselineMeasurement.suite_sha256,
    verifier_sha256: baselineMeasurement.verifier_sha256,
    provider_topology_sha256: baselineMeasurement.provider_topology_sha256,
    deltas: {
      pass_at_1: roundedDelta(
        candidate.summary.passAt1Rate,
        baseline.summary.passAt1Rate,
      ),
      pass_at_k: roundedDelta(
        candidate.summary.passAtKRate,
        baseline.summary.passAtKRate,
      ),
      cost_usd: usageComparable
        ? roundedDelta(
            candidateMeasurement.cost_usd!,
            baselineMeasurement.cost_usd!,
          )
        : null,
      provider_latency_ms: usageComparable
        ? roundedDelta(
            candidateMeasurement.provider_latency_ms!,
            baselineMeasurement.provider_latency_ms!,
          )
        : null,
      e2e_wall_ms: roundedDelta(
        candidateMeasurement.e2e_wall_ms,
        baselineMeasurement.e2e_wall_ms,
      ),
    },
    usage_comparable: usageComparable,
    production_evidence: "missing",
  };
}

export interface ComparisonValidationResult {
  comparable: boolean;
  reason?: string;
}

/**
 * Validate legacy metadata comparability only.
 *
 * This compatibility API never creates or authorizes a paired A/B receipt;
 * `createPairedComparison` is the strict receipt-bound path. Returns
 * `{ comparable: true }` when the legacy metadata is comparable, or
 * `{ comparable: false, reason: "<human-readable explanation>" }` when they
 * are not.
 *
 * Rules (all must pass):
 *  1. Neither report may be in mock mode.
 *  2. provider must match.
 *  3. model must match.
 *  4. suiteName must match.
 *  5. totalTasks must match.
 *  6. defaultAttempts must match and be ≥ 3.
 *  7. verifierVersion must match (prevents stale-verifier comparisons).
 *  8. suiteVersion must match.
 *  9. When both reports include a measurement record, its suite and verifier
 *     fingerprints must match.
 */
export function validateComparableReports(
  a: ComparableReport,
  b: ComparableReport,
): ComparisonValidationResult {
  if (a.mode === "mock" || b.mode === "mock") {
    return {
      comparable: false,
      reason:
        "Mock runs are not comparable to anything — mock always scores 100% regardless of real model capability.",
    };
  }

  if (a.provider !== b.provider) {
    return {
      comparable: false,
      reason: `Provider mismatch: '${a.provider}' vs '${b.provider}'. Both runs must use the same provider.`,
    };
  }

  if (a.model !== b.model) {
    return {
      comparable: false,
      reason: `Model mismatch: '${a.model}' vs '${b.model}'. Both runs must use the same model so only the kernel/prompt changes.`,
    };
  }

  if (a.suiteName !== b.suiteName) {
    return {
      comparable: false,
      reason: `Suite name mismatch: '${a.suiteName}' vs '${b.suiteName}'. Runs must evaluate the same task suite.`,
    };
  }

  if (a.suiteVersion !== b.suiteVersion) {
    return {
      comparable: false,
      reason: `Suite version mismatch: '${a.suiteVersion}' vs '${b.suiteVersion}'. Runs must evaluate the same suite revision.`,
    };
  }

  if (a.totalTasks !== b.totalTasks) {
    return {
      comparable: false,
      reason: `Task count mismatch: ${a.totalTasks} vs ${b.totalTasks}. Both runs must evaluate the same number of tasks.`,
    };
  }

  if (a.defaultAttempts !== b.defaultAttempts) {
    return {
      comparable: false,
      reason: `Attempt count mismatch: k=${a.defaultAttempts} vs k=${b.defaultAttempts}. Both runs must use the same k for pass@k to be meaningful.`,
    };
  }

  if (a.defaultAttempts < 3) {
    return {
      comparable: false,
      reason: `Attempt count too low: k=${a.defaultAttempts}. A minimum of k=3 is required for statistically valid pass@k aggregation.`,
    };
  }

  if (a.verifierVersion !== b.verifierVersion) {
    return {
      comparable: false,
      reason: `Verifier version mismatch: '${a.verifierVersion}' vs '${b.verifierVersion}'. One run used stale verifiers — re-run both with the same verifier suite.`,
    };
  }

  if (a.measurementRecord && b.measurementRecord) {
    if (a.measurementRecord.suite_sha256 !== b.measurementRecord.suite_sha256) {
      return {
        comparable: false,
        reason:
          "Suite fingerprint mismatch: measurement records describe different canonical suite inputs.",
      };
    }

    if (
      a.measurementRecord.verifier_sha256 !==
      b.measurementRecord.verifier_sha256
    ) {
      return {
        comparable: false,
        reason:
          "Verifier fingerprint mismatch: measurement records describe different verifier commands.",
      };
    }

    if (
      a.measurementRecord.provider_topology_sha256 !==
      b.measurementRecord.provider_topology_sha256
    ) {
      return {
        comparable: false,
        reason:
          "Provider topology mismatch: measurement records describe different task-level providers.",
      };
    }

    if (
      a.measurementRecord.resolved_snapshot_sha256 !==
      b.measurementRecord.resolved_snapshot_sha256
    ) {
      return {
        comparable: false,
        reason:
          "Resolved snapshot mismatch: legacy comparison requires identical task-level provider/model settings.",
      };
    }
  }

  return { comparable: true };
}
