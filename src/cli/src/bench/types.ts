import { z } from "zod";

export const ProviderModelSettingsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  options: z.record(z.unknown()).optional(),
});

export const BenchmarkTaskSchema = z.object({
  id: z.string(),
  category: z.string(),
  prompt: z.string(),
  providerSettings: ProviderModelSettingsSchema.optional(),
  attempts: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  workspace: z.string().optional(),
  verifierCommands: z.array(z.string().min(1)).min(1),
});

export const BenchmarkSuiteSchema = z
  .object({
    version: z.string(),
    name: z.string(),
    description: z.string().optional(),
    defaultProviderSettings: ProviderModelSettingsSchema,
    defaultAttempts: z.number().int().positive().default(1),
    defaultTimeoutMs: z.number().int().positive().default(60000),
    tasks: z
      .array(BenchmarkTaskSchema)
      .min(1, "Benchmark suite must include at least one task"),
  })
  .refine(
    (data) => {
      const ids = data.tasks.map((t) => t.id);
      const uniqueIds = new Set(ids);
      return uniqueIds.size === ids.length;
    },
    {
      message: "Task IDs must be unique within the benchmark suite",
      path: ["tasks"],
    },
  );

export type ProviderModelSettings = z.infer<typeof ProviderModelSettingsSchema>;
export type BenchmarkTask = z.infer<typeof BenchmarkTaskSchema>;
export type BenchmarkSuite = z.infer<typeof BenchmarkSuiteSchema>;

export interface VerifierResult {
  command: string;
  exitCode: number | null;
  stdoutSha256: string;
  stdoutBytes: number;
  stderrSha256: string;
  stderrBytes: number;
  passed: boolean;
}

export interface AttemptResult {
  attemptIndex: number;
  durationMs: number;
  exitStatus: number | null;
  verifierResults: VerifierResult[];
  passed: boolean;
  provider: string;
  model: string;
  taskId: string;
  stdoutSha256: string;
  stdoutBytes: number;
  stderrSha256: string;
  stderrBytes: number;
  usageReceipt?: ProviderUsageReceipt;
}

export interface TaskResult {
  taskId: string;
  category: string;
  attempts: AttemptResult[];
  passed: boolean;
  passedAt1: boolean;
}

export interface CategoryMetric {
  category: string;
  totalTasks: number;
  passAt1Count: number;
  passAtKCount: number;
  passAt1Rate: number;
  passAtKRate: number;
}

export interface SuiteResultSummary {
  totalTasks: number;
  passAt1Count: number;
  passAtKCount: number;
  passAt1Rate: number;
  passAtKRate: number;
  categories: Record<string, CategoryMetric>;
}

/** Versioned provenance and measurement data for a completed live benchmark. */
export interface MeasurementRecord {
  version: "1";
  run_id: string;
  started_at: string;
  ended_at: string;
  e2e_wall_ms: number;
  provider: string;
  model: string;
  suite_sha256: string;
  verifier_sha256: string;
  resolved_snapshot_sha256: string;
  provider_topology_sha256: string;
  usage_source: "unavailable" | "reported";
  usage_receipt_count: number;
  usage_reported_count: number;
  usage_unavailable_count: number;
  input_uncached_tokens: number | null;
  input_cached_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  provider_latency_ms: number | null;
  critical_path_ms: number | null;
  critical_path_unverified: boolean;
  /** Fixture/local measurement only; never upgrades production evidence. */
  production_evidence: "missing";
}

export type ProviderUsage =
  | {
      status: "unavailable";
      reason: string;
    }
  | {
      status: "reported";
      input_uncached_tokens: number;
      input_cached_tokens: number;
      output_tokens: number;
      cost_usd: number;
      latency_ms: number;
    };

export interface ProviderUsageObservation {
  version: "1";
  provider: string;
  model: string;
  resolved_snapshot_sha256: string;
  usage: ProviderUsage;
}

export interface ProviderUsageReceipt extends ProviderUsageObservation {
  task_id: string;
  attempt_index: number;
  suite_sha256: string;
  verifier_sha256: string;
  provider_topology_sha256: string;
}

export interface ProviderUsageAdapterInput {
  provider: string;
  model: string;
  resolved_snapshot_sha256: string;
  suite_sha256: string;
  verifier_sha256: string;
  provider_topology_sha256: string;
  task_id: string;
  attempt_index: number;
  adapter_duration_ms: number;
  verifier_passed: boolean;
}

export type ProviderUsageAdapter = (
  input: ProviderUsageAdapterInput,
) => Promise<ProviderUsageObservation> | ProviderUsageObservation;

export interface BenchmarkReport {
  /** Live runner reports are safe to pass directly to the comparator. */
  mode: "live";
  suiteName: string;
  suiteVersion: string;
  timestamp: string;
  provider: string;
  model: string;
  /** Configured k value used for every task without an explicit override. */
  defaultAttempts: number;
  totalTasks: number;
  /** Bump when the benchmark verifier contract changes. */
  verifierVersion: string;
  /** Canonical SHA-256 fingerprints retained for lightweight consumers. */
  suiteFingerprint: string;
  verifierFingerprint: string;
  measurementRecord: MeasurementRecord;
  totalAttemptsRun: number;
  summary: SuiteResultSummary;
  tasks: TaskResult[];
}

export interface PairedRunBinding {
  run_id: string;
  provider: string;
  model: string;
  resolved_snapshot_sha256: string;
}

export interface PairedComparisonReceipt {
  version: "1";
  pair_id: string;
  baseline: PairedRunBinding;
  candidate: PairedRunBinding;
  suite_sha256: string;
  verifier_sha256: string;
  provider_topology_sha256: string;
  deltas: {
    pass_at_1: number;
    pass_at_k: number;
    cost_usd: number | null;
    provider_latency_ms: number | null;
    e2e_wall_ms: number;
  };
  usage_comparable: boolean;
  production_evidence: "missing";
}
