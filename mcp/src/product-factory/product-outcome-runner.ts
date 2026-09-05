import { z } from 'zod';
import {
  EnvironmentAci,
  EnvironmentAciDescriptor,
  EnvironmentEvidenceArtifact,
  EnvironmentKind,
  EnvironmentScenario,
  EnvironmentScenarioReceipt,
  HostEnvironmentCapability,
  JsonValue,
  negotiateEnvironmentAci,
  parseEnvironmentAciDescriptor,
  parseEnvironmentScenario,
  parseEnvironmentScenarioReceipt,
} from './environment-aci.js';
import { ProductIntent, SafeIdSchema, parseProductIntent } from './product-intent.js';
import {
  ProductOutcomeAssertion,
  ProductOutcomeContract,
  ProductOutcomeJourney,
  hashProductOutcomePayload,
  parseProductOutcomeContract,
  validateProductOutcomeContractReferences,
} from './product-outcome-contract.js';

export const PRODUCT_OUTCOME_RESULT_SCHEMA_VERSION = 'product-outcome-result/v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ITEMS = 256;
const TextSchema = z.string().trim().min(1).max(4096);
const HashSchema = z.string().regex(SHA256);
const TimestampSchema = z.string().datetime({ offset: true });
const SENSITIVE_TEXT =
  /(?:bearer(?:-|\s)|private-key|api-key|access-key|secret-key|password|credential|-----begin|\bsk-[a-z0-9]{16})/i;
const HIGH_ENTROPY_TEXT = /[A-Za-z0-9+/_=-]{40,}/;
const MAX_EXECUTION_RESERVATIONS = 4096;

export type ProductOutcomeResultStatus = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'REQUIRES_HUMAN_REVIEW';
export type ProductOutcomeResultReason =
  | 'assertion-failed'
  | 'journey-not-runnable'
  | 'negative-path-observed'
  | 'production-attestation-missing'
  | 'required-evidence-missing'
  | 'runtime-outcome-evidence-missing'
  | 'synthetic-user-test-only'
  | 'subjective-human-review-required';

export class ProductOutcomeResultValidationError extends Error {
  constructor(
    readonly code: 'RESULT_MALFORMED' | 'RESULT_DIGEST_INVALID' | 'RESULT_BINDING_INVALID',
  ) {
    super(code);
    this.name = 'ProductOutcomeResultValidationError';
  }
}
const fail = (code: ProductOutcomeResultValidationError['code']): never => {
  throw new ProductOutcomeResultValidationError(code);
};

const AssertionResultSchema = z
  .object({
    assertionId: SafeIdSchema,
    status: z.enum(['PASS', 'FAIL', 'REQUIRES_HUMAN_REVIEW']),
    reason: z.enum(['assertion-failed', 'subjective-human-review-required']).nullable(),
  })
  .strict();
const ArtifactProjectionSchema = z
  .object({ sha256: HashSchema, bytes: z.number().int().min(0), mediaType: TextSchema })
  .strict();
const ReasonSchema = z.enum([
  'assertion-failed',
  'journey-not-runnable',
  'negative-path-observed',
  'production-attestation-missing',
  'required-evidence-missing',
  'runtime-outcome-evidence-missing',
  'synthetic-user-test-only',
  'subjective-human-review-required',
]);
const ResultInputSchema = z
  .object({
    schemaVersion: z.literal(PRODUCT_OUTCOME_RESULT_SCHEMA_VERSION),
    status: z.enum(['PASS', 'FAIL', 'UNVERIFIED', 'REQUIRES_HUMAN_REVIEW']),
    reason: ReasonSchema.nullable(),
    contractSha256: HashSchema,
    intentHash: HashSchema,
    scenarioId: SafeIdSchema,
    executionId: SafeIdSchema,
    requestedAt: TimestampSchema,
    deadlineAt: TimestampSchema,
    executed: z.boolean(),
    evidenceAuthority: z.enum(['production', 'test-only']),
    aciStatus: z.enum(['PASS', 'FAIL', 'UNVERIFIED']).nullable(),
    assertionResults: z.array(AssertionResultSchema).max(MAX_ITEMS),
    artifacts: z.array(ArtifactProjectionSchema).max(MAX_ITEMS),
    negativePaths: z.array(SafeIdSchema).max(MAX_ITEMS),
    limitations: z.array(SafeIdSchema).max(MAX_ITEMS),
    scenarioExecutionSha256: HashSchema.nullable(),
  })
  .strict();
const ResultSchema = ResultInputSchema.extend({ resultSha256: HashSchema }).strict();
export type ProductOutcomeResultReceipt = z.infer<typeof ResultSchema>;

