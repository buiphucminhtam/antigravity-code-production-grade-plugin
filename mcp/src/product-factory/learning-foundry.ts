import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  TrajectoryLedger,
  foldTrajectory,
  type LedgerTip,
  type TrajectoryEvent,
} from '../runtime/trajectory-ledger.js';

export const LEARNING_FOUNDRY_SCHEMA_VERSION = 'learning-foundry/v1' as const;
export const SANITIZED_TRAJECTORY_SUMMARY_SCHEMA_VERSION =
  'sanitized-terminal-trajectory-summary/v1' as const;
export const TRAJECTORY_CLUSTER_SCHEMA_VERSION = 'trajectory-cluster/v1' as const;
export const CANDIDATE_LESSON_SCHEMA_VERSION = 'candidate-lesson/v1' as const;
export const FORGE_BENCH_PROMOTION_PROJECTION_SCHEMA_VERSION =
  'forge-bench-promotion-projection/v1' as const;
export const OFFLINE_REPLAY_RECEIPT_SCHEMA_VERSION = 'offline-replay-receipt/v1' as const;
export const INDEPENDENT_REVIEW_RECEIPT_SCHEMA_VERSION = 'independent-review-2-receipt/v1' as const;
export const LEARNING_REGISTRY_SCHEMA_VERSION = 'learning-registry/v1' as const;
export const LEARNING_PROMOTION_PACKAGE_SCHEMA_VERSION =
  'learning-promotion-delta-package/v1' as const;
export const LEARNING_PROMOTION_RECEIPT_SCHEMA_VERSION = 'learning-promotion-receipt/v1' as const;
export const LEARNING_ROLLBACK_PACKAGE_SCHEMA_VERSION =
  'learning-rollback-delta-package/v1' as const;
export const LEARNING_ROLLBACK_RECEIPT_SCHEMA_VERSION = 'learning-rollback-receipt/v1' as const;
export const TRUSTED_LEARNING_HOST_CAPABILITY_SCHEMA_VERSION =
  'trusted-learning-host-capability/v1' as const;

export const LEARNING_FOUNDRY_MAX_BYTES = 256 * 1024;
const MAX_ITEMS = 256;
const MAX_COUNT = 1_000_000_000;
const MAX_DEPTH = 16;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const RAW_FIELD =
  /^(?:prompt|raw(?:input|output|prompt|response|content|text)?|output|response|message|content|api[-_]?key|password|secret|authorization|cookie|credential)$/i;
const SENSITIVE_TEXT =
  /(?:bearer(?:-|\s)|private[-_ ]key|api[-_ ]key|access[-_ ]key|secret[-_ ]key|password|credential|authorization|cookie|-----begin|\bsk-[a-z0-9]{16}|\bghp_[a-z0-9]+|\bgithub_pat_[a-z0-9_]+|\bglpat-[a-z0-9_-]+|\bxox[a-z]-[a-z0-9-]+|\bxapp-[a-z0-9-]+)/i;
const AWS_KEY = /\bAKIA[A-Z0-9]{16}\b/;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const HIGH_ENTROPY = /[A-Za-z0-9+/_=]{20,}/;

export type LearningFoundryErrorCode =
  | 'LEARNING_MALFORMED'
  | 'LEARNING_SIZE_LIMIT'
  | 'LEARNING_PRIVACY_REJECTED'
  | 'LEARNING_HASH_INVALID'
  | 'LEARNING_TRAJECTORY_ACTIVE'
  | 'LEARNING_TRAJECTORY_STALE'
  | 'LEARNING_TRAJECTORY_CORRUPT'
  | 'LEARNING_NOT_MAINTENANCE'
  | 'LEARNING_HOST_CAPABILITY_INVALID'
  | 'LEARNING_UNTRUSTED_COMPARISON'
  | 'LEARNING_UNTRUSTED_REVIEW'
  | 'LEARNING_SELF_REVIEW'
  | 'LEARNING_UNFROZEN_THRESHOLDS'
  | 'LEARNING_PROTECTED_REGRESSION'
  | 'LEARNING_NO_USEFUL_GAIN'
  | 'LEARNING_HARMFUL_CANDIDATE'
  | 'LEARNING_STALE_BASE'
  | 'LEARNING_REPLAY_REJECTED'
  | 'LEARNING_REVERSIBILITY_REQUIRED'
  | 'LEARNING_ROLLBACK_INVALID'
  | 'LEARNING_REGISTRY_CORRUPT';

export class LearningFoundryError extends Error {
  constructor(readonly code: LearningFoundryErrorCode) {
    super(code);
    this.name = 'LearningFoundryError';
  }
}

function fail(code: LearningFoundryErrorCode): never {
  throw new LearningFoundryError(code);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail('LEARNING_MALFORMED');
  return encoded;
}

function assertPrivateDataAbsent(
  value: unknown,
  fieldName: string | null = null,
  depth = 0,
  seen = new Set<object>(),
): void {
  if (depth > MAX_DEPTH) fail('LEARNING_SIZE_LIMIT');
  if (typeof value === 'string') {
    const hashField =
      fieldName === null || /(?:sha256|hash|digest|fingerprint|key)s?$/i.test(fieldName);
    if (
      SENSITIVE_TEXT.test(value) ||
      AWS_KEY.test(value) ||
      JWT.test(value) ||
      (HIGH_ENTROPY.test(value) && !(hashField && HASH.test(value)))
    ) {
      fail('LEARNING_PRIVACY_REJECTED');
    }
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('LEARNING_MALFORMED');
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) fail('LEARNING_MALFORMED');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ITEMS) fail('LEARNING_SIZE_LIMIT');
      for (const entry of value) assertPrivateDataAbsent(entry, fieldName, depth + 1, seen);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('LEARNING_MALFORMED');
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_ITEMS) fail('LEARNING_SIZE_LIMIT');
    for (const [key, entry] of entries) {
      if (
        key.length === 0 ||
        key.length > 128 ||
        RAW_FIELD.test(key) ||
        ['__proto__', 'prototype', 'constructor'].includes(key)
      ) {
        fail('LEARNING_PRIVACY_REJECTED');
      }
      assertPrivateDataAbsent(entry, key, depth + 1, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function assertBounded(value: unknown): void {
  assertPrivateDataAbsent(value);
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > LEARNING_FOUNDRY_MAX_BYTES) {
    fail('LEARNING_SIZE_LIMIT');
  }
}

export function hashLearningFoundryPayload(value: unknown): string {
  assertBounded(value);
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function parseWith<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  assertBounded(value);
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) fail('LEARNING_MALFORMED');
  return parsed.data as z.output<T>;
}

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  if (new Set(values).size !== values.length) fail('LEARNING_MALFORMED');
  return [...values].sort(compare);
}

function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const HashSchema = z.string().regex(HASH);
const SafeIdSchema = z.string().min(1).max(96).regex(SAFE_ID);
const VersionSchema = z.number().int().min(0).max(MAX_COUNT);
const CountSchema = z.number().int().min(0).max(MAX_COUNT);
const AuthoritySchema = z.enum(['production', 'test-only']);
const SourceAuthoritySchema = z.enum(['production', 'test-only', 'unverified']);
const TipSchema = z
  .object({ sequence: z.number().int().min(1).max(MAX_COUNT), sha256: HashSchema })
  .strict();
const CounterSchema = z
  .object({
    eventCount: z.number().int().min(3).max(MAX_COUNT),
    recoveredCount: CountSchema,
    scopeCount: CountSchema,
    operationCount: CountSchema,
    disposerCount: CountSchema,
    cancellationCount: CountSchema,
    finalizationReceiptCount: z.number().int().min(1).max(MAX_COUNT),
  })
  .strict();

