import { createHash } from "node:crypto";
import { z } from "zod";

export const PRODUCT_FACTORY_BENCHMARK_TASK_SCHEMA_VERSION =
  "product-factory-benchmark-task/v1" as const;
export const PRODUCT_FACTORY_BENCHMARK_SUITE_SCHEMA_VERSION =
  "product-factory-benchmark-suite/v1" as const;
export const PRODUCT_FACTORY_LANE_RECEIPT_SCHEMA_VERSION =
  "product-factory-lane-receipt/v1" as const;
export const PRODUCT_FACTORY_BENCHMARK_REPORT_SCHEMA_VERSION =
  "product-factory-benchmark-report/v1" as const;
export const PRODUCT_FACTORY_FROZEN_THRESHOLDS_SCHEMA_VERSION =
  "product-factory-frozen-thresholds/v1" as const;
export const PRODUCT_FACTORY_PAIRED_COMPARISON_SCHEMA_VERSION =
  "product-factory-paired-comparison/v1" as const;
export const PRODUCT_FACTORY_BENCHMARK_MAX_BYTES = 512 * 1024;

export const PRODUCT_FACTORY_BENCHMARK_LANES = [
  "intent",
  "web",
  "android",
  "game",
] as const;
export type ProductFactoryBenchmarkLane =
  (typeof PRODUCT_FACTORY_BENCHMARK_LANES)[number];

export const PRODUCT_FACTORY_BENCHMARK_METRICS = [
  "product-outcome-success",
  "false-success",
  "user-intervention",
  "clarification",
  "retries",
  "wall-time",
  "tokens",
  "cost",
] as const;

const MAX_ITEMS = 256;
const MAX_JSON_DEPTH = 16;
const MAX_COUNT = 1_000_000_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SENSITIVE_TEXT =
  /(?:bearer(?:-|\s)|private[-_ ]key|api[-_ ]key|access[-_ ]key|secret[-_ ]key|password|credential|authorization|payment|cardholder|-----begin|\bsk-[a-z0-9]{16})/i;
const AWS_KEY = /\bAKIA[A-Z0-9]{16}\b/;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const HIGH_ENTROPY = /[A-Za-z0-9+/_=]{48,}/;
const RAW_FIELD =
  /^(?:prompt|raw(?:input|output|prompt|response|content|text)?|output|response|message|content|api[-_]?key|password|secret|authorization|cookie|credential)$/i;

export type ProductFactoryBenchmarkErrorCode =
  | "BENCHMARK_SIZE_LIMIT"
  | "BENCHMARK_MALFORMED"
  | "BENCHMARK_DIGEST_INVALID"
  | "BENCHMARK_BINDING_INVALID"
  | "BENCHMARK_INCOMPLETE"
  | "BENCHMARK_PRIVACY_INVALID"
  | "BENCHMARK_SELF_PAIR";

export class ProductFactoryBenchmarkValidationError extends Error {
  constructor(readonly code: ProductFactoryBenchmarkErrorCode) {
    super(code);
    this.name = "ProductFactoryBenchmarkValidationError";
  }
}

function fail(code: ProductFactoryBenchmarkErrorCode): never {
  throw new ProductFactoryBenchmarkValidationError(code);
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertPrivacySafe(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  fieldName: string | null = null,
): void {
  if (depth > MAX_JSON_DEPTH) fail("BENCHMARK_SIZE_LIMIT");
  if (typeof value === "string") {
    const hashPosition =
      fieldName === null ||
      fieldName === "pairId" ||
      /(?:sha256|fingerprint|digest)s?$/i.test(fieldName);
    if (
      SENSITIVE_TEXT.test(value) ||
      AWS_KEY.test(value) ||
      JWT.test(value) ||
      (HIGH_ENTROPY.test(value) &&
        !(hashPosition && SHA256_PATTERN.test(value)))
    ) {
      fail("BENCHMARK_PRIVACY_INVALID");
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("BENCHMARK_MALFORMED");
    return;
  }
  if (typeof value !== "object" || seen.has(value)) {
    fail("BENCHMARK_MALFORMED");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ITEMS) fail("BENCHMARK_SIZE_LIMIT");
      for (const item of value) {
        assertPrivacySafe(item, depth + 1, seen, fieldName);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("BENCHMARK_MALFORMED");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > MAX_ITEMS) fail("BENCHMARK_SIZE_LIMIT");
    for (const key of keys) {
      if (
        key.length === 0 ||
        key.length > 256 ||
        ["__proto__", "prototype", "constructor"].includes(key) ||
        RAW_FIELD.test(key)
      ) {
        fail("BENCHMARK_PRIVACY_INVALID");
      }
      assertPrivacySafe(record[key], depth + 1, seen, key);
    }
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail("BENCHMARK_MALFORMED");
  return serialized;
}

function assertBounded(value: unknown): void {
  assertPrivacySafe(value);
  if (
    Buffer.byteLength(canonicalJson(value), "utf8") >
    PRODUCT_FACTORY_BENCHMARK_MAX_BYTES
  ) {
    fail("BENCHMARK_SIZE_LIMIT");
  }
}

export function hashProductFactoryBenchmarkPayload(value: unknown): string {
  assertBounded(value);
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function parseWith<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  assertBounded(input);
  const result = schema.safeParse(input);
  if (!result.success || result.data === undefined) fail("BENCHMARK_MALFORMED");
  return result.data as z.output<TSchema>;
}

function without(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  );
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  if (new Set(values).size !== values.length) fail("BENCHMARK_BINDING_INVALID");
  return [...values].sort(compareCodeUnits);
}

function sortedSet<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

const SafeIdSchema = z.string().min(1).max(96).regex(SAFE_ID_PATTERN);
const VersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i);
const HashSchema = z.string().regex(SHA256_PATTERN);
const TimestampSchema = z.string().datetime({ offset: true });
const CountSchema = z.number().int().min(0).max(MAX_COUNT);
const PositiveCountSchema = z.number().int().min(1).max(MAX_ITEMS);
const RateSchema = z.number().finite().min(0).max(1);
const LaneSchema = z.enum(PRODUCT_FACTORY_BENCHMARK_LANES);
const EvidenceAuthoritySchema = z.enum(["production", "test-only"]);
const OutcomeStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "UNVERIFIED",
  "REQUIRES_HUMAN_REVIEW",
]);
const EnvironmentStatusSchema = z.enum(["PASS", "FAIL", "UNVERIFIED"]);
const EnvironmentKindSchema = z.enum(["none", "web", "android", "unity"]);
const StableCodeSchema = z.string().min(1).max(96).regex(SAFE_ID_PATTERN);
const TestReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9][a-z0-9._/-]*\.[a-z0-9]{1,16}(?:::[a-z0-9_.-]+)?$/i)
  .refine((value) => !value.includes("..") && !value.startsWith("/"));

const HashedBindingSchema = z
  .object({ id: SafeIdSchema, sha256: HashSchema })
  .strict();

const TaskInputSchema = z
  .object({
    taskId: SafeIdSchema,
    lane: LaneSchema,
    attemptCount: PositiveCountSchema,
    hiddenRequirementSha256s: z.array(HashSchema).min(1).max(MAX_ITEMS),
    hiddenPreferenceSha256s: z.array(HashSchema).min(1).max(MAX_ITEMS),
    intent: HashedBindingSchema,
    outcomes: z.array(HashedBindingSchema).min(1).max(MAX_ITEMS),
    scenarios: z.array(HashedBindingSchema).min(1).max(MAX_ITEMS),
    expectedEnvironmentKind: EnvironmentKindSchema,
    verifierRefs: z.array(TestReferenceSchema).min(1).max(MAX_ITEMS),
    evidenceAuthority: EvidenceAuthoritySchema,
  })
  .strict();