export const ProductionEnvironmentAttestationSchema = z
  .object({
    contractSha256: HashSchema,
    environmentFingerprint: HashSchema,
    capabilityFingerprint: HashSchema,
    scenarioId: SafeIdSchema,
    executionId: SafeIdSchema,
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid attestation interval.' });
  });
export type ProductionEnvironmentAttestation = z.infer<
  typeof ProductionEnvironmentAttestationSchema
>;
export type ProductionAttestationVerifier = (
  attestation: ProductionEnvironmentAttestation,
) => Promise<boolean>;
export interface CriticalJourneyRunInput {
  contract: unknown;
  intent: unknown;
  scenarioId: string;
  executionId: string;
  requestedAt: string;
  deadlineAt: string;
}
export interface CriticalJourneyRunnerOptions {
  adapterDescriptor?: unknown;
  productionAttestation?: unknown;
  verifyProductionAttestation?: ProductionAttestationVerifier;
}
export interface ProductOutcomeResultVerificationContext {
  contract: unknown;
  intent: unknown;
  expectedScenario: EnvironmentScenario;
  scenarioReceipt?: EnvironmentScenarioReceipt;
  productionAttestation?: ProductionEnvironmentAttestation;
  verifyProductionAttestation?: ProductionAttestationVerifier;
}

const executionReservations = new Set<string>();

function reserveExecution(executionId: string): boolean {
  if (
    executionReservations.has(executionId) ||
    executionReservations.size >= MAX_EXECUTION_RESERVATIONS
  )
    return false;
  executionReservations.add(executionId);
  return true;
}

function canonicalStableList(values: readonly string[]): string[] {
  const parsed = values.map((value) => {
    const candidate = SafeIdSchema.safeParse(value);
    if (!candidate.success || SENSITIVE_TEXT.test(value) || HIGH_ENTROPY_TEXT.test(value)) {
      fail('RESULT_MALFORMED');
    }
    return value;
  });
  return [...new Set(parsed)].sort((left, right) => left.localeCompare(right));
}

function exactPayload(left: unknown, right: unknown): boolean {
  return hashProductOutcomePayload(left) === hashProductOutcomePayload(right);
}

type ArtifactProjection = z.infer<typeof ArtifactProjectionSchema>;

function canonicalArtifactProjections(
  artifacts: readonly ArtifactProjection[],
): ArtifactProjection[] {
  const unique = new Map<string, ArtifactProjection>();
  for (const artifact of artifacts) {
    const existing = unique.get(artifact.sha256);
    if (
      existing &&
      (existing.bytes !== artifact.bytes || existing.mediaType !== artifact.mediaType)
    ) {
      fail('RESULT_MALFORMED');
    }
    unique.set(artifact.sha256, existing ?? artifact);
  }
  return [...unique.values()].sort((left, right) => left.sha256.localeCompare(right.sha256));
}

function projectArtifacts(
  artifacts: readonly EnvironmentEvidenceArtifact[],
): z.infer<typeof ArtifactProjectionSchema>[] {
  return canonicalArtifactProjections(
    artifacts.map(({ sha256, bytes, mediaType }) => ({ sha256, bytes, mediaType })),
  );
}
function equalDescriptor(a: EnvironmentAciDescriptor, b: EnvironmentAciDescriptor): boolean {
  return (
    a.adapterId === b.adapterId &&
    a.environmentId === b.environmentId &&
    a.sessionId === b.sessionId &&
    a.kind === b.kind &&
    a.environmentFingerprint === b.environmentFingerprint &&
    a.capabilityFingerprint === b.capabilityFingerprint
  );
}
function requestedScenario(
  descriptor: EnvironmentAciDescriptor,
  journey: ProductOutcomeJourney,
  input: CriticalJourneyRunInput,
): EnvironmentScenario {
  return {
    schemaVersion: 'environment-aci/v1',
    adapterId: descriptor.adapterId,
    environmentId: descriptor.environmentId,
    sessionId: descriptor.sessionId,
    scenarioId: journey.scenarioId,
    executionId: input.executionId,
    requestedAt: input.requestedAt,
    deadlineAt: input.deadlineAt,
    steps: journey.actions.map(({ actionId, kind, payload }) => ({
      actionId,
      kind,
      payload: payload as JsonValue,
    })),
  };
}
function exactReceipt(
  receipt: EnvironmentScenarioReceipt,
  expected: EnvironmentScenario,
  descriptor: EnvironmentAciDescriptor,
): boolean {
  return (
    receipt.adapterId === expected.adapterId &&
    receipt.environmentId === expected.environmentId &&
    receipt.sessionId === expected.sessionId &&
    receipt.scenarioId === expected.scenarioId &&
    receipt.executionId === expected.executionId &&
    receipt.requestedAt === expected.requestedAt &&
    receipt.deadlineAt === expected.deadlineAt &&
    receipt.environmentFingerprint === descriptor.environmentFingerprint &&
    hashProductOutcomePayload(receipt.steps) === hashProductOutcomePayload(expected.steps)
  );
}
function observationValue(
  receipt: EnvironmentScenarioReceipt,
  actionId: string,
  path: readonly (string | number)[],
): unknown {
  let value: unknown = receipt.observations.find(
    (entry) => entry.afterActionId === actionId,
  )?.state;
  for (const segment of path) {
    if (value === null || typeof value !== 'object') return undefined;
    if (typeof segment === 'number') {
      if (!Array.isArray(value)) return undefined;
      value = value[segment];
    } else {
      if (Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, segment))
        return undefined;
      value = (value as Record<string, unknown>)[segment];
    }
  }
  return value;
}
function artifactsFor(
  receipt: EnvironmentScenarioReceipt,
  actionId: string,
  mediaType: string | null,
): EnvironmentEvidenceArtifact[] {
  const unique = new Map<string, EnvironmentEvidenceArtifact>();
  const scoped = new Map<string, EnvironmentEvidenceArtifact>();
  for (const evidence of receipt.evidence) {
    for (const artifact of evidence.artifacts) {
      const existing = unique.get(artifact.sha256);
      if (
        existing &&
        (existing.bytes !== artifact.bytes || existing.mediaType !== artifact.mediaType)
      ) {
        fail('RESULT_BINDING_INVALID');
      }
      if (!existing) unique.set(artifact.sha256, artifact);
      // Equal content may be observed again after a later action. Preserve that
      // validated association without counting aliases twice within either action.
      if (evidence.actionId === actionId) scoped.set(artifact.sha256, artifact);
    }
  }
  return [...scoped.values()].filter(
    (artifact) => mediaType === null || artifact.mediaType === mediaType,
  );
}