const SanitizedTrajectorySummaryInputSchema = z
  .object({
    workspaceId: SafeIdSchema,
    sessionId: SafeIdSchema,
    ledgerId: SafeIdSchema,
    origin: SafeIdSchema,
    sourceAuthority: SourceAuthoritySchema,
    startedAt: CountSchema,
    terminalAt: CountSchema,
    ledgerHead: TipSchema,
    terminalOutcome: z.enum(['completed', 'failed', 'cancelled', 'timed_out']),
    quiescence: z.literal('confirmed'),
    counters: CounterSchema,
  })
  .strict();
export const SanitizedTrajectorySummarySchema = SanitizedTrajectorySummaryInputSchema.extend({
  schemaVersion: z.literal(SANITIZED_TRAJECTORY_SUMMARY_SCHEMA_VERSION),
  summarySha256: HashSchema,
}).strict();
export type SanitizedTrajectorySummary = z.infer<typeof SanitizedTrajectorySummarySchema>;

export function parseSanitizedTrajectorySummary(value: unknown): SanitizedTrajectorySummary {
  const parsed = parseWith(SanitizedTrajectorySummarySchema, value);
  if (
    parsed.ledgerHead.sequence !== parsed.counters.eventCount ||
    parsed.terminalAt < parsed.startedAt ||
    parsed.summarySha256 !== hashLearningFoundryPayload(without(parsed, 'summarySha256'))
  ) {
    fail('LEARNING_HASH_INVALID');
  }
  return parsed;
}

function deriveSourceAuthority(origin: string): z.infer<typeof SourceAuthoritySchema> {
  if (origin === 'production') return 'production';
  if (origin === 'test' || origin === 'test-only') return 'test-only';
  return 'unverified';
}

function sameTip(left: LedgerTip, right: LedgerTip): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

async function summarizeLedger(
  ledger: TrajectoryLedger,
  expectedTip: LedgerTip,
  nowMs: number,
  freshnessHorizonMs: number,
): Promise<Readonly<SanitizedTrajectorySummary>> {
  if (!(ledger instanceof TrajectoryLedger)) fail('LEARNING_TRAJECTORY_CORRUPT');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail('LEARNING_TRAJECTORY_STALE');
  if (expectedTip.hash === null || expectedTip.sequence < 1) fail('LEARNING_TRAJECTORY_STALE');
  let events: readonly TrajectoryEvent[];
  try {
    events = await ledger.reconstruct();
  } catch {
    fail('LEARNING_TRAJECTORY_CORRUPT');
  }
  const observed: LedgerTip = { sequence: events.length, hash: events.at(-1)?.hash ?? null };
  if (!sameTip(observed, expectedTip)) fail('LEARNING_TRAJECTORY_STALE');
  let current: LedgerTip;
  try {
    current = await ledger.tip();
  } catch {
    fail('LEARNING_TRAJECTORY_CORRUPT');
  }
  if (!sameTip(current, expectedTip)) fail('LEARNING_TRAJECTORY_STALE');

  const opened = events[0];
  const terminal = events.at(-1);
  const folded = foldTrajectory(events);
  if (
    opened?.kind !== 'trajectory.opened' ||
    terminal?.kind !== 'trajectory.terminal' ||
    terminal.payload.quiescence !== 'confirmed' ||
    folded.terminal === null ||
    !folded.finalizationStarted ||
    folded.finalizationReceiptCount !== 1 ||
    folded.openScopeIds.length > 0 ||
    folded.activeOperationIds.length > 0 ||
    folded.pendingDisposerIds.length > 0
  ) {
    fail('LEARNING_TRAJECTORY_ACTIVE');
  }
  if (terminal.occurredAtMs > nowMs || nowMs - terminal.occurredAtMs > freshnessHorizonMs) {
    fail('LEARNING_TRAJECTORY_STALE');
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].occurredAtMs < events[index - 1].occurredAtMs) {
      fail('LEARNING_TRAJECTORY_CORRUPT');
    }
  }
  const finalizationStarts = events.filter(({ kind }) => kind === 'finalization.started');
  const receipt = events.find((event) => event.eventId === terminal.payload.receiptEventId);
  if (
    finalizationStarts.length !== 1 ||
    receipt?.kind !== 'finalization.receipt' ||
    receipt.payload.status !== 'complete' ||
    receipt.payload.quiescence !== 'confirmed' ||
    receipt.payload.unresolvedOperationCount !== 0 ||
    receipt.payload.unresolvedScopeCount !== 0 ||
    receipt.payload.unresolvedDisposerCount !== 0 ||
    !terminal.causalEventIds.includes(receipt.eventId) ||
    finalizationStarts[0].sequence >= receipt.sequence ||
    receipt.sequence >= terminal.sequence
  ) {
    fail('LEARNING_TRAJECTORY_ACTIVE');
  }
  const hashable = {
    schemaVersion: SANITIZED_TRAJECTORY_SUMMARY_SCHEMA_VERSION,
    workspaceId: opened.payload.workspaceId,
    sessionId: opened.payload.sessionId,
    ledgerId: ledger.ledgerId,
    origin: opened.payload.origin,
    sourceAuthority: deriveSourceAuthority(opened.payload.origin),
    startedAt: opened.occurredAtMs,
    terminalAt: terminal.occurredAtMs,
    ledgerHead: { sequence: observed.sequence, sha256: observed.hash },
    terminalOutcome: terminal.payload.outcome,
    quiescence: terminal.payload.quiescence,
    counters: {
      eventCount: events.length,
      recoveredCount: folded.recoveredCount,
      scopeCount: events.filter(({ kind }) => kind === 'scope.opened').length,
      operationCount: events.filter(({ kind }) => kind === 'operation.started').length,
      disposerCount: events.filter(({ kind }) => kind === 'disposer.registered').length,
      cancellationCount: events.filter(({ kind }) => kind === 'cancellation.requested').length,
      finalizationReceiptCount: folded.finalizationReceiptCount,
    },
  };
  return freeze(
    parseSanitizedTrajectorySummary({
      ...hashable,
      summarySha256: hashLearningFoundryPayload(hashable),
    }),
  );
}

const ApplicabilitySchema = z
  .object({
    appliesTo: z.array(SafeIdSchema).min(1).max(MAX_ITEMS),
    excludes: z.array(SafeIdSchema).max(MAX_ITEMS),
  })
  .strict();

const TrajectoryClusterInputSchema = z
  .object({
    clusterKey: HashSchema,
    trajectorySummarySha256s: z.array(HashSchema).min(1).max(MAX_ITEMS),
    workspaceIds: z.array(SafeIdSchema).min(1).max(MAX_ITEMS),
    origins: z.array(SafeIdSchema).min(1).max(MAX_ITEMS),
    sourceAuthorities: z.array(SourceAuthoritySchema).min(1).max(3),
    productScope: SafeIdSchema,
    rootCauseSha256: HashSchema,
    correctionSha256: HashSchema,
    applicabilitySha256: HashSchema,
  })
  .strict();
export const TrajectoryClusterSchema = TrajectoryClusterInputSchema.extend({
  schemaVersion: z.literal(TRAJECTORY_CLUSTER_SCHEMA_VERSION),
  clusterSha256: HashSchema,
}).strict();
export type TrajectoryCluster = z.infer<typeof TrajectoryClusterSchema>;

function clusterKeyMaterial(value: z.infer<typeof TrajectoryClusterInputSchema>) {
  return {
    trajectorySummarySha256s: value.trajectorySummarySha256s,
    workspaceIds: value.workspaceIds,
    origins: value.origins,
    sourceAuthorities: value.sourceAuthorities,
    productScope: value.productScope,
    rootCauseSha256: value.rootCauseSha256,
    correctionSha256: value.correctionSha256,
    applicabilitySha256: value.applicabilitySha256,
  };
}

