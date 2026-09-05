import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const ENVIRONMENT_ACI_SCHEMA_VERSION = 'environment-aci/v1' as const;
export const ENVIRONMENT_ACI_MAX_BYTES = 256 * 1024;
export const ENVIRONMENT_ACI_OPERATIONS = [
  'observe',
  'act',
  'reset',
  'snapshot',
  'restore',
  'runScenario',
  'collectEvidence',
] as const;

export type EnvironmentAciOperation = (typeof ENVIRONMENT_ACI_OPERATIONS)[number];
export type EnvironmentKind = 'web' | 'android' | 'unity';
export type EnvironmentReceiptStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const MAX_ITEMS = 128;
const MAX_TEXT = 4096;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_OPERATION_TIMEOUT_MS = 120_000;
const MAX_SESSION_REGISTRY_ENTRIES = 256;
const SAFE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SECRET_KEY_PATTERN =
  /(?:^|[-_])(authorization|cookie|credential|password|secret|token|api[-_]?key)(?:$|[-_])/i;

const SafeIdSchema = z.string().min(1).max(96).regex(SAFE_ID_PATTERN);
const Sha256Schema = z.string().regex(SHA256_PATTERN);
const TimestampSchema = z.string().datetime({ offset: true });
const TextSchema = z.string().trim().min(1).max(MAX_TEXT);
const TextListSchema = z.array(TextSchema).max(MAX_ITEMS);

export class EnvironmentAciValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentAciValidationError';
  }
}

function fail(message: string): never {
  throw new EnvironmentAciValidationError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonSafe(
  value: unknown,
  path = '$',
  seen = new Set<object>(),
): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must contain only finite JSON numbers.`);
    return;
  }
  if (typeof value !== 'object') fail(`${path} must be JSON-safe.`);
  if (seen.has(value)) fail(`${path} must not contain cycles.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ITEMS) fail(`${path} exceeds the item limit.`);
      value.forEach((entry, index) => assertJsonSafe(entry, `${path}[${index}]`, seen));
      return;
    }
    if (!isPlainObject(value)) fail(`${path} must contain only plain JSON objects.`);
    const keys = Object.keys(value);
    if (keys.length > MAX_ITEMS) fail(`${path} exceeds the property limit.`);
    for (const key of keys) {
      if (SECRET_KEY_PATTERN.test(key)) {
        fail(`${path}.${key} may contain a raw secret or credential and is not allowed.`);
      }
      assertJsonSafe(value[key], `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

const JsonValueSchema = z.unknown().superRefine((value, context) => {
  try {
    assertJsonSafe(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'Expected JSON-safe data.',
    });
  }
}) as z.ZodType<JsonValue>;

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key] as JsonValue)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  assertJsonSafe(value);
  return JSON.stringify(canonicalize(value));
}

export function hashEnvironmentAciPayload(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function boundedBytes(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

function assertBounded(value: unknown): void {
  const bytes = boundedBytes(value);
  if (bytes > ENVIRONMENT_ACI_MAX_BYTES) {
    fail(`Environment ACI payload exceeds the ${ENVIRONMENT_ACI_MAX_BYTES}-byte size limit.`);
  }
}

function parsed<T extends z.ZodTypeAny>(schema: T, value: unknown, label: string): z.output<T> {
  assertBounded(value);
  const result = schema.safeParse(value);
  if (!result.success) {
    fail(`${label} is invalid: ${result.error.issues.map(({ message }) => message).join('; ')}`);
  }
  return result.data as z.output<T>;
}

function without<T extends Record<string, unknown>>(
  value: T,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key));
}

function assertDigest(value: Record<string, unknown>, field: string, label: string): void {
  const expected = hashEnvironmentAciPayload(without(value, field));
  if (value[field] !== expected) fail(`${label} digest does not match its canonical payload.`);
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} must be unique.`);
}

function timestampMs(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail(`Invalid timestamp: ${value}`);
  return result;
}

function assertNotBefore(later: string, earlier: string, label: string): void {
  if (timestampMs(later) < timestampMs(earlier)) fail(`${label} precedes its request timestamp.`);
}

function assertSafeRelativeRef(value: string): void {
  if (
    value.length > 512 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  ) {
    fail('Evidence and snapshot refs must be safe relative paths.');
  }
}

const OperationMatrixSchema = z
  .object({
    observe: z.boolean(),
    act: z.boolean(),
    reset: z.boolean(),
    snapshot: z.boolean(),
    restore: z.boolean(),
    runScenario: z.boolean(),
    collectEvidence: z.boolean(),
  })
  .strict();

export type EnvironmentAciOperationMatrix = z.infer<typeof OperationMatrixSchema>;

const DescriptorInputSchema = z
  .object({
    adapterId: SafeIdSchema,
    environmentId: SafeIdSchema,
    sessionId: SafeIdSchema,
    kind: z.enum(['web', 'android', 'unity']),
    operationTimeoutMs: z.number().int().min(1).max(MAX_OPERATION_TIMEOUT_MS),
    operations: OperationMatrixSchema,
    actionKinds: z.array(SafeIdSchema).min(1).max(MAX_ITEMS),
    environment: JsonValueSchema,
  })
  .strict();

const DescriptorSchema = DescriptorInputSchema.extend({
  schemaVersion: z.literal(ENVIRONMENT_ACI_SCHEMA_VERSION),
  environmentFingerprint: Sha256Schema,
  capabilityFingerprint: Sha256Schema,
}).strict();

export type EnvironmentAciDescriptor = z.infer<typeof DescriptorSchema>;
export type EnvironmentAciDescriptorInput = z.input<typeof DescriptorInputSchema>;

function descriptorFingerprints(value: z.infer<typeof DescriptorInputSchema>): {
  environmentFingerprint: string;
  capabilityFingerprint: string;
} {
  const actionKinds = [...value.actionKinds].sort();
  return {
    environmentFingerprint: hashEnvironmentAciPayload({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: value.adapterId,
      environmentId: value.environmentId,
      kind: value.kind,
      environment: value.environment,
    }),
    capabilityFingerprint: hashEnvironmentAciPayload({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      operations: value.operations,
      actionKinds,
      operationTimeoutMs: value.operationTimeoutMs,
    }),
  };
}

export function createEnvironmentAciDescriptor(
  input: EnvironmentAciDescriptorInput,
): EnvironmentAciDescriptor {
  const value = parsed(DescriptorInputSchema, input, 'Environment ACI descriptor input');
  assertUnique(value.actionKinds, 'Action kinds');
  const actionKinds = [...value.actionKinds].sort();
  const fingerprints = descriptorFingerprints({ ...value, actionKinds });
  return parsed(
    DescriptorSchema,
    {
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      ...value,
      actionKinds,
      ...fingerprints,
    },
    'Environment ACI descriptor',
  );
}

export function parseEnvironmentAciDescriptor(input: unknown): EnvironmentAciDescriptor {
  const value = parsed(DescriptorSchema, input, 'Environment ACI descriptor');
  assertUnique(value.actionKinds, 'Action kinds');
  const fingerprints = descriptorFingerprints({
    adapterId: value.adapterId,
    environmentId: value.environmentId,
    sessionId: value.sessionId,
    kind: value.kind,
    operationTimeoutMs: value.operationTimeoutMs,
    operations: value.operations,
    actionKinds: value.actionKinds,
    environment: value.environment,
  });
  if (fingerprints.environmentFingerprint !== value.environmentFingerprint) {
    fail('Environment fingerprint does not match the canonical environment payload.');
  }
  if (fingerprints.capabilityFingerprint !== value.capabilityFingerprint) {
    fail('Capability fingerprint does not match the canonical capability payload.');
  }
  return value;
}

