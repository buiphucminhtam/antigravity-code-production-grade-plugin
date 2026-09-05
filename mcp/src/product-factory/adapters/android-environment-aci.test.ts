import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  EnvironmentAction,
  EnvironmentEvidenceArtifact,
  EnvironmentEvidenceRequest,
  EnvironmentSnapshot,
  EnvironmentSnapshotRequest,
  JsonValue,
  clearEnvironmentAciSessionRegistryForTests,
  createEnvironmentAciCoordinator,
  createEnvironmentAction,
  createEnvironmentActionResult,
  createEnvironmentAciDescriptor,
  hashEnvironmentAciPayload,
} from '../environment-aci.js';
import {
  AndroidDevicePort,
  AndroidEnvironmentAciAdapter,
  AndroidFrozenArtifactStore,
  AndroidInspection,
  AndroidPortSnapshot,
  androidEnvironmentCapability,
} from './android-environment-aci.js';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T00:01:00.000Z';
const EXPIRES = '2026-09-04T01:00:00.000Z';

class FakeArtifacts implements AndroidFrozenArtifactStore {
  readonly records = new Map<string, Uint8Array>();
  readonly artifacts: EnvironmentEvidenceArtifact[] = [];
  readonly reads: string[] = [];
  readonly mediaTypeOverrides = new Map<
    Parameters<AndroidFrozenArtifactStore['freeze']>[0]['purpose'],
    string
  >();
  readonly dropAfterFreeze = new Set<
    Parameters<AndroidFrozenArtifactStore['freeze']>[0]['purpose']
  >();
  readonly replaceAfterFreeze = new Set<
    Parameters<AndroidFrozenArtifactStore['freeze']>[0]['purpose']
  >();
  failRead = false;

  async freeze(input: Parameters<AndroidFrozenArtifactStore['freeze']>[0]) {
    const extension = input.mediaType === 'image/png' ? 'png' : 'json';
    const ref = `android/${input.purpose}-${this.artifacts.length}.${extension}`;
    const mediaType = this.mediaTypeOverrides.get(input.purpose) ?? input.mediaType;
    const artifact = {
      ref,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      bytes: input.data.byteLength,
      mediaType,
    };
    this.records.set(ref, Buffer.from(input.data));
    if (this.dropAfterFreeze.has(input.purpose)) this.records.delete(ref);
    if (this.replaceAfterFreeze.has(input.purpose)) {
      this.records.set(ref, Buffer.alloc(input.data.byteLength, 0x78));
    }
    this.artifacts.push(artifact);
    return artifact;
  }

  async read(ref: string) {
    this.reads.push(ref);
    if (this.failRead) throw new Error('raw read failure must not escape');
    const value = this.records.get(ref);
    if (!value) throw new Error('not-found');
    return Buffer.from(value);
  }

  validate = (artifact: EnvironmentEvidenceArtifact): void => {
    const value = this.records.get(artifact.ref);
    if (
      !value ||
      artifact.ref.startsWith('/') ||
      artifact.ref.includes('..') ||
      artifact.bytes !== value.byteLength ||
      artifact.sha256 !== createHash('sha256').update(value).digest('hex')
    )
      throw new Error('untrusted-artifact');
  };
}

class FakePort implements AndroidDevicePort {
  readonly calls: string[] = [];
  fail = false;
  hangOn: string | null = null;
  releaseHang: (() => void) | null = null;
  readonly active = { current: 0, maximum: 0 };
  lastRestored: AndroidPortSnapshot | null = null;
  snapshotExpiresAt = EXPIRES;

  private async complete(name: string): Promise<void> {
    this.calls.push(name);
    this.active.current += 1;
    this.active.maximum = Math.max(this.active.maximum, this.active.current);
    try {
      if (this.hangOn === name)
        await new Promise<void>((resolve) => {
          this.releaseHang = resolve;
        });
      if (this.fail) throw new Error('raw credential=do-not-leak');
    } finally {
      this.active.current -= 1;
    }
  }

  async inspect(): Promise<AndroidInspection> {
    await this.complete('inspect');
    return {
      hierarchy: {
        role: 'window',
        accessibility: { label: 'Checkout', resourceId: 'checkout-root' },
      },
      deviceState: { orientation: 'portrait', apiLevel: 35 },
      appState: { packageName: 'com.example.shop', activity: '.CheckoutActivity' },
    };
  }

