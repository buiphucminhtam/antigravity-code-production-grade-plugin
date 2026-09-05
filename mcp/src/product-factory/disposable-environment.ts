import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION = 'disposable-environment/v1' as const;
export const DISPOSABLE_ENVIRONMENT_MAX_CONTRACT_BYTES = 256 * 1024;
export const DISPOSABLE_ENVIRONMENT_OPERATIONS = [
  'provision',
  'start',
  'execute',
  'snapshot',
  'restore',
  'export',
  'teardown',
] as const;
export const DISPOSABLE_ENVIRONMENT_CAPABILITIES = [
  'filesystem',
  'network',
  'process',
  'secret',
  'resource',
] as const;

export type DisposableEnvironmentOperation = (typeof DISPOSABLE_ENVIRONMENT_OPERATIONS)[number];
export type DisposableEnvironmentCapability = (typeof DISPOSABLE_ENVIRONMENT_CAPABILITIES)[number];
export type DisposableEnvironmentState =
  'NEW' | 'PROVISIONED' | 'RUNNING' | 'QUARANTINED' | 'TORN_DOWN';
export type DisposableEnvironmentReceiptStatus = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'BLOCKED';
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SAFE_ENV_KEY = /^[A-Z_][A-Z0-9_]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SECRET_NAME =
  /(?:^|_)(?:authorization|cookie|credential|password|secret|token|api_?key)(?:_|$)/i;
const SECRET_VALUE =
  /(?:bearer\s+[a-z0-9._~+/-]{12,}|sk_[a-z0-9]{16,}|gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{16,}|glpat-[a-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|-----BEGIN[^-]*PRIVATE KEY-----)/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ITEMS = 128;
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const MAX_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REGISTRY_ENTRIES = 128;
const DEFAULT_REPLAY_ENTRIES = 2048;
const DEFAULT_SNAPSHOT_ENTRIES = 64;

export type DisposableEnvironmentErrorCode =
  | 'INVALID_CONTRACT'
  | 'REGISTRY_CAPACITY_EXCEEDED'
  | 'INVALID_STATE'
  | 'HOST_CAPABILITY_INVALID'
  | 'HOST_CAPABILITY_MISMATCH'
  | 'OS_ISOLATION_UNVERIFIED'
  | 'ATTESTATION_PROVIDER_MISSING'
  | 'ATTESTATION_VERIFIER_MISSING'
  | 'ATTESTATION_UNVERIFIED'
  | 'ATTESTATION_REPLAY'
  | 'ATTESTATION_EXPIRED'
  | 'TRUST_CALLBACK_TIMEOUT'
  | 'BACKEND_OPERATION_FAILED'
  | 'BACKEND_RESULT_INVALID'
  | 'OPERATION_TIMEOUT'
  | 'LATE_OPERATION_PENDING'
  | 'CAPABILITY_NETWORK_DENIED'
  | 'CAPABILITY_PROCESS_DENIED'
  | 'CAPABILITY_SECRET_DENIED'
  | 'COMMAND_NOT_ALLOWED'
  | 'ENVIRONMENT_NOT_ALLOWED'
  | 'SECRET_HANDLE_NOT_ALLOWED'
  | 'PATH_NOT_CONTAINED'
  | 'SYMLINK_NOT_ALLOWED'
  | 'FILESYSTEM_PROJECTION_MISSING'
  | 'FILESYSTEM_PROJECTION_UNVERIFIED'
  | 'EGRESS_NOT_ALLOWED'
  | 'EGRESS_PRIVATE_DESTINATION'
  | 'NETWORK_PROJECTION_MISSING'
  | 'NETWORK_PROJECTION_UNVERIFIED'
  | 'DNS_REBINDING_DETECTED'
  | 'MULTI_ADDRESS_DESTINATION_DENIED'
  | 'NETWORK_PIN_MISMATCH'
  | 'RESOURCE_QUOTA_EXCEEDED'
  | 'SNAPSHOT_EXPIRED'
  | 'SNAPSHOT_STALE'
  | 'SNAPSHOT_CROSS_ENVIRONMENT'
  | 'SNAPSHOT_REPLAY'
  | 'SNAPSHOT_TAMPERED'
  | 'ARTIFACT_VERIFIER_MISSING'
  | 'ARTIFACT_VERIFICATION_FAILED'
  | 'ARTIFACT_REVOKER_MISSING'
  | 'ARTIFACT_REVOKE_UNVERIFIED'
  | 'TEARDOWN_RECONCILER_MISSING'
  | 'TEARDOWN_RECONCILIATION_UNVERIFIED'
  | 'TEARDOWN_ORPHANS_REMAIN'
  | 'COMMAND_EXIT_NONZERO';

export class DisposableEnvironmentError extends Error {
  constructor(readonly code: DisposableEnvironmentErrorCode) {
    super(code);
    this.name = 'DisposableEnvironmentError';
  }
}

function fail(code: DisposableEnvironmentErrorCode): never {
  throw new DisposableEnvironmentError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail('INVALID_CONTRACT');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('INVALID_CONTRACT');
  }
}

function assertSafeId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 96 || !SAFE_ID.test(value))
    fail('INVALID_CONTRACT');
}

function assertSha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('INVALID_CONTRACT');
}

function assertTime(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('INVALID_CONTRACT');
}

function assertInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('INVALID_CONTRACT');
  }
}

function assertJson(value: unknown, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_CONTRACT');
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) fail('INVALID_CONTRACT');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ITEMS) fail('INVALID_CONTRACT');
      for (const entry of value) assertJson(entry, seen);
      return;
    }
    if (!isRecord(value) || Object.keys(value).length > MAX_ITEMS) fail('INVALID_CONTRACT');
    for (const entry of Object.values(value)) assertJson(entry, seen);
  } finally {
    seen.delete(value);
  }
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key] as JsonValue)]),
    );
  }
  return value;
}

export function canonicalDisposableEnvironmentJson(value: unknown): string {
  assertJson(value);
  const encoded = JSON.stringify(canonicalize(value));
  if (Buffer.byteLength(encoded, 'utf8') > DISPOSABLE_ENVIRONMENT_MAX_CONTRACT_BYTES) {
    fail('INVALID_CONTRACT');
  }
  return encoded;
}

export function hashDisposableEnvironmentPayload(value: unknown): string {
  return createHash('sha256')
    .update(canonicalDisposableEnvironmentJson(value), 'utf8')
    .digest('hex');
}

function safeHash(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return hashDisposableEnvironmentPayload(value);
  } catch {
    return null;
  }
}

function without(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const rejected = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !rejected.has(key)));
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail('INVALID_CONTRACT');
}

function assertRelative(value: unknown, allowDot = false): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    CONTROL.test(value)
  ) {
    fail('PATH_NOT_CONTAINED');
  }
  if (allowDot && value === '.') return;
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  ) {
    fail('PATH_NOT_CONTAINED');
  }
}

function contained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation === '' ||
    (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
  );
}

function nonSymlinkRoot(rootInput: string): string {
  const root = resolve(rootInput);
  if (root === resolve('/') || !existsSync(root)) fail('PATH_NOT_CONTAINED');
  const info = lstatSync(root);
  if (info.isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED');
  if (!info.isDirectory()) fail('PATH_NOT_CONTAINED');
  return realpathSync(root);
}

function assertNoSymlinkPath(root: string, ref: string, mustExist: boolean): void {
  assertRelative(ref, true);
  if (ref === '.') return;
  let current = root;
  const segments = ref.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    if (!contained(root, current)) fail('PATH_NOT_CONTAINED');
    if (!existsSync(current)) {
      if (mustExist || index < segments.length - 1) fail('PATH_NOT_CONTAINED');
      return;
    }
    if (lstatSync(current).isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED');
  }
  if (!contained(root, realpathSync(current))) fail('PATH_NOT_CONTAINED');
}

export interface DisposableMountPolicy {
  mountId: string;
  sourceRef: string;
  targetRef: string;
  sourceSha256: string;
  access: 'read-only';
}

export interface DisposableFilesystemCapability {
  enabled: boolean;
  readOnlyPaths: readonly string[];
  writablePaths: readonly string[];
  mounts: readonly DisposableMountPolicy[];
}

export interface EgressDestination {
  protocol: 'http' | 'https' | 'tcp';
  hostname: string;
  port: number;
}

export interface DisposableNetworkCapability {
  enabled: boolean;
  egressAllowlist: readonly EgressDestination[];
}

export interface DisposableProcessCapability {
  enabled: boolean;
  allowedExecutables: readonly string[];
  environmentAllowlist: Readonly<Record<string, string>>;
  childProcesses: 'deny';
  maxArgCount: number;
  maxArgBytes: number;
}

export interface DisposableSecretCapability {
  enabled: boolean;
  allowedHandles: readonly string[];
}

export interface DisposableResourceCapability {
  cpuMillis: number;
  memoryBytes: number;
  pids: number;
  wallTimeMs: number;
  outputBytes: number;
  diskBytes: number;
  snapshotBytes: number;
  artifactBytes: number;
}

export interface DisposableEnvironmentCapabilities {
  filesystem: DisposableFilesystemCapability;
  network: DisposableNetworkCapability;
  process: DisposableProcessCapability;
  secret: DisposableSecretCapability;
  resource: DisposableResourceCapability;
}

export interface DisposableEnvironmentPolicyInput {
  policyId: string;
  capabilities: DisposableEnvironmentCapabilities;
}

export interface DisposableEnvironmentPolicy extends DisposableEnvironmentPolicyInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  capabilitySha256: string;
  policySha256: string;
}

export interface DisposableWorkspaceInput {
  workspaceId: string;
  root: string;
}

export interface DisposableWorkspace extends DisposableWorkspaceInput {
  workspaceSha256: string;
}

function normalizeDestination(input: EgressDestination): EgressDestination {
  assertExactKeys(input, ['hostname', 'port', 'protocol']);
  if (input.protocol !== 'http' && input.protocol !== 'https' && input.protocol !== 'tcp') {
    fail('INVALID_CONTRACT');
  }
  if (typeof input.hostname !== 'string') fail('INVALID_CONTRACT');
  const hostname = input.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(hostname) && isIP(hostname) === 0) fail('INVALID_CONTRACT');
  assertInteger(input.port, 1, 65_535);
  return { protocol: input.protocol, hostname, port: input.port };
}

function endpointKey(destination: EgressDestination): string {
  return `${destination.protocol}:${destination.hostname}:${destination.port}`;
}