export const ProductFactoryBenchmarkTaskSchema = TaskInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_FACTORY_BENCHMARK_TASK_SCHEMA_VERSION),
  verifierFingerprint: HashSchema,
  taskSha256: HashSchema,
}).strict();
export type ProductFactoryBenchmarkTaskInput = z.input<typeof TaskInputSchema>;
export type ProductFactoryBenchmarkTask = z.infer<
  typeof ProductFactoryBenchmarkTaskSchema
>;

const EXPECTED_ENVIRONMENT_BY_LANE: Readonly<
  Record<
    ProductFactoryBenchmarkLane,
    ProductFactoryBenchmarkTask["expectedEnvironmentKind"]
  >
> = {
  intent: "none",
  web: "web",
  android: "android",
  game: "unity",
};

function canonicalizeBindings<T extends { id: string }>(
  values: readonly T[],
): T[] {
  if (new Set(values.map(({ id }) => id)).size !== values.length) {
    fail("BENCHMARK_BINDING_INVALID");
  }
  return [...values].sort((left, right) => compareCodeUnits(left.id, right.id));
}

function canonicalizeTask<T extends ProductFactoryBenchmarkTaskInput>(
  value: T,
): T {
  return {
    ...value,
    hiddenRequirementSha256s: sortedUnique(value.hiddenRequirementSha256s),
    hiddenPreferenceSha256s: sortedUnique(value.hiddenPreferenceSha256s),
    outcomes: canonicalizeBindings(value.outcomes),
    scenarios: canonicalizeBindings(value.scenarios),
    verifierRefs: sortedUnique(value.verifierRefs),
  };
}

export function fingerprintProductFactoryVerifierRefs(
  refs: readonly string[],
): string {
  return hashProductFactoryBenchmarkPayload({
    schemaVersion: "product-factory-verifier-refs/v1",
    refs: sortedUnique(refs),
  });
}

function assertTask(value: ProductFactoryBenchmarkTaskInput): void {
  if (
    EXPECTED_ENVIRONMENT_BY_LANE[value.lane] !== value.expectedEnvironmentKind
  ) {
    fail("BENCHMARK_BINDING_INVALID");
  }
}

export function createProductFactoryBenchmarkTask(
  input: ProductFactoryBenchmarkTaskInput,
): ProductFactoryBenchmarkTask {
  const value = canonicalizeTask(parseWith(TaskInputSchema, input));
  assertTask(value);
  const hashable = {
    schemaVersion: PRODUCT_FACTORY_BENCHMARK_TASK_SCHEMA_VERSION,
    ...value,
    verifierFingerprint: fingerprintProductFactoryVerifierRefs(
      value.verifierRefs,
    ),
  };
  return parseProductFactoryBenchmarkTask({
    ...hashable,
    taskSha256: hashProductFactoryBenchmarkPayload(hashable),
  });
}

export function parseProductFactoryBenchmarkTask(
  input: unknown,
): ProductFactoryBenchmarkTask {
  const value = parseWith(ProductFactoryBenchmarkTaskSchema, input);
  assertTask(value);
  const canonical = canonicalizeTask(value);
  if (!exact(value, { ...value, ...canonical }))
    fail("BENCHMARK_BINDING_INVALID");
  if (
    value.verifierFingerprint !==
      fingerprintProductFactoryVerifierRefs(value.verifierRefs) ||
    value.taskSha256 !==
      hashProductFactoryBenchmarkPayload(without(value, "taskSha256"))
  ) {
    fail("BENCHMARK_DIGEST_INVALID");
  }
  return value;
}

const SuiteInputSchema = z
  .object({
    suiteId: SafeIdSchema,
    suiteVersion: VersionSchema,
    thresholdsStatus: z.literal("unfrozen"),
    tasks: z.array(ProductFactoryBenchmarkTaskSchema).min(4).max(MAX_ITEMS),
  })
  .strict();
export const ProductFactoryBenchmarkSuiteSchema = SuiteInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_FACTORY_BENCHMARK_SUITE_SCHEMA_VERSION),
  suiteSha256: HashSchema,
}).strict();
export type ProductFactoryBenchmarkSuiteInput = z.input<
  typeof SuiteInputSchema
>;
export type ProductFactoryBenchmarkSuite = z.infer<
  typeof ProductFactoryBenchmarkSuiteSchema
>;

function canonicalizeSuite<T extends ProductFactoryBenchmarkSuiteInput>(
  value: T,
): T {
  const tasks = value.tasks
    .map(parseProductFactoryBenchmarkTask)
    .sort((left, right) => compareCodeUnits(left.taskId, right.taskId));
  if (new Set(tasks.map(({ taskId }) => taskId)).size !== tasks.length) {
    fail("BENCHMARK_BINDING_INVALID");
  }
  for (const lane of PRODUCT_FACTORY_BENCHMARK_LANES) {
    if (!tasks.some((task) => task.lane === lane)) fail("BENCHMARK_INCOMPLETE");
  }
  if (
    new Set(tasks.map(({ evidenceAuthority }) => evidenceAuthority)).size !==
      1 ||
    tasks.reduce((sum, task) => sum + task.attemptCount, 0) > MAX_ITEMS
  ) {
    fail("BENCHMARK_BINDING_INVALID");
  }
  return { ...value, tasks };
}

export function createProductFactoryBenchmarkSuite(
  input: ProductFactoryBenchmarkSuiteInput,
): ProductFactoryBenchmarkSuite {
  const value = canonicalizeSuite(parseWith(SuiteInputSchema, input));
  const hashable = {
    schemaVersion: PRODUCT_FACTORY_BENCHMARK_SUITE_SCHEMA_VERSION,
    ...value,
  };
  return parseProductFactoryBenchmarkSuite({
    ...hashable,
    suiteSha256: hashProductFactoryBenchmarkPayload(hashable),
  });
}

export function parseProductFactoryBenchmarkSuite(
  input: unknown,
): ProductFactoryBenchmarkSuite {
  const value = parseWith(ProductFactoryBenchmarkSuiteSchema, input);
  const canonical = canonicalizeSuite(value);
  if (!exact(value, { ...value, ...canonical }))
    fail("BENCHMARK_BINDING_INVALID");
  if (
    value.suiteSha256 !==
    hashProductFactoryBenchmarkPayload(without(value, "suiteSha256"))
  ) {
    fail("BENCHMARK_DIGEST_INVALID");
  }
  return value;
}

const UsageReceiptSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("reported"),
      inputUncachedTokens: CountSchema,
      inputCachedTokens: CountSchema,
      outputTokens: CountSchema,
      costUsd: z.number().finite().min(0),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reasonCode: z.enum([
        "provider-usage-unavailable",
        "provider-usage-redacted",
        "provider-usage-unsupported",
      ]),
    })
    .strict(),
]);
const ProductOutcomeBindingSchema = z
  .object({
    resultSha256: HashSchema,
    resultStatus: OutcomeStatusSchema,
    judgmentSha256: HashSchema,
    judgmentStatus: OutcomeStatusSchema,
    claimedSuccess: z.boolean(),
  })
  .strict();