function canonicalRuntimeDiagnostics(
  journey: ProductOutcomeJourney,
  receipt: EnvironmentScenarioReceipt,
  evidenceAuthority: ProductOutcomeContract['evidenceAuthority'],
): Pick<ProductOutcomeResultReceipt, 'negativePaths' | 'limitations'> {
  const negativePaths = canonicalStableList(receipt.negativePaths);
  if (negativePaths.some((value) => !journey.negativePaths.includes(value))) {
    fail('RESULT_BINDING_INVALID');
  }
  const limitations = canonicalStableList(receipt.limitations);
  const allowedLimitations = new Set(
    journey.limitations.map((value) => {
      const parsed = SafeIdSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }),
  );
  if (limitations.some((value) => !allowedLimitations.has(value))) {
    fail('RESULT_BINDING_INVALID');
  }
  return {
    negativePaths,
    limitations: canonicalStableList([
      ...limitations,
      ...(evidenceAuthority === 'test-only' ? ['test-only-adapter-evidence'] : []),
    ]),
  };
}
function receiptValue(receipt: EnvironmentScenarioReceipt, field: string): unknown {
  const artifacts = receipt.evidence.flatMap((entry) => entry.artifacts);
  const values: Record<string, unknown> = {
    status: receipt.status,
    'action-count': receipt.actions.length,
    'evidence-count': receipt.evidence.length,
    'artifact-count': projectArtifacts(artifacts).length,
    'negative-path-count': receipt.negativePaths.length,
    'limitation-count': receipt.limitations.length,
    'duration-ms': Date.parse(receipt.completedAt) - Date.parse(receipt.startedAt),
  };
  return values[field];
}
function equalsExpected(
  actual: unknown,
  expected: Exclude<ProductOutcomeAssertion, { category: 'subjective-game' }>['expected'],
): boolean {
  if (expected.kind === 'existence')
    return expected.operator === 'exists' ? actual !== undefined : actual === undefined;
  if (expected.kind === 'boolean')
    return (
      typeof actual === 'boolean' &&
      (expected.operator === 'equals' ? actual === expected.value : actual !== expected.value)
    );
  if (expected.kind === 'string') {
    if (typeof actual !== 'string') return false;
    if (expected.operator === 'equals') return actual === expected.value;
    if (expected.operator === 'not-equals') return actual !== expected.value;
    if (expected.operator === 'contains') return actual.includes(expected.value);
    return expected.operator === 'starts-with'
      ? actual.startsWith(expected.value)
      : actual.endsWith(expected.value);
  }
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return false;
  if (expected.operator === 'equals') return actual === expected.value;
  if (expected.operator === 'not-equals') return actual !== expected.value;
  if (expected.operator === 'greater-than') return actual > expected.value;
  if (expected.operator === 'at-least') return actual >= expected.value;
  return expected.operator === 'less-than' ? actual < expected.value : actual <= expected.value;
}
function evaluate(
  assertion: ProductOutcomeAssertion,
  receipt: EnvironmentScenarioReceipt,
): z.infer<typeof AssertionResultSchema> {
  if (assertion.category === 'subjective-game')
    return {
      assertionId: assertion.id,
      status: 'REQUIRES_HUMAN_REVIEW',
      reason: 'subjective-human-review-required',
    };
  const actual =
    assertion.subject.kind === 'observation'
      ? observationValue(receipt, assertion.subject.actionId, assertion.subject.path)
      : assertion.subject.kind === 'artifact'
        ? assertion.subject.field === 'count'
          ? artifactsFor(receipt, assertion.subject.actionId, assertion.subject.mediaType).length
          : artifactsFor(receipt, assertion.subject.actionId, assertion.subject.mediaType).reduce(
              (total, artifact) => total + artifact.bytes,
              0,
            )
        : receiptValue(receipt, assertion.subject.field);
  const passed = equalsExpected(actual, assertion.expected);
  return {
    assertionId: assertion.id,
    status: passed ? 'PASS' : 'FAIL',
    reason: passed ? null : 'assertion-failed',
  };
}
function hasRuntimeEvidence(journey: ProductOutcomeJourney): boolean {
  return journey.assertions.some(
    (assertion) => assertion.category !== 'subjective-game' && assertion.subject.kind !== 'receipt',
  );
}
function hasRequiredEvidence(
  journey: ProductOutcomeJourney,
  receipt: EnvironmentScenarioReceipt,
): boolean {
  return journey.requiredEvidence.every((requirement) =>
    requirement.mediaTypes.every(
      (mediaType) =>
        artifactsFor(receipt, requirement.actionId, mediaType).length >=
        requirement.minimumArtifacts,
    ),
  );
}
function derivedOutcome(
  contract: ProductOutcomeContract,
  journey: ProductOutcomeJourney,
  receipt: EnvironmentScenarioReceipt,
  productionAuthorized: boolean,
): Pick<ProductOutcomeResultReceipt, 'status' | 'reason' | 'assertionResults'> {
  const assertionResults = journey.assertions.map((assertion) => evaluate(assertion, receipt));
  if (receipt.status === 'FAIL' || receipt.negativePaths.length > 0)
    return { status: 'FAIL', reason: 'negative-path-observed', assertionResults };
  if (receipt.status !== 'PASS')
    return { status: 'UNVERIFIED', reason: 'runtime-outcome-evidence-missing', assertionResults };
  if (!hasRequiredEvidence(journey, receipt))
    return { status: 'UNVERIFIED', reason: 'required-evidence-missing', assertionResults };
  if (assertionResults.some(({ status }) => status === 'FAIL'))
    return { status: 'FAIL', reason: 'assertion-failed', assertionResults };
  if (assertionResults.some(({ status }) => status === 'REQUIRES_HUMAN_REVIEW'))
    return {
      status: 'REQUIRES_HUMAN_REVIEW',
      reason: 'subjective-human-review-required',
      assertionResults,
    };
  if (!hasRuntimeEvidence(journey))
    return { status: 'UNVERIFIED', reason: 'runtime-outcome-evidence-missing', assertionResults };
  if (contract.evidenceAuthority === 'production' && !productionAuthorized)
    return { status: 'UNVERIFIED', reason: 'production-attestation-missing', assertionResults };
  return { status: 'PASS', reason: null, assertionResults };
}
function seal(
  input: Omit<ProductOutcomeResultReceipt, 'resultSha256'>,
): ProductOutcomeResultReceipt {
  const parsed = ResultInputSchema.safeParse(input);
  if (!parsed.success || !parsed.data) fail('RESULT_MALFORMED');
  const data = parsed.data as Omit<ProductOutcomeResultReceipt, 'resultSha256'>;
  assertCanonicalResultShape(data);
  return { ...data, resultSha256: hashProductOutcomePayload(data) };
}