const HostCapabilitySchema = z
  .object({
    schemaVersion: z.literal(ENVIRONMENT_ACI_SCHEMA_VERSION),
    enabled: z.boolean(),
    environmentFingerprint: Sha256Schema,
    capabilityFingerprint: Sha256Schema,
    operationTimeoutMs: z.number().int().min(1).max(MAX_OPERATION_TIMEOUT_MS),
    operations: OperationMatrixSchema,
    reason: TextSchema.nullable(),
    limitations: TextListSchema,
  })
  .strict();

export type HostEnvironmentCapability = z.infer<typeof HostCapabilitySchema>;

const IdentityShape = {
  schemaVersion: z.literal(ENVIRONMENT_ACI_SCHEMA_VERSION),
  adapterId: SafeIdSchema,
  environmentId: SafeIdSchema,
  sessionId: SafeIdSchema,
  scenarioId: SafeIdSchema.nullable(),
  executionId: SafeIdSchema,
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  requestedAt: TimestampSchema,
};

const ObserveRequestSchema = z
  .object({ ...IdentityShape, afterActionId: SafeIdSchema.nullable() })
  .strict();
export type EnvironmentObserveRequest = z.infer<typeof ObserveRequestSchema>;

const ResetRequestSchema = z
  .object({
    ...IdentityShape,
    reason: z.enum(['scenario-start', 'scenario-cleanup', 'manual']),
  })
  .strict();
export type EnvironmentResetRequest = z.infer<typeof ResetRequestSchema>;

const SnapshotRequestSchema = z.object(IdentityShape).strict();
export type EnvironmentSnapshotRequest = z.infer<typeof SnapshotRequestSchema>;

const ActionInputSchema = z
  .object({
    ...IdentityShape,
    actionId: SafeIdSchema,
    kind: SafeIdSchema,
    payload: JsonValueSchema,
  })
  .strict();
const ActionSchema = ActionInputSchema.extend({ actionSha256: Sha256Schema }).strict();
export type EnvironmentAction = z.infer<typeof ActionSchema>;
export type EnvironmentActionInput = z.input<typeof ActionInputSchema>;

export function createEnvironmentAction(input: EnvironmentActionInput): EnvironmentAction {
  const value = parsed(ActionInputSchema, input, 'Environment action');
  return parseEnvironmentAction({
    ...value,
    actionSha256: hashEnvironmentAciPayload(value),
  });
}

export function parseEnvironmentAction(input: unknown): EnvironmentAction {
  const value = parsed(ActionSchema, input, 'Environment action');
  assertDigest(value, 'actionSha256', 'Environment action');
  return value;
}

const ObservationInputSchema = z
  .object({
    ...IdentityShape,
    afterActionId: SafeIdSchema.nullable().default(null),
    observedAt: TimestampSchema,
    state: JsonValueSchema,
    limitations: TextListSchema,
    environmentFingerprint: Sha256Schema,
  })
  .strict();
const ObservationSchema = ObservationInputSchema.extend({
  observationSha256: Sha256Schema,
}).strict();
export type EnvironmentObservation = z.infer<typeof ObservationSchema>;
export type EnvironmentObservationInput = z.input<typeof ObservationInputSchema>;

export function createEnvironmentObservation(
  input: EnvironmentObservationInput,
): EnvironmentObservation {
  const value = parsed(ObservationInputSchema, input, 'Environment observation');
  assertNotBefore(value.observedAt, value.requestedAt, 'Observation timestamp');
  return parseEnvironmentObservation({
    ...value,
    observationSha256: hashEnvironmentAciPayload(value),
  });
}

export function parseEnvironmentObservation(input: unknown): EnvironmentObservation {
  const value = parsed(ObservationSchema, input, 'Environment observation');
  assertNotBefore(value.observedAt, value.requestedAt, 'Observation timestamp');
  assertDigest(value, 'observationSha256', 'Environment observation');
  return value;
}

const StatusShape = {
  status: z.enum(['PASS', 'FAIL', 'UNVERIFIED']),
  reason: TextSchema.nullable(),
  negativePaths: TextListSchema,
  limitations: TextListSchema,
};

function assertStatusFields(
  value: { status: EnvironmentReceiptStatus; reason: string | null },
  label: string,
): void {
  if (value.status === 'PASS' && value.reason !== null)
    fail(`${label} PASS cannot carry a reason.`);
  if (value.status !== 'PASS' && value.reason === null) fail(`${label} requires a reason.`);
}

const ActionResultInputSchema = ActionSchema.extend({
  completedAt: TimestampSchema,
  ...StatusShape,
  environmentFingerprint: Sha256Schema,
}).strict();
const ActionResultSchema = ActionResultInputSchema.extend({ resultSha256: Sha256Schema }).strict();
export type EnvironmentActionResult = z.infer<typeof ActionResultSchema>;
export type EnvironmentActionResultInput = z.input<typeof ActionResultInputSchema>;

export function createEnvironmentActionResult(
  input: EnvironmentActionResultInput,
): EnvironmentActionResult {
  const value = parsed(ActionResultInputSchema, input, 'Environment action result');
  assertStatusFields(value, 'Environment action result');
  assertNotBefore(value.completedAt, value.requestedAt, 'Action completion timestamp');
  return parseEnvironmentActionResult({
    ...value,
    resultSha256: hashEnvironmentAciPayload(value),
  });
}

export function parseEnvironmentActionResult(input: unknown): EnvironmentActionResult {
  const value = parsed(ActionResultSchema, input, 'Environment action result');
  assertStatusFields(value, 'Environment action result');
  assertNotBefore(value.completedAt, value.requestedAt, 'Action completion timestamp');
  parseEnvironmentAction({
    schemaVersion: value.schemaVersion,
    adapterId: value.adapterId,
    environmentId: value.environmentId,
    sessionId: value.sessionId,
    scenarioId: value.scenarioId,
    executionId: value.executionId,
    sequence: value.sequence,
    requestedAt: value.requestedAt,
    actionId: value.actionId,
    kind: value.kind,
    payload: value.payload,
    actionSha256: value.actionSha256,
  });
  assertDigest(value, 'resultSha256', 'Environment action result');
  return value;
}

const SnapshotInputSchema = z
  .object({
    ...IdentityShape,
    snapshotId: SafeIdSchema,
    snapshotRef: z.string().min(1).max(512),
    snapshotBytes: z.number().int().min(0).max(MAX_ARTIFACT_BYTES),
    snapshotMediaType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    stateSha256: Sha256Schema,
    environmentFingerprint: Sha256Schema,
  })
  .strict();
const SnapshotSchema = SnapshotInputSchema.extend({ snapshotSha256: Sha256Schema }).strict();
export type EnvironmentSnapshot = z.infer<typeof SnapshotSchema>;
export type EnvironmentSnapshotInput = z.input<typeof SnapshotInputSchema>;

export function createEnvironmentSnapshot(input: EnvironmentSnapshotInput): EnvironmentSnapshot {
  const value = parsed(SnapshotInputSchema, input, 'Environment snapshot');
  assertSafeRelativeRef(value.snapshotRef);
  assertNotBefore(value.createdAt, value.requestedAt, 'Snapshot creation timestamp');
  if (timestampMs(value.expiresAt) <= timestampMs(value.createdAt)) {
    fail('Snapshot expiry must be after creation.');
  }
  return parseEnvironmentSnapshot({
    ...value,
    snapshotSha256: hashEnvironmentAciPayload(value),
  });
}

export function parseEnvironmentSnapshot(input: unknown): EnvironmentSnapshot {
  const value = parsed(SnapshotSchema, input, 'Environment snapshot');
  assertSafeRelativeRef(value.snapshotRef);
  assertNotBefore(value.createdAt, value.requestedAt, 'Snapshot creation timestamp');
  if (timestampMs(value.expiresAt) <= timestampMs(value.createdAt)) {
    fail('Snapshot expiry must be after creation.');
  }
  assertDigest(value, 'snapshotSha256', 'Environment snapshot');
  return value;
}