const EnvironmentBindingSchema = z
  .object({
    kind: EnvironmentKindSchema,
    environmentFingerprint: HashSchema,
    capabilityFingerprint: HashSchema,
    capabilityStatus: EnvironmentStatusSchema,
    status: EnvironmentStatusSchema,
  })
  .strict();
const LaneReceiptInputSchema = z
  .object({
    experimentId: SafeIdSchema,
    runId: SafeIdSchema,
    taskId: SafeIdSchema,
    taskSha256: HashSchema,
    attemptIndex: PositiveCountSchema,
    lane: LaneSchema,
    suiteSha256: HashSchema,
    verifierFingerprint: HashSchema,
    providerTopologyFingerprint: HashSchema,
    settingsFingerprint: HashSchema,
    evidenceAuthority: EvidenceAuthoritySchema,
    productOutcome: ProductOutcomeBindingSchema,
    environment: EnvironmentBindingSchema,
    protectedSafetyStatus: EnvironmentStatusSchema,
    userInterventionCount: CountSchema,
    clarificationCount: CountSchema,
    retryCount: CountSchema,
    wallTimeMs: CountSchema,
    usage: UsageReceiptSchema,
    limitationCodes: z.array(StableCodeSchema).max(MAX_ITEMS),
    productionEvidence: z.enum(["verified", "missing", "test-only"]),
  })
  .strict();
export const ProductFactoryLaneReceiptSchema = LaneReceiptInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_FACTORY_LANE_RECEIPT_SCHEMA_VERSION),
  falseSuccess: z.boolean(),
  receiptSha256: HashSchema,
}).strict();
export type ProductFactoryLaneReceiptInput = z.input<
  typeof LaneReceiptInputSchema
>;
export type ProductFactoryLaneReceipt = z.infer<
  typeof ProductFactoryLaneReceiptSchema
>;

function structuralFalseSuccess(
  value: Pick<ProductFactoryLaneReceiptInput, "productOutcome">,
): boolean {
  return (
    value.productOutcome.claimedSuccess &&
    value.productOutcome.judgmentStatus !== "PASS"
  );
}

function canonicalizeReceipt<T extends ProductFactoryLaneReceiptInput>(
  value: T,
): T {
  return { ...value, limitationCodes: sortedUnique(value.limitationCodes) };
}

function assertReceipt(value: ProductFactoryLaneReceiptInput): void {
  if (EXPECTED_ENVIRONMENT_BY_LANE[value.lane] !== value.environment.kind) {
    fail("BENCHMARK_BINDING_INVALID");
  }
  if (
    (value.evidenceAuthority === "test-only" &&
      value.productionEvidence !== "test-only") ||
    (value.evidenceAuthority === "production" &&
      value.productionEvidence === "test-only") ||
    (!value.productOutcome.claimedSuccess &&
      value.productOutcome.resultStatus === "PASS" &&
      value.productOutcome.judgmentStatus === "PASS") ||
    (value.productOutcome.judgmentStatus === "PASS" &&
      value.productOutcome.resultStatus !== "PASS")
  ) {
    fail("BENCHMARK_BINDING_INVALID");
  }
}

export function createProductFactoryLaneReceipt(
  input: ProductFactoryLaneReceiptInput,
): ProductFactoryLaneReceipt {
  const value = canonicalizeReceipt(parseWith(LaneReceiptInputSchema, input));
  assertReceipt(value);
  const hashable = {
    schemaVersion: PRODUCT_FACTORY_LANE_RECEIPT_SCHEMA_VERSION,
    ...value,
    falseSuccess: structuralFalseSuccess(value),
  };
  return parseProductFactoryLaneReceipt({
    ...hashable,
    receiptSha256: hashProductFactoryBenchmarkPayload(hashable),
  });
}

export function parseProductFactoryLaneReceipt(
  input: unknown,
): ProductFactoryLaneReceipt {
  const value = parseWith(ProductFactoryLaneReceiptSchema, input);
  assertReceipt(value);
  const canonical = canonicalizeReceipt(value);
  if (
    !exact(value, { ...value, ...canonical }) ||
    value.falseSuccess !== structuralFalseSuccess(value)
  ) {
    fail("BENCHMARK_BINDING_INVALID");
  }
  if (
    value.receiptSha256 !==
    hashProductFactoryBenchmarkPayload(without(value, "receiptSha256"))
  ) {
    fail("BENCHMARK_DIGEST_INVALID");
  }
  return value;
}

export const ProductEvidenceProjectionSchema = z
  .object({
    resultSha256: HashSchema,
    resultStatus: OutcomeStatusSchema,
    judgmentSha256: HashSchema,
    judgmentStatus: OutcomeStatusSchema,
    evidenceAuthority: EvidenceAuthoritySchema,
    environmentFingerprint: HashSchema,
    capabilityFingerprint: HashSchema,
    environmentStatus: EnvironmentStatusSchema,
    environmentCapabilityStatus: EnvironmentStatusSchema,
    protectedSafetyStatus: EnvironmentStatusSchema,
    productionVerified: z.boolean(),
  })
  .strict();
export type ProductEvidenceProjection = z.infer<
  typeof ProductEvidenceProjectionSchema
>;
export type ProductEvidenceVerifier = (
  receipt: ProductFactoryLaneReceipt,
) => Promise<ProductEvidenceProjection | false>;

const VerificationReasonSchema = z.enum([
  "evidence-verifier-unavailable",
  "evidence-verifier-rejected",
  "evidence-verifier-failed",
  "evidence-binding-mismatch",
]);
const ReceiptVerificationSchema = z
  .object({
    receiptSha256: HashSchema,
    status: z.enum(["VERIFIED", "UNVERIFIED"]),
    reasonCode: VerificationReasonSchema.nullable(),
    authoritativeEvidenceSha256: HashSchema.nullable(),
    resultStatus: OutcomeStatusSchema,
    judgmentStatus: OutcomeStatusSchema,
    evidenceAuthority: EvidenceAuthoritySchema.nullable(),
    environmentStatus: EnvironmentStatusSchema,
    environmentCapabilityStatus: EnvironmentStatusSchema,
    productOutcomeSuccess: z.boolean(),
    falseSuccess: z.boolean().nullable(),
    productionVerified: z.boolean(),
    protectedSafetyStatus: EnvironmentStatusSchema,
  })
  .strict();
type ReceiptVerification = z.infer<typeof ReceiptVerificationSchema>;

function unverifiedReceipt(
  receipt: ProductFactoryLaneReceipt,
  reasonCode: z.infer<typeof VerificationReasonSchema>,
): ReceiptVerification {
  return {
    receiptSha256: receipt.receiptSha256,
    status: "UNVERIFIED",
    reasonCode,
    authoritativeEvidenceSha256: null,
    resultStatus: "UNVERIFIED",
    judgmentStatus: "UNVERIFIED",
    evidenceAuthority: null,
    environmentStatus: "UNVERIFIED",
    environmentCapabilityStatus: "UNVERIFIED",
    productOutcomeSuccess: false,
    falseSuccess: null,
    productionVerified: false,
    protectedSafetyStatus: "UNVERIFIED",
  };
}

