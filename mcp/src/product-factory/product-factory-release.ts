import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  EnvironmentAciDescriptor,
  EnvironmentScenario,
  EnvironmentScenarioReceipt,
  parseEnvironmentAciDescriptor,
  parseEnvironmentScenario,
  parseEnvironmentScenarioReceipt,
} from './environment-aci.js';
import { ProductIntent, parseProductIntent } from './product-intent.js';
import {
  ProductOutcomeContract,
  validateProductOutcomeContractReferences,
} from './product-outcome-contract.js';
import {
  ProductOutcomeResultReceipt,
  parseProductOutcomeResultReceipt,
} from './product-outcome-runner.js';
import {
  ProductOutcomeJudgment,
  ProductOutcomeSpecialistReceipt,
  parseProductOutcomeJudgment,
  parseProductOutcomeSpecialistReceipt,
} from './product-outcome-judge.js';
import {
  CANDIDATE_LESSON_SCHEMA_VERSION,
  FORGE_BENCH_PROMOTION_PROJECTION_SCHEMA_VERSION,
  INDEPENDENT_REVIEW_RECEIPT_SCHEMA_VERSION,
  LEARNING_REGISTRY_SCHEMA_VERSION,
  OFFLINE_REPLAY_RECEIPT_SCHEMA_VERSION,
  CandidateLesson,
  ForgeBenchPromotionProjection,
  IndependentReviewReceipt,
  LearningRegistry,
  OfflineReplayReceipt,
  PromotionDeltaPackage,
  PromotionReceipt,
  RollbackDeltaPackage,
  RollbackReceipt,
  hashLearningFoundryPayload,
  parseCandidateLesson,
  parseForgeBenchPromotionProjection,
  parseIndependentReviewReceipt,
  parseLearningRegistry,
  parseOfflineReplayReceipt,
  parsePromotionDeltaPackage,
  parsePromotionReceipt,
  parseRollbackDeltaPackage,
  parseRollbackReceipt,
} from './learning-foundry.js';
import {
  DisposableEnvironmentReceipt,
  parseDisposableEnvironmentReceipt,
} from './disposable-environment.js';

export const PRODUCT_FACTORY_RELEASE_SCHEMA_VERSION = 'product-factory-release/v2' as const;
export const PRODUCT_FACTORY_REFERENCE_SCHEMA_VERSION = 'product-factory-reference/v2' as const;
export const PRODUCT_FACTORY_ATTEMPT_SCHEMA_VERSION = 'product-factory-attempt/v2' as const;
export const PRODUCT_FACTORY_DECISION_SCHEMA_VERSION =
  'product-factory-release-decision/v2' as const;
export const PRODUCT_FACTORY_RELEASE_MAX_BYTES = 1024 * 1024;
export const PRODUCT_FACTORY_RELEASE_MAX_DEPTH = 32;

const LOCKED_INTENT_SCHEMA_VERSION = 'locked-intent-projection/v2' as const;
const REVISION_DELTA_SCHEMA_VERSION = 'release-revision-delta/v2' as const;
const FORGEBENCH_REFERENCE_SCHEMA_VERSION = 'release-forgebench-reference/v2' as const;
const LEARNING_EVIDENCE_SCHEMA_VERSION = 'release-learning-evidence/v2' as const;
const ISOLATION_EVIDENCE_SCHEMA_VERSION = 'release-isolation-evidence/v2' as const;
const GATE_REFERENCE_SCHEMA_VERSION = 'release-gate-reference/v2' as const;
const MAX_ATTEMPTS_PER_LANE = 16;
const MAX_LIFECYCLE_RECEIPTS = 16;
const MAX_SPECIALIST_RECEIPTS = 16;
const MAX_LEARNING_EVENTS = 128;
const MAX_GRAPH_NODES = 60_000;
const MAX_REPLAY_ENTRIES = 2_048;
const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_REFERENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CANONICAL_PARSE_DEADLINE_MS = 2_000;

const LANES = ['web', 'mobile', 'game'] as const;
const EXPECTED_KINDS = { web: 'web', mobile: 'android', game: 'unity' } as const;
const GATE_CATEGORIES = [
  'engineering',
  'security',
  'visual',
  'runtime',
  'release',
  'rollback',
] as const;
const SECURITY_PROBES = [
  'path-containment',
  'secret-access',
  'private-egress',
  'stale-snapshot',
  'resource-quota',
] as const;
const SECURITY_EXPECTATIONS = {
  'path-containment': { operation: 'execute', status: 'FAIL', code: 'PATH_NOT_CONTAINED' },
  'secret-access': { operation: 'execute', status: 'FAIL', code: 'SECRET_HANDLE_NOT_ALLOWED' },
  'private-egress': { operation: 'execute', status: 'FAIL', code: 'EGRESS_PRIVATE_DESTINATION' },
  'stale-snapshot': { operation: 'restore', status: 'FAIL', code: 'SNAPSHOT_STALE' },
  'resource-quota': { operation: 'execute', status: 'BLOCKED', code: 'RESOURCE_QUOTA_EXCEEDED' },
} as const;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SECRET_TEXT =
  /(?:\bghp_[a-z0-9]{20,}|\bgithub_pat_[a-z0-9_]{20,}|\bglpat-[a-z0-9_-]{16,}|\bsk-[a-z0-9]{16,}|\bAKIA[A-Z0-9]{16}\b|bearer\s+[a-z0-9._~+/-]{12,}|private[-_ ]?key|api[-_ ]?key|access[-_ ]?key|secret[-_ ]?key|password|credential|-----BEGIN)/i;

export type ProductFactoryLane = (typeof LANES)[number];
export type ProductFactoryReleaseStatus = 'FAIL' | 'UNVERIFIED' | 'REQUIRES_HUMAN_REVIEW';
export type ProductFactoryReleaseErrorCode =
  | 'RELEASE_SIZE_LIMIT'
  | 'RELEASE_DEPTH_LIMIT'
  | 'RELEASE_MALFORMED'
  | 'RELEASE_DIGEST_INVALID'
  | 'RELEASE_BINDING_INVALID'
  | 'RELEASE_DUPLICATE_EVIDENCE'
  | 'RELEASE_REPLAY_REJECTED'
  | 'RELEASE_REPLAY_CAPACITY'
  | 'RELEASE_EVALUATION_DEADLINE';

export class ProductFactoryReleaseValidationError extends Error {
  constructor(readonly code: ProductFactoryReleaseErrorCode) {
    super(code);
    this.name = 'ProductFactoryReleaseValidationError';
  }
}

const fail = (code: ProductFactoryReleaseErrorCode): never => {
  throw new ProductFactoryReleaseValidationError(code);
};

function assertStructuralBounds(value: unknown): void {
  let nodes = 0;
  const active = new WeakSet<object>();
  const visit = (entry: unknown, depth: number): void => {
    if (depth > PRODUCT_FACTORY_RELEASE_MAX_DEPTH) fail('RELEASE_DEPTH_LIMIT');
    nodes += 1;
    if (nodes > MAX_GRAPH_NODES) fail('RELEASE_SIZE_LIMIT');
    if (
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'boolean' ||
      typeof entry === 'number'
    ) {
      if (typeof entry === 'number' && !Number.isFinite(entry)) fail('RELEASE_MALFORMED');
      return;
    }
    if (typeof entry !== 'object') fail('RELEASE_MALFORMED');
    const objectEntry = entry as object;
    if (active.has(objectEntry)) fail('RELEASE_MALFORMED');
    active.add(objectEntry);
    if (Array.isArray(objectEntry)) {
      for (const item of objectEntry) visit(item, depth + 1);
      active.delete(objectEntry);
      return;
    }
    const prototype = Object.getPrototypeOf(objectEntry);
    if (prototype !== Object.prototype && prototype !== null) fail('RELEASE_MALFORMED');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(objectEntry))) {
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptor)) {
        fail('RELEASE_MALFORMED');
      }
      visit(descriptor.value, depth + 1);
    }
    active.delete(objectEntry);
  };
  visit(value, 0);
}