export function validateSnapshotForRestore(
  input: unknown,
  expected: EnvironmentAciDescriptor,
  now: string,
  currentSequence: number,
): EnvironmentSnapshot {
  const value = parseEnvironmentSnapshot(input);
  const descriptor = parseEnvironmentAciDescriptor(expected);
  assertIdentity(value, descriptor, 'Snapshot');
  if (value.environmentFingerprint !== descriptor.environmentFingerprint) {
    fail('Snapshot environment fingerprint does not match the active environment.');
  }
  if (value.sequence !== currentSequence) fail('Snapshot is stale for the active sequence.');
  if (timestampMs(now) >= timestampMs(value.expiresAt)) fail('Snapshot is expired.');
  return value;
}

const EvidenceArtifactSchema = z
  .object({
    ref: z.string().min(1).max(512),
    sha256: Sha256Schema,
    bytes: z.number().int().min(0).max(MAX_ARTIFACT_BYTES),
    mediaType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
  })
  .strict();
export type EnvironmentEvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export type EnvironmentArtifactValidator = (artifact: EnvironmentEvidenceArtifact) => void;

export function createTrustedArtifactRefValidator(
  trustedArtifactDirectory: string,
): EnvironmentArtifactValidator {
  const root = path.resolve(trustedArtifactDirectory);
  if (!fs.existsSync(root)) fail('Trusted artifact directory does not exist.');
  const rootInfo = fs.lstatSync(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    fail('Trusted artifact directory must be a non-symlink directory.');
  }
  const realRoot = fs.realpathSync(root);
  return (artifact) => {
    const value = parsed(EvidenceArtifactSchema, artifact, 'Environment artifact ref');
    assertSafeRelativeRef(value.ref);
    let current = realRoot;
    for (const segment of value.ref.split('/')) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) fail('Trusted artifact ref does not exist.');
      const info = fs.lstatSync(current);
      if (info.isSymbolicLink()) fail('Trusted artifact ref contains a symlink component.');
    }
    const info = fs.lstatSync(current);
    if (!info.isFile()) fail('Trusted artifact ref must resolve to a regular file.');
    const realTarget = fs.realpathSync(current);
    if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
      fail('Trusted artifact ref escapes its contained directory.');
    }
    if (info.size !== value.bytes) fail('Trusted artifact byte count does not match.');
    const digest = createHash('sha256').update(fs.readFileSync(realTarget)).digest('hex');
    if (digest !== value.sha256) fail('Trusted artifact digest does not match.');
  };
}

const EvidenceRequestSchema = z
  .object({
    ...IdentityShape,
    actionId: SafeIdSchema,
    actionSha256: Sha256Schema,
    observationSha256: Sha256Schema,
  })
  .strict();
export type EnvironmentEvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

const EvidenceReceiptInputSchema = EvidenceRequestSchema.extend({
  collectedAt: TimestampSchema,
  ...StatusShape,
  artifacts: z.array(EvidenceArtifactSchema).max(MAX_ITEMS),
  environmentFingerprint: Sha256Schema,
}).strict();
const EvidenceReceiptSchema = EvidenceReceiptInputSchema.extend({
  evidenceSha256: Sha256Schema,
}).strict();
export type EnvironmentEvidenceReceipt = z.infer<typeof EvidenceReceiptSchema>;
export type EnvironmentEvidenceReceiptInput = z.input<typeof EvidenceReceiptInputSchema>;

function assertEvidenceArtifacts(artifacts: EnvironmentEvidenceArtifact[]): void {
  for (const artifact of artifacts) assertSafeRelativeRef(artifact.ref);
  assertUnique(
    artifacts.map(({ ref }) => ref),
    'Evidence refs',
  );
}

function assertEvidenceCompleteness(value: EnvironmentEvidenceReceiptInput): void {
  if (value.status === 'PASS' && value.artifacts.length === 0) {
    fail('A PASS evidence receipt requires at least one artifact.');
  }
}

export function createEnvironmentEvidenceReceipt(
  input: EnvironmentEvidenceReceiptInput,
): EnvironmentEvidenceReceipt {
  const value = parsed(EvidenceReceiptInputSchema, input, 'Environment evidence receipt');
  assertStatusFields(value, 'Environment evidence receipt');
  assertEvidenceCompleteness(value);
  assertNotBefore(value.collectedAt, value.requestedAt, 'Evidence collection timestamp');
  assertEvidenceArtifacts(value.artifacts);
  return parseEnvironmentEvidenceReceipt({
    ...value,
    evidenceSha256: hashEnvironmentAciPayload(value),
  });
}

export function parseEnvironmentEvidenceReceipt(input: unknown): EnvironmentEvidenceReceipt {
  const value = parsed(EvidenceReceiptSchema, input, 'Environment evidence receipt');
  assertStatusFields(value, 'Environment evidence receipt');
  assertEvidenceCompleteness(value);
  assertNotBefore(value.collectedAt, value.requestedAt, 'Evidence collection timestamp');
  assertEvidenceArtifacts(value.artifacts);
  assertDigest(value, 'evidenceSha256', 'Environment evidence receipt');
  return value;
}

const ScenarioStepSchema = z
  .object({ actionId: SafeIdSchema, kind: SafeIdSchema, payload: JsonValueSchema })
  .strict();
const ScenarioSchema = z
  .object({
    schemaVersion: z.literal(ENVIRONMENT_ACI_SCHEMA_VERSION),
    adapterId: SafeIdSchema,
    environmentId: SafeIdSchema,
    sessionId: SafeIdSchema,
    scenarioId: SafeIdSchema,
    executionId: SafeIdSchema,
    requestedAt: TimestampSchema,
    deadlineAt: TimestampSchema,
    steps: z.array(ScenarioStepSchema).min(1).max(MAX_ITEMS),
  })
  .strict();
export type EnvironmentScenario = z.infer<typeof ScenarioSchema>;

export function parseEnvironmentScenario(input: unknown): EnvironmentScenario {
  const value = parsed(ScenarioSchema, input, 'Environment scenario');
  assertUnique(
    value.steps.map(({ actionId }) => actionId),
    'Scenario action IDs',
  );
  if (timestampMs(value.deadlineAt) <= timestampMs(value.requestedAt)) {
    fail('Scenario deadline must be after its request timestamp.');
  }
  return value;
}

const ScenarioReceiptInputSchema = ScenarioSchema.extend({
  ...StatusShape,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  resetObservation: ObservationSchema.nullable(),
  actions: z.array(ActionSchema).max(MAX_ITEMS),
  actionResults: z.array(ActionResultSchema).max(MAX_ITEMS),
  observations: z.array(ObservationSchema).max(MAX_ITEMS),
  evidence: z.array(EvidenceReceiptSchema).max(MAX_ITEMS),
  cleanupObservation: ObservationSchema.nullable(),
  environmentFingerprint: Sha256Schema,
}).strict();
const ScenarioReceiptSchema = ScenarioReceiptInputSchema.extend({
  receiptSha256: Sha256Schema,
}).strict();
export type EnvironmentScenarioReceipt = z.infer<typeof ScenarioReceiptSchema>;
export type EnvironmentScenarioReceiptInput = z.input<typeof ScenarioReceiptInputSchema>;

function assertReceiptIdentity(
  value: {
    adapterId: string;
    environmentId: string;
    sessionId: string;
    scenarioId: string | null;
    executionId: string;
    environmentFingerprint?: string;
  },
  receipt: EnvironmentScenarioReceipt,
  label: string,
): void {
  if (
    value.adapterId !== receipt.adapterId ||
    value.environmentId !== receipt.environmentId ||
    value.sessionId !== receipt.sessionId ||
    value.scenarioId !== receipt.scenarioId ||
    value.executionId !== receipt.executionId
  ) {
    fail(`${label} identity does not match its scenario receipt.`);
  }
  if (
    value.environmentFingerprint !== undefined &&
    value.environmentFingerprint !== receipt.environmentFingerprint
  ) {
    fail(`${label} environment fingerprint does not match its scenario receipt.`);
  }
}