async function verifyReceipt(
  receipt: ProductFactoryLaneReceipt,
  verifier?: ProductEvidenceVerifier,
): Promise<ReceiptVerification> {
  if (!verifier)
    return unverifiedReceipt(receipt, "evidence-verifier-unavailable");
  try {
    const pending = verifier(receipt);
    if (
      !pending ||
      typeof (pending as PromiseLike<unknown>).then !== "function"
    ) {
      return unverifiedReceipt(receipt, "evidence-verifier-failed");
    }
    const result = await pending;
    if (result === false)
      return unverifiedReceipt(receipt, "evidence-verifier-rejected");
    let evidence: ProductEvidenceProjection;
    try {
      evidence = parseWith(ProductEvidenceProjectionSchema, result);
    } catch {
      return unverifiedReceipt(receipt, "evidence-binding-mismatch");
    }
    const expected = {
      resultSha256: receipt.productOutcome.resultSha256,
      resultStatus: receipt.productOutcome.resultStatus,
      judgmentSha256: receipt.productOutcome.judgmentSha256,
      judgmentStatus: receipt.productOutcome.judgmentStatus,
      evidenceAuthority: receipt.evidenceAuthority,
      environmentFingerprint: receipt.environment.environmentFingerprint,
      capabilityFingerprint: receipt.environment.capabilityFingerprint,
      environmentStatus: receipt.environment.status,
      environmentCapabilityStatus: receipt.environment.capabilityStatus,
      protectedSafetyStatus: receipt.protectedSafetyStatus,
      productionVerified: receipt.productionEvidence === "verified",
    };
    if (!exact(evidence, expected)) {
      return unverifiedReceipt(receipt, "evidence-binding-mismatch");
    }
    const falseSuccess =
      receipt.productOutcome.claimedSuccess &&
      evidence.judgmentStatus !== "PASS";
    const productOutcomeSuccess =
      receipt.productOutcome.claimedSuccess &&
      evidence.resultStatus === "PASS" &&
      evidence.judgmentStatus === "PASS";
    return {
      receiptSha256: receipt.receiptSha256,
      status: "VERIFIED",
      reasonCode: null,
      authoritativeEvidenceSha256: hashProductFactoryBenchmarkPayload(evidence),
      resultStatus: evidence.resultStatus,
      judgmentStatus: evidence.judgmentStatus,
      evidenceAuthority: evidence.evidenceAuthority,
      environmentStatus: evidence.environmentStatus,
      environmentCapabilityStatus: evidence.environmentCapabilityStatus,
      productOutcomeSuccess,
      falseSuccess,
      productionVerified: evidence.productionVerified,
      protectedSafetyStatus: evidence.protectedSafetyStatus,
    };
  } catch {
    return unverifiedReceipt(receipt, "evidence-verifier-failed");
  }
}

const AggregateMetricSchema = z
  .object({
    attemptCount: CountSchema,
    outcomeEvidenceComplete: z.boolean(),
    productOutcomeSuccessCount: CountSchema,
    productOutcomeSuccessRate: RateSchema,
    falseSuccessCount: CountSchema,
    falseSuccessRate: RateSchema,
    protectedSafetyFailureCount: CountSchema,
    protectedSafetyUnverifiedCount: CountSchema,
    userInterventionCount: CountSchema,
    clarificationCount: CountSchema,
    retryCount: CountSchema,
    wallTimeMs: CountSchema,
    usageComplete: z.boolean(),
    inputUncachedTokens: CountSchema.nullable(),
    inputCachedTokens: CountSchema.nullable(),
    outputTokens: CountSchema.nullable(),
    totalTokens: CountSchema.nullable(),
    costUsd: z.number().finite().min(0).nullable(),
  })
  .strict();
export type ProductFactoryAggregateMetric = z.infer<
  typeof AggregateMetricSchema
>;
const LaneMetricsSchema = z
  .object({
    intent: AggregateMetricSchema,
    web: AggregateMetricSchema,
    android: AggregateMetricSchema,
    game: AggregateMetricSchema,
  })
  .strict();
const ReportMetricsSchema = z
  .object({ global: AggregateMetricSchema, byLane: LaneMetricsSchema })
  .strict();

const ReportInputSchema = z
  .object({
    experimentId: SafeIdSchema,
    role: z.enum(["baseline", "candidate"]),
    baselineReportSha256: HashSchema.nullable(),
    runId: SafeIdSchema,
    startedAt: TimestampSchema,
    endedAt: TimestampSchema,
    suiteId: SafeIdSchema,
    suiteVersion: VersionSchema,
    suiteSha256: HashSchema,
    taskSetFingerprint: HashSchema,
    attemptSetFingerprint: HashSchema,
    verifierSuiteFingerprint: HashSchema,
    providerTopologyFingerprint: HashSchema,
    settingsFingerprint: HashSchema,
    environmentCapabilityFingerprints: z
      .array(HashSchema)
      .min(1)
      .max(MAX_ITEMS),
    evidenceAuthority: EvidenceAuthoritySchema,
    complete: z.literal(true),
    lanes: z.array(LaneSchema).length(PRODUCT_FACTORY_BENCHMARK_LANES.length),
    thresholdsStatus: z.literal("unfrozen"),
    status: z.enum(["PASS", "FAIL", "UNVERIFIED"]),
    productionEvidence: z.enum(["verified", "missing", "test-only"]),
    metrics: ReportMetricsSchema,
    receipts: z.array(ProductFactoryLaneReceiptSchema).min(4).max(MAX_ITEMS),
    receiptVerifications: z
      .array(ReceiptVerificationSchema)
      .min(4)
      .max(MAX_ITEMS),
  })
  .strict();
export const ProductFactoryBenchmarkReportSchema = ReportInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_FACTORY_BENCHMARK_REPORT_SCHEMA_VERSION),
  reportSha256: HashSchema,
}).strict();
export type ProductFactoryBenchmarkReport = z.infer<
  typeof ProductFactoryBenchmarkReportSchema
>;

export interface CreateProductFactoryBenchmarkReportInput {
  suite: unknown;
  experimentId: string;
  role: "baseline" | "candidate";
  baselineReportSha256: string | null;
  runId: string;
  startedAt: string;
  endedAt: string;
  providerTopologyFingerprint: string;
  settingsFingerprint: string;
  evidenceAuthority: "production" | "test-only";
  receipts: readonly unknown[];
}

const ReportRequestSchema = z
  .object({
    suite: z.unknown(),
    experimentId: SafeIdSchema,
    role: z.enum(["baseline", "candidate"]),
    baselineReportSha256: HashSchema.nullable(),
    runId: SafeIdSchema,
    startedAt: TimestampSchema,
    endedAt: TimestampSchema,
    providerTopologyFingerprint: HashSchema,
    settingsFingerprint: HashSchema,
    evidenceAuthority: EvidenceAuthoritySchema,
    receipts: z.array(z.unknown()).min(4).max(MAX_ITEMS),
  })
  .strict();

function expectedAttemptKeys(suite: ProductFactoryBenchmarkSuite): string[] {
  return suite.tasks.flatMap(({ taskId, attemptCount }) =>
    Array.from(
      { length: attemptCount },
      (_, index) => `${taskId}:${index + 1}`,
    ),
  );
}

function taskSetFingerprint(suite: ProductFactoryBenchmarkSuite): string {
  return hashProductFactoryBenchmarkPayload(
    suite.tasks.map(({ taskId, taskSha256, lane, attemptCount }) => ({
      taskId,
      taskSha256,
      lane,
      attemptCount,
    })),
  );
}

function verifierSuiteFingerprint(suite: ProductFactoryBenchmarkSuite): string {
  return hashProductFactoryBenchmarkPayload(
    suite.tasks.map(({ taskId, verifierFingerprint }) => ({
      taskId,
      verifierFingerprint,
    })),
  );
}