function validateCapabilities(
  input: DisposableEnvironmentCapabilities,
): DisposableEnvironmentCapabilities {
  assertExactKeys(input, ['filesystem', 'network', 'process', 'resource', 'secret']);
  const filesystem = input.filesystem;
  assertExactKeys(filesystem, ['enabled', 'mounts', 'readOnlyPaths', 'writablePaths']);
  if (
    typeof filesystem.enabled !== 'boolean' ||
    !Array.isArray(filesystem.readOnlyPaths) ||
    !Array.isArray(filesystem.writablePaths) ||
    !Array.isArray(filesystem.mounts) ||
    filesystem.readOnlyPaths.length > MAX_ITEMS ||
    filesystem.writablePaths.length > MAX_ITEMS ||
    filesystem.mounts.length > MAX_ITEMS
  ) {
    fail('INVALID_CONTRACT');
  }
  const readOnlyPaths = [...filesystem.readOnlyPaths] as unknown[];
  const writablePaths = [...filesystem.writablePaths] as unknown[];
  for (const ref of [...readOnlyPaths, ...writablePaths]) assertRelative(ref, true);
  assertUnique([...readOnlyPaths, ...writablePaths] as string[]);
  const mounts = (filesystem.mounts as unknown[]).map((entry) => {
    assertExactKeys(entry, ['access', 'mountId', 'sourceRef', 'sourceSha256', 'targetRef']);
    assertSafeId(entry.mountId);
    assertRelative(entry.sourceRef);
    assertRelative(entry.targetRef);
    assertSha(entry.sourceSha256);
    if (entry.access !== 'read-only') fail('INVALID_CONTRACT');
    return {
      mountId: entry.mountId,
      sourceRef: entry.sourceRef,
      targetRef: entry.targetRef,
      sourceSha256: entry.sourceSha256,
      access: 'read-only' as const,
    };
  });
  assertUnique(mounts.map(({ mountId }) => mountId));
  assertUnique(mounts.map(({ targetRef }) => targetRef));
  if (
    !filesystem.enabled &&
    (readOnlyPaths.length > 0 || writablePaths.length > 0 || mounts.length > 0)
  ) {
    fail('INVALID_CONTRACT');
  }

  const network = input.network;
  assertExactKeys(network, ['egressAllowlist', 'enabled']);
  if (
    typeof network.enabled !== 'boolean' ||
    !Array.isArray(network.egressAllowlist) ||
    network.egressAllowlist.length > MAX_ITEMS
  ) {
    fail('INVALID_CONTRACT');
  }
  const egressAllowlist = (network.egressAllowlist as unknown as EgressDestination[]).map(
    normalizeDestination,
  );
  for (const destination of egressAllowlist) {
    if (privateHostname(destination.hostname)) fail('EGRESS_PRIVATE_DESTINATION');
  }
  assertUnique(egressAllowlist.map(endpointKey));
  if (!network.enabled && egressAllowlist.length > 0) fail('INVALID_CONTRACT');

  const processCapability = input.process;
  assertExactKeys(processCapability, [
    'allowedExecutables',
    'childProcesses',
    'enabled',
    'environmentAllowlist',
    'maxArgBytes',
    'maxArgCount',
  ]);
  if (
    typeof processCapability.enabled !== 'boolean' ||
    processCapability.childProcesses !== 'deny' ||
    !Array.isArray(processCapability.allowedExecutables) ||
    processCapability.allowedExecutables.length > MAX_ITEMS ||
    !isRecord(processCapability.environmentAllowlist)
  ) {
    fail('INVALID_CONTRACT');
  }
  assertInteger(processCapability.maxArgCount, 1, MAX_ITEMS);
  assertInteger(processCapability.maxArgBytes, 1, MAX_TEXT_BYTES);
  const allowedExecutables = [...processCapability.allowedExecutables] as unknown[];
  for (const executable of allowedExecutables) {
    if (
      typeof executable !== 'string' ||
      executable.length === 0 ||
      executable.length > 256 ||
      CONTROL.test(executable) ||
      executable.includes('\\') ||
      executable.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      fail('INVALID_CONTRACT');
    }
  }
  assertUnique(allowedExecutables as string[]);
  const environmentAllowlist: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const environmentEntries = Object.entries(processCapability.environmentAllowlist);
  if (environmentEntries.length > MAX_ITEMS) fail('INVALID_CONTRACT');
  for (const [key, value] of environmentEntries) {
    if (
      !SAFE_ENV_KEY.test(key) ||
      PROTOTYPE_KEYS.has(key.toLowerCase()) ||
      SECRET_NAME.test(key) ||
      typeof value !== 'string' ||
      Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES ||
      CONTROL.test(value) ||
      SECRET_VALUE.test(value)
    ) {
      fail('INVALID_CONTRACT');
    }
    Object.defineProperty(environmentAllowlist, key, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (
    !processCapability.enabled &&
    (allowedExecutables.length > 0 || environmentEntries.length > 0)
  ) {
    fail('INVALID_CONTRACT');
  }

  const secret = input.secret;
  assertExactKeys(secret, ['allowedHandles', 'enabled']);
  if (
    typeof secret.enabled !== 'boolean' ||
    !Array.isArray(secret.allowedHandles) ||
    secret.allowedHandles.length > MAX_ITEMS
  ) {
    fail('INVALID_CONTRACT');
  }
  const allowedHandles = [...secret.allowedHandles] as unknown[];
  for (const handle of allowedHandles) assertSafeId(handle);
  assertUnique(allowedHandles as string[]);
  if (!secret.enabled && allowedHandles.length > 0) fail('INVALID_CONTRACT');

  const resource = input.resource;
  assertExactKeys(resource, [
    'artifactBytes',
    'cpuMillis',
    'diskBytes',
    'memoryBytes',
    'outputBytes',
    'pids',
    'snapshotBytes',
    'wallTimeMs',
  ]);
  for (const value of Object.values(resource)) assertInteger(value, 1);
  if (resource.wallTimeMs > MAX_TIMEOUT_MS) fail('INVALID_CONTRACT');

  return {
    filesystem: {
      enabled: filesystem.enabled,
      readOnlyPaths: readOnlyPaths as string[],
      writablePaths: writablePaths as string[],
      mounts,
    },
    network: { enabled: network.enabled, egressAllowlist },
    process: {
      enabled: processCapability.enabled,
      allowedExecutables: allowedExecutables as string[],
      environmentAllowlist,
      childProcesses: 'deny',
      maxArgCount: processCapability.maxArgCount,
      maxArgBytes: processCapability.maxArgBytes,
    },
    secret: { enabled: secret.enabled, allowedHandles: allowedHandles as string[] },
    resource: { ...resource },
  };
}

export function createDenyByDefaultCapabilities(
  resource: DisposableResourceCapability,
): DisposableEnvironmentCapabilities {
  return validateCapabilities({
    filesystem: { enabled: false, readOnlyPaths: [], writablePaths: [], mounts: [] },
    network: { enabled: false, egressAllowlist: [] },
    process: {
      enabled: false,
      allowedExecutables: [],
      environmentAllowlist: {},
      childProcesses: 'deny',
      maxArgCount: 1,
      maxArgBytes: 1,
    },
    secret: { enabled: false, allowedHandles: [] },
    resource,
  });
}

export function createDisposableEnvironmentPolicy(
  input: DisposableEnvironmentPolicyInput,
): DisposableEnvironmentPolicy {
  assertExactKeys(input, ['capabilities', 'policyId']);
  assertSafeId(input.policyId);
  const capabilities = validateCapabilities(input.capabilities);
  const capabilitySha256 = hashDisposableEnvironmentPayload(capabilities);
  const base = {
    schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION,
    policyId: input.policyId,
    capabilities,
    capabilitySha256,
  };
  return { ...base, policySha256: hashDisposableEnvironmentPayload(base) };
}

export function createDisposableWorkspace(input: DisposableWorkspaceInput): DisposableWorkspace {
  assertExactKeys(input, ['root', 'workspaceId']);
  assertSafeId(input.workspaceId);
  if (typeof input.root !== 'string') fail('INVALID_CONTRACT');
  const root = nonSymlinkRoot(input.root);
  const base = { workspaceId: input.workspaceId, root };
  return { ...base, workspaceSha256: hashDisposableEnvironmentPayload(base) };
}

export interface ExplicitHostBackendReport {
  available: boolean;
  verified: boolean;
  backendId: string | null;
  runtimeId: string | null;
}

export interface ExplicitHostAvailabilityReport {
  observedAt: string;
  docker: ExplicitHostBackendReport;
  podman: ExplicitHostBackendReport;
  sandbox: ExplicitHostBackendReport;
}

export interface DefaultHostCapability {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  status: 'UNVERIFIED';
  selected: null;
  availableHints: readonly ('docker' | 'podman' | 'sandbox')[];
  reasonCode: 'INVENTORY_ONLY_NO_TRUST';
  observedAt: string;
  reportSha256: string;
  capabilitySha256: string;
}

export function evaluateDefaultHostCapability(
  report: ExplicitHostAvailabilityReport,
): DefaultHostCapability {
  assertExactKeys(report, ['docker', 'observedAt', 'podman', 'sandbox']);
  assertTime(report.observedAt);
  const entries = [
    ['sandbox', report.sandbox],
    ['podman', report.podman],
    ['docker', report.docker],
  ] as const;
  for (const [, value] of entries) {
    assertExactKeys(value, ['available', 'backendId', 'runtimeId', 'verified']);
    if (typeof value.available !== 'boolean' || typeof value.verified !== 'boolean') {
      fail('INVALID_CONTRACT');
    }
    if (value.backendId !== null) assertSafeId(value.backendId);
    if (value.runtimeId !== null) assertSafeId(value.runtimeId);
  }
  const reportSha256 = hashDisposableEnvironmentPayload(report);
  const base = {
    schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION,
    status: 'UNVERIFIED' as const,
    selected: null,
    availableHints: entries.filter(([, value]) => value.available).map(([name]) => name),
    reasonCode: 'INVENTORY_ONLY_NO_TRUST' as const,
    observedAt: report.observedAt,
    reportSha256,
  };
  return { ...base, capabilitySha256: hashDisposableEnvironmentPayload(base) };
}

export interface LocalTestDisposableHostCapability {
  readonly kind: 'local-test-disposable-host-capability';
  readonly capabilityId: string;
}

export const DISPOSABLE_LOCAL_TEST_AUTHORITY = 'local-test-only' as const;
export const DISPOSABLE_LOCAL_TEST_HOST_ISOLATION = 'test-simulated' as const;
export const DISPOSABLE_LOCAL_TEST_ISSUER_ID = 'local-test-issuer' as const;
export const DISPOSABLE_LOCAL_TEST_VERIFIER_ID = 'local-test-verifier' as const;
export const DISPOSABLE_LOCAL_TEST_RECONCILER_ID = 'local-test-reconciler' as const;
export const DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST = createHash('sha256')
  .update('verifier')
  .digest('hex');
export const DISPOSABLE_LOCAL_TEST_RECONCILER_DIGEST = createHash('sha256')
  .update('reconciler')
  .digest('hex');

export interface LocalTestDisposableHostCapabilityInput {
  capabilityId: string;
  backendId: string;
  runtimeId: string;
  capabilitySha256: string;
  issuedAt: string;
  expiresAt: string;
}

export interface LocalTestDisposableHostCapabilityFactory {
  readonly factoryId: 'local-test-disposable-host-factory';
  mint(input: LocalTestDisposableHostCapabilityInput): LocalTestDisposableHostCapability;
}

interface HostCapabilityMetadata extends LocalTestDisposableHostCapabilityInput {
  factoryId: 'local-test-disposable-host-factory';
  authority: typeof DISPOSABLE_LOCAL_TEST_AUTHORITY;
  issuerId: typeof DISPOSABLE_LOCAL_TEST_ISSUER_ID;
  verifierId: typeof DISPOSABLE_LOCAL_TEST_VERIFIER_ID;
  verifierDigest: string;
  reconcilerId: typeof DISPOSABLE_LOCAL_TEST_RECONCILER_ID;
  reconcilerDigest: string;
  isolation: typeof DISPOSABLE_LOCAL_TEST_HOST_ISOLATION;
  productionEligible: false;
}

const trustedFactories = new WeakSet<object>();
const localTestHostCapabilities = new WeakSet<object>();
const hostCapabilityMetadata = new WeakMap<object, HostCapabilityMetadata>();

export function createLocalTestDisposableHostCapabilityFactory(
  ...unexpected: never[]
): LocalTestDisposableHostCapabilityFactory {
  if (unexpected.length !== 0) fail('INVALID_CONTRACT');
  const factory: LocalTestDisposableHostCapabilityFactory = {
    factoryId: 'local-test-disposable-host-factory',
    mint(input) {
      if (!trustedFactories.has(this)) fail('HOST_CAPABILITY_INVALID');
      assertExactKeys(input, [
        'backendId',
        'capabilityId',
        'capabilitySha256',
        'expiresAt',
        'issuedAt',
        'runtimeId',
      ]);
      for (const id of [input.capabilityId, input.backendId, input.runtimeId]) assertSafeId(id);
      assertSha(input.capabilitySha256);
      assertTime(input.issuedAt);
      assertTime(input.expiresAt);
      if (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) fail('INVALID_CONTRACT');
      const capability = Object.freeze({
        kind: 'local-test-disposable-host-capability' as const,
        capabilityId: input.capabilityId,
      });
      localTestHostCapabilities.add(capability);
      hostCapabilityMetadata.set(capability, {
        factoryId: 'local-test-disposable-host-factory',
        authority: DISPOSABLE_LOCAL_TEST_AUTHORITY,
        issuerId: DISPOSABLE_LOCAL_TEST_ISSUER_ID,
        verifierId: DISPOSABLE_LOCAL_TEST_VERIFIER_ID,
        verifierDigest: DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST,
        reconcilerId: DISPOSABLE_LOCAL_TEST_RECONCILER_ID,
        reconcilerDigest: DISPOSABLE_LOCAL_TEST_RECONCILER_DIGEST,
        isolation: DISPOSABLE_LOCAL_TEST_HOST_ISOLATION,
        productionEligible: false,
        ...input,
      });
      return capability;
    },
  };
  trustedFactories.add(factory);
  return Object.freeze(factory);
}

export interface DisposableEnvironmentRegistryOptions {
  registryId: string;
  maxEnvironments?: number;
  maxReplayEntries?: number;
  maxSnapshotsPerEnvironment?: number;
}

export interface DisposableEnvironmentRegistry {
  readonly registryId: string;
}

interface SnapshotRecord {
  snapshot: DisposableEnvironmentSnapshot;
  status: 'available' | 'consumed';
}

interface SharedEnvironmentState {
  state: DisposableEnvironmentState;
  generation: number;
  sequence: number;
  runtimeHandle: string | null;
  serialTail: Promise<void>;
  snapshots: Map<string, SnapshotRecord>;
  issuedChallenges: Set<string>;
  consumedAttestationNonces: Set<string>;
  lateOperations: Map<number, string>;
  quarantineReason: string | null;
}

interface RegistryMetadata {
  options: Required<DisposableEnvironmentRegistryOptions>;
  environments: Map<string, SharedEnvironmentState>;
}

const trustedRegistries = new WeakSet<object>();
const registryMetadata = new WeakMap<object, RegistryMetadata>();

export function createDisposableEnvironmentRegistry(
  options: DisposableEnvironmentRegistryOptions,
): DisposableEnvironmentRegistry {
  const keys = ['registryId'];
  if (Object.prototype.hasOwnProperty.call(options, 'maxEnvironments'))
    keys.push('maxEnvironments');
  if (Object.prototype.hasOwnProperty.call(options, 'maxReplayEntries'))
    keys.push('maxReplayEntries');
  if (Object.prototype.hasOwnProperty.call(options, 'maxSnapshotsPerEnvironment')) {
    keys.push('maxSnapshotsPerEnvironment');
  }
  assertExactKeys(options, keys);
  assertSafeId(options.registryId);
  const complete: Required<DisposableEnvironmentRegistryOptions> = {
    registryId: options.registryId,
    maxEnvironments: options.maxEnvironments ?? DEFAULT_REGISTRY_ENTRIES,
    maxReplayEntries: options.maxReplayEntries ?? DEFAULT_REPLAY_ENTRIES,
    maxSnapshotsPerEnvironment: options.maxSnapshotsPerEnvironment ?? DEFAULT_SNAPSHOT_ENTRIES,
  };
  assertInteger(complete.maxEnvironments, 1, 1024);
  assertInteger(complete.maxReplayEntries, 8, 16_384);
  assertInteger(complete.maxSnapshotsPerEnvironment, 1, 1024);
  const registry = Object.freeze({ registryId: options.registryId });
  trustedRegistries.add(registry);
  registryMetadata.set(registry, { options: complete, environments: new Map() });
  return registry;
}

export interface AttestationChallenge {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  challengeId: string;
  nonce: string;
  authority: string;
  operation: DisposableEnvironmentOperation;
  operationSequence: number;
  environmentId: string;
  backendId: string;
  runtimeId: string;
  policySha256: string;
  workspaceSha256: string;
  capabilitySha256: string;
  issuedAt: string;
  expiresAt: string;
  challengeSha256: string;
}

export interface BackendAttestationInput {
  attestationId: string;
  issuerId: string;
  verifierId: string;
  verifierDigest: string;
  reconcilerId: string;
  reconcilerDigest: string;
  nonce: string;
  authority: string;
  operation: DisposableEnvironmentOperation;
  operationSequence: number;
  environmentId: string;
  backendId: string;
  runtimeId: string;
  policySha256: string;
  workspaceSha256: string;
  capabilitySha256: string;
  issuedAt: string;
  expiresAt: string;
}

export interface BackendAttestation extends BackendAttestationInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  attestationSha256: string;
}

export interface AttestationVerificationProjectionInput {
  projectionId: string;
  attestationSha256: string;
  verifierId: string;
  verifierDigest: string;
  nonce: string;
  authority: string;
  operation: DisposableEnvironmentOperation;
  operationSequence: number;
  environmentId: string;
  backendId: string;
  runtimeId: string;
  policySha256: string;
  workspaceSha256: string;
  capabilitySha256: string;
  verifiedAt: string;
  expiresAt: string;
}

export interface AttestationVerificationProjection extends AttestationVerificationProjectionInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  projectionSha256: string;
}

export type BackendAttestationProvider = (
  challenge: Readonly<AttestationChallenge>,
) => unknown | Promise<unknown>;
export type BackendAttestationProjectionVerifier = (
  attestation: Readonly<BackendAttestation>,
  challenge: Readonly<AttestationChallenge>,
) => unknown | Promise<unknown>;

function operationAllowed(value: unknown): value is DisposableEnvironmentOperation {
  return DISPOSABLE_ENVIRONMENT_OPERATIONS.includes(value as DisposableEnvironmentOperation);
}

export function createBackendAttestation(input: BackendAttestationInput): BackendAttestation {
  assertExactKeys(input, [
    'attestationId',
    'authority',
    'backendId',
    'capabilitySha256',
    'environmentId',
    'expiresAt',
    'issuedAt',
    'issuerId',
    'nonce',
    'operation',
    'operationSequence',
    'policySha256',
    'reconcilerDigest',
    'reconcilerId',
    'runtimeId',
    'verifierDigest',
    'verifierId',
    'workspaceSha256',
  ]);
  for (const id of [
    input.attestationId,
    input.authority,
    input.backendId,
    input.environmentId,
    input.issuerId,
    input.reconcilerId,
    input.runtimeId,
    input.verifierId,
  ]) {
    assertSafeId(id);
  }
  for (const digest of [
    input.capabilitySha256,
    input.policySha256,
    input.reconcilerDigest,
    input.verifierDigest,
    input.workspaceSha256,
  ]) {
    assertSha(digest);
  }
  assertSha(input.nonce);
  if (!operationAllowed(input.operation)) fail('INVALID_CONTRACT');
  assertInteger(input.operationSequence, 1);
  assertTime(input.issuedAt);
  assertTime(input.expiresAt);
  if (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) fail('INVALID_CONTRACT');
  const base = { schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION, ...input };
  return { ...base, attestationSha256: hashDisposableEnvironmentPayload(base) };
}

export function createAttestationVerificationProjection(
  input: AttestationVerificationProjectionInput,
): AttestationVerificationProjection {
  assertExactKeys(input, [
    'attestationSha256',
    'authority',
    'backendId',
    'capabilitySha256',
    'environmentId',
    'expiresAt',
    'nonce',
    'operation',
    'operationSequence',
    'policySha256',
    'projectionId',
    'runtimeId',
    'verifiedAt',
    'verifierDigest',
    'verifierId',
    'workspaceSha256',
  ]);
  for (const id of [
    input.authority,
    input.backendId,
    input.environmentId,
    input.projectionId,
    input.runtimeId,
    input.verifierId,
  ]) {
    assertSafeId(id);
  }
  for (const digest of [
    input.attestationSha256,
    input.capabilitySha256,
    input.nonce,
    input.policySha256,
    input.verifierDigest,
    input.workspaceSha256,
  ]) {
    assertSha(digest);
  }
  if (!operationAllowed(input.operation)) fail('INVALID_CONTRACT');
  assertInteger(input.operationSequence, 1);
  assertTime(input.verifiedAt);
  assertTime(input.expiresAt);
  const base = { schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION, ...input };
  return { ...base, projectionSha256: hashDisposableEnvironmentPayload(base) };
}

function parseBackendAttestation(input: unknown): BackendAttestation {
  assertExactKeys(input, [
    'attestationId',
    'attestationSha256',
    'authority',
    'backendId',
    'capabilitySha256',
    'environmentId',
    'expiresAt',
    'issuedAt',
    'issuerId',
    'nonce',
    'operation',
    'operationSequence',
    'policySha256',
    'reconcilerDigest',
    'reconcilerId',
    'runtimeId',
    'schemaVersion',
    'verifierDigest',
    'verifierId',
    'workspaceSha256',
  ]);
  if (input.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  assertSha(input.attestationSha256);
  const recreated = createBackendAttestation(
    without(input, 'schemaVersion', 'attestationSha256') as unknown as BackendAttestationInput,
  );
  if (recreated.attestationSha256 !== input.attestationSha256) {
    fail('INVALID_CONTRACT');
  }
  return input as unknown as BackendAttestation;
}

function parseAttestationProjection(input: unknown): AttestationVerificationProjection {
  assertExactKeys(input, [
    'attestationSha256',
    'authority',
    'backendId',
    'capabilitySha256',
    'environmentId',
    'expiresAt',
    'nonce',
    'operation',
    'operationSequence',
    'policySha256',
    'projectionId',
    'projectionSha256',
    'runtimeId',
    'schemaVersion',
    'verifiedAt',
    'verifierDigest',
    'verifierId',
    'workspaceSha256',
  ]);
  if (input.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  assertSha(input.projectionSha256);
  const recreated = createAttestationVerificationProjection(
    without(
      input,
      'schemaVersion',
      'projectionSha256',
    ) as unknown as AttestationVerificationProjectionInput,
  );
  if (recreated.projectionSha256 !== input.projectionSha256) {
    fail('INVALID_CONTRACT');
  }
  return input as unknown as AttestationVerificationProjection;
}

export interface MountProjectionEntry {
  mountId: string;
  sourceRef: string;
  targetRef: string;
  sourceIdentity: string;
  targetIdentity: string;
  sourceSha256: string;
  targetRefSha256: string;
  consumeToken: string;
}

export interface FilesystemProjectionInput {
  projectionId: string;
  verifierId: string;
  verifierDigest: string;
  environmentId: string;
  workspaceSha256: string;
  policySha256: string;
  capabilitySha256: string;
  operationSequence: number;
  rootIdentity: string;
  rootSha256: string;
  mounts: readonly MountProjectionEntry[];
  verifiedAt: string;
  expiresAt: string;
}

export interface FilesystemProjection extends FilesystemProjectionInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  projectionSha256: string;
}

export type FilesystemProjectionVerifier = (
  request: Readonly<FilesystemProjectionInput>,
) => unknown | Promise<unknown>;

export function createFilesystemProjection(input: FilesystemProjectionInput): FilesystemProjection {
  assertExactKeys(input, [
    'capabilitySha256',
    'environmentId',
    'expiresAt',
    'mounts',
    'operationSequence',
    'policySha256',
    'projectionId',
    'rootIdentity',
    'rootSha256',
    'verifiedAt',
    'verifierDigest',
    'verifierId',
    'workspaceSha256',
  ]);
  for (const id of [
    input.environmentId,
    input.projectionId,
    input.rootIdentity,
    input.verifierId,
  ]) {
    assertSafeId(id);
  }
  for (const digest of [
    input.capabilitySha256,
    input.policySha256,
    input.rootSha256,
    input.verifierDigest,
    input.workspaceSha256,
  ]) {
    assertSha(digest);
  }
  assertInteger(input.operationSequence, 1);
  assertTime(input.verifiedAt);
  assertTime(input.expiresAt);
  if (!Array.isArray(input.mounts) || input.mounts.length > MAX_ITEMS) fail('INVALID_CONTRACT');
  for (const mount of input.mounts) {
    assertExactKeys(mount, [
      'consumeToken',
      'mountId',
      'sourceIdentity',
      'sourceRef',
      'sourceSha256',
      'targetIdentity',
      'targetRef',
      'targetRefSha256',
    ]);
    for (const id of [
      mount.consumeToken,
      mount.mountId,
      mount.sourceIdentity,
      mount.targetIdentity,
    ]) {
      assertSafeId(id);
    }
    assertRelative(mount.sourceRef);
    assertRelative(mount.targetRef);
    assertSha(mount.sourceSha256);
    assertSha(mount.targetRefSha256);
  }
  const base = { schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION, ...input };
  return { ...base, projectionSha256: hashDisposableEnvironmentPayload(base) };
}

export interface NetworkResolutionProjectionInput {
  projectionId: string;
  verifierId: string;
  verifierDigest: string;
  destination: EgressDestination;
  destinationSha256: string;
  firstResolution: readonly string[];
  secondResolution: readonly string[];
  chosenIp: string;
  pinToken: string;
  resolutionSha256: string;
  verifiedAt: string;
  expiresAt: string;
}

export interface NetworkResolutionProjection extends NetworkResolutionProjectionInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  projectionSha256: string;
}

export interface PinnedEgressDestination extends EgressDestination {
  verifiedAddresses: readonly [string];
  chosenIp: string;
  pinToken: string;
  resolutionSha256: string;
  projectionSha256: string;
}

export type NetworkProjectionVerifier = (
  destination: Readonly<EgressDestination>,
) => unknown | Promise<unknown>;

export function createNetworkResolutionProjection(
  input: Omit<NetworkResolutionProjectionInput, 'destinationSha256' | 'resolutionSha256'>,
): NetworkResolutionProjection {
  const destination = normalizeDestination(input.destination);
  const destinationSha256 = hashDisposableEnvironmentPayload(destination);
  const resolutionSha256 = hashDisposableEnvironmentPayload({
    destinationSha256,
    firstResolution: input.firstResolution,
    secondResolution: input.secondResolution,
    chosenIp: input.chosenIp,
    pinToken: input.pinToken,
  });
  const complete: NetworkResolutionProjectionInput = {
    ...input,
    destination,
    destinationSha256,
    resolutionSha256,
  };
  for (const id of [complete.projectionId, complete.pinToken, complete.verifierId])
    assertSafeId(id);
  assertSha(complete.verifierDigest);
  assertTime(complete.verifiedAt);
  assertTime(complete.expiresAt);
  const base = { schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION, ...complete };
  return { ...base, projectionSha256: hashDisposableEnvironmentPayload(base) };
}

export interface ArtifactExportSpec {
  ref: string;
  mediaType: string;
}

export interface DisposableArtifact {
  ref: string;
  sha256: string;
  bytes: number;
  mediaType: string;
}

