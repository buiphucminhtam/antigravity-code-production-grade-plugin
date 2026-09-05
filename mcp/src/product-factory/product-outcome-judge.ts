import { z } from 'zod';
import { ProductIntent, SafeIdSchema, parseProductIntent } from './product-intent.js';
import {
  ProductOutcomeAssertionCategory,
  ProductOutcomeContract,
  ProductOutcomeJourney,
  hashProductOutcomePayload,
  parseProductOutcomeContract,
} from './product-outcome-contract.js';
import {
  ProductOutcomeResultReceipt,
  ProductOutcomeResultVerificationContext,
  parseProductOutcomeResultReceipt,
} from './product-outcome-runner.js';

export const PRODUCT_OUTCOME_SPECIALIST_RECEIPT_SCHEMA_VERSION = 'specialist-receipt/v1' as const;
export const PRODUCT_OUTCOME_JUDGMENT_SCHEMA_VERSION = 'product-outcome-judgment/v1' as const;
export const PRODUCT_OUTCOME_JUDGE_MAX_BYTES = 256 * 1024;

const MAX_ITEMS = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_TEXT =
  /(?:bearer(?:-|\s)|private-key|api-key|access-key|secret-key|password|credential|-----begin|\bsk-[a-z0-9]{16})/i;
const HIGH_ENTROPY_TEXT = /[A-Za-z0-9+/_=-]{40,}/;

export const PRODUCT_OUTCOME_SPECIALIST_CATEGORIES = [
  'requirement',
  'environment',
  'visual',
  'accessibility',
  'performance',
  'security',
  'reliability',
  'release',
] as const;

export type ProductOutcomeSpecialistCategory =
  (typeof PRODUCT_OUTCOME_SPECIALIST_CATEGORIES)[number];
export type ProductOutcomeJudgmentStatus = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'REQUIRES_HUMAN_REVIEW';
export type ProductOutcomeJudgmentReason =
  | 'all-required-evidence-passed'
  | 'journey-failed'
  | 'journey-unverified'
  | 'negative-path-observed'
  | 'required-specialist-missing'
  | 'specialist-evidence-stale'
  | 'specialist-failed'
  | 'specialist-human-review-required'
  | 'specialist-unverified'
  | 'subjective-human-review-required';

export type ProductOutcomeJudgeErrorCode =
  | 'JUDGE_SIZE_LIMIT'
  | 'JUDGE_MALFORMED'
  | 'JUDGE_DIGEST_INVALID'
  | 'JUDGE_BINDING_INVALID'
  | 'JUDGE_DUPLICATE_CATEGORY';

export class ProductOutcomeJudgeValidationError extends Error {
  constructor(readonly code: ProductOutcomeJudgeErrorCode) {
    super(code);
    this.name = 'ProductOutcomeJudgeValidationError';
  }
}

const fail = (code: ProductOutcomeJudgeErrorCode): never => {
  throw new ProductOutcomeJudgeValidationError(code);
};

/**
 * Zod's `safeParse` result is deliberately conservative under this project's
 * exact optional-property settings.  Keep the runtime proof adjacent to every
 * boundary parse instead of asserting a value that has not been checked.
 */
function parseOrFail<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  code: ProductOutcomeJudgeErrorCode,
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data === undefined) fail(code);
  return parsed.data;
}

function assertFound<T>(
  value: T,
  code: ProductOutcomeJudgeErrorCode,
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) fail(code);
}

function requireFound<T>(value: T, code: ProductOutcomeJudgeErrorCode): NonNullable<T> {
  assertFound(value, code);
  return value;
}

function boundedBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) fail('JUDGE_MALFORMED');
    return Buffer.byteLength(serialized, 'utf8');
  } catch (error) {
    if (error instanceof ProductOutcomeJudgeValidationError) throw error;
    return fail('JUDGE_MALFORMED');
  }
}

function assertBounded(value: unknown): void {
  if (boundedBytes(value) > PRODUCT_OUTCOME_JUDGE_MAX_BYTES) fail('JUDGE_SIZE_LIMIT');
}