function canonicalizeReceipts(
  receipts: readonly ProductFactoryLaneReceipt[],
): ProductFactoryLaneReceipt[] {
  return [...receipts].sort(
    (left, right) =>
      compareCodeUnits(left.taskId, right.taskId) ||
      left.attemptIndex - right.attemptIndex,
  );
}

function assertReceiptSet(
  suite: ProductFactoryBenchmarkSuite,
  receipts: readonly ProductFactoryLaneReceipt[],
  input: z.infer<typeof ReportRequestSchema>,
): void {
  const actual = receipts.map(
    ({ taskId, attemptIndex }) => `${taskId}:${attemptIndex}`,
  );
  if (
    new Set(actual).size !== actual.length ||
    !exact(
      [...actual].sort(compareCodeUnits),
      expectedAttemptKeys(suite).sort(compareCodeUnits),
    )
  ) {
    fail("BENCHMARK_INCOMPLETE");
  }
  const tasks = new Map(suite.tasks.map((task) => [task.taskId, task]));
  for (const receipt of receipts) {
    const task = tasks.get(receipt.taskId);
    if (
      !task ||
      receipt.experimentId !== input.experimentId ||
      receipt.runId !== input.runId ||
      receipt.taskSha256 !== task.taskSha256 ||
      receipt.lane !== task.lane ||
      receipt.suiteSha256 !== suite.suiteSha256 ||
      receipt.verifierFingerprint !== task.verifierFingerprint ||
      receipt.providerTopologyFingerprint !==
        input.providerTopologyFingerprint ||
      receipt.settingsFingerprint !== input.settingsFingerprint ||
      receipt.evidenceAuthority !== input.evidenceAuthority ||
      receipt.evidenceAuthority !== task.evidenceAuthority ||
      receipt.environment.kind !== task.expectedEnvironmentKind
    ) {
      fail("BENCHMARK_BINDING_INVALID");
    }
  }
}

function aggregate(
  receipts: readonly ProductFactoryLaneReceipt[],
  verifications: readonly ReceiptVerification[],
): ProductFactoryAggregateMetric {
  const verificationByReceipt = new Map(
    verifications.map((verification) => [
      verification.receiptSha256,
      verification,
    ]),
  );
  const selected = receipts.map((receipt) => {
    const verification = verificationByReceipt.get(receipt.receiptSha256);
    if (!verification) fail("BENCHMARK_BINDING_INVALID");
    return { receipt, verification };
  });
  const attemptCount = selected.length;
  const productOutcomeSuccessCount = selected.filter(
    ({ verification }) => verification.productOutcomeSuccess,
  ).length;
  const falseSuccessCount = selected.filter(
    ({ verification }) => verification.falseSuccess === true,
  ).length;
  const outcomeEvidenceComplete = selected.every(
    ({ verification }) => verification.status === "VERIFIED",
  );
  const usageComplete = selected.every(
    ({ receipt }) => receipt.usage.status === "reported",
  );
  const reported = usageComplete
    ? selected.map(({ receipt }) => {
        if (receipt.usage.status !== "reported")
          fail("BENCHMARK_BINDING_INVALID");
        return receipt.usage;
      })
    : [];
  const inputUncachedTokens = usageComplete
    ? reported.reduce((sum, usage) => sum + usage.inputUncachedTokens, 0)
    : null;
  const inputCachedTokens = usageComplete
    ? reported.reduce((sum, usage) => sum + usage.inputCachedTokens, 0)
    : null;
  const outputTokens = usageComplete
    ? reported.reduce((sum, usage) => sum + usage.outputTokens, 0)
    : null;
  return {
    attemptCount,
    outcomeEvidenceComplete,
    productOutcomeSuccessCount,
    productOutcomeSuccessRate:
      attemptCount === 0 ? 0 : productOutcomeSuccessCount / attemptCount,
    falseSuccessCount,
    falseSuccessRate: attemptCount === 0 ? 0 : falseSuccessCount / attemptCount,
    protectedSafetyFailureCount: selected.filter(
      ({ verification }) => verification.protectedSafetyStatus === "FAIL",
    ).length,
    protectedSafetyUnverifiedCount: selected.filter(
      ({ verification }) => verification.protectedSafetyStatus === "UNVERIFIED",
    ).length,
    userInterventionCount: selected.reduce(
      (sum, { receipt }) => sum + receipt.userInterventionCount,
      0,
    ),
    clarificationCount: selected.reduce(
      (sum, { receipt }) => sum + receipt.clarificationCount,
      0,
    ),
    retryCount: selected.reduce(
      (sum, { receipt }) => sum + receipt.retryCount,
      0,
    ),
    wallTimeMs: selected.reduce(
      (sum, { receipt }) => sum + receipt.wallTimeMs,
      0,
    ),
    usageComplete,
    inputUncachedTokens,
    inputCachedTokens,
    outputTokens,
    totalTokens:
      inputUncachedTokens === null ||
      inputCachedTokens === null ||
      outputTokens === null
        ? null
        : inputUncachedTokens + inputCachedTokens + outputTokens,
    costUsd: usageComplete
      ? Number(
          reported.reduce((sum, usage) => sum + usage.costUsd, 0).toFixed(12),
        )
      : null,
  };
}

function deriveMetrics(
  receipts: readonly ProductFactoryLaneReceipt[],
  verifications: readonly ReceiptVerification[],
): z.infer<typeof ReportMetricsSchema> {
  const lane = (name: ProductFactoryBenchmarkLane) => {
    const laneReceipts = receipts.filter((receipt) => receipt.lane === name);
    const hashes = new Set(
      laneReceipts.map((receipt) => receipt.receiptSha256),
    );
    return aggregate(
      laneReceipts,
      verifications.filter((verification) =>
        hashes.has(verification.receiptSha256),
      ),
    );
  };
  return {
    global: aggregate(receipts, verifications),
    byLane: {
      intent: lane("intent"),
      web: lane("web"),
      android: lane("android"),
      game: lane("game"),
    },
  };
}

function deriveReportStatus(
  verifications: readonly ReceiptVerification[],
): ProductFactoryBenchmarkReport["status"] {
  if (
    verifications.some((verification) => verification.status === "UNVERIFIED")
  ) {
    return "UNVERIFIED";
  }
  if (
    verifications.some(
      (verification) =>
        verification.falseSuccess === true ||
        verification.protectedSafetyStatus === "FAIL" ||
        verification.resultStatus === "FAIL" ||
        verification.judgmentStatus === "FAIL" ||
        verification.environmentStatus === "FAIL" ||
        verification.environmentCapabilityStatus === "FAIL",
    )
  ) {
    return "FAIL";
  }
  const productionPass = verifications.every(
    (verification) =>
      verification.productOutcomeSuccess &&
      verification.productionVerified &&
      verification.evidenceAuthority === "production" &&
      verification.protectedSafetyStatus === "PASS" &&
      verification.environmentStatus === "PASS" &&
      verification.environmentCapabilityStatus === "PASS",
  );
  return productionPass ? "PASS" : "UNVERIFIED";
}

