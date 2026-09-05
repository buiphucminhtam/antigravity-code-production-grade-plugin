import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  createEnvironmentAciDescriptor,
  createEnvironmentAction,
  createEnvironmentEvidenceReceipt,
  createEnvironmentSnapshot,
  hashEnvironmentAciPayload,
  type EnvironmentSnapshot,
  type HostEnvironmentCapability,
} from '../environment-aci.js';
import {
  WebEnvironmentAciAdapter,
  type WebEnvironmentDriverPort,
  type WebSemanticState,
} from './web-environment-aci.js';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T00:01:00.000Z';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const descriptor = () =>
  createEnvironmentAciDescriptor({
    adapterId: 'web-adapter',
    environmentId: 'shop',
    sessionId: 'session-one',
    kind: 'web',
    operationTimeoutMs: 100,
    operations: {
      observe: true,
      act: true,
      reset: true,
      snapshot: true,
      restore: true,
      runScenario: true,
      collectEvidence: true,
    },
    actionKinds: ['navigate', 'click', 'fill', 'press', 'scroll'],
    environment: { browser: 'semantic', viewport: { width: 1280, height: 720 } },
  });
const capability = (value = descriptor()): HostEnvironmentCapability => ({
  schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
  enabled: true,
  environmentFingerprint: value.environmentFingerprint,
  capabilityFingerprint: value.capabilityFingerprint,
  operationTimeoutMs: value.operationTimeoutMs,
  operations: value.operations,
  reason: null,
  limitations: [],
});
const request = (sequence: number, actionId = 'action-one') => ({
  schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
  adapterId: 'web-adapter',
  environmentId: 'shop',
  sessionId: 'session-one',
  scenarioId: 'scenario-one',
  executionId: 'execution-one',
  sequence,
  requestedAt: NOW,
  actionId,
});
const sha = (input: string) => createHash('sha256').update(input).digest('hex');
const evidenceRequest = (sequence = 1) => ({
  ...request(sequence),
  actionSha256: sha(`action-${sequence}`),
  observationSha256: sha(`observation-${sequence}`),
});
const reseal = (
  snapshot: EnvironmentSnapshot,
  patch: Record<string, unknown>,
): EnvironmentSnapshot => {
  const value: Record<string, unknown> = { ...snapshot, ...patch };
  delete value.snapshotSha256;
  return {
    ...value,
    snapshotSha256: hashEnvironmentAciPayload(value),
  } as EnvironmentSnapshot;
};

class FakeDriver implements WebEnvironmentDriverPort {
  calls: string[] = [];
  console: Array<{ level: 'debug' | 'info' | 'warn' | 'error'; message: string }> = [];
  throwOn = '';
  readonly artifact: { ref: string; bytes: number; sha256: string; mediaType: string };
  constructor(root: string) {
    fs.writeFileSync(path.join(root, 'screen.json'), '{}');
    this.artifact = {
      ref: 'screen.json',
      bytes: 2,
      sha256: sha('{}'),
      mediaType: 'application/json',
    };
  }
  async launch() {
    this.calls.push('launch');
    if (this.throwOn === 'launch') throw new Error('driver-failed');
  }
  async observe(): Promise<WebSemanticState> {
    this.calls.push('observe');
    if (this.throwOn === 'observe') throw new Error('driver-failed');
    return {
      accessibility: { role: 'main', name: 'Checkout', token: 'redact-me' },
      viewport: { width: 390, height: 844, mobile: true },
      urlPath: '/checkout',
      console: this.console,
      network: [{ method: 'GET', path: '/api/order', status: 200 }],
    };
  }
  async navigate(pathname: string) {
    this.calls.push(`navigate:${pathname}`);
    return { finalUrl: `https://shop.example${pathname}`, resolvedAddresses: ['93.184.216.34'] };
  }
  async click(target: { role: string; name: string }) {
    this.calls.push(`click:${target.role}:${target.name}`);
  }
  async fill(target: { role: string; name: string }, value: string) {
    this.calls.push(`fill:${target.role}:${target.name}:${value}`);
  }
  async press(key: string) {
    this.calls.push(`press:${key}`);
  }
  async scroll(deltaY: number) {
    this.calls.push(`scroll:${deltaY}`);
  }
  async reset() {
    this.calls.push('reset');
    return {
      accessibility: { role: 'main' },
      viewport: { width: 1280, height: 720 },
      console: [],
      network: [],
    };
  }
  async snapshot() {
    this.calls.push('snapshot');
    return {
      ...this.artifact,
      stateSha256: this.artifact.sha256,
      snapshotId: 'snapshot-one',
      expiresAt: LATER,
    };
  }
  async restore() {
    this.calls.push('restore');
    return {
      accessibility: { role: 'main' },
      viewport: { width: 1280, height: 720 },
      console: [],
      network: [],
    };
  }
  async collectEvidence() {
    this.calls.push('evidence');
    if (this.throwOn === 'evidence') throw new Error('adapter-timeout');
    return {
      artifacts: [this.artifact],
      console: this.console,
      network: [{ method: 'GET', path: '/api/order', status: 200 }],
    };
  }
}
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-aci-'));
  dirs.push(root);
  const value = descriptor();
  const driver = new FakeDriver(root);
  return {
    root,
    value,
    driver,
    adapter: new WebEnvironmentAciAdapter({
      descriptor: value,
      driver,
      now: () => NOW,
      hostCapability: capability(value),
      trustedArtifactDirectory: root,
    }),
  };
}