export function parseTrajectoryCluster(value: unknown): TrajectoryCluster {
  const parsed = parseWith(TrajectoryClusterSchema, value);
  if (
    !exact(parsed.trajectorySummarySha256s, sortedUnique(parsed.trajectorySummarySha256s)) ||
    !exact(parsed.workspaceIds, sortedUnique(parsed.workspaceIds)) ||
    !exact(parsed.origins, sortedUnique(parsed.origins)) ||
    !exact(parsed.sourceAuthorities, sortedUnique(parsed.sourceAuthorities)) ||
    parsed.clusterKey !== hashLearningFoundryPayload(clusterKeyMaterial(parsed)) ||
    parsed.clusterSha256 !== hashLearningFoundryPayload(without(parsed, 'clusterSha256'))
  ) {
    fail('LEARNING_HASH_INVALID');
  }
  return parsed;
}

export interface TrajectoryClusterDimensions {
  rootCause: string;
  correction: string;
  applicability: { appliesTo: string[]; excludes: string[] };
  productScope: string;
}

function normalizeSemanticText(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) fail('LEARNING_MALFORMED');
  return normalized;
}

function canonicalApplicability(value: { appliesTo: string[]; excludes: string[] }) {
  const parsed = parseWith(ApplicabilitySchema, value);
  const result = {
    appliesTo: sortedUnique(parsed.appliesTo),
    excludes: sortedUnique(parsed.excludes),
  };
  if (result.appliesTo.some((entry) => result.excludes.includes(entry))) fail('LEARNING_MALFORMED');
  return result;
}

export function clusterAndDedupeTrajectorySummaries(
  input: readonly unknown[],
  dimensions: TrajectoryClusterDimensions,
): ReadonlyArray<Readonly<TrajectoryCluster>> {
  if (input.length < 1 || input.length > MAX_ITEMS) fail('LEARNING_SIZE_LIMIT');
  const rootCause = normalizeSemanticText(
    parseWith(z.string().min(1).max(1024), dimensions.rootCause),
  );
  const correction = normalizeSemanticText(
    parseWith(z.string().min(1).max(2048), dimensions.correction),
  );
  const productScope = parseWith(SafeIdSchema, dimensions.productScope);
  const applicability = canonicalApplicability(dimensions.applicability);
  const unique = new Map<string, SanitizedTrajectorySummary>();
  for (const item of input) {
    const summary = parseSanitizedTrajectorySummary(item);
    unique.set(summary.summarySha256, summary);
  }
  const summaries = [...unique.values()];
  const value = {
    trajectorySummarySha256s: summaries.map(({ summarySha256 }) => summarySha256).sort(compare),
    workspaceIds: sortedUnique([...new Set(summaries.map(({ workspaceId }) => workspaceId))]),
    origins: sortedUnique([...new Set(summaries.map(({ origin }) => origin))]),
    sourceAuthorities: sortedUnique([
      ...new Set(summaries.map(({ sourceAuthority }) => sourceAuthority)),
    ]),
    productScope,
    rootCauseSha256: hashLearningFoundryPayload({ rootCause }),
    correctionSha256: hashLearningFoundryPayload({ correction }),
    applicabilitySha256: hashLearningFoundryPayload(applicability),
  };
  const clusterKey = hashLearningFoundryPayload(clusterKeyMaterial({ ...value, clusterKey: '' }));
  const hashable = { schemaVersion: TRAJECTORY_CLUSTER_SCHEMA_VERSION, clusterKey, ...value };
  return freeze([
    parseTrajectoryCluster({
      ...hashable,
      clusterSha256: hashLearningFoundryPayload(hashable),
    }),
  ]);
}

const CandidateLessonInputSchema = z
  .object({
    cluster: TrajectoryClusterSchema,
    rootCause: z.string().min(1).max(1024),
    correction: z.string().min(1).max(2048),
    applicability: ApplicabilitySchema,
    productScope: SafeIdSchema,
    sourceVerifierSha256s: z.array(HashSchema).min(1).max(MAX_ITEMS),
    usefulCount: CountSchema,
    harmfulCount: CountSchema,
    baseRegistryId: SafeIdSchema,
    baseRegistryRevision: VersionSchema,
    baseRegistrySha256: HashSchema,
    baseIntelligenceVersion: VersionSchema,
    baseIntelligenceSha256: HashSchema,
  })
  .strict();
export const CandidateLessonSchema = CandidateLessonInputSchema.extend({
  schemaVersion: z.literal(CANDIDATE_LESSON_SCHEMA_VERSION),
  semanticLessonSha256: HashSchema,
  candidateSha256: HashSchema,
}).strict();
export type CandidateLessonInput = z.input<typeof CandidateLessonInputSchema>;
export type CandidateLesson = z.infer<typeof CandidateLessonSchema>;

function canonicalCandidate(input: CandidateLessonInput) {
  const cluster = parseTrajectoryCluster(input.cluster);
  const applicability = canonicalApplicability(input.applicability);
  const rootCause = normalizeSemanticText(input.rootCause);
  const correction = normalizeSemanticText(input.correction);
  if (
    cluster.rootCauseSha256 !== hashLearningFoundryPayload({ rootCause }) ||
    cluster.correctionSha256 !== hashLearningFoundryPayload({ correction }) ||
    cluster.applicabilitySha256 !== hashLearningFoundryPayload(applicability) ||
    cluster.productScope !== input.productScope
  ) {
    fail('LEARNING_HASH_INVALID');
  }
  return {
    ...input,
    cluster,
    rootCause,
    correction,
    applicability,
    sourceVerifierSha256s: sortedUnique(input.sourceVerifierSha256s),
  };
}

function semanticLessonHash(value: ReturnType<typeof canonicalCandidate>): string {
  return hashLearningFoundryPayload({
    schemaVersion: 'semantic-lesson/v1',
    rootCause: value.rootCause,
    correction: value.correction,
    applicability: value.applicability,
    productScope: value.productScope,
    workspaceIds: value.cluster.workspaceIds,
    origins: value.cluster.origins,
    sourceAuthorities: value.cluster.sourceAuthorities,
    sourceVerifierSha256s: value.sourceVerifierSha256s,
  });
}

export function createCandidateLesson(input: CandidateLessonInput): Readonly<CandidateLesson> {
  const value = canonicalCandidate(parseWith(CandidateLessonInputSchema, input));
  const hashable = {
    schemaVersion: CANDIDATE_LESSON_SCHEMA_VERSION,
    ...value,
    semanticLessonSha256: semanticLessonHash(value),
  };
  return freeze(
    parseCandidateLesson({ ...hashable, candidateSha256: hashLearningFoundryPayload(hashable) }),
  );
}

export function parseCandidateLesson(value: unknown): CandidateLesson {
  const parsed = parseWith(CandidateLessonSchema, value);
  const canonical = canonicalCandidate(parsed);
  if (
    !exact(parsed, { ...parsed, ...canonical }) ||
    parsed.semanticLessonSha256 !== semanticLessonHash(canonical) ||
    parsed.candidateSha256 !== hashLearningFoundryPayload(without(parsed, 'candidateSha256'))
  ) {
    fail('LEARNING_HASH_INVALID');
  }
  return parsed;
}

export function incrementCandidateLessonCounters(
  candidate: unknown,
  delta: { useful: number; harmful: number },
): Readonly<CandidateLesson> {
  const value = parseCandidateLesson(candidate);
  for (const count of [delta.useful, delta.harmful]) {
    if (!Number.isSafeInteger(count) || count < 0) fail('LEARNING_MALFORMED');
  }
  const input = without(
    without(without(value, 'schemaVersion'), 'semanticLessonSha256'),
    'candidateSha256',
  ) as unknown as CandidateLessonInput;
  return createCandidateLesson({
    ...input,
    usefulCount: value.usefulCount + delta.useful,
    harmfulCount: value.harmfulCount + delta.harmful,
  } as unknown as CandidateLessonInput);
}