function isSafeText(value: string): boolean {
  return !SENSITIVE_TEXT.test(value) && !HIGH_ENTROPY_TEXT.test(value);
}

const HashSchema = z.string().regex(SHA256_PATTERN);
const TimestampSchema = z.string().datetime({ offset: true });
const LimitationSchema = z.string().trim().min(1).max(4096).refine(isSafeText);
const SafeIdentifierSchema = SafeIdSchema.refine(isSafeText);
const TestReferenceSchema = z
  .string()
  .max(512)
  .regex(/^[a-z0-9][a-z0-9._/-]*\.[a-z0-9]{1,16}(?:::[a-z0-9_.-]+)?$/i)
  .refine((value) => !value.includes('..') && isSafeText(value));
const EvidenceProjectionSchema = z
  .object({
    sha256: HashSchema,
    bytes: z.number().int().min(0),
    mediaType: z.string().trim().min(1).max(128).refine(isSafeText),
    refSha256: HashSchema,
  })
  .strict();
const SpecialistCategorySchema = z.enum(PRODUCT_OUTCOME_SPECIALIST_CATEGORIES);
const SpecialistStatusSchema = z.enum(['PASS', 'FAIL', 'UNVERIFIED', 'REQUIRES_HUMAN_REVIEW']);

const SpecialistReceiptInputSchema = z
  .object({
    contractSha256: HashSchema,
    intentHash: HashSchema,
    resultSha256: HashSchema,
    scenarioId: SafeIdSchema,
    executionId: SafeIdSchema,
    category: SpecialistCategorySchema,
    applicable: z.boolean(),
    status: SpecialistStatusSchema,
    evidenceAuthority: z.enum(['production', 'test-only']),
    verifierId: SafeIdentifierSchema,
    verifierDigest: HashSchema,
    testRefs: z.array(TestReferenceSchema).max(MAX_ITEMS),
    evidence: z.array(EvidenceProjectionSchema).min(1).max(MAX_ITEMS),
    evidenceSha256: HashSchema,
    negativePaths: z.array(SafeIdentifierSchema).max(MAX_ITEMS),
    limitations: z.array(LimitationSchema).max(MAX_ITEMS),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict();

export const ProductOutcomeSpecialistReceiptSchema = SpecialistReceiptInputSchema.extend({
  schemaVersion: z.literal(PRODUCT_OUTCOME_SPECIALIST_RECEIPT_SCHEMA_VERSION),
  receiptSha256: HashSchema,
}).strict();

export type ProductOutcomeSpecialistReceiptInput = z.input<typeof SpecialistReceiptInputSchema>;
export type ProductOutcomeSpecialistReceipt = z.infer<typeof ProductOutcomeSpecialistReceiptSchema>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

type SpecialistEvidenceProjection = z.output<typeof EvidenceProjectionSchema>;

function canonicalizeEvidence(
  evidence: readonly SpecialistEvidenceProjection[],
): SpecialistEvidenceProjection[] {
  const byDigest = new Map<string, SpecialistEvidenceProjection>();
  for (const item of evidence) {
    const key = `${item.sha256}:${item.refSha256}`;
    const existing = byDigest.get(key);
    if (existing && (existing.bytes !== item.bytes || existing.mediaType !== item.mediaType)) {
      fail('JUDGE_MALFORMED');
    }
    byDigest.set(key, existing ?? item);
  }
  return [...byDigest.values()].sort((left, right) =>
    `${left.sha256}:${left.refSha256}`.localeCompare(`${right.sha256}:${right.refSha256}`),
  );
}

function evidenceDigest(evidence: readonly SpecialistEvidenceProjection[]): string {
  return hashProductOutcomePayload(canonicalizeEvidence(evidence));
}

function canonicalizeSpecialistReceipt<T extends ProductOutcomeSpecialistReceiptInput>(
  value: T,
): T {
  return {
    ...value,
    testRefs: uniqueSorted(value.testRefs),
    evidence: canonicalizeEvidence(value.evidence),
    negativePaths: uniqueSorted(value.negativePaths),
    limitations: uniqueSorted(value.limitations),
  };
}

function assertSpecialistRelationships(value: ProductOutcomeSpecialistReceiptInput): void {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) fail('JUDGE_MALFORMED');
  if (value.evidenceSha256 !== evidenceDigest(value.evidence)) fail('JUDGE_DIGEST_INVALID');
  if (value.status === 'PASS' && value.applicable && value.testRefs.length === 0) {
    fail('JUDGE_MALFORMED');
  }
  if (value.status === 'PASS' && value.negativePaths.length > 0) {
    fail('JUDGE_MALFORMED');
  }
  if (value.negativePaths.length > 0 && value.status !== 'FAIL') fail('JUDGE_MALFORMED');
}

export function createProductOutcomeSpecialistReceipt(
  input: ProductOutcomeSpecialistReceiptInput,
): ProductOutcomeSpecialistReceipt {
  assertBounded(input);
  const parsed = parseOrFail(SpecialistReceiptInputSchema, input, 'JUDGE_MALFORMED');
  const canonical = canonicalizeSpecialistReceipt(parsed);
  assertSpecialistRelationships(canonical);
  const hashable = {
    schemaVersion: PRODUCT_OUTCOME_SPECIALIST_RECEIPT_SCHEMA_VERSION,
    ...canonical,
  };
  return { ...hashable, receiptSha256: hashProductOutcomePayload(hashable) };
}

export function parseProductOutcomeSpecialistReceipt(
  input: unknown,
): ProductOutcomeSpecialistReceipt {
  assertBounded(input);
  const value = parseOrFail(ProductOutcomeSpecialistReceiptSchema, input, 'JUDGE_MALFORMED');
  assertSpecialistRelationships(value);
  const canonicalInput = canonicalizeSpecialistReceipt({
    contractSha256: value.contractSha256,
    intentHash: value.intentHash,
    resultSha256: value.resultSha256,
    scenarioId: value.scenarioId,
    executionId: value.executionId,
    category: value.category,
    applicable: value.applicable,
    status: value.status,
    evidenceAuthority: value.evidenceAuthority,
    verifierId: value.verifierId,
    verifierDigest: value.verifierDigest,
    testRefs: value.testRefs,
    evidence: value.evidence,
    evidenceSha256: value.evidenceSha256,
    negativePaths: value.negativePaths,
    limitations: value.limitations,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  });
  const hashable = {
    schemaVersion: PRODUCT_OUTCOME_SPECIALIST_RECEIPT_SCHEMA_VERSION,
    ...canonicalInput,
  };
  if (hashProductOutcomePayload(hashable) !== value.receiptSha256) {
    fail('JUDGE_DIGEST_INVALID');
  }
  return { ...hashable, receiptSha256: value.receiptSha256 };
}

export const PRODUCT_OUTCOME_ASSERTION_TO_SPECIALIST_CATEGORY: Readonly<
  Record<ProductOutcomeAssertionCategory, ProductOutcomeSpecialistCategory | null>
> = {
  requirement: 'requirement',
  environment: 'environment',
  visual: 'visual',
  accessibility: 'accessibility',
  performance: 'performance',
  security: 'security',
  reliability: 'reliability',
  release: 'release',
  'subjective-game': null,
};

function resolveCanonicalInputs(
  contractInput: unknown,
  intentInput: unknown,
  scenarioId: string,
): { contract: ProductOutcomeContract; intent: ProductIntent; journey: ProductOutcomeJourney } {
  let contract: ProductOutcomeContract;
  let intent: ProductIntent;
  try {
    contract = parseProductOutcomeContract(contractInput);
    intent = parseProductIntent(intentInput);
  } catch {
    return fail('JUDGE_BINDING_INVALID');
  }
  if (
    contract.intent.intentId !== intent.intentId ||
    contract.intent.version !== intent.version ||
    contract.intent.hash !== intent.hash
  ) {
    fail('JUDGE_BINDING_INVALID');
  }
  const journey = requireFound(
    contract.journeys.find((candidate) => candidate.scenarioId === scenarioId),
    'JUDGE_BINDING_INVALID',
  );
  const scenario = requireFound(
    intent.scenarios.find((candidate) => candidate.id === scenarioId),
    'JUDGE_BINDING_INVALID',
  );
  if (
    journey.desiredOutcomeIds.some(
      (outcomeId) =>
        !contract.desiredOutcomeIds.includes(outcomeId) || !scenario.outcomeIds.includes(outcomeId),
    )
  ) {
    fail('JUDGE_BINDING_INVALID');
  }
  return { contract, intent, journey };
}

export function deriveRequiredProductOutcomeSpecialistCategories(
  contractInput: unknown,
  intentInput: unknown,
  scenarioId: string,
): ProductOutcomeSpecialistCategory[] {
  const { journey } = resolveCanonicalInputs(contractInput, intentInput, scenarioId);
  if (!journey.applicable || !journey.runnable) return [];
  const required = new Set<ProductOutcomeSpecialistCategory>(['environment']);
  for (const assertion of journey.assertions) {
    const category = PRODUCT_OUTCOME_ASSERTION_TO_SPECIALIST_CATEGORY[assertion.category];
    if (category !== null) required.add(category);
  }
  return [...required].sort((left, right) => left.localeCompare(right));
}

const JudgmentReasonSchema = z.enum([
  'all-required-evidence-passed',
  'journey-failed',
  'journey-unverified',
  'negative-path-observed',
  'required-specialist-missing',
  'specialist-evidence-stale',
  'specialist-failed',
  'specialist-human-review-required',
  'specialist-unverified',
  'subjective-human-review-required',
]);

const JudgmentInputSchema = z
  .object({
    schemaVersion: z.literal(PRODUCT_OUTCOME_JUDGMENT_SCHEMA_VERSION),
    contractSha256: HashSchema,
    intentHash: HashSchema,
    resultSha256: HashSchema,
    scenarioId: SafeIdSchema,
    executionId: SafeIdSchema,
    status: SpecialistStatusSchema,
    reason: JudgmentReasonSchema,
    evidenceAuthority: z.enum(['production', 'test-only']),
    requiredCategories: z
      .array(SpecialistCategorySchema)
      .max(PRODUCT_OUTCOME_SPECIALIST_CATEGORIES.length),
    includedReceiptSha256s: z.array(HashSchema).max(PRODUCT_OUTCOME_SPECIALIST_CATEGORIES.length),
    judgedAt: TimestampSchema,
  })
  .strict();

export const ProductOutcomeJudgmentSchema = JudgmentInputSchema.extend({
  judgmentSha256: HashSchema,
}).strict();

export type ProductOutcomeJudgment = z.infer<typeof ProductOutcomeJudgmentSchema>;

export type ProductOutcomeSpecialistReceiptVerifier = (
  receipt: ProductOutcomeSpecialistReceipt,
) => Promise<boolean>;

export interface ProductOutcomeJudgeInput {
  runnerResult: unknown;
  runnerVerification: ProductOutcomeResultVerificationContext;
  specialistReceipts: readonly unknown[];
  judgedAt: string;
  verifySpecialistReceipt?: ProductOutcomeSpecialistReceiptVerifier;
}

interface ResolvedJudgeContext {
  contract: ProductOutcomeContract;
  intent: ProductIntent;
  journey: ProductOutcomeJourney;
  result: ProductOutcomeResultReceipt;
  receipts: ProductOutcomeSpecialistReceipt[];
  trustedReceiptHashes: ReadonlySet<string>;
  requiredCategories: ProductOutcomeSpecialistCategory[];
  judgedAt: string;
}

async function resolveJudgeContext(input: ProductOutcomeJudgeInput): Promise<ResolvedJudgeContext> {
  assertBounded(input);
  const judgedAt = parseOrFail(TimestampSchema, input.judgedAt, 'JUDGE_MALFORMED');
  let result: ProductOutcomeResultReceipt;
  try {
    result = await parseProductOutcomeResultReceipt(input.runnerResult, input.runnerVerification);
  } catch {
    return fail('JUDGE_BINDING_INVALID');
  }
  const { contract, intent, journey } = resolveCanonicalInputs(
    input.runnerVerification.contract,
    input.runnerVerification.intent,
    result.scenarioId,
  );
  if (
    result.contractSha256 !== contract.contractSha256 ||
    result.intentHash !== intent.hash ||
    result.evidenceAuthority !== contract.evidenceAuthority ||
    Date.parse(judgedAt) < Date.parse(result.requestedAt)
  ) {
    fail('JUDGE_BINDING_INVALID');
  }
  if (input.specialistReceipts.length > PRODUCT_OUTCOME_SPECIALIST_CATEGORIES.length) {
    fail('JUDGE_MALFORMED');
  }
  const receipts = input.specialistReceipts.map(parseProductOutcomeSpecialistReceipt);
  const categories = receipts.map(({ category }) => category);
  if (new Set(categories).size !== categories.length) fail('JUDGE_DUPLICATE_CATEGORY');
  for (const receipt of receipts) {
    if (
      receipt.contractSha256 !== contract.contractSha256 ||
      receipt.intentHash !== intent.hash ||
      receipt.resultSha256 !== result.resultSha256 ||
      receipt.scenarioId !== result.scenarioId ||
      receipt.executionId !== result.executionId ||
      (contract.evidenceAuthority === 'test-only' && receipt.evidenceAuthority === 'production')
    ) {
      fail('JUDGE_BINDING_INVALID');
    }
  }
  const trustedReceiptHashes = new Set<string>();
  if (input.verifySpecialistReceipt) {
    for (const receipt of receipts) {
      if (!receipt.applicable) continue;
      try {
        if (await input.verifySpecialistReceipt(receipt)) {
          trustedReceiptHashes.add(receipt.receiptSha256);
        }
      } catch {
        // A verifier outage is unverified evidence, never an implicit pass.
      }
    }
  }
  return {
    contract,
    intent,
    journey,
    result,
    receipts: [...receipts].sort((left, right) => left.category.localeCompare(right.category)),
    trustedReceiptHashes,
    requiredCategories: deriveRequiredProductOutcomeSpecialistCategories(
      contract,
      intent,
      result.scenarioId,
    ),
    judgedAt,
  };
}

function derivedStatus(context: ResolvedJudgeContext): {
  status: ProductOutcomeJudgmentStatus;
  reason: ProductOutcomeJudgmentReason;
} {
  const { result, journey, receipts, requiredCategories, judgedAt, trustedReceiptHashes } = context;
  const trustedApplicable = receipts.filter(
    (receipt) => receipt.applicable && trustedReceiptHashes.has(receipt.receiptSha256),
  );
  if (
    result.negativePaths.length > 0 ||
    trustedApplicable.some(({ negativePaths }) => negativePaths.length > 0)
  ) {
    return { status: 'FAIL', reason: 'negative-path-observed' };
  }
  if (result.status === 'FAIL') return { status: 'FAIL', reason: 'journey-failed' };
  if (trustedApplicable.some((receipt) => receipt.status === 'FAIL')) {
    return { status: 'FAIL', reason: 'specialist-failed' };
  }
  if (
    result.status === 'REQUIRES_HUMAN_REVIEW' ||
    journey.assertions.some(({ category }) => category === 'subjective-game')
  ) {
    return { status: 'REQUIRES_HUMAN_REVIEW', reason: 'subjective-human-review-required' };
  }
  if (trustedApplicable.some((receipt) => receipt.status === 'REQUIRES_HUMAN_REVIEW')) {
    return {
      status: 'REQUIRES_HUMAN_REVIEW',
      reason: 'specialist-human-review-required',
    };
  }
  if (result.status === 'UNVERIFIED') {
    return { status: 'UNVERIFIED', reason: 'journey-unverified' };
  }
  if (
    receipts.some(
      (receipt) => receipt.applicable && !trustedReceiptHashes.has(receipt.receiptSha256),
    )
  ) {
    return { status: 'UNVERIFIED', reason: 'specialist-unverified' };
  }
  if (
    receipts.some(
      (receipt) =>
        trustedReceiptHashes.has(receipt.receiptSha256) &&
        (Date.parse(receipt.issuedAt) < Date.parse(result.requestedAt) ||
          Date.parse(receipt.issuedAt) > Date.parse(judgedAt) ||
          Date.parse(receipt.expiresAt) < Date.parse(judgedAt)),
    )
  ) {
    return { status: 'UNVERIFIED', reason: 'specialist-evidence-stale' };
  }
  const byCategory = new Map(receipts.map((receipt) => [receipt.category, receipt]));
  if (
    requiredCategories.some((category) => {
      const receipt = byCategory.get(category);
      return !receipt || !receipt.applicable;
    })
  ) {
    return { status: 'UNVERIFIED', reason: 'required-specialist-missing' };
  }
  if (trustedApplicable.some((receipt) => receipt.status === 'UNVERIFIED')) {
    return { status: 'UNVERIFIED', reason: 'specialist-unverified' };
  }
  if (requiredCategories.some((category) => byCategory.get(category)?.status !== 'PASS')) {
    return { status: 'UNVERIFIED', reason: 'specialist-unverified' };
  }
  return { status: 'PASS', reason: 'all-required-evidence-passed' };
}

export async function judgeProductOutcome(
  input: ProductOutcomeJudgeInput,
): Promise<ProductOutcomeJudgment> {
  const context = await resolveJudgeContext(input);
  const outcome = derivedStatus(context);
  const evidenceAuthority =
    context.result.evidenceAuthority === 'test-only' ||
    context.receipts.some((receipt) => receipt.evidenceAuthority === 'test-only')
      ? 'test-only'
      : 'production';
  const hashable = {
    schemaVersion: PRODUCT_OUTCOME_JUDGMENT_SCHEMA_VERSION,
    contractSha256: context.contract.contractSha256,
    intentHash: context.intent.hash,
    resultSha256: context.result.resultSha256,
    scenarioId: context.result.scenarioId,
    executionId: context.result.executionId,
    ...outcome,
    evidenceAuthority,
    requiredCategories: context.requiredCategories,
    includedReceiptSha256s: context.receipts
      .map(({ receiptSha256 }) => receiptSha256)
      .sort((left, right) => left.localeCompare(right)),
    judgedAt: context.judgedAt,
  };
  const parsed = parseOrFail(JudgmentInputSchema, hashable, 'JUDGE_MALFORMED');
  return { ...parsed, judgmentSha256: hashProductOutcomePayload(parsed) };
}

export async function parseProductOutcomeJudgment(
  input: unknown,
  context: ProductOutcomeJudgeInput,
): Promise<ProductOutcomeJudgment> {
  assertBounded(input);
  const value = parseOrFail(ProductOutcomeJudgmentSchema, input, 'JUDGE_MALFORMED');
  const hashable = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'judgmentSha256'),
  );
  if (hashProductOutcomePayload(hashable) !== value.judgmentSha256) {
    fail('JUDGE_DIGEST_INVALID');
  }
  const expected = await judgeProductOutcome(context);
  if (hashProductOutcomePayload(expected) !== hashProductOutcomePayload(value)) {
    fail('JUDGE_BINDING_INVALID');
  }
  return value;
}

export const createSpecialistReceipt = createProductOutcomeSpecialistReceipt;
export const parseSpecialistReceipt = parseProductOutcomeSpecialistReceipt;
export const deriveRequiredSpecialistCategories = deriveRequiredProductOutcomeSpecialistCategories;
