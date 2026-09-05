import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  createEnvironmentAciDescriptor,
  createEnvironmentAction,
  type EnvironmentObserveRequest,
  type EnvironmentResetRequest,
  type EnvironmentScenario,
  type EnvironmentSnapshotRequest,
} from '../environment-aci.js';
import {
  UNITY_ENVIRONMENT_ACTION_KINDS,
  createUnityEnvironmentAciAdapter,
  createUnityHostCapability,
  type UnityGameArtifact,
  type UnityGamePort,
  type UnityGameSnapshot,
  type UnityGameState,
} from './unity-environment-aci.js';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T01:00:00.000Z';
const EVEN_LATER = '2026-09-04T02:00:00.000Z';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const ARTIFACT_CONTENT = 'data';

class FakeUnityPort implements UnityGamePort {
  readonly capabilities: UnityGamePort['capabilities'] = {
    unityAvailable: true,
    bridgeAvailable: true,
    buildId: 'build-1',
    resetAvailable: true,
    deterministicStepAvailable: true,
  };
  state: UnityGameState = { sceneId: 'main', clockTicks: 0, frameId: 0, state: { lives: 3 } };
  throwOn: 'reset' | 'step' | 'snapshot' | 'artifacts' | null = null;
  stepClockOffset = 0;
  inputSceneId: string | null = null;
  delayResetMs = 0;
  inFlight = 0;
  sessionId = 'session-1';
  calls = 0;
  returnAlias = false;
  snapshotExpiresAt = LATER;
  private snapshotGate: Promise<void> | null = null;
  private releaseSnapshotGate: (() => void) | null = null;

  holdSnapshots(): void {
    this.snapshotGate = new Promise((resolve) => {
      this.releaseSnapshotGate = resolve;
    });
  }

  releaseSnapshots(): void {
    this.releaseSnapshotGate?.();
    this.releaseSnapshotGate = null;
    this.snapshotGate = null;
  }

  async reset(): Promise<UnityGameState> {
    this.calls += 1;
    this.inFlight += 1;
    try {
      if (this.throwOn === 'reset') throw new Error('reset failed');
      if (this.delayResetMs > 0) {
        const delayMs = this.delayResetMs;
        this.delayResetMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      this.state = { sceneId: 'main', clockTicks: 0, frameId: 0, state: { lives: 3 } };
      return this.copy();
    } finally {
      this.inFlight -= 1;
    }
  }

  async stepTime(ticks: number): Promise<UnityGameState> {
    this.calls += 1;
    if (this.throwOn === 'step') throw new Error('step failed');
    this.state = {
      ...this.state,
      clockTicks: this.state.clockTicks + ticks + this.stepClockOffset,
      frameId: this.state.frameId + 1,
    };
    return this.copy();
  }

  async input(controlId: string, pressed: boolean): Promise<UnityGameState> {
    this.calls += 1;
    this.state = {
      ...this.state,
      sceneId: this.inputSceneId ?? this.state.sceneId,
      frameId: this.state.frameId + 1,
      state: { ...(this.state.state as object), controlId, pressed },
    };
    return this.copy();
  }

  async inspectState(): Promise<UnityGameState> {
    this.calls += 1;
    return this.copy();
  }

  async loadScene(sceneId: string): Promise<UnityGameState> {
    this.calls += 1;
    this.state = { sceneId, clockTicks: 0, frameId: this.state.frameId + 1, state: { lives: 3 } };
    return this.copy();
  }

  async snapshot(): Promise<UnityGameSnapshot> {
    this.calls += 1;
    if (this.throwOn === 'snapshot') throw new Error('snapshot failed with raw-secret');
    if (this.snapshotGate) await this.snapshotGate;
    return {
      snapshotId: 'snapshot-1',
      buildId: 'build-1',
      sceneId: this.state.sceneId,
      sessionId: this.sessionId,
      state: this.copy(),
      artifact: artifact('state', 'snapshots/state.json', 'application/json'),
      expiresAt: this.snapshotExpiresAt,
    };
  }

  async restore(snapshot: UnityGameSnapshot): Promise<UnityGameState> {
    this.calls += 1;
    this.state = structuredClone(snapshot.state);
    return this.copy();
  }

  async collectArtifacts(): Promise<readonly UnityGameArtifact[]> {
    this.calls += 1;
    if (this.throwOn === 'artifacts') throw new Error('artifact failed');
    return [
      artifact('frame', 'evidence/frame.png', 'image/png'),
      artifact('video', 'evidence/replay.mp4', 'video/mp4'),
      artifact('state', 'evidence/state.json', 'application/json'),
    ];
  }

  private copy(): UnityGameState {
    return this.returnAlias ? this.state : structuredClone(this.state);
  }
}

function artifact(
  kind: UnityGameArtifact['kind'],
  ref: string,
  mediaType: string,
): UnityGameArtifact {
  return { kind, ref, mediaType, bytes: 4, sha256: digest(ARTIFACT_CONTENT) };
}

let nextSession = 1;

function makeAdapter(port = new FakeUnityPort(), sessionId = `session-${nextSession++}`) {
  port.sessionId = sessionId;
  let currentNow = NOW;
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'unity-aci-'));
  for (const ref of [
    'snapshots/state.json',
    'evidence/frame.png',
    'evidence/replay.mp4',
    'evidence/state.json',
  ]) {
    mkdirSync(join(artifactDirectory, ref, '..'), { recursive: true });
    writeFileSync(join(artifactDirectory, ref), ARTIFACT_CONTENT);
  }
  const adapter = createUnityEnvironmentAciAdapter({
    adapterId: 'unity-adapter',
    environmentId: 'unity-env',
    sessionId,
    buildId: 'build-1',
    port,
    operationTimeoutMs: 20,
    now: () => currentNow,
    trustedArtifactDirectory: artifactDirectory,
  });
  return { adapter, port, setNow: (value: string) => (currentNow = value) };
}