type NonExecutedReason = Extract<
  ProductOutcomeResultReason,
  | 'journey-not-runnable'
  | 'production-attestation-missing'
  | 'runtime-outcome-evidence-missing'
  | 'synthetic-user-test-only'
>;

const NON_EXECUTED_LIMITATIONS: Readonly<Record<NonExecutedReason, readonly string[]>> = {
  'journey-not-runnable': ['journey-not-runnable'],
  'production-attestation-missing': ['production-attestation-missing'],
  'runtime-outcome-evidence-missing': ['runtime-outcome-evidence-missing'],
  'synthetic-user-test-only': ['synthetic-user-test-only'],
};

function assertCanonicalResultShape(data: Omit<ProductOutcomeResultReceipt, 'resultSha256'>): void {
  if (Date.parse(data.deadlineAt) <= Date.parse(data.requestedAt)) fail('RESULT_MALFORMED');
  const validStatusReason =
    (data.status === 'PASS' && data.reason === null) ||
    (data.status === 'FAIL' &&
      (data.reason === 'assertion-failed' || data.reason === 'negative-path-observed')) ||
    (data.status === 'UNVERIFIED' &&
      [
        'journey-not-runnable',
        'production-attestation-missing',
        'required-evidence-missing',
        'runtime-outcome-evidence-missing',
        'synthetic-user-test-only',
      ].includes(data.reason ?? '')) ||
    (data.status === 'REQUIRES_HUMAN_REVIEW' && data.reason === 'subjective-human-review-required');
  if (!validStatusReason) fail('RESULT_MALFORMED');
  if (!exactPayload(data.negativePaths, canonicalStableList(data.negativePaths))) {
    fail('RESULT_MALFORMED');
  }
  if (!exactPayload(data.limitations, canonicalStableList(data.limitations))) {
    fail('RESULT_MALFORMED');
  }
  const assertionIds = data.assertionResults.map(({ assertionId }) => assertionId);
  if (new Set(assertionIds).size !== assertionIds.length) fail('RESULT_MALFORMED');
  for (const assertion of data.assertionResults) {
    if (
      (assertion.status === 'PASS' && assertion.reason !== null) ||
      (assertion.status === 'FAIL' && assertion.reason !== 'assertion-failed') ||
      (assertion.status === 'REQUIRES_HUMAN_REVIEW' &&
        assertion.reason !== 'subjective-human-review-required')
    ) {
      fail('RESULT_MALFORMED');
    }
  }
  if (!exactPayload(data.artifacts, canonicalArtifactProjections(data.artifacts))) {
    fail('RESULT_MALFORMED');
  }
  if (!data.executed) {
    const limitations = NON_EXECUTED_LIMITATIONS[data.reason as NonExecutedReason];
    if (
      !limitations ||
      data.status !== 'UNVERIFIED' ||
      data.aciStatus !== null ||
      data.scenarioExecutionSha256 !== null ||
      data.artifacts.length > 0 ||
      data.assertionResults.length > 0 ||
      data.negativePaths.length > 0 ||
      !exactPayload(data.limitations, limitations)
    ) {
      fail('RESULT_MALFORMED');
    }
  } else if (data.aciStatus === null || data.scenarioExecutionSha256 === null) {
    fail('RESULT_MALFORMED');
  }
}

