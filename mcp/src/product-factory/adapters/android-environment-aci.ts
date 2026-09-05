import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  EnvironmentAciAdapter,
  EnvironmentAciDescriptor,
  EnvironmentAciDescriptorInput,
  EnvironmentAction,
  EnvironmentEvidenceArtifact,
  EnvironmentEvidenceReceipt,
  EnvironmentEvidenceRequest,
  EnvironmentObservation,
  EnvironmentObserveRequest,
  EnvironmentResetRequest,
  EnvironmentScenario,
  EnvironmentScenarioReceipt,
  EnvironmentSnapshot,
  EnvironmentSnapshotRequest,
  HostEnvironmentCapability,
  JsonValue,
  createEnvironmentAciCoordinator,
  createEnvironmentAciDescriptor,
  createEnvironmentActionResult,
  createEnvironmentEvidenceReceipt,
  createEnvironmentObservation,
  createEnvironmentSnapshot,
  parseEnvironmentAciDescriptor,
  parseEnvironmentAction,
  parseEnvironmentSnapshot,
} from '../environment-aci.js';

const ANDROID_ACTION_KINDS = ['launch', 'tap', 'type', 'swipe', 'back', 'wait'] as const;
const PACKAGE_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const JAVA_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SAFE_ARTIFACT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_COORDINATE = 10_000;
const MAX_TEXT = 2048;
const MAX_PORT_JSON_BYTES = 128 * 1024;
const MAX_SNAPSHOTS = 128;

const CoordinatesSchema = z
  .object({
    x: z.number().int().min(0).max(MAX_COORDINATE),
    y: z.number().int().min(0).max(MAX_COORDINATE),
  })
  .strict();

const AndroidActionPayloads = {
  launch: z.object({}).strict(),
  tap: CoordinatesSchema,
  type: z
    .object({
      text: z
        .string()
        .min(1)
        .max(MAX_TEXT)
        .refine((value) => !isUnsafeText(value)),
    })
    .strict(),
  swipe: z
    .object({
      from: CoordinatesSchema,
      to: CoordinatesSchema,
      durationMs: z.number().int().min(25).max(10_000),
    })
    .strict(),
  back: z.object({}).strict(),
  wait: z.object({ timeoutMs: z.number().int().min(1).max(60_000) }).strict(),
} as const;

export type AndroidActionKind = (typeof ANDROID_ACTION_KINDS)[number];

export interface AndroidInspection {
  /** Accessibility/UI hierarchy captured before any action is performed. */
  hierarchy: JsonValue;
  deviceState: JsonValue;
  appState: JsonValue;
}

export interface AndroidPortSnapshot {
  snapshotId: string;
  /** Opaque, provider-specific state. It is persisted only through the frozen artifact store. */
  payload: Uint8Array;
  expiresAt: string;
}

export interface AndroidDevicePort {
  inspect(): Promise<AndroidInspection>;
  launchApp(packageName: string, activity: string | null): Promise<void>;
  tap(coordinates: z.infer<typeof CoordinatesSchema>): Promise<void>;
  typeText(text: string): Promise<void>;
  swipe(input: z.infer<(typeof AndroidActionPayloads)['swipe']>): Promise<void>;
  pressBack(): Promise<void>;
  waitForIdle(timeoutMs: number): Promise<void>;
  resetApp(packageName: string): Promise<void>;
  createSnapshot(): Promise<AndroidPortSnapshot>;
  restoreSnapshot(input: { snapshotId: string; payload: Uint8Array }): Promise<void>;
  captureScreenshot(): Promise<Uint8Array>;
}

/** A local, content-addressed store. It deliberately has no remote URL or shell surface. */
export interface AndroidFrozenArtifactStore {
  freeze(input: {
    purpose: 'hierarchy' | 'state' | 'screenshot' | 'snapshot';
    data: Uint8Array;
    mediaType: string;
  }): Promise<EnvironmentEvidenceArtifact>;
  read(ref: string): Promise<Uint8Array>;
}

export interface AndroidHostAvailability {
  adbAvailable: boolean;
  appiumAvailable: boolean;
  deviceAvailable: boolean;
  appAvailable: boolean;
  resetSupported: boolean;
}

