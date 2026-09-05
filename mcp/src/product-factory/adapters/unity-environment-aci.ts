import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  createEnvironmentAciCoordinator,
  createEnvironmentAciDescriptor,
  createEnvironmentActionResult,
  createEnvironmentEvidenceReceipt,
  createEnvironmentObservation,
  createEnvironmentSnapshot,
  createTrustedArtifactRefValidator,
  hashEnvironmentAciPayload,
  parseEnvironmentAciDescriptor,
  parseEnvironmentAction,
  parseEnvironmentScenario,
  parseEnvironmentSnapshot,
  type EnvironmentAci,
  type EnvironmentAciAdapter,
  type EnvironmentAction,
  type EnvironmentArtifactValidator,
  type EnvironmentEvidenceArtifact,
  type EnvironmentEvidenceReceipt,
  type EnvironmentEvidenceRequest,
  type EnvironmentObservation,
  type EnvironmentObserveRequest,
  type EnvironmentResetRequest,
  type EnvironmentScenario,
  type EnvironmentScenarioReceipt,
  type EnvironmentSnapshot,
  type EnvironmentSnapshotRequest,
  type HostEnvironmentCapability,
  type JsonValue,
} from '../environment-aci.js';

export const UNITY_ENVIRONMENT_ACTION_KINDS = [
  'step-time',
  'input',
  'inspect-state',
  'load-scene',
] as const;

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SECRET_KEY =
  /(?:authorization|cookie|credential|password|secret|token|api[-_ ]?key|private[-_ ]?key|(?:^|[-_])(?:card|pan)(?:$|[-_]))/i;
const SECRET_VALUE =
  /(?:sk-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16}|bearer\s+\S+|[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----|(?:authorization|cookie|credential|password|secret|token|api[-_ ]?key|private[-_ ]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+))/i;
const PAYMENT_VALUE = /(?:\d[ -]?){13,19}/;
const OPAQUE_RUN = /[A-Za-z0-9+/_=-]{20,}/g;
const HEX_VALUE = /^[A-Fa-f0-9]{20,}$/;
const REDACTED = '[REDACTED]';
const MAX_TICKS = 1_000_000;
const MAX_ITEMS = 128;
const MAX_DEPTH = 16;
const MAX_SNAPSHOTS = 128;
const SafeIdSchema = z.string().min(1).max(96).regex(SAFE_ID);
const TimestampSchema = z.string().datetime({ offset: true });
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IdentitySchema = z
  .object({
    schemaVersion: z.literal(ENVIRONMENT_ACI_SCHEMA_VERSION),
    adapterId: SafeIdSchema,
    environmentId: SafeIdSchema,
    sessionId: SafeIdSchema,
    scenarioId: SafeIdSchema.nullable(),
    executionId: SafeIdSchema,
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    requestedAt: TimestampSchema,
  })
  .strict();
const ObserveRequestSchema = IdentitySchema.extend({
  afterActionId: SafeIdSchema.nullable(),
}).strict();
const ResetRequestSchema = IdentitySchema.extend({
  reason: z.enum(['scenario-start', 'scenario-cleanup', 'manual']),
}).strict();
const SnapshotRequestSchema = IdentitySchema;
const EvidenceRequestSchema = IdentitySchema.extend({
  actionId: SafeIdSchema,
  actionSha256: HashSchema,
  observationSha256: HashSchema,
}).strict();
const GameStateSchema = z
  .object({
    sceneId: SafeIdSchema,
    clockTicks: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    frameId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    state: z.unknown(),
  })
  .strict();
const ArtifactSchema = z
  .object({
    kind: z.enum(['frame', 'video', 'state']),
    ref: z.string().min(1).max(512),
    sha256: HashSchema,
    bytes: z
      .number()
      .int()
      .min(0)
      .max(256 * 1024 * 1024),
    mediaType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
  })
  .strict();
const PortCapabilitySchema = z
  .object({
    unityAvailable: z.boolean(),
    bridgeAvailable: z.boolean(),
    buildId: SafeIdSchema.nullable(),
    resetAvailable: z.boolean(),
    deterministicStepAvailable: z.boolean(),
  })
  .strict();