function assertBounded(value: unknown): void {
  assertStructuralBounds(value);
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail('RELEASE_MALFORMED');
  }
  if (encoded === undefined) return fail('RELEASE_MALFORMED');
  if (Buffer.byteLength(encoded, 'utf8') > PRODUCT_FACTORY_RELEASE_MAX_BYTES) {
    fail('RELEASE_SIZE_LIMIT');
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function hashProductFactoryReleasePayload(value: unknown): string {
  assertBounded(value);
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function exact(left: unknown, right: unknown): boolean {
  try {
    return hashProductFactoryReleasePayload(left) === hashProductFactoryReleasePayload(right);
  } catch {
    return false;
  }
}

function without(value: Record<string, unknown>, ...keys: readonly string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function parseWith<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  code: ProductFactoryReleaseErrorCode = 'RELEASE_MALFORMED',
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data === undefined) fail(code);
  return parsed.data;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function exactOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeText(value: string): boolean {
  return !SECRET_TEXT.test(value);
}

const HashSchema = z.string().regex(SHA256);
const SafeIdSchema = z.string().regex(SAFE_ID).refine(safeText);
const TimestampSchema = z.string().datetime({ offset: true });
const LaneSchema = z.enum(LANES);
const SubjectiveQuestionSchema = z
  .object({
    status: z.enum(['not-applicable', 'unresolved', 'human-reviewed']),
    evidenceSha256: HashSchema.nullable(),
  })
  .strict();
const SubjectiveBoundarySchema = z
  .object({
    fun: SubjectiveQuestionSchema,
    taste: SubjectiveQuestionSchema,
    commercialAppeal: SubjectiveQuestionSchema,
    userResearch: SubjectiveQuestionSchema,
  })
  .strict();

const ReferenceInputSchema = z
  .object({
    lane: LaneSchema,
    productId: SafeIdSchema,
    sourceRevisionSha256: HashSchema,
    artifactSha256: HashSchema,
    intentId: SafeIdSchema,
    intentVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    intentHash: HashSchema,
    lockedIntentSha256: HashSchema,
    acceptanceContractSha256: HashSchema,
    scenarioId: SafeIdSchema,
    aciDescriptor: z.unknown(),
    maintainedAt: TimestampSchema,
    maintenanceExpiresAt: TimestampSchema,
    subjectiveBoundary: SubjectiveBoundarySchema,
  })
  .strict();
const ReferenceSchema = ReferenceInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_FACTORY_REFERENCE_SCHEMA_VERSION),
  referenceSha256: HashSchema,
}).strict();
type StructuralReference = z.infer<typeof ReferenceSchema>;
export interface ProductFactoryReference extends Omit<StructuralReference, 'aciDescriptor'> {
  aciDescriptor: EnvironmentAciDescriptor;
}
export type ProductFactoryReferenceInput = z.input<typeof ReferenceInputSchema>;

function validateSubjectiveBoundary(reference: ProductFactoryReference): void {
  for (const question of Object.values(reference.subjectiveBoundary)) {
    if (
      (question.status === 'human-reviewed' && question.evidenceSha256 === null) ||
      (question.status !== 'human-reviewed' && question.evidenceSha256 !== null)
    ) {
      fail('RELEASE_BINDING_INVALID');
    }
  }
  const productQuestions = [
    reference.subjectiveBoundary.fun,
    reference.subjectiveBoundary.taste,
    reference.subjectiveBoundary.commercialAppeal,
  ];
  if (
    reference.lane === 'game'
      ? productQuestions.some(({ status }) => status === 'not-applicable')
      : productQuestions.some(({ status }) => status !== 'not-applicable')
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
}

export function parseProductFactoryReference(input: unknown): ProductFactoryReference {
  assertBounded(input);
  const structural = parseWith(ReferenceSchema, input);
  if (
    structural.referenceSha256 !==
    hashProductFactoryReleasePayload(without(structural, 'referenceSha256'))
  ) {
    fail('RELEASE_DIGEST_INVALID');
  }
  let descriptor: EnvironmentAciDescriptor;
  try {
    descriptor = parseEnvironmentAciDescriptor(structural.aciDescriptor);
  } catch {
    return fail('RELEASE_BINDING_INVALID');
  }
  const value = { ...structural, aciDescriptor: descriptor } as ProductFactoryReference;
  const expectedLock = hashProductFactoryReleasePayload({
    schemaVersion: LOCKED_INTENT_SCHEMA_VERSION,
    intentId: value.intentId,
    intentVersion: value.intentVersion,
    intentHash: value.intentHash,
  });
  if (
    descriptor.kind !== EXPECTED_KINDS[value.lane] ||
    value.lockedIntentSha256 !== expectedLock ||
    Date.parse(value.maintenanceExpiresAt) <= Date.parse(value.maintainedAt)
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
  validateSubjectiveBoundary(value);
  return deepFreeze(value) as ProductFactoryReference;
}

export function createProductFactoryReference(
  input: ProductFactoryReferenceInput,
): Readonly<ProductFactoryReference> {
  assertBounded(input);
  const parsed = parseWith(ReferenceInputSchema, input);
  const descriptor = (() => {
    try {
      return parseEnvironmentAciDescriptor(parsed.aciDescriptor);
    } catch {
      return fail('RELEASE_BINDING_INVALID');
    }
  })();
  const hashable = {
    schemaVersion: PRODUCT_FACTORY_REFERENCE_SCHEMA_VERSION,
    ...parsed,
    aciDescriptor: descriptor,
  };
  return parseProductFactoryReference({
    ...hashable,
    referenceSha256: hashProductFactoryReleasePayload(hashable),
  });
}

const OutcomeProofSchema = z
  .object({
    result: z.unknown(),
    resultVerification: z
      .object({
        contract: z.unknown(),
        intent: z.unknown(),
        expectedScenario: z.unknown(),
        scenarioReceipt: z.unknown(),
      })
      .strict(),
    judgment: z.unknown(),
    specialistReceipts: z.array(z.unknown()).max(MAX_SPECIALIST_RECEIPTS),
    judgedAt: TimestampSchema,
  })
  .strict();
export interface ProductFactoryOutcomeProof {
  result: ProductOutcomeResultReceipt;
  resultVerification: {
    contract: ProductOutcomeContract;
    intent: ProductIntent;
    expectedScenario: EnvironmentScenario;
    scenarioReceipt: EnvironmentScenarioReceipt;
  };
  judgment: ProductOutcomeJudgment;
  specialistReceipts: readonly ProductOutcomeSpecialistReceipt[];
  judgedAt: string;
}

const RevisionDeltaSchema = z
  .object({
    schemaVersion: z.literal(REVISION_DELTA_SCHEMA_VERSION),
    failureAttemptSha256: HashSchema,
    failureEvidenceSha256: HashSchema,
    baseArtifactSha256: HashSchema,
    targetArtifactSha256: HashSchema,
    lockedIntentSha256: HashSchema,
    intentHashBefore: HashSchema,
    intentHashAfter: HashSchema,
    acceptanceContractSha256: HashSchema,
    intentChanged: z.literal(false),
    authorizedScope: z.literal('implementation-correction'),
    deltaSha256: HashSchema,
  })
  .strict();
export type ProductFactoryRevisionDelta = z.infer<typeof RevisionDeltaSchema>;
const AttemptInputSchema = z
  .object({
    referenceSha256: HashSchema,
    attemptId: SafeIdSchema,
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_ATTEMPTS_PER_LANE - 1),
    previousAttemptSha256: HashSchema.nullable(),
    sourceRevisionSha256: HashSchema,
    artifactSha256: HashSchema,
    lockedIntentSha256: HashSchema,
    acceptanceContractSha256: HashSchema,
    scenarioId: SafeIdSchema,
    revisionDelta: RevisionDeltaSchema.nullable(),
    outcomeProof: OutcomeProofSchema,
    failureEvidenceSha256: HashSchema.nullable(),
  })
  .strict();
const AttemptSchema = AttemptInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_FACTORY_ATTEMPT_SCHEMA_VERSION),
  attemptSha256: HashSchema,
}).strict();
type StructuralAttempt = z.infer<typeof AttemptSchema>;
export interface ProductFactoryAttempt extends Omit<StructuralAttempt, 'outcomeProof'> {
  outcomeProof: ProductFactoryOutcomeProof;
}
export type ProductFactoryAttemptInput = z.input<typeof AttemptInputSchema>;