const ForgeBenchPromotionProjectionInputSchema = z
  .object({
    comparisonSha256: HashSchema,
    suiteSha256: HashSchema,
    baselineReportSha256: HashSchema,
    candidateReportSha256: HashSchema,
    evidenceAuthority: AuthoritySchema,
    thresholdsVerified: z.boolean(),
    promotionEligible: z.boolean(),
    protectedSafetyPreserved: z.boolean(),
    protectedFalseSuccessPreserved: z.boolean(),
    outcomeDelta: z.number().finite().min(-1).max(1),
    nonRegressionSummarySha256: HashSchema,
    verifierId: SafeIdSchema,
    verifierDigest: HashSchema,
  })
  .strict();
export const ForgeBenchPromotionProjectionSchema = ForgeBenchPromotionProjectionInputSchema.extend({
  schemaVersion: z.literal(FORGE_BENCH_PROMOTION_PROJECTION_SCHEMA_VERSION),
  projectionSha256: HashSchema,
}).strict();
export type ForgeBenchPromotionProjectionInput = z.input<
  typeof ForgeBenchPromotionProjectionInputSchema
>;
export type ForgeBenchPromotionProjection = z.infer<typeof ForgeBenchPromotionProjectionSchema>;

export function createForgeBenchPromotionProjection(
  input: ForgeBenchPromotionProjectionInput,
): Readonly<ForgeBenchPromotionProjection> {
  const value = parseWith(ForgeBenchPromotionProjectionInputSchema, input);
  const hashable = { schemaVersion: FORGE_BENCH_PROMOTION_PROJECTION_SCHEMA_VERSION, ...value };
  return freeze(
    parseForgeBenchPromotionProjection({
      ...hashable,
      projectionSha256: hashLearningFoundryPayload(hashable),
    }),
  );
}

export function parseForgeBenchPromotionProjection(input: unknown): ForgeBenchPromotionProjection {
  const value = parseWith(ForgeBenchPromotionProjectionSchema, input);
  if (value.projectionSha256 !== hashLearningFoundryPayload(without(value, 'projectionSha256'))) {
    fail('LEARNING_HASH_INVALID');
  }
  return value;
}

const OfflineReplayReceiptInputSchema = z
  .object({
    registryId: SafeIdSchema,
    candidateSha256: HashSchema,
    comparisonSha256: HashSchema,
    suiteSha256: HashSchema,
    baselineReportSha256: HashSchema,
    candidateReportSha256: HashSchema,
    projectionSha256: HashSchema,
    evidenceAuthority: AuthoritySchema,
  })
  .strict();
export const OfflineReplayReceiptSchema = OfflineReplayReceiptInputSchema.extend({
  schemaVersion: z.literal(OFFLINE_REPLAY_RECEIPT_SCHEMA_VERSION),
  receiptSha256: HashSchema,
}).strict();
export type OfflineReplayReceipt = z.infer<typeof OfflineReplayReceiptSchema>;

export function createOfflineReplayReceipt(input: {
  candidate: unknown;
  projection: unknown;
}): Readonly<OfflineReplayReceipt> {
  const candidate = parseCandidateLesson(input.candidate);
  const projection = parseForgeBenchPromotionProjection(input.projection);
  const hashable = {
    schemaVersion: OFFLINE_REPLAY_RECEIPT_SCHEMA_VERSION,
    registryId: candidate.baseRegistryId,
    candidateSha256: candidate.candidateSha256,
    comparisonSha256: projection.comparisonSha256,
    suiteSha256: projection.suiteSha256,
    baselineReportSha256: projection.baselineReportSha256,
    candidateReportSha256: projection.candidateReportSha256,
    projectionSha256: projection.projectionSha256,
    evidenceAuthority: projection.evidenceAuthority,
  };
  return freeze(
    parseOfflineReplayReceipt({ ...hashable, receiptSha256: hashLearningFoundryPayload(hashable) }),
  );
}

export function parseOfflineReplayReceipt(input: unknown): OfflineReplayReceipt {
  const value = parseWith(OfflineReplayReceiptSchema, input);
  if (value.receiptSha256 !== hashLearningFoundryPayload(without(value, 'receiptSha256'))) {
    fail('LEARNING_HASH_INVALID');
  }
  return value;
}

const IndependentReviewReceiptInputSchema = z
  .object({
    reviewLevel: z.literal('review-2'),
    reviewerId: SafeIdSchema,
    implementerId: SafeIdSchema,
    candidateSha256: HashSchema,
    comparisonSha256: HashSchema,
    protectedSafetyPreserved: z.boolean(),
    protectedFalseSuccessPreserved: z.boolean(),
    status: z.enum(['independent-approved', 'rejected']),
  })
  .strict();
export const IndependentReviewReceiptSchema = IndependentReviewReceiptInputSchema.extend({
  schemaVersion: z.literal(INDEPENDENT_REVIEW_RECEIPT_SCHEMA_VERSION),
  receiptSha256: HashSchema,
}).strict();
export type IndependentReviewReceiptInput = z.input<typeof IndependentReviewReceiptInputSchema>;
export type IndependentReviewReceipt = z.infer<typeof IndependentReviewReceiptSchema>;

export function createIndependentReviewReceipt(
  input: IndependentReviewReceiptInput,
): Readonly<IndependentReviewReceipt> {
  const value = parseWith(IndependentReviewReceiptInputSchema, input);
  if (
    value.reviewerId !== value.reviewerId.toLowerCase() ||
    value.reviewerId === value.implementerId
  ) {
    fail('LEARNING_SELF_REVIEW');
  }
  const hashable = { schemaVersion: INDEPENDENT_REVIEW_RECEIPT_SCHEMA_VERSION, ...value };
  return freeze(
    parseIndependentReviewReceipt({
      ...hashable,
      receiptSha256: hashLearningFoundryPayload(hashable),
    }),
  );
}

export function parseIndependentReviewReceipt(input: unknown): IndependentReviewReceipt {
  const value = parseWith(IndependentReviewReceiptSchema, input);
  if (
    value.reviewerId !== value.reviewerId.toLowerCase() ||
    value.implementerId !== value.implementerId.toLowerCase() ||
    value.reviewerId === value.implementerId ||
    value.receiptSha256 !== hashLearningFoundryPayload(without(value, 'receiptSha256'))
  ) {
    fail(
      value.reviewerId === value.implementerId ? 'LEARNING_SELF_REVIEW' : 'LEARNING_HASH_INVALID',
    );
  }
  return value;
}

const HostCapabilityInputSchema = z
  .object({
    authority: z.literal('test-only'),
    target: z.literal('local-test-only'),
    registryId: SafeIdSchema,
    issuerId: SafeIdSchema,
    verifierId: SafeIdSchema,
  })
  .strict();
const LocalTestHostCapabilityInputSchema = HostCapabilityInputSchema.pick({
  registryId: true,
  issuerId: true,
  verifierId: true,
}).strict();
export type TrustedLearningHostCapabilityInput = z.infer<typeof HostCapabilityInputSchema>;
export type LocalTestLearningHostCapabilityInput = z.infer<
  typeof LocalTestHostCapabilityInputSchema
>;
export interface TrustedLearningHostCapability extends TrustedLearningHostCapabilityInput {
  readonly schemaVersion: typeof TRUSTED_LEARNING_HOST_CAPABILITY_SCHEMA_VERSION;
}
const TRUSTED_HOST_CAPABILITIES = new WeakSet<object>();

async function exactAsyncVerification<T>(
  verifier: (value: T) => Promise<T | false>,
  value: T,
): Promise<boolean> {
  try {
    const pending = verifier(clone(value));
    if (!pending || typeof (pending as PromiseLike<unknown>).then !== 'function') return false;
    const verified = await pending;
    return verified !== false && exact(verified, value);
  } catch {
    return false;
  }
}

