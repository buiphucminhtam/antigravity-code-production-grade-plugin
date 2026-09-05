import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  createEnvironmentAciCoordinator,
  createEnvironmentActionResult,
  createEnvironmentEvidenceReceipt,
  createEnvironmentObservation,
  createEnvironmentScenarioReceipt,
  createEnvironmentSnapshot,
  createTrustedArtifactRefValidator,
  hashEnvironmentAciPayload,
  parseEnvironmentSnapshot,
  type EnvironmentAciAdapter,
  type EnvironmentAciDescriptor,
  type EnvironmentAction,
  type EnvironmentActionResult,
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

export const WEB_ENVIRONMENT_ACTION_KINDS = [
  'navigate',
  'click',
  'fill',
  'press',
  'scroll',
] as const;
export interface WebSemanticState {
  accessibility: Record<string, unknown>;
  viewport: { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean };
  urlPath?: string;
  console?: Array<{ level: 'debug' | 'info' | 'warn' | 'error'; message: string }>;
  network?: Array<{ method: string; path: string; status: number }>;
}
export interface WebNavigationResult {
  finalUrl: string;
  resolvedAddresses: string[];
}
export interface WebDriverSnapshot {
  ref: string;
  bytes: number;
  mediaType: string;
  stateSha256: string;
  snapshotId: string;
  expiresAt: string;
}
export interface WebDriverEvidence {
  artifacts: EnvironmentEvidenceArtifact[];
  console?: WebSemanticState['console'];
  network?: WebSemanticState['network'];
}
export interface WebEnvironmentDriverPort {
  launch(): Promise<void>;
  observe(): Promise<WebSemanticState>;
  navigate(path: string): Promise<WebNavigationResult>;
  click(target: { role: string; name: string }): Promise<void>;
  fill(target: { role: string; name: string }, value: string): Promise<void>;
  press(key: string): Promise<void>;
  scroll(deltaY: number): Promise<void>;
  reset(): Promise<WebSemanticState>;
  snapshot(): Promise<WebDriverSnapshot>;
  restore(snapshot: WebDriverSnapshot): Promise<WebSemanticState>;
  collectEvidence(): Promise<WebDriverEvidence>;
}
export interface WebEnvironmentAciOptions {
  descriptor: EnvironmentAciDescriptor;
  driver?: WebEnvironmentDriverPort;
  now?: () => string;
  hostCapability?: HostEnvironmentCapability;
  trustedArtifactDirectory?: string;
  allowedOrigin?: string;
}

const SECRET_KEY = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key|session)/i;
const SECRET =
  /(?:(?:authorization|cookie|credential|password|secret|token|api[-_]?key)\s*[:=]\s*\S+|bearer\s+\S+|basic\s+\S+|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|(?:eyJ[a-zA-Z0-9_-]{10,}\.){2}[a-zA-Z0-9_-]{10,}|(?:sk|pk|AKIA)[-_a-zA-Z0-9]{16,}|\b(?:\d[ -]*?){13,19}\b|[A-Za-z0-9+/_-]{32,})/i;
const PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#=-]{0,480}$/;
const KEY =
  /^(?:Enter|Escape|Tab|Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down)|Home|End|Backspace|Delete|[A-Za-z0-9])$/;
const ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{64}$/;
const MEDIA = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const MAX_SNAPSHOTS = 128;
const identity = (
  input: { adapterId: string; environmentId: string; sessionId: string },
  descriptor: EnvironmentAciDescriptor,
) => {
  if (
    input.adapterId !== descriptor.adapterId ||
    input.environmentId !== descriptor.environmentId ||
    input.sessionId !== descriptor.sessionId
  )
    throw new Error('web-identity-mismatch');
};
const stableCode = (error: unknown) =>
  error instanceof Error && /^web-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : 'web-driver-failed';