function parseRevisionDelta(input: unknown): ProductFactoryRevisionDelta {
  const value = parseWith(RevisionDeltaSchema, input);
  if (
    value.deltaSha256 !== hashProductFactoryReleasePayload(without(value, 'deltaSha256')) ||
    value.intentHashBefore !== value.intentHashAfter ||
    value.baseArtifactSha256 === value.targetArtifactSha256
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
  return value;
}

export function parseProductFactoryAttempt(input: unknown): ProductFactoryAttempt {
  assertBounded(input);
  const structural = parseWith(AttemptSchema, input);
  if (
    structural.attemptSha256 !==
      hashProductFactoryReleasePayload(without(structural, 'attemptSha256')) ||
    (structural.index === 0 &&
      (structural.previousAttemptSha256 !== null || structural.revisionDelta !== null)) ||
    (structural.index > 0 &&
      (structural.previousAttemptSha256 === null || structural.revisionDelta === null))
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
  if (structural.revisionDelta !== null) parseRevisionDelta(structural.revisionDelta);
  return deepFreeze(structural) as unknown as ProductFactoryAttempt;
}

export function createProductFactoryAttempt(
  input: ProductFactoryAttemptInput,
): Readonly<ProductFactoryAttempt> {
  assertBounded(input);
  const parsed = parseWith(AttemptInputSchema, input);
  const hashable = { schemaVersion: PRODUCT_FACTORY_ATTEMPT_SCHEMA_VERSION, ...parsed };
  return parseProductFactoryAttempt({
    ...hashable,
    attemptSha256: hashProductFactoryReleasePayload(hashable),
  });
}

const ForgeBenchReferenceSchema = z
  .object({
    schemaVersion: z.literal(FORGEBENCH_REFERENCE_SCHEMA_VERSION),
    comparisonSha256: HashSchema,
    capturedAt: TimestampSchema,
  })
  .strict();
export type ProductFactoryForgeBenchReference = z.infer<typeof ForgeBenchReferenceSchema>;

const PromotionEvidenceSchema = z
  .object({
    candidate: z.unknown(),
    forgeBenchProjection: z.unknown(),
    replayReceipt: z.unknown(),
    reviewReceipt: z.unknown(),
    deltaPackage: z.unknown(),
    promotionReceipt: z.unknown(),
  })
  .strict();
const RollbackEvidenceSchema = z
  .object({ deltaPackage: z.unknown(), rollbackReceipt: z.unknown() })
  .strict();
const LearningEvidenceSchema = z
  .object({
    schemaVersion: z.literal(LEARNING_EVIDENCE_SCHEMA_VERSION),
    registry: z.unknown(),
    promotions: z.array(PromotionEvidenceSchema).max(MAX_LEARNING_EVENTS),
    rollbacks: z.array(RollbackEvidenceSchema).max(MAX_LEARNING_EVENTS),
  })
  .strict();
export type ProductFactoryLearningEvidence = z.infer<typeof LearningEvidenceSchema>;

const SecurityProbeSchema = z
  .object({ kind: z.enum(SECURITY_PROBES), receipt: z.unknown() })
  .strict();
const IsolationInputSchema = z
  .object({
    schemaVersion: z.literal(ISOLATION_EVIDENCE_SCHEMA_VERSION),
    lane: LaneSchema,
    referenceSha256: HashSchema,
    receipts: z.array(z.unknown()).min(5).max(MAX_LIFECYCLE_RECEIPTS),
    securityProbes: z.array(SecurityProbeSchema).length(SECURITY_PROBES.length),
  })
  .strict();
const IsolationEvidenceSchema = IsolationInputSchema.extend({
  evidenceSha256: HashSchema,
}).strict();
type StructuralIsolation = z.infer<typeof IsolationEvidenceSchema>;
export interface ProductFactoryIsolationEvidence extends Omit<
  StructuralIsolation,
  'receipts' | 'securityProbes'
> {
  receipts: readonly DisposableEnvironmentReceipt[];
  securityProbes: readonly {
    kind: (typeof SECURITY_PROBES)[number];
    receipt: DisposableEnvironmentReceipt;
  }[];
}

const GateReferenceSchema = z
  .object({
    schemaVersion: z.literal(GATE_REFERENCE_SCHEMA_VERSION),
    lane: LaneSchema,
    referenceSha256: HashSchema,
    category: z.enum(GATE_CATEGORIES),
    applicable: z.boolean(),
    evidenceRefSha256: HashSchema,
    gateSha256: HashSchema,
  })
  .strict();
export type ProductFactoryGateReference = z.infer<typeof GateReferenceSchema>;
const AttemptGroupSchema = z
  .object({
    lane: LaneSchema,
    referenceSha256: HashSchema,
    attempts: z.array(AttemptSchema).min(1).max(MAX_ATTEMPTS_PER_LANE),
  })
  .strict();
const GateGroupSchema = z
  .object({
    lane: LaneSchema,
    referenceSha256: HashSchema,
    gates: z.array(GateReferenceSchema).length(GATE_CATEGORIES.length),
  })
  .strict();
const CandidateInputSchema = z
  .object({
    candidateId: SafeIdSchema,
    evaluationId: SafeIdSchema,
    implementerId: SafeIdSchema,
    evidenceNonce: SafeIdSchema,
    sourceRevisionSha256: HashSchema,
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    references: z.array(ReferenceSchema).length(LANES.length),
    attemptGroups: z.array(AttemptGroupSchema).length(LANES.length),
    forgeBenchReference: ForgeBenchReferenceSchema,
    learningEvidence: LearningEvidenceSchema,
    isolation: z.array(IsolationEvidenceSchema).length(LANES.length),
    gateGroups: z.array(GateGroupSchema).length(LANES.length),
  })
  .strict();
const CandidateSchema = CandidateInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_FACTORY_RELEASE_SCHEMA_VERSION),
  candidateSha256: HashSchema,
}).strict();
type StructuralCandidate = z.infer<typeof CandidateSchema>;
export interface ProductFactoryReleaseCandidate extends Omit<
  StructuralCandidate,
  'references' | 'attemptGroups' | 'isolation'