export interface AndroidCapabilityReport {
  status: 'PASS' | 'UNVERIFIED';
  hostCapability: HostEnvironmentCapability;
}

export interface AndroidEnvironmentAciOptions {
  platform?: 'android';
  adapterId: string;
  environmentId: string;
  sessionId: string;
  packageName: string;
  activity?: string | null;
  deviceId: string;
  operationTimeoutMs: number;
  port: AndroidDevicePort;
  artifacts: AndroidFrozenArtifactStore;
  now?: () => string;
  /** Required only for direct runScenario; the core coordinator remains the execution authority. */
  hostCapability?: HostEnvironmentCapability;
  artifactValidator?: (artifact: EnvironmentEvidenceArtifact) => void;
}

export class AndroidEnvironmentAciError extends Error {
  constructor(
    readonly code: 'android-port-failed' | 'android-port-timeout' | 'android-snapshot-invalid',
  ) {
    super(code);
    this.name = 'AndroidEnvironmentAciError';
  }
}

function bytes(value: unknown): Uint8Array {
  const raw = Buffer.from(JSON.stringify(value), 'utf8');
  if (raw.byteLength > MAX_PORT_JSON_BYTES)
    throw new AndroidEnvironmentAciError('android-port-failed');
  return raw;
}

const AWS_ACCESS_KEY = /(?:^|[^A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])/;
const OPENAI_SECRET_KEY = /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/i;
const BEARER_TOKEN = /\bbearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/i;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/;
const PRIVATE_KEY_MARKER = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const TOKEN_CANDIDATE = /[A-Za-z0-9+/_=-]{20,}/g;
const SENSITIVE_KEY_PARTS = new Set([
  'authorization',
  'bearer',
  'card',
  'cookie',
  'credential',
  'credentials',
  'cvc',
  'cvv',
  'pan',
  'passwd',
  'password',
  'secret',
  'token',
]);
const SENSITIVE_KEY_COMPOUNDS = ['accesskey', 'apikey', 'privatekey'];

function sensitiveKeyParts(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
  const parts = sensitiveKeyParts(key);
  const collapsed = parts.join('');
  return (
    parts.some((part) => SENSITIVE_KEY_PARTS.has(part)) ||
    SENSITIVE_KEY_COMPOUNDS.some((compound) => collapsed.includes(compound)) ||
    containsIntrinsicSensitiveValue(key)
  );
}