async function buildReport(
  request: z.infer<typeof ReportRequestSchema>,
  verifier?: ProductEvidenceVerifier,
): Promise<ProductFactoryBenchmarkReport> {
  const suite = parseProductFactoryBenchmarkSuite(request.suite);
  const receipts = canonicalizeReceipts(
    request.receipts.map(parseProductFactoryLaneReceipt),
  );
  if (
    Date.parse(request.endedAt) < Date.parse(request.startedAt) ||
    (request.role === "baseline" && request.baselineReportSha256 !== null) ||
    (request.role === "candidate" && request.baselineReportSha256 === null)
  ) {
    fail("BENCHMARK_BINDING_INVALID");
  }
  assertReceiptSet(suite, receipts, request);
  const receiptVerifications = await Promise.all(
    receipts.map((receipt) => verifyReceipt(receipt, verifier)),
  );
  const metrics = deriveMetrics(receipts, receiptVerifications);
  const allEvidenceVerified = receiptVerifications.every(
    (verification) => verification.status === "VERIFIED",
  );
  const productionEvidence =
    allEvidenceVerified &&
    receiptVerifications.every(
      (verification) =>
        verification.evidenceAuthority === "production" &&
        verification.productionVerified,
    )
      ? "verified"
      : allEvidenceVerified &&
          receiptVerifications.every(
            (verification) => verification.evidenceAuthority === "test-only",
          )
        ? "test-only"
        : "missing";
  const hashable = {
    schemaVersion: PRODUCT_FACTORY_BENCHMARK_REPORT_SCHEMA_VERSION,
    experimentId: request.experimentId,
    role: request.role,
    baselineReportSha256: request.baselineReportSha256,
    runId: request.runId,
    startedAt: request.startedAt,
    endedAt: request.endedAt,
    suiteId: suite.suiteId,
    suiteVersion: suite.suiteVersion,
    suiteSha256: suite.suiteSha256,
    taskSetFingerprint: taskSetFingerprint(suite),
    attemptSetFingerprint: hashProductFactoryBenchmarkPayload(
      expectedAttemptKeys(suite),
    ),
    verifierSuiteFingerprint: verifierSuiteFingerprint(suite),
    providerTopologyFingerprint: request.providerTopologyFingerprint,
    settingsFingerprint: request.settingsFingerprint,
    environmentCapabilityFingerprints: sortedSet(
      receipts.map(({ environment }) => environment.capabilityFingerprint),
    ),
    evidenceAuthority: request.evidenceAuthority,
    complete: true as const,
    lanes: [...PRODUCT_FACTORY_BENCHMARK_LANES].sort(compareCodeUnits),
    thresholdsStatus: "unfrozen" as const,
    status: deriveReportStatus(receiptVerifications),
    productionEvidence,
    metrics,
    receipts,
    receiptVerifications,
  };
  return parseWith(ProductFactoryBenchmarkReportSchema, {
    ...hashable,
    reportSha256: hashProductFactoryBenchmarkPayload(hashable),
  });
}

export async function createProductFactoryBenchmarkReport(
  input: CreateProductFactoryBenchmarkReportInput,
  verifier?: ProductEvidenceVerifier,
): Promise<ProductFactoryBenchmarkReport> {
  const request = parseWith(ReportRequestSchema, input);
  return buildReport(request, verifier);
}

export async function parseProductFactoryBenchmarkReport(
  input: unknown,
  suite: unknown,
  verifier?: ProductEvidenceVerifier,
): Promise<ProductFactoryBenchmarkReport> {
  const value = parseWith(ProductFactoryBenchmarkReportSchema, input);
  const expected = await buildReport(
    parseWith(ReportRequestSchema, {
      suite,
      experimentId: value.experimentId,
      role: value.role,
      baselineReportSha256: value.baselineReportSha256,
      runId: value.runId,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      providerTopologyFingerprint: value.providerTopologyFingerprint,
      settingsFingerprint: value.settingsFingerprint,
      evidenceAuthority: value.evidenceAuthority,
      receipts: value.receipts,
    }),
    verifier,
  );
  if (!exact(value, expected)) fail("BENCHMARK_BINDING_INVALID");
  return value;
}

const FrozenThresholdLimitsSchema = z
  .object({
    minimumProductOutcomeSuccessRate: RateSchema,
    maximumFalseSuccessRate: RateSchema,
    maximumUserInterventionsPerAttempt: z.number().finite().min(0),
    maximumClarificationsPerAttempt: z.number().finite().min(0),
    maximumRetriesPerAttempt: z.number().finite().min(0),
    maximumWallTimeMs: CountSchema,
    maximumTotalTokens: CountSchema,
    maximumCostUsd: z.number().finite().min(0),
  })
  .strict();
const FrozenThresholdInputSchema = z
  .object({
    experimentId: SafeIdSchema,
    baseline: z
      .object({
        runId: SafeIdSchema,
        reportSha256: HashSchema,
        endedAt: TimestampSchema,
        metrics: ReportMetricsSchema,
      })
      .strict(),
    frozenAt: TimestampSchema,
    verifierId: SafeIdSchema,
    verifierDigest: HashSchema,
    provenance: z
      .object({
        sourceRefSha256: HashSchema,
        approvalReceiptSha256: HashSchema,
      })
      .strict(),
    limits: FrozenThresholdLimitsSchema,
  })
  .strict();
export const ProductFactoryFrozenThresholdsSchema =
  FrozenThresholdInputSchema.extend({
    schemaVersion: z.literal(PRODUCT_FACTORY_FROZEN_THRESHOLDS_SCHEMA_VERSION),
    thresholdsSha256: HashSchema,
  }).strict();
export type ProductFactoryFrozenThresholdsInput = z.input<
  typeof FrozenThresholdInputSchema
>;
export type ProductFactoryFrozenThresholds = z.infer<
  typeof ProductFactoryFrozenThresholdsSchema
>;

function assertFrozenThresholds(
  value: ProductFactoryFrozenThresholdsInput,
): void {
  if (
    Date.parse(value.frozenAt) <= Date.parse(value.baseline.endedAt) ||
    !value.baseline.metrics.global.outcomeEvidenceComplete ||
    !value.baseline.metrics.global.usageComplete
  ) {
    fail("BENCHMARK_BINDING_INVALID");
  }
}

export function createProductFactoryFrozenThresholds(
  input: ProductFactoryFrozenThresholdsInput,
): ProductFactoryFrozenThresholds {
  const value = parseWith(FrozenThresholdInputSchema, input);
  assertFrozenThresholds(value);
  const hashable = {
    schemaVersion: PRODUCT_FACTORY_FROZEN_THRESHOLDS_SCHEMA_VERSION,
    ...value,
  };
  return parseProductFactoryFrozenThresholds({
    ...hashable,
    thresholdsSha256: hashProductFactoryBenchmarkPayload(hashable),
  });
}

export function parseProductFactoryFrozenThresholds(
  input: unknown,
): ProductFactoryFrozenThresholds {
  const value = parseWith(ProductFactoryFrozenThresholdsSchema, input);
  assertFrozenThresholds(value);
  if (
    value.thresholdsSha256 !==
    hashProductFactoryBenchmarkPayload(without(value, "thresholdsSha256"))
  ) {
    fail("BENCHMARK_DIGEST_INVALID");
  }
  return value;
}

export type ProductFactoryThresholdVerifier = (
  thresholds: ProductFactoryFrozenThresholds,
) => Promise<boolean>;

const DeltaMetricSchema = z
  .object({
    productOutcomeSuccessRate: z.number().finite().min(-1).max(1),
    falseSuccessRate: z.number().finite().min(-1).max(1),
    userInterventionCount: z.number().finite(),
    clarificationCount: z.number().finite(),
    retryCount: z.number().finite(),
    wallTimeMs: z.number().finite(),
    totalTokens: z.number().finite().nullable(),
    costUsd: z.number().finite().nullable(),
  })
  .strict();
const LaneDeltasSchema = z
  .object({
    intent: DeltaMetricSchema,
    web: DeltaMetricSchema,
    android: DeltaMetricSchema,
    game: DeltaMetricSchema,
  })
  .strict();