> {
  references: readonly ProductFactoryReference[];
  attemptGroups: readonly {
    lane: ProductFactoryLane;
    referenceSha256: string;
    attempts: ProductFactoryAttempt[];
  }[];
  isolation: readonly ProductFactoryIsolationEvidence[];
}
export type ProductFactoryReleaseCandidateInput = z.input<typeof CandidateInputSchema>;

function parseGateReference(input: unknown): ProductFactoryGateReference {
  const value = parseWith(GateReferenceSchema, input);
  if (value.gateSha256 !== hashProductFactoryReleasePayload(without(value, 'gateSha256'))) {
    fail('RELEASE_DIGEST_INVALID');
  }
  return value;
}

function parseIsolationStructure(input: unknown): ProductFactoryIsolationEvidence {
  const value = parseWith(IsolationEvidenceSchema, input);
  if (value.evidenceSha256 !== hashProductFactoryReleasePayload(without(value, 'evidenceSha256'))) {
    fail('RELEASE_DIGEST_INVALID');
  }
  return value as unknown as ProductFactoryIsolationEvidence;
}

function validateCandidateStructure(value: StructuralCandidate): ProductFactoryReleaseCandidate {
  const references = value.references.map(parseProductFactoryReference);
  const attempts = value.attemptGroups.map((group) => ({
    ...group,
    attempts: group.attempts.map(parseProductFactoryAttempt),
  }));
  const isolation = value.isolation.map(parseIsolationStructure);
  const gates = value.gateGroups.map((group) => ({
    ...group,
    gates: group.gates.map(parseGateReference),
  }));
  if (
    Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
    !exactOrder(
      references.map(({ lane }) => lane),
      LANES,
    ) ||
    !exactOrder(
      attempts.map(({ lane }) => lane),
      LANES,
    ) ||
    !exactOrder(
      isolation.map(({ lane }) => lane),
      LANES,
    ) ||
    !exactOrder(
      gates.map(({ lane }) => lane),
      LANES,
    ) ||
    !unique(references.map(({ referenceSha256 }) => referenceSha256))
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
  for (const [index, reference] of references.entries()) {
    const attemptGroup = attempts[index];
    const isolationGroup = isolation[index];
    const gateGroup = gates[index];
    if (
      !attemptGroup ||
      !isolationGroup ||
      !gateGroup ||
      attemptGroup.referenceSha256 !== reference.referenceSha256 ||
      isolationGroup.referenceSha256 !== reference.referenceSha256 ||
      gateGroup.referenceSha256 !== reference.referenceSha256 ||
      !exactOrder(
        gateGroup.gates.map(({ category }) => category),
        GATE_CATEGORIES,
      ) ||
      gateGroup.gates.some(
        (gate) =>
          gate.lane !== reference.lane || gate.referenceSha256 !== reference.referenceSha256,
      )
    ) {
      fail('RELEASE_BINDING_INVALID');
    }
  }
  if (
    !unique(attempts.flatMap(({ attempts: entries }) => entries.map(({ attemptId }) => attemptId)))
  ) {
    fail('RELEASE_DUPLICATE_EVIDENCE');
  }
  return {
    ...value,
    references,
    attemptGroups: attempts,
    isolation,
  } as ProductFactoryReleaseCandidate;
}

export function parseProductFactoryReleaseCandidate(
  input: unknown,
): ProductFactoryReleaseCandidate {
  assertBounded(input);
  const value = parseWith(CandidateSchema, input);
  if (
    value.candidateSha256 !== hashProductFactoryReleasePayload(without(value, 'candidateSha256'))
  ) {
    fail('RELEASE_DIGEST_INVALID');
  }
  return deepFreeze(validateCandidateStructure(value)) as ProductFactoryReleaseCandidate;
}

export function createProductFactoryReleaseCandidate(
  input: ProductFactoryReleaseCandidateInput,
): Readonly<ProductFactoryReleaseCandidate> {
  assertBounded(input);
  const parsed = parseWith(CandidateInputSchema, input);
  const hashable = { schemaVersion: PRODUCT_FACTORY_RELEASE_SCHEMA_VERSION, ...parsed };
  return parseProductFactoryReleaseCandidate({
    ...hashable,
    candidateSha256: hashProductFactoryReleasePayload(hashable),
  });
}

export interface ProductFactoryReleaseEvaluationContext {
  now: Date;
  receiptMaxAgeMs: number;
}

interface ContextSnapshot {
  nowMs: number;
  nowIso: string;
  receiptMaxAgeMs: number;
  startedAt: number;
}

function snapshotContext(input: ProductFactoryReleaseEvaluationContext): ContextSnapshot {
  if (input === null || typeof input !== 'object') fail('RELEASE_MALFORMED');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    !exactOrder(Object.keys(descriptors).sort(), ['now', 'receiptMaxAgeMs']) ||
    Object.values(descriptors).some((descriptor) => !('value' in descriptor))
  ) {
    fail('RELEASE_MALFORMED');
  }
  const now = descriptors.now?.value;
  const receiptMaxAgeMs = descriptors.receiptMaxAgeMs?.value;
  if (
    !(now instanceof Date) ||
    Object.getPrototypeOf(now) !== Date.prototype ||
    Object.keys(now).length !== 0 ||
    typeof receiptMaxAgeMs !== 'number' ||
    !Number.isSafeInteger(receiptMaxAgeMs) ||
    receiptMaxAgeMs < 0 ||
    receiptMaxAgeMs > MAX_RECEIPT_AGE_MS
  ) {
    return fail('RELEASE_MALFORMED');
  }
  const nowMs = Date.prototype.getTime.call(now) as number;
  if (!Number.isFinite(nowMs)) fail('RELEASE_MALFORMED');
  return {
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
    receiptMaxAgeMs,
    startedAt: performance.now(),
  };
}

function checkDeadline(context: ContextSnapshot): void {
  if (performance.now() - context.startedAt > CANONICAL_PARSE_DEADLINE_MS) {
    fail('RELEASE_EVALUATION_DEADLINE');
  }
}

interface ParsedOutcome {
  result: ProductOutcomeResultReceipt;
  judgment: ProductOutcomeJudgment;
  specialists: ProductOutcomeSpecialistReceipt[];
  canonicalNegative: boolean;
  humanReview: boolean;
  unverified: boolean;
  failureEvidenceSha256: string | null;
  evidenceIds: string[];
}