export async function issueLocalTestLearningHostCapability(
  input: LocalTestLearningHostCapabilityInput,
): Promise<TrustedLearningHostCapability> {
  const local = parseWith(LocalTestHostCapabilityInputSchema, input);
  const value: TrustedLearningHostCapabilityInput = {
    ...local,
    authority: 'test-only',
    target: 'local-test-only',
  };
  const capability = Object.create(null) as TrustedLearningHostCapability;
  for (const [key, entry] of Object.entries({
    schemaVersion: TRUSTED_LEARNING_HOST_CAPABILITY_SCHEMA_VERSION,
    ...value,
  })) {
    Object.defineProperty(capability, key, { value: entry, enumerable: true, writable: false });
  }
  Object.defineProperty(capability, 'toJSON', {
    value: () => fail('LEARNING_HOST_CAPABILITY_INVALID'),
    enumerable: false,
  });
  Object.freeze(capability);
  TRUSTED_HOST_CAPABILITIES.add(capability);
  return capability;
}

const ActiveIntelligenceSchema = z
  .object({
    version: VersionSchema,
    sha256: HashSchema,
    lessonSha256s: z.array(HashSchema).max(MAX_ITEMS),
    usefulCount: CountSchema,
    harmfulCount: CountSchema,
  })
  .strict();
const PromotionHistoryInputSchema = z
  .object({
    kind: z.literal('promotion'),
    registryId: SafeIdSchema,
    revision: z.number().int().min(1).max(MAX_COUNT),
    previousHash: HashSchema.nullable(),
    packageSha256: HashSchema,
    candidateSha256: HashSchema,
    semanticLessonSha256: HashSchema,
    usefulDelta: z.number().int().min(1).max(MAX_COUNT),
    harmfulDelta: z.literal(0),
    from: ActiveIntelligenceSchema,
    to: ActiveIntelligenceSchema,
  })
  .strict();
const RollbackHistoryInputSchema = z
  .object({
    kind: z.literal('rollback'),
    registryId: SafeIdSchema,
    revision: z.number().int().min(1).max(MAX_COUNT),
    previousHash: HashSchema.nullable(),
    packageSha256: HashSchema,
    promotionPackageSha256: HashSchema,
    promotionEventHash: HashSchema,
    from: ActiveIntelligenceSchema,
    to: ActiveIntelligenceSchema,
  })
  .strict();
const PromotionHistorySchema = PromotionHistoryInputSchema.extend({
  eventHash: HashSchema,
}).strict();
const RollbackHistorySchema = RollbackHistoryInputSchema.extend({ eventHash: HashSchema }).strict();
const HistorySchema = z.discriminatedUnion('kind', [PromotionHistorySchema, RollbackHistorySchema]);
export type LearningRegistryHistoryEvent = z.infer<typeof HistorySchema>;

const LearningRegistryInputSchema = z
  .object({
    registryId: SafeIdSchema,
    revision: VersionSchema,
    active: ActiveIntelligenceSchema,
    usedCandidateSha256s: z.array(HashSchema).max(MAX_ITEMS),
    usedSemanticLessonSha256s: z.array(HashSchema).max(MAX_ITEMS),
    usedPackageSha256s: z.array(HashSchema).max(MAX_ITEMS),
    history: z.array(HistorySchema).max(MAX_ITEMS),
  })
  .strict();
export const LearningRegistrySchema = LearningRegistryInputSchema.extend({
  schemaVersion: z.literal(LEARNING_REGISTRY_SCHEMA_VERSION),
  registrySha256: HashSchema,
}).strict();
export type ActiveIntelligence = z.infer<typeof ActiveIntelligenceSchema>;
export type LearningRegistry = z.infer<typeof LearningRegistrySchema>;

function intelligenceHash(registryId: string, value: Omit<ActiveIntelligence, 'sha256'>): string {
  return hashLearningFoundryPayload({
    schemaVersion: 'learning-intelligence/v1',
    registryId,
    ...value,
  });
}

function genesisActive(registryId: string): ActiveIntelligence {
  const value = { version: 0, lessonSha256s: [] as string[], usefulCount: 0, harmfulCount: 0 };
  return { ...value, sha256: intelligenceHash(registryId, value) };
}

function sameActive(left: ActiveIntelligence, right: ActiveIntelligence): boolean {
  return exact(left, right);
}

function historyEventHash(event: LearningRegistryHistoryEvent): string {
  return hashLearningFoundryPayload(without(event, 'eventHash'));
}

function replayHistory(value: z.infer<typeof LearningRegistryInputSchema>) {
  let active = genesisActive(value.registryId);
  let previousHash: string | null = null;
  const usedCandidates = new Set<string>();
  const usedSemanticLessons = new Set<string>();
  const usedPackages = new Set<string>();
  const promotions = new Map<string, z.infer<typeof PromotionHistorySchema>>();
  const rolledBack = new Set<string>();
  for (const [index, event] of value.history.entries()) {
    if (
      event.registryId !== value.registryId ||
      event.revision !== index + 1 ||
      event.previousHash !== previousHash ||
      event.eventHash !== historyEventHash(event) ||
      usedPackages.has(event.packageSha256) ||
      !sameActive(event.from, active)
    ) {
      fail('LEARNING_REGISTRY_CORRUPT');
    }
    if (event.kind === 'promotion') {
      if (
        usedCandidates.has(event.candidateSha256) ||
        usedSemanticLessons.has(event.semanticLessonSha256)
      ) {
        fail('LEARNING_REGISTRY_CORRUPT');
      }
      const lessonSha256s = sortedUnique([...active.lessonSha256s, event.semanticLessonSha256]);
      const nextWithoutHash = {
        version: event.revision,
        lessonSha256s,
        usefulCount: active.usefulCount + event.usefulDelta,
        harmfulCount: active.harmfulCount,
      };
      const expected = {
        ...nextWithoutHash,
        sha256: intelligenceHash(value.registryId, nextWithoutHash),
      };
      if (!sameActive(event.to, expected)) fail('LEARNING_REGISTRY_CORRUPT');
      promotions.set(event.packageSha256, event);
      usedCandidates.add(event.candidateSha256);
      usedSemanticLessons.add(event.semanticLessonSha256);
    } else {
      const promotion = promotions.get(event.promotionPackageSha256);
      if (
        !promotion ||
        promotion.eventHash !== event.promotionEventHash ||
        rolledBack.has(event.promotionPackageSha256) ||
        !sameActive(active, promotion.to) ||
        !sameActive(event.to, promotion.from)
      ) {
        fail('LEARNING_REGISTRY_CORRUPT');
      }
      rolledBack.add(event.promotionPackageSha256);
    }
    usedPackages.add(event.packageSha256);
    active = event.to;
    previousHash = event.eventHash;
  }
  return {
    active,
    usedCandidateSha256s: [...usedCandidates].sort(compare),
    usedSemanticLessonSha256s: [...usedSemanticLessons].sort(compare),
    usedPackageSha256s: [...usedPackages].sort(compare),
  };
}

export function parseLearningRegistry(input: unknown): LearningRegistry {
  const value = parseWith(LearningRegistrySchema, input);
  const replayed = replayHistory(value);
  if (
    value.revision !== value.history.length ||
    !sameActive(value.active, replayed.active) ||
    !exact(value.usedCandidateSha256s, replayed.usedCandidateSha256s) ||
    !exact(value.usedSemanticLessonSha256s, replayed.usedSemanticLessonSha256s) ||
    !exact(value.usedPackageSha256s, replayed.usedPackageSha256s) ||
    value.registrySha256 !== hashLearningFoundryPayload(without(value, 'registrySha256'))
  ) {
    fail('LEARNING_REGISTRY_CORRUPT');
  }
  return value;
}