function nonExecutedValues(
  reason: NonExecutedReason,
): Omit<
  ProductOutcomeResultReceipt,
  | 'schemaVersion'
  | 'contractSha256'
  | 'intentHash'
  | 'scenarioId'
  | 'executionId'
  | 'requestedAt'
  | 'deadlineAt'
  | 'evidenceAuthority'
  | 'resultSha256'
> {
  return {
    status: 'UNVERIFIED',
    reason,
    executed: false,
    aciStatus: null,
    assertionResults: [],
    artifacts: [],
    negativePaths: [],
    limitations: [...NON_EXECUTED_LIMITATIONS[reason]],
    scenarioExecutionSha256: null,
  };
}

function createReceipt(
  contract: ProductOutcomeContract,
  intent: ProductIntent,
  input: CriticalJourneyRunInput,
  values: Omit<
    ProductOutcomeResultReceipt,
    | 'schemaVersion'
    | 'contractSha256'
    | 'intentHash'
    | 'scenarioId'
    | 'executionId'
    | 'requestedAt'
    | 'deadlineAt'
    | 'evidenceAuthority'
    | 'resultSha256'
  >,
): ProductOutcomeResultReceipt {
  return seal({
    schemaVersion: PRODUCT_OUTCOME_RESULT_SCHEMA_VERSION,
    contractSha256: contract.contractSha256,
    intentHash: intent.hash,
    scenarioId: input.scenarioId,
    executionId: input.executionId,
    requestedAt: input.requestedAt,
    deadlineAt: input.deadlineAt,
    evidenceAuthority: contract.evidenceAuthority,
    ...values,
  });
}
function parseResult(input: unknown): ProductOutcomeResultReceipt {
  const parsed = ResultSchema.safeParse(input);
  if (!parsed.success || !parsed.data) fail('RESULT_MALFORMED');
  const data = parsed.data as ProductOutcomeResultReceipt;
  const hashable = Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== 'resultSha256'),
  );
  if (hashProductOutcomePayload(hashable) !== data.resultSha256) fail('RESULT_DIGEST_INVALID');
  assertCanonicalResultShape(data);
  return data;
}