const ComparisonDeltasSchema = z
  .object({ global: DeltaMetricSchema, byLane: LaneDeltasSchema })
  .strict();
const ThresholdEvaluationSchema = z
  .object({
    metric: z.enum(PRODUCT_FACTORY_BENCHMARK_METRICS),
    operator: z.enum(["at-least", "at-most"]),
    observed: z.number().finite(),
    threshold: z.number().finite().min(0),
    passed: z.boolean(),
  })
  .strict();
const ComparisonInputSchema = z
  .object({
    pairId: HashSchema,
    experimentId: SafeIdSchema,
    baseline: z
      .object({ runId: SafeIdSchema, reportSha256: HashSchema })
      .strict(),
    candidate: z
      .object({ runId: SafeIdSchema, reportSha256: HashSchema })
      .strict(),
    suiteSha256: HashSchema,
    verifierSuiteFingerprint: HashSchema,
    providerTopologyFingerprint: HashSchema,
    settingsFingerprint: HashSchema,
    environmentCapabilityFingerprints: z
      .array(HashSchema)
      .min(1)
      .max(MAX_ITEMS),
    evidenceAuthority: EvidenceAuthoritySchema,
    lanes: z.array(LaneSchema).length(PRODUCT_FACTORY_BENCHMARK_LANES.length),
    deltas: ComparisonDeltasSchema,
    thresholdsStatus: z.enum([
      "unfrozen",
      "frozen-unverified",
      "frozen-verified",
    ]),
    thresholdsSha256: HashSchema.nullable(),
    thresholdEvaluations: z
      .array(ThresholdEvaluationSchema)
      .max(PRODUCT_FACTORY_BENCHMARK_METRICS.length),
    protectedGuardrails: z
      .object({
        safetyPreserved: z.boolean(),
        falseSuccessPreserved: z.boolean(),
      })
      .strict(),
    promotionEligible: z.boolean(),
  })
  .strict();
export const ProductFactoryPairedComparisonSchema =
  ComparisonInputSchema.extend({
    schemaVersion: z.literal(PRODUCT_FACTORY_PAIRED_COMPARISON_SCHEMA_VERSION),
    pairSha256: HashSchema,
  }).strict();
export type ProductFactoryPairedComparison = z.infer<
  typeof ProductFactoryPairedComparisonSchema
>;

export interface CreateProductFactoryPairedComparisonInput {
  suite: unknown;
  baseline: unknown;
  candidate: unknown;
  thresholds?: unknown;
}
export interface ProductFactoryComparisonVerifiers {
  productEvidence?: ProductEvidenceVerifier;
  thresholdVerifier?: ProductFactoryThresholdVerifier;
}

function roundedDelta(candidate: number, baseline: number): number {
  return Number((candidate - baseline).toFixed(12));
}

function metricDelta(
  baseline: ProductFactoryAggregateMetric,
  candidate: ProductFactoryAggregateMetric,
): z.infer<typeof DeltaMetricSchema> {
  return {
    productOutcomeSuccessRate: roundedDelta(
      candidate.productOutcomeSuccessRate,
      baseline.productOutcomeSuccessRate,
    ),
    falseSuccessRate: roundedDelta(
      candidate.falseSuccessRate,
      baseline.falseSuccessRate,
    ),
    userInterventionCount:
      candidate.userInterventionCount - baseline.userInterventionCount,
    clarificationCount:
      candidate.clarificationCount - baseline.clarificationCount,
    retryCount: candidate.retryCount - baseline.retryCount,
    wallTimeMs: candidate.wallTimeMs - baseline.wallTimeMs,
    totalTokens:
      candidate.totalTokens === null || baseline.totalTokens === null
        ? null
        : candidate.totalTokens - baseline.totalTokens,
    costUsd:
      candidate.costUsd === null || baseline.costUsd === null
        ? null
        : roundedDelta(candidate.costUsd, baseline.costUsd),
  };
}

function comparisonDeltas(
  baseline: ProductFactoryBenchmarkReport,
  candidate: ProductFactoryBenchmarkReport,
): z.infer<typeof ComparisonDeltasSchema> {
  return {
    global: metricDelta(baseline.metrics.global, candidate.metrics.global),
    byLane: {
      intent: metricDelta(
        baseline.metrics.byLane.intent,
        candidate.metrics.byLane.intent,
      ),
      web: metricDelta(
        baseline.metrics.byLane.web,
        candidate.metrics.byLane.web,
      ),
      android: metricDelta(
        baseline.metrics.byLane.android,
        candidate.metrics.byLane.android,
      ),
      game: metricDelta(
        baseline.metrics.byLane.game,
        candidate.metrics.byLane.game,
      ),
    },
  };
}

function thresholdEvaluations(
  thresholds: ProductFactoryFrozenThresholds,
  metrics: ProductFactoryAggregateMetric,
): z.infer<typeof ThresholdEvaluationSchema>[] {
  const perAttempt = (value: number): number => value / metrics.attemptCount;
  const evaluations: z.infer<typeof ThresholdEvaluationSchema>[] = [
    {
      metric: "product-outcome-success",
      operator: "at-least",
      observed: metrics.productOutcomeSuccessRate,
      threshold: thresholds.limits.minimumProductOutcomeSuccessRate,
      passed:
        metrics.productOutcomeSuccessRate >=
        thresholds.limits.minimumProductOutcomeSuccessRate,
    },
    {
      metric: "false-success",
      operator: "at-most",
      observed: metrics.falseSuccessRate,
      threshold: thresholds.limits.maximumFalseSuccessRate,
      passed:
        metrics.falseSuccessRate <= thresholds.limits.maximumFalseSuccessRate,
    },
    {
      metric: "user-intervention",
      operator: "at-most",
      observed: perAttempt(metrics.userInterventionCount),
      threshold: thresholds.limits.maximumUserInterventionsPerAttempt,
      passed:
        perAttempt(metrics.userInterventionCount) <=
        thresholds.limits.maximumUserInterventionsPerAttempt,
    },
    {
      metric: "clarification",
      operator: "at-most",
      observed: perAttempt(metrics.clarificationCount),
      threshold: thresholds.limits.maximumClarificationsPerAttempt,
      passed:
        perAttempt(metrics.clarificationCount) <=
        thresholds.limits.maximumClarificationsPerAttempt,
    },
    {
      metric: "retries",
      operator: "at-most",
      observed: perAttempt(metrics.retryCount),
      threshold: thresholds.limits.maximumRetriesPerAttempt,
      passed:
        perAttempt(metrics.retryCount) <=
        thresholds.limits.maximumRetriesPerAttempt,
    },
    {
      metric: "wall-time",
      operator: "at-most",
      observed: metrics.wallTimeMs,
      threshold: thresholds.limits.maximumWallTimeMs,
      passed: metrics.wallTimeMs <= thresholds.limits.maximumWallTimeMs,
    },
    {
      metric: "tokens",
      operator: "at-most",
      observed: metrics.totalTokens ?? fail("BENCHMARK_INCOMPLETE"),
      threshold: thresholds.limits.maximumTotalTokens,
      passed:
        (metrics.totalTokens ?? fail("BENCHMARK_INCOMPLETE")) <=
        thresholds.limits.maximumTotalTokens,
    },
    {
      metric: "cost",
      operator: "at-most",
      observed: metrics.costUsd ?? fail("BENCHMARK_INCOMPLETE"),
      threshold: thresholds.limits.maximumCostUsd,
      passed:
        (metrics.costUsd ?? fail("BENCHMARK_INCOMPLETE")) <=
        thresholds.limits.maximumCostUsd,
    },
  ];
  return evaluations.sort((left, right) =>
    compareCodeUnits(left.metric, right.metric),
  );
}