function hasSensitiveAssignment(value: string): boolean {
  const assignments =
    /(?:^|[\s,{;])["']?([A-Za-z][A-Za-z0-9_-]{0,63})["']?\s*[:=]\s*(?:["'][^"']*["']|[^\s,;}]+)/g;
  return [...value.matchAll(assignments)].some((match) => isSensitiveKey(match[1]));
}

function hasPaymentLikeNumber(value: string): boolean {
  return (value.match(/\d(?:[ -]?\d)+/g) ?? []).some((candidate) => {
    const digits = candidate.replace(/\D/g, '').length;
    return digits >= 13 && digits <= 19;
  });
}

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
}

function hasHighEntropyToken(value: string): boolean {
  return (value.match(TOKEN_CANDIDATE) ?? []).some((candidate) => {
    const token = candidate.replace(/=+$/, '');
    if (token.length < 20) return false;
    if (/^[A-Fa-f0-9]{20,}$/.test(token)) return true;
    const mixedBase64 =
      /[A-Z]/.test(token) && /[a-z]/.test(token) && (/[0-9]/.test(token) || /[+/_-]/.test(token));
    const tokenEntropy = entropy(token);
    return (mixedBase64 && tokenEntropy >= 3.5) || tokenEntropy >= 4.2;
  });
}

function containsIntrinsicSensitiveValue(value: string): boolean {
  return (
    AWS_ACCESS_KEY.test(value) ||
    OPENAI_SECRET_KEY.test(value) ||
    BEARER_TOKEN.test(value) ||
    JWT_TOKEN.test(value) ||
    PRIVATE_KEY_MARKER.test(value) ||
    hasPaymentLikeNumber(value) ||
    hasHighEntropyToken(value)
  );
}

function containsSensitiveValue(value: string): boolean {
  return containsIntrinsicSensitiveValue(value) || hasSensitiveAssignment(value);
}

function isUnsafeText(value: string): boolean {
  return (
    /[\x00-\x1f\x7f]/.test(value) ||
    /[;&|`$<>\\]/.test(value) ||
    /<\s*\/?\s*script\b/i.test(value) ||
    /\b(?:java|vb)script\s*:/i.test(value) ||
    /\bon[a-z]+\s*=/i.test(value) ||
    isSensitiveKey(value.trim()) ||
    containsSensitiveValue(value)
  );
}

function neutralKey(key: string, reserved: Set<string>): string {
  const base = `field-${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)}`;
  let candidate = base;
  let collision = 1;
  while (reserved.has(candidate)) {
    candidate = `${base}-${collision}`;
    collision += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function sanitize(value: JsonValue, depth = 0): JsonValue {
  if (depth > 16) return '[REDACTED]';
  if (typeof value === 'string') return containsSensitiveValue(value) ? '[REDACTED]' : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 128).map((entry) => sanitize(entry, depth + 1));
  const entries = Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, 128);
  const reserved = new Set(entries.filter(([key]) => !isSensitiveKey(key)).map(([key]) => key));
  const output: Record<string, JsonValue> = {};
  for (const [key, entry] of entries) {
    if (isSensitiveKey(key)) output[neutralKey(key, reserved)] = '[REDACTED]';
    else output[key] = sanitize(entry, depth + 1);
  }
  return output;
}

function assertSafeArtifact(
  artifact: EnvironmentEvidenceArtifact,
  content: Uint8Array,
  expectedMediaType: string,
): void {
  if (
    !isPlainRecord(artifact) ||
    typeof artifact.ref !== 'string' ||
    typeof artifact.sha256 !== 'string' ||
    typeof artifact.bytes !== 'number' ||
    typeof artifact.mediaType !== 'string' ||
    !SAFE_ARTIFACT_REF.test(artifact.ref) ||
    artifact.ref.startsWith('/') ||
    artifact.ref.includes('..') ||
    artifact.bytes !== content.byteLength ||
    artifact.sha256 !== createHash('sha256').update(content).digest('hex') ||
    artifact.mediaType !== expectedMediaType
  ) {
    throw new AndroidEnvironmentAciError('android-snapshot-invalid');
  }
}

function safeError(error: unknown): AndroidEnvironmentAciError {
  if (error instanceof AndroidEnvironmentAciError) return error;
  return new AndroidEnvironmentAciError('android-port-failed');
}

function safePackage(value: string): string {
  if (!PACKAGE_NAME.test(value) || value.length > 160)
    throw new AndroidEnvironmentAciError('android-port-failed');
  return value;
}

function safeActivity(value: string | null, packageName: string): string | null {
  if (value === null) return null;
  const relative = value.startsWith('.');
  const expectedPrefix = `${packageName}.`;
  const suffix = relative
    ? value.slice(1)
    : value.startsWith(expectedPrefix)
      ? value.slice(expectedPrefix.length)
      : '';
  if (
    value.length > 192 ||
    suffix.length === 0 ||
    suffix.split('.').some((segment) => !JAVA_IDENTIFIER.test(segment))
  ) {
    throw new AndroidEnvironmentAciError('android-port-failed');
  }
  return value;
}

function cloneSnapshot(snapshot: EnvironmentSnapshot): EnvironmentSnapshot {
  return structuredClone(snapshot);
}

function sameSnapshot(left: EnvironmentSnapshot, right: EnvironmentSnapshot): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.adapterId === right.adapterId &&
    left.environmentId === right.environmentId &&
    left.sessionId === right.sessionId &&
    left.scenarioId === right.scenarioId &&
    left.executionId === right.executionId &&
    left.sequence === right.sequence &&
    left.requestedAt === right.requestedAt &&
    left.snapshotId === right.snapshotId &&
    left.snapshotRef === right.snapshotRef &&
    left.snapshotBytes === right.snapshotBytes &&
    left.snapshotMediaType === right.snapshotMediaType &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    left.stateSha256 === right.stateSha256 &&
    left.environmentFingerprint === right.environmentFingerprint &&
    left.snapshotSha256 === right.snapshotSha256
  );
}

/**
 * Produces a host capability that is deliberately disabled unless a real Android host is present.
 * The adapter itself has no dependency on adb, Appium, or a particular driver implementation.
 */
export function androidEnvironmentCapability(
  descriptor: EnvironmentAciDescriptor,
  availability: Partial<AndroidHostAvailability> | undefined,
): AndroidCapabilityReport {
  let parsedDescriptor: EnvironmentAciDescriptor;
  try {
    parsedDescriptor = parseEnvironmentAciDescriptor(descriptor);
  } catch {
    throw new AndroidEnvironmentAciError('android-port-failed');
  }
  if (
    availability !== undefined &&
    (!isPlainRecord(availability) ||
      Object.keys(availability).some(
        (key) =>
          ![
            'adbAvailable',
            'appiumAvailable',
            'deviceAvailable',
            'appAvailable',
            'resetSupported',
          ].includes(key),
      ) ||
      Object.values(availability).some((value) => typeof value !== 'boolean'))
  ) {
    throw new AndroidEnvironmentAciError('android-port-failed');
  }
  const absent = (
    Object.keys({
      adbAvailable: true,
      appiumAvailable: true,
      deviceAvailable: true,
      appAvailable: true,
      resetSupported: true,
    }) as Array<keyof AndroidHostAvailability>
  ).filter((key) => availability?.[key] !== true);
  const wrongKind = parsedDescriptor.kind !== 'android';
  const enabled = !wrongKind && absent.length === 0;
  const limitations = [
    ...(wrongKind ? ['Android capability requires an Android environment descriptor.'] : []),
    ...absent.map((key) => `Android host support unavailable: ${key}.`),
  ];
  return {
    status: enabled ? 'PASS' : 'UNVERIFIED',
    hostCapability: {
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      enabled,
      environmentFingerprint: parsedDescriptor.environmentFingerprint,
      capabilityFingerprint: parsedDescriptor.capabilityFingerprint,
      operationTimeoutMs: parsedDescriptor.operationTimeoutMs,
      operations: parsedDescriptor.operations,
      reason: enabled ? null : 'android-capability-unverified',
      limitations: enabled ? [] : limitations,
    },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

export class AndroidEnvironmentAciAdapter implements EnvironmentAciAdapter {
  readonly descriptor: EnvironmentAciDescriptor;
  private readonly packageName: string;
  private readonly activity: string | null;
  private readonly now: () => string;
  private readonly snapshots = new Map<
    string,
    { port: AndroidPortSnapshot; snapshot: EnvironmentSnapshot; consumed: boolean }
  >();

  private pruneExpiredSnapshots(nowValue: string): number {
    const now = Date.parse(nowValue);
    if (!Number.isFinite(now)) throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    for (const [key, stored] of this.snapshots) {
      const expiresAt = Date.parse(stored.snapshot.expiresAt);
      if (!Number.isFinite(expiresAt) || now >= expiresAt) this.snapshots.delete(key);
    }
    return now;
  }

  private requireSnapshotCapacity(nowValue: string): void {
    this.pruneExpiredSnapshots(nowValue);
    if (this.snapshots.size >= MAX_SNAPSHOTS) {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
  }

  constructor(private readonly options: AndroidEnvironmentAciOptions) {
    if (
      !isPlainRecord(options) ||
      Object.keys(options).some(
        (key) =>
          ![
            'platform',
            'adapterId',
            'environmentId',
            'sessionId',
            'packageName',
            'activity',
            'deviceId',
            'operationTimeoutMs',
            'port',
            'artifacts',
            'now',
            'hostCapability',
            'artifactValidator',
          ].includes(key),
      ) ||
      !Number.isInteger(options.operationTimeoutMs) ||
      options.operationTimeoutMs < 1 ||
      options.operationTimeoutMs > 120_000
    ) {
      throw new AndroidEnvironmentAciError('android-port-failed');
    }
    if (options.platform !== undefined && options.platform !== 'android') {
      throw new AndroidEnvironmentAciError('android-port-failed');
    }
    this.packageName = safePackage(options.packageName);
    this.activity = safeActivity(options.activity ?? null, this.packageName);
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(options.deviceId)) {
      throw new AndroidEnvironmentAciError('android-port-failed');
    }
    const descriptor: EnvironmentAciDescriptorInput = {
      adapterId: options.adapterId,
      environmentId: options.environmentId,
      sessionId: options.sessionId,
      kind: 'android',
      operationTimeoutMs: options.operationTimeoutMs,
      operations: {
        observe: true,
        act: true,
        reset: true,
        snapshot: true,
        restore: true,
        runScenario: true,
        collectEvidence: true,
      },
      actionKinds: [...ANDROID_ACTION_KINDS],
      environment: {
        platform: 'android',
        deviceId: options.deviceId,
        packageName: this.packageName,
        activity: this.activity,
      },
    };
    this.descriptor = createEnvironmentAciDescriptor(descriptor);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async bounded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw safeError(error);
    }
  }

  private assertIdentity(value: {
    schemaVersion: string;
    adapterId: string;
    environmentId: string;
    sessionId: string;
    sequence: number;
  }): void {
    if (
      value.schemaVersion !== ENVIRONMENT_ACI_SCHEMA_VERSION ||
      value.adapterId !== this.descriptor.adapterId ||
      value.environmentId !== this.descriptor.environmentId ||
      value.sessionId !== this.descriptor.sessionId ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0
    )
      throw new AndroidEnvironmentAciError('android-port-failed');
  }

  private async inspectionState(): Promise<AndroidInspection> {
    const inspection = await this.bounded(() => this.options.port.inspect());
    const sanitized = {
      hierarchy: sanitize(inspection.hierarchy),
      deviceState: sanitize(inspection.deviceState),
      appState: sanitize(inspection.appState),
    };
    bytes(sanitized.hierarchy);
    bytes(sanitized.deviceState);
    bytes(sanitized.appState);
    return sanitized;
  }

  private async frozen(
    purpose: 'hierarchy' | 'state' | 'screenshot' | 'snapshot',
    data: Uint8Array,
    mediaType: string,
  ): Promise<EnvironmentEvidenceArtifact> {
    const artifact = await this.bounded(() =>
      this.options.artifacts.freeze({ purpose, data, mediaType }),
    );
    assertSafeArtifact(artifact, data, mediaType);
    let persisted: Uint8Array;
    try {
      persisted = await this.options.artifacts.read(artifact.ref);
    } catch {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
    assertSafeArtifact(artifact, persisted, mediaType);
    if (!Buffer.from(persisted).equals(Buffer.from(data))) {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
    return { ...artifact };
  }

  private identity(
    request: EnvironmentObserveRequest | EnvironmentResetRequest | EnvironmentSnapshotRequest,
  ) {
    return {
      schemaVersion: request.schemaVersion,
      adapterId: request.adapterId,
      environmentId: request.environmentId,
      sessionId: request.sessionId,
      scenarioId: request.scenarioId,
      executionId: request.executionId,
      sequence: request.sequence,
      requestedAt: request.requestedAt,
    };
  }

  async observe(request: EnvironmentObserveRequest): Promise<EnvironmentObservation> {
    this.assertIdentity(request);
    const inspected = await this.inspectionState();
    return createEnvironmentObservation({
      ...this.identity(request),
      afterActionId: request.afterActionId,
      observedAt: this.now(),
      state: {
        uiHierarchy: inspected.hierarchy,
        device: inspected.deviceState,
        app: inspected.appState,
      },
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }

  async act(action: EnvironmentAction) {
    this.assertIdentity(action);
    parseEnvironmentAction(action);
    let status: 'PASS' | 'FAIL' = 'PASS';
    let reason: string | null = null;
    let negativePaths: string[] = [];
    try {
      const kind = action.kind as AndroidActionKind;
      if (!ANDROID_ACTION_KINDS.includes(kind))
        throw new AndroidEnvironmentAciError('android-port-failed');
      const payload = AndroidActionPayloads[kind].parse(action.payload);
      if (kind === 'launch')
        await this.bounded(() => this.options.port.launchApp(this.packageName, this.activity));
      if (kind === 'tap')
        await this.bounded(() =>
          this.options.port.tap(payload as z.infer<typeof CoordinatesSchema>),
        );
      if (kind === 'type')
        await this.bounded(() => this.options.port.typeText((payload as { text: string }).text));
      if (kind === 'swipe')
        await this.bounded(() =>
          this.options.port.swipe(payload as z.infer<(typeof AndroidActionPayloads)['swipe']>),
        );
      if (kind === 'back') await this.bounded(() => this.options.port.pressBack());
      if (kind === 'wait')
        await this.bounded(() =>
          this.options.port.waitForIdle((payload as { timeoutMs: number }).timeoutMs),
        );
    } catch (error) {
      const safe = safeError(error);
      if (
        action.kind === 'type' &&
        isPlainRecord(action.payload) &&
        typeof action.payload.text === 'string' &&
        isUnsafeText(action.payload.text)
      ) {
        throw safe;
      }
      status = 'FAIL';
      reason = safe.code;
      negativePaths = [safe.code];
    }
    return createEnvironmentActionResult({
      ...action,
      completedAt: this.now(),
      status,
      reason,
      negativePaths,
      limitations:
        status === 'PASS' ? [] : ['Android device port did not complete the requested action.'],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }

  async reset(request: EnvironmentResetRequest): Promise<EnvironmentObservation> {
    this.assertIdentity(request);
    await this.bounded(() => this.options.port.resetApp(this.packageName));
    const inspected = await this.inspectionState();
    return createEnvironmentObservation({
      ...this.identity(request),
      afterActionId: null,
      observedAt: this.now(),
      state: {
        reset: request.reason,
        uiHierarchy: inspected.hierarchy,
        device: inspected.deviceState,
        app: inspected.appState,
      },
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }

  async snapshot(request: EnvironmentSnapshotRequest): Promise<EnvironmentSnapshot> {
    this.assertIdentity(request);
    this.requireSnapshotCapacity(this.now());
    const [inspected, portSnapshot] = await Promise.all([
      this.inspectionState(),
      this.bounded(() => this.options.port.createSnapshot()),
    ]);
    const data = bytes({
      binding: {
        deviceId: this.options.deviceId,
        packageName: this.packageName,
        sessionId: request.sessionId,
        environmentFingerprint: this.descriptor.environmentFingerprint,
      },
      portSnapshot: {
        snapshotId: portSnapshot.snapshotId,
        payload: Buffer.from(portSnapshot.payload).toString('base64'),
        expiresAt: portSnapshot.expiresAt,
      },
      inspection: inspected,
    });
    const artifact = await this.frozen('snapshot', data, 'application/json');
    const createdAt = this.now();
    const snapshot = createEnvironmentSnapshot({
      ...this.identity(request),
      snapshotId: portSnapshot.snapshotId,
      snapshotRef: artifact.ref,
      snapshotBytes: artifact.bytes,
      snapshotMediaType: artifact.mediaType,
      createdAt,
      expiresAt: portSnapshot.expiresAt,
      stateSha256: artifact.sha256,
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
    const storedSnapshot = cloneSnapshot(snapshot);
    this.requireSnapshotCapacity(createdAt);
    if (this.snapshots.has(storedSnapshot.snapshotSha256)) {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
    this.snapshots.set(storedSnapshot.snapshotSha256, {
      port: { ...portSnapshot, payload: Buffer.from(portSnapshot.payload) },
      snapshot: storedSnapshot,
      consumed: false,
    });
    return cloneSnapshot(snapshot);
  }

  async restore(input: EnvironmentSnapshot): Promise<EnvironmentObservation> {
    let snapshot: EnvironmentSnapshot;
    try {
      snapshot = parseEnvironmentSnapshot(input);
    } catch {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
    const now = this.pruneExpiredSnapshots(this.now());
    const stored = this.snapshots.get(snapshot.snapshotSha256);
    if (
      !stored ||
      stored.consumed ||
      !sameSnapshot(stored.snapshot, snapshot) ||
      !Number.isFinite(now) ||
      now >= Date.parse(stored.snapshot.expiresAt)
    ) {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
    this.snapshots.set(snapshot.snapshotSha256, { ...stored, consumed: true });
    const raw = await this.bounded(() => this.options.artifacts.read(stored.snapshot.snapshotRef));
    assertSafeArtifact(
      {
        ref: stored.snapshot.snapshotRef,
        sha256: stored.snapshot.stateSha256,
        bytes: stored.snapshot.snapshotBytes,
        mediaType: stored.snapshot.snapshotMediaType,
      },
      raw,
      'application/json',
    );
    let parsed: {
      binding?: {
        deviceId?: string;
        packageName?: string;
        sessionId?: string;
        environmentFingerprint?: string;
      };
      portSnapshot?: { snapshotId?: string; payload?: string; expiresAt?: string };
    };
    try {
      parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as typeof parsed;
    } catch {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
    if (
      parsed.binding?.deviceId !== this.options.deviceId ||
      parsed.binding?.packageName !== this.packageName ||
      parsed.binding?.sessionId !== snapshot.sessionId ||
      parsed.binding?.environmentFingerprint !== this.descriptor.environmentFingerprint ||
      typeof parsed.portSnapshot?.snapshotId !== 'string' ||
      typeof parsed.portSnapshot?.payload !== 'string' ||
      typeof parsed.portSnapshot?.expiresAt !== 'string'
    ) {
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    }
    const portSnapshot = stored.port;
    if (
      parsed.portSnapshot.snapshotId !== portSnapshot.snapshotId ||
      parsed.portSnapshot.payload !== Buffer.from(portSnapshot.payload).toString('base64') ||
      parsed.portSnapshot.expiresAt !== portSnapshot.expiresAt ||
      stored.snapshot.expiresAt !== portSnapshot.expiresAt
    )
      throw new AndroidEnvironmentAciError('android-snapshot-invalid');
    await this.bounded(() =>
      this.options.port.restoreSnapshot({
        snapshotId: portSnapshot.snapshotId,
        payload: Buffer.from(portSnapshot.payload),
      }),
    );
    const inspected = await this.inspectionState();
    return createEnvironmentObservation({
      schemaVersion: snapshot.schemaVersion,
      adapterId: snapshot.adapterId,
      environmentId: snapshot.environmentId,
      sessionId: snapshot.sessionId,
      scenarioId: snapshot.scenarioId,
      executionId: snapshot.executionId,
      sequence: snapshot.sequence + 1,
      requestedAt: this.now(),
      observedAt: this.now(),
      afterActionId: null,
      state: {
        restoredSnapshot: snapshot.snapshotId,
        uiHierarchy: inspected.hierarchy,
        device: inspected.deviceState,
        app: inspected.appState,
      },
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }

  async runScenario(scenario: EnvironmentScenario): Promise<EnvironmentScenarioReceipt> {
    const capability = this.options.hostCapability;
    return createEnvironmentAciCoordinator(this, capability, {
      artifactValidator: this.options.artifactValidator,
      now: this.now,
    }).runScenario(scenario);
  }

  async collectEvidence(request: EnvironmentEvidenceRequest): Promise<EnvironmentEvidenceReceipt> {
    this.assertIdentity(request);
    try {
      const inspected = await this.inspectionState();
      const [hierarchy, state, screenshot] = await Promise.all([
        this.frozen('hierarchy', bytes(inspected.hierarchy), 'application/json'),
        this.frozen(
          'state',
          bytes({ device: inspected.deviceState, app: inspected.appState }),
          'application/json',
        ),
        this.bounded(() => this.options.port.captureScreenshot()).then((data) =>
          this.frozen('screenshot', data, 'image/png'),
        ),
      ]);
      return createEnvironmentEvidenceReceipt({
        ...request,
        collectedAt: this.now(),
        status: 'PASS',
        artifacts: [hierarchy, state, screenshot],
        reason: null,
        negativePaths: [],
        limitations: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    } catch (error) {
      const safe = safeError(error);
      return createEnvironmentEvidenceReceipt({
        ...request,
        collectedAt: this.now(),
        status: 'FAIL',
        artifacts: [],
        reason: safe.code,
        negativePaths: [safe.code],
        limitations: ['Android evidence collection did not complete.'],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    }
  }
}

export { ANDROID_ACTION_KINDS };