const PLATFORM_ENVIRONMENTS: Readonly<Record<EnvironmentKind, readonly string[]>> = {
  web: ['web', 'cross-platform'],
  android: ['mobile', 'cross-platform'],
  unity: ['game', 'cross-platform'],
};

function resolveVerificationContext(context: ProductOutcomeResultVerificationContext): {
  contract: ProductOutcomeContract;
  intent: ProductIntent;
  expectedScenario: EnvironmentScenario;
  journey: ProductOutcomeJourney;
} {
  if (!context || typeof context !== 'object') fail('RESULT_BINDING_INVALID');
  const allowedKeys = new Set([
    'contract',
    'intent',
    'expectedScenario',
    'scenarioReceipt',
    'productionAttestation',
    'verifyProductionAttestation',
  ]);
  if (Object.keys(context).some((key) => !allowedKeys.has(key))) {
    fail('RESULT_BINDING_INVALID');
  }
  let contract: ProductOutcomeContract;
  let intent: ProductIntent;
  let expectedScenario: EnvironmentScenario;
  try {
    contract = parseProductOutcomeContract(context.contract);
    intent = parseProductIntent(context.intent);
    expectedScenario = parseEnvironmentScenario(context.expectedScenario);
  } catch {
    return fail('RESULT_BINDING_INVALID');
  }
  if (
    contract.intent.intentId !== intent.intentId ||
    contract.intent.version !== intent.version ||
    contract.intent.hash !== intent.hash ||
    expectedScenario.adapterId !== contract.environment.adapterId ||
    expectedScenario.environmentId !== contract.environment.environmentId ||
    expectedScenario.sessionId !== contract.environment.sessionId
  ) {
    fail('RESULT_BINDING_INVALID');
  }
  const outcomeIds = new Set(intent.desiredOutcomes.map(({ id }) => id));
  const scenarios = new Map(intent.scenarios.map((scenario) => [scenario.id, scenario]));
  if (
    contract.desiredOutcomeIds.some((outcomeId) => !outcomeIds.has(outcomeId)) ||
    contract.scenarioIds.some((scenarioId) => !scenarios.has(scenarioId))
  ) {
    fail('RESULT_BINDING_INVALID');
  }
  for (const candidate of contract.journeys) {
    const scenario = scenarios.get(candidate.scenarioId);
    if (
      !scenario ||
      !PLATFORM_ENVIRONMENTS[contract.environment.kind].includes(scenario.platform) ||
      candidate.desiredOutcomeIds.some(
        (outcomeId) =>
          !contract.desiredOutcomeIds.includes(outcomeId) ||
          !scenario.outcomeIds.includes(outcomeId),
      )
    ) {
      fail('RESULT_BINDING_INVALID');
    }
  }
  const journey =
    contract.journeys.find(({ scenarioId }) => scenarioId === expectedScenario.scenarioId) ??
    fail('RESULT_BINDING_INVALID');
  const expectedSteps = journey.actions.map(({ actionId, kind, payload }) => ({
    actionId,
    kind,
    payload: payload as JsonValue,
  }));
  if (!exactPayload(expectedScenario.steps, expectedSteps)) fail('RESULT_BINDING_INVALID');
  return { contract, intent, expectedScenario, journey };
}

function exactProductionAttestation(
  attestation: ProductionEnvironmentAttestation,
  contract: ProductOutcomeContract,
  expectedScenario: EnvironmentScenario,
): boolean {
  return (
    attestation.contractSha256 === contract.contractSha256 &&
    attestation.environmentFingerprint === contract.environment.environmentFingerprint &&
    attestation.capabilityFingerprint === contract.environment.capabilityFingerprint &&
    attestation.scenarioId === expectedScenario.scenarioId &&
    attestation.executionId === expectedScenario.executionId &&
    Date.parse(attestation.issuedAt) <= Date.parse(expectedScenario.requestedAt) &&
    Date.parse(attestation.expiresAt) >= Date.parse(expectedScenario.deadlineAt)
  );
}

async function authorizeProductionAttestation(
  input: unknown,
  verifier: ProductionAttestationVerifier | undefined,
  contract: ProductOutcomeContract,
  expectedScenario: EnvironmentScenario,
): Promise<ProductionEnvironmentAttestation | null> {
  let attestation: ProductionEnvironmentAttestation;
  try {
    attestation = ProductionEnvironmentAttestationSchema.parse(input);
  } catch {
    return null;
  }
  if (!exactProductionAttestation(attestation, contract, expectedScenario) || !verifier)
    return null;
  try {
    const pending = verifier(attestation);
    if (!pending || typeof (pending as PromiseLike<boolean>).then !== 'function') return null;
    return (await pending) === true ? attestation : null;
  } catch {
    return null;
  }
}