function validateEnvironmentScenarioReceipt(
  value: EnvironmentScenarioReceipt,
): EnvironmentScenarioReceipt {
  assertStatusFields(value, 'Environment scenario receipt');
  assertDigest(value, 'receiptSha256', 'Environment scenario receipt');
  parseEnvironmentScenario({
    schemaVersion: value.schemaVersion,
    adapterId: value.adapterId,
    environmentId: value.environmentId,
    sessionId: value.sessionId,
    scenarioId: value.scenarioId,
    executionId: value.executionId,
    requestedAt: value.requestedAt,
    deadlineAt: value.deadlineAt,
    steps: value.steps,
  });
  const requested = timestampMs(value.requestedAt);
  const started = timestampMs(value.startedAt);
  const completed = timestampMs(value.completedAt);
  const deadline = timestampMs(value.deadlineAt);
  const hasDeadlineTimeoutEvidence =
    value.negativePaths.includes('adapter-operation-timeout') ||
    value.reason === 'scenario-deadline-expired' ||
    value.reason?.startsWith('adapter-timeout:') === true;
  if (!(requested <= started && started <= completed)) {
    fail('Scenario timestamps must satisfy requestedAt <= startedAt <= completedAt.');
  }
  if (completed > deadline && !(value.status === 'FAIL' && hasDeadlineTimeoutEvidence)) {
    fail('Only a timeout-backed FAIL scenario receipt may complete after its deadline.');
  }

  const operationIntervals: Array<{
    sequence: number;
    requestedAt: string;
    completedAt: string;
    label: string;
  }> = [];
  let cursor: number | null = null;
  const advance = (sequence: number, label: string): void => {
    if (cursor !== null && sequence <= cursor) fail(`${label} sequence is not monotonic.`);
    cursor = sequence;
  };
  const bindObservation = (observation: EnvironmentObservation, label: string): void => {
    const parsedObservation = parseEnvironmentObservation(observation);
    assertReceiptIdentity(parsedObservation, value, label);
    operationIntervals.push({
      sequence: parsedObservation.sequence,
      requestedAt: parsedObservation.requestedAt,
      completedAt: parsedObservation.observedAt,
      label,
    });
  };

  if (value.resetObservation) {
    bindObservation(value.resetObservation, 'Reset observation');
    if (value.resetObservation.afterActionId !== null) {
      fail('Reset observation cannot be bound to an action.');
    }
    advance(value.resetObservation.sequence, 'Reset observation');
  }
  if (value.actions.length !== value.actionResults.length) {
    fail('Scenario actions and action results must have equal cardinality.');
  }
  if (value.actions.length > value.steps.length) {
    fail('Scenario receipt contains more actions than declared steps.');
  }

  let successfulActions = 0;
  let firstNonPass: EnvironmentActionResult | EnvironmentEvidenceReceipt | null = null;
  for (let index = 0; index < value.actions.length; index += 1) {
    const action = parseEnvironmentAction(value.actions[index]);
    const result = parseEnvironmentActionResult(value.actionResults[index]);
    const step = value.steps[index];
    assertReceiptIdentity(action, value, `Action ${index}`);
    assertReceiptIdentity(result, value, `Action result ${index}`);
    if (
      action.actionId !== step.actionId ||
      action.kind !== step.kind ||
      canonicalJson(action.payload) !== canonicalJson(step.payload)
    ) {
      fail(`Action ${index} does not match its declared scenario step.`);
    }
    if (
      result.actionId !== action.actionId ||
      result.actionSha256 !== action.actionSha256 ||
      result.sequence !== action.sequence
    ) {
      fail(`Action result ${index} does not match its action.`);
    }
    if (result.status === 'PASS') successfulActions += 1;
    else {
      firstNonPass ??= result;
      if (index !== value.actions.length - 1) {
        fail('A non-PASS action result must terminate scenario actions.');
      }
    }
  }

  if (
    value.observations.length > successfulActions ||
    value.evidence.length > value.observations.length ||
    successfulActions - value.observations.length > 1 ||
    successfulActions - value.evidence.length > 1
  ) {
    fail('Successful action observation and evidence cardinality is invalid.');
  }
  const hasUnrecordedDispatchFailure =
    value.status === 'FAIL' &&
    value.negativePaths.some((negativePath) =>
      [
        'adapter-operation-timeout',
        'adapter-operation-failed',
        'adapter-receipt-mismatch',
        'cleanup-failed',
        'cleanup-deferred',
      ].includes(negativePath),
    );
  if (
    (value.observations.length !== successfulActions ||
      value.evidence.length !== successfulActions) &&
    !hasUnrecordedDispatchFailure
  ) {
    fail('Each successful action requires exactly one observation and evidence receipt.');
  }
  let successfulIndex = 0;
  for (let index = 0; index < value.actions.length; index += 1) {
    const action = value.actions[index];
    const result = value.actionResults[index];
    advance(action.sequence, `Action ${index}`);
    operationIntervals.push({
      sequence: action.sequence,
      requestedAt: action.requestedAt,
      completedAt: result.completedAt,
      label: `Action ${index}`,
    });
    if (result.status !== 'PASS') continue;
    const observationInput = value.observations[successfulIndex];
    const evidenceInput = value.evidence[successfulIndex];
    if (!observationInput) {
      successfulIndex += 1;
      continue;
    }
    const observation = parseEnvironmentObservation(observationInput);
    bindObservation(observation, `Observation ${successfulIndex}`);
    if (observation.afterActionId !== action.actionId) {
      fail(`Observation ${successfulIndex} does not match its action.`);
    }
    advance(observation.sequence, `Observation ${successfulIndex}`);
    if (evidenceInput) {
      const evidence = parseEnvironmentEvidenceReceipt(evidenceInput);
      assertReceiptIdentity(evidence, value, `Evidence ${successfulIndex}`);
      if (
        evidence.actionId !== action.actionId ||
        evidence.actionSha256 !== action.actionSha256 ||
        evidence.observationSha256 !== observation.observationSha256
      ) {
        fail(`Evidence ${successfulIndex} does not match its action and observation.`);
      }
      advance(evidence.sequence, `Evidence ${successfulIndex}`);
      operationIntervals.push({
        sequence: evidence.sequence,
        requestedAt: evidence.requestedAt,
        completedAt: evidence.collectedAt,
        label: `Evidence ${successfulIndex}`,
      });
      if (evidence.status !== 'PASS') firstNonPass ??= evidence;
    }
    successfulIndex += 1;
  }

  if (value.cleanupObservation) {
    bindObservation(value.cleanupObservation, 'Cleanup observation');
    if (value.cleanupObservation.afterActionId !== null) {
      fail('Cleanup observation cannot be bound to an action.');
    }
    advance(value.cleanupObservation.sequence, 'Cleanup observation');
  }
  const expectedSequence = cursor === null ? 0 : cursor;
  const isEmptyUnverifiedReceipt =
    value.status === 'UNVERIFIED' &&
    value.resetObservation === null &&
    value.cleanupObservation === null &&
    value.actions.length === 0 &&
    value.actionResults.length === 0 &&
    value.observations.length === 0 &&
    value.evidence.length === 0;
  if (
    value.sequence !== expectedSequence &&
    !(hasUnrecordedDispatchFailure && value.sequence >= expectedSequence + 1) &&
    !isEmptyUnverifiedReceipt
  ) {
    fail('Scenario receipt sequence must match its accepted or failed dispatched operations.');
  }
  const orderedIntervals = [...operationIntervals].sort(
    (left, right) => left.sequence - right.sequence,
  );
  let previousCompleted = started;
  for (const interval of orderedIntervals) {
    const intervalStarted = timestampMs(interval.requestedAt);
    const intervalCompleted = timestampMs(interval.completedAt);
    if (
      intervalStarted < started ||
      intervalCompleted > completed ||
      intervalStarted > intervalCompleted
    ) {
      fail('Nested receipt timestamps must be within scenario start and completion.');
    }
    if (intervalStarted < previousCompleted) {
      fail(`${interval.label} timeline is not monotonic by dispatched sequence.`);
    }
    previousCompleted = intervalCompleted;
  }

  const completePass =
    value.resetObservation !== null &&
    value.cleanupObservation !== null &&
    value.actions.length === value.steps.length &&
    value.actionResults.every(({ status }) => status === 'PASS') &&
    value.observations.length === value.steps.length &&
    value.evidence.length === value.steps.length &&
    value.evidence.every(({ status, artifacts }) => status === 'PASS' && artifacts.length > 0);
  const derivedStatus: EnvironmentReceiptStatus =
    firstNonPass?.status === 'FAIL' || value.negativePaths.length > 0
      ? 'FAIL'
      : firstNonPass?.status === 'UNVERIFIED' || !completePass
        ? 'UNVERIFIED'
        : 'PASS';
  if (value.status !== derivedStatus) {
    fail(`Scenario receipt status must be derived as ${derivedStatus}.`);
  }
  if (firstNonPass && value.reason !== firstNonPass.reason) {
    fail('Scenario receipt reason must match its first non-PASS nested receipt.');
  }
  return value;
}