export interface ArtifactVerificationProjectionInput {
  projectionId: string;
  verifierId: string;
  verifierDigest: string;
  ref: string;
  mediaType: string;
  sha256: string;
  bytes: number;
  fileIdentity: string;
  verifiedAt: string;
}

export interface ArtifactVerificationProjection extends ArtifactVerificationProjectionInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  projectionSha256: string;
}

export type DisposableArtifactVerifier = (
  artifacts: readonly DisposableArtifact[],
  expected: readonly ArtifactExportSpec[],
) => unknown | Promise<unknown>;

export interface ArtifactDiscardProjectionInput {
  projectionId: string;
  verifierId: string;
  verifierDigest: string;
  exportResultSha256: string;
  discardedRefs: readonly string[];
  discardedAt: string;
}

export interface ArtifactDiscardProjection extends ArtifactDiscardProjectionInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  projectionSha256: string;
}

export type DisposableArtifactRevoker = (
  artifacts: readonly DisposableArtifact[],
  exportResultSha256: string,
) => unknown | Promise<unknown>;

function validateArtifact(artifact: DisposableArtifact): void {
  assertExactKeys(artifact, ['bytes', 'mediaType', 'ref', 'sha256']);
  assertRelative(artifact.ref);
  assertSha(artifact.sha256);
  assertInteger(artifact.bytes, 0);
  if (typeof artifact.mediaType !== 'string' || !MEDIA_TYPE.test(artifact.mediaType)) {
    fail('INVALID_CONTRACT');
  }
}

export function createArtifactVerificationProjection(
  input: ArtifactVerificationProjectionInput,
): ArtifactVerificationProjection {
  assertExactKeys(input, [
    'bytes',
    'fileIdentity',
    'mediaType',
    'projectionId',
    'ref',
    'sha256',
    'verifiedAt',
    'verifierDigest',
    'verifierId',
  ]);
  for (const id of [input.fileIdentity, input.projectionId, input.verifierId]) assertSafeId(id);
  assertRelative(input.ref);
  assertSha(input.sha256);
  assertSha(input.verifierDigest);
  assertInteger(input.bytes, 0);
  assertTime(input.verifiedAt);
  if (!MEDIA_TYPE.test(input.mediaType)) fail('INVALID_CONTRACT');
  const base = { schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION, ...input };
  return { ...base, projectionSha256: hashDisposableEnvironmentPayload(base) };
}

export function createArtifactDiscardProjection(
  input: ArtifactDiscardProjectionInput,
): ArtifactDiscardProjection {
  assertExactKeys(input, [
    'discardedAt',
    'discardedRefs',
    'exportResultSha256',
    'projectionId',
    'verifierDigest',
    'verifierId',
  ]);
  for (const id of [input.projectionId, input.verifierId]) assertSafeId(id);
  assertSha(input.exportResultSha256);
  assertSha(input.verifierDigest);
  assertTime(input.discardedAt);
  if (!Array.isArray(input.discardedRefs)) fail('INVALID_CONTRACT');
  for (const ref of input.discardedRefs) assertRelative(ref);
  assertUnique(input.discardedRefs);
  const base = { schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION, ...input };
  return { ...base, projectionSha256: hashDisposableEnvironmentPayload(base) };
}

export function createContainedArtifactVerifier(options: {
  artifactRoot: string;
  containingRoot?: string;
  verifierId: string;
  verifierDigest: string;
  now?: () => Date;
}): DisposableArtifactVerifier {
  const keys = ['artifactRoot', 'verifierDigest', 'verifierId'];
  if (Object.prototype.hasOwnProperty.call(options, 'containingRoot')) keys.push('containingRoot');
  if (Object.prototype.hasOwnProperty.call(options, 'now')) keys.push('now');
  assertExactKeys(options, keys);
  const root = nonSymlinkRoot(options.artifactRoot);
  const rootInfo = lstatSync(root);
  const rootIdentity = `${rootInfo.dev}:${rootInfo.ino}`;
  if (options.containingRoot !== undefined) {
    const container = nonSymlinkRoot(options.containingRoot);
    if (!contained(container, root)) fail('PATH_NOT_CONTAINED');
  }
  assertSafeId(options.verifierId);
  assertSha(options.verifierDigest);
  const now = options.now ?? (() => new Date());
  return (artifacts, expected) => {
    if (`${lstatSync(root).dev}:${lstatSync(root).ino}` !== rootIdentity) {
      fail('ARTIFACT_VERIFICATION_FAILED');
    }
    if (artifacts.length !== expected.length) fail('ARTIFACT_VERIFICATION_FAILED');
    const expectedByRef = new Map(expected.map((entry) => [entry.ref, entry]));
    return artifacts.map((artifact) => {
      validateArtifact(artifact);
      const expectation = expectedByRef.get(artifact.ref);
      if (expectation === undefined || expectation.mediaType !== artifact.mediaType) {
        fail('ARTIFACT_VERIFICATION_FAILED');
      }
      assertNoSymlinkPath(root, artifact.ref, true);
      const target = resolve(root, artifact.ref);
      let descriptor: number | null = null;
      try {
        descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = fstatSync(descriptor);
        if (!info.isFile() || info.size !== artifact.bytes) fail('ARTIFACT_VERIFICATION_FAILED');
        const bytes = readFileSync(descriptor);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== artifact.sha256) fail('ARTIFACT_VERIFICATION_FAILED');
        return createArtifactVerificationProjection({
          projectionId: `artifact-${artifact.sha256.slice(0, 24)}`,
          verifierId: options.verifierId,
          verifierDigest: options.verifierDigest,
          ref: artifact.ref,
          mediaType: expectation.mediaType,
          sha256: digest,
          bytes: info.size,
          fileIdentity: `file-${info.dev}-${info.ino}`,
          verifiedAt: now().toISOString(),
        });
      } finally {
        if (descriptor !== null) closeSync(descriptor);
      }
    });
  };
}

export interface TeardownReconciliationProjectionInput {
  projectionId: string;
  reconcilerId: string;
  reconcilerDigest: string;
  environmentId: string;
  backendId: string;
  runtimeId: string;
  operationSequence: number;
  generation: number;
  backendResultSha256: string;
  orphanProcesses: number;
  mountedFilesystems: number;
  networkLeases: number;
  reconciledAt: string;
}

export interface TeardownReconciliationProjection extends TeardownReconciliationProjectionInput {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  projectionSha256: string;
}

export type TeardownReconciler = (
  input: Readonly<TeardownReconciliationProjectionInput>,
) => unknown | Promise<unknown>;

export function createTeardownReconciliationProjection(
  input: TeardownReconciliationProjectionInput,
): TeardownReconciliationProjection {
  assertExactKeys(input, [
    'backendId',
    'backendResultSha256',
    'environmentId',
    'generation',
    'mountedFilesystems',
    'networkLeases',
    'operationSequence',
    'orphanProcesses',
    'projectionId',
    'reconciledAt',
    'reconcilerDigest',
    'reconcilerId',
    'runtimeId',
  ]);
  for (const id of [
    input.backendId,
    input.environmentId,
    input.projectionId,
    input.reconcilerId,
    input.runtimeId,
  ]) {
    assertSafeId(id);
  }
  assertSha(input.backendResultSha256);
  assertSha(input.reconcilerDigest);
  assertInteger(input.operationSequence, 1);
  assertInteger(input.generation, 0);
  assertInteger(input.orphanProcesses, 0);
  assertInteger(input.mountedFilesystems, 0);
  assertInteger(input.networkLeases, 0);
  assertTime(input.reconciledAt);
  const base = { schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION, ...input };
  return { ...base, projectionSha256: hashDisposableEnvironmentPayload(base) };
}

export interface DisposableExecutionInput {
  argv: readonly string[];
  cwd: string;
  environmentKeys: readonly string[];
  secretHandles: readonly string[];
  networkDestinations?: readonly EgressDestination[];
}

export interface DisposableArtifactExportInput {
  artifacts: readonly ArtifactExportSpec[];
  maxBytes: number;
}

export interface DisposableSnapshotInput {
  ttlMs: number;
}

export interface DisposableEnvironmentSnapshot {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  snapshotId: string;
  snapshotRef: string;
  snapshotBytes: number;
  snapshotMediaType: string;
  stateSha256: string;
  environmentId: string;
  backendId: string;
  runtimeId: string;
  generation: number;
  operationSequence: number;
  policySha256: string;
  workspaceSha256: string;
  capabilitySha256: string;
  createdAt: string;
  expiresAt: string;
  snapshotSha256: string;
}

export interface NetworkConnectionReceipt extends EgressDestination {
  connectedIp: string;
  pinToken: string;
  resolutionSha256: string;
}

export interface DisposableExecutionMetrics {
  exitCode: number;
  cpuMillis: number;
  peakMemoryBytes: number;
  peakPids: number;
  outputBytes: number;
  diskBytes: number;
  outputSha256: string;
  connections: readonly NetworkConnectionReceipt[];
}

interface BackendRequestBase {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  operation: DisposableEnvironmentOperation;
  operationId: string;
  environmentId: string;
  backendId: string;
  runtimeId: string;
  operationSequence: number;
  generation: number;
  policySha256: string;
  workspaceSha256: string;
  capabilitySha256: string;
  attestation: BackendAttestation;
  attestationProjection: AttestationVerificationProjection;
  runtimeHandle: string | null;
}

export interface BackendProvisionRequest extends BackendRequestBase {
  operation: 'provision';
  workspaceRoot: string;
  capabilities: DisposableEnvironmentCapabilities;
  filesystemProjection: FilesystemProjection | null;
}

export interface BackendStartRequest extends BackendRequestBase {
  operation: 'start';
  runtimeHandle: string;
}

export interface BackendExecuteRequest extends BackendRequestBase {
  operation: 'execute';
  runtimeHandle: string;
  argv: readonly string[];
  cwd: string;
  environment: Readonly<Record<string, string>>;
  secretHandles: readonly string[];
  networkDestinations: readonly PinnedEgressDestination[];
  resourceLimits: DisposableResourceCapability;
}

export interface BackendSnapshotRequest extends BackendRequestBase {
  operation: 'snapshot';
  runtimeHandle: string;
  expiresAt: string;
  maxBytes: number;
}

export interface BackendRestoreRequest extends BackendRequestBase {
  operation: 'restore';
  runtimeHandle: string;
  snapshot: DisposableEnvironmentSnapshot;
}

export interface BackendExportRequest extends BackendRequestBase {
  operation: 'export';
  runtimeHandle: string;
  artifacts: readonly ArtifactExportSpec[];
  maxBytes: number;
}

export interface BackendTeardownRequest extends BackendRequestBase {
  operation: 'teardown';
}

export interface BackendResultIdentity {
  environmentId: string;
  operationSequence: number;
  generation: number;
}

export interface BackendProvisionResult extends BackendResultIdentity {
  runtimeHandle: string;
  rootRef: string;
  filesystemConsumeToken: string | null;
}

export interface BackendStartResult extends BackendResultIdentity {
  ready: true;
}

export interface BackendExecuteResult extends BackendResultIdentity, DisposableExecutionMetrics {}

export interface BackendSnapshotResult extends BackendResultIdentity {
  snapshotId: string;
  snapshotRef: string;
  snapshotBytes: number;
  snapshotMediaType: string;
  stateSha256: string;
}

export interface BackendRestoreResult extends BackendResultIdentity {
  restoredStateSha256: string;
}

export interface BackendExportResult extends BackendResultIdentity {
  artifacts: readonly DisposableArtifact[];
}

export interface BackendTeardownResult extends BackendResultIdentity {
  orphanProcesses: number;
  mountedFilesystems: number;
  networkLeases: number;
}

export interface DisposableEnvironmentBackend {
  readonly backendId: string;
  readonly runtimeId: string;
  provision(request: BackendProvisionRequest, signal: AbortSignal): Promise<BackendProvisionResult>;
  start(request: BackendStartRequest, signal: AbortSignal): Promise<BackendStartResult>;
  execute(request: BackendExecuteRequest, signal: AbortSignal): Promise<BackendExecuteResult>;
  snapshot(request: BackendSnapshotRequest, signal: AbortSignal): Promise<BackendSnapshotResult>;
  restore(request: BackendRestoreRequest, signal: AbortSignal): Promise<BackendRestoreResult>;
  exportArtifacts(request: BackendExportRequest, signal: AbortSignal): Promise<BackendExportResult>;
  teardown(request: BackendTeardownRequest, signal: AbortSignal): Promise<BackendTeardownResult>;
}

export interface DisposableEnvironmentReceipt {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  registryKeySha256: string;
  attemptId: string;
  environmentId: string;
  operation: DisposableEnvironmentOperation;
  operationSequence: number;
  generationBefore: number;
  generationAfter: number;
  stateBefore: DisposableEnvironmentState;
  stateAfter: DisposableEnvironmentState;
  status: DisposableEnvironmentReceiptStatus;
  authority: typeof DISPOSABLE_LOCAL_TEST_AUTHORITY | 'none';
  hostIsolation: typeof DISPOSABLE_LOCAL_TEST_HOST_ISOLATION | 'unverified';
  productionEligible: false;
  code:
    | DisposableEnvironmentErrorCode
    | 'PROVISIONED'
    | 'STARTED'
    | 'EXECUTED'
    | 'SNAPSHOT_CREATED'
    | 'SNAPSHOT_RESTORED'
    | 'ARTIFACTS_EXPORTED'
    | 'TEARDOWN_CONFIRMED';
  negativePaths: readonly string[];
  issuedAt: string;
  backendId: string;
  runtimeId: string;
  policySha256: string;
  workspaceSha256: string;
  capabilitySha256: string;
  challengeSha256: string | null;
  attestationSha256: string | null;
  attestationProjectionSha256: string | null;
  backendResultSha256: string | null;
  filesystemProjectionSha256: string | null;
  networkProjectionSha256: readonly string[];
  artifactProjectionSha256: readonly string[];
  artifactRevokeSha256: string | null;
  artifactIdentityEvidenceSha256: string | null;
  reconciliationSha256: string | null;
  artifactDisposition: 'none' | 'retained' | 'revoked' | 'revoke-unverified';
  snapshot: DisposableEnvironmentSnapshot | null;
  artifacts: readonly DisposableArtifact[];
  metrics: DisposableExecutionMetrics | null;
  limitations: readonly string[];
  receiptSha256: string;
}

export interface DisposableEnvironmentInspection {
  environmentId: string;
  state: DisposableEnvironmentState;
  generation: number;
  operationSequence: number;
  lateOperationSequences: readonly number[];
  quarantineReason: string | null;
}

export interface DisposableEnvironmentRuntimeOptions {
  environmentId: string;
  backend: DisposableEnvironmentBackend;
  registry: DisposableEnvironmentRegistry;
  hostCapability?: LocalTestDisposableHostCapability | null;
  policy: DisposableEnvironmentPolicy;
  workspace: DisposableWorkspace;
  attestationProvider?: BackendAttestationProvider;
  attestationProjectionVerifier?: BackendAttestationProjectionVerifier;
  filesystemProjectionVerifier?: FilesystemProjectionVerifier;
  networkProjectionVerifier?: NetworkProjectionVerifier;
  artifactVerifier?: DisposableArtifactVerifier;
  artifactRevoker?: DisposableArtifactRevoker;
  teardownReconciler?: TeardownReconciler;
  operationTimeoutMs?: number;
  now?: () => Date;
}

interface TrustedOperationProof {
  challenge: AttestationChallenge;
  attestation: BackendAttestation;
  projection: AttestationVerificationProjection;
}

interface ReceiptParts {
  operation: DisposableEnvironmentOperation;
  sequence: number;
  generationBefore: number;
  stateBefore: DisposableEnvironmentState;
  status: Exclude<DisposableEnvironmentReceiptStatus, 'PASS'>;
  simulatedSuccess?: true;
  code: DisposableEnvironmentReceipt['code'];
  proof?: TrustedOperationProof;
  backendResult?: unknown;
  filesystemProjection?: FilesystemProjection | null;
  networkProjections?: readonly NetworkResolutionProjection[];
  artifactProjections?: readonly ArtifactVerificationProjection[];
  artifactRevoke?: ArtifactDiscardProjection | null;
  artifactIdentityEvidenceSha256?: string | null;
  reconciliation?: TeardownReconciliationProjection | null;
  artifactDisposition?: DisposableEnvironmentReceipt['artifactDisposition'];
  snapshot?: DisposableEnvironmentSnapshot | null;
  artifacts?: readonly DisposableArtifact[];
  metrics?: DisposableExecutionMetrics | null;
}

type TimedResult<T> = { kind: 'result'; value: T } | { kind: 'error' } | { kind: 'timeout' };