function expectedNonExecutionReason(
  contract: ProductOutcomeContract,
  journey: ProductOutcomeJourney,
  productionAuthorized: boolean,
): NonExecutedReason {
  if (contract.syntheticUser) return 'synthetic-user-test-only';
  if (!journey.applicable || !journey.runnable) return 'journey-not-runnable';
  if (contract.evidenceAuthority === 'production' && !productionAuthorized) {
    return 'production-attestation-missing';
  }
  return 'runtime-outcome-evidence-missing';
}

export async function parseProductOutcomeResultReceipt(
  input: unknown,
  context: ProductOutcomeResultVerificationContext,
): Promise<ProductOutcomeResultReceipt> {
  const result = parseResult(input);
  const { contract, intent, expectedScenario, journey } = resolveVerificationContext(context);
  if (
    result.contractSha256 !== contract.contractSha256 ||
    result.intentHash !== intent.hash ||
    result.evidenceAuthority !== contract.evidenceAuthority ||
    result.scenarioId !== expectedScenario.scenarioId ||
    result.executionId !== expectedScenario.executionId ||
    result.requestedAt !== expectedScenario.requestedAt ||
    result.deadlineAt !== expectedScenario.deadlineAt
  ) {
    fail('RESULT_BINDING_INVALID');
  }
  const authorizedAttestation =
    contract.evidenceAuthority === 'production'
      ? await authorizeProductionAttestation(
          context.productionAttestation,
          context.verifyProductionAttestation,
          contract,
          expectedScenario,
        )
      : null;
  const productionAuthorized =
    contract.evidenceAuthority === 'test-only' || authorizedAttestation !== null;
  if (!result.executed) {
    if (context.scenarioReceipt !== undefined) fail('RESULT_BINDING_INVALID');
    const expectedReason = expectedNonExecutionReason(contract, journey, productionAuthorized);
    const expected = nonExecutedValues(expectedReason);
    if (
      result.status !== expected.status ||
      result.reason !== expected.reason ||
      !exactPayload(result.assertionResults, expected.assertionResults) ||
      !exactPayload(result.artifacts, expected.artifacts) ||
      !exactPayload(result.negativePaths, expected.negativePaths) ||
      !exactPayload(result.limitations, expected.limitations)
    ) {
      fail('RESULT_BINDING_INVALID');
    }
    return result;
  }
  if (contract.syntheticUser || !journey.applicable || !journey.runnable || !productionAuthorized) {
    fail('RESULT_BINDING_INVALID');
  }
  let scenario: EnvironmentScenarioReceipt;
  try {
    scenario = parseEnvironmentScenarioReceipt(context.scenarioReceipt);
  } catch {
    return fail('RESULT_BINDING_INVALID');
  }
  const descriptor = {
    adapterId: contract.environment.adapterId,
    environmentId: contract.environment.environmentId,
    sessionId: contract.environment.sessionId,
    kind: contract.environment.kind,
    environmentFingerprint: contract.environment.environmentFingerprint,
    capabilityFingerprint: contract.environment.capabilityFingerprint,
  } as EnvironmentAciDescriptor;
  if (!exactReceipt(scenario, expectedScenario, descriptor)) fail('RESULT_BINDING_INVALID');
  const expected = derivedOutcome(contract, journey, scenario, productionAuthorized);
  const artifacts = projectArtifacts(scenario.evidence.flatMap((entry) => entry.artifacts));
  const diagnostics = canonicalRuntimeDiagnostics(journey, scenario, contract.evidenceAuthority);
  if (
    result.scenarioExecutionSha256 !== scenario.receiptSha256 ||
    result.aciStatus !== scenario.status ||
    !exactPayload(result.artifacts, artifacts) ||
    !exactPayload(result.assertionResults, expected.assertionResults) ||
    !exactPayload(result.negativePaths, diagnostics.negativePaths) ||
    !exactPayload(result.limitations, diagnostics.limitations) ||
    result.status !== expected.status ||
    result.reason !== expected.reason
  ) {
    fail('RESULT_BINDING_INVALID');
  }
  return result;
}

function parseRunInput(input: CriticalJourneyRunInput): CriticalJourneyRunInput {
  const parsed = z
    .object({
      contract: z.unknown(),
      intent: z.unknown(),
      scenarioId: SafeIdSchema,
      executionId: SafeIdSchema,
      requestedAt: TimestampSchema,
      deadlineAt: TimestampSchema,
    })
    .strict()
    .safeParse(input);
  if (!parsed.success || !parsed.data) fail('RESULT_BINDING_INVALID');
  const value = parsed.data as CriticalJourneyRunInput;
  if (Date.parse(value.deadlineAt) <= Date.parse(value.requestedAt)) {
    fail('RESULT_BINDING_INVALID');
  }
  return value;
}