export function createEnvironmentScenarioReceipt(
  input: EnvironmentScenarioReceiptInput,
): EnvironmentScenarioReceipt {
  const value = parsed(ScenarioReceiptInputSchema, input, 'Environment scenario receipt');
  const sealed = parsed(
    ScenarioReceiptSchema,
    { ...value, receiptSha256: hashEnvironmentAciPayload(value) },
    'Environment scenario receipt',
  );
  return validateEnvironmentScenarioReceipt(sealed);
}

export function parseEnvironmentScenarioReceipt(input: unknown): EnvironmentScenarioReceipt {
  const value = parsed(ScenarioReceiptSchema, input, 'Environment scenario receipt');
  return validateEnvironmentScenarioReceipt(value);
}

export interface EnvironmentAci {
  observe(request: EnvironmentObserveRequest): Promise<EnvironmentObservation>;
  act(action: EnvironmentAction): Promise<EnvironmentActionResult>;
  reset(request: EnvironmentResetRequest): Promise<EnvironmentObservation>;
  snapshot(request: EnvironmentSnapshotRequest): Promise<EnvironmentSnapshot>;
  restore(snapshot: EnvironmentSnapshot): Promise<EnvironmentObservation>;
  runScenario(scenario: EnvironmentScenario): Promise<EnvironmentScenarioReceipt>;
  collectEvidence(request: EnvironmentEvidenceRequest): Promise<EnvironmentEvidenceReceipt>;
}

export interface EnvironmentAciAdapter extends EnvironmentAci {
  readonly descriptor: EnvironmentAciDescriptor;
}

export interface EnvironmentAciNegotiation {
  status: 'PASS' | 'UNVERIFIED';
  adapterId: string;
  environmentId: string;
  sessionId: string;
  environmentFingerprint: string;
  capabilityFingerprint: string;
  reason: string | null;
  limitations: string[];
  operations: EnvironmentAciOperationMatrix;
}

function unverifiedNegotiation(
  descriptor: EnvironmentAciDescriptor,
  reason: string,
  limitations: string[],
): EnvironmentAciNegotiation {
  return {
    status: 'UNVERIFIED',
    adapterId: descriptor.adapterId,
    environmentId: descriptor.environmentId,
    sessionId: descriptor.sessionId,
    environmentFingerprint: descriptor.environmentFingerprint,
    capabilityFingerprint: descriptor.capabilityFingerprint,
    reason,
    limitations,
    operations: descriptor.operations,
  };
}

export function negotiateEnvironmentAci(
  adapter: EnvironmentAciAdapter,
  hostCapability: HostEnvironmentCapability | undefined,
): EnvironmentAciNegotiation {
  const descriptor = parseEnvironmentAciDescriptor(adapter.descriptor);
  if (hostCapability === undefined) {
    return unverifiedNegotiation(descriptor, 'host-capability-missing', [
      'No host Environment ACI capability was supplied.',
    ]);
  }
  const host = parsed(HostCapabilitySchema, hostCapability, 'Host Environment ACI capability');
  if (!host.enabled) {
    return unverifiedNegotiation(
      descriptor,
      host.reason ?? 'host-capability-disabled',
      host.limitations.length > 0
        ? host.limitations
        : ['Host Environment ACI capability is disabled.'],
    );
  }
  if (host.environmentFingerprint !== descriptor.environmentFingerprint) {
    return unverifiedNegotiation(descriptor, 'host-environment-fingerprint-mismatch', [
      'Host capability is not bound to the adapter environment fingerprint.',
    ]);
  }
  if (host.capabilityFingerprint !== descriptor.capabilityFingerprint) {
    return unverifiedNegotiation(descriptor, 'host-capability-fingerprint-mismatch', [
      'Host capability does not match the adapter capability fingerprint.',
    ]);
  }
  if (host.operationTimeoutMs !== descriptor.operationTimeoutMs) {
    return unverifiedNegotiation(descriptor, 'host-operation-timeout-mismatch', [
      'Host capability does not agree with the adapter operation timeout.',
    ]);
  }
  for (const operation of ENVIRONMENT_ACI_OPERATIONS) {
    if (!descriptor.operations[operation] || !host.operations[operation]) {
      return unverifiedNegotiation(descriptor, `host-operation-disabled:${operation}`, [
        `The ${operation} operation is not enabled by both adapter and host.`,
      ]);
    }
    if (typeof (adapter as unknown as Record<string, unknown>)[operation] !== 'function') {
      return unverifiedNegotiation(descriptor, `adapter-operation-missing:${operation}`, [
        `The adapter does not implement ${operation}.`,
      ]);
    }
  }
  return {
    status: 'PASS',
    adapterId: descriptor.adapterId,
    environmentId: descriptor.environmentId,
    sessionId: descriptor.sessionId,
    environmentFingerprint: descriptor.environmentFingerprint,
    capabilityFingerprint: descriptor.capabilityFingerprint,
    reason: null,
    limitations: [...host.limitations],
    operations: descriptor.operations,
  };
}

function assertIdentity(
  value: { adapterId: string; environmentId: string; sessionId: string },
  descriptor: EnvironmentAciDescriptor,
  label: string,
): void {
  if (value.adapterId !== descriptor.adapterId) fail(`${label} adapter ID mismatch.`);
  if (value.environmentId !== descriptor.environmentId) fail(`${label} environment ID mismatch.`);
  if (value.sessionId !== descriptor.sessionId) fail(`${label} session ID mismatch.`);
}

function assertObservationBinding(
  observation: EnvironmentObservation,
  request: EnvironmentObserveRequest | EnvironmentResetRequest,
  descriptor: EnvironmentAciDescriptor,
): void {
  assertIdentity(observation, descriptor, 'Observation');
  if (
    observation.scenarioId !== request.scenarioId ||
    observation.executionId !== request.executionId ||
    observation.sequence !== request.sequence ||
    observation.afterActionId !== ('afterActionId' in request ? request.afterActionId : null)
  ) {
    fail('Observation scenario, execution, or sequence mismatch.');
  }
  if (observation.environmentFingerprint !== descriptor.environmentFingerprint) {
    fail('Observation environment fingerprint mismatch.');
  }
}