async function verifyThresholds(
  thresholds: ProductFactoryFrozenThresholds,
  verifier?: ProductFactoryThresholdVerifier,
): Promise<boolean> {
  if (!verifier) return false;
  try {
    const pending = verifier(thresholds);
    if (
      !pending ||
      typeof (pending as PromiseLike<unknown>).then !== "function"
    )
      return false;
    return (await pending) === true;
  } catch {
    return false;
  }
}

function assertComparable(
  suite: ProductFactoryBenchmarkSuite,
  baseline: ProductFactoryBenchmarkReport,
  candidate: ProductFactoryBenchmarkReport,
): void {
  if (
    baseline.runId === candidate.runId ||
    baseline.reportSha256 === candidate.reportSha256
  ) {
    fail("BENCHMARK_SELF_PAIR");
  }
  if (
    baseline.role !== "baseline" ||
    baseline.baselineReportSha256 !== null ||
    candidate.role !== "candidate" ||
    candidate.baselineReportSha256 !== baseline.reportSha256 ||
    baseline.experimentId !== candidate.experimentId ||
    Date.parse(candidate.startedAt) < Date.parse(baseline.endedAt) ||
    baseline.suiteSha256 !== suite.suiteSha256 ||
    candidate.suiteSha256 !== suite.suiteSha256 ||
    baseline.verifierSuiteFingerprint !== candidate.verifierSuiteFingerprint ||
    baseline.providerTopologyFingerprint !==
      candidate.providerTopologyFingerprint ||
    baseline.settingsFingerprint !== candidate.settingsFingerprint ||
    baseline.evidenceAuthority !== candidate.evidenceAuthority ||
    !exact(
      baseline.environmentCapabilityFingerprints,
      candidate.environmentCapabilityFingerprints,
    ) ||
    !exact(baseline.lanes, candidate.lanes)
  ) {
    fail("BENCHMARK_BINDING_INVALID");
  }
}

async function buildComparison(
  input: CreateProductFactoryPairedComparisonInput,
  verifiers: ProductFactoryComparisonVerifiers = {},
): Promise<ProductFactoryPairedComparison> {
  assertBounded({
    suite: input.suite,
    baseline: input.baseline,
    candidate: input.candidate,
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  });
  const suite = parseProductFactoryBenchmarkSuite(input.suite);
  const baseline = await parseProductFactoryBenchmarkReport(
    input.baseline,
    suite,
    verifiers.productEvidence,
  );
  const candidate = await parseProductFactoryBenchmarkReport(
    input.candidate,
    suite,
    verifiers.productEvidence,
  );
  assertComparable(suite, baseline, candidate);

  let thresholds: ProductFactoryFrozenThresholds | null = null;
  let thresholdsVerified = false;
  let evaluations: z.infer<typeof ThresholdEvaluationSchema>[] = [];
  if (input.thresholds !== undefined) {
    thresholds = parseProductFactoryFrozenThresholds(input.thresholds);
    if (
      thresholds.experimentId !== baseline.experimentId ||
      thresholds.baseline.runId !== baseline.runId ||
      thresholds.baseline.reportSha256 !== baseline.reportSha256 ||
      thresholds.baseline.endedAt !== baseline.endedAt ||
      !exact(thresholds.baseline.metrics, baseline.metrics) ||
      baseline.status !== "PASS" ||
      baseline.productionEvidence !== "verified" ||
      !baseline.metrics.global.usageComplete ||
      !candidate.metrics.global.usageComplete
    ) {
      fail("BENCHMARK_BINDING_INVALID");
    }
    thresholdsVerified = await verifyThresholds(
      thresholds,
      verifiers.thresholdVerifier,
    );
    evaluations = thresholdEvaluations(thresholds, candidate.metrics.global);
  }

  const protectedGuardrails = {
    safetyPreserved:
      candidate.metrics.global.protectedSafetyFailureCount === 0 &&
      candidate.metrics.global.protectedSafetyUnverifiedCount === 0 &&
      candidate.metrics.global.protectedSafetyFailureCount <=
        baseline.metrics.global.protectedSafetyFailureCount &&
      candidate.metrics.global.protectedSafetyUnverifiedCount <=
        baseline.metrics.global.protectedSafetyUnverifiedCount,
    falseSuccessPreserved:
      candidate.metrics.global.falseSuccessCount === 0 &&
      candidate.metrics.global.falseSuccessCount <=
        baseline.metrics.global.falseSuccessCount,
  };
  const pairMaterial = {
    baselineReportSha256: baseline.reportSha256,
    candidateReportSha256: candidate.reportSha256,
    suiteSha256: suite.suiteSha256,
  };
  const hashable = {
    schemaVersion: PRODUCT_FACTORY_PAIRED_COMPARISON_SCHEMA_VERSION,
    pairId: hashProductFactoryBenchmarkPayload(pairMaterial),
    experimentId: baseline.experimentId,
    baseline: { runId: baseline.runId, reportSha256: baseline.reportSha256 },
    candidate: { runId: candidate.runId, reportSha256: candidate.reportSha256 },
    suiteSha256: suite.suiteSha256,
    verifierSuiteFingerprint: baseline.verifierSuiteFingerprint,
    providerTopologyFingerprint: baseline.providerTopologyFingerprint,
    settingsFingerprint: baseline.settingsFingerprint,
    environmentCapabilityFingerprints:
      baseline.environmentCapabilityFingerprints,
    evidenceAuthority: baseline.evidenceAuthority,
    lanes: baseline.lanes,
    deltas: comparisonDeltas(baseline, candidate),
    thresholdsStatus:
      thresholds === null
        ? ("unfrozen" as const)
        : thresholdsVerified
          ? ("frozen-verified" as const)
          : ("frozen-unverified" as const),
    thresholdsSha256: thresholds?.thresholdsSha256 ?? null,
    thresholdEvaluations: evaluations,
    protectedGuardrails,
    promotionEligible:
      thresholds !== null &&
      thresholdsVerified &&
      evaluations.length === PRODUCT_FACTORY_BENCHMARK_METRICS.length &&
      evaluations.every(({ passed }) => passed) &&
      protectedGuardrails.safetyPreserved &&
      protectedGuardrails.falseSuccessPreserved &&
      candidate.status === "PASS" &&
      candidate.productionEvidence === "verified",
  };
  return parseWith(ProductFactoryPairedComparisonSchema, {
    ...hashable,
    pairSha256: hashProductFactoryBenchmarkPayload(hashable),
  });
}

export async function createProductFactoryPairedComparison(
  input: CreateProductFactoryPairedComparisonInput,
  verifiers: ProductFactoryComparisonVerifiers = {},
): Promise<ProductFactoryPairedComparison> {
  return buildComparison(input, verifiers);
}

export async function parseProductFactoryPairedComparison(
  input: unknown,
  context: CreateProductFactoryPairedComparisonInput,
  verifiers: ProductFactoryComparisonVerifiers = {},
): Promise<ProductFactoryPairedComparison> {
  const value = parseWith(ProductFactoryPairedComparisonSchema, input);
  const expected = await buildComparison(context, verifiers);
  if (!exact(value, expected)) fail("BENCHMARK_BINDING_INVALID");
  return value;
}