describe('WebEnvironmentAciAdapter', () => {
  it('launches once and seals semantic mobile/desktop observations, action, reset, snapshot and restore', async () => {
    const { adapter, driver } = setup();
    const observed = await adapter.observe({ ...request(1), afterActionId: null });
    expect(observed.state).toMatchObject({
      viewport: { width: 390, height: 844, mobile: true },
    });
    expect(
      Object.values((observed.state as { accessibility: Record<string, unknown> }).accessibility),
    ).toContain('[redacted]');
    expect(
      (
        await adapter.act(
          createEnvironmentAction({
            ...request(2),
            kind: 'click',
            payload: { target: { role: 'button', name: 'Pay' } },
          }),
        )
      ).status,
    ).toBe('PASS');
    expect((await adapter.reset({ ...request(3), reason: 'manual' })).state).toMatchObject({
      viewport: { width: 1280, height: 720 },
    });
    const snapshot = await adapter.snapshot(request(4));
    expect((await adapter.restore(snapshot)).sequence).toBe(5);
    expect(driver.calls.filter((entry) => entry === 'launch')).toHaveLength(1);
  });

  it('denies unsafe navigation, raw selectors, unknown action, and credentials without calling the driver', async () => {
    const { adapter, driver } = setup();
    for (const [sequence, kind, payload] of [
      [1, 'navigate', { path: 'javascript:alert(1)' }],
      [2, 'click', { selector: '#pay' }],
      [3, 'other', {}],
    ] as const) {
      expect(
        (await adapter.act(createEnvironmentAction({ ...request(sequence), kind, payload })))
          .status,
      ).toBe('FAIL');
    }
    expect(() =>
      createEnvironmentAction({
        ...request(4),
        kind: 'fill',
        payload: { target: { role: 'textbox', name: 'Card' }, value: 'x', token: 'no' },
      }),
    ).toThrow();
    expect(
      driver.calls.filter(
        (call) =>
          call.startsWith('click') || call.startsWith('navigate') || call.startsWith('fill'),
      ),
    ).toEqual([]);
  });

  it('returns FAIL for console errors and redacts the semantic evidence digest', async () => {
    const { adapter, driver } = setup();
    driver.console = [{ level: 'error', message: 'cookie=abc' }];
    const action = createEnvironmentAction({
      ...request(1),
      kind: 'press',
      payload: { key: 'Enter' },
    });
    expect((await adapter.act(action)).reason).toBe('web-console-error');
    const observed = await adapter.observe({ ...request(2), afterActionId: action.actionId });
    const receipt = await adapter.collectEvidence({
      ...request(3),
      actionSha256: action.actionSha256,
      observationSha256: observed.observationSha256,
    });
    expect(receipt.status).toBe('FAIL');
    expect(observed.state).toMatchObject({ console: [{ message: '[redacted]' }] });
    expect(receipt.limitations).toEqual([
      `semantic-state:${hashEnvironmentAciPayload({
        accessibility: {},
        viewport: { width: 0, height: 0 },
        console: [{ level: 'error', message: '[redacted]' }],
        network: [{ method: 'GET', path: '/api/order', status: 200 }],
      })}`,
    ]);
  });

  it('sorts semantic keys and preserves colliding attacker keys while neutralizing secrets', async () => {
    const { adapter, driver } = setup();
    const tokenKey = `field-${sha('token').slice(0, 16)}`;
    const values = {
      token: 'raw-token-value',
      password: 'raw-password-value',
      redacted: 'attacker-redacted-value',
      [tokenKey]: 'attacker-collision-value',
      zeta: 'safe-value',
    };
    let reverse = false;
    driver.observe = async () => {
      const entries = Object.entries(values);
      reverse = !reverse;
      return {
        accessibility: Object.fromEntries(reverse ? entries.reverse() : entries),
        viewport: { width: 390, height: 844, mobile: true },
        console: [],
        network: [],
      };
    };
    const first = await adapter.observe({ ...request(1), afterActionId: null });
    const second = await adapter.observe({ ...request(2), afterActionId: null });
    const firstAccessibility = (first.state as { accessibility: Record<string, unknown> })
      .accessibility;
    expect(firstAccessibility).toEqual(
      (second.state as { accessibility: Record<string, unknown> }).accessibility,
    );
    expect(firstAccessibility).not.toHaveProperty('token');
    expect(firstAccessibility).not.toHaveProperty('password');
    expect(firstAccessibility.redacted).toBe('attacker-redacted-value');
    expect(firstAccessibility[tokenKey]).toBe('attacker-collision-value');
    expect(
      Object.values(firstAccessibility).filter((value) => value === '[redacted]'),
    ).toHaveLength(2);
    expect(Object.keys(firstAccessibility)).toHaveLength(5);
  });

  it('validates every direct evidence artifact and cannot pass without an owned validator', async () => {
    const { root, value, adapter, driver } = setup();
    driver.artifact.bytes += 1;
    await expect(adapter.collectEvidence(evidenceRequest(1))).resolves.toMatchObject({
      status: 'UNVERIFIED',
      reason: 'web-evidence-invalid',
      artifacts: [],
    });

    driver.artifact.bytes -= 1;
    driver.collectEvidence = async () => {
      driver.calls.push('evidence');
      return {
        artifacts: [
          driver.artifact,
          {
            ref: 'token.json',
            bytes: 2,
            sha256: sha('{}'),
            mediaType: 'application/json',
          },
        ],
        console: [],
        network: [],
      };
    };
    await expect(adapter.collectEvidence(evidenceRequest(2))).resolves.toMatchObject({
      status: 'UNVERIFIED',
      reason: 'web-evidence-invalid',
      artifacts: [],
    });

    const noRootDriver = new FakeDriver(root);
    const noRoot = new WebEnvironmentAciAdapter({
      descriptor: value,
      driver: noRootDriver,
      now: () => NOW,
    });
    await expect(noRoot.collectEvidence(evidenceRequest(3))).resolves.toMatchObject({
      status: 'UNVERIFIED',
      reason: 'web-artifact-root-missing',
      artifacts: [],
    });
    expect(noRootDriver.calls).toEqual([]);
  });

  it('uses core sealing to reject tampered evidence and unsafe snapshot references', async () => {
    const { adapter, value } = setup();
    const action = createEnvironmentAction({
      ...request(1),
      kind: 'press',
      payload: { key: 'Enter' },
    });
    const observed = await adapter.observe({ ...request(2), afterActionId: action.actionId });
    const receipt = await adapter.collectEvidence({
      ...request(3),
      actionSha256: action.actionSha256,
      observationSha256: observed.observationSha256,
    });
    expect(() =>
      createEnvironmentEvidenceReceipt({
        ...receipt,
        artifacts: [{ ...receipt.artifacts[0], ref: '../escape' }],
      }),
    ).toThrow();
    expect(() =>
      createEnvironmentSnapshot({
        ...request(4),
        snapshotId: 'x',
        snapshotRef: '../x',
        snapshotBytes: 0,
        snapshotMediaType: 'application/json',
        stateSha256: value.environmentFingerprint,
        environmentFingerprint: value.environmentFingerprint,
        createdAt: NOW,
        expiresAt: LATER,
      }),
    ).toThrow();
  });

  it('marks missing capability/driver and driver timeout as UNVERIFIED without leaks', async () => {
    const { root, value, driver } = setup();
    const noDriver = new WebEnvironmentAciAdapter({ descriptor: value, now: () => NOW });
    const scenario = {
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: value.adapterId,
      environmentId: value.environmentId,
      sessionId: value.sessionId,
      scenarioId: 'scenario-one',
      executionId: 'execution-one',
      requestedAt: NOW,
      deadlineAt: LATER,
      steps: [{ actionId: 'step-one', kind: 'press', payload: { key: 'Enter' } }],
    };
    expect((await noDriver.runScenario(scenario)).status).toBe('UNVERIFIED');
    driver.throwOn = 'evidence';
    const adapter = new WebEnvironmentAciAdapter({
      descriptor: value,
      driver,
      now: () => NOW,
      hostCapability: capability(value),
      trustedArtifactDirectory: root,
    });
    const action = createEnvironmentAction({
      ...request(1),
      kind: 'press',
      payload: { key: 'Enter' },
    });
    const observed = await adapter.observe({ ...request(2), afterActionId: action.actionId });
    expect(
      (
        await adapter.collectEvidence({
          ...request(3),
          actionSha256: action.actionSha256,
          observationSha256: observed.observationSha256,
        })
      ).status,
    ).toBe('UNVERIFIED');
    expect(JSON.stringify(driver.calls)).not.toContain('undefined');
  });

  it('rejects foreign identities before any port call and rejects redirect addresses', async () => {
    const { adapter, driver } = setup();
    await expect(
      adapter.observe({ ...request(1), adapterId: 'foreign-adapter', afterActionId: null }),
    ).rejects.toThrow('web-identity-mismatch');
    expect(driver.calls).toEqual([]);
    driver.navigate = async (pathname) => {
      driver.calls.push(`navigate:${pathname}`);
      return { finalUrl: 'https://shop.example/', resolvedAddresses: ['[::1]'] };
    };
    const result = await adapter.act(
      createEnvironmentAction({ ...request(2), kind: 'navigate', payload: { path: '/safe' } }),
    );
    expect(result).toMatchObject({ status: 'FAIL', reason: 'web-navigation-denied' });
  });

  it('normalizes IPv6 addresses and rejects every non-public or unparseable resolution', async () => {
    const blocked = [
      '0.0.0.0',
      '0.1.2.3',
      '10.0.0.1',
      '100.64.0.1',
      '100.127.255.254',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.19.255.254',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '239.255.255.255',
      '240.0.0.1',
      '255.255.255.255',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::127.0.0.1',
      '::10.0.0.1',
      '::169.254.1.1',
      'fe80::1',
      'fe90::1',
      'fea0::1',
      'feb0::1',
      'fe90::1%eth0',
      'fc00::1',
      'fdff::1',
      '::1',
      '::',
      'ff02::1',
      'fec0::1',
      '2001::1',
      '2001:2::1',
      '2001:db8::1',
      '2002:0a00:0001::1',
      '2002:c000:0201::1',
      '3ffe::1',
      '3fff::1',
      '4000::1',
      'not-an-ip',
    ];
    for (const [index, address] of blocked.entries()) {
      const { adapter, driver } = setup();
      driver.navigate = async (pathname) => {
        driver.calls.push(`navigate:${pathname}`);
        return { finalUrl: 'https://shop.example/', resolvedAddresses: [address] };
      };
      expect(
        (
          await adapter.act(
            createEnvironmentAction({
              ...request(index + 1),
              actionId: `blocked-${index}`,
              kind: 'navigate',
              payload: { path: '/safe' },
            }),
          )
        ).reason,
      ).toBe('web-navigation-denied');
    }

    for (const [index, address] of [
      '93.184.216.34',
      '::ffff:93.184.216.34',
      '::93.184.216.34',
      '2002:5db8:d822::1',
      '2606:4700:4700::1111',
    ].entries()) {
      const { adapter, driver } = setup();
      driver.navigate = async (pathname) => {
        driver.calls.push(`navigate:${pathname}`);
        return { finalUrl: 'https://shop.example/', resolvedAddresses: [address] };
      };
      expect(
        (
          await adapter.act(
            createEnvironmentAction({
              ...request(70 + index),
              actionId: `public-${index}`,
              kind: 'navigate',
              payload: { path: '/safe' },
            }),
          )
        ).status,
      ).toBe('PASS');
    }
  });

  it('requires the final URL to retain its allowed origin with public resolutions', async () => {
    const { root, value, driver } = setup();
    const adapter = new WebEnvironmentAciAdapter({
      descriptor: value,
      driver,
      now: () => NOW,
      hostCapability: capability(value),
      trustedArtifactDirectory: root,
      allowedOrigin: 'https://shop.example',
    });
    driver.navigate = async (pathname) => {
      driver.calls.push(`navigate:${pathname}`);
      return {
        finalUrl: 'https://attacker.example/',
        resolvedAddresses: ['2606:4700:4700::1111'],
      };
    };
    expect(
      (
        await adapter.act(
          createEnvironmentAction({
            ...request(1),
            kind: 'navigate',
            payload: { path: '/safe' },
          }),
        )
      ).reason,
    ).toBe('web-navigation-denied');
  });

  it('deep-clones snapshots and rejects every immutable-field mutation before restore', async () => {
    const { root, value, driver, adapter } = setup();
    const snapshot = await adapter.snapshot(request(1));
    const original = JSON.parse(JSON.stringify(snapshot)) as EnvironmentSnapshot;
    const callsBeforeRestore = [...driver.calls];
    const second = new WebEnvironmentAciAdapter({
      descriptor: value,
      driver,
      now: () => NOW,
      hostCapability: capability(value),
      trustedArtifactDirectory: root,
    });
    await expect(second.restore(original)).rejects.toThrow('web-snapshot-invalid');
    expect(driver.calls).toEqual(callsBeforeRestore);

    const mutations: Array<[string, Record<string, unknown>]> = [
      ['adapterId', { adapterId: 'other-adapter' }],
      ['environmentId', { environmentId: 'other-environment' }],
      ['sessionId', { sessionId: 'other-session' }],
      ['scenarioId', { scenarioId: 'other-scenario' }],
      ['executionId', { executionId: 'other-execution' }],
      ['sequence', { sequence: snapshot.sequence + 1 }],
      ['requestedAt', { requestedAt: '2026-09-03T23:59:59.000Z' }],
      ['snapshotId', { snapshotId: 'other-snapshot' }],
      ['snapshotRef', { snapshotRef: 'other.json' }],
      ['snapshotBytes', { snapshotBytes: snapshot.snapshotBytes + 1 }],
      ['snapshotMediaType', { snapshotMediaType: 'application/octet-stream' }],
      ['createdAt', { createdAt: '2026-09-04T00:00:01.000Z' }],
      ['expiresAt', { expiresAt: '2026-09-04T00:02:00.000Z' }],
      ['stateSha256', { stateSha256: sha('other-state') }],
      ['environmentFingerprint', { environmentFingerprint: sha('other-environment') }],
    ];
    for (const [field, patch] of mutations) {
      await expect(adapter.restore(reseal(original, patch)), field).rejects.toThrow();
      expect(driver.calls, field).toEqual(callsBeforeRestore);
    }
    await expect(
      adapter.restore({ ...original, snapshotSha256: sha('tampered-digest') }),
    ).rejects.toThrow();
    await expect(adapter.restore(reseal(original, { snapshotRef: '../escape' }))).rejects.toThrow();
    await expect(
      adapter.restore(reseal(original, { expiresAt: '2026-09-03T23:59:59.000Z' })),
    ).rejects.toThrow();
    expect(driver.calls).toEqual(callsBeforeRestore);

    snapshot.snapshotRef = 'caller-mutated.json';
    await expect(adapter.restore(snapshot)).rejects.toThrow();
    expect(driver.calls).toEqual(callsBeforeRestore);
    await expect(adapter.restore(original)).resolves.toBeDefined();
    expect(driver.calls.filter((call) => call === 'restore')).toHaveLength(1);
    await expect(adapter.restore(original)).rejects.toThrow('web-snapshot-replay');
    expect(driver.calls.filter((call) => call === 'restore')).toHaveLength(1);
  });

  it('rejects expired snapshots before consuming or calling the driver', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-aci-'));
    dirs.push(root);
    const value = descriptor();
    const driver = new FakeDriver(root);
    let currentTime = NOW;
    const adapter = new WebEnvironmentAciAdapter({
      descriptor: value,
      driver,
      now: () => currentTime,
      hostCapability: capability(value),
      trustedArtifactDirectory: root,
    });
    const snapshot = await adapter.snapshot(request(1));
    const callsBeforeRestore = [...driver.calls];
    currentTime = '2026-09-04T00:02:00.000Z';
    await expect(adapter.restore(snapshot)).rejects.toThrow('web-snapshot-invalid');
    expect(driver.calls).toEqual(callsBeforeRestore);
  });

  it('bounds snapshot retention, keeps replay tombstones, and prunes only after expiry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-aci-'));
    dirs.push(root);
    const value = descriptor();
    const driver = new FakeDriver(root);
    let currentTime = NOW;
    let snapshotIndex = 0;
    driver.snapshot = async () => {
      driver.calls.push('snapshot');
      snapshotIndex += 1;
      return {
        ...driver.artifact,
        stateSha256: driver.artifact.sha256,
        snapshotId: `snapshot-${snapshotIndex}`,
        expiresAt: currentTime === NOW ? LATER : '2026-09-04T00:03:00.000Z',
      };
    };
    const adapter = new WebEnvironmentAciAdapter({
      descriptor: value,
      driver,
      now: () => currentTime,
      hostCapability: capability(value),
      trustedArtifactDirectory: root,
    });
    const retained: EnvironmentSnapshot[] = [];
    for (let index = 0; index < 128; index += 1) {
      retained.push(await adapter.snapshot(request(index + 1)));
    }
    await adapter.restore(retained[0]);
    const callsAtCapacity = [...driver.calls];
    await expect(adapter.snapshot(request(129))).rejects.toThrow('web-snapshot-capacity');
    expect(driver.calls).toEqual(callsAtCapacity);
    await expect(adapter.restore(retained[0])).rejects.toThrow('web-snapshot-replay');

    currentTime = LATER;
    await expect(adapter.restore(retained[1])).rejects.toThrow('web-snapshot-invalid');
    await expect(adapter.snapshot(request(130))).resolves.toBeDefined();
  });

  it('runs through the core coordinator with the real trusted artifact validator', async () => {
    const { adapter, value } = setup();
    const receipt = await adapter.runScenario({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: value.adapterId,
      environmentId: value.environmentId,
      sessionId: value.sessionId,
      scenarioId: 'scenario-real-artifact',
      executionId: 'execution-real-artifact',
      requestedAt: NOW,
      deadlineAt: LATER,
      steps: [{ actionId: 'press-one', kind: 'press', payload: { key: 'Enter' } }],
    });
    expect(receipt.status).toBe('PASS');
    expect(receipt.evidence[0]?.artifacts[0]?.ref).toBe('screen.json');
  });
});