function buildRegistry(input: z.input<typeof LearningRegistryInputSchema>): LearningRegistry {
  const value = parseWith(LearningRegistryInputSchema, input);
  const hashable = { schemaVersion: LEARNING_REGISTRY_SCHEMA_VERSION, ...value };
  return parseLearningRegistry({
    ...hashable,
    registrySha256: hashLearningFoundryPayload(hashable),
  });
}

export function createEmptyLearningRegistry(
  registryId = 'learning-registry-local',
): Readonly<LearningRegistry> {
  return freeze(
    buildRegistry({
      registryId,
      revision: 0,
      active: genesisActive(registryId),
      usedCandidateSha256s: [],
      usedSemanticLessonSha256s: [],
      usedPackageSha256s: [],
      history: [],
    }),
  );
}

export interface RegistryBase {
  registryId: string;
  revision: number;
  registrySha256: string;
}
export interface RegistryTransactionDecision<T> {
  next?: LearningRegistry;
  result: T;
}
export interface LearningRegistryRepository {
  readonly registryId: string;
  read(): Promise<LearningRegistry>;
  transact<T>(
    expected: RegistryBase,
    operation: (current: LearningRegistry) => Promise<RegistryTransactionDecision<T>>,
  ): Promise<T>;
}

interface SharedRegistryCell {
  state: LearningRegistry;
  tail: Promise<void>;
}
const SHARED_REGISTRY_CELLS = new Map<string, SharedRegistryCell>();

export class InMemoryLearningRegistryRepository implements LearningRegistryRepository {
  readonly registryId: string;
  private readonly cell: SharedRegistryCell;

  constructor(initial: unknown) {
    const parsed = parseLearningRegistry(initial);
    this.registryId = parsed.registryId;
    const existing = SHARED_REGISTRY_CELLS.get(parsed.registryId);
    if (existing) {
      this.cell = existing;
    } else {
      this.cell = { state: clone(parsed), tail: Promise.resolve() };
      SHARED_REGISTRY_CELLS.set(parsed.registryId, this.cell);
    }
  }

  async read(): Promise<LearningRegistry> {
    await this.cell.tail;
    return freeze(clone(this.cell.state));
  }

  async transact<T>(
    expected: RegistryBase,
    operation: (current: LearningRegistry) => Promise<RegistryTransactionDecision<T>>,
  ): Promise<T> {
    const previous = this.cell.tail;
    let release: () => void = () => undefined;
    this.cell.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = parseLearningRegistry(this.cell.state);
      if (
        expected.registryId !== this.registryId ||
        expected.revision !== current.revision ||
        expected.registrySha256 !== current.registrySha256
      ) {
        fail('LEARNING_STALE_BASE');
      }
      const decision = await operation(freeze(clone(current)));
      if (decision.next !== undefined) {
        const next = parseLearningRegistry(decision.next);
        if (next.registryId !== this.registryId || next.revision !== current.revision + 1) {
          fail('LEARNING_REGISTRY_CORRUPT');
        }
        this.cell.state = clone(next);
      }
      return decision.result;
    } finally {
      release();
    }
  }
}

const ReversiblePackageSchema = z
  .object({ applySha256: HashSchema, rollbackSha256: HashSchema })
  .strict();
const PromotionPackageInputSchema = z
  .object({
    registryId: SafeIdSchema,
    baseRegistryRevision: VersionSchema,
    baseRegistrySha256: HashSchema,
    candidateSha256: HashSchema,
    semanticLessonSha256: HashSchema,
    comparisonSha256: HashSchema,
    replayReceiptSha256: HashSchema,
    reviewReceiptSha256: HashSchema,
    prior: ActiveIntelligenceSchema,
    target: ActiveIntelligenceSchema,
    reversible: ReversiblePackageSchema,
    authority: z.enum(['production', 'local-test-only']),
  })
  .strict();
export const PromotionDeltaPackageSchema = PromotionPackageInputSchema.extend({
  schemaVersion: z.literal(LEARNING_PROMOTION_PACKAGE_SCHEMA_VERSION),
  packageSha256: HashSchema,
}).strict();
export type PromotionDeltaPackage = z.infer<typeof PromotionDeltaPackageSchema>;

const PromotionReceiptInputSchema = z
  .object({
    status: z.literal('promoted'),
    registryId: SafeIdSchema,
    authority: z.enum(['production', 'local-test-only']),
    packageSha256: HashSchema,
    candidateSha256: HashSchema,
    semanticLessonSha256: HashSchema,
    comparisonSha256: HashSchema,
    baseRegistryRevision: VersionSchema,
    baseRegistrySha256: HashSchema,
    promotedIntelligenceVersion: VersionSchema,
    promotedIntelligenceSha256: HashSchema,
    registryRevision: VersionSchema,
    registrySha256: HashSchema,
  })
  .strict();
export const PromotionReceiptSchema = PromotionReceiptInputSchema.extend({
  schemaVersion: z.literal(LEARNING_PROMOTION_RECEIPT_SCHEMA_VERSION),
  receiptSha256: HashSchema,
}).strict();
export type PromotionReceipt = z.infer<typeof PromotionReceiptSchema>;

const RollbackPackageInputSchema = z
  .object({
    registryId: SafeIdSchema,
    promotionPackageSha256: HashSchema,
    promotionEventHash: HashSchema,
    from: ActiveIntelligenceSchema,
    restore: ActiveIntelligenceSchema,
    authority: z.enum(['production', 'local-test-only']),
  })
  .strict();
export const RollbackDeltaPackageSchema = RollbackPackageInputSchema.extend({
  schemaVersion: z.literal(LEARNING_ROLLBACK_PACKAGE_SCHEMA_VERSION),
  packageSha256: HashSchema,
}).strict();
export type RollbackDeltaPackage = z.infer<typeof RollbackDeltaPackageSchema>;

const RollbackReceiptInputSchema = z
  .object({
    status: z.enum(['rolled-back', 'idempotent']),
    registryId: SafeIdSchema,
    packageSha256: HashSchema,
    promotionPackageSha256: HashSchema,
    restoredIntelligenceVersion: VersionSchema,
    restoredIntelligenceSha256: HashSchema,
    registryRevision: VersionSchema,
    registrySha256: HashSchema,
  })
  .strict();
export const RollbackReceiptSchema = RollbackReceiptInputSchema.extend({
  schemaVersion: z.literal(LEARNING_ROLLBACK_RECEIPT_SCHEMA_VERSION),
  receiptSha256: HashSchema,
}).strict();
export type RollbackReceipt = z.infer<typeof RollbackReceiptSchema>;

function buildHashed<T extends Record<string, unknown>>(
  schemaVersion: string,
  input: T,
  hashField: string,
): T & { schemaVersion: string; [key: string]: unknown } {
  const hashable = { schemaVersion, ...input };
  return { ...hashable, [hashField]: hashLearningFoundryPayload(hashable) };
}

function parseHashed<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  hashField: string,
): z.output<T> {
  const value = parseWith(schema, input);
  if (
    (value as Record<string, unknown>)[hashField] !==
    hashLearningFoundryPayload(without(value as Record<string, unknown>, hashField))
  ) {
    fail('LEARNING_HASH_INVALID');
  }
  return value;
}

export const parsePromotionDeltaPackage = (input: unknown): PromotionDeltaPackage =>
  parseHashed(PromotionDeltaPackageSchema, input, 'packageSha256');
export const parsePromotionReceipt = (input: unknown): PromotionReceipt =>
  parseHashed(PromotionReceiptSchema, input, 'receiptSha256');
export const parseRollbackDeltaPackage = (input: unknown): RollbackDeltaPackage =>
  parseHashed(RollbackDeltaPackageSchema, input, 'packageSha256');