function identity(adapter: ReturnType<typeof createUnityEnvironmentAciAdapter>, sequence: number) {
  return {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: adapter.descriptor.adapterId,
    environmentId: adapter.descriptor.environmentId,
    sessionId: adapter.descriptor.sessionId,
    scenarioId: 'scenario-1',
    executionId: 'execution-1',
    sequence,
    requestedAt: NOW,
  };
}

function scenario(
  adapter: ReturnType<typeof createUnityEnvironmentAciAdapter>,
): EnvironmentScenario {
  return {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: adapter.descriptor.adapterId,
    environmentId: adapter.descriptor.environmentId,
    sessionId: adapter.descriptor.sessionId,
    scenarioId: 'scenario-1',
    executionId: 'execution-1',
    requestedAt: NOW,
    deadlineAt: LATER,
    steps: [
      { actionId: 'step-1', kind: 'step-time', payload: { ticks: 2 } },
      { actionId: 'input-1', kind: 'input', payload: { controlId: 'jump', pressed: true } },
      { actionId: 'inspect-1', kind: 'inspect-state', payload: {} },
      { actionId: 'scene-1', kind: 'load-scene', payload: { sceneId: 'level-2' } },
    ],
  };
}

describe('unity-environment-aci/v1', () => {
  it('seals all seven ACI operations with deterministic game state and evidence', async () => {
    const { adapter } = makeAdapter();
    expect(adapter.descriptor.kind).toBe('unity');
    expect(adapter.descriptor.actionKinds).toEqual([...UNITY_ENVIRONMENT_ACTION_KINDS].sort());
    expect(Object.values(adapter.descriptor.operations).every(Boolean)).toBe(true);

    const reset = await adapter.reset({
      ...identity(adapter, 1),
      reason: 'manual',
    } satisfies EnvironmentResetRequest);
    const step = await adapter.act(
      createEnvironmentAction({
        ...identity(adapter, 2),
        actionId: 'step-1',
        kind: 'step-time',
        payload: { ticks: 2 },
      }),
    );
    const input = await adapter.act(
      createEnvironmentAction({
        ...identity(adapter, 3),
        actionId: 'input-1',
        kind: 'input',
        payload: { controlId: 'jump', pressed: true },
      }),
    );
    const inspected = await adapter.act(
      createEnvironmentAction({
        ...identity(adapter, 4),
        actionId: 'inspect-1',
        kind: 'inspect-state',
        payload: {},
      }),
    );
    const scene = await adapter.act(
      createEnvironmentAction({
        ...identity(adapter, 5),
        actionId: 'scene-1',
        kind: 'load-scene',
        payload: { sceneId: 'level-2' },
      }),
    );
    const observation = await adapter.observe({
      ...identity(adapter, 6),
      afterActionId: 'scene-1',
    } satisfies EnvironmentObserveRequest);
    const snapshot = await adapter.snapshot({
      ...identity(adapter, 7),
    } satisfies EnvironmentSnapshotRequest);
    const restored = await adapter.restore(snapshot);
    const evidence = await adapter.collectEvidence({
      ...identity(adapter, 9),
      actionId: 'scene-1',
      actionSha256: scene.actionSha256,
      observationSha256: observation.observationSha256,
    });

    expect(reset.state).toMatchObject({ clockTicks: 0, frameId: 0 });
    expect(step.status).toBe('PASS');
    expect(input.status).toBe('PASS');
    expect(inspected.status).toBe('PASS');
    expect(scene.status).toBe('PASS');
    expect(observation.state).toMatchObject({ sceneId: 'level-2', clockTicks: 0, frameId: 3 });
    expect(snapshot.snapshotRef).toBe('snapshots/state.json');
    expect(restored.state).toMatchObject({ sceneId: 'level-2', frameId: 3 });
    expect(evidence.artifacts).toHaveLength(3);
  });

  it('uses the coordinator with explicit capability and artifact validation for scenarios', async () => {
    const { adapter } = makeAdapter();
    const receipt = await adapter.runScenario(scenario(adapter));
    expect(receipt.status).toBe('PASS');
    expect(receipt.actions).toHaveLength(4);
    expect(receipt.observations).toHaveLength(4);
    expect(receipt.evidence).toHaveLength(4);
    expect(receipt.sequence).toBe(14);
  });

  it('reports missing Unity bridge/build/reset/deterministic stepping as UNVERIFIED', async () => {
    const { adapter, port } = makeAdapter();
    port.capabilities.unityAvailable = false;
    port.capabilities.bridgeAvailable = false;
    port.capabilities.buildId = null;
    port.capabilities.resetAvailable = false;
    port.capabilities.deterministicStepAvailable = false;
    const assessment = createUnityHostCapability(adapter.descriptor, port.capabilities);
    expect(assessment.status).toBe('UNVERIFIED');
    expect(assessment.capability.enabled).toBe(false);
    const receipt = await adapter.runScenario(scenario(adapter));
    expect(receipt.status).toBe('UNVERIFIED');
    expect(receipt.reason).toBe('unity-capability-unverified');
  });

  it('never verifies a valid non-Unity descriptor as a Unity capability', () => {
    const { adapter, port } = makeAdapter();
    const wrongKind = createEnvironmentAciDescriptor({
      adapterId: adapter.descriptor.adapterId,
      environmentId: adapter.descriptor.environmentId,
      sessionId: adapter.descriptor.sessionId,
      kind: 'web',
      operationTimeoutMs: adapter.descriptor.operationTimeoutMs,
      operations: adapter.descriptor.operations,
      actionKinds: adapter.descriptor.actionKinds,
      environment: adapter.descriptor.environment,
    });

    expect(createUnityHostCapability(wrongKind, port.capabilities)).toMatchObject({
      status: 'UNVERIFIED',
      capability: { enabled: false },
    });
  });

  it('rejects invalid tick, control, scene, and unsafe evidence refs before sealing', async () => {
    const { adapter, port } = makeAdapter();
    await adapter.reset({ ...identity(adapter, 1), reason: 'manual' });
    await expect(
      adapter.act(
        createEnvironmentAction({
          ...identity(adapter, 2),
          actionId: 'bad-tick',
          kind: 'step-time',
          payload: { ticks: -1 },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adapter.act(
        createEnvironmentAction({
          ...identity(adapter, 3),
          actionId: 'bad-input',
          kind: 'input',
          payload: { controlId: '../jump', pressed: true },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adapter.act(
        createEnvironmentAction({
          ...identity(adapter, 4),
          actionId: 'bad-scene',
          kind: 'load-scene',
          payload: { sceneId: '../level' },
        }),
      ),
    ).rejects.toThrow();
    port.collectArtifacts = async () => [
      artifact('frame', '../frame.png', 'image/png'),
      artifact('video', 'evidence/replay.mp4', 'video/mp4'),
      artifact('state', 'evidence/state.json', 'application/json'),
    ];
    await expect(
      adapter.collectEvidence({
        ...identity(adapter, 5),
        actionId: 'evidence-1',
        actionSha256: digest('action'),
        observationSha256: digest('observation'),
      }),
    ).rejects.toThrow();
  });

  it('rejects nondeterministic clock transitions and binds snapshots to their session', async () => {
    const { adapter, port } = makeAdapter();
    await adapter.reset({ ...identity(adapter, 1), reason: 'manual' });
    port.stepClockOffset = 1;
    await expect(
      adapter.act(
        createEnvironmentAction({
          ...identity(adapter, 2),
          actionId: 'step-1',
          kind: 'step-time',
          payload: { ticks: 1 },
        }),
      ),
    ).rejects.toThrow('nondeterministic');
    port.stepClockOffset = 0;
    await adapter.reset({ ...identity(adapter, 3), reason: 'manual' });
    port.inputSceneId = 'unexpected-scene';
    await expect(
      adapter.act(
        createEnvironmentAction({
          ...identity(adapter, 4),
          actionId: 'input-1',
          kind: 'input',
          payload: { controlId: 'jump', pressed: true },
        }),
      ),
    ).rejects.toThrow('nondeterministic');
    port.inputSceneId = null;
    await adapter.reset({ ...identity(adapter, 3), reason: 'manual' });
    const snapshot = await adapter.snapshot({ ...identity(adapter, 5) });
    const other = makeAdapter(new FakeUnityPort(), 'session-other').adapter;
    await expect(other.restore(snapshot)).rejects.toThrow('identity-mismatch');
    const callsBeforeTamper = port.calls;
    await expect(
      adapter.restore({ ...snapshot, snapshotRef: 'snapshots/other.json' }),
    ).rejects.toThrow();
    expect(port.calls).toBe(callsBeforeTamper);
    await expect(adapter.restore(snapshot)).resolves.toBeDefined();
    await expect(adapter.restore(snapshot)).rejects.toThrow('snapshot-unavailable');

    const expiry = makeAdapter();
    await expiry.adapter.reset({ ...identity(expiry.adapter, 1), reason: 'manual' });
    const expiring = await expiry.adapter.snapshot({ ...identity(expiry.adapter, 2) });
    expiry.setNow(LATER);
    const callsBeforeExpiry = expiry.port.calls;
    await expect(expiry.adapter.restore(expiring)).rejects.toThrow('snapshot-unavailable');
    expect(expiry.port.calls).toBe(callsBeforeExpiry);
  });

  it('rejects foreign request identities before the port can be called', async () => {
    const { adapter, port } = makeAdapter();
    await expect(
      adapter.reset({
        ...identity(adapter, 1),
        adapterId: 'foreign-adapter',
        reason: 'manual',
      }),
    ).rejects.toThrow('identity-mismatch');
    await expect(
      adapter.snapshot({ ...identity(adapter, 2), environmentId: 'foreign-env' }),
    ).rejects.toThrow('identity-mismatch');
    await expect(
      adapter.act(
        createEnvironmentAction({
          ...identity(adapter, 3),
          sessionId: 'foreign-session',
          actionId: 'step-1',
          kind: 'step-time',
          payload: { ticks: 1 },
        }),
      ),
    ).rejects.toThrow('identity-mismatch');
    expect(port.calls).toBe(0);
  });

  it('parses and rejects a foreign scenario before reading port capabilities', async () => {
    const port = new FakeUnityPort();
    const capabilities = port.capabilities;
    let capabilityReads = 0;
    Object.defineProperty(port, 'capabilities', {
      configurable: true,
      get: () => {
        capabilityReads += 1;
        return capabilities;
      },
    });
    const { adapter } = makeAdapter(port, 'scenario-identity-session');

    await expect(
      adapter.runScenario({ ...scenario(adapter), adapterId: 'foreign-adapter' }),
    ).rejects.toThrow('identity-mismatch');
    expect(capabilityReads).toBe(0);
    expect(port.calls).toBe(0);
  });

  it('strictly downgrades malformed capabilities and clones aliased game state', async () => {
    const { adapter, port } = makeAdapter();
    expect(
      createUnityHostCapability(adapter.descriptor, {
        ...port.capabilities,
        unityAvailable: 'false',
      } as unknown),
    ).toMatchObject({ status: 'UNVERIFIED' });
    expect(
      createUnityHostCapability(adapter.descriptor, {
        ...port.capabilities,
        unknown: true,
      }),
    ).toMatchObject({ status: 'UNVERIFIED' });
    port.returnAlias = true;
    const reset = await adapter.reset({ ...identity(adapter, 1), reason: 'manual' });
    (port.state.state as { lives: number }).lives = 99;
    expect(reset.state).toMatchObject({ gameplay: { lives: 3 } });
    const sensitive = makeAdapter();
    sensitive.port.state = {
      sceneId: 'main',
      clockTicks: 0,
      frameId: 0,
      state: { access_token: 'redacted' },
    };
    await expect(
      sensitive.adapter.observe({
        ...identity(sensitive.adapter, 2),
        afterActionId: null,
      }),
    ).resolves.toMatchObject({
      state: {
        gameplay: { [`field-${digest('access_token').slice(0, 16)}`]: '[REDACTED]' },
      },
    });
    port.throwOn = 'reset';
    await expect(adapter.reset({ ...identity(adapter, 3), reason: 'manual' })).rejects.toThrow(
      'port-reset-failed',
    );
  });

  it('recursively redacts opaque secrets before sealing game state', async () => {
    const { adapter, port } = makeAdapter();
    const secrets = [
      'sk-project-secret-value-1234567890',
      'AKIAIOSFODNN7EXAMPLE',
      'Bearer opaque-access-token-value',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-value',
      '-----BEGIN PRIVATE KEY-----',
      'password=hunter2',
      'QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
      '4f3c2b1a0d9e8f7c6b5a',
      '4111111111111111',
    ];
    port.state = {
      sceneId: 'main',
      clockTicks: 0,
      frameId: 0,
      state: {
        levelId: 'level-7',
        companionId: 'npc-2',
        score: 123456,
        shortCode: 'A1B2C3D4E5F6',
        nested: {
          payloads: secrets,
          access_token: 'key-derived-secret',
        },
      },
    };

    const observation = await adapter.observe({
      ...identity(adapter, 1),
      afterActionId: null,
    });
    const snapshot = await adapter.snapshot({ ...identity(adapter, 2) });
    const evidence = await adapter.collectEvidence({
      ...identity(adapter, 3),
      actionId: 'inspect-1',
      actionSha256: digest('action'),
      observationSha256: observation.observationSha256,
    });
    const sealedBytes = Buffer.from(JSON.stringify({ observation, snapshot, evidence }), 'utf8');

    expect(observation.state).toMatchObject({
      gameplay: {
        levelId: 'level-7',
        companionId: 'npc-2',
        score: 123456,
        shortCode: 'A1B2C3D4E5F6',
        nested: {
          payloads: secrets.map(() => '[REDACTED]'),
          [`field-${digest('access_token').slice(0, 16)}`]: '[REDACTED]',
        },
      },
    });
    for (const secret of secrets) expect(sealedBytes.includes(Buffer.from(secret))).toBe(false);
    expect(sealedBytes.includes(Buffer.from('key-derived-secret'))).toBe(false);
  });

  it('redacts embedded secret runs and deterministically hashes sensitive keys without collisions', async () => {
    const rawKeys = ['api_key', 'password'];
    const rawValues = ['key-derived-secret', 'credential-derived-secret'];
    const collidingNeutralKey = `field-${digest(rawKeys[0]).slice(0, 16)}`;
    const embeddedSecrets = [
      'prefix:sk-project-secret-value-1234567890:suffix',
      'prefix_AKIAIOSFODNN7EXAMPLE_suffix',
      'trace(Bearer opaque-access-token-value)done',
      'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-value;done',
      'pem=-----BEGIN RSA PRIVATE KEY-----;done',
      'trace password=hunter2;done',
      'base64:QWxhZGRpbjpvcGVuIHNlc2FtZQ==:done',
      'hex:4f3c2b1a0d9e8f7c6b5a:done',
      'payment:4111-1111-1111-1111:done',
    ];
    const createState = (reverse: boolean): UnityGameState => ({
      sceneId: 'main',
      clockTicks: 0,
      frameId: 0,
      state: {
        nested: Object.fromEntries(
          (reverse
            ? [
                ['password', rawValues[1]],
                [collidingNeutralKey, 'safe-value'],
                ['api_key', rawValues[0]],
              ]
            : [
                ['api_key', rawValues[0]],
                [collidingNeutralKey, 'safe-value'],
                ['password', rawValues[1]],
              ]) as [string, string][],
        ),
        payloads: embeddedSecrets,
      },
    });
    const first = makeAdapter();
    const second = makeAdapter();
    first.port.state = createState(false);
    second.port.state = createState(true);

    const firstObservation = await first.adapter.observe({
      ...identity(first.adapter, 1),
      afterActionId: null,
    });
    const secondObservation = await second.adapter.observe({
      ...identity(second.adapter, 1),
      afterActionId: null,
    });
    const firstGameplay = (
      firstObservation.state as {
        gameplay: {
          nested: Record<string, string>;
          payloads: string[];
        };
      }
    ).gameplay;
    const secondGameplay = (
      secondObservation.state as {
        gameplay: typeof firstGameplay;
      }
    ).gameplay;
    const sealedBytes = Buffer.from(JSON.stringify({ firstObservation, secondObservation }));

    expect(firstGameplay).toEqual(secondGameplay);
    expect(firstGameplay.payloads).toEqual(embeddedSecrets.map(() => '[REDACTED]'));
    expect(firstGameplay.nested[collidingNeutralKey]).toBe('safe-value');
    expect(Object.keys(firstGameplay.nested)).toHaveLength(3);
    expect(
      Object.keys(firstGameplay.nested).filter((key) => key.startsWith('field-')),
    ).toHaveLength(3);
    for (const raw of [...rawKeys, ...rawValues, ...embeddedSecrets])
      expect(sealedBytes.includes(Buffer.from(raw))).toBe(false);
  });

  it('bounds snapshots, retains consumed entries until expiry, and prunes expired entries', async () => {
    const { adapter, port, setNow } = makeAdapter();
    await adapter.reset({ ...identity(adapter, 1), reason: 'manual' });
    const consumed = await adapter.snapshot({ ...identity(adapter, 2) });
    await adapter.restore(consumed);
    for (let sequence = 3; sequence <= 129; sequence += 1)
      await adapter.snapshot({ ...identity(adapter, sequence) });

    const callsAtCapacity = port.calls;
    await expect(adapter.snapshot({ ...identity(adapter, 130) })).rejects.toThrow(
      'snapshot-capacity-exceeded',
    );
    expect(port.calls).toBe(callsAtCapacity);

    setNow(LATER);
    port.snapshotExpiresAt = EVEN_LATER;
    await expect(adapter.snapshot({ ...identity(adapter, 131) })).resolves.toBeDefined();
  });

  it('reserves snapshot capacity before awaits and releases failed reservations', async () => {
    const concurrent = makeAdapter();
    await concurrent.adapter.reset({ ...identity(concurrent.adapter, 1), reason: 'manual' });
    concurrent.port.holdSnapshots();
    const callsBeforeSnapshots = concurrent.port.calls;
    const snapshots = Array.from({ length: 129 }, (_, index) =>
      concurrent.adapter.snapshot({ ...identity(concurrent.adapter, index + 2) }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(concurrent.port.calls - callsBeforeSnapshots).toBe(128);

    concurrent.port.releaseSnapshots();
    const settled = await Promise.allSettled(snapshots);
    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(128);
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain('snapshot-capacity-exceeded');
    const callsAtCapacity = concurrent.port.calls;
    await expect(
      concurrent.adapter.snapshot({ ...identity(concurrent.adapter, 131) }),
    ).rejects.toThrow('snapshot-capacity-exceeded');
    expect(concurrent.port.calls).toBe(callsAtCapacity);

    const failed = makeAdapter();
    await failed.adapter.reset({ ...identity(failed.adapter, 1), reason: 'manual' });
    failed.port.throwOn = 'snapshot';
    await expect(failed.adapter.snapshot({ ...identity(failed.adapter, 2) })).rejects.toThrow(
      'port-snapshot-failed',
    );
    failed.port.throwOn = null;
    await expect(
      failed.adapter.snapshot({ ...identity(failed.adapter, 3) }),
    ).resolves.toBeDefined();
  });

  it('contains port failures and timeouts without leaving an active operation', async () => {
    const failed = makeAdapter();
    failed.port.throwOn = 'step';
    const failure = await failed.adapter.runScenario({
      ...scenario(failed.adapter),
      steps: [{ actionId: 'step-1', kind: 'step-time', payload: { ticks: 1 } }],
    });
    expect(failure.status).toBe('FAIL');
    expect(failure.negativePaths).toContain('adapter-operation-failed');

    const timed = makeAdapter(new FakeUnityPort(), 'session-timeout');
    timed.port.delayResetMs = 35;
    const timeout = await timed.adapter.runScenario({
      ...scenario(timed.adapter),
      deadlineAt: '2026-09-04T00:00:01.000Z',
    });
    expect(timeout.status).toBe('FAIL');
    expect(timeout.negativePaths).toContain('adapter-operation-timeout');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(timed.port.inFlight).toBe(0);
  });
});