function assertActionResultBinding(
  result: EnvironmentActionResult,
  action: EnvironmentAction,
  descriptor: EnvironmentAciDescriptor,
): void {
  assertIdentity(result, descriptor, 'Action result');
  if (
    result.scenarioId !== action.scenarioId ||
    result.executionId !== action.executionId ||
    result.actionId !== action.actionId ||
    result.sequence !== action.sequence ||
    result.actionSha256 !== action.actionSha256
  ) {
    fail('Action result does not match the requested action.');
  }
  if (result.environmentFingerprint !== descriptor.environmentFingerprint) {
    fail('Action result environment fingerprint mismatch.');
  }
}

function assertEvidenceBinding(
  receipt: EnvironmentEvidenceReceipt,
  request: EnvironmentEvidenceRequest,
  descriptor: EnvironmentAciDescriptor,
  deadlineAt?: string,
): void {
  assertIdentity(receipt, descriptor, 'Evidence receipt');
  if (
    receipt.scenarioId !== request.scenarioId ||
    receipt.executionId !== request.executionId ||
    receipt.actionId !== request.actionId ||
    receipt.sequence !== request.sequence ||
    receipt.actionSha256 !== request.actionSha256 ||
    receipt.observationSha256 !== request.observationSha256
  ) {
    fail('Evidence receipt scenario, execution, action, observation, or sequence mismatch.');
  }
  if (receipt.environmentFingerprint !== descriptor.environmentFingerprint) {
    fail('Evidence receipt environment fingerprint mismatch.');
  }
  if (deadlineAt && timestampMs(receipt.collectedAt) > timestampMs(deadlineAt)) {
    fail('Evidence receipt arrived after the scenario deadline.');
  }
}

export interface EnvironmentAciCoordinatorOptions {
  now?: () => string;
  cleanupAfterScenario?: boolean;
  artifactValidator?: EnvironmentArtifactValidator;
  trustedArtifactDirectory?: string;
}

interface SharedEnvironmentSessionState {
  queue: Promise<void>;
  sequence: number;
  consumedSnapshots: Set<string>;
  quarantined: boolean;
  recoveryScheduled: boolean;
}

const sharedEnvironmentSessions = new Map<string, SharedEnvironmentSessionState>();

export function clearEnvironmentAciSessionRegistryForTests(): void {
  sharedEnvironmentSessions.clear();
}

function sharedSession(descriptor: EnvironmentAciDescriptor): SharedEnvironmentSessionState {
  const key = `${descriptor.adapterId}\u0000${descriptor.environmentId}\u0000${descriptor.sessionId}`;
  const existing = sharedEnvironmentSessions.get(key);
  if (existing) return existing;
  if (sharedEnvironmentSessions.size >= MAX_SESSION_REGISTRY_ENTRIES) {
    fail('Environment ACI session registry capacity is exhausted.');
  }
  const created: SharedEnvironmentSessionState = {
    queue: Promise.resolve(),
    sequence: 0,
    consumedSnapshots: new Set(),
    quarantined: false,
    recoveryScheduled: false,
  };
  sharedEnvironmentSessions.set(key, created);
  return created;
}

class EnvironmentAdapterOperationError extends Error {
  constructor(
    readonly reason: string,
    readonly negativePath: string,
  ) {
    super(reason);
    this.name = 'EnvironmentAdapterOperationError';
  }
}

class SerializedEnvironmentAci implements EnvironmentAci {
  private readonly session: SharedEnvironmentSessionState;
  private readonly descriptor: EnvironmentAciDescriptor;
  private readonly negotiation: EnvironmentAciNegotiation;
  private readonly now: () => string;
  private readonly cleanupAfterScenario: boolean;
  private readonly artifactValidator: EnvironmentArtifactValidator | undefined;