async function parseOutcomeProof(
  proofInput: unknown,
  reference: ProductFactoryReference,
  context: ContextSnapshot,
): Promise<ParsedOutcome> {
  checkDeadline(context);
  const proof = parseWith(OutcomeProofSchema, proofInput);
  let intent: ProductIntent;
  let descriptor: EnvironmentAciDescriptor;
  let contract: ProductOutcomeContract;
  let expectedScenario: EnvironmentScenario;
  let scenarioReceipt: EnvironmentScenarioReceipt;
  try {
    intent = parseProductIntent(proof.resultVerification.intent);
    descriptor = parseEnvironmentAciDescriptor(reference.aciDescriptor);
    contract = validateProductOutcomeContractReferences(
      proof.resultVerification.contract,
      intent,
      descriptor,
    );
    expectedScenario = parseEnvironmentScenario(proof.resultVerification.expectedScenario);
    scenarioReceipt = parseEnvironmentScenarioReceipt(proof.resultVerification.scenarioReceipt);
  } catch {
    return fail('RELEASE_BINDING_INVALID');
  }
  if (
    contract.evidenceAuthority !== 'test-only' ||
    reference.intentId !== intent.intentId ||
    reference.intentVersion !== intent.version ||
    reference.intentHash !== intent.hash ||
    reference.acceptanceContractSha256 !== contract.contractSha256 ||
    reference.scenarioId !== expectedScenario.scenarioId ||
    expectedScenario.adapterId !== descriptor.adapterId ||
    expectedScenario.environmentId !== descriptor.environmentId ||
    expectedScenario.sessionId !== descriptor.sessionId ||
    scenarioReceipt.receiptSha256 === undefined
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
  const verification = { contract, intent, expectedScenario, scenarioReceipt };
  let result: ProductOutcomeResultReceipt;
  let specialists: ProductOutcomeSpecialistReceipt[];
  let judgment: ProductOutcomeJudgment;
  try {
    result = await parseProductOutcomeResultReceipt(proof.result, verification);
    checkDeadline(context);
    specialists = proof.specialistReceipts.map(parseProductOutcomeSpecialistReceipt);
    judgment = await parseProductOutcomeJudgment(proof.judgment, {
      runnerResult: result,
      runnerVerification: verification,
      specialistReceipts: specialists,
      judgedAt: proof.judgedAt,
    });
  } catch {
    return fail('RELEASE_BINDING_INVALID');
  }
  checkDeadline(context);
  const negativeSpecialist = specialists.find(
    ({ status, negativePaths }) => status === 'FAIL' || negativePaths.length > 0,
  );
  const canonicalNegative =
    result.status === 'FAIL' ||
    judgment.status === 'FAIL' ||
    result.negativePaths.length > 0 ||
    negativeSpecialist !== undefined;
  const humanReview =
    result.status === 'REQUIRES_HUMAN_REVIEW' ||
    judgment.status === 'REQUIRES_HUMAN_REVIEW' ||
    specialists.some(({ status }) => status === 'REQUIRES_HUMAN_REVIEW');
  const unverified = result.status !== 'FAIL' && judgment.status === 'UNVERIFIED';
  return {
    result,
    judgment,
    specialists,
    canonicalNegative,
    humanReview,
    unverified,
    failureEvidenceSha256: canonicalNegative
      ? (negativeSpecialist?.receiptSha256 ?? result.resultSha256)
      : null,
    evidenceIds: [
      result.resultSha256,
      judgment.judgmentSha256,
      scenarioReceipt.receiptSha256,
      ...specialists.map(({ receiptSha256 }) => receiptSha256),
    ],
  };
}

interface ParsedLearning {
  registry: LearningRegistry;
  evidenceIds: string[];
}

function buildRegistryPrefixes(registry: LearningRegistry): LearningRegistry[] {
  const first = registry.history[0];
  const genesis = first?.from ?? registry.active;
  const usedCandidates: string[] = [];
  const usedSemanticLessons: string[] = [];
  const usedPackages: string[] = [];
  const prefixes: LearningRegistry[] = [];
  const seal = (revision: number, active: LearningRegistry['active']): LearningRegistry => {
    const hashable = {
      schemaVersion: LEARNING_REGISTRY_SCHEMA_VERSION,
      registryId: registry.registryId,
      revision,
      active,
      usedCandidateSha256s: [...usedCandidates].sort(),
      usedSemanticLessonSha256s: [...usedSemanticLessons].sort(),
      usedPackageSha256s: [...usedPackages].sort(),
      history: registry.history.slice(0, revision),
    };
    return parseLearningRegistry({
      ...hashable,
      registrySha256: hashLearningFoundryPayload(hashable),
    });
  };
  prefixes.push(seal(0, genesis));
  for (const event of registry.history) {
    usedPackages.push(event.packageSha256);
    if (event.kind === 'promotion') {
      usedCandidates.push(event.candidateSha256);
      usedSemanticLessons.push(event.semanticLessonSha256);
    }
    prefixes.push(seal(event.revision, event.to));
  }
  return prefixes;
}

function parsePromotionRecord(input: unknown) {
  const record = parseWith(PromotionEvidenceSchema, input);
  let candidate: CandidateLesson;
  let forgeBench: ForgeBenchPromotionProjection;
  let replay: OfflineReplayReceipt;
  let review: IndependentReviewReceipt;
  let delta: PromotionDeltaPackage;
  let receipt: PromotionReceipt;
  try {
    candidate = parseCandidateLesson(record.candidate);
    forgeBench = parseForgeBenchPromotionProjection(record.forgeBenchProjection);
    replay = parseOfflineReplayReceipt(record.replayReceipt);
    review = parseIndependentReviewReceipt(record.reviewReceipt);
    delta = parsePromotionDeltaPackage(record.deltaPackage);
    receipt = parsePromotionReceipt(record.promotionReceipt);
  } catch {
    return fail('RELEASE_BINDING_INVALID');
  }
  if (
    candidate.schemaVersion !== CANDIDATE_LESSON_SCHEMA_VERSION ||
    forgeBench.schemaVersion !== FORGE_BENCH_PROMOTION_PROJECTION_SCHEMA_VERSION ||
    replay.schemaVersion !== OFFLINE_REPLAY_RECEIPT_SCHEMA_VERSION ||
    review.schemaVersion !== INDEPENDENT_REVIEW_RECEIPT_SCHEMA_VERSION ||
    delta.candidateSha256 !== candidate.candidateSha256 ||
    delta.semanticLessonSha256 !== candidate.semanticLessonSha256 ||
    delta.comparisonSha256 !== forgeBench.comparisonSha256 ||
    delta.replayReceiptSha256 !== replay.receiptSha256 ||
    delta.reviewReceiptSha256 !== review.receiptSha256 ||
    replay.candidateSha256 !== candidate.candidateSha256 ||
    replay.comparisonSha256 !== forgeBench.comparisonSha256 ||
    review.candidateSha256 !== candidate.candidateSha256 ||
    review.comparisonSha256 !== forgeBench.comparisonSha256 ||
    receipt.packageSha256 !== delta.packageSha256 ||
    receipt.candidateSha256 !== candidate.candidateSha256 ||
    receipt.semanticLessonSha256 !== candidate.semanticLessonSha256 ||
    receipt.comparisonSha256 !== forgeBench.comparisonSha256
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
  return { candidate, forgeBench, replay, review, delta, receipt };
}

function parseLearningEvidence(input: unknown): ParsedLearning {
  const evidence = parseWith(LearningEvidenceSchema, input);
  let registry: LearningRegistry;
  try {
    registry = parseLearningRegistry(evidence.registry);
  } catch {
    return fail('RELEASE_BINDING_INVALID');
  }
  const prefixes = buildRegistryPrefixes(registry);
  const promotions = evidence.promotions.map(parsePromotionRecord);
  const rollbacks = evidence.rollbacks.map((entry) => {
    let delta: RollbackDeltaPackage;
    let receipt: RollbackReceipt;
    try {
      delta = parseRollbackDeltaPackage(entry.deltaPackage);
      receipt = parseRollbackReceipt(entry.rollbackReceipt);
    } catch {
      return fail('RELEASE_BINDING_INVALID');
    }
    if (
      receipt.status !== 'rolled-back' ||
      receipt.packageSha256 !== delta.packageSha256 ||
      receipt.promotionPackageSha256 !== delta.promotionPackageSha256
    ) {
      fail('RELEASE_BINDING_INVALID');
    }
    return { delta, receipt };
  });
  const promotionEvents = registry.history.filter(
    (event): event is Extract<LearningRegistry['history'][number], { kind: 'promotion' }> =>
      event.kind === 'promotion',
  );
  const rollbackEvents = registry.history.filter(
    (event): event is Extract<LearningRegistry['history'][number], { kind: 'rollback' }> =>
      event.kind === 'rollback',
  );
  if (promotions.length !== promotionEvents.length || rollbacks.length !== rollbackEvents.length) {
    fail('RELEASE_BINDING_INVALID');
  }
  for (const event of promotionEvents) {
    const matches = promotions.filter(({ delta }) => delta.packageSha256 === event.packageSha256);
    const record = matches[0];
    const before = prefixes[event.revision - 1];
    const after = prefixes[event.revision];
    if (
      matches.length !== 1 ||
      !record ||
      !before ||
      !after ||
      record.delta.registryId !== registry.registryId ||
      record.delta.baseRegistryRevision !== before.revision ||
      record.delta.baseRegistrySha256 !== before.registrySha256 ||
      record.delta.prior.sha256 !== event.from.sha256 ||
      record.delta.target.sha256 !== event.to.sha256 ||
      record.receipt.registryRevision !== after.revision ||
      record.receipt.registrySha256 !== after.registrySha256 ||
      record.receipt.baseRegistrySha256 !== before.registrySha256
    ) {
      fail('RELEASE_BINDING_INVALID');
    }
  }
  for (const event of rollbackEvents) {
    const matches = rollbacks.filter(({ delta }) => delta.packageSha256 === event.packageSha256);
    const record = matches[0];
    const after = prefixes[event.revision];
    if (
      matches.length !== 1 ||
      !record ||
      !after ||
      record.delta.registryId !== registry.registryId ||
      record.delta.promotionPackageSha256 !== event.promotionPackageSha256 ||
      record.delta.promotionEventHash !== event.promotionEventHash ||
      record.delta.from.sha256 !== event.from.sha256 ||
      record.delta.restore.sha256 !== event.to.sha256 ||
      record.receipt.registryRevision !== after.revision ||
      record.receipt.registrySha256 !== after.registrySha256 ||
      record.receipt.restoredIntelligenceSha256 !== event.to.sha256
    ) {
      fail('RELEASE_BINDING_INVALID');
    }
  }
  return {
    registry,
    evidenceIds: [
      registry.registrySha256,
      ...promotions.flatMap(({ candidate, forgeBench, replay, review, delta, receipt }) => [
        candidate.candidateSha256,
        forgeBench.projectionSha256,
        replay.receiptSha256,
        review.receiptSha256,
        delta.packageSha256,
        receipt.receiptSha256,
      ]),
      ...rollbacks.flatMap(({ delta, receipt }) => [delta.packageSha256, receipt.receiptSha256]),
    ],
  };
}

interface ParsedIsolation {
  lifecycleNegative: boolean;
  artifactMismatch: boolean;
  teardownFailure: boolean;
  securityProbeUnverified: boolean;
  evidenceIds: string[];
}

function parseIsolationEvidence(
  input: ProductFactoryIsolationEvidence,
  reference: ProductFactoryReference,
  context: ContextSnapshot,
): ParsedIsolation {
  const structure = parseIsolationStructure(input);
  const parseReceipt = (receipt: unknown): DisposableEnvironmentReceipt => {
    try {
      return parseDisposableEnvironmentReceipt(receipt, {
        now: new Date(context.nowMs),
        maxAgeMs: context.receiptMaxAgeMs,
      });
    } catch {
      return fail('RELEASE_BINDING_INVALID');
    }
  };
  const receipts = structure.receipts.map(parseReceipt);
  const operations = receipts.map(({ operation }) => operation);
  if (
    operations[0] !== 'provision' ||
    operations[1] !== 'start' ||
    operations.at(-2) !== 'export' ||
    operations.at(-1) !== 'teardown' ||
    operations.slice(2, -2).length < 1 ||
    operations.slice(2, -2).some((operation) => operation !== 'execute')
  ) {
    fail('RELEASE_BINDING_INVALID');
  }
  const first = receipts[0];
  if (!first || first.environmentId !== reference.aciDescriptor.environmentId) {
    fail('RELEASE_BINDING_INVALID');
  }
  const identityKeys = [
    'registryKeySha256',
    'environmentId',
    'backendId',
    'runtimeId',
    'policySha256',
    'workspaceSha256',
    'capabilitySha256',
    'authority',
    'hostIsolation',
  ] as const;
  for (const [index, receipt] of receipts.entries()) {
    const previous = receipts[index - 1];
    if (
      receipt.productionEligible !== false ||
      identityKeys.some((key) => receipt[key] !== first[key]) ||
      (previous !== undefined &&
        (receipt.operationSequence !== previous.operationSequence + 1 ||
          receipt.generationBefore !== previous.generationAfter ||
          receipt.stateBefore !== previous.stateAfter))
    ) {
      fail('RELEASE_BINDING_INVALID');
    }
  }
  const exportReceipt = receipts.at(-2)!;
  const teardownReceipt = receipts.at(-1)!;
  const artifactMismatch =
    exportReceipt.code !== 'ARTIFACTS_EXPORTED' ||
    exportReceipt.artifactDisposition !== 'retained' ||
    exportReceipt.artifacts.length !== 1 ||
    exportReceipt.artifacts[0]?.sha256 !== reference.artifactSha256;
  const teardownFailure =
    teardownReceipt.code !== 'TEARDOWN_CONFIRMED' ||
    teardownReceipt.stateAfter !== 'TORN_DOWN' ||
    teardownReceipt.reconciliationSha256 === null;
  const probes = structure.securityProbes.map(({ kind, receipt }) => ({
    kind,
    receipt: parseReceipt(receipt),
  }));
  const securityProbeUnverified =
    !exactOrder(
      probes.map(({ kind }) => kind),
      SECURITY_PROBES,
    ) ||
    probes.some(({ kind, receipt }) => {
      const expected = SECURITY_EXPECTATIONS[kind];
      return (
        receipt.operation !== expected.operation ||
        receipt.status !== expected.status ||
        receipt.code !== expected.code
      );
    });
  return {
    lifecycleNegative: receipts.some(
      ({ status, negativePaths }) =>
        status === 'FAIL' || status === 'BLOCKED' || negativePaths.length > 0,
    ),
    artifactMismatch,
    teardownFailure,
    securityProbeUnverified,
    evidenceIds: [
      structure.evidenceSha256,
      ...receipts.map(({ receiptSha256 }) => receiptSha256),
      ...probes.map(({ receipt }) => receipt.receiptSha256),
    ],
  };
}

const ReasonSchema = z.enum([
  'artifact-binding-failed',
  'forgebench-upstream-unverified',
  'gates-upstream-unverified',
  'isolation-failed',
  'isolation-local-test-only',
  'learning-upstream-unverified',
  'outcome-failed',
  'outcome-test-only',
  'outcome-unverified',
  'production-authority-unavailable',
  'security-probes-unverified',
  'stale-candidate',
  'stale-reference-maintenance',
  'subjective-review-open',
  'teardown-failed',
]);
export type ProductFactoryReleaseReason = z.infer<typeof ReasonSchema>;
const DecisionInputSchema = z
  .object({
    schemaVersion: z.literal(PRODUCT_FACTORY_DECISION_SCHEMA_VERSION),
    candidateId: SafeIdSchema,
    evaluationId: SafeIdSchema,
    evidenceNonce: SafeIdSchema,
    candidateSha256: HashSchema,
    evaluatedAt: TimestampSchema,
    status: z.enum(['FAIL', 'UNVERIFIED', 'REQUIRES_HUMAN_REVIEW']),
    activationEligible: z.literal(false),
    reasons: z.array(ReasonSchema).min(1).max(ReasonSchema.options.length),
    canonicalEvidenceSha256s: z.array(HashSchema).max(MAX_REPLAY_ENTRIES),
    opaqueEvidenceSha256s: z.array(HashSchema).max(32),
    limitations: z.tuple([
      z.literal('NO_PUBLIC_PRODUCTION_RELEASE_CAPABILITY'),
      z.literal('PF4_AND_GATE_REFERENCES_ARE_OPAQUE_UNTRUSTED_INPUTS'),
      z.literal('CALLBACK_VERIFIERS_ARE_NOT_EXECUTED'),
      z.literal('REPLAY_REGISTRY_IS_PROCESS_LOCAL_AND_NOT_DURABLE_ACROSS_RESTARTS'),
      z.literal('NO_DEPLOY_TAG_OR_RELEASE_MUTATION_PERFORMED'),
    ]),
  })
  .strict();
const DecisionSchema = DecisionInputSchema.extend({ decisionSha256: HashSchema }).strict();
export type ProductFactoryReleaseDecision = z.infer<typeof DecisionSchema>;

function decisionStatus(reasons: ReadonlySet<ProductFactoryReleaseReason>) {
  if (
    [...reasons].some((reason) =>
      ['artifact-binding-failed', 'isolation-failed', 'outcome-failed', 'teardown-failed'].includes(
        reason,
      ),
    )
  ) {
    return 'FAIL' as const;
  }
  if (reasons.has('subjective-review-open')) return 'REQUIRES_HUMAN_REVIEW' as const;
  return 'UNVERIFIED' as const;
}

function candidateEvidenceReservationIds(candidate: ProductFactoryReleaseCandidate): string[] {
  return [
    hashProductFactoryReleasePayload(candidate.forgeBenchReference),
    hashProductFactoryReleasePayload(candidate.learningEvidence),
    ...candidate.attemptGroups.flatMap(({ attempts }) =>
      attempts.map(({ outcomeProof }) => hashProductFactoryReleasePayload(outcomeProof)),
    ),
    ...candidate.isolation.flatMap((entry) => [
      entry.evidenceSha256,
      ...entry.receipts.map(hashProductFactoryReleasePayload),
      ...entry.securityProbes.map(({ receipt }) => hashProductFactoryReleasePayload(receipt)),
    ]),
    ...candidate.gateGroups.flatMap(({ gates }) => gates.map(({ gateSha256 }) => gateSha256)),
  ];
}

interface ReplayCell {
  candidateSha256: string;
  pending: Promise<ProductFactoryReleaseDecision>;
  decision?: ProductFactoryReleaseDecision;
  evidenceIds: readonly string[];
}
const EVALUATION_REPLAY = new Map<string, ReplayCell>();
const NONCE_REPLAY = new Map<string, string>();
const EVIDENCE_REPLAY = new Map<string, string>();

function reserveReplay(
  candidate: ProductFactoryReleaseCandidate,
  createPending: () => Promise<ProductFactoryReleaseDecision>,
): { cell: ReplayCell; existing: boolean } {
  const existing = EVALUATION_REPLAY.get(candidate.evaluationId);
  if (existing) {
    if (existing.candidateSha256 !== candidate.candidateSha256) fail('RELEASE_REPLAY_REJECTED');
    return { cell: existing, existing: true };
  }
  if (NONCE_REPLAY.get(candidate.evidenceNonce) !== undefined) fail('RELEASE_REPLAY_REJECTED');
  const evidenceIds = candidateEvidenceReservationIds(candidate);
  if (!unique(evidenceIds) || evidenceIds.some((id) => EVIDENCE_REPLAY.has(id))) {
    fail('RELEASE_REPLAY_REJECTED');
  }
  if (
    EVALUATION_REPLAY.size >= MAX_REPLAY_ENTRIES ||
    NONCE_REPLAY.size >= MAX_REPLAY_ENTRIES ||
    EVIDENCE_REPLAY.size + evidenceIds.length > MAX_REPLAY_ENTRIES
  ) {
    fail('RELEASE_REPLAY_CAPACITY');
  }
  let start!: () => void;
  const gate = new Promise<void>((resolve) => {
    start = resolve;
  });
  const pending = gate.then(createPending);
  const cell: ReplayCell = { candidateSha256: candidate.candidateSha256, pending, evidenceIds };
  EVALUATION_REPLAY.set(candidate.evaluationId, cell);
  NONCE_REPLAY.set(candidate.evidenceNonce, candidate.candidateSha256);
  for (const id of evidenceIds) EVIDENCE_REPLAY.set(id, candidate.candidateSha256);
  start();
  return { cell, existing: false };
}

function releaseFailedReservation(
  candidate: ProductFactoryReleaseCandidate,
  cell: ReplayCell,
): void {
  if (EVALUATION_REPLAY.get(candidate.evaluationId) === cell) {
    EVALUATION_REPLAY.delete(candidate.evaluationId);
  }
  if (NONCE_REPLAY.get(candidate.evidenceNonce) === candidate.candidateSha256) {
    NONCE_REPLAY.delete(candidate.evidenceNonce);
  }
  for (const id of cell.evidenceIds) {
    if (EVIDENCE_REPLAY.get(id) === candidate.candidateSha256) EVIDENCE_REPLAY.delete(id);
  }
}

async function resolveAndSeal(
  candidate: ProductFactoryReleaseCandidate,
  context: ContextSnapshot,
): Promise<ProductFactoryReleaseDecision> {
  const reasons = new Set<ProductFactoryReleaseReason>([
    'production-authority-unavailable',
    'forgebench-upstream-unverified',
    'gates-upstream-unverified',
    'isolation-local-test-only',
    'outcome-test-only',
  ]);
  if (
    context.nowMs < Date.parse(candidate.createdAt) ||
    context.nowMs > Date.parse(candidate.expiresAt)
  ) {
    reasons.add('stale-candidate');
  }
  const canonicalEvidence = new Set<string>();
  const parsedOutcomes: ParsedOutcome[][] = [];
  for (const [laneIndex, group] of candidate.attemptGroups.entries()) {
    const reference = candidate.references[laneIndex];
    if (!reference) fail('RELEASE_BINDING_INVALID');
    const entries: ParsedOutcome[] = [];
    for (const attempt of group.attempts) {
      entries.push(await parseOutcomeProof(attempt.outcomeProof, reference, context));
    }
    parsedOutcomes.push(entries);
  }
  const learning = parseLearningEvidence(candidate.learningEvidence);
  for (const id of learning.evidenceIds) canonicalEvidence.add(id);

  for (const [laneIndex, reference] of candidate.references.entries()) {
    const attemptGroup = candidate.attemptGroups[laneIndex];
    const outcomes = parsedOutcomes[laneIndex];
    const isolationInput = candidate.isolation[laneIndex];
    if (!attemptGroup || !outcomes || !isolationInput) fail('RELEASE_BINDING_INVALID');
    if (
      context.nowMs < Date.parse(reference.maintainedAt) ||
      context.nowMs > Date.parse(reference.maintenanceExpiresAt) ||
      context.nowMs - Date.parse(reference.maintainedAt) > MAX_REFERENCE_AGE_MS
    ) {
      reasons.add('stale-reference-maintenance');
    }
    for (const [attemptIndex, attempt] of attemptGroup.attempts.entries()) {
      const outcome = outcomes[attemptIndex];
      const previous = attemptGroup.attempts[attemptIndex - 1];
      const previousOutcome = outcomes[attemptIndex - 1];
      if (
        !outcome ||
        attempt.index !== attemptIndex ||
        attempt.referenceSha256 !== reference.referenceSha256 ||
        attempt.lockedIntentSha256 !== reference.lockedIntentSha256 ||
        attempt.acceptanceContractSha256 !== reference.acceptanceContractSha256 ||
        attempt.scenarioId !== reference.scenarioId
      ) {
        fail('RELEASE_BINDING_INVALID');
      }
      if (attemptIndex === 0) {
        if (attempt.failureEvidenceSha256 !== outcome.failureEvidenceSha256) {
          fail('RELEASE_BINDING_INVALID');
        }
      } else {
        const delta = attempt.revisionDelta;
        if (
          !previous ||
          !previousOutcome?.canonicalNegative ||
          !delta ||
          attempt.previousAttemptSha256 !== previous.attemptSha256 ||
          previous.failureEvidenceSha256 !== previousOutcome.failureEvidenceSha256 ||
          delta.failureAttemptSha256 !== previous.attemptSha256 ||
          delta.failureEvidenceSha256 !== previousOutcome.failureEvidenceSha256 ||
          delta.baseArtifactSha256 !== previous.artifactSha256 ||
          delta.targetArtifactSha256 !== attempt.artifactSha256 ||
          delta.lockedIntentSha256 !== reference.lockedIntentSha256 ||
          delta.intentHashBefore !== reference.intentHash ||
          delta.intentHashAfter !== reference.intentHash ||
          delta.acceptanceContractSha256 !== reference.acceptanceContractSha256
        ) {
          fail('RELEASE_BINDING_INVALID');
        }
      }
      for (const id of outcome.evidenceIds) canonicalEvidence.add(id);
    }
    const finalAttempt = attemptGroup.attempts.at(-1)!;
    const finalOutcome = outcomes.at(-1)!;
    if (
      finalAttempt.sourceRevisionSha256 !== reference.sourceRevisionSha256 ||
      reference.sourceRevisionSha256 !== candidate.sourceRevisionSha256 ||
      finalAttempt.artifactSha256 !== reference.artifactSha256 ||
      (finalOutcome.result.status !== 'FAIL' &&
        !finalOutcome.result.artifacts.some(({ sha256 }) => sha256 === reference.artifactSha256))
    ) {
      fail('RELEASE_BINDING_INVALID');
    }
    if (finalOutcome.canonicalNegative) reasons.add('outcome-failed');
    else if (finalOutcome.unverified) reasons.add('outcome-unverified');
    if (finalOutcome.humanReview) reasons.add('subjective-review-open');
    if (Object.values(reference.subjectiveBoundary).some(({ status }) => status === 'unresolved')) {
      reasons.add('subjective-review-open');
    }
    const isolation = parseIsolationEvidence(isolationInput, reference, context);
    for (const id of isolation.evidenceIds) canonicalEvidence.add(id);
    if (isolation.lifecycleNegative) reasons.add('isolation-failed');
    if (isolation.artifactMismatch) reasons.add('artifact-binding-failed');
    if (isolation.teardownFailure) reasons.add('teardown-failed');
    if (isolation.securityProbeUnverified) reasons.add('security-probes-unverified');
  }
  checkDeadline(context);
  const reasonList = [...reasons].sort((left, right) => left.localeCompare(right));
  const canonicalEvidenceSha256s = [...canonicalEvidence].sort((left, right) =>
    left.localeCompare(right),
  );
  if (!unique(canonicalEvidenceSha256s)) fail('RELEASE_DUPLICATE_EVIDENCE');
  const decisionInput = parseWith(DecisionInputSchema, {
    schemaVersion: PRODUCT_FACTORY_DECISION_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    evaluationId: candidate.evaluationId,
    evidenceNonce: candidate.evidenceNonce,
    candidateSha256: candidate.candidateSha256,
    evaluatedAt: context.nowIso,
    status: decisionStatus(reasons),
    activationEligible: false,
    reasons: reasonList,
    canonicalEvidenceSha256s,
    opaqueEvidenceSha256s: [
      hashProductFactoryReleasePayload(candidate.forgeBenchReference),
      ...candidate.gateGroups.flatMap(({ gates }) => gates.map(({ gateSha256 }) => gateSha256)),
    ].sort((left, right) => left.localeCompare(right)),
    limitations: [
      'NO_PUBLIC_PRODUCTION_RELEASE_CAPABILITY',
      'PF4_AND_GATE_REFERENCES_ARE_OPAQUE_UNTRUSTED_INPUTS',
      'CALLBACK_VERIFIERS_ARE_NOT_EXECUTED',
      'REPLAY_REGISTRY_IS_PROCESS_LOCAL_AND_NOT_DURABLE_ACROSS_RESTARTS',
      'NO_DEPLOY_TAG_OR_RELEASE_MUTATION_PERFORMED',
    ],
  });
  return deepFreeze({
    ...decisionInput,
    decisionSha256: hashProductFactoryReleasePayload(decisionInput),
  }) as ProductFactoryReleaseDecision;
}

export async function evaluateProductFactoryRelease(
  input: unknown,
  contextInput: ProductFactoryReleaseEvaluationContext,
): Promise<ProductFactoryReleaseDecision> {
  const context = snapshotContext(contextInput);
  const candidate = parseProductFactoryReleaseCandidate(input);
  const reservation = reserveReplay(candidate, () => resolveAndSeal(candidate, context));
  try {
    const decision = await reservation.cell.pending;
    reservation.cell.decision = decision;
    return decision;
  } catch (error) {
    if (!reservation.existing) releaseFailedReservation(candidate, reservation.cell);
    throw error;
  }
}

export async function parseProductFactoryReleaseDecision(
  input: unknown,
  candidateInput: unknown,
  contextInput: ProductFactoryReleaseEvaluationContext,
): Promise<ProductFactoryReleaseDecision> {
  assertBounded(input);
  const value = parseWith(DecisionSchema, input);
  if (value.decisionSha256 !== hashProductFactoryReleasePayload(without(value, 'decisionSha256'))) {
    fail('RELEASE_DIGEST_INVALID');
  }
  const context = snapshotContext(contextInput);
  const candidate = parseProductFactoryReleaseCandidate(candidateInput);
  const expected = await resolveAndSeal(candidate, context);
  if (!exact(value, expected)) fail('RELEASE_BINDING_INVALID');
  return value;
}