  async launchApp() {
    await this.complete('launch');
  }
  async tap() {
    await this.complete('tap');
  }
  async typeText() {
    await this.complete('type');
  }
  async swipe() {
    await this.complete('swipe');
  }
  async pressBack() {
    await this.complete('back');
  }
  async waitForIdle() {
    await this.complete('wait');
  }
  async resetApp() {
    await this.complete('reset');
  }
  async createSnapshot() {
    await this.complete('snapshot');
    return {
      snapshotId: 'android-snapshot-one',
      payload: Buffer.from('frozen'),
      expiresAt: this.snapshotExpiresAt,
    };
  }
  async restoreSnapshot(input: { snapshotId: string; payload: Uint8Array }) {
    await this.complete('restore');
    this.lastRestored = { ...input, expiresAt: EXPIRES };
  }
  async captureScreenshot() {
    await this.complete('screenshot');
    return Buffer.from('png-bytes');
  }
}

function setup(
  overrides: Partial<ConstructorParameters<typeof AndroidEnvironmentAciAdapter>[0]> = {},
) {
  const port = new FakePort();
  const artifacts = new FakeArtifacts();
  const adapter = new AndroidEnvironmentAciAdapter({
    adapterId: 'android-adapter',
    environmentId: 'android-shop',
    sessionId: 'android-session',
    packageName: 'com.example.shop',
    activity: '.CheckoutActivity',
    deviceId: 'pixel-8',
    operationTimeoutMs: 20,
    port,
    artifacts,
    now: () => NOW,
    ...overrides,
  });
  const capability = androidEnvironmentCapability(adapter.descriptor, {
    adbAvailable: true,
    appiumAvailable: true,
    deviceAvailable: true,
    appAvailable: true,
    resetSupported: true,
  }).hostCapability;
  return { adapter, artifacts, capability, port, validator: artifacts.validate };
}

function action(
  adapter: AndroidEnvironmentAciAdapter,
  kind: string,
  payload: JsonValue,
  sequence: number,
): EnvironmentAction {
  return createEnvironmentAction({
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: adapter.descriptor.adapterId,
    environmentId: adapter.descriptor.environmentId,
    sessionId: adapter.descriptor.sessionId,
    scenarioId: 'android-scenario',
    executionId: 'android-execution',
    actionId: `action-${sequence}`,
    sequence,
    requestedAt: NOW,
    kind,
    payload,
  });
}

function snapshotRequest(
  adapter: AndroidEnvironmentAciAdapter,
  overrides: Partial<EnvironmentSnapshotRequest> = {},
): EnvironmentSnapshotRequest {
  return {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: adapter.descriptor.adapterId,
    environmentId: adapter.descriptor.environmentId,
    sessionId: adapter.descriptor.sessionId,
    scenarioId: 'android-scenario',
    executionId: 'android-execution',
    sequence: 3,
    requestedAt: NOW,
    ...overrides,
  };
}

function evidenceRequest(adapter: AndroidEnvironmentAciAdapter): EnvironmentEvidenceRequest {
  return {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: adapter.descriptor.adapterId,
    environmentId: adapter.descriptor.environmentId,
    sessionId: adapter.descriptor.sessionId,
    scenarioId: 'android-scenario',
    executionId: 'android-execution',
    actionId: 'action-1',
    sequence: 1,
    requestedAt: NOW,
    actionSha256: action(adapter, 'tap', { x: 1, y: 2 }, 1).actionSha256,
    observationSha256: 'a'.repeat(64),
  };
}

function rehashSnapshot(
  snapshot: EnvironmentSnapshot,
  patch: Partial<EnvironmentSnapshot>,
): EnvironmentSnapshot {
  const sealed = {
    ...structuredClone(snapshot),
    ...patch,
  };
  const unsigned = Object.fromEntries(
    Object.entries(sealed).filter(([key]) => key !== 'snapshotSha256'),
  ) as Omit<EnvironmentSnapshot, 'snapshotSha256'>;
  return {
    ...unsigned,
    snapshotSha256: hashEnvironmentAciPayload(unsigned),
  };
}

afterEach(() => clearEnvironmentAciSessionRegistryForTests());