const StepPayloadSchema = z.object({ ticks: z.number().int().min(0).max(MAX_TICKS) }).strict();
const InputPayloadSchema = z.object({ controlId: SafeIdSchema, pressed: z.boolean() }).strict();
const InspectPayloadSchema = z.object({}).strict();
const LoadScenePayloadSchema = z.object({ sceneId: SafeIdSchema }).strict();

export interface UnityGameState {
  sceneId: string;
  clockTicks: number;
  frameId: number;
  state: JsonValue;
}
export interface UnityGameArtifact extends EnvironmentEvidenceArtifact {
  kind: 'frame' | 'video' | 'state';
}
export interface UnityGameSnapshot {
  snapshotId: string;
  buildId: string;
  sceneId: string;
  sessionId: string;
  state: UnityGameState;
  artifact: UnityGameArtifact;
  expiresAt: string;
}
export interface UnityGamePortCapabilities {
  unityAvailable: boolean;
  bridgeAvailable: boolean;
  buildId: string | null;
  resetAvailable: boolean;
  deterministicStepAvailable: boolean;
}
export interface UnityGamePort {
  readonly capabilities: UnityGamePortCapabilities;
  reset(): Promise<UnityGameState>;
  stepTime(ticks: number): Promise<UnityGameState>;
  input(controlId: string, pressed: boolean): Promise<UnityGameState>;
  inspectState(): Promise<UnityGameState>;
  loadScene(sceneId: string): Promise<UnityGameState>;
  snapshot(): Promise<UnityGameSnapshot>;
  restore(snapshot: UnityGameSnapshot): Promise<UnityGameState>;
  collectArtifacts(): Promise<readonly UnityGameArtifact[]>;
}
export interface UnityCapabilityAssessment {
  status: 'PASS' | 'UNVERIFIED';
  reason: string | null;
  limitations: string[];
  capability: HostEnvironmentCapability;
}
export interface UnityEnvironmentAciAdapterOptions {
  adapterId: string;
  environmentId: string;
  sessionId: string;
  buildId: string;
  operationTimeoutMs: number;
  trustedArtifactDirectory: string;
  port: UnityGamePort;
  now?: () => string;
}

type StoredSnapshot = Readonly<{ serialized: string; value: UnityGameSnapshot; consumed: boolean }>;