type ParsedIpAddress = { version: 4 | 6; bytes: number[] };
const ipv4Bytes = (value: string): number[] | null => {
  if (isIP(value) !== 4) return null;
  const bytes = value.split('.').map(Number);
  return bytes.length === 4 ? bytes : null;
};
const parsedIpAddress = (raw: unknown): ParsedIpAddress | null => {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim()) return null;
  let value = raw.toLowerCase();
  if (value.startsWith('[') || value.endsWith(']')) {
    if (!value.startsWith('[') || !value.endsWith(']')) return null;
    value = value.slice(1, -1);
  }
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) {
    const zone = value.slice(zoneIndex + 1);
    if (!value.includes(':') || !zone || zone.includes('%') || !/^[a-z0-9._~-]+$/i.test(zone))
      return null;
    value = value.slice(0, zoneIndex);
  }
  const version = isIP(value);
  if (version === 4) {
    const bytes = ipv4Bytes(value);
    return bytes ? { version, bytes } : null;
  }
  if (version !== 6) return null;

  let normalized = value;
  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':');
    const embedded = ipv4Bytes(normalized.slice(separator + 1));
    if (separator < 0 || !embedded) return null;
    normalized = `${normalized.slice(0, separator)}:${((embedded[0] << 8) | embedded[1]).toString(
      16,
    )}:${((embedded[2] << 8) | embedded[3]).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  const groups = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? omitted : 0 }, () => '0'),
    ...right,
  ];
  if (groups.length !== 8) return null;
  const bytes = groups.flatMap((group) => {
    const word = Number.parseInt(group, 16);
    return [word >>> 8, word & 0xff];
  });
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ? { version, bytes }
    : null;
};
const hasPrefix = (bytes: number[], prefix: number[], bits: number) => {
  const wholeBytes = Math.floor(bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  const remainingBits = bits % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[wholeBytes] & mask) === ((prefix[wholeBytes] ?? 0) & mask);
};
const globallyRoutableIpv4 = ([first, second, third]: number[]) =>
  !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
const globallyRoutableIpAddress = ({ version, bytes }: ParsedIpAddress) => {
  if (version === 4) return globallyRoutableIpv4(bytes);
  const mappedIpv4 =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatibleIpv4 = bytes.slice(0, 12).every((byte) => byte === 0);
  if (mappedIpv4 || compatibleIpv4) return globallyRoutableIpv4(bytes.slice(12));
  if (!hasPrefix(bytes, [0x20], 3)) return false;
  if (hasPrefix(bytes, [0x20, 0x01, 0x00], 23)) return false;
  if (hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return false;
  if (hasPrefix(bytes, [0x3f, 0xfe], 16)) return false;
  if (hasPrefix(bytes, [0x3f, 0xff, 0x00], 20)) return false;
  if (hasPrefix(bytes, [0x20, 0x02], 16)) return globallyRoutableIpv4(bytes.slice(2, 6));
  return true;
};
const publicIpAddress = (raw: unknown) => {
  const parsed = parsedIpAddress(raw);
  return parsed !== null && globallyRoutableIpAddress(parsed);
};
const forbiddenIpLiteral = (raw: string) => {
  const parsed = parsedIpAddress(raw);
  return parsed !== null && !globallyRoutableIpAddress(parsed);
};
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type StoredWebSnapshot = Readonly<{
  sealed: Readonly<EnvironmentSnapshot>;
  raw: Readonly<WebDriverSnapshot>;
  consumed: boolean;
}>;
const sameSnapshot = (left: EnvironmentSnapshot, right: Readonly<EnvironmentSnapshot>) =>
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
  left.snapshotSha256 === right.snapshotSha256;
const neutralKey = (key: string) =>
  `field-${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)}`;
const sanitized = (value: unknown): JsonValue => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string')
    return value.length > 4096 || SECRET.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.slice(0, 128).map(sanitized);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const reserved = new Set(keys.filter((key) => !SECRET_KEY.test(key)));
    const used = new Set<string>();
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys) {
      const sensitive = SECRET_KEY.test(key);
      const base = sensitive ? neutralKey(key) : key;
      let resultKey = base;
      let suffix = 1;
      while (used.has(resultKey) || (sensitive && reserved.has(resultKey))) {
        resultKey = `${base}-${suffix}`;
        suffix += 1;
      }
      output[resultKey] = sensitive ? '[redacted]' : sanitized(source[key]);
      used.add(resultKey);
    }
    return output;
  }
  return '[redacted]';
};

export class WebEnvironmentAciAdapter implements EnvironmentAciAdapter {
  readonly descriptor: EnvironmentAciDescriptor;
  private readonly now: () => string;
  private readonly driver?: WebEnvironmentDriverPort;
  private readonly host?: HostEnvironmentCapability;
  private readonly artifactRoot?: string;
  private readonly validateArtifact?: EnvironmentArtifactValidator;
  private readonly origin?: URL;
  private readonly snapshots = new Map<string, StoredWebSnapshot>();
  private launch?: Promise<void>;
  constructor(options: WebEnvironmentAciOptions) {
    if (options.descriptor.kind !== 'web') throw new Error('web-descriptor-kind');
    if (
      !Number.isInteger(options.descriptor.operationTimeoutMs) ||
      options.descriptor.operationTimeoutMs < 1 ||
      options.descriptor.operationTimeoutMs > 120000
    )
      throw new Error('web-timeout-invalid');
    if (
      options.descriptor.actionKinds.length !== 5 ||
      !WEB_ENVIRONMENT_ACTION_KINDS.every((kind) => options.descriptor.actionKinds.includes(kind))
    )
      throw new Error('web-action-kinds-invalid');
    this.descriptor = options.descriptor;
    this.driver = options.driver;
    this.now = options.now ?? (() => new Date().toISOString());
    this.host = options.hostCapability;
    this.artifactRoot = options.trustedArtifactDirectory;
    this.validateArtifact = this.artifactRoot
      ? createTrustedArtifactRefValidator(this.artifactRoot)
      : undefined;
    this.origin = options.allowedOrigin ? new URL(options.allowedOrigin) : undefined;
    if (this.origin && this.origin.protocol !== 'https:') throw new Error('web-origin-invalid');
  }
  private pruneSnapshots(at: string) {
    const timestamp = Date.parse(at);
    if (!Number.isFinite(timestamp)) throw new Error('web-snapshot-invalid');
    for (const [snapshotId, stored] of this.snapshots) {
      if (Date.parse(stored.sealed.expiresAt) <= timestamp) this.snapshots.delete(snapshotId);
    }
  }
  private async port() {
    if (!this.driver) throw new Error('web-driver-missing');
    this.launch ??= this.driver.launch();
    await this.launch;
    return this.driver;
  }
  private async driverCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new Error(stableCode(error));
    }
  }
  private observation(
    request: EnvironmentObserveRequest | EnvironmentResetRequest,
    state: WebSemanticState,
  ): EnvironmentObservation {
    identity(request, this.descriptor);
    const { adapterId, environmentId, sessionId, scenarioId, executionId, sequence, requestedAt } =
      request;
    return createEnvironmentObservation({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId,
      environmentId,
      sessionId,
      scenarioId,
      executionId,
      sequence,
      requestedAt,
      afterActionId: 'afterActionId' in request ? request.afterActionId : null,
      observedAt: this.now(),
      state: sanitized({
        accessibility: state.accessibility,
        viewport: state.viewport,
        console: state.console ?? [],
        network: state.network ?? [],
        ...(state.urlPath === undefined ? {} : { urlPath: state.urlPath }),
      }),
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
  }
  async observe(request: EnvironmentObserveRequest) {
    identity(request, this.descriptor);
    return this.observation(
      request,
      await this.driverCall(async () => (await this.port()).observe()),
    );
  }
  async act(action: EnvironmentAction): Promise<EnvironmentActionResult> {
    identity(action, this.descriptor);
    try {
      await this.dispatch(action, await this.port());
      const evidence = await (await this.port()).collectEvidence();
      const bad = (evidence.console ?? []).some((line) => line.level === 'error');
      return createEnvironmentActionResult({
        ...action,
        completedAt: this.now(),
        status: bad ? 'FAIL' : 'PASS',
        reason: bad ? 'web-console-error' : null,
        negativePaths: bad ? ['web-console-error'] : [],
        limitations: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    } catch (error) {
      const reason = stableCode(error);
      return createEnvironmentActionResult({
        ...action,
        completedAt: this.now(),
        status: reason === 'web-driver-missing' ? 'UNVERIFIED' : 'FAIL',
        reason,
        negativePaths: [reason],
        limitations: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    }
  }
  private async dispatch(action: EnvironmentAction, port: WebEnvironmentDriverPort) {
    const payload = action.payload as Record<string, unknown>;
    const target = payload?.target;
    const validTarget = (value: unknown): value is { role: string; name: string } =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 2 &&
      typeof (value as Record<string, unknown>).role === 'string' &&
      typeof (value as Record<string, unknown>).name === 'string' &&
      !SECRET.test((value as Record<string, string>).role) &&
      !SECRET.test((value as Record<string, string>).name);
    if (
      !payload ||
      Array.isArray(payload) ||
      typeof payload !== 'object' ||
      Object.keys(payload).some((key) => SECRET_KEY.test(key) || /selector|url/i.test(key))
    )
      throw new Error('web-action-payload-invalid');
    if (action.kind === 'navigate') {
      if (
        Object.keys(payload).length !== 1 ||
        typeof payload.path !== 'string' ||
        !PATH.test(payload.path) ||
        /%(?:2f|5c|3a|40|2e)/i.test(payload.path)
      )
        throw new Error('web-navigation-denied');
      return this.navigation(await port.navigate(payload.path));
    }
    if (action.kind === 'click' && Object.keys(payload).length === 1 && validTarget(target))
      return port.click(target);
    if (
      action.kind === 'fill' &&
      Object.keys(payload).length === 2 &&
      validTarget(target) &&
      typeof payload.value === 'string' &&
      payload.value.length <= 4096 &&
      !SECRET.test(payload.value)
    )
      return port.fill(target, payload.value);
    if (
      action.kind === 'press' &&
      Object.keys(payload).length === 1 &&
      typeof payload.key === 'string' &&
      KEY.test(payload.key)
    )
      return port.press(payload.key);
    if (
      action.kind === 'scroll' &&
      Object.keys(payload).length === 1 &&
      typeof payload.deltaY === 'number' &&
      Number.isFinite(payload.deltaY) &&
      Math.abs(payload.deltaY) <= 10000
    )
      return port.scroll(payload.deltaY);
    throw new Error(
      action.kind === 'navigate'
        ? 'web-navigation-denied'
        : action.kind in { click: 1, fill: 1, press: 1, scroll: 1 }
          ? 'web-action-target-invalid'
          : 'web-action-kind-unknown',
    );
  }
  private navigation(result: WebNavigationResult) {
    try {
      const url = new URL(result.finalUrl);
      if (
        url.protocol !== 'https:' ||
        (this.origin && url.origin !== this.origin.origin) ||
        forbiddenIpLiteral(url.hostname) ||
        !Array.isArray(result.resolvedAddresses) ||
        result.resolvedAddresses.length === 0 ||
        result.resolvedAddresses.some((address) => !publicIpAddress(address))
      )
        throw new Error('web-navigation-denied');
    } catch {
      throw new Error('web-navigation-denied');
    }
  }
  async reset(request: EnvironmentResetRequest) {
    identity(request, this.descriptor);
    return this.observation(
      request,
      await this.driverCall(async () => (await this.port()).reset()),
    );
  }
  async snapshot(request: EnvironmentSnapshotRequest): Promise<EnvironmentSnapshot> {
    identity(request, this.descriptor);
    const startedAt = this.now();
    this.pruneSnapshots(startedAt);
    if (this.snapshots.size >= MAX_SNAPSHOTS) throw new Error('web-snapshot-capacity');
    const raw = await this.driverCall(async () => (await this.port()).snapshot());
    const createdAt = this.now();
    this.pruneSnapshots(createdAt);
    if (this.snapshots.size >= MAX_SNAPSHOTS) throw new Error('web-snapshot-capacity');
    if (
      !ID.test(raw.snapshotId) ||
      !raw.ref ||
      raw.ref.startsWith('/') ||
      raw.ref.includes('..') ||
      raw.ref.includes('\\') ||
      !SHA.test(raw.stateSha256) ||
      !Number.isInteger(raw.bytes) ||
      raw.bytes < 0 ||
      raw.bytes > 256 * 1024 * 1024 ||
      !MEDIA.test(raw.mediaType) ||
      Date.parse(raw.expiresAt) <= Date.parse(createdAt)
    )
      throw new Error('web-snapshot-invalid');
    const { adapterId, environmentId, sessionId, scenarioId, executionId, sequence, requestedAt } =
      request;
    const sealed = createEnvironmentSnapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId,
      environmentId,
      sessionId,
      scenarioId,
      executionId,
      sequence,
      requestedAt,
      snapshotId: raw.snapshotId,
      snapshotRef: raw.ref,
      snapshotBytes: raw.bytes,
      snapshotMediaType: raw.mediaType,
      createdAt,
      expiresAt: raw.expiresAt,
      stateSha256: raw.stateSha256,
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
    if (this.snapshots.has(sealed.snapshotId)) throw new Error('web-snapshot-invalid');
    this.snapshots.set(
      sealed.snapshotId,
      Object.freeze({
        sealed: Object.freeze(cloneJson(sealed)),
        raw: Object.freeze(cloneJson(raw)),
        consumed: false,
      }),
    );
    return sealed;
  }
  async restore(input: EnvironmentSnapshot): Promise<EnvironmentObservation> {
    const snapshot = parseEnvironmentSnapshot(input);
    identity(snapshot, this.descriptor);
    const restoredAt = this.now();
    this.pruneSnapshots(restoredAt);
    const stored = this.snapshots.get(snapshot.snapshotId);
    if (!stored) throw new Error('web-snapshot-invalid');
    if (stored.consumed) throw new Error('web-snapshot-replay');
    if (
      snapshot.environmentFingerprint !== this.descriptor.environmentFingerprint ||
      Date.parse(snapshot.expiresAt) <= Date.parse(restoredAt) ||
      !sameSnapshot(snapshot, stored.sealed) ||
      stored.raw.snapshotId !== stored.sealed.snapshotId ||
      stored.raw.ref !== stored.sealed.snapshotRef ||
      stored.raw.bytes !== stored.sealed.snapshotBytes ||
      stored.raw.mediaType !== stored.sealed.snapshotMediaType ||
      stored.raw.stateSha256 !== stored.sealed.stateSha256 ||
      stored.raw.expiresAt !== stored.sealed.expiresAt
    )
      throw new Error('web-snapshot-invalid');
    this.snapshots.set(snapshot.snapshotId, Object.freeze({ ...stored, consumed: true }));
    const state = await this.driverCall(async () =>
      (await this.port()).restore(cloneJson(stored.raw)),
    );
    return this.observation(
      {
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: snapshot.adapterId,
        environmentId: snapshot.environmentId,
        sessionId: snapshot.sessionId,
        scenarioId: snapshot.scenarioId,
        executionId: snapshot.executionId,
        sequence: snapshot.sequence + 1,
        requestedAt: this.now(),
        reason: 'manual',
      },
      state,
    );
  }
  async collectEvidence(request: EnvironmentEvidenceRequest): Promise<EnvironmentEvidenceReceipt> {
    identity(request, this.descriptor);
    const validateArtifact = this.validateArtifact;
    if (!validateArtifact)
      return createEnvironmentEvidenceReceipt({
        ...request,
        collectedAt: this.now(),
        status: 'UNVERIFIED',
        reason: 'web-artifact-root-missing',
        negativePaths: ['web-artifact-root-missing'],
        limitations: [],
        artifacts: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    try {
      const raw = await (await this.port()).collectEvidence();
      if (!raw || !Array.isArray(raw.artifacts) || raw.artifacts.length > 128)
        throw new Error('web-evidence-invalid');
      try {
        raw.artifacts.forEach((artifact) => validateArtifact(artifact));
      } catch {
        throw new Error('web-evidence-invalid');
      }
      const artifacts = raw.artifacts.filter(
        (item) => !SECRET_KEY.test(item.ref) && !SECRET.test(item.ref),
      );
      const semantic = sanitized({
        accessibility: {},
        viewport: { width: 0, height: 0 },
        console: raw.console ?? [],
        network: raw.network ?? [],
      });
      if (artifacts.length === 0)
        return createEnvironmentEvidenceReceipt({
          ...request,
          collectedAt: this.now(),
          status: 'UNVERIFIED',
          reason: 'web-evidence-missing',
          negativePaths: ['web-evidence-missing'],
          limitations: [],
          artifacts: [],
          environmentFingerprint: this.descriptor.environmentFingerprint,
        });
      const bad = (raw.console ?? []).some((line) => line.level === 'error');
      return createEnvironmentEvidenceReceipt({
        ...request,
        collectedAt: this.now(),
        status: bad ? 'FAIL' : 'PASS',
        reason: bad ? 'web-console-error' : null,
        negativePaths: bad ? ['web-console-error'] : [],
        limitations: [`semantic-state:${hashEnvironmentAciPayload(semantic)}`],
        artifacts,
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    } catch (error) {
      const reason = stableCode(error);
      return createEnvironmentEvidenceReceipt({
        ...request,
        collectedAt: this.now(),
        status: 'UNVERIFIED',
        reason,
        negativePaths: [reason],
        limitations: [],
        artifacts: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    }
  }
  async runScenario(scenario: EnvironmentScenario): Promise<EnvironmentScenarioReceipt> {
    identity(scenario, this.descriptor);
    if (!this.driver || !this.host || !this.artifactRoot)
      return createEnvironmentScenarioReceipt({
        ...scenario,
        status: 'UNVERIFIED',
        reason: !this.driver
          ? 'web-driver-missing'
          : !this.host
            ? 'web-capability-missing'
            : 'web-artifact-root-missing',
        negativePaths: [],
        limitations: ['web-scenario-prerequisite-missing'],
        startedAt: this.now(),
        completedAt: this.now(),
        sequence: 0,
        resetObservation: null,
        actions: [],
        actionResults: [],
        observations: [],
        evidence: [],
        cleanupObservation: null,
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    return createEnvironmentAciCoordinator(this, this.host, {
      now: this.now,
      trustedArtifactDirectory: this.artifactRoot,
    }).runScenario(scenario);
  }
}