export const parseRollbackReceipt = (input: unknown): RollbackReceipt =>
  parseHashed(RollbackReceiptSchema, input, 'receiptSha256');

export type TrustedComparisonVerifier = (
  projection: ForgeBenchPromotionProjection,
) => Promise<ForgeBenchPromotionProjection | false>;
export type IndependentReviewVerifier = (
  receipt: IndependentReviewReceipt,
) => Promise<IndependentReviewReceipt | false>;
export type LearningExecutionMode = 'running' | 'client' | 'maintenance';

export interface LearningFoundryOptions {
  mode: LearningExecutionMode;
  implementerId: string;
  freshnessHorizonMs: number;
  now?: () => number;
  repository: LearningRegistryRepository;
  hostCapability: TrustedLearningHostCapability;
  comparisonVerifier: TrustedComparisonVerifier;
  reviewVerifier: IndependentReviewVerifier;
}

function makeHistoryEvent<T extends Record<string, unknown>>(input: T): T & { eventHash: string } {
  return { ...input, eventHash: hashLearningFoundryPayload(input) };
}

export class LearningFoundry {
  private readonly mode: LearningExecutionMode;
  private readonly implementerId: string;
  private readonly freshnessHorizonMs: number;
  private readonly now: () => number;
  private readonly repository: LearningRegistryRepository;
  private readonly hostCapability: TrustedLearningHostCapability;
  private readonly comparisonVerifier: TrustedComparisonVerifier;
  private readonly reviewVerifier: IndependentReviewVerifier;

  constructor(options: LearningFoundryOptions) {
    if (
      !SafeIdSchema.safeParse(options.implementerId).success ||
      !Number.isSafeInteger(options.freshnessHorizonMs) ||
      options.freshnessHorizonMs < 1 ||
      !TRUSTED_HOST_CAPABILITIES.has(options.hostCapability) ||
      options.hostCapability.registryId !== options.repository.registryId
    ) {
      fail('LEARNING_HOST_CAPABILITY_INVALID');
    }
    this.mode = options.mode;
    this.implementerId = options.implementerId;
    this.freshnessHorizonMs = options.freshnessHorizonMs;
    this.now = options.now ?? Date.now;
    this.repository = options.repository;
    this.hostCapability = options.hostCapability;
    this.comparisonVerifier = options.comparisonVerifier;
    this.reviewVerifier = options.reviewVerifier;
    Object.freeze(this);
  }

  async summarizeTrajectory(input: {
    ledger: TrajectoryLedger;
    expectedTip: LedgerTip;
  }): Promise<Readonly<SanitizedTrajectorySummary>> {
    return summarizeLedger(input.ledger, input.expectedTip, this.now(), this.freshnessHorizonMs);
  }

  async promote(input: {
    candidate: unknown;
    replayReceipt: unknown;
    projection: unknown;
    review: unknown;
    reversible: unknown;
  }): Promise<
    Readonly<{
      status: 'promoted';
      deltaPackage: PromotionDeltaPackage;
      receipt: PromotionReceipt;
      registry: LearningRegistry;
    }>
  > {
    if (this.mode !== 'maintenance') fail('LEARNING_NOT_MAINTENANCE');
    const candidate = parseCandidateLesson(input.candidate);
    const replay = parseOfflineReplayReceipt(input.replayReceipt);
    const projection = parseForgeBenchPromotionProjection(input.projection);
    const review = parseIndependentReviewReceipt(input.review);
    const reversible = parseWith(ReversiblePackageSchema, input.reversible);
    const capability = this.hostCapability;
    const packageAuthority = 'local-test-only' as const;
    if (
      reversible.applySha256 === reversible.rollbackSha256 ||
      candidate.baseRegistryId !== capability.registryId ||
      replay.registryId !== capability.registryId
    ) {
      fail('LEARNING_REVERSIBILITY_REQUIRED');
    }
    if (
      replay.candidateSha256 !== candidate.candidateSha256 ||
      replay.comparisonSha256 !== projection.comparisonSha256 ||
      replay.suiteSha256 !== projection.suiteSha256 ||
      replay.baselineReportSha256 !== projection.baselineReportSha256 ||
      replay.candidateReportSha256 !== projection.candidateReportSha256 ||
      replay.projectionSha256 !== projection.projectionSha256
    ) {
      fail('LEARNING_HASH_INVALID');
    }
    if (
      review.implementerId !== this.implementerId ||
      review.reviewerId === this.implementerId ||
      review.candidateSha256 !== candidate.candidateSha256 ||
      review.comparisonSha256 !== projection.comparisonSha256 ||
      review.protectedSafetyPreserved !== projection.protectedSafetyPreserved ||
      review.protectedFalseSuccessPreserved !== projection.protectedFalseSuccessPreserved
    ) {
      fail('LEARNING_UNTRUSTED_REVIEW');
    }
    if (
      capability.verifierId !== projection.verifierId ||
      capability.authority !== projection.evidenceAuthority ||
      replay.evidenceAuthority !== projection.evidenceAuthority ||
      candidate.cluster.sourceAuthorities.length !== 1 ||
      candidate.cluster.sourceAuthorities[0] !== capability.authority ||
      capability.target !== 'local-test-only'
    ) {
      fail('LEARNING_HOST_CAPABILITY_INVALID');
    }
    if (!(await exactAsyncVerification(this.comparisonVerifier, projection))) {
      fail('LEARNING_UNTRUSTED_COMPARISON');
    }
    if (!(await exactAsyncVerification(this.reviewVerifier, review))) {
      fail('LEARNING_UNTRUSTED_REVIEW');
    }
    if (!projection.thresholdsVerified || !projection.promotionEligible) {
      fail('LEARNING_UNFROZEN_THRESHOLDS');
    }
    if (!projection.protectedSafetyPreserved || !projection.protectedFalseSuccessPreserved) {
      fail('LEARNING_PROTECTED_REGRESSION');
    }
    if (review.status !== 'independent-approved') fail('LEARNING_UNTRUSTED_REVIEW');
    if (candidate.harmfulCount > 0) fail('LEARNING_HARMFUL_CANDIDATE');
    if (candidate.usefulCount < 1 || projection.outcomeDelta <= 0) {
      fail('LEARNING_NO_USEFUL_GAIN');
    }

    const beforeTransaction = await this.repository.read();
    if (
      beforeTransaction.usedCandidateSha256s.includes(candidate.candidateSha256) ||
      beforeTransaction.usedSemanticLessonSha256s.includes(candidate.semanticLessonSha256)
    ) {
      fail('LEARNING_REPLAY_REJECTED');
    }

    const expected = {
      registryId: candidate.baseRegistryId,
      revision: candidate.baseRegistryRevision,
      registrySha256: candidate.baseRegistrySha256,
    };
    return this.repository.transact(expected, async (current) => {
      if (
        current.active.version !== candidate.baseIntelligenceVersion ||
        current.active.sha256 !== candidate.baseIntelligenceSha256 ||
        current.usedCandidateSha256s.includes(candidate.candidateSha256) ||
        current.usedSemanticLessonSha256s.includes(candidate.semanticLessonSha256)
      ) {
        fail(
          current.usedCandidateSha256s.includes(candidate.candidateSha256) ||
            current.usedSemanticLessonSha256s.includes(candidate.semanticLessonSha256)
            ? 'LEARNING_REPLAY_REJECTED'
            : 'LEARNING_STALE_BASE',
        );
      }
      const nextWithoutHash = {
        version: current.revision + 1,
        lessonSha256s: sortedUnique([
          ...current.active.lessonSha256s,
          candidate.semanticLessonSha256,
        ]),
        usefulCount: current.active.usefulCount + candidate.usefulCount,
        harmfulCount: current.active.harmfulCount,
      };
      const target: ActiveIntelligence = {
        ...nextWithoutHash,
        sha256: intelligenceHash(current.registryId, nextWithoutHash),
      };
      const deltaPackage = parsePromotionDeltaPackage(
        buildHashed(
          LEARNING_PROMOTION_PACKAGE_SCHEMA_VERSION,
          {
            registryId: current.registryId,
            baseRegistryRevision: current.revision,
            baseRegistrySha256: current.registrySha256,
            candidateSha256: candidate.candidateSha256,
            semanticLessonSha256: candidate.semanticLessonSha256,
            comparisonSha256: projection.comparisonSha256,
            replayReceiptSha256: replay.receiptSha256,
            reviewReceiptSha256: review.receiptSha256,
            prior: current.active,
            target,
            reversible,
            authority: packageAuthority,
          },
          'packageSha256',
        ),
      );
      if (current.usedPackageSha256s.includes(deltaPackage.packageSha256)) {
        fail('LEARNING_REPLAY_REJECTED');
      }
      const previousHash = current.history.at(-1)?.eventHash ?? null;
      const history = makeHistoryEvent({
        kind: 'promotion' as const,
        registryId: current.registryId,
        revision: current.revision + 1,
        previousHash,
        packageSha256: deltaPackage.packageSha256,
        candidateSha256: candidate.candidateSha256,
        semanticLessonSha256: candidate.semanticLessonSha256,
        usefulDelta: candidate.usefulCount,
        harmfulDelta: 0 as const,
        from: current.active,
        to: target,
      });
      const next = buildRegistry({
        registryId: current.registryId,
        revision: current.revision + 1,
        active: target,
        usedCandidateSha256s: sortedUnique([
          ...current.usedCandidateSha256s,
          candidate.candidateSha256,
        ]),
        usedSemanticLessonSha256s: sortedUnique([
          ...current.usedSemanticLessonSha256s,
          candidate.semanticLessonSha256,
        ]),
        usedPackageSha256s: sortedUnique([
          ...current.usedPackageSha256s,
          deltaPackage.packageSha256,
        ]),
        history: [...current.history, history],
      });
      const receipt = parsePromotionReceipt(
        buildHashed(
          LEARNING_PROMOTION_RECEIPT_SCHEMA_VERSION,
          {
            status: 'promoted' as const,
            registryId: current.registryId,
            authority: packageAuthority,
            packageSha256: deltaPackage.packageSha256,
            candidateSha256: candidate.candidateSha256,
            semanticLessonSha256: candidate.semanticLessonSha256,
            comparisonSha256: projection.comparisonSha256,
            baseRegistryRevision: current.revision,
            baseRegistrySha256: current.registrySha256,
            promotedIntelligenceVersion: target.version,
            promotedIntelligenceSha256: target.sha256,
            registryRevision: next.revision,
            registrySha256: next.registrySha256,
          },
          'receiptSha256',
        ),
      );
      return {
        next,
        result: freeze({ status: 'promoted' as const, deltaPackage, receipt, registry: next }),
      };
    });
  }