function invalid(code: string): never {
  throw new Error(`Unity Environment ACI: ${code}`);
}
function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function entropy(value: string): number {
  const frequencies = new Map<string, number>();
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  return [...frequencies.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
}
function sensitiveText(value: string): boolean {
  const candidate = value.trim();
  if (SECRET_VALUE.test(candidate) || PAYMENT_VALUE.test(candidate)) return true;
  const opaqueRuns = candidate.match(OPAQUE_RUN) ?? [];
  return opaqueRuns.some((run) => {
    if (HEX_VALUE.test(run)) return true;
    return entropy(run.replace(/=+$/, '')) >= 3.5;
  });
}
function neutralKey(key: string, reserved: Set<string>): string {
  const base = `field-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
  let candidate = base;
  let collision = 1;
  while (reserved.has(candidate)) {
    candidate = `${base}-${collision}`;
    collision += 1;
  }
  reserved.add(candidate);
  return candidate;
}
function sanitize(value: unknown, path = '$', depth = 0, seen = new Set<object>()): JsonValue {
  if (depth > MAX_DEPTH) invalid('state-invalid');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('state-invalid');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 4096 || sensitiveText(value)) return REDACTED;
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) invalid('state-invalid');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ITEMS) invalid('state-invalid');
      return value.map((item, index) => sanitize(item, `${path}[${index}]`, depth + 1, seen));
    }
    if (!plainObject(value)) invalid('state-invalid');
    const keys = Object.keys(value);
    if (keys.length > MAX_ITEMS) invalid('state-invalid');
    const result: Record<string, JsonValue> = {};
    const reserved = new Set(keys.filter((key) => !SECRET_KEY.test(key)));
    for (const key of keys.sort()) {
      if (SECRET_KEY.test(key)) result[neutralKey(key, reserved)] = REDACTED;
      else result[key] = sanitize(value[key], `${path}.${key}`, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}
function immutable<T>(value: T): T {
  const clone = structuredClone(value) as T;
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.freeze(item);
      Object.values(item).forEach(freeze);
    }
  };
  freeze(clone);
  return clone;
}
function parsePortState(value: unknown): UnityGameState {
  const result = GameStateSchema.safeParse(value);
  if (!result.success) invalid('state-invalid');
  return immutable({ ...result.data, state: sanitize(result.data.state) }) as UnityGameState;
}
function stablePort<T>(operation: string, call: () => Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(call)
    .catch(() => invalid(`port-${operation}-failed`));
}
function assertDescriptorIdentity(
  value: { adapterId: string; environmentId: string; sessionId: string },
  label: string,
  descriptor: EnvironmentAciAdapter['descriptor'],
): void {
  if (
    value.adapterId !== descriptor.adapterId ||
    value.environmentId !== descriptor.environmentId ||
    value.sessionId !== descriptor.sessionId
  )
    invalid(`${label}-identity-mismatch`);
}
function assertIdentity(
  value: unknown,
  label: string,
  descriptor: EnvironmentAciAdapter['descriptor'],
): void {
  const result = IdentitySchema.passthrough().safeParse(value);
  if (!result.success) invalid(`${label}-invalid`);
  assertDescriptorIdentity(result.data, label, descriptor);
}
function assertArtifact(artifact: UnityGameArtifact): EnvironmentEvidenceArtifact {
  const parsed = ArtifactSchema.safeParse(artifact);
  if (!parsed.success) invalid('artifact-invalid');
  if (
    (parsed.data.kind === 'frame' && !parsed.data.mediaType.startsWith('image/')) ||
    (parsed.data.kind === 'video' && !parsed.data.mediaType.startsWith('video/')) ||
    (parsed.data.kind === 'state' && parsed.data.mediaType !== 'application/json')
  )
    invalid('artifact-invalid');
  return immutable({
    ref: parsed.data.ref,
    sha256: parsed.data.sha256,
    bytes: parsed.data.bytes,
    mediaType: parsed.data.mediaType,
  });
}
function sameState(left: UnityGameState, right: UnityGameState): boolean {
  return hashEnvironmentAciPayload(left) === hashEnvironmentAciPayload(right);
}
function assertTransition(
  previous: UnityGameState,
  next: UnityGameState,
  clockTicks: number,
  frameId: number,
  sceneId = previous.sceneId,
): void {
  if (next.clockTicks !== clockTicks || next.frameId !== frameId || next.sceneId !== sceneId)
    invalid('nondeterministic-transition');
}
function emptyCapability(reason: string, limitations: string[]): UnityCapabilityAssessment {
  return {
    status: 'UNVERIFIED',
    reason,
    limitations,
    capability: {
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      enabled: false,
      environmentFingerprint: '0'.repeat(64),
      capabilityFingerprint: '0'.repeat(64),
      operationTimeoutMs: 1,
      operations: {
        observe: false,
        act: false,
        reset: false,
        snapshot: false,
        restore: false,
        runScenario: false,
        collectEvidence: false,
      },
      reason,
      limitations,
    },
  };
}

export function createUnityHostCapability(
  descriptorInput: unknown,
  capabilitiesInput: unknown,
): UnityCapabilityAssessment {
  let descriptor: EnvironmentAciAdapter['descriptor'];
  try {
    descriptor = parseEnvironmentAciDescriptor(descriptorInput);
  } catch {
    return emptyCapability('unity-descriptor-unverified', ['Unity descriptor is invalid.']);
  }
  if (descriptor.kind !== 'unity')
    return emptyCapability('unity-descriptor-unverified', ['Descriptor kind is not Unity.']);
  const capabilities = PortCapabilitySchema.safeParse(capabilitiesInput);
  if (!capabilities.success)
    return emptyCapability('unity-capability-unverified', ['Unity capability payload is invalid.']);
  const value = capabilities.data;
  const limitations: string[] = [];
  if (!value.unityAvailable) limitations.push('Unity runtime is unavailable.');
  if (!value.bridgeAvailable) limitations.push('Unity bridge is unavailable.');
  if (value.buildId === null) limitations.push('Unity build identity is unavailable.');
  else if (value.buildId !== (descriptor.environment as { buildId?: unknown }).buildId)
    limitations.push('Unity build identity does not match the configured environment.');
  if (!value.resetAvailable) limitations.push('Unity reset is unavailable.');
  if (!value.deterministicStepAvailable)
    limitations.push('Unity deterministic stepping is unavailable.');
  const enabled = limitations.length === 0;
  const reason = enabled ? null : 'unity-capability-unverified';
  return {
    status: enabled ? 'PASS' : 'UNVERIFIED',
    reason,
    limitations,
    capability: {
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      enabled,
      environmentFingerprint: descriptor.environmentFingerprint,
      capabilityFingerprint: descriptor.capabilityFingerprint,
      operationTimeoutMs: descriptor.operationTimeoutMs,
      operations: descriptor.operations,
      reason,
      limitations,
    },
  };
}

export class UnityEnvironmentAciAdapter implements EnvironmentAciAdapter {
  readonly descriptor;
  private readonly now: () => string;
  private readonly artifactValidator: EnvironmentArtifactValidator;
  private readonly snapshots = new Map<string, StoredSnapshot>();
  private pendingSnapshots = 0;
  private current: UnityGameState | undefined;

  constructor(private readonly options: UnityEnvironmentAciAdapterOptions) {
    const value = z
      .object({
        adapterId: SafeIdSchema,
        environmentId: SafeIdSchema,
        sessionId: SafeIdSchema,
        buildId: SafeIdSchema,
        operationTimeoutMs: z.number().int().min(1).max(120_000),
        trustedArtifactDirectory: z.string().min(1),
        port: z.unknown(),
        now: z.function().optional(),
      })
      .strict()
      .safeParse(options);
    if (!value.success) invalid('options-invalid');
    this.now = options.now ?? (() => new Date().toISOString());
    try {
      this.artifactValidator = createTrustedArtifactRefValidator(
        value.data.trustedArtifactDirectory,
      );
    } catch {
      invalid('artifact-validator-invalid');
    }
    this.descriptor = createEnvironmentAciDescriptor({
      adapterId: value.data.adapterId,
      environmentId: value.data.environmentId,
      sessionId: value.data.sessionId,
      kind: 'unity',
      operationTimeoutMs: value.data.operationTimeoutMs,
      operations: {
        observe: true,
        act: true,
        reset: true,
        snapshot: true,
        restore: true,
        runScenario: true,
        collectEvidence: true,
      },
      actionKinds: [...UNITY_ENVIRONMENT_ACTION_KINDS],
      environment: { buildId: value.data.buildId, bridge: 'unity-game-port/v1' },
    });
  }
  private pruneSnapshots(): void {
    const now = Date.parse(this.now());
    if (!Number.isFinite(now)) invalid('clock-invalid');
    for (const [digest, stored] of this.snapshots)
      if (Date.parse(stored.value.expiresAt) <= now) this.snapshots.delete(digest);
  }
  private validateArtifact(artifact: EnvironmentEvidenceArtifact): void {
    try {
      this.artifactValidator(artifact);
    } catch {
      invalid('artifact-validation-failed');
    }
  }
  private observation(
    request: EnvironmentObserveRequest | EnvironmentResetRequest,
    state: UnityGameState,
  ): EnvironmentObservation {
    return createEnvironmentObservation({
      schemaVersion: request.schemaVersion,
      adapterId: request.adapterId,
      environmentId: request.environmentId,
      sessionId: request.sessionId,
      scenarioId: request.scenarioId,
      executionId: request.executionId,
      sequence: request.sequence,
      requestedAt: request.requestedAt,
      afterActionId: 'afterActionId' in request ? request.afterActionId : null,
      observedAt: this.now(),
      state: immutable({
        sceneId: state.sceneId,
        clockTicks: state.clockTicks,
        frameId: state.frameId,
        gameplay: state.state,
      }),
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }
  async observe(input: EnvironmentObserveRequest): Promise<EnvironmentObservation> {
    const request = ObserveRequestSchema.safeParse(input);
    if (!request.success) invalid('observe-invalid');
    assertIdentity(request.data, 'observe', this.descriptor);
    const state = parsePortState(
      await stablePort('inspect', () => this.options.port.inspectState()),
    );
    if (this.current && !sameState(this.current, state)) invalid('nondeterministic-observation');
    this.current = state;
    return this.observation(request.data, state);
  }
  async act(input: EnvironmentAction): Promise<ReturnType<typeof createEnvironmentActionResult>> {
    const action = parseEnvironmentAction(input);
    assertIdentity(action, 'action', this.descriptor);
    if (!this.current) invalid('action-state-missing');
    const previous = this.current;
    let next: UnityGameState;
    if (action.kind === 'step-time') {
      const payload = StepPayloadSchema.safeParse(action.payload);
      if (!payload.success) invalid('action-payload-invalid');
      next = parsePortState(
        await stablePort('step', () => this.options.port.stepTime(payload.data.ticks)),
      );
      assertTransition(
        previous,
        next,
        previous.clockTicks + payload.data.ticks,
        previous.frameId + 1,
      );
    } else if (action.kind === 'input') {
      const payload = InputPayloadSchema.safeParse(action.payload);
      if (!payload.success) invalid('action-payload-invalid');
      next = parsePortState(
        await stablePort('input', () =>
          this.options.port.input(payload.data.controlId, payload.data.pressed),
        ),
      );
      assertTransition(previous, next, previous.clockTicks, previous.frameId + 1);
    } else if (action.kind === 'inspect-state') {
      if (!InspectPayloadSchema.safeParse(action.payload).success)
        invalid('action-payload-invalid');
      next = parsePortState(await stablePort('inspect', () => this.options.port.inspectState()));
      if (!sameState(previous, next)) invalid('nondeterministic-observation');
    } else if (action.kind === 'load-scene') {
      const payload = LoadScenePayloadSchema.safeParse(action.payload);
      if (!payload.success) invalid('action-payload-invalid');
      next = parsePortState(
        await stablePort('load-scene', () => this.options.port.loadScene(payload.data.sceneId)),
      );
      assertTransition(previous, next, 0, previous.frameId + 1, payload.data.sceneId);
    } else invalid('action-kind-invalid');
    this.current = next;
    return createEnvironmentActionResult({
      ...action,
      completedAt: this.now(),
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }
  async reset(input: EnvironmentResetRequest): Promise<EnvironmentObservation> {
    const request = ResetRequestSchema.safeParse(input);
    if (!request.success) invalid('reset-invalid');
    assertIdentity(request.data, 'reset', this.descriptor);
    const state = parsePortState(await stablePort('reset', () => this.options.port.reset()));
    this.current = state;
    return this.observation(request.data, state);
  }
  async snapshot(input: EnvironmentSnapshotRequest): Promise<EnvironmentSnapshot> {
    const request = SnapshotRequestSchema.safeParse(input);
    if (!request.success) invalid('snapshot-invalid');
    assertIdentity(request.data, 'snapshot', this.descriptor);
    if (!this.current) invalid('snapshot-state-missing');
    this.pruneSnapshots();
    if (this.snapshots.size + this.pendingSnapshots >= MAX_SNAPSHOTS)
      invalid('snapshot-capacity-exceeded');
    this.pendingSnapshots += 1;
    try {
      const raw = await stablePort('snapshot', () => this.options.port.snapshot());
      const result = z
        .object({
          snapshotId: SafeIdSchema,
          buildId: SafeIdSchema,
          sceneId: SafeIdSchema,
          sessionId: SafeIdSchema,
          state: GameStateSchema,
          artifact: ArtifactSchema,
          expiresAt: TimestampSchema,
        })
        .strict()
        .safeParse(raw);
      if (!result.success) invalid('snapshot-invalid');
      const value = immutable({
        ...result.data,
        state: parsePortState(result.data.state),
        artifact: immutable(result.data.artifact),
      }) as UnityGameSnapshot;
      if (value.artifact.kind !== 'state') invalid('snapshot-binding-invalid');
      if (
        value.buildId !== this.options.buildId ||
        value.sceneId !== this.current.sceneId ||
        value.sessionId !== this.descriptor.sessionId ||
        !sameState(value.state, this.current) ||
        Date.parse(value.expiresAt) <= Date.parse(this.now())
      )
        invalid('snapshot-binding-invalid');
      const artifact = assertArtifact(value.artifact);
      this.validateArtifact(artifact);
      const sealed = createEnvironmentSnapshot({
        ...request.data,
        snapshotId: value.snapshotId,
        snapshotRef: artifact.ref,
        snapshotBytes: artifact.bytes,
        snapshotMediaType: artifact.mediaType,
        createdAt: this.now(),
        expiresAt: value.expiresAt,
        stateSha256: artifact.sha256,
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
      const serialized = JSON.stringify(immutable({ value, sealed }));
      this.pruneSnapshots();
      if (this.pendingSnapshots < 1 || this.snapshots.size + this.pendingSnapshots > MAX_SNAPSHOTS)
        invalid('snapshot-capacity-exceeded');
      this.snapshots.set(sealed.snapshotSha256, immutable({ serialized, value, consumed: false }));
      return sealed;
    } finally {
      this.pendingSnapshots -= 1;
    }
  }
  async restore(input: EnvironmentSnapshot): Promise<EnvironmentObservation> {
    const snapshot = parseEnvironmentSnapshot(input);
    assertIdentity(snapshot, 'restore', this.descriptor);
    this.pruneSnapshots();
    const stored = this.snapshots.get(snapshot.snapshotSha256);
    if (!stored || stored.consumed) invalid('snapshot-unavailable');
    const expected = JSON.parse(stored.serialized) as {
      sealed: EnvironmentSnapshot;
      value: UnityGameSnapshot;
    };
    if (
      hashEnvironmentAciPayload(expected.sealed) !== hashEnvironmentAciPayload(snapshot) ||
      snapshot.environmentFingerprint !== this.descriptor.environmentFingerprint ||
      snapshot.snapshotId !== expected.value.snapshotId ||
      snapshot.snapshotRef !== expected.value.artifact.ref ||
      snapshot.snapshotBytes !== expected.value.artifact.bytes ||
      snapshot.snapshotMediaType !== expected.value.artifact.mediaType ||
      snapshot.stateSha256 !== expected.value.artifact.sha256 ||
      Date.parse(this.now()) >= Date.parse(snapshot.expiresAt)
    )
      invalid('snapshot-binding-invalid');
    this.snapshots.set(snapshot.snapshotSha256, immutable({ ...stored, consumed: true }));
    const artifact = assertArtifact(stored.value.artifact);
    this.validateArtifact(artifact);
    const state = parsePortState(
      await stablePort('restore', () => this.options.port.restore(stored.value)),
    );
    if (!sameState(state, stored.value.state)) invalid('snapshot-restore-mismatch');
    this.current = state;
    return createEnvironmentObservation({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: this.descriptor.adapterId,
      environmentId: this.descriptor.environmentId,
      sessionId: this.descriptor.sessionId,
      scenarioId: snapshot.scenarioId,
      executionId: snapshot.executionId,
      sequence: snapshot.sequence + 1,
      requestedAt: this.now(),
      afterActionId: null,
      observedAt: this.now(),
      state: immutable({
        sceneId: state.sceneId,
        clockTicks: state.clockTicks,
        frameId: state.frameId,
        gameplay: state.state,
      }),
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }
  async collectEvidence(input: EnvironmentEvidenceRequest): Promise<EnvironmentEvidenceReceipt> {
    const request = EvidenceRequestSchema.safeParse(input);
    if (!request.success) invalid('evidence-invalid');
    assertIdentity(request.data, 'evidence', this.descriptor);
    const raw = await stablePort('artifacts', () => this.options.port.collectArtifacts());
    const parsed = z.array(ArtifactSchema).length(3).safeParse(raw);
    if (!parsed.success || new Set(parsed.data.map((artifact) => artifact.kind)).size !== 3)
      invalid('artifact-invalid');
    const artifacts = parsed.data.map((artifact) => assertArtifact(artifact));
    artifacts.forEach((artifact) => this.validateArtifact(artifact));
    return createEnvironmentEvidenceReceipt({
      ...request.data,
      collectedAt: this.now(),
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      artifacts,
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }
  async runScenario(input: EnvironmentScenario): Promise<EnvironmentScenarioReceipt> {
    let scenario: EnvironmentScenario;
    try {
      scenario = parseEnvironmentScenario(input);
    } catch {
      invalid('scenario-invalid');
    }
    assertDescriptorIdentity(scenario, 'scenario', this.descriptor);
    let capabilities: unknown;
    try {
      capabilities = this.options.port.capabilities;
    } catch {
      invalid('port-capability-failed');
    }
    const assessment = createUnityHostCapability(this.descriptor, capabilities);
    const coordinator: EnvironmentAci = createEnvironmentAciCoordinator(
      this,
      assessment.capability,
      { now: this.now, artifactValidator: this.artifactValidator },
    );
    return await coordinator.runScenario(scenario);
  }
}
export function createUnityEnvironmentAciAdapter(
  options: UnityEnvironmentAciAdapterOptions,
): UnityEnvironmentAciAdapter {
  return new UnityEnvironmentAciAdapter(options);
}