  constructor(
    private readonly adapter: EnvironmentAciAdapter,
    hostCapability: HostEnvironmentCapability | undefined,
    options: EnvironmentAciCoordinatorOptions,
  ) {
    this.descriptor = parseEnvironmentAciDescriptor(adapter.descriptor);
    this.negotiation = negotiateEnvironmentAci(adapter, hostCapability);
    this.now = options.now ?? (() => new Date().toISOString());
    this.cleanupAfterScenario = options.cleanupAfterScenario ?? true;
    if (options.artifactValidator && options.trustedArtifactDirectory) {
      fail('Specify either artifactValidator or trustedArtifactDirectory, not both.');
    }
    this.artifactValidator =
      options.artifactValidator ??
      (options.trustedArtifactDirectory
        ? createTrustedArtifactRefValidator(options.trustedArtifactDirectory)
        : undefined);
    this.session = sharedSession(this.descriptor);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.session.queue.then(operation, operation);
    this.session.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requireCapability(): void {
    if (this.negotiation.status !== 'PASS') {
      fail(`Environment ACI is UNVERIFIED: ${this.negotiation.reason}.`);
    }
  }

  private requireNextSequence(sequence: number): void {
    if (sequence !== this.session.sequence + 1) fail('Operation sequence must be monotonic.');
  }

  private requireSessionAvailable(): void {
    if (this.session.quarantined) fail('environment-session-quarantined');
  }

  private reserveSequence(sequence: number): void {
    this.requireNextSequence(sequence);
    this.session.sequence = sequence;
  }

  private reserveNextSequence(): number {
    const sequence = this.session.sequence + 1;
    this.reserveSequence(sequence);
    return sequence;
  }

  private requireArtifactValidator(): EnvironmentArtifactValidator {
    if (!this.artifactValidator) fail('Trusted artifact validation is required.');
    return this.artifactValidator;
  }

  private timeoutFor(deadlineAt?: string): number {
    if (!deadlineAt) return this.descriptor.operationTimeoutMs;
    const remaining = timestampMs(deadlineAt) - timestampMs(this.now());
    if (remaining <= 0) {
      throw new EnvironmentAdapterOperationError(
        'scenario-deadline-expired',
        'adapter-operation-timeout',
      );
    }
    return Math.min(this.descriptor.operationTimeoutMs, remaining);
  }

  private async awaitAdapter<T>(
    operation: EnvironmentAciOperation,
    call: () => Promise<T>,
    deadlineAt?: string,
    recoveryIdentity?: Pick<
      EnvironmentResetRequest,
      'adapterId' | 'environmentId' | 'sessionId' | 'scenarioId' | 'executionId'
    >,
  ): Promise<T> {
    const timeoutMs = this.timeoutFor(deadlineAt);
    let timer: NodeJS.Timeout | undefined;
    const adapterPromise = Promise.resolve()
      .then(call)
      .then(
        (value) => ({ kind: 'value' as const, value }),
        () => ({ kind: 'failure' as const }),
      );
    const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    });
    const outcome = await Promise.race([adapterPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    if (outcome.kind === 'value') return outcome.value;
    if (outcome.kind === 'timeout') {
      if (recoveryIdentity) {
        this.quarantineAfterLateSettlement(adapterPromise, recoveryIdentity);
      }
      throw new EnvironmentAdapterOperationError(
        `adapter-timeout:${operation}`,
        'adapter-operation-timeout',
      );
    }
    throw new EnvironmentAdapterOperationError(
      `adapter-failed:${operation}`,
      'adapter-operation-failed',
    );
  }

  private quarantineAfterLateSettlement(
    settledOperation: Promise<unknown>,
    identity: Pick<
      EnvironmentResetRequest,
      'adapterId' | 'environmentId' | 'sessionId' | 'scenarioId' | 'executionId'
    >,
  ): void {
    this.session.quarantined = true;
    if (this.session.recoveryScheduled) return;
    this.session.recoveryScheduled = true;
    void settledOperation.then(() => {
      void this.serialize(async () => {
        if (!this.session.quarantined) return;
        const sequence = this.reserveNextSequence();
        const request: EnvironmentResetRequest = {
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          ...identity,
          sequence,
          requestedAt: this.now(),
          reason: 'scenario-cleanup',
        };
        try {
          const observation = parseEnvironmentObservation(
            await this.awaitAdapter('reset', () => this.adapter.reset(request)),
          );
          assertObservationBinding(observation, request, this.descriptor);
          this.session.quarantined = false;
        } catch {
          // A single recovery attempt is deliberately bounded. Keep the session quarantined.
        } finally {
          this.session.recoveryScheduled = false;
        }
      });
    });
  }

  private validateSnapshotRef(snapshot: EnvironmentSnapshot): void {
    this.requireArtifactValidator()({
      ref: snapshot.snapshotRef,
      sha256: snapshot.stateSha256,
      bytes: snapshot.snapshotBytes,
      mediaType: snapshot.snapshotMediaType,
    });
  }

  observe(request: EnvironmentObserveRequest): Promise<EnvironmentObservation> {
    if (this.session.quarantined)
      return Promise.reject(new EnvironmentAciValidationError('environment-session-quarantined'));
    return this.serialize(async () => {
      this.requireCapability();
      this.requireSessionAvailable();
      const parsedRequest = parsed(ObserveRequestSchema, request, 'Observe request');
      assertIdentity(parsedRequest, this.descriptor, 'Observe request');
      this.reserveSequence(parsedRequest.sequence);
      const observation = parseEnvironmentObservation(
        await this.awaitAdapter(
          'observe',
          () => this.adapter.observe(parsedRequest),
          undefined,
          parsedRequest,
        ),
      );
      assertObservationBinding(observation, parsedRequest, this.descriptor);
      return observation;
    });
  }

  act(action: EnvironmentAction): Promise<EnvironmentActionResult> {
    if (this.session.quarantined)
      return Promise.reject(new EnvironmentAciValidationError('environment-session-quarantined'));
    return this.serialize(async () => {
      this.requireCapability();
      this.requireSessionAvailable();
      const parsedAction = parseEnvironmentAction(action);
      assertIdentity(parsedAction, this.descriptor, 'Action');
      if (!this.descriptor.actionKinds.includes(parsedAction.kind))
        fail('Action kind is not negotiated.');
      this.reserveSequence(parsedAction.sequence);
      const result = parseEnvironmentActionResult(
        await this.awaitAdapter(
          'act',
          () => this.adapter.act(parsedAction),
          undefined,
          parsedAction,
        ),
      );
      assertActionResultBinding(result, parsedAction, this.descriptor);
      return result;
    });
  }

  reset(request: EnvironmentResetRequest): Promise<EnvironmentObservation> {
    if (this.session.quarantined)
      return Promise.reject(new EnvironmentAciValidationError('environment-session-quarantined'));
    return this.serialize(async () => {
      this.requireCapability();
      this.requireSessionAvailable();
      const parsedRequest = parsed(ResetRequestSchema, request, 'Reset request');
      assertIdentity(parsedRequest, this.descriptor, 'Reset request');
      this.reserveSequence(parsedRequest.sequence);
      const observation = parseEnvironmentObservation(
        await this.awaitAdapter(
          'reset',
          () => this.adapter.reset(parsedRequest),
          undefined,
          parsedRequest,
        ),
      );
      assertObservationBinding(observation, parsedRequest, this.descriptor);
      return observation;
    });
  }

  snapshot(request: EnvironmentSnapshotRequest): Promise<EnvironmentSnapshot> {
    if (this.session.quarantined)
      return Promise.reject(new EnvironmentAciValidationError('environment-session-quarantined'));
    return this.serialize(async () => {
      this.requireCapability();
      this.requireSessionAvailable();
      const parsedRequest = parsed(SnapshotRequestSchema, request, 'Snapshot request');
      assertIdentity(parsedRequest, this.descriptor, 'Snapshot request');
      this.reserveSequence(parsedRequest.sequence);
      const snapshot = parseEnvironmentSnapshot(
        await this.awaitAdapter(
          'snapshot',
          () => this.adapter.snapshot(parsedRequest),
          undefined,
          parsedRequest,
        ),
      );
      assertIdentity(snapshot, this.descriptor, 'Snapshot');
      if (
        snapshot.executionId !== parsedRequest.executionId ||
        snapshot.scenarioId !== parsedRequest.scenarioId ||
        snapshot.sequence !== parsedRequest.sequence ||
        snapshot.environmentFingerprint !== this.descriptor.environmentFingerprint
      ) {
        fail('Snapshot binding mismatch.');
      }
      this.validateSnapshotRef(snapshot);
      return snapshot;
    });
  }

  restore(snapshot: EnvironmentSnapshot): Promise<EnvironmentObservation> {
    if (this.session.quarantined)
      return Promise.reject(new EnvironmentAciValidationError('environment-session-quarantined'));
    return this.serialize(async () => {
      this.requireCapability();
      this.requireSessionAvailable();
      const candidate = parseEnvironmentSnapshot(snapshot);
      if (this.session.consumedSnapshots.has(candidate.snapshotSha256)) {
        fail('Snapshot has already been consumed; replay is rejected.');
      }
      const value = validateSnapshotForRestore(
        candidate,
        this.descriptor,
        this.now(),
        this.session.sequence,
      );
      this.validateSnapshotRef(value);
      this.session.consumedSnapshots.add(value.snapshotSha256);
      const nextSequence = this.reserveNextSequence();
      const restoreStartedAt = this.now();
      const observation = parseEnvironmentObservation(
        await this.awaitAdapter('restore', () => this.adapter.restore(value), undefined, value),
      );
      assertIdentity(observation, this.descriptor, 'Restore observation');
      if (
        observation.scenarioId !== value.scenarioId ||
        observation.executionId !== value.executionId ||
        observation.sequence !== nextSequence ||
        timestampMs(observation.observedAt) < timestampMs(restoreStartedAt) ||
        observation.environmentFingerprint !== value.environmentFingerprint
      ) {
        fail('Restore observation binding mismatch.');
      }
      return observation;
    });
  }

  collectEvidence(request: EnvironmentEvidenceRequest): Promise<EnvironmentEvidenceReceipt> {
    if (this.session.quarantined)
      return Promise.reject(new EnvironmentAciValidationError('environment-session-quarantined'));
    return this.serialize(async () => {
      this.requireCapability();
      this.requireSessionAvailable();
      const parsedRequest = parsed(EvidenceRequestSchema, request, 'Evidence request');
      assertIdentity(parsedRequest, this.descriptor, 'Evidence request');
      this.reserveSequence(parsedRequest.sequence);
      const receipt = parseEnvironmentEvidenceReceipt(
        await this.awaitAdapter(
          'collectEvidence',
          () => this.adapter.collectEvidence(parsedRequest),
          undefined,
          parsedRequest,
        ),
      );
      assertEvidenceBinding(receipt, parsedRequest, this.descriptor);
      if (receipt.status === 'PASS') {
        const validator = this.requireArtifactValidator();
        for (const artifact of receipt.artifacts) validator(artifact);
      }
      return receipt;
    });
  }

  runScenario(input: EnvironmentScenario): Promise<EnvironmentScenarioReceipt> {
    if (this.session.quarantined) {
      return this.runScenarioExclusive(input);
    }
    return this.serialize(() => this.runScenarioExclusive(input));
  }

  private async runScenarioExclusive(
    input: EnvironmentScenario,
  ): Promise<EnvironmentScenarioReceipt> {
    const scenario = parseEnvironmentScenario(input);
    assertIdentity(scenario, this.descriptor, 'Scenario');
    const startedAt = this.now();
    if (this.session.quarantined) {
      return createEnvironmentScenarioReceipt({
        ...scenario,
        status: 'UNVERIFIED',
        startedAt,
        completedAt: this.now(),
        sequence: this.session.sequence,
        resetObservation: null,
        actions: [],
        actionResults: [],
        observations: [],
        evidence: [],
        cleanupObservation: null,
        reason: 'environment-session-quarantined',
        negativePaths: [],
        limitations: ['environment-session-quarantined'],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    }
    const unavailable =
      this.negotiation.status !== 'PASS'
        ? { reason: this.negotiation.reason, limitations: this.negotiation.limitations }
        : !this.artifactValidator
          ? {
              reason: 'trusted-artifact-validation-missing',
              limitations: ['No trusted contained artifact validator was supplied.'],
            }
          : null;
    if (unavailable) {
      return createEnvironmentScenarioReceipt({
        ...scenario,
        status: 'UNVERIFIED',
        startedAt,
        completedAt: this.now(),
        sequence: this.session.sequence,
        resetObservation: null,
        actions: [],
        actionResults: [],
        observations: [],
        evidence: [],
        cleanupObservation: null,
        reason: unavailable.reason,
        negativePaths: [],
        limitations: unavailable.limitations,
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    }

    let resetObservation: EnvironmentObservation | null = null;
    let cleanupObservation: EnvironmentObservation | null = null;
    const actions: EnvironmentAction[] = [];
    const actionResults: EnvironmentActionResult[] = [];
    const observations: EnvironmentObservation[] = [];
    const evidence: EnvironmentEvidenceReceipt[] = [];
    let status: EnvironmentReceiptStatus = 'PASS';
    let reason: string | null = null;
    const negativePaths: string[] = [];
    const limitations = [...this.negotiation.limitations];
    let resetAttempted = false;

    try {
      if (timestampMs(startedAt) >= timestampMs(scenario.deadlineAt)) {
        fail('Scenario deadline is already expired.');
      }
      const resetRequest: EnvironmentResetRequest = {
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: scenario.adapterId,
        environmentId: scenario.environmentId,
        sessionId: scenario.sessionId,
        scenarioId: scenario.scenarioId,
        executionId: scenario.executionId,
        sequence: this.reserveNextSequence(),
        requestedAt: this.now(),
        reason: 'scenario-start',
      };
      resetAttempted = true;
      resetObservation = parseEnvironmentObservation(
        await this.awaitAdapter(
          'reset',
          () => this.adapter.reset(resetRequest),
          scenario.deadlineAt,
          resetRequest,
        ),
      );
      assertObservationBinding(resetObservation, resetRequest, this.descriptor);

      for (const step of scenario.steps) {
        if (!this.descriptor.actionKinds.includes(step.kind)) {
          fail(`Action kind is not negotiated: ${step.kind}.`);
        }
        const action = createEnvironmentAction({
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          adapterId: scenario.adapterId,
          environmentId: scenario.environmentId,
          sessionId: scenario.sessionId,
          scenarioId: scenario.scenarioId,
          executionId: scenario.executionId,
          actionId: step.actionId,
          sequence: this.reserveNextSequence(),
          requestedAt: this.now(),
          kind: step.kind,
          payload: step.payload,
        });
        const actionResult = parseEnvironmentActionResult(
          await this.awaitAdapter(
            'act',
            () => this.adapter.act(action),
            scenario.deadlineAt,
            action,
          ),
        );
        assertActionResultBinding(actionResult, action, this.descriptor);
        if (actionResult.status !== 'PASS') {
          actions.push(action);
          actionResults.push(actionResult);
          status = actionResult.status;
          reason = actionResult.reason;
          negativePaths.push(...actionResult.negativePaths);
          limitations.push(...actionResult.limitations);
          break;
        }

        const observeRequest: EnvironmentObserveRequest = {
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          adapterId: scenario.adapterId,
          environmentId: scenario.environmentId,
          sessionId: scenario.sessionId,
          scenarioId: scenario.scenarioId,
          executionId: scenario.executionId,
          sequence: this.reserveNextSequence(),
          requestedAt: this.now(),
          afterActionId: action.actionId,
        };
        const observation = parseEnvironmentObservation(
          await this.awaitAdapter(
            'observe',
            () => this.adapter.observe(observeRequest),
            scenario.deadlineAt,
            observeRequest,
          ),
        );
        assertObservationBinding(observation, observeRequest, this.descriptor);

        const evidenceRequest: EnvironmentEvidenceRequest = {
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          adapterId: scenario.adapterId,
          environmentId: scenario.environmentId,
          sessionId: scenario.sessionId,
          scenarioId: scenario.scenarioId,
          executionId: scenario.executionId,
          actionId: action.actionId,
          sequence: this.reserveNextSequence(),
          requestedAt: this.now(),
          actionSha256: action.actionSha256,
          observationSha256: observation.observationSha256,
        };
        const evidenceReceipt = parseEnvironmentEvidenceReceipt(
          await this.awaitAdapter(
            'collectEvidence',
            () => this.adapter.collectEvidence(evidenceRequest),
            scenario.deadlineAt,
            evidenceRequest,
          ),
        );
        assertEvidenceBinding(
          evidenceReceipt,
          evidenceRequest,
          this.descriptor,
          scenario.deadlineAt,
        );
        const validator = this.requireArtifactValidator();
        for (const artifact of evidenceReceipt.artifacts) validator(artifact);
        actions.push(action);
        actionResults.push(actionResult);
        observations.push(observation);
        evidence.push(evidenceReceipt);
        if (evidenceReceipt.status !== 'PASS') {
          status = evidenceReceipt.status;
          reason = evidenceReceipt.reason;
          negativePaths.push(...evidenceReceipt.negativePaths);
          limitations.push(...evidenceReceipt.limitations);
          break;
        }
      }
    } catch (error) {
      status = 'FAIL';
      if (error instanceof EnvironmentAdapterOperationError) {
        reason = error.reason;
        negativePaths.push(error.negativePath);
      } else {
        reason = 'adapter-receipt-invalid';
        negativePaths.push('adapter-receipt-mismatch');
      }
    } finally {
      if (this.cleanupAfterScenario && resetAttempted && !this.session.quarantined) {
        const cleanupRequest: EnvironmentResetRequest = {
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          adapterId: scenario.adapterId,
          environmentId: scenario.environmentId,
          sessionId: scenario.sessionId,
          scenarioId: scenario.scenarioId,
          executionId: scenario.executionId,
          sequence: this.reserveNextSequence(),
          requestedAt: this.now(),
          reason: 'scenario-cleanup',
        };
        try {
          cleanupObservation = parseEnvironmentObservation(
            await this.awaitAdapter(
              'reset',
              () => this.adapter.reset(cleanupRequest),
              scenario.deadlineAt,
              cleanupRequest,
            ),
          );
          assertObservationBinding(cleanupObservation, cleanupRequest, this.descriptor);
        } catch {
          status = 'FAIL';
          reason ??= 'cleanup-failed';
          negativePaths.push('cleanup-failed');
          cleanupObservation = null;
          this.session.quarantined = true;
        }
      } else if (this.cleanupAfterScenario && resetAttempted && this.session.quarantined) {
        negativePaths.push('cleanup-deferred');
        limitations.push('cleanup-deferred');
      }
    }

    return createEnvironmentScenarioReceipt({
      ...scenario,
      status,
      startedAt,
      completedAt: this.now(),
      sequence: this.session.sequence,
      resetObservation,
      actions,
      actionResults,
      observations,
      evidence,
      cleanupObservation,
      reason,
      negativePaths: [...new Set(negativePaths)],
      limitations: [...new Set(limitations)],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }
}

export function createEnvironmentAciCoordinator(
  adapter: EnvironmentAciAdapter,
  hostCapability?: HostEnvironmentCapability,
  options: EnvironmentAciCoordinatorOptions = {},
): EnvironmentAci {
  return new SerializedEnvironmentAci(adapter, hostCapability, options);
}