  async rollback(input: { promotionPackage: unknown }): Promise<
    Readonly<{
      status: 'rolled-back' | 'idempotent';
      deltaPackage: RollbackDeltaPackage;
      receipt: RollbackReceipt;
      registry: LearningRegistry;
    }>
  > {
    if (this.mode !== 'maintenance') fail('LEARNING_NOT_MAINTENANCE');
    const promotion = parsePromotionDeltaPackage(input.promotionPackage);
    const capability = this.hostCapability;
    const expectedAuthority = 'local-test-only' as const;
    if (
      promotion.registryId !== this.repository.registryId ||
      promotion.registryId !== capability.registryId ||
      promotion.authority !== expectedAuthority
    ) {
      fail('LEARNING_ROLLBACK_INVALID');
    }
    const snapshot = await this.repository.read();
    return this.repository.transact<
      Readonly<{
        status: 'rolled-back' | 'idempotent';
        deltaPackage: RollbackDeltaPackage;
        receipt: RollbackReceipt;
        registry: LearningRegistry;
      }>
    >(
      {
        registryId: snapshot.registryId,
        revision: snapshot.revision,
        registrySha256: snapshot.registrySha256,
      },
      async (current) => {
        const promotionEvent = current.history.find(
          (event) => event.kind === 'promotion' && event.packageSha256 === promotion.packageSha256,
        );
        const existing = current.history.find(
          (event) =>
            event.kind === 'rollback' && event.promotionPackageSha256 === promotion.packageSha256,
        );
        if (promotionEvent?.kind !== 'promotion') fail('LEARNING_ROLLBACK_INVALID');
        const rollbackPackage = parseRollbackDeltaPackage(
          buildHashed(
            LEARNING_ROLLBACK_PACKAGE_SCHEMA_VERSION,
            {
              registryId: current.registryId,
              promotionPackageSha256: promotion.packageSha256,
              promotionEventHash: promotionEvent.eventHash,
              from: promotion.target,
              restore: promotion.prior,
              authority: expectedAuthority,
            },
            'packageSha256',
          ),
        );
        if (existing?.kind === 'rollback') {
          if (!sameActive(current.active, promotion.prior)) fail('LEARNING_ROLLBACK_INVALID');
          const receipt = parseRollbackReceipt(
            buildHashed(
              LEARNING_ROLLBACK_RECEIPT_SCHEMA_VERSION,
              {
                status: 'idempotent' as const,
                registryId: current.registryId,
                packageSha256: rollbackPackage.packageSha256,
                promotionPackageSha256: promotion.packageSha256,
                restoredIntelligenceVersion: current.active.version,
                restoredIntelligenceSha256: current.active.sha256,
                registryRevision: current.revision,
                registrySha256: current.registrySha256,
              },
              'receiptSha256',
            ),
          );
          return {
            result: freeze({
              status: 'idempotent' as const,
              deltaPackage: rollbackPackage,
              receipt,
              registry: current,
            }),
          };
        }
        if (
          !sameActive(current.active, promotion.target) ||
          !sameActive(promotionEvent.from, promotion.prior) ||
          !sameActive(promotionEvent.to, promotion.target) ||
          current.usedPackageSha256s.includes(rollbackPackage.packageSha256)
        ) {
          fail('LEARNING_ROLLBACK_INVALID');
        }
        const history = makeHistoryEvent({
          kind: 'rollback' as const,
          registryId: current.registryId,
          revision: current.revision + 1,
          previousHash: current.history.at(-1)?.eventHash ?? null,
          packageSha256: rollbackPackage.packageSha256,
          promotionPackageSha256: promotion.packageSha256,
          promotionEventHash: promotionEvent.eventHash,
          from: current.active,
          to: promotion.prior,
        });
        const next = buildRegistry({
          registryId: current.registryId,
          revision: current.revision + 1,
          active: promotion.prior,
          usedCandidateSha256s: current.usedCandidateSha256s,
          usedSemanticLessonSha256s: current.usedSemanticLessonSha256s,
          usedPackageSha256s: sortedUnique([
            ...current.usedPackageSha256s,
            rollbackPackage.packageSha256,
          ]),
          history: [...current.history, history],
        });
        const receipt = parseRollbackReceipt(
          buildHashed(
            LEARNING_ROLLBACK_RECEIPT_SCHEMA_VERSION,
            {
              status: 'rolled-back' as const,
              registryId: current.registryId,
              packageSha256: rollbackPackage.packageSha256,
              promotionPackageSha256: promotion.packageSha256,
              restoredIntelligenceVersion: promotion.prior.version,
              restoredIntelligenceSha256: promotion.prior.sha256,
              registryRevision: next.revision,
              registrySha256: next.registrySha256,
            },
            'receiptSha256',
          ),
        );
        return {
          next,
          result: freeze({
            status: 'rolled-back' as const,
            deltaPackage: rollbackPackage,
            receipt,
            registry: next,
          }),
        };
      },
    );
  }
}