function ipv4Number(address: string): number | null {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function ipv6Number(address: string): bigint | null {
  if (address.includes('%') || address.split('::').length > 2) return null;
  let value = address.toLowerCase();
  const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted !== null) {
    const ipv4 = ipv4Number(dotted[2]);
    if (ipv4 === null) return null;
    value = `${dotted[1]}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const split = value.split('::');
  const left = split[0] === '' ? [] : split[0].split(':');
  const right = split.length === 1 || split[1] === '' ? [] : split[1].split(':');
  if (split.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < (split.length === 1 ? 0 : 1)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[a-f0-9]{1,4}$/.test(word))) return null;
  return words.reduce((total, word) => (total << 16n) | BigInt(Number.parseInt(word, 16)), 0n);
}

function inIpv4Cidr(value: number, base: number, bits: number): boolean {
  const shift = 32 - bits;
  return shift === 32 ? true : value >>> shift === base >>> shift;
}

function inIpv6Cidr(value: bigint, base: bigint, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === base >> shift;
}

function ipv6Cidr(address: string, bits: number): readonly [bigint, number] {
  const base = ipv6Number(address);
  if (base === null) fail('INVALID_CONTRACT');
  return [base, bits] as const;
}

const IPV4_SPECIAL: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

const IPV6_SPECIAL: ReadonlyArray<readonly [bigint, number]> = [
  ipv6Cidr('::', 96),
  ipv6Cidr('::ffff:0:0', 96),
  ipv6Cidr('::ffff:0:0:0', 96),
  ipv6Cidr('100:0:0:1::', 64),
  ipv6Cidr('400::', 7),
  [0n, 128],
  [1n, 128],
  [0xffff00000000n, 96],
  [0x0064ff9b000000000000000000000000n, 96],
  [0x0064ff9b000100000000000000000000n, 48],
  [0x01000000000000000000000000000000n, 64],
  [0x20010000000000000000000000000000n, 23],
  [0x20010000000000000000000000000000n, 32],
  [0x20010002000000000000000000000000n, 48],
  [0x20010db8000000000000000000000000n, 32],
  [0x20010010000000000000000000000000n, 28],
  [0x20010020000000000000000000000000n, 28],
  [0x20020000000000000000000000000000n, 16],
  ipv6Cidr('2620:4f:8000::', 48),
  [0x3fff0000000000000000000000000000n, 20],
  [0x5f000000000000000000000000000000n, 16],
  [0xfc000000000000000000000000000000n, 7],
  [0xfec00000000000000000000000000000n, 10],
  [0xfe800000000000000000000000000000n, 10],
  [0xff000000000000000000000000000000n, 8],
];

// Frozen from the IANA IPv6 Global Unicast Address Space registry dated 2025-10-10.
// This establishes policy eligibility for public egress, not observed BGP reachability.
// Unlisted 2000::/3 space is reserved, so this is intentionally an allowlist.
export const DISPOSABLE_IPV6_ALLOCATION_SNAPSHOT_DATE = '2025-10-10' as const;
const IPV6_ELIGIBLE_PUBLIC_EGRESS_PREFIXES: ReadonlyArray<readonly [bigint, number]> = [
  ipv6Cidr('2001:200::', 23),
  ipv6Cidr('2001:400::', 23),
  ipv6Cidr('2001:600::', 23),
  ipv6Cidr('2001:800::', 22),
  ipv6Cidr('2001:c00::', 23),
  ipv6Cidr('2001:e00::', 23),
  ipv6Cidr('2001:1200::', 23),
  ipv6Cidr('2001:1400::', 22),
  ipv6Cidr('2001:1800::', 23),
  ipv6Cidr('2001:1a00::', 23),
  ipv6Cidr('2001:1c00::', 22),
  ipv6Cidr('2001:2000::', 19),
  ipv6Cidr('2001:4000::', 23),
  ipv6Cidr('2001:4200::', 23),
  ipv6Cidr('2001:4400::', 23),
  ipv6Cidr('2001:4600::', 23),
  ipv6Cidr('2001:4800::', 23),
  ipv6Cidr('2001:4a00::', 23),
  ipv6Cidr('2001:4c00::', 23),
  ipv6Cidr('2001:5000::', 20),
  ipv6Cidr('2001:8000::', 19),
  ipv6Cidr('2001:a000::', 20),
  ipv6Cidr('2001:b000::', 20),
  ipv6Cidr('2003::', 18),
  ipv6Cidr('2400::', 12),
  ipv6Cidr('2410::', 12),
  ipv6Cidr('2600::', 12),
  ipv6Cidr('2610::', 23),
  ipv6Cidr('2620::', 23),
  ipv6Cidr('2630::', 12),
  ipv6Cidr('2800::', 12),
  ipv6Cidr('2a00::', 12),
  ipv6Cidr('2a10::', 12),
  ipv6Cidr('2c00::', 12),
];

function embeddedIpv4Classification(value: bigint): 'public' | 'non-public' | null {
  const high96 = value >> 32n;
  if (high96 !== 0n && high96 !== 0xffffn && high96 !== 0xffff0000n) return null;
  const embedded = Number(value & 0xffffffffn);
  const address = `${embedded >>> 24}.${(embedded >>> 16) & 0xff}.${
    (embedded >>> 8) & 0xff
  }.${embedded & 0xff}`;
  return globallyRoutable(address) ? 'public' : 'non-public';
}

function globallyRoutable(address: string): boolean {
  if (isIP(address) === 4) {
    const value = ipv4Number(address);
    return value !== null && !IPV4_SPECIAL.some(([base, bits]) => inIpv4Cidr(value, base, bits));
  }
  if (isIP(address) !== 6) return false;
  const value = ipv6Number(address);
  if (value === null) return false;
  const embeddedIpv4 = embeddedIpv4Classification(value);
  if (embeddedIpv4 === 'public' || embeddedIpv4 === 'non-public') return false;
  if (IPV6_SPECIAL.some(([base, bits]) => inIpv6Cidr(value, base, bits))) return false;
  return IPV6_ELIGIBLE_PUBLIC_EGRESS_PREFIXES.some(([base, bits]) => inIpv6Cidr(value, base, bits));
}

function privateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    value.endsWith('.home') ||
    value.endsWith('.lan') ||
    value === 'metadata' ||
    value === 'metadata.google.internal' ||
    value === 'instance-data.ec2.internal' ||
    (isIP(value) !== 0 && !globallyRoutable(value))
  );
}

function parseFilesystemProjection(input: unknown): FilesystemProjection {
  assertExactKeys(input, [
    'capabilitySha256',
    'environmentId',
    'expiresAt',
    'mounts',
    'operationSequence',
    'policySha256',
    'projectionId',
    'projectionSha256',
    'rootIdentity',
    'rootSha256',
    'schemaVersion',
    'verifiedAt',
    'verifierDigest',
    'verifierId',
    'workspaceSha256',
  ]);
  if (input.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  assertSha(input.projectionSha256);
  const recreated = createFilesystemProjection(
    without(input, 'schemaVersion', 'projectionSha256') as unknown as FilesystemProjectionInput,
  );
  if (recreated.projectionSha256 !== input.projectionSha256) {
    fail('INVALID_CONTRACT');
  }
  return input as unknown as FilesystemProjection;
}

function parseNetworkProjection(input: unknown): NetworkResolutionProjection {
  assertExactKeys(input, [
    'chosenIp',
    'destination',
    'destinationSha256',
    'expiresAt',
    'firstResolution',
    'pinToken',
    'projectionId',
    'projectionSha256',
    'resolutionSha256',
    'schemaVersion',
    'secondResolution',
    'verifiedAt',
    'verifierDigest',
    'verifierId',
  ]);
  if (input.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  assertSha(input.destinationSha256);
  assertSha(input.resolutionSha256);
  assertSha(input.projectionSha256);
  const recreated = createNetworkResolutionProjection(
    without(
      input,
      'schemaVersion',
      'destinationSha256',
      'resolutionSha256',
      'projectionSha256',
    ) as unknown as Omit<
      NetworkResolutionProjectionInput,
      'destinationSha256' | 'resolutionSha256'
    >,
  );
  if (
    recreated.destinationSha256 !== input.destinationSha256 ||
    recreated.resolutionSha256 !== input.resolutionSha256 ||
    recreated.projectionSha256 !== input.projectionSha256
  ) {
    fail('INVALID_CONTRACT');
  }
  return input as unknown as NetworkResolutionProjection;
}

function parseArtifactProjection(input: unknown): ArtifactVerificationProjection {
  assertExactKeys(input, [
    'bytes',
    'fileIdentity',
    'mediaType',
    'projectionId',
    'projectionSha256',
    'ref',
    'schemaVersion',
    'sha256',
    'verifiedAt',
    'verifierDigest',
    'verifierId',
  ]);
  if (input.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  assertSha(input.projectionSha256);
  const recreated = createArtifactVerificationProjection(
    without(
      input,
      'schemaVersion',
      'projectionSha256',
    ) as unknown as ArtifactVerificationProjectionInput,
  );
  if (recreated.projectionSha256 !== input.projectionSha256) {
    fail('INVALID_CONTRACT');
  }
  return input as unknown as ArtifactVerificationProjection;
}

function parseDiscardProjection(input: unknown): ArtifactDiscardProjection {
  assertExactKeys(input, [
    'discardedAt',
    'discardedRefs',
    'exportResultSha256',
    'projectionId',
    'projectionSha256',
    'schemaVersion',
    'verifierDigest',
    'verifierId',
  ]);
  if (input.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  assertSha(input.projectionSha256);
  const recreated = createArtifactDiscardProjection(
    without(
      input,
      'schemaVersion',
      'projectionSha256',
    ) as unknown as ArtifactDiscardProjectionInput,
  );
  if (recreated.projectionSha256 !== input.projectionSha256) {
    fail('INVALID_CONTRACT');
  }
  return input as unknown as ArtifactDiscardProjection;
}

function parseReconciliationProjection(input: unknown): TeardownReconciliationProjection {
  assertExactKeys(input, [
    'backendId',
    'backendResultSha256',
    'environmentId',
    'generation',
    'mountedFilesystems',
    'networkLeases',
    'operationSequence',
    'orphanProcesses',
    'projectionId',
    'projectionSha256',
    'reconciledAt',
    'reconcilerDigest',
    'reconcilerId',
    'runtimeId',
    'schemaVersion',
  ]);
  if (input.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  assertSha(input.projectionSha256);
  const recreated = createTeardownReconciliationProjection(
    without(
      input,
      'schemaVersion',
      'projectionSha256',
    ) as unknown as TeardownReconciliationProjectionInput,
  );
  if (recreated.projectionSha256 !== input.projectionSha256) {
    fail('INVALID_CONTRACT');
  }
  return input as unknown as TeardownReconciliationProjection;
}

function resultIdentity(
  value: BackendResultIdentity,
  environmentId: string,
  sequence: number,
  generation: number,
): void {
  if (
    value.environmentId !== environmentId ||
    value.operationSequence !== sequence ||
    value.generation !== generation
  ) {
    fail('BACKEND_RESULT_INVALID');
  }
}

function validatePolicy(policy: DisposableEnvironmentPolicy): DisposableEnvironmentPolicy {
  const expected = createDisposableEnvironmentPolicy({
    policyId: policy.policyId,
    capabilities: policy.capabilities,
  });
  if (
    expected.schemaVersion !== policy.schemaVersion ||
    expected.capabilitySha256 !== policy.capabilitySha256 ||
    expected.policySha256 !== policy.policySha256
  ) {
    fail('INVALID_CONTRACT');
  }
  return expected;
}

function validateWorkspace(workspace: DisposableWorkspace): DisposableWorkspace {
  const expected = createDisposableWorkspace({
    workspaceId: workspace.workspaceId,
    root: workspace.root,
  });
  if (expected.workspaceSha256 !== workspace.workspaceSha256) fail('INVALID_CONTRACT');
  return expected;
}

export class DisposableEnvironmentRuntime {
  private readonly state: SharedEnvironmentState;
  private readonly registry: RegistryMetadata;
  private readonly registryKeySha256: string;
  private readonly host: HostCapabilityMetadata | null;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly options: DisposableEnvironmentRuntimeOptions;

  constructor(input: DisposableEnvironmentRuntimeOptions) {
    assertSafeId(input.environmentId);
    assertSafeId(input.backend.backendId);
    assertSafeId(input.backend.runtimeId);
    if (!trustedRegistries.has(input.registry)) fail('INVALID_CONTRACT');
    const registry = registryMetadata.get(input.registry);
    if (registry === undefined) fail('INVALID_CONTRACT');
    const policy = validatePolicy(input.policy);
    const workspace = validateWorkspace(input.workspace);
    this.options = { ...input, policy, workspace };
    this.registry = registry;
    this.now = input.now ?? (() => new Date());
    this.timeoutMs = input.operationTimeoutMs ?? policy.capabilities.resource.wallTimeMs;
    assertInteger(this.timeoutMs, 1, policy.capabilities.resource.wallTimeMs);
    this.host =
      input.hostCapability !== undefined &&
      input.hostCapability !== null &&
      localTestHostCapabilities.has(input.hostCapability)
        ? (hostCapabilityMetadata.get(input.hostCapability) ?? null)
        : null;
    const key = {
      registryId: input.registry.registryId,
      backendId: input.backend.backendId,
      runtimeId: input.backend.runtimeId,
      environmentId: input.environmentId,
      workspaceSha256: workspace.workspaceSha256,
      policySha256: policy.policySha256,
    };
    this.registryKeySha256 = hashDisposableEnvironmentPayload(key);
    const existing = registry.environments.get(this.registryKeySha256);
    if (existing !== undefined) {
      this.state = existing;
    } else {
      if (registry.environments.size >= registry.options.maxEnvironments) {
        fail('REGISTRY_CAPACITY_EXCEEDED');
      }
      this.state = {
        state: 'NEW',
        generation: 0,
        sequence: 0,
        runtimeHandle: null,
        serialTail: Promise.resolve(),
        snapshots: new Map(),
        issuedChallenges: new Set(),
        consumedAttestationNonces: new Set(),
        lateOperations: new Map(),
        quarantineReason: null,
      };
      registry.environments.set(this.registryKeySha256, this.state);
    }
    this.validateFilesystemPaths();
  }

  inspect(): DisposableEnvironmentInspection {
    return {
      environmentId: this.options.environmentId,
      state: this.state.state,
      generation: this.state.generation,
      operationSequence: this.state.sequence,
      lateOperationSequences: [...this.state.lateOperations.keys()].sort(
        (left, right) => left - right,
      ),
      quarantineReason: this.state.quarantineReason,
    };
  }

  provision(): Promise<DisposableEnvironmentReceipt> {
    return this.attempt('provision', (sequence, before, stateBefore) =>
      this.provisionNow(sequence, before, stateBefore),
    );
  }

  start(): Promise<DisposableEnvironmentReceipt> {
    return this.attempt('start', (sequence, before, stateBefore) =>
      this.startNow(sequence, before, stateBefore),
    );
  }

  execute(input: DisposableExecutionInput): Promise<DisposableEnvironmentReceipt> {
    return this.attempt('execute', (sequence, before, stateBefore) =>
      this.executeNow(input, sequence, before, stateBefore),
    );
  }

  snapshot(input: DisposableSnapshotInput): Promise<DisposableEnvironmentReceipt> {
    return this.attempt('snapshot', (sequence, before, stateBefore) =>
      this.snapshotNow(input, sequence, before, stateBefore),
    );
  }

  restore(snapshot: DisposableEnvironmentSnapshot): Promise<DisposableEnvironmentReceipt> {
    return this.attempt('restore', (sequence, before, stateBefore) =>
      this.restoreNow(snapshot, sequence, before, stateBefore),
    );
  }

  exportArtifacts(input: DisposableArtifactExportInput): Promise<DisposableEnvironmentReceipt> {
    return this.attempt('export', (sequence, before, stateBefore) =>
      this.exportNow(input, sequence, before, stateBefore),
    );
  }

  teardown(): Promise<DisposableEnvironmentReceipt> {
    return this.attempt('teardown', (sequence, before, stateBefore) =>
      this.teardownNow(sequence, before, stateBefore),
    );
  }

  private attempt(
    operation: DisposableEnvironmentOperation,
    handler: (
      sequence: number,
      generationBefore: number,
      stateBefore: DisposableEnvironmentState,
    ) => Promise<DisposableEnvironmentReceipt>,
  ): Promise<DisposableEnvironmentReceipt> {
    const task = this.state.serialTail.then(async () => {
      this.state.sequence += 1;
      const sequence = this.state.sequence;
      const before = this.state.generation;
      const stateBefore = this.state.state;
      try {
        return await handler(sequence, before, stateBefore);
      } catch (error) {
        const code =
          error instanceof DisposableEnvironmentError && error.code === 'REGISTRY_CAPACITY_EXCEEDED'
            ? error.code
            : 'BACKEND_OPERATION_FAILED';
        if (code === 'BACKEND_OPERATION_FAILED') this.state.generation += 1;
        this.quarantine(code);
        return this.receipt({
          operation,
          sequence,
          generationBefore: before,
          stateBefore,
          status: 'BLOCKED',
          code,
        });
      }
    });
    this.state.serialTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private validateFilesystemPaths(): void {
    const { filesystem } = this.options.policy.capabilities;
    const root = this.options.workspace.root;
    for (const ref of filesystem.readOnlyPaths) assertNoSymlinkPath(root, ref, true);
    for (const ref of filesystem.writablePaths) assertNoSymlinkPath(root, ref, false);
    for (const mount of filesystem.mounts) {
      assertNoSymlinkPath(root, mount.sourceRef, true);
      assertNoSymlinkPath(root, mount.targetRef, false);
    }
  }

  private quarantine(reason: DisposableEnvironmentErrorCode): void {
    this.state.state = 'QUARANTINED';
    this.state.quarantineReason = reason;
  }

  private async timed<T>(
    sequence: number,
    label: string,
    callback: (signal: AbortSignal) => T | Promise<T>,
    timeoutCode: 'TRUST_CALLBACK_TIMEOUT' | 'OPERATION_TIMEOUT',
  ): Promise<TimedResult<T>> {
    const controller = new AbortController();
    const pending = Promise.resolve().then(() => callback(controller.signal));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<TimedResult<T>>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), this.timeoutMs);
    });
    const result = await Promise.race([
      pending.then<TimedResult<T>, TimedResult<T>>(
        (value) => ({ kind: 'result', value }),
        () => ({ kind: 'error' }),
      ),
      timeout,
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (result.kind === 'timeout') {
      controller.abort();
      this.state.lateOperations.set(sequence, label);
      this.quarantine(timeoutCode);
      void pending.then(
        () => this.state.lateOperations.delete(sequence),
        () => this.state.lateOperations.delete(sequence),
      );
    }
    return result;
  }

  private hostFailure(): DisposableEnvironmentErrorCode | null {
    const host = this.host;
    if (
      host === null ||
      this.options.hostCapability === undefined ||
      this.options.hostCapability === null ||
      !localTestHostCapabilities.has(this.options.hostCapability)
    ) {
      return 'HOST_CAPABILITY_INVALID';
    }
    const now = this.now().getTime();
    if (Date.parse(host.issuedAt) > now || Date.parse(host.expiresAt) <= now) {
      return 'HOST_CAPABILITY_INVALID';
    }
    if (
      host.backendId !== this.options.backend.backendId ||
      host.runtimeId !== this.options.backend.runtimeId ||
      host.capabilitySha256 !== this.options.policy.capabilitySha256
    ) {
      return 'HOST_CAPABILITY_MISMATCH';
    }
    if (
      host.authority !== DISPOSABLE_LOCAL_TEST_AUTHORITY ||
      host.isolation !== DISPOSABLE_LOCAL_TEST_HOST_ISOLATION ||
      host.productionEligible !== false
    ) {
      return 'HOST_CAPABILITY_INVALID';
    }
    return null;
  }

  private challenge(
    operation: DisposableEnvironmentOperation,
    sequence: number,
  ): AttestationChallenge {
    if (this.state.issuedChallenges.size >= this.registry.options.maxReplayEntries) {
      fail('REGISTRY_CAPACITY_EXCEEDED');
    }
    const issuedAt = this.now().toISOString();
    let nonce = hashDisposableEnvironmentPayload({
      registryKeySha256: this.registryKeySha256,
      sequence,
      entropy: randomUUID(),
    });
    while (this.state.issuedChallenges.has(nonce)) {
      nonce = hashDisposableEnvironmentPayload({ nonce, entropy: randomUUID() });
    }
    this.state.issuedChallenges.add(nonce);
    const base = {
      schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION,
      challengeId: `challenge-${sequence}-${nonce.slice(0, 16)}`,
      nonce,
      authority: this.host?.authority ?? 'untrusted',
      operation,
      operationSequence: sequence,
      environmentId: this.options.environmentId,
      backendId: this.options.backend.backendId,
      runtimeId: this.options.backend.runtimeId,
      policySha256: this.options.policy.policySha256,
      workspaceSha256: this.options.workspace.workspaceSha256,
      capabilitySha256: this.options.policy.capabilitySha256,
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + this.timeoutMs).toISOString(),
    };
    return { ...base, challengeSha256: hashDisposableEnvironmentPayload(base) };
  }

  private exactAttestation(
    attestation: BackendAttestation,
    challenge: AttestationChallenge,
  ): DisposableEnvironmentErrorCode | null {
    const host = this.host;
    if (host === null) return 'HOST_CAPABILITY_INVALID';
    if (attestation.nonce !== challenge.nonce) {
      return this.state.consumedAttestationNonces.has(attestation.nonce) ||
        this.state.issuedChallenges.has(attestation.nonce)
        ? 'ATTESTATION_REPLAY'
        : 'ATTESTATION_UNVERIFIED';
    }
    const exact =
      attestation.issuerId === host.issuerId &&
      attestation.verifierId === host.verifierId &&
      attestation.verifierDigest === host.verifierDigest &&
      attestation.reconcilerId === host.reconcilerId &&
      attestation.reconcilerDigest === host.reconcilerDigest &&
      attestation.authority === host.authority &&
      attestation.operation === challenge.operation &&
      attestation.operationSequence === challenge.operationSequence &&
      attestation.environmentId === challenge.environmentId &&
      attestation.backendId === challenge.backendId &&
      attestation.runtimeId === challenge.runtimeId &&
      attestation.policySha256 === challenge.policySha256 &&
      attestation.workspaceSha256 === challenge.workspaceSha256 &&
      attestation.capabilitySha256 === challenge.capabilitySha256;
    if (!exact) return 'ATTESTATION_UNVERIFIED';
    const now = this.now().getTime();
    if (
      Date.parse(attestation.issuedAt) > now ||
      Date.parse(attestation.expiresAt) <= now ||
      Date.parse(attestation.issuedAt) < Date.parse(challenge.issuedAt) ||
      Date.parse(attestation.expiresAt) > Date.parse(challenge.expiresAt)
    ) {
      return 'ATTESTATION_EXPIRED';
    }
    return null;
  }

  private exactAttestationProjection(
    projection: AttestationVerificationProjection,
    attestation: BackendAttestation,
    challenge: AttestationChallenge,
  ): boolean {
    const host = this.host;
    if (host === null) return false;
    const now = this.now().getTime();
    return (
      projection.attestationSha256 === attestation.attestationSha256 &&
      projection.verifierId === host.verifierId &&
      projection.verifierDigest === host.verifierDigest &&
      projection.nonce === challenge.nonce &&
      projection.authority === challenge.authority &&
      projection.operation === challenge.operation &&
      projection.operationSequence === challenge.operationSequence &&
      projection.environmentId === challenge.environmentId &&
      projection.backendId === challenge.backendId &&
      projection.runtimeId === challenge.runtimeId &&
      projection.policySha256 === challenge.policySha256 &&
      projection.workspaceSha256 === challenge.workspaceSha256 &&
      projection.capabilitySha256 === challenge.capabilitySha256 &&
      Date.parse(projection.verifiedAt) <= now &&
      Date.parse(projection.expiresAt) > now &&
      Date.parse(projection.expiresAt) <= Date.parse(challenge.expiresAt)
    );
  }

  private async trustedProof(
    operation: DisposableEnvironmentOperation,
    sequence: number,
  ): Promise<TrustedOperationProof | DisposableEnvironmentErrorCode> {
    const hostFailure = this.hostFailure();
    if (hostFailure !== null) return hostFailure;
    if (this.options.attestationProvider === undefined) return 'ATTESTATION_PROVIDER_MISSING';
    if (this.options.attestationProjectionVerifier === undefined) {
      return 'ATTESTATION_VERIFIER_MISSING';
    }
    const challenge = this.challenge(operation, sequence);
    const provided = await this.timed(
      sequence,
      'attestation-provider',
      () => this.options.attestationProvider!(challenge),
      'TRUST_CALLBACK_TIMEOUT',
    );
    if (provided.kind === 'timeout') return 'TRUST_CALLBACK_TIMEOUT';
    if (provided.kind === 'error') return 'ATTESTATION_UNVERIFIED';
    let attestation: BackendAttestation;
    try {
      attestation = parseBackendAttestation(provided.value);
    } catch {
      return 'ATTESTATION_UNVERIFIED';
    }
    const attestationFailure = this.exactAttestation(attestation, challenge);
    if (attestationFailure !== null) return attestationFailure;
    if (
      this.state.consumedAttestationNonces.size >= this.registry.options.maxReplayEntries ||
      this.state.consumedAttestationNonces.has(attestation.nonce)
    ) {
      return this.state.consumedAttestationNonces.has(attestation.nonce)
        ? 'ATTESTATION_REPLAY'
        : 'REGISTRY_CAPACITY_EXCEEDED';
    }
    this.state.consumedAttestationNonces.add(attestation.nonce);
    const verified = await this.timed(
      sequence,
      'attestation-projection-verifier',
      () => this.options.attestationProjectionVerifier!(attestation, challenge),
      'TRUST_CALLBACK_TIMEOUT',
    );
    if (verified.kind === 'timeout') return 'TRUST_CALLBACK_TIMEOUT';
    if (verified.kind === 'error') return 'ATTESTATION_UNVERIFIED';
    let projection: AttestationVerificationProjection;
    try {
      projection = parseAttestationProjection(verified.value);
    } catch {
      return 'ATTESTATION_UNVERIFIED';
    }
    if (!this.exactAttestationProjection(projection, attestation, challenge)) {
      return 'ATTESTATION_UNVERIFIED';
    }
    return { challenge, attestation, projection };
  }

  private proofFailure(
    operation: DisposableEnvironmentOperation,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
    code: DisposableEnvironmentErrorCode,
  ): DisposableEnvironmentReceipt {
    const status: DisposableEnvironmentReceiptStatus =
      code === 'TRUST_CALLBACK_TIMEOUT' || code === 'REGISTRY_CAPACITY_EXCEEDED'
        ? 'BLOCKED'
        : code === 'EGRESS_PRIVATE_DESTINATION' ||
            code === 'DNS_REBINDING_DETECTED' ||
            code === 'MULTI_ADDRESS_DESTINATION_DENIED'
          ? 'FAIL'
          : 'UNVERIFIED';
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status,
      code,
    });
  }

  private baseRequest(
    proof: TrustedOperationProof,
    operation: DisposableEnvironmentOperation,
    sequence: number,
  ): BackendRequestBase {
    return {
      schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION,
      operation,
      operationId: `${this.options.environmentId}-${sequence}-${operation}`,
      environmentId: this.options.environmentId,
      backendId: this.options.backend.backendId,
      runtimeId: this.options.backend.runtimeId,
      operationSequence: sequence,
      generation: this.state.generation,
      policySha256: this.options.policy.policySha256,
      workspaceSha256: this.options.workspace.workspaceSha256,
      capabilitySha256: this.options.policy.capabilitySha256,
      attestation: proof.attestation,
      attestationProjection: proof.projection,
      runtimeHandle: this.state.runtimeHandle,
    };
  }

  private invalidState(
    operation: DisposableEnvironmentOperation,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): DisposableEnvironmentReceipt {
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: stateBefore === 'QUARANTINED' ? 'BLOCKED' : 'FAIL',
      code: 'INVALID_STATE',
    });
  }

  private lateBlocked(
    operation: DisposableEnvironmentOperation,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): DisposableEnvironmentReceipt | null {
    return this.state.lateOperations.size === 0
      ? null
      : this.receipt({
          operation,
          sequence,
          generationBefore: before,
          stateBefore,
          status: 'BLOCKED',
          code: 'LATE_OPERATION_PENDING',
        });
  }

  private async backendCall<T>(
    sequence: number,
    operation: DisposableEnvironmentOperation,
    callback: (signal: AbortSignal) => Promise<T>,
  ): Promise<TimedResult<T>> {
    return this.timed(sequence, `backend-${operation}`, callback, 'OPERATION_TIMEOUT');
  }

  private backendFailure(
    operation: DisposableEnvironmentOperation,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
    proof: TrustedOperationProof,
    outcome: TimedResult<unknown>,
  ): DisposableEnvironmentReceipt {
    this.state.generation += 1;
    const code = outcome.kind === 'timeout' ? 'OPERATION_TIMEOUT' : 'BACKEND_OPERATION_FAILED';
    this.quarantine(code);
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: 'BLOCKED',
      code,
      proof,
    });
  }

  private filesystemInput(sequence: number): FilesystemProjectionInput {
    this.validateFilesystemPaths();
    const root = this.options.workspace.root;
    const rootInfo = lstatSync(root);
    const rootIdentity = `root-${rootInfo.dev}-${rootInfo.ino}`;
    const mounts = this.options.policy.capabilities.filesystem.mounts.map((mount, index) => {
      const source = resolve(root, mount.sourceRef);
      let descriptor: number | null = null;
      let sourceIdentity: string;
      let sourceSha256: string;
      try {
        descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = fstatSync(descriptor);
        if (!info.isFile()) fail('FILESYSTEM_PROJECTION_UNVERIFIED');
        sourceIdentity = `source-${info.dev}-${info.ino}`;
        sourceSha256 = createHash('sha256').update(readFileSync(descriptor)).digest('hex');
      } finally {
        if (descriptor !== null) closeSync(descriptor);
      }
      if (sourceSha256 !== mount.sourceSha256) fail('FILESYSTEM_PROJECTION_UNVERIFIED');
      const target = resolve(root, mount.targetRef);
      const targetAnchor = existsSync(target) ? target : resolve(target, '..');
      const targetInfo = lstatSync(targetAnchor);
      if (targetInfo.isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED');
      return {
        mountId: mount.mountId,
        sourceRef: mount.sourceRef,
        targetRef: mount.targetRef,
        sourceIdentity,
        targetIdentity: `target-${targetInfo.dev}-${targetInfo.ino}`,
        sourceSha256,
        targetRefSha256: hashDisposableEnvironmentPayload(mount.targetRef),
        consumeToken: `consume-${sequence}-${index}-${randomUUID()}`,
      };
    });
    const now = this.now().toISOString();
    return {
      projectionId: `filesystem-${sequence}-${randomUUID()}`,
      verifierId: this.host!.verifierId,
      verifierDigest: this.host!.verifierDigest,
      environmentId: this.options.environmentId,
      workspaceSha256: this.options.workspace.workspaceSha256,
      policySha256: this.options.policy.policySha256,
      capabilitySha256: this.options.policy.capabilitySha256,
      operationSequence: sequence,
      rootIdentity,
      rootSha256: hashDisposableEnvironmentPayload({ rootIdentity, root }),
      mounts,
      verifiedAt: now,
      expiresAt: new Date(Date.parse(now) + this.timeoutMs).toISOString(),
    };
  }

  private async filesystemProof(
    sequence: number,
  ): Promise<FilesystemProjection | DisposableEnvironmentErrorCode | null> {
    if (!this.options.policy.capabilities.filesystem.enabled) return null;
    if (this.options.filesystemProjectionVerifier === undefined) {
      return 'FILESYSTEM_PROJECTION_MISSING';
    }
    let expected: FilesystemProjectionInput;
    try {
      expected = this.filesystemInput(sequence);
    } catch {
      return 'FILESYSTEM_PROJECTION_UNVERIFIED';
    }
    const checked = await this.timed(
      sequence,
      'filesystem-projection-verifier',
      () => this.options.filesystemProjectionVerifier!(expected),
      'TRUST_CALLBACK_TIMEOUT',
    );
    if (checked.kind === 'timeout') return 'TRUST_CALLBACK_TIMEOUT';
    if (checked.kind === 'error') return 'FILESYSTEM_PROJECTION_UNVERIFIED';
    try {
      const projection = parseFilesystemProjection(checked.value);
      const canonical = createFilesystemProjection(expected);
      if (projection.projectionSha256 !== canonical.projectionSha256) {
        return 'FILESYSTEM_PROJECTION_UNVERIFIED';
      }
      const now = this.now().getTime();
      if (Date.parse(projection.verifiedAt) > now || Date.parse(projection.expiresAt) <= now) {
        return 'FILESYSTEM_PROJECTION_UNVERIFIED';
      }
      return projection;
    } catch {
      return 'FILESYSTEM_PROJECTION_UNVERIFIED';
    }
  }

  private async provisionNow(
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): Promise<DisposableEnvironmentReceipt> {
    const operation = 'provision' as const;
    const late = this.lateBlocked(operation, sequence, before, stateBefore);
    if (late !== null) return late;
    if (stateBefore !== 'NEW') return this.invalidState(operation, sequence, before, stateBefore);
    const proof = await this.trustedProof(operation, sequence);
    if (typeof proof === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, proof);
    }
    const filesystemProjection = await this.filesystemProof(sequence);
    if (typeof filesystemProjection === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, filesystemProjection);
    }
    const request: BackendProvisionRequest = {
      ...this.baseRequest(proof, operation, sequence),
      operation,
      workspaceRoot: this.options.workspace.root,
      capabilities: this.options.policy.capabilities,
      filesystemProjection,
    };
    const outcome = await this.backendCall(sequence, operation, (signal) =>
      this.options.backend.provision(request, signal),
    );
    if (outcome.kind !== 'result') {
      return this.backendFailure(operation, sequence, before, stateBefore, proof, outcome);
    }
    this.state.generation += 1;
    try {
      assertExactKeys(outcome.value, [
        'environmentId',
        'filesystemConsumeToken',
        'generation',
        'operationSequence',
        'rootRef',
        'runtimeHandle',
      ]);
      resultIdentity(outcome.value, this.options.environmentId, sequence, before);
      assertSafeId(outcome.value.runtimeHandle);
      assertRelative(outcome.value.rootRef);
      const expectedToken = filesystemProjection?.projectionSha256 ?? null;
      if (outcome.value.filesystemConsumeToken !== expectedToken) fail('BACKEND_RESULT_INVALID');
    } catch {
      this.quarantine('BACKEND_RESULT_INVALID');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'BACKEND_RESULT_INVALID',
        proof,
        backendResult: outcome.value,
        filesystemProjection,
      });
    }
    this.state.runtimeHandle = outcome.value.runtimeHandle;
    this.state.state = 'PROVISIONED';
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: 'UNVERIFIED',
      simulatedSuccess: true,
      code: 'PROVISIONED',
      proof,
      backendResult: outcome.value,
      filesystemProjection,
    });
  }

  private async startNow(
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): Promise<DisposableEnvironmentReceipt> {
    const operation = 'start' as const;
    const late = this.lateBlocked(operation, sequence, before, stateBefore);
    if (late !== null) return late;
    if (stateBefore !== 'PROVISIONED' || this.state.runtimeHandle === null) {
      return this.invalidState(operation, sequence, before, stateBefore);
    }
    const proof = await this.trustedProof(operation, sequence);
    if (typeof proof === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, proof);
    }
    const request: BackendStartRequest = {
      ...this.baseRequest(proof, operation, sequence),
      operation,
      runtimeHandle: this.state.runtimeHandle,
    };
    const outcome = await this.backendCall(sequence, operation, (signal) =>
      this.options.backend.start(request, signal),
    );
    if (outcome.kind !== 'result') {
      return this.backendFailure(operation, sequence, before, stateBefore, proof, outcome);
    }
    this.state.generation += 1;
    try {
      assertExactKeys(outcome.value, ['environmentId', 'generation', 'operationSequence', 'ready']);
      resultIdentity(outcome.value, this.options.environmentId, sequence, before);
      if (outcome.value.ready !== true) fail('BACKEND_RESULT_INVALID');
    } catch {
      this.quarantine('BACKEND_RESULT_INVALID');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'BACKEND_RESULT_INVALID',
        proof,
        backendResult: outcome.value,
      });
    }
    this.state.state = 'RUNNING';
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: 'UNVERIFIED',
      simulatedSuccess: true,
      code: 'STARTED',
      proof,
      backendResult: outcome.value,
    });
  }

  private validateExecution(input: DisposableExecutionInput): {
    argv: string[];
    cwd: string;
    environment: Record<string, string>;
    secretHandles: string[];
    destinations: EgressDestination[];
  } {
    const keys = ['argv', 'cwd', 'environmentKeys', 'secretHandles'];
    if (Object.prototype.hasOwnProperty.call(input, 'networkDestinations'))
      keys.push('networkDestinations');
    assertExactKeys(input, keys);
    const processCapability = this.options.policy.capabilities.process;
    if (!processCapability.enabled) fail('CAPABILITY_PROCESS_DENIED');
    if (
      !Array.isArray(input.argv) ||
      input.argv.length === 0 ||
      input.argv.length > processCapability.maxArgCount
    ) {
      fail('INVALID_CONTRACT');
    }
    const argv = (input.argv as unknown[]).map((argument) => {
      if (typeof argument !== 'string' || CONTROL.test(argument)) fail('INVALID_CONTRACT');
      return argument;
    });
    if (Buffer.byteLength(argv.join('\0'), 'utf8') > processCapability.maxArgBytes) {
      fail('RESOURCE_QUOTA_EXCEEDED');
    }
    if (!processCapability.allowedExecutables.includes(argv[0])) fail('COMMAND_NOT_ALLOWED');
    assertRelative(input.cwd, true);
    assertNoSymlinkPath(this.options.workspace.root, input.cwd, false);
    if (!Array.isArray(input.environmentKeys) || input.environmentKeys.length > MAX_ITEMS) {
      fail('INVALID_CONTRACT');
    }
    const environmentKeys = [...input.environmentKeys] as unknown[];
    for (const key of environmentKeys) {
      if (
        typeof key !== 'string' ||
        CONTROL.test(key) ||
        PROTOTYPE_KEYS.has(key.toLowerCase()) ||
        !Object.prototype.hasOwnProperty.call(processCapability.environmentAllowlist, key)
      ) {
        fail('ENVIRONMENT_NOT_ALLOWED');
      }
    }
    assertUnique(environmentKeys as string[]);
    const environment: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const key of environmentKeys as string[]) {
      Object.defineProperty(environment, key, {
        value: processCapability.environmentAllowlist[key],
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    if (!Array.isArray(input.secretHandles) || input.secretHandles.length > MAX_ITEMS) {
      fail('INVALID_CONTRACT');
    }
    const secretHandles = [...input.secretHandles] as unknown[];
    for (const handle of secretHandles) assertSafeId(handle);
    assertUnique(secretHandles as string[]);
    const secret = this.options.policy.capabilities.secret;
    if (secretHandles.length > 0 && !secret.enabled) fail('CAPABILITY_SECRET_DENIED');
    for (const handle of secretHandles as string[]) {
      if (!secret.allowedHandles.includes(handle)) fail('SECRET_HANDLE_NOT_ALLOWED');
    }
    const rawDestinations = input.networkDestinations ?? [];
    if (!Array.isArray(rawDestinations) || rawDestinations.length > MAX_ITEMS)
      fail('INVALID_CONTRACT');
    const destinations = (rawDestinations as unknown as EgressDestination[]).map(
      normalizeDestination,
    );
    assertUnique(destinations.map(endpointKey));
    const network = this.options.policy.capabilities.network;
    if (destinations.length > 0 && !network.enabled) fail('CAPABILITY_NETWORK_DENIED');
    const allowed = new Set(network.egressAllowlist.map(endpointKey));
    for (const destination of destinations) {
      if (privateHostname(destination.hostname)) fail('EGRESS_PRIVATE_DESTINATION');
      if (!allowed.has(endpointKey(destination))) fail('EGRESS_NOT_ALLOWED');
    }
    return {
      argv,
      cwd: input.cwd,
      environment,
      secretHandles: secretHandles as string[],
      destinations,
    };
  }

  private async networkProof(
    destinations: readonly EgressDestination[],
    sequence: number,
  ): Promise<
    | { projections: NetworkResolutionProjection[]; pinned: PinnedEgressDestination[] }
    | DisposableEnvironmentErrorCode
  > {
    if (destinations.length === 0) return { projections: [], pinned: [] };
    if (this.options.networkProjectionVerifier === undefined) return 'NETWORK_PROJECTION_MISSING';
    const projections: NetworkResolutionProjection[] = [];
    const pinned: PinnedEgressDestination[] = [];
    for (const destination of destinations) {
      const checked = await this.timed(
        sequence,
        `network-projection-${endpointKey(destination)}`,
        () => this.options.networkProjectionVerifier!(destination),
        'TRUST_CALLBACK_TIMEOUT',
      );
      if (checked.kind === 'timeout') return 'TRUST_CALLBACK_TIMEOUT';
      if (checked.kind === 'error') return 'NETWORK_PROJECTION_UNVERIFIED';
      let projection: NetworkResolutionProjection;
      try {
        projection = parseNetworkProjection(checked.value);
      } catch {
        return 'NETWORK_PROJECTION_UNVERIFIED';
      }
      const host = this.host!;
      if (
        endpointKey(projection.destination) !== endpointKey(destination) ||
        projection.destinationSha256 !== hashDisposableEnvironmentPayload(destination) ||
        projection.verifierId !== host.verifierId ||
        projection.verifierDigest !== host.verifierDigest
      ) {
        return 'NETWORK_PROJECTION_UNVERIFIED';
      }
      if (projection.firstResolution.length !== 1 || projection.secondResolution.length !== 1) {
        return 'MULTI_ADDRESS_DESTINATION_DENIED';
      }
      if (projection.firstResolution[0] !== projection.secondResolution[0]) {
        return 'DNS_REBINDING_DETECTED';
      }
      const address = projection.firstResolution[0];
      if (!globallyRoutable(address)) return 'EGRESS_PRIVATE_DESTINATION';
      if (projection.chosenIp !== address) return 'NETWORK_PROJECTION_UNVERIFIED';
      const now = this.now().getTime();
      if (Date.parse(projection.verifiedAt) > now || Date.parse(projection.expiresAt) <= now) {
        return 'NETWORK_PROJECTION_UNVERIFIED';
      }
      projections.push(projection);
      pinned.push({
        ...destination,
        verifiedAddresses: [address],
        chosenIp: address,
        pinToken: projection.pinToken,
        resolutionSha256: projection.resolutionSha256,
        projectionSha256: projection.projectionSha256,
      });
    }
    return { projections, pinned };
  }

  private validateConnections(
    actual: readonly NetworkConnectionReceipt[],
    pinned: readonly PinnedEgressDestination[],
  ): void {
    if (!Array.isArray(actual) || actual.length !== pinned.length) fail('NETWORK_PIN_MISMATCH');
    for (let index = 0; index < pinned.length; index += 1) {
      const connection = actual[index];
      assertExactKeys(connection, [
        'connectedIp',
        'hostname',
        'pinToken',
        'port',
        'protocol',
        'resolutionSha256',
      ]);
      const expected = pinned[index];
      if (
        endpointKey(connection as unknown as EgressDestination) !== endpointKey(expected) ||
        connection.connectedIp !== expected.chosenIp ||
        connection.pinToken !== expected.pinToken ||
        connection.resolutionSha256 !== expected.resolutionSha256 ||
        !globallyRoutable(connection.connectedIp)
      ) {
        fail('NETWORK_PIN_MISMATCH');
      }
    }
  }

  private async executeNow(
    input: DisposableExecutionInput,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): Promise<DisposableEnvironmentReceipt> {
    const operation = 'execute' as const;
    const late = this.lateBlocked(operation, sequence, before, stateBefore);
    if (late !== null) return late;
    if (stateBefore !== 'RUNNING' || this.state.runtimeHandle === null) {
      return this.invalidState(operation, sequence, before, stateBefore);
    }
    let command: ReturnType<DisposableEnvironmentRuntime['validateExecution']>;
    try {
      command = this.validateExecution(input);
    } catch (error) {
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'FAIL',
        code: error instanceof DisposableEnvironmentError ? error.code : 'INVALID_CONTRACT',
      });
    }
    const proof = await this.trustedProof(operation, sequence);
    if (typeof proof === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, proof);
    }
    const network = await this.networkProof(command.destinations, sequence);
    if (typeof network === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, network);
    }
    const request: BackendExecuteRequest = {
      ...this.baseRequest(proof, operation, sequence),
      operation,
      runtimeHandle: this.state.runtimeHandle,
      argv: command.argv,
      cwd: command.cwd,
      environment: command.environment,
      secretHandles: command.secretHandles,
      networkDestinations: network.pinned,
      resourceLimits: this.options.policy.capabilities.resource,
    };
    const outcome = await this.backendCall(sequence, operation, (signal) =>
      this.options.backend.execute(request, signal),
    );
    if (outcome.kind !== 'result') {
      return this.backendFailure(operation, sequence, before, stateBefore, proof, outcome);
    }
    this.state.generation += 1;
    try {
      assertExactKeys(outcome.value, [
        'connections',
        'cpuMillis',
        'diskBytes',
        'environmentId',
        'exitCode',
        'generation',
        'operationSequence',
        'outputBytes',
        'outputSha256',
        'peakMemoryBytes',
        'peakPids',
      ]);
      resultIdentity(outcome.value, this.options.environmentId, sequence, before);
      assertInteger(outcome.value.exitCode, 0, 255);
      assertInteger(outcome.value.cpuMillis, 0);
      assertInteger(outcome.value.peakMemoryBytes, 0);
      assertInteger(outcome.value.peakPids, 0);
      assertInteger(outcome.value.outputBytes, 0);
      assertInteger(outcome.value.diskBytes, 0);
      assertSha(outcome.value.outputSha256);
      this.validateConnections(outcome.value.connections, network.pinned);
    } catch (error) {
      const code =
        error instanceof DisposableEnvironmentError && error.code === 'NETWORK_PIN_MISMATCH'
          ? error.code
          : 'BACKEND_RESULT_INVALID';
      this.quarantine(code);
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code,
        proof,
        backendResult: outcome.value,
        networkProjections: network.projections,
      });
    }
    const limits = this.options.policy.capabilities.resource;
    const metrics: DisposableExecutionMetrics = {
      exitCode: outcome.value.exitCode,
      cpuMillis: outcome.value.cpuMillis,
      peakMemoryBytes: outcome.value.peakMemoryBytes,
      peakPids: outcome.value.peakPids,
      outputBytes: outcome.value.outputBytes,
      diskBytes: outcome.value.diskBytes,
      outputSha256: outcome.value.outputSha256,
      connections: [...outcome.value.connections],
    };
    if (
      outcome.value.cpuMillis > limits.cpuMillis ||
      outcome.value.peakMemoryBytes > limits.memoryBytes ||
      outcome.value.peakPids > limits.pids ||
      outcome.value.outputBytes > limits.outputBytes ||
      outcome.value.diskBytes > limits.diskBytes
    ) {
      this.quarantine('RESOURCE_QUOTA_EXCEEDED');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'RESOURCE_QUOTA_EXCEEDED',
        proof,
        backendResult: outcome.value,
        networkProjections: network.projections,
        metrics,
      });
    }
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: outcome.value.exitCode === 0 ? 'UNVERIFIED' : 'FAIL',
      simulatedSuccess: outcome.value.exitCode === 0 ? true : undefined,
      code: outcome.value.exitCode === 0 ? 'EXECUTED' : 'COMMAND_EXIT_NONZERO',
      proof,
      backendResult: outcome.value,
      networkProjections: network.projections,
      metrics,
    });
  }

  private parseSnapshot(snapshot: DisposableEnvironmentSnapshot): void {
    assertExactKeys(snapshot, [
      'backendId',
      'capabilitySha256',
      'createdAt',
      'environmentId',
      'expiresAt',
      'generation',
      'operationSequence',
      'policySha256',
      'runtimeId',
      'schemaVersion',
      'snapshotBytes',
      'snapshotId',
      'snapshotMediaType',
      'snapshotRef',
      'snapshotSha256',
      'stateSha256',
      'workspaceSha256',
    ]);
    if (snapshot.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('SNAPSHOT_TAMPERED');
    for (const id of [
      snapshot.backendId,
      snapshot.environmentId,
      snapshot.runtimeId,
      snapshot.snapshotId,
    ]) {
      assertSafeId(id);
    }
    assertRelative(snapshot.snapshotRef);
    if (!MEDIA_TYPE.test(snapshot.snapshotMediaType)) fail('SNAPSHOT_TAMPERED');
    assertInteger(snapshot.snapshotBytes, 0);
    assertInteger(snapshot.generation, 0);
    assertInteger(snapshot.operationSequence, 1);
    for (const digest of [
      snapshot.capabilitySha256,
      snapshot.policySha256,
      snapshot.snapshotSha256,
      snapshot.stateSha256,
      snapshot.workspaceSha256,
    ]) {
      assertSha(digest);
    }
    assertTime(snapshot.createdAt);
    assertTime(snapshot.expiresAt);
    if (
      hashDisposableEnvironmentPayload(
        without(snapshot as unknown as Record<string, unknown>, 'snapshotSha256'),
      ) !== snapshot.snapshotSha256
    ) {
      fail('SNAPSHOT_TAMPERED');
    }
  }

  private async snapshotNow(
    input: DisposableSnapshotInput,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): Promise<DisposableEnvironmentReceipt> {
    const operation = 'snapshot' as const;
    const late = this.lateBlocked(operation, sequence, before, stateBefore);
    if (late !== null) return late;
    if (stateBefore !== 'RUNNING' || this.state.runtimeHandle === null) {
      return this.invalidState(operation, sequence, before, stateBefore);
    }
    try {
      assertExactKeys(input, ['ttlMs']);
      assertInteger(input.ttlMs, 1, MAX_SNAPSHOT_TTL_MS);
    } catch {
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'FAIL',
        code: 'INVALID_CONTRACT',
      });
    }
    const proof = await this.trustedProof(operation, sequence);
    if (typeof proof === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, proof);
    }
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(Date.parse(createdAt) + input.ttlMs).toISOString();
    const request: BackendSnapshotRequest = {
      ...this.baseRequest(proof, operation, sequence),
      operation,
      runtimeHandle: this.state.runtimeHandle,
      expiresAt,
      maxBytes: this.options.policy.capabilities.resource.snapshotBytes,
    };
    const outcome = await this.backendCall(sequence, operation, (signal) =>
      this.options.backend.snapshot(request, signal),
    );
    if (outcome.kind !== 'result') {
      return this.backendFailure(operation, sequence, before, stateBefore, proof, outcome);
    }
    this.state.generation += 1;
    try {
      assertExactKeys(outcome.value, [
        'environmentId',
        'generation',
        'operationSequence',
        'snapshotBytes',
        'snapshotId',
        'snapshotMediaType',
        'snapshotRef',
        'stateSha256',
      ]);
      resultIdentity(outcome.value, this.options.environmentId, sequence, before);
      assertSafeId(outcome.value.snapshotId);
      assertRelative(outcome.value.snapshotRef);
      assertInteger(
        outcome.value.snapshotBytes,
        0,
        this.options.policy.capabilities.resource.snapshotBytes,
      );
      if (!MEDIA_TYPE.test(outcome.value.snapshotMediaType)) fail('BACKEND_RESULT_INVALID');
      assertSha(outcome.value.stateSha256);
    } catch {
      this.quarantine('BACKEND_RESULT_INVALID');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'BACKEND_RESULT_INVALID',
        proof,
        backendResult: outcome.value,
      });
    }
    if (this.state.snapshots.size >= this.registry.options.maxSnapshotsPerEnvironment) {
      this.quarantine('REGISTRY_CAPACITY_EXCEEDED');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'REGISTRY_CAPACITY_EXCEEDED',
        proof,
        backendResult: outcome.value,
      });
    }
    const snapshotBase = {
      schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION,
      snapshotId: outcome.value.snapshotId,
      snapshotRef: outcome.value.snapshotRef,
      snapshotBytes: outcome.value.snapshotBytes,
      snapshotMediaType: outcome.value.snapshotMediaType,
      stateSha256: outcome.value.stateSha256,
      environmentId: this.options.environmentId,
      backendId: this.options.backend.backendId,
      runtimeId: this.options.backend.runtimeId,
      generation: this.state.generation,
      operationSequence: sequence,
      policySha256: this.options.policy.policySha256,
      workspaceSha256: this.options.workspace.workspaceSha256,
      capabilitySha256: this.options.policy.capabilitySha256,
      createdAt,
      expiresAt,
    };
    const snapshot = {
      ...snapshotBase,
      snapshotSha256: hashDisposableEnvironmentPayload(snapshotBase),
    };
    if (this.state.snapshots.has(snapshot.snapshotSha256)) {
      this.quarantine('BACKEND_RESULT_INVALID');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'BACKEND_RESULT_INVALID',
        proof,
        backendResult: outcome.value,
      });
    }
    this.state.snapshots.set(snapshot.snapshotSha256, { snapshot, status: 'available' });
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: 'UNVERIFIED',
      simulatedSuccess: true,
      code: 'SNAPSHOT_CREATED',
      proof,
      backendResult: outcome.value,
      snapshot,
    });
  }

  private snapshotFailure(
    snapshot: DisposableEnvironmentSnapshot,
  ): DisposableEnvironmentErrorCode | null {
    try {
      this.parseSnapshot(snapshot);
    } catch {
      return 'SNAPSHOT_TAMPERED';
    }
    if (
      snapshot.environmentId !== this.options.environmentId ||
      snapshot.backendId !== this.options.backend.backendId ||
      snapshot.runtimeId !== this.options.backend.runtimeId ||
      snapshot.workspaceSha256 !== this.options.workspace.workspaceSha256 ||
      snapshot.policySha256 !== this.options.policy.policySha256 ||
      snapshot.capabilitySha256 !== this.options.policy.capabilitySha256
    ) {
      return 'SNAPSHOT_CROSS_ENVIRONMENT';
    }
    const record = this.state.snapshots.get(snapshot.snapshotSha256);
    if (record?.status === 'consumed') return 'SNAPSHOT_REPLAY';
    if (record === undefined || snapshot.generation !== this.state.generation)
      return 'SNAPSHOT_STALE';
    if (Date.parse(snapshot.expiresAt) <= this.now().getTime()) return 'SNAPSHOT_EXPIRED';
    return null;
  }

  private async restoreNow(
    snapshot: DisposableEnvironmentSnapshot,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): Promise<DisposableEnvironmentReceipt> {
    const operation = 'restore' as const;
    const late = this.lateBlocked(operation, sequence, before, stateBefore);
    if (late !== null) return late;
    if (stateBefore !== 'RUNNING' || this.state.runtimeHandle === null) {
      return this.invalidState(operation, sequence, before, stateBefore);
    }
    const failure = this.snapshotFailure(snapshot);
    if (failure !== null) {
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'FAIL',
        code: failure,
      });
    }
    this.state.snapshots.get(snapshot.snapshotSha256)!.status = 'consumed';
    const proof = await this.trustedProof(operation, sequence);
    if (typeof proof === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, proof);
    }
    const request: BackendRestoreRequest = {
      ...this.baseRequest(proof, operation, sequence),
      operation,
      runtimeHandle: this.state.runtimeHandle,
      snapshot,
    };
    const outcome = await this.backendCall(sequence, operation, (signal) =>
      this.options.backend.restore(request, signal),
    );
    if (outcome.kind !== 'result') {
      return this.backendFailure(operation, sequence, before, stateBefore, proof, outcome);
    }
    this.state.generation += 1;
    try {
      assertExactKeys(outcome.value, [
        'environmentId',
        'generation',
        'operationSequence',
        'restoredStateSha256',
      ]);
      resultIdentity(outcome.value, this.options.environmentId, sequence, before);
      assertSha(outcome.value.restoredStateSha256);
      if (outcome.value.restoredStateSha256 !== snapshot.stateSha256) {
        fail('BACKEND_RESULT_INVALID');
      }
    } catch {
      this.quarantine('BACKEND_RESULT_INVALID');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'BACKEND_RESULT_INVALID',
        proof,
        backendResult: outcome.value,
      });
    }
    for (const record of this.state.snapshots.values()) record.status = 'consumed';
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: 'UNVERIFIED',
      simulatedSuccess: true,
      code: 'SNAPSHOT_RESTORED',
      proof,
      backendResult: outcome.value,
    });
  }

  private validateExport(input: DisposableArtifactExportInput): DisposableArtifactExportInput {
    assertExactKeys(input, ['artifacts', 'maxBytes']);
    if (
      !Array.isArray(input.artifacts) ||
      input.artifacts.length === 0 ||
      input.artifacts.length > MAX_ITEMS
    ) {
      fail('INVALID_CONTRACT');
    }
    const artifacts = (input.artifacts as unknown[]).map((entry) => {
      assertExactKeys(entry, ['mediaType', 'ref']);
      assertRelative(entry.ref);
      if (typeof entry.mediaType !== 'string' || !MEDIA_TYPE.test(entry.mediaType)) {
        fail('INVALID_CONTRACT');
      }
      return { ref: entry.ref, mediaType: entry.mediaType };
    });
    assertUnique(artifacts.map(({ ref }) => ref));
    assertInteger(input.maxBytes, 1, this.options.policy.capabilities.resource.artifactBytes);
    return { artifacts, maxBytes: input.maxBytes };
  }

  private async revokeArtifacts(
    sequence: number,
    artifacts: readonly DisposableArtifact[],
    exportResultSha256: string,
  ): Promise<{
    disposition: 'revoked' | 'revoke-unverified';
    projection: ArtifactDiscardProjection | null;
  }> {
    if (this.options.artifactRevoker === undefined) {
      return { disposition: 'revoke-unverified', projection: null };
    }
    const revoked = await this.timed(
      sequence,
      'artifact-revoker',
      () => this.options.artifactRevoker!(artifacts, exportResultSha256),
      'TRUST_CALLBACK_TIMEOUT',
    );
    if (revoked.kind !== 'result') return { disposition: 'revoke-unverified', projection: null };
    try {
      const projection = parseDiscardProjection(revoked.value);
      const expectedRefs = artifacts.map(({ ref }) => ref).sort();
      if (
        projection.verifierId !== this.host!.verifierId ||
        projection.verifierDigest !== this.host!.verifierDigest ||
        projection.exportResultSha256 !== exportResultSha256 ||
        projection.discardedRefs.length !== expectedRefs.length ||
        [...projection.discardedRefs].sort().some((ref, index) => ref !== expectedRefs[index]) ||
        Date.parse(projection.discardedAt) > this.now().getTime()
      ) {
        return { disposition: 'revoke-unverified', projection: null };
      }
      return { disposition: 'revoked', projection };
    } catch {
      return { disposition: 'revoke-unverified', projection: null };
    }
  }

  private async artifactProof(
    sequence: number,
    artifacts: readonly DisposableArtifact[],
    expected: readonly ArtifactExportSpec[],
  ): Promise<ArtifactVerificationProjection[] | DisposableEnvironmentErrorCode> {
    if (this.options.artifactVerifier === undefined) return 'ARTIFACT_VERIFIER_MISSING';
    const checked = await this.timed(
      sequence,
      'artifact-verifier',
      () => this.options.artifactVerifier!(artifacts, expected),
      'TRUST_CALLBACK_TIMEOUT',
    );
    if (checked.kind === 'timeout') return 'TRUST_CALLBACK_TIMEOUT';
    if (checked.kind === 'error' || !Array.isArray(checked.value)) {
      return 'ARTIFACT_VERIFICATION_FAILED';
    }
    if (checked.value.length !== artifacts.length) return 'ARTIFACT_VERIFICATION_FAILED';
    const projections: ArtifactVerificationProjection[] = [];
    try {
      for (let index = 0; index < artifacts.length; index += 1) {
        const projection = parseArtifactProjection(checked.value[index]);
        const artifact = artifacts[index];
        const expectation = expected[index];
        if (
          projection.verifierId !== this.host!.verifierId ||
          projection.verifierDigest !== this.host!.verifierDigest ||
          projection.ref !== artifact.ref ||
          projection.mediaType !== expectation.mediaType ||
          projection.mediaType !== artifact.mediaType ||
          projection.sha256 !== artifact.sha256 ||
          projection.bytes !== artifact.bytes ||
          Date.parse(projection.verifiedAt) > this.now().getTime()
        ) {
          return 'ARTIFACT_VERIFICATION_FAILED';
        }
        projections.push(projection);
      }
    } catch {
      return 'ARTIFACT_VERIFICATION_FAILED';
    }
    return projections;
  }

  private async exportNow(
    input: DisposableArtifactExportInput,
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): Promise<DisposableEnvironmentReceipt> {
    const operation = 'export' as const;
    const late = this.lateBlocked(operation, sequence, before, stateBefore);
    if (late !== null) return late;
    if (stateBefore !== 'RUNNING' || this.state.runtimeHandle === null) {
      return this.invalidState(operation, sequence, before, stateBefore);
    }
    let exportInput: DisposableArtifactExportInput;
    try {
      exportInput = this.validateExport(input);
    } catch {
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'FAIL',
        code: 'INVALID_CONTRACT',
      });
    }
    if (this.options.artifactVerifier === undefined) {
      return this.proofFailure(
        operation,
        sequence,
        before,
        stateBefore,
        'ARTIFACT_VERIFIER_MISSING',
      );
    }
    if (this.options.artifactRevoker === undefined) {
      return this.proofFailure(
        operation,
        sequence,
        before,
        stateBefore,
        'ARTIFACT_REVOKER_MISSING',
      );
    }
    const proof = await this.trustedProof(operation, sequence);
    if (typeof proof === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, proof);
    }
    const request: BackendExportRequest = {
      ...this.baseRequest(proof, operation, sequence),
      operation,
      runtimeHandle: this.state.runtimeHandle,
      ...exportInput,
    };
    const outcome = await this.backendCall(sequence, operation, (signal) =>
      this.options.backend.exportArtifacts(request, signal),
    );
    if (outcome.kind !== 'result') {
      this.state.generation += 1;
      this.quarantine('ARTIFACT_REVOKE_UNVERIFIED');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'ARTIFACT_REVOKE_UNVERIFIED',
        proof,
        artifactDisposition: 'revoke-unverified',
        artifactIdentityEvidenceSha256: hashDisposableEnvironmentPayload({
          operation,
          sequence,
          requestedArtifacts: exportInput.artifacts,
          outcome: outcome.kind,
        }),
      });
    }
    this.state.generation += 1;
    let artifacts: DisposableArtifact[] = [];
    let validationCode: DisposableEnvironmentErrorCode | null = null;
    try {
      assertExactKeys(outcome.value, [
        'artifacts',
        'environmentId',
        'generation',
        'operationSequence',
      ]);
      resultIdentity(outcome.value, this.options.environmentId, sequence, before);
      if (
        !Array.isArray(outcome.value.artifacts) ||
        outcome.value.artifacts.length !== exportInput.artifacts.length
      ) {
        fail('BACKEND_RESULT_INVALID');
      }
      artifacts = [...outcome.value.artifacts];
      for (let index = 0; index < artifacts.length; index += 1) {
        validateArtifact(artifacts[index]);
        if (
          artifacts[index].ref !== exportInput.artifacts[index].ref ||
          artifacts[index].mediaType !== exportInput.artifacts[index].mediaType
        ) {
          fail('BACKEND_RESULT_INVALID');
        }
      }
      if (artifacts.reduce((total, artifact) => total + artifact.bytes, 0) > exportInput.maxBytes) {
        validationCode = 'RESOURCE_QUOTA_EXCEEDED';
      }
    } catch {
      validationCode = 'BACKEND_RESULT_INVALID';
      artifacts = [];
    }
    const exportResultSha256 =
      safeHash(outcome.value) ?? hashDisposableEnvironmentPayload({ operation, sequence });
    if (validationCode === 'BACKEND_RESULT_INVALID') {
      this.quarantine('ARTIFACT_REVOKE_UNVERIFIED');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'ARTIFACT_REVOKE_UNVERIFIED',
        proof,
        backendResult: outcome.value,
        artifactDisposition: 'revoke-unverified',
        artifactIdentityEvidenceSha256: exportResultSha256,
      });
    }
    if (validationCode === null) {
      const artifactProof = await this.artifactProof(sequence, artifacts, exportInput.artifacts);
      if (Array.isArray(artifactProof)) {
        return this.receipt({
          operation,
          sequence,
          generationBefore: before,
          stateBefore,
          status: 'UNVERIFIED',
          simulatedSuccess: true,
          code: 'ARTIFACTS_EXPORTED',
          proof,
          backendResult: outcome.value,
          artifactProjections: artifactProof,
          artifactDisposition: 'retained',
          artifacts,
        });
      }
      validationCode = artifactProof;
    }
    const revoked = await this.revokeArtifacts(sequence, artifacts, exportResultSha256);
    const code = revoked.disposition === 'revoked' ? validationCode : 'ARTIFACT_REVOKE_UNVERIFIED';
    this.quarantine(code);
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: 'BLOCKED',
      code,
      proof,
      backendResult: outcome.value,
      artifactDisposition: revoked.disposition,
      artifactRevoke: revoked.projection,
      artifacts,
    });
  }

  private async teardownNow(
    sequence: number,
    before: number,
    stateBefore: DisposableEnvironmentState,
  ): Promise<DisposableEnvironmentReceipt> {
    const operation = 'teardown' as const;
    const late = this.lateBlocked(operation, sequence, before, stateBefore);
    if (late !== null) return late;
    if (this.options.teardownReconciler === undefined) {
      return this.proofFailure(
        operation,
        sequence,
        before,
        stateBefore,
        'TEARDOWN_RECONCILER_MISSING',
      );
    }
    const proof = await this.trustedProof(operation, sequence);
    if (typeof proof === 'string') {
      return this.proofFailure(operation, sequence, before, stateBefore, proof);
    }
    const request: BackendTeardownRequest = {
      ...this.baseRequest(proof, operation, sequence),
      operation,
    };
    const outcome = await this.backendCall(sequence, operation, (signal) =>
      this.options.backend.teardown(request, signal),
    );
    if (outcome.kind !== 'result') {
      return this.backendFailure(operation, sequence, before, stateBefore, proof, outcome);
    }
    this.state.generation += 1;
    try {
      assertExactKeys(outcome.value, [
        'environmentId',
        'generation',
        'mountedFilesystems',
        'networkLeases',
        'operationSequence',
        'orphanProcesses',
      ]);
      resultIdentity(outcome.value, this.options.environmentId, sequence, before);
      assertInteger(outcome.value.orphanProcesses, 0);
      assertInteger(outcome.value.mountedFilesystems, 0);
      assertInteger(outcome.value.networkLeases, 0);
    } catch {
      this.quarantine('BACKEND_RESULT_INVALID');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'BACKEND_RESULT_INVALID',
        proof,
        backendResult: outcome.value,
      });
    }
    const backendResultSha256 = hashDisposableEnvironmentPayload(outcome.value);
    const reconciliationInput: TeardownReconciliationProjectionInput = {
      projectionId: `reconcile-${sequence}-${randomUUID()}`,
      reconcilerId: this.host!.reconcilerId,
      reconcilerDigest: this.host!.reconcilerDigest,
      environmentId: this.options.environmentId,
      backendId: this.options.backend.backendId,
      runtimeId: this.options.backend.runtimeId,
      operationSequence: sequence,
      generation: this.state.generation,
      backendResultSha256,
      orphanProcesses: outcome.value.orphanProcesses,
      mountedFilesystems: outcome.value.mountedFilesystems,
      networkLeases: outcome.value.networkLeases,
      reconciledAt: this.now().toISOString(),
    };
    const checked = await this.timed(
      sequence,
      'teardown-reconciler',
      () => this.options.teardownReconciler!(reconciliationInput),
      'TRUST_CALLBACK_TIMEOUT',
    );
    if (checked.kind !== 'result') {
      const code =
        checked.kind === 'timeout'
          ? 'TRUST_CALLBACK_TIMEOUT'
          : 'TEARDOWN_RECONCILIATION_UNVERIFIED';
      this.quarantine(code);
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code,
        proof,
        backendResult: outcome.value,
      });
    }
    let reconciliation: TeardownReconciliationProjection;
    try {
      reconciliation = parseReconciliationProjection(checked.value);
      if (
        reconciliation.reconcilerId !== this.host!.reconcilerId ||
        reconciliation.reconcilerDigest !== this.host!.reconcilerDigest ||
        reconciliation.environmentId !== this.options.environmentId ||
        reconciliation.backendId !== this.options.backend.backendId ||
        reconciliation.runtimeId !== this.options.backend.runtimeId ||
        reconciliation.operationSequence !== sequence ||
        reconciliation.generation !== this.state.generation ||
        reconciliation.backendResultSha256 !== backendResultSha256 ||
        Date.parse(reconciliation.reconciledAt) > this.now().getTime()
      ) {
        fail('TEARDOWN_RECONCILIATION_UNVERIFIED');
      }
    } catch {
      this.quarantine('TEARDOWN_RECONCILIATION_UNVERIFIED');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'TEARDOWN_RECONCILIATION_UNVERIFIED',
        proof,
        backendResult: outcome.value,
      });
    }
    if (
      outcome.value.orphanProcesses !== 0 ||
      outcome.value.mountedFilesystems !== 0 ||
      outcome.value.networkLeases !== 0 ||
      reconciliation.orphanProcesses !== 0 ||
      reconciliation.mountedFilesystems !== 0 ||
      reconciliation.networkLeases !== 0
    ) {
      this.quarantine('TEARDOWN_ORPHANS_REMAIN');
      return this.receipt({
        operation,
        sequence,
        generationBefore: before,
        stateBefore,
        status: 'BLOCKED',
        code: 'TEARDOWN_ORPHANS_REMAIN',
        proof,
        backendResult: outcome.value,
        reconciliation,
      });
    }
    this.state.state = 'TORN_DOWN';
    this.state.runtimeHandle = null;
    this.state.quarantineReason = null;
    for (const record of this.state.snapshots.values()) record.status = 'consumed';
    return this.receipt({
      operation,
      sequence,
      generationBefore: before,
      stateBefore,
      status: 'UNVERIFIED',
      simulatedSuccess: true,
      code: 'TEARDOWN_CONFIRMED',
      proof,
      backendResult: outcome.value,
      reconciliation,
    });
  }

  private receipt(parts: ReceiptParts): DisposableEnvironmentReceipt {
    const code = /^[A-Z0-9_]{1,96}$/.test(parts.code) ? parts.code : 'BACKEND_OPERATION_FAILED';
    const simulatedSuccess = parts.simulatedSuccess === true;
    const base = {
      schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION,
      registryKeySha256: this.registryKeySha256,
      attemptId: `${this.options.environmentId}-${parts.sequence}`,
      environmentId: this.options.environmentId,
      operation: parts.operation,
      operationSequence: parts.sequence,
      generationBefore: parts.generationBefore,
      generationAfter: this.state.generation,
      stateBefore: parts.stateBefore,
      stateAfter: this.state.state,
      status: parts.status,
      authority: this.host === null ? ('none' as const) : DISPOSABLE_LOCAL_TEST_AUTHORITY,
      hostIsolation:
        this.host === null ? ('unverified' as const) : DISPOSABLE_LOCAL_TEST_HOST_ISOLATION,
      productionEligible: false as const,
      code: code as DisposableEnvironmentReceipt['code'],
      negativePaths: simulatedSuccess ? [] : [code],
      issuedAt: this.now().toISOString(),
      backendId: this.options.backend.backendId,
      runtimeId: this.options.backend.runtimeId,
      policySha256: this.options.policy.policySha256,
      workspaceSha256: this.options.workspace.workspaceSha256,
      capabilitySha256: this.options.policy.capabilitySha256,
      challengeSha256: parts.proof?.challenge.challengeSha256 ?? null,
      attestationSha256: parts.proof?.attestation.attestationSha256 ?? null,
      attestationProjectionSha256: parts.proof?.projection.projectionSha256 ?? null,
      backendResultSha256: safeHash(parts.backendResult),
      filesystemProjectionSha256: parts.filesystemProjection?.projectionSha256 ?? null,
      networkProjectionSha256: (parts.networkProjections ?? []).map(
        ({ projectionSha256 }) => projectionSha256,
      ),
      artifactProjectionSha256: (parts.artifactProjections ?? []).map(
        ({ projectionSha256 }) => projectionSha256,
      ),
      artifactRevokeSha256: parts.artifactRevoke?.projectionSha256 ?? null,
      artifactIdentityEvidenceSha256: parts.artifactIdentityEvidenceSha256 ?? null,
      reconciliationSha256: parts.reconciliation?.projectionSha256 ?? null,
      artifactDisposition: parts.artifactDisposition ?? 'none',
      snapshot: parts.snapshot ?? null,
      artifacts: [...(parts.artifacts ?? [])],
      metrics: parts.metrics ?? null,
      limitations:
        this.host === null
          ? ['OS_ISOLATION_UNVERIFIED', 'PRODUCTION_HOST_TRUST_UNAVAILABLE']
          : [
              'LOCAL_TEST_ONLY_NOT_PRODUCTION_EVIDENCE',
              'TEST_SIMULATION_DOES_NOT_PROVE_OS_ISOLATION',
              'PRODUCTION_HOST_TRUST_UNAVAILABLE',
            ],
    };
    return { ...base, receiptSha256: hashDisposableEnvironmentPayload(base) };
  }
}

const SUCCESS_SEMANTICS: Record<
  string,
  {
    operation: DisposableEnvironmentOperation;
    before: DisposableEnvironmentState[];
    after: DisposableEnvironmentState;
  }
> = {
  PROVISIONED: { operation: 'provision', before: ['NEW'], after: 'PROVISIONED' },
  STARTED: { operation: 'start', before: ['PROVISIONED'], after: 'RUNNING' },
  EXECUTED: { operation: 'execute', before: ['RUNNING'], after: 'RUNNING' },
  SNAPSHOT_CREATED: { operation: 'snapshot', before: ['RUNNING'], after: 'RUNNING' },
  SNAPSHOT_RESTORED: { operation: 'restore', before: ['RUNNING'], after: 'RUNNING' },
  ARTIFACTS_EXPORTED: { operation: 'export', before: ['RUNNING'], after: 'RUNNING' },
  TEARDOWN_CONFIRMED: {
    operation: 'teardown',
    before: ['NEW', 'PROVISIONED', 'RUNNING', 'QUARANTINED', 'TORN_DOWN'],
    after: 'TORN_DOWN',
  },
};

const UNVERIFIED_CODES = new Set([
  'HOST_CAPABILITY_INVALID',
  'HOST_CAPABILITY_MISMATCH',
  'OS_ISOLATION_UNVERIFIED',
  'ATTESTATION_PROVIDER_MISSING',
  'ATTESTATION_VERIFIER_MISSING',
  'ATTESTATION_UNVERIFIED',
  'ATTESTATION_REPLAY',
  'ATTESTATION_EXPIRED',
  'FILESYSTEM_PROJECTION_MISSING',
  'FILESYSTEM_PROJECTION_UNVERIFIED',
  'NETWORK_PROJECTION_MISSING',
  'NETWORK_PROJECTION_UNVERIFIED',
  'ARTIFACT_VERIFIER_MISSING',
  'ARTIFACT_REVOKER_MISSING',
  'TEARDOWN_RECONCILER_MISSING',
]);

const PREFLIGHT_FAILURE_CODES = new Set([
  'INVALID_CONTRACT',
  'INVALID_STATE',
  'CAPABILITY_NETWORK_DENIED',
  'CAPABILITY_PROCESS_DENIED',
  'CAPABILITY_SECRET_DENIED',
  'COMMAND_NOT_ALLOWED',
  'ENVIRONMENT_NOT_ALLOWED',
  'SECRET_HANDLE_NOT_ALLOWED',
  'PATH_NOT_CONTAINED',
  'SYMLINK_NOT_ALLOWED',
  'EGRESS_NOT_ALLOWED',
  'EGRESS_PRIVATE_DESTINATION',
  'DNS_REBINDING_DETECTED',
  'MULTI_ADDRESS_DESTINATION_DENIED',
  'SNAPSHOT_EXPIRED',
  'SNAPSHOT_STALE',
  'SNAPSHOT_CROSS_ENVIRONMENT',
  'SNAPSHOT_REPLAY',
  'SNAPSHOT_TAMPERED',
]);

const POST_DISPATCH_BLOCK_CODES = new Set([
  'BACKEND_OPERATION_FAILED',
  'BACKEND_RESULT_INVALID',
  'OPERATION_TIMEOUT',
  'NETWORK_PIN_MISMATCH',
  'RESOURCE_QUOTA_EXCEEDED',
  'ARTIFACT_VERIFICATION_FAILED',
  'ARTIFACT_REVOKE_UNVERIFIED',
  'TEARDOWN_RECONCILIATION_UNVERIFIED',
  'TEARDOWN_ORPHANS_REMAIN',
]);

function assertProofDigest(value: unknown): asserts value is string {
  assertSha(value);
  if (/^0{64}$/.test(value)) fail('INVALID_CONTRACT');
}

function assertOptionalProofDigest(value: unknown): asserts value is string | null {
  if (value !== null) assertProofDigest(value);
}

function assertProofDigestList(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) fail('INVALID_CONTRACT');
  for (const digest of value) assertProofDigest(digest);
  assertUnique(value as string[]);
}

function validateReceiptSnapshot(snapshot: unknown): void {
  assertExactKeys(snapshot, [
    'backendId',
    'capabilitySha256',
    'createdAt',
    'environmentId',
    'expiresAt',
    'generation',
    'operationSequence',
    'policySha256',
    'runtimeId',
    'schemaVersion',
    'snapshotBytes',
    'snapshotId',
    'snapshotMediaType',
    'snapshotRef',
    'snapshotSha256',
    'stateSha256',
    'workspaceSha256',
  ]);
  if (snapshot.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  for (const id of [
    snapshot.backendId,
    snapshot.environmentId,
    snapshot.runtimeId,
    snapshot.snapshotId,
  ]) {
    assertSafeId(id);
  }
  assertRelative(snapshot.snapshotRef);
  if (
    typeof snapshot.snapshotMediaType !== 'string' ||
    !MEDIA_TYPE.test(snapshot.snapshotMediaType)
  ) {
    fail('INVALID_CONTRACT');
  }
  assertInteger(snapshot.snapshotBytes, 0);
  assertInteger(snapshot.generation, 0);
  assertInteger(snapshot.operationSequence, 1);
  for (const digest of [
    snapshot.capabilitySha256,
    snapshot.policySha256,
    snapshot.snapshotSha256,
    snapshot.stateSha256,
    snapshot.workspaceSha256,
  ]) {
    assertProofDigest(digest);
  }
  assertTime(snapshot.createdAt);
  assertTime(snapshot.expiresAt);
  if (Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.createdAt)) fail('INVALID_CONTRACT');
  if (
    hashDisposableEnvironmentPayload(without(snapshot, 'snapshotSha256')) !==
    snapshot.snapshotSha256
  ) {
    fail('INVALID_CONTRACT');
  }
}

function validateReceiptMetrics(metrics: unknown): void {
  assertExactKeys(metrics, [
    'connections',
    'cpuMillis',
    'diskBytes',
    'exitCode',
    'outputBytes',
    'outputSha256',
    'peakMemoryBytes',
    'peakPids',
  ]);
  assertInteger(metrics.exitCode, 0, 255);
  assertInteger(metrics.cpuMillis, 0);
  assertInteger(metrics.diskBytes, 0);
  assertInteger(metrics.outputBytes, 0);
  assertInteger(metrics.peakMemoryBytes, 0);
  assertInteger(metrics.peakPids, 0);
  assertProofDigest(metrics.outputSha256);
  if (!Array.isArray(metrics.connections) || metrics.connections.length > MAX_ITEMS) {
    fail('INVALID_CONTRACT');
  }
  const keys: string[] = [];
  for (const connection of metrics.connections) {
    assertExactKeys(connection, [
      'connectedIp',
      'hostname',
      'pinToken',
      'port',
      'protocol',
      'resolutionSha256',
    ]);
    const destination = normalizeDestination({
      protocol: connection.protocol as EgressDestination['protocol'],
      hostname: connection.hostname as string,
      port: connection.port as number,
    });
    if (typeof connection.connectedIp !== 'string' || !globallyRoutable(connection.connectedIp)) {
      fail('INVALID_CONTRACT');
    }
    assertSafeId(connection.pinToken);
    assertProofDigest(connection.resolutionSha256);
    keys.push(`${endpointKey(destination)}:${connection.connectedIp}:${connection.pinToken}`);
  }
  assertUnique(keys);
}

function validateReceiptFields(
  receipt: DisposableEnvironmentReceipt,
  referenceTimeMs: number,
  maxAgeMs: number,
): void {
  if (receipt.schemaVersion !== DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION) fail('INVALID_CONTRACT');
  for (const id of [
    receipt.attemptId,
    receipt.backendId,
    receipt.environmentId,
    receipt.runtimeId,
  ]) {
    assertSafeId(id);
  }
  if (!operationAllowed(receipt.operation)) fail('INVALID_CONTRACT');
  assertInteger(receipt.operationSequence, 1);
  assertInteger(receipt.generationBefore, 0);
  assertInteger(receipt.generationAfter, 0);
  if (
    !['NEW', 'PROVISIONED', 'RUNNING', 'QUARANTINED', 'TORN_DOWN'].includes(receipt.stateBefore)
  ) {
    fail('INVALID_CONTRACT');
  }
  if (!['NEW', 'PROVISIONED', 'RUNNING', 'QUARANTINED', 'TORN_DOWN'].includes(receipt.stateAfter)) {
    fail('INVALID_CONTRACT');
  }
  if (!['PASS', 'FAIL', 'UNVERIFIED', 'BLOCKED'].includes(receipt.status)) fail('INVALID_CONTRACT');
  if (typeof receipt.code !== 'string' || !/^[A-Z0-9_]{1,96}$/.test(receipt.code)) {
    fail('INVALID_CONTRACT');
  }
  const knownCode =
    SUCCESS_SEMANTICS[receipt.code] !== undefined ||
    UNVERIFIED_CODES.has(receipt.code) ||
    PREFLIGHT_FAILURE_CODES.has(receipt.code) ||
    POST_DISPATCH_BLOCK_CODES.has(receipt.code) ||
    receipt.code === 'COMMAND_EXIT_NONZERO' ||
    receipt.code === 'LATE_OPERATION_PENDING' ||
    receipt.code === 'TRUST_CALLBACK_TIMEOUT' ||
    receipt.code === 'REGISTRY_CAPACITY_EXCEEDED';
  if (!knownCode) fail('INVALID_CONTRACT');
  assertTime(receipt.issuedAt);
  const issuedAtMs = Date.parse(receipt.issuedAt);
  if (issuedAtMs > referenceTimeMs || referenceTimeMs - issuedAtMs > maxAgeMs) {
    fail('INVALID_CONTRACT');
  }
  for (const digest of [
    receipt.registryKeySha256,
    receipt.policySha256,
    receipt.workspaceSha256,
    receipt.capabilitySha256,
    receipt.receiptSha256,
  ]) {
    assertProofDigest(digest);
  }
  for (const digest of [
    receipt.challengeSha256,
    receipt.attestationSha256,
    receipt.attestationProjectionSha256,
    receipt.backendResultSha256,
    receipt.filesystemProjectionSha256,
    receipt.artifactRevokeSha256,
    receipt.artifactIdentityEvidenceSha256,
    receipt.reconciliationSha256,
  ]) {
    assertOptionalProofDigest(digest);
  }
  assertProofDigestList(receipt.networkProjectionSha256);
  assertProofDigestList(receipt.artifactProjectionSha256);
  if (!Array.isArray(receipt.negativePaths) || receipt.negativePaths.length > MAX_ITEMS) {
    fail('INVALID_CONTRACT');
  }
  for (const path of receipt.negativePaths) {
    if (typeof path !== 'string' || !/^[A-Z0-9_]{1,96}$/.test(path)) fail('INVALID_CONTRACT');
  }
  assertUnique(receipt.negativePaths);
  if (
    !Array.isArray(receipt.limitations) ||
    receipt.limitations.length === 0 ||
    receipt.limitations.length > 8
  ) {
    fail('INVALID_CONTRACT');
  }
  for (const limitation of receipt.limitations) {
    if (typeof limitation !== 'string' || !/^[A-Z0-9_]{1,96}$/.test(limitation)) {
      fail('INVALID_CONTRACT');
    }
  }
  assertUnique(receipt.limitations);
  const expectedLimitations =
    receipt.authority === DISPOSABLE_LOCAL_TEST_AUTHORITY
      ? [
          'LOCAL_TEST_ONLY_NOT_PRODUCTION_EVIDENCE',
          'TEST_SIMULATION_DOES_NOT_PROVE_OS_ISOLATION',
          'PRODUCTION_HOST_TRUST_UNAVAILABLE',
        ]
      : ['OS_ISOLATION_UNVERIFIED', 'PRODUCTION_HOST_TRUST_UNAVAILABLE'];
  if (
    receipt.limitations.length !== expectedLimitations.length ||
    receipt.limitations.some((value, index) => value !== expectedLimitations[index])
  ) {
    fail('INVALID_CONTRACT');
  }
  if (!['none', 'retained', 'revoked', 'revoke-unverified'].includes(receipt.artifactDisposition)) {
    fail('INVALID_CONTRACT');
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length > MAX_ITEMS) {
    fail('INVALID_CONTRACT');
  }
  for (const artifact of receipt.artifacts) validateArtifact(artifact);
  assertUnique(receipt.artifacts.map(({ ref }) => ref));
  if (receipt.snapshot !== null) validateReceiptSnapshot(receipt.snapshot);
  if (receipt.metrics !== null) validateReceiptMetrics(receipt.metrics);
}

function validateArtifactDispositionMatrix(receipt: DisposableEnvironmentReceipt): void {
  const artifactCount = receipt.artifacts.length;
  const verificationCount = receipt.artifactProjectionSha256.length;
  const hasRevokeProof = receipt.artifactRevokeSha256 !== null;
  const hasIdentityEvidence = receipt.artifactIdentityEvidenceSha256 !== null;
  const isExport = receipt.operation === 'export';
  const isRetainedSuccess = receipt.code === 'ARTIFACTS_EXPORTED';

  switch (receipt.artifactDisposition) {
    case 'none':
      if (
        artifactCount !== 0 ||
        verificationCount !== 0 ||
        hasRevokeProof ||
        hasIdentityEvidence ||
        isRetainedSuccess ||
        (isExport && receipt.backendResultSha256 !== null)
      ) {
        fail('INVALID_CONTRACT');
      }
      return;
    case 'retained':
      if (
        !isExport ||
        receipt.status !== 'UNVERIFIED' ||
        !isRetainedSuccess ||
        artifactCount === 0 ||
        verificationCount !== artifactCount ||
        hasRevokeProof ||
        hasIdentityEvidence ||
        receipt.backendResultSha256 === null
      ) {
        fail('INVALID_CONTRACT');
      }
      return;
    case 'revoked':
      if (
        !isExport ||
        receipt.status !== 'BLOCKED' ||
        isRetainedSuccess ||
        receipt.code === 'ARTIFACT_REVOKE_UNVERIFIED' ||
        artifactCount === 0 ||
        verificationCount !== 0 ||
        !hasRevokeProof ||
        hasIdentityEvidence ||
        receipt.backendResultSha256 === null
      ) {
        fail('INVALID_CONTRACT');
      }
      return;
    case 'revoke-unverified': {
      const hasRawInventory = artifactCount > 0;
      const hasBoundedUnknownIdentity = artifactCount === 0 && hasIdentityEvidence;
      if (
        !isExport ||
        receipt.status !== 'BLOCKED' ||
        receipt.code !== 'ARTIFACT_REVOKE_UNVERIFIED' ||
        isRetainedSuccess ||
        verificationCount !== 0 ||
        hasRevokeProof ||
        (hasRawInventory && hasIdentityEvidence) ||
        (!hasRawInventory && !hasBoundedUnknownIdentity) ||
        (hasRawInventory && receipt.backendResultSha256 === null)
      ) {
        fail('INVALID_CONTRACT');
      }
      return;
    }
  }
}

function semanticReceipt(receipt: DisposableEnvironmentReceipt): void {
  const localTestAuthority =
    receipt.authority === DISPOSABLE_LOCAL_TEST_AUTHORITY &&
    receipt.hostIsolation === DISPOSABLE_LOCAL_TEST_HOST_ISOLATION;
  const noAuthority = receipt.authority === 'none' && receipt.hostIsolation === 'unverified';
  if (receipt.productionEligible !== false || (!localTestAuthority && !noAuthority)) {
    fail('INVALID_CONTRACT');
  }
  if (receipt.status === 'PASS') fail('INVALID_CONTRACT');
  if (receipt.attemptId !== `${receipt.environmentId}-${receipt.operationSequence}`) {
    fail('INVALID_CONTRACT');
  }
  const delta = receipt.generationAfter - receipt.generationBefore;
  const success = SUCCESS_SEMANTICS[receipt.code];
  if (success !== undefined) {
    if (
      receipt.status !== 'UNVERIFIED' ||
      !localTestAuthority ||
      receipt.negativePaths.length !== 0 ||
      success.operation !== receipt.operation ||
      !success.before.includes(receipt.stateBefore) ||
      success.after !== receipt.stateAfter ||
      delta !== 1 ||
      receipt.backendResultSha256 === null ||
      receipt.challengeSha256 === null ||
      receipt.attestationSha256 === null ||
      receipt.attestationProjectionSha256 === null
    ) {
      fail('INVALID_CONTRACT');
    }
  } else if (receipt.status === 'UNVERIFIED') {
    if (
      !UNVERIFIED_CODES.has(receipt.code) ||
      receipt.negativePaths.length !== 1 ||
      receipt.negativePaths[0] !== receipt.code ||
      receipt.stateAfter !== receipt.stateBefore ||
      delta !== 0 ||
      receipt.backendResultSha256 !== null
    ) {
      fail('INVALID_CONTRACT');
    }
  } else if (receipt.status === 'FAIL') {
    if (receipt.negativePaths.length !== 1 || receipt.negativePaths[0] !== receipt.code) {
      fail('INVALID_CONTRACT');
    }
    if (receipt.code === 'COMMAND_EXIT_NONZERO') {
      if (
        receipt.operation !== 'execute' ||
        receipt.stateBefore !== 'RUNNING' ||
        receipt.stateAfter !== 'RUNNING' ||
        delta !== 1 ||
        receipt.backendResultSha256 === null ||
        receipt.metrics === null
      ) {
        fail('INVALID_CONTRACT');
      }
    } else if (
      !PREFLIGHT_FAILURE_CODES.has(receipt.code) ||
      receipt.stateAfter !== receipt.stateBefore ||
      delta !== 0 ||
      receipt.backendResultSha256 !== null
    ) {
      fail('INVALID_CONTRACT');
    }
  } else {
    if (
      receipt.status !== 'BLOCKED' ||
      receipt.negativePaths.length !== 1 ||
      receipt.negativePaths[0] !== receipt.code
    ) {
      fail('INVALID_CONTRACT');
    }
    if (receipt.code === 'LATE_OPERATION_PENDING' || receipt.code === 'INVALID_STATE') {
      if (delta !== 0 || receipt.stateAfter !== receipt.stateBefore) fail('INVALID_CONTRACT');
    } else if (receipt.code === 'TRUST_CALLBACK_TIMEOUT') {
      if (
        receipt.stateAfter !== 'QUARANTINED' ||
        !(
          (delta === 0 && receipt.backendResultSha256 === null) ||
          (delta === 1 && receipt.backendResultSha256 !== null)
        )
      ) {
        fail('INVALID_CONTRACT');
      }
    } else if (receipt.code === 'REGISTRY_CAPACITY_EXCEEDED') {
      if (delta !== 0 || receipt.stateAfter !== 'QUARANTINED') fail('INVALID_CONTRACT');
    } else if (
      !POST_DISPATCH_BLOCK_CODES.has(receipt.code) ||
      delta !== 1 ||
      receipt.stateAfter !== 'QUARANTINED'
    ) {
      fail('INVALID_CONTRACT');
    }
  }
  if (receipt.code === 'EXECUTED') {
    if (
      receipt.metrics === null ||
      receipt.metrics.exitCode !== 0 ||
      receipt.networkProjectionSha256.length !== receipt.metrics.connections.length
    ) {
      fail('INVALID_CONTRACT');
    }
  }
  if (receipt.code === 'SNAPSHOT_CREATED') {
    const snapshot = receipt.snapshot;
    if (
      snapshot === null ||
      snapshot.environmentId !== receipt.environmentId ||
      snapshot.backendId !== receipt.backendId ||
      snapshot.runtimeId !== receipt.runtimeId ||
      snapshot.policySha256 !== receipt.policySha256 ||
      snapshot.workspaceSha256 !== receipt.workspaceSha256 ||
      snapshot.capabilitySha256 !== receipt.capabilitySha256 ||
      snapshot.operationSequence !== receipt.operationSequence ||
      snapshot.generation !== receipt.generationAfter ||
      Date.parse(snapshot.createdAt) > Date.parse(receipt.issuedAt)
    ) {
      fail('INVALID_CONTRACT');
    }
  }
  if (
    (receipt.metrics !== null || receipt.networkProjectionSha256.length > 0) &&
    receipt.operation !== 'execute'
  ) {
    fail('INVALID_CONTRACT');
  }
  if (receipt.snapshot !== null && receipt.code !== 'SNAPSHOT_CREATED') fail('INVALID_CONTRACT');
  if (receipt.filesystemProjectionSha256 !== null && receipt.operation !== 'provision') {
    fail('INVALID_CONTRACT');
  }
  if (receipt.reconciliationSha256 !== null && receipt.operation !== 'teardown') {
    fail('INVALID_CONTRACT');
  }
  if (receipt.code === 'TEARDOWN_CONFIRMED' && receipt.reconciliationSha256 === null) {
    fail('INVALID_CONTRACT');
  }
  validateArtifactDispositionMatrix(receipt);
}

export interface DisposableEnvironmentReceiptParseOptions {
  now?: Date;
  maxAgeMs?: number;
}

export function parseDisposableEnvironmentReceipt(
  input: unknown,
  options: DisposableEnvironmentReceiptParseOptions = {},
): DisposableEnvironmentReceipt {
  const optionKeys: string[] = [];
  if (Object.prototype.hasOwnProperty.call(options, 'now')) optionKeys.push('now');
  if (Object.prototype.hasOwnProperty.call(options, 'maxAgeMs')) optionKeys.push('maxAgeMs');
  assertExactKeys(options, optionKeys);
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_CONTRACT');
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_RECEIPT_MAX_AGE_MS;
  assertInteger(maxAgeMs, 0, DEFAULT_RECEIPT_MAX_AGE_MS);
  assertExactKeys(input, [
    'artifactDisposition',
    'artifactIdentityEvidenceSha256',
    'artifactProjectionSha256',
    'artifactRevokeSha256',
    'artifacts',
    'attestationProjectionSha256',
    'attestationSha256',
    'attemptId',
    'authority',
    'backendId',
    'backendResultSha256',
    'capabilitySha256',
    'challengeSha256',
    'code',
    'environmentId',
    'filesystemProjectionSha256',
    'generationAfter',
    'generationBefore',
    'hostIsolation',
    'issuedAt',
    'limitations',
    'metrics',
    'negativePaths',
    'networkProjectionSha256',
    'operation',
    'operationSequence',
    'policySha256',
    'productionEligible',
    'receiptSha256',
    'reconciliationSha256',
    'registryKeySha256',
    'runtimeId',
    'schemaVersion',
    'snapshot',
    'stateAfter',
    'stateBefore',
    'status',
    'workspaceSha256',
  ]);
  const receipt = input as unknown as DisposableEnvironmentReceipt;
  validateReceiptFields(receipt, now.getTime(), maxAgeMs);
  const expected = hashDisposableEnvironmentPayload(without(input, 'receiptSha256'));
  if (expected !== receipt.receiptSha256) fail('INVALID_CONTRACT');
  semanticReceipt(receipt);
  return receipt;
}

export interface DisposableEnvironmentProductionEligibility {
  schemaVersion: typeof DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION;
  status: 'UNVERIFIED';
  eligible: false;
  reasonCode: 'LOCAL_TEST_EVIDENCE_NOT_PRODUCTION' | 'PRODUCTION_HOST_TRUST_UNAVAILABLE';
  receiptSha256: string;
}

export function evaluateDisposableEnvironmentProductionEligibility(
  input: unknown,
  options: DisposableEnvironmentReceiptParseOptions = {},
): DisposableEnvironmentProductionEligibility {
  const receipt = parseDisposableEnvironmentReceipt(input, options);
  return {
    schemaVersion: DISPOSABLE_ENVIRONMENT_SCHEMA_VERSION,
    status: 'UNVERIFIED',
    eligible: false,
    reasonCode:
      receipt.authority === DISPOSABLE_LOCAL_TEST_AUTHORITY
        ? 'LOCAL_TEST_EVIDENCE_NOT_PRODUCTION'
        : 'PRODUCTION_HOST_TRUST_UNAVAILABLE',
    receiptSha256: receipt.receiptSha256,
  };
}