export class CriticalJourneyRunner {
  constructor(
    private readonly aci: EnvironmentAci,
    private readonly descriptor: EnvironmentAciDescriptor,
    private readonly hostCapability: HostEnvironmentCapability | undefined,
    private readonly options: CriticalJourneyRunnerOptions = {},
  ) {}
  async run(input: CriticalJourneyRunInput): Promise<ProductOutcomeResultReceipt> {
    const runInput = parseRunInput(input);
    const intent = (() => {
      try {
        return parseProductIntent(runInput.intent);
      } catch {
        throw new ProductOutcomeResultValidationError('RESULT_BINDING_INVALID');
      }
    })();
    const descriptor = (() => {
      try {
        return parseEnvironmentAciDescriptor(this.descriptor);
      } catch {
        throw new ProductOutcomeResultValidationError('RESULT_BINDING_INVALID');
      }
    })();
    const contract = (() => {
      try {
        return validateProductOutcomeContractReferences(runInput.contract, intent, descriptor);
      } catch {
        throw new ProductOutcomeResultValidationError('RESULT_BINDING_INVALID');
      }
    })();
    const journey = contract.journeys.find(({ scenarioId }) => scenarioId === runInput.scenarioId);
    if (!journey) throw new ProductOutcomeResultValidationError('RESULT_BINDING_INVALID');
    const unverified = (reason: NonExecutedReason): ProductOutcomeResultReceipt =>
      createReceipt(contract, intent, runInput, nonExecutedValues(reason));
    if (contract.syntheticUser) return unverified('synthetic-user-test-only');
    if (!journey.applicable || !journey.runnable) return unverified('journey-not-runnable');
    const expected = requestedScenario(descriptor, journey, runInput);
    let productionAttestation: ProductionEnvironmentAttestation | null = null;
    if (contract.evidenceAuthority === 'production') {
      productionAttestation = await authorizeProductionAttestation(
        this.options.productionAttestation,
        this.options.verifyProductionAttestation,
        contract,
        expected,
      );
      if (!productionAttestation) return unverified('production-attestation-missing');
    }
    let adapterDescriptor: EnvironmentAciDescriptor;
    const injectedDescriptor =
      this.options.adapterDescriptor ??
      (this.aci as unknown as { descriptor?: unknown }).descriptor;
    try {
      adapterDescriptor = parseEnvironmentAciDescriptor(injectedDescriptor);
    } catch {
      return unverified('runtime-outcome-evidence-missing');
    }
    if (!equalDescriptor(adapterDescriptor, descriptor))
      return unverified('runtime-outcome-evidence-missing');
    const adapter = Object.assign(Object.create(Object.getPrototypeOf(this.aci)), this.aci, {
      descriptor: adapterDescriptor,
    }) as EnvironmentAci & { descriptor: EnvironmentAciDescriptor };
    const negotiation = negotiateEnvironmentAci(adapter, this.hostCapability);
    if (negotiation.status !== 'PASS') return unverified('runtime-outcome-evidence-missing');
    if (!reserveExecution(runInput.executionId)) {
      return unverified('runtime-outcome-evidence-missing');
    }
    let scenario: EnvironmentScenarioReceipt;
    let artifacts: ArtifactProjection[];
    let diagnostics: Pick<ProductOutcomeResultReceipt, 'negativePaths' | 'limitations'>;
    try {
      scenario = parseEnvironmentScenarioReceipt(await this.aci.runScenario(expected));
      if (!exactReceipt(scenario, expected, descriptor)) throw new Error('invalid-binding');
      artifacts = projectArtifacts(scenario.evidence.flatMap((entry) => entry.artifacts));
      diagnostics = canonicalRuntimeDiagnostics(journey, scenario, contract.evidenceAuthority);
    } catch {
      return unverified('runtime-outcome-evidence-missing');
    }
    const outcome = derivedOutcome(
      contract,
      journey,
      scenario,
      contract.evidenceAuthority === 'test-only' || productionAttestation !== null,
    );
    return createReceipt(contract, intent, runInput, {
      ...outcome,
      executed: true,
      aciStatus: scenario.status,
      artifacts,
      ...diagnostics,
      scenarioExecutionSha256: scenario.receiptSha256,
    });
  }
}
export function createCriticalJourneyRunner(
  aci: EnvironmentAci,
  descriptor: EnvironmentAciDescriptor,
  hostCapability: HostEnvironmentCapability | undefined,
  options?: CriticalJourneyRunnerOptions,
): CriticalJourneyRunner {
  return new CriticalJourneyRunner(aci, descriptor, hostCapability, options);
}