describe('Android Environment ACI adapter', () => {
  it('declares android and executes the six bounded, negotiated Android action shapes', async () => {
    const { adapter, port } = setup();
    expect(adapter.descriptor.kind).toBe('android');
    expect(adapter.descriptor.actionKinds).toEqual([
      'back',
      'launch',
      'swipe',
      'tap',
      'type',
      'wait',
    ]);
    const actionCases: Array<[string, JsonValue]> = [
      ['launch', {}],
      ['tap', { x: 10, y: 20 }],
      ['type', { text: 'hello' }],
      ['swipe', { from: { x: 0, y: 1 }, to: { x: 20, y: 30 }, durationMs: 250 }],
      ['back', {}],
      ['wait', { timeoutMs: 10 }],
    ];
    for (const [kind, payload] of actionCases) {
      await expect(adapter.act(action(adapter, kind, payload, 1))).resolves.toMatchObject({
        status: 'PASS',
        reason: null,
      });
    }
    expect(port.calls).toEqual(['launch', 'tap', 'type', 'swipe', 'back', 'wait']);
  });

  it('accepts only relative or package-bound fully-qualified Java activity names', () => {
    for (const activity of [
      '.CheckoutActivity',
      '.checkout.CheckoutActivity',
      'com.example.shop.CheckoutActivity',
      'com.example.shop.checkout.CheckoutActivity',
    ]) {
      expect(() => setup({ activity })).not.toThrow();
    }
    for (const activity of [
      '',
      '.',
      'CheckoutActivity',
      '.checkout..CheckoutActivity',
      '.CheckoutActivity.',
      'com.example.shop..CheckoutActivity',
      'com.example.shop.CheckoutActivity.',
      'com.example.other.CheckoutActivity',
      'com.example.shop',
    ]) {
      expect(() => setup({ activity })).toThrow('android-port-failed');
    }
  });

  it('redacts nested credentials, payment data, private keys, and high-entropy tokens everywhere', async () => {
    const secrets = {
      aws: ['AKIA', '1234567890ABCDEF'].join(''),
      openAi: ['sk', 'abcdefghijklmnopqrstuvwx'].join('-'),
      bearer: ['Bearer', 'aB3dE5fG7hI9jK1mN3pQ5rS7'].join(' '),
      jwt: [
        'eyJhbGciOiJIUzI1NiJ9',
        'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
        'c2lnbmF0dXJlMTIzNDU2Nzg5MA',
      ].join('.'),
      privateKey: ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
      assignment: ['password', 'correct-horse-battery-staple'].join('='),
      payment: ['4111 1111 1111', '1111'].join(' '),
      hex: ['0123456789abcdef', 'fedcba9876543210'].join(''),
      base64: ['QWxhZGRpbjpvcGVu', 'IHNlc2FtZQ=='].join(''),
    };
    const { adapter, artifacts, port } = setup();
    port.inspect = async () => ({
      hierarchy: { level: { aws: secrets.aws, openAi: secrets.openAi } },
      deviceState: { credentials: [secrets.bearer, secrets.jwt, secrets.privateKey] },
      appState: {
        nested: {
          assignment: secrets.assignment,
          payment: secrets.payment,
          hex: secrets.hex,
          base64: secrets.base64,
        },
      },
    });

    const observation = await adapter.observe({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'android-scenario',
      executionId: 'android-execution',
      sequence: 1,
      requestedAt: NOW,
      afterActionId: null,
    });
    const evidence = await adapter.collectEvidence(evidenceRequest(adapter));
    const rawValues = Object.values(secrets);
    const observationLeaks = rawValues.some((secret) =>
      JSON.stringify(observation).includes(secret),
    );
    const artifactLeaks = [...artifacts.records.values()].some((content) =>
      rawValues.some((secret) => Buffer.from(content).toString('utf8').includes(secret)),
    );
    expect(observationLeaks).toBe(false);
    expect(artifactLeaks).toBe(false);
    expect(JSON.stringify(observation)).toContain('[REDACTED]');
    expect(evidence).toMatchObject({ status: 'PASS', reason: null });
  });

  it('replaces normalized sensitive keys deterministically without retaining names or collisions', async () => {
    const sensitiveKeys = [
      ['access', 'Token'].join(''),
      ['password', 'Hash'].join(''),
      ['card', 'Number'].join(''),
      ['private', 'Key'].join(''),
      ['access', '_token'].join(''),
      ['private', '-key'].join(''),
      ['0123456789abcdef', 'fedcba9876543210'].join(''),
    ];
    const collisionBase = `field-${createHash('sha256')
      .update(sensitiveKeys[0])
      .digest('hex')
      .slice(0, 16)}`;
    const entries: Array<[string, JsonValue]> = [
      [collisionBase, 'reserved-safe-value'],
      ['visibleLabel', 'Checkout'],
      ['note', [['password', 'Hash'].join(''), 'x'].join('=')],
      ...sensitiveKeys.map((key) => [key, 'x'] as [string, JsonValue]),
    ];
    const sanitized: JsonValue[] = [];
    for (const orderedEntries of [entries, [...entries].reverse()]) {
      const { adapter, port } = setup();
      port.inspect = async () => ({
        hierarchy: Object.fromEntries(orderedEntries),
        deviceState: {},
        appState: {},
      });
      const observation = await adapter.observe({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'android-adapter',
        environmentId: 'android-shop',
        sessionId: 'android-session',
        scenarioId: 'android-scenario',
        executionId: 'android-execution',
        sequence: 1,
        requestedAt: NOW,
        afterActionId: null,
      });
      sanitized.push((observation.state as Record<string, JsonValue>).uiHierarchy);
    }
    const first = sanitized[0] as Record<string, JsonValue>;
    expect(sanitized[1]).toEqual(first);
    expect(sensitiveKeys.some((key) => JSON.stringify(first).includes(key))).toBe(false);
    expect(
      Object.entries(first).filter(
        ([key, value]) => /^field-[a-f0-9]{16}(?:-\d+)?$/.test(key) && value === '[REDACTED]',
      ),
    ).toHaveLength(sensitiveKeys.length);
    expect(first).toMatchObject({
      [collisionBase]: 'reserved-safe-value',
      [`${collisionBase}-1`]: '[REDACTED]',
      note: '[REDACTED]',
      visibleLabel: 'Checkout',
    });
  });

  it('rejects sensitive, control, shell, and script text without invoking or leaking to the port', async () => {
    const unsafeTexts = [
      ['AKIA', '1234567890ABCDEF'].join(''),
      ['sk', 'abcdefghijklmnopqrstuvwx'].join('-'),
      ['Bearer', 'aB3dE5fG7hI9jK1mN3pQ5rS7'].join(' '),
      ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlMTIzNDU2Nzg5MA'].join(
        '.',
      ),
      ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
      ['token', 'aB3dE5fG7hI9jK1mN3pQ5rS7'].join('='),
      ['4111 1111 1111', '1111'].join(' '),
      ['0123456789abcdef', 'fedcba9876543210'].join(''),
      ['QWxhZGRpbjpvcGVu', 'IHNlc2FtZQ=='].join(''),
      ['line one', 'line two'].join('\n'),
      'hello; whoami',
      ['<scr', 'ipt>alert(1)</scr', 'ipt>'].join(''),
      ['java', 'script:alert(1)'].join(''),
      ['onerror', 'alert(1)'].join('='),
      [['password', 'Hash'].join(''), 'x'].join('='),
      [['access', '_token'].join(''), 'x'].join('='),
      [['private', '-key'].join(''), 'x'].join('='),
      [['card', 'Number'].join(''), 'x'].join('='),
    ];
    const { adapter, port } = setup();
    const outcomes: string[] = [];
    for (const [index, text] of unsafeTexts.entries()) {
      try {
        const result = await adapter.act(action(adapter, 'type', { text }, index + 1));
        outcomes.push(result.status);
      } catch (error) {
        outcomes.push(error instanceof Error ? error.message : 'non-error');
      }
    }
    expect(outcomes).toEqual(unsafeTexts.map(() => 'android-port-failed'));
    expect(port.calls).toEqual([]);
    expect(unsafeTexts.some((secret) => JSON.stringify(outcomes).includes(secret))).toBe(false);
  });

  it('binds every frozen artifact to the exact media type requested by its purpose', async () => {
    for (const purpose of ['hierarchy', 'state', 'screenshot'] as const) {
      const { adapter, artifacts } = setup();
      artifacts.mediaTypeOverrides.set(purpose, 'text/plain');
      await expect(adapter.collectEvidence(evidenceRequest(adapter))).resolves.toMatchObject({
        status: 'FAIL',
        reason: 'android-snapshot-invalid',
        artifacts: [],
      });
    }
    const { adapter, artifacts } = setup();
    artifacts.mediaTypeOverrides.set('snapshot', 'text/plain');
    await expect(adapter.snapshot(snapshotRequest(adapter))).rejects.toThrow(
      'android-snapshot-invalid',
    );
  });

  it('reads every frozen artifact back immediately and fails closed on missing or replaced bytes', async () => {
    const valid = setup();
    await expect(
      valid.adapter.collectEvidence(evidenceRequest(valid.adapter)),
    ).resolves.toMatchObject({
      status: 'PASS',
    });
    expect(valid.artifacts.reads).toHaveLength(3);

    const missing = setup();
    missing.artifacts.dropAfterFreeze.add('hierarchy');
    await expect(
      missing.adapter.collectEvidence(evidenceRequest(missing.adapter)),
    ).resolves.toMatchObject({
      status: 'FAIL',
      reason: 'android-snapshot-invalid',
      artifacts: [],
    });

    const replaced = setup();
    replaced.artifacts.replaceAfterFreeze.add('state');
    await expect(
      replaced.adapter.collectEvidence(evidenceRequest(replaced.adapter)),
    ).resolves.toMatchObject({
      status: 'FAIL',
      reason: 'android-snapshot-invalid',
      artifacts: [],
    });

    const snapshot = setup();
    snapshot.artifacts.dropAfterFreeze.add('snapshot');
    await expect(snapshot.adapter.snapshot(snapshotRequest(snapshot.adapter))).rejects.toThrow(
      'android-snapshot-invalid',
    );
  });

  it('deep-isolates snapshots and rejects caller mutation before any store or port call', async () => {
    const { adapter, artifacts, port } = setup();
    const returned = await adapter.snapshot(snapshotRequest(adapter));
    const canonical = structuredClone(returned);
    returned.snapshotId = 'caller-mutated-snapshot';
    port.calls.length = 0;
    artifacts.reads.length = 0;
    await expect(adapter.restore(returned)).rejects.toThrow('android-snapshot-invalid');
    expect(port.calls).toEqual([]);
    expect(artifacts.reads).toEqual([]);

    await expect(adapter.restore(canonical)).resolves.toMatchObject({
      state: { restoredSnapshot: 'android-snapshot-one' },
    });
  });

  it('rejects every rehashed immutable snapshot-field mutation without I/O', async () => {
    const { adapter, artifacts, port } = setup();
    const snapshot = await adapter.snapshot(snapshotRequest(adapter));
    const mutations: Array<Partial<EnvironmentSnapshot>> = [
      { adapterId: 'other-adapter' },
      { environmentId: 'other-environment' },
      { sessionId: 'other-session' },
      { scenarioId: 'other-scenario' },
      { executionId: 'other-execution' },
      { sequence: snapshot.sequence + 1 },
      { requestedAt: '2026-09-03T23:59:59.000Z' },
      { snapshotId: 'other-snapshot' },
      { snapshotRef: 'android/other-snapshot.json' },
      { snapshotBytes: snapshot.snapshotBytes + 1 },
      { snapshotMediaType: 'text/plain' },
      { createdAt: '2026-09-04T00:00:01.000Z' },
      { expiresAt: '2026-09-04T02:00:00.000Z' },
      { stateSha256: 'b'.repeat(64) },
      { environmentFingerprint: 'c'.repeat(64) },
    ];
    port.calls.length = 0;
    artifacts.reads.length = 0;
    const outcomes: string[] = [];
    for (const mutation of mutations) {
      try {
        await adapter.restore(rehashSnapshot(snapshot, mutation));
        outcomes.push('accepted');
      } catch (error) {
        outcomes.push(error instanceof Error ? error.message : 'non-error');
      }
    }
    expect(outcomes).toEqual(mutations.map(() => 'android-snapshot-invalid'));
    expect(port.calls).toEqual([]);
    expect(artifacts.reads).toEqual([]);
  });

  it('rejects direct replay, expiry, and cross-instance restore before I/O', async () => {
    const valid = setup();
    const snapshot = await valid.adapter.snapshot(snapshotRequest(valid.adapter));
    await valid.adapter.restore(snapshot);
    valid.port.calls.length = 0;
    valid.artifacts.reads.length = 0;
    await expect(valid.adapter.restore(snapshot)).rejects.toThrow('android-snapshot-invalid');
    expect(valid.port.calls).toEqual([]);
    expect(valid.artifacts.reads).toEqual([]);

    let clock = NOW;
    const expired = setup({ now: () => clock });
    const expiredSnapshot = await expired.adapter.snapshot(snapshotRequest(expired.adapter));
    clock = '2026-09-04T02:00:00.000Z';
    expired.port.calls.length = 0;
    expired.artifacts.reads.length = 0;
    await expect(expired.adapter.restore(expiredSnapshot)).rejects.toThrow(
      'android-snapshot-invalid',
    );
    expect(expired.port.calls).toEqual([]);
    expect(expired.artifacts.reads).toEqual([]);

    const foreignPort = new FakePort();
    const foreignAdapter = new AndroidEnvironmentAciAdapter({
      adapterId: valid.adapter.descriptor.adapterId,
      environmentId: valid.adapter.descriptor.environmentId,
      sessionId: valid.adapter.descriptor.sessionId,
      packageName: 'com.example.shop',
      activity: '.CheckoutActivity',
      deviceId: 'pixel-8',
      operationTimeoutMs: 20,
      port: foreignPort,
      artifacts: valid.artifacts,
      now: () => NOW,
    });
    valid.artifacts.reads.length = 0;
    await expect(foreignAdapter.restore(snapshot)).rejects.toThrow('android-snapshot-invalid');
    expect(foreignPort.calls).toEqual([]);
    expect(valid.artifacts.reads).toEqual([]);
  });

  it('consumes a snapshot before the first artifact-store call', async () => {
    const { adapter, artifacts, port } = setup();
    const snapshot = await adapter.snapshot(snapshotRequest(adapter));
    artifacts.failRead = true;
    port.calls.length = 0;
    artifacts.reads.length = 0;
    await expect(adapter.restore(snapshot)).rejects.toThrow('android-port-failed');
    expect(artifacts.reads).toEqual([snapshot.snapshotRef]);
    expect(port.calls).toEqual([]);

    artifacts.failRead = false;
    artifacts.reads.length = 0;
    await expect(adapter.restore(snapshot)).rejects.toThrow('android-snapshot-invalid');
    expect(artifacts.reads).toEqual([]);
    expect(port.calls).toEqual([]);
  });

  it('bounds the snapshot registry, retains consumed entries, and prunes only at expiry', async () => {
    let clock = NOW;
    const { adapter, artifacts, port } = setup({ now: () => clock });
    const first = await adapter.snapshot(snapshotRequest(adapter, { sequence: 0 }));
    await adapter.restore(first);
    for (let sequence = 1; sequence < 128; sequence += 1) {
      await adapter.snapshot(snapshotRequest(adapter, { sequence }));
    }
    const artifactCount = artifacts.artifacts.length;
    port.calls.length = 0;
    artifacts.reads.length = 0;
    await expect(adapter.snapshot(snapshotRequest(adapter, { sequence: 128 }))).rejects.toThrow(
      'android-snapshot-invalid',
    );
    expect(port.calls).toEqual([]);
    expect(artifacts.reads).toEqual([]);
    expect(artifacts.artifacts).toHaveLength(artifactCount);

    clock = '2026-09-04T02:00:00.000Z';
    port.snapshotExpiresAt = '2026-09-04T03:00:00.000Z';
    await expect(
      adapter.snapshot(snapshotRequest(adapter, { sequence: 129 })),
    ).resolves.toMatchObject({ sequence: 129 });

    const expiring = setup({ now: () => clock });
    expiring.port.snapshotExpiresAt = '2026-09-04T03:00:00.000Z';
    const expiringSnapshot = await expiring.adapter.snapshot(snapshotRequest(expiring.adapter));
    clock = '2026-09-04T04:00:00.000Z';
    await expect(expiring.adapter.restore(expiringSnapshot)).rejects.toThrow(
      'android-snapshot-invalid',
    );
    const registry = (
      expiring.adapter as unknown as {
        snapshots: Map<string, unknown>;
      }
    ).snapshots;
    expect(registry.size).toBe(0);
  });

  it('seals all seven operations with hierarchy/device/app state, frozen snapshots, and screenshot evidence', async () => {
    const { adapter, artifacts, capability, port } = setup();
    const observe = await adapter.observe({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'android-scenario',
      executionId: 'android-execution',
      sequence: 1,
      requestedAt: NOW,
      afterActionId: null,
    });
    expect(observe.state).toMatchObject({
      uiHierarchy: { accessibility: { label: 'Checkout' } },
      device: { apiLevel: 35 },
    });
    await adapter.reset({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'android-scenario',
      executionId: 'android-execution',
      sequence: 2,
      requestedAt: NOW,
      reason: 'manual',
    });
    const snapshot = await adapter.snapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'android-scenario',
      executionId: 'android-execution',
      sequence: 3,
      requestedAt: NOW,
    });
    await adapter.restore(snapshot);
    const evidence = await adapter.collectEvidence({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'android-scenario',
      executionId: 'android-execution',
      actionId: 'action-3',
      sequence: 5,
      requestedAt: NOW,
      actionSha256: action(adapter, 'tap', { x: 1, y: 2 }, 5).actionSha256,
      observationSha256: observe.observationSha256,
    });
    expect(evidence).toMatchObject({
      status: 'PASS',
      artifacts: [
        { mediaType: 'application/json' },
        { mediaType: 'application/json' },
        { mediaType: 'image/png' },
      ],
    });
    expect(evidence.artifacts.every((artifact) => artifacts.records.has(artifact.ref))).toBe(true);
    expect(snapshot.stateSha256).toBe(
      createHash('sha256')
        .update(await artifacts.read(snapshot.snapshotRef))
        .digest('hex'),
    );
    expect(port.lastRestored?.snapshotId).toBe('android-snapshot-one');

    const coordinator = createEnvironmentAciCoordinator(adapter, capability, {
      artifactValidator: artifacts.validate,
      now: () => NOW,
    });
    const coreSnapshot = await coordinator.snapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'fresh-scenario',
      executionId: 'fresh-execution',
      sequence: 1,
      requestedAt: NOW,
    });
    await coordinator.restore(coreSnapshot);
    await expect(coordinator.restore(coreSnapshot)).rejects.toThrow('replay');
  });

  it('uses the approved coordinator for a scenario only with explicit host capability and artifact validation', async () => {
    const { adapter } = setup();
    const unverified = await adapter.runScenario({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'android-scenario',
      executionId: 'android-execution',
      requestedAt: NOW,
      deadlineAt: LATER,
      steps: [{ actionId: 'tap-checkout', kind: 'tap', payload: { x: 20, y: 30 } }],
    });
    expect(unverified).toMatchObject({ status: 'UNVERIFIED', reason: 'host-capability-missing' });
    clearEnvironmentAciSessionRegistryForTests();
    const verifiedParts = setup();
    const verified = new AndroidEnvironmentAciAdapter({
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      packageName: 'com.example.shop',
      activity: '.CheckoutActivity',
      deviceId: 'pixel-8',
      operationTimeoutMs: 20,
      port: verifiedParts.port,
      artifacts: verifiedParts.artifacts,
      now: () => NOW,
      hostCapability: androidEnvironmentCapability(verifiedParts.adapter.descriptor, {
        adbAvailable: true,
        appiumAvailable: true,
        deviceAvailable: true,
        appAvailable: true,
        resetSupported: true,
      }).hostCapability,
      artifactValidator: verifiedParts.validator,
    });
    await expect(
      verified.runScenario({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'android-adapter',
        environmentId: 'android-shop',
        sessionId: 'android-session',
        scenarioId: 'android-scenario',
        executionId: 'android-execution',
        requestedAt: NOW,
        deadlineAt: LATER,
        steps: [{ actionId: 'tap-checkout', kind: 'tap', payload: { x: 20, y: 30 } }],
      }),
    ).resolves.toMatchObject({ status: 'PASS' });
  });

  it('reports missing Android host support as disabled and unverified', () => {
    const { adapter } = setup();
    const report = androidEnvironmentCapability(adapter.descriptor, { deviceAvailable: true });
    expect(report).toMatchObject({
      status: 'UNVERIFIED',
      hostCapability: { enabled: false, reason: 'android-capability-unverified' },
    });
    expect(report.hostCapability.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('adbAvailable'),
        expect.stringContaining('appiumAvailable'),
        expect.stringContaining('resetSupported'),
      ]),
    );
  });

  it('parses capability descriptors and never enables Android for a different environment kind', () => {
    const { adapter } = setup();
    const webDescriptor = createEnvironmentAciDescriptor({
      adapterId: 'web-adapter',
      environmentId: 'web-environment',
      sessionId: 'web-session',
      kind: 'web',
      operationTimeoutMs: adapter.descriptor.operationTimeoutMs,
      operations: adapter.descriptor.operations,
      actionKinds: ['navigate'],
      environment: { platform: 'web' },
    });
    const available = {
      adbAvailable: true,
      appiumAvailable: true,
      deviceAvailable: true,
      appAvailable: true,
      resetSupported: true,
    };
    expect(androidEnvironmentCapability(webDescriptor, available)).toMatchObject({
      status: 'UNVERIFIED',
      hostCapability: {
        enabled: false,
        reason: 'android-capability-unverified',
      },
    });
    const tampered = { ...adapter.descriptor, kind: 'web' } as unknown as typeof adapter.descriptor;
    expect(() => androidEnvironmentCapability(tampered, available)).toThrow('android-port-failed');
  });

  it('rejects iOS-like metadata and unsafe package, action, coordinates, and artifact refs before use', async () => {
    expect(() => setup({ packageName: 'com.example.shop;rm' })).toThrow('android-port-failed');
    const iosParts = setup();
    expect(
      () =>
        new AndroidEnvironmentAciAdapter({
          adapterId: 'android-adapter',
          environmentId: 'android-shop',
          sessionId: 'android-session',
          packageName: 'com.example.shop',
          deviceId: 'pixel-8',
          operationTimeoutMs: 20,
          port: iosParts.port,
          artifacts: iosParts.artifacts,
          platform: 'ios' as never,
        }),
    ).toThrow('android-port-failed');
    const { adapter, artifacts } = setup();
    await expect(adapter.act(action(adapter, 'tap', { x: -1, y: 2 }, 1))).resolves.toMatchObject({
      status: 'FAIL',
      reason: 'android-port-failed',
    });
    await expect(
      adapter.act(action(adapter, 'launch', { packageName: 'com.evil' }, 1)),
    ).resolves.toMatchObject({ status: 'FAIL', reason: 'android-port-failed' });
    artifacts.freeze = async () => ({
      ref: '../escape',
      sha256: '0'.repeat(64),
      bytes: 0,
      mediaType: 'application/json',
    });
    await expect(
      adapter.collectEvidence({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'android-adapter',
        environmentId: 'android-shop',
        sessionId: 'android-session',
        scenarioId: 'android-scenario',
        executionId: 'android-execution',
        actionId: 'action-1',
        sequence: 1,
        requestedAt: NOW,
        actionSha256: action(adapter, 'tap', { x: 1, y: 2 }, 1).actionSha256,
        observationSha256: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({ status: 'FAIL', reason: 'android-snapshot-invalid' });
  });

  it('converts port throws and timeouts to stable, secret-free action failures', async () => {
    const failed = setup();
    failed.port.fail = true;
    const failure = await failed.adapter.act(action(failed.adapter, 'tap', { x: 1, y: 2 }, 1));
    expect(JSON.stringify(failure)).not.toContain('credential');
    expect(failure).toMatchObject({
      status: 'FAIL',
      reason: 'android-port-failed',
      negativePaths: ['android-port-failed'],
    });
    const timedOut = setup();
    timedOut.port.hangOn = 'wait';
    const receipt = await createEnvironmentAciCoordinator(timedOut.adapter, timedOut.capability, {
      artifactValidator: timedOut.validator,
      now: () => NOW,
    }).runScenario({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'timeout-scenario',
      executionId: 'timeout-execution',
      requestedAt: NOW,
      deadlineAt: LATER,
      steps: [{ actionId: 'wait-one', kind: 'wait', payload: { timeoutMs: 1 } }],
    });
    expect(receipt).toMatchObject({
      status: 'FAIL',
      negativePaths: expect.arrayContaining(['adapter-operation-timeout']),
    });
    timedOut.port.releaseHang?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timedOut.port.active.maximum).toBe(1);
  });

  it('lets the core reject a sealed result that is not bound to its requested action', async () => {
    const { adapter, capability, validator } = setup();
    adapter.act = async (requested) => {
      const actionInput = Object.fromEntries(
        Object.entries(requested).filter(([key]) => key !== 'actionSha256'),
      ) as Omit<EnvironmentAction, 'actionSha256'>;
      const differentAction = createEnvironmentAction({
        ...actionInput,
        actionId: 'different-action',
      });
      return createEnvironmentActionResult({
        ...differentAction,
        completedAt: NOW,
        status: 'PASS',
        reason: null,
        negativePaths: [],
        limitations: [],
        environmentFingerprint: adapter.descriptor.environmentFingerprint,
      });
    };
    const receipt = await createEnvironmentAciCoordinator(adapter, capability, {
      artifactValidator: validator,
      now: () => NOW,
    }).runScenario({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'android-adapter',
      environmentId: 'android-shop',
      sessionId: 'android-session',
      scenarioId: 'android-scenario',
      executionId: 'android-execution',
      requestedAt: NOW,
      deadlineAt: LATER,
      steps: [{ actionId: 'requested-action', kind: 'tap', payload: { x: 20, y: 30 } }],
    });
    expect(receipt).toMatchObject({
      status: 'FAIL',
      reason: 'adapter-receipt-invalid',
      negativePaths: ['adapter-receipt-mismatch'],
    });
  });
});
