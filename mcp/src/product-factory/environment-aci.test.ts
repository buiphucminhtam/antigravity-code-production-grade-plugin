import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_ACI_OPERATIONS,
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  EnvironmentAciAdapter,
  EnvironmentAction,
  EnvironmentScenario,
  HostEnvironmentCapability,
  clearEnvironmentAciSessionRegistryForTests,
  createEnvironmentAciCoordinator,
  createEnvironmentAciDescriptor,
  createEnvironmentAction,
  createEnvironmentActionResult,
  createEnvironmentEvidenceReceipt,
  createEnvironmentObservation,
  createEnvironmentScenarioReceipt,
  createEnvironmentSnapshot,
  createTrustedArtifactRefValidator,
  hashEnvironmentAciPayload,
  negotiateEnvironmentAci,
  parseEnvironmentEvidenceReceipt,
  parseEnvironmentObservation,
  parseEnvironmentScenarioReceipt,
  validateSnapshotForRestore,
} from './environment-aci.js';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T00:01:00.000Z';
const EXPIRES = '2026-09-04T01:00:00.000Z';
const acceptArtifacts = () => undefined;
const temporaryDirectories: string[] = [];
const operations = {
  observe: true,
  act: true,
  reset: true,
  snapshot: true,
  restore: true,
  runScenario: true,
  collectEvidence: true,
} as const;

interface DeferredCall {
  started: Promise<void>;
  release: () => void;
  finished: Promise<void>;
}

function deferredCall(): DeferredCall & {
  markStarted: () => void;
  waitForRelease: Promise<void>;
  markFinished: () => void;
} {
  let markStarted!: () => void;
  let release!: () => void;
  let markFinished!: () => void;
  return {
    started: new Promise<void>((resolve) => {
      markStarted = resolve;
    }),
    markStarted,
    waitForRelease: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release,
    finished: new Promise<void>((resolve) => {
      markFinished = resolve;
    }),
    markFinished,
  };
}

afterEach(() => {
  clearEnvironmentAciSessionRegistryForTests();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function descriptor(overrides: Record<string, unknown> = {}) {
  return createEnvironmentAciDescriptor({
    adapterId: 'adapter-web',
    environmentId: 'env-shop',
    sessionId: 'session-one',
    kind: 'web',
    operationTimeoutMs: 50,
    operations,
    actionKinds: ['click', 'navigate', 'type'],
    environment: { viewport: { width: 1280, height: 720 }, locale: 'en-US' },
    ...overrides,
  });
}

function hostCapability(
  value = descriptor(),
  overrides: Partial<HostEnvironmentCapability> = {},
): HostEnvironmentCapability {
  return {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    enabled: true,
    environmentFingerprint: value.environmentFingerprint,
    capabilityFingerprint: value.capabilityFingerprint,
    operationTimeoutMs: value.operationTimeoutMs,
    operations,
    reason: null,
    limitations: [],
    ...overrides,
  };
}

function scenario(overrides: Partial<EnvironmentScenario> = {}): EnvironmentScenario {
  return {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: 'adapter-web',
    environmentId: 'env-shop',
    sessionId: 'session-one',
    scenarioId: 'scenario-checkout',
    executionId: 'execution-one',
    requestedAt: NOW,
    deadlineAt: EXPIRES,
    steps: [
      { actionId: 'action-open', kind: 'navigate', payload: { path: '/checkout' } },
      { actionId: 'action-confirm', kind: 'click', payload: { target: 'confirm-button' } },
    ],
    ...overrides,
  };
}

class FakeAdapter implements EnvironmentAciAdapter {
  readonly descriptor;
  readonly calls: string[] = [];
  readonly dispatchedSequences: number[] = [];
  readonly active = { current: 0, maximum: 0 };
  failActionId: string | null = null;
  failRestore = false;
  mismatchAction = false;
  mismatchEvidence = false;
  lateEvidence = false;
  delayMs = 0;
  failCleanup = false;
  private readonly deferredCalls = new Map<string, Array<ReturnType<typeof deferredCall>>>();

  constructor(value = descriptor()) {
    this.descriptor = value;
  }

  deferNext(name: string): DeferredCall {
    const deferred = deferredCall();
    const calls = this.deferredCalls.get(name) ?? [];
    calls.push(deferred);
    this.deferredCalls.set(name, calls);
    return deferred;
  }

  private async enter<T>(name: string, sequence: number, create: () => T): Promise<T> {
    this.calls.push(name);
    this.dispatchedSequences.push(sequence);
    this.active.current += 1;
    this.active.maximum = Math.max(this.active.maximum, this.active.current);
    const deferred = this.deferredCalls.get(name)?.shift();
    try {
      if (deferred) {
        deferred.markStarted();
        await deferred.waitForRelease;
      }
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      return create();
    } finally {
      this.active.current -= 1;
      deferred?.markFinished();
    }
  }

  async observe(request: Parameters<EnvironmentAciAdapter['observe']>[0]) {
    return this.enter('observe', request.sequence, () =>
      createEnvironmentObservation({
        ...request,
        observedAt: request.requestedAt,
        state: { screen: 'checkout', sequence: request.sequence },
        limitations: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      }),
    );
  }

  async act(action: EnvironmentAction) {
    return this.enter('act', action.sequence, () => {
      const returnedAction = this.mismatchAction
        ? createEnvironmentAction({
            schemaVersion: action.schemaVersion,
            adapterId: action.adapterId,
            environmentId: action.environmentId,
            sessionId: action.sessionId,
            scenarioId: action.scenarioId,
            executionId: action.executionId,
            actionId: 'action-other',
            sequence: action.sequence,
            requestedAt: action.requestedAt,
            kind: action.kind,
            payload: action.payload,
          })
        : action;
      return createEnvironmentActionResult({
        ...returnedAction,
        completedAt: action.requestedAt,
        status: action.actionId === this.failActionId ? 'FAIL' : 'PASS',
        reason: action.actionId === this.failActionId ? 'target-not-found' : null,
        negativePaths: action.actionId === this.failActionId ? ['target-not-found'] : [],
        limitations: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    });
  }

  async reset(request: Parameters<EnvironmentAciAdapter['reset']>[0]) {
    return this.enter('reset', request.sequence, () => {
      if (request.reason === 'scenario-cleanup' && this.failCleanup) {
        throw new Error('raw cleanup adapter failure');
      }
      const { reason, ...identity } = request;
      return createEnvironmentObservation({
        ...identity,
        observedAt: request.requestedAt,
        state: { screen: 'reset', reason },
        limitations: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      });
    });
  }

  async snapshot(request: Parameters<EnvironmentAciAdapter['snapshot']>[0]) {
    return this.enter('snapshot', request.sequence, () =>
      createEnvironmentSnapshot({
        ...request,
        snapshotId: 'snapshot-one',
        snapshotRef: 'snapshots/snapshot-one.json',
        snapshotBytes: 16,
        snapshotMediaType: 'application/json',
        createdAt: request.requestedAt,
        expiresAt: EXPIRES,
        stateSha256: 'a'.repeat(64),
        environmentFingerprint: this.descriptor.environmentFingerprint,
      }),
    );
  }

  async restore(value: Parameters<EnvironmentAciAdapter['restore']>[0]) {
    return this.enter('restore', value.sequence + 1, () => {
      if (this.failRestore) throw new Error('adapter leaked secret credential');
      return createEnvironmentObservation({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: value.adapterId,
        environmentId: value.environmentId,
        sessionId: value.sessionId,
        scenarioId: value.scenarioId,
        executionId: value.executionId,
        sequence: value.sequence + 1,
        requestedAt: value.createdAt,
        observedAt: value.createdAt,
        state: { restored: value.snapshotId },
        limitations: [],
        environmentFingerprint: value.environmentFingerprint,
      });
    });
  }

  async runScenario(value: EnvironmentScenario) {
    return this.enter('runScenario', 0, () =>
      createEnvironmentScenarioReceipt({
        ...value,
        status: 'UNVERIFIED',
        startedAt: value.requestedAt,
        completedAt: value.requestedAt,
        sequence: 0,
        resetObservation: null,
        actions: [],
        actionResults: [],
        observations: [],
        evidence: [],
        cleanupObservation: null,
        reason: 'adapter-direct-unverified',
        negativePaths: [],
        limitations: ['Direct fake adapter scenario execution is not verified.'],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      }),
    );
  }

  async collectEvidence(request: Parameters<EnvironmentAciAdapter['collectEvidence']>[0]) {
    return this.enter('collectEvidence', request.sequence, () =>
      createEnvironmentEvidenceReceipt({
        ...request,
        executionId: this.mismatchEvidence ? 'execution-other' : request.executionId,
        collectedAt: this.lateEvidence ? '2026-09-04T02:00:00.000Z' : request.requestedAt,
        status: 'PASS',
        artifacts: [
          {
            ref: `evidence/${request.sequence}.json`,
            sha256: 'b'.repeat(64),
            bytes: 16,
            mediaType: 'application/json',
          },
        ],
        reason: null,
        negativePaths: [],
        limitations: [],
        environmentFingerprint: this.descriptor.environmentFingerprint,
      }),
    );
  }
}

describe('environment-aci/v1', () => {
  it('keeps the exact provider-neutral operation matrix and canonical timeout-bound fingerprints', () => {
    expect(ENVIRONMENT_ACI_OPERATIONS).toEqual([
      'observe',
      'act',
      'reset',
      'snapshot',
      'restore',
      'runScenario',
      'collectEvidence',
    ]);
    const first = descriptor();
    const reordered = createEnvironmentAciDescriptor({
      adapterId: 'adapter-web',
      environmentId: 'env-shop',
      sessionId: 'session-one',
      kind: 'web',
      operationTimeoutMs: 50,
      operations: {
        collectEvidence: true,
        runScenario: true,
        restore: true,
        snapshot: true,
        reset: true,
        act: true,
        observe: true,
      },
      actionKinds: ['type', 'click', 'navigate'],
      environment: { locale: 'en-US', viewport: { height: 720, width: 1280 } },
    });
    expect(reordered.capabilityFingerprint).toBe(first.capabilityFingerprint);
    expect(reordered.environmentFingerprint).toBe(first.environmentFingerprint);
    expect(descriptor({ operationTimeoutMs: 51 }).capabilityFingerprint).not.toBe(
      first.capabilityFingerprint,
    );
    expect(JSON.stringify(first)).not.toMatch(/provider|modelId|model_id/i);
  });

  it('returns explicit UNVERIFIED negotiation for missing, disabled, or unimplemented capability', () => {
    const adapter = new FakeAdapter();
    expect(negotiateEnvironmentAci(adapter, hostCapability()).status).toBe('PASS');
    expect(negotiateEnvironmentAci(adapter, undefined)).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'host-capability-missing',
    });
    expect(
      negotiateEnvironmentAci(
        adapter,
        hostCapability(adapter.descriptor, { enabled: false, reason: 'host-disabled' }),
      ),
    ).toMatchObject({ status: 'UNVERIFIED', reason: 'host-disabled' });
    const missingObserve = Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, {
      observe: undefined,
    }) as EnvironmentAciAdapter;
    expect(negotiateEnvironmentAci(missingObserve, hostCapability())).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'adapter-operation-missing:observe',
    });
  });

  it('runs deterministic complete receipts and derives explicit failures with cleanup', async () => {
    const firstAdapter = new FakeAdapter();
    const secondAdapter = new FakeAdapter();
    const first = createEnvironmentAciCoordinator(firstAdapter, hostCapability(), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const firstReceipt = await first.runScenario(scenario());
    clearEnvironmentAciSessionRegistryForTests();
    const second = createEnvironmentAciCoordinator(secondAdapter, hostCapability(), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const secondReceipt = await second.runScenario(scenario());
    expect(firstReceipt).toEqual(secondReceipt);
    expect(firstReceipt).toMatchObject({ status: 'PASS', sequence: 8 });
    expect(firstReceipt.actions).toHaveLength(2);
    expect(firstReceipt.actionResults).toHaveLength(2);
    expect(firstReceipt.observations).toHaveLength(2);
    expect(firstReceipt.evidence).toHaveLength(2);
    expect(firstReceipt.evidence.every(({ artifacts }) => artifacts.length > 0)).toBe(true);
    expect(firstReceipt.resetObservation).not.toBeNull();
    expect(firstReceipt.cleanupObservation).not.toBeNull();

    clearEnvironmentAciSessionRegistryForTests();
    const failing = new FakeAdapter();
    failing.failActionId = 'action-confirm';
    const failed = await createEnvironmentAciCoordinator(failing, hostCapability(), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    }).runScenario(scenario());
    expect(failed).toMatchObject({ status: 'FAIL', reason: 'target-not-found' });
    expect(failed.negativePaths).toContain('target-not-found');
    expect(failed.cleanupObservation).not.toBeNull();
  });

  it('rejects empty scenarios and forged or inconsistent rehashed outer receipts', async () => {
    const coordinator = createEnvironmentAciCoordinator(new FakeAdapter(), hostCapability(), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    await expect(coordinator.runScenario(scenario({ steps: [] }))).rejects.toThrow();
    const receipt = await coordinator.runScenario(scenario());
    const body: Record<string, unknown> = { ...receipt };
    delete body.receiptSha256;
    const forgedAction = { ...receipt.actions[0], payload: { path: '/forged' } };
    const forgedBody = { ...body, actions: [forgedAction, ...receipt.actions.slice(1)] };
    expect(() =>
      parseEnvironmentScenarioReceipt({
        ...forgedBody,
        receiptSha256: hashEnvironmentAciPayload(forgedBody),
      }),
    ).toThrow(/digest|action/i);

    const evidenceBody: Record<string, unknown> = { ...receipt.evidence[0] };
    delete evidenceBody.evidenceSha256;
    const emptyEvidenceBody = { ...evidenceBody, artifacts: [] };
    const emptyEvidence = {
      ...emptyEvidenceBody,
      evidenceSha256: hashEnvironmentAciPayload(emptyEvidenceBody),
    };
    const inconsistentBody = {
      ...body,
      evidence: [emptyEvidence, ...receipt.evidence.slice(1)],
    };
    expect(() =>
      parseEnvironmentScenarioReceipt({
        ...inconsistentBody,
        receiptSha256: hashEnvironmentAciPayload(inconsistentBody),
      }),
    ).toThrow(/artifact/i);

    const actionBody: Record<string, unknown> = { ...receipt.actions[0] };
    delete actionBody.actionSha256;
    const reorderedActionBody = {
      ...actionBody,
      requestedAt: '2026-09-04T00:00:30.000Z',
    };
    const reorderedAction = {
      ...reorderedActionBody,
      actionSha256: hashEnvironmentAciPayload(reorderedActionBody),
    };
    const resultBody: Record<string, unknown> = { ...receipt.actionResults[0] };
    delete resultBody.resultSha256;
    const reorderedResultBody = {
      ...resultBody,
      requestedAt: reorderedAction.requestedAt,
      completedAt: reorderedAction.requestedAt,
      actionSha256: reorderedAction.actionSha256,
    };
    const reorderedResult = {
      ...reorderedResultBody,
      resultSha256: hashEnvironmentAciPayload(reorderedResultBody),
    };
    const reorderedEvidenceBody: Record<string, unknown> = { ...receipt.evidence[0] };
    delete reorderedEvidenceBody.evidenceSha256;
    const reboundEvidenceBody = {
      ...reorderedEvidenceBody,
      actionSha256: reorderedAction.actionSha256,
    };
    const reorderedEvidence = {
      ...reboundEvidenceBody,
      evidenceSha256: hashEnvironmentAciPayload(reboundEvidenceBody),
    };
    const reorderedTimelineBody = {
      ...body,
      completedAt: LATER,
      actions: [reorderedAction, ...receipt.actions.slice(1)],
      actionResults: [reorderedResult, ...receipt.actionResults.slice(1)],
      evidence: [reorderedEvidence, ...receipt.evidence.slice(1)],
    };
    expect(() =>
      parseEnvironmentScenarioReceipt({
        ...reorderedTimelineBody,
        receiptSha256: hashEnvironmentAciPayload(reorderedTimelineBody),
      }),
    ).toThrow(/timeline|monotonic|timestamp/i);
  });

  it('shares serialization and sequence across coordinators and recovers after rejection', async () => {
    const adapter = new FakeAdapter();
    adapter.delayMs = 2;
    const first = createEnvironmentAciCoordinator(adapter, hostCapability(), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const second = createEnvironmentAciCoordinator(adapter, hostCapability(), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const [one, two] = await Promise.all([
      first.runScenario(scenario()),
      second.runScenario(
        scenario({ scenarioId: 'scenario-shared', executionId: 'execution-shared' }),
      ),
    ]);
    expect(one.status).toBe('PASS');
    expect(two.status).toBe('PASS');
    expect(adapter.active.maximum).toBe(1);
    expect(two.resetObservation?.sequence).toBe((one.cleanupObservation?.sequence ?? 0) + 1);

    await expect(
      first.act(
        createEnvironmentAction({
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          adapterId: 'adapter-web',
          environmentId: 'env-shop',
          sessionId: 'session-one',
          scenarioId: 'scenario-bad',
          executionId: 'execution-bad',
          actionId: 'action-bad',
          sequence: 1,
          requestedAt: NOW,
          kind: 'click',
          payload: {},
        }),
      ),
    ).rejects.toThrow(/monotonic/i);
    expect(
      (
        await second.runScenario(
          scenario({ scenarioId: 'scenario-recovered', executionId: 'execution-recovered' }),
        )
      ).status,
    ).toBe('PASS');
  });

  it('rejects cross-talk, late evidence, and action-result mismatch with stable reasons', async () => {
    for (const [configure, reason] of [
      [(adapter: FakeAdapter) => (adapter.mismatchEvidence = true), 'adapter-receipt-invalid'],
      [(adapter: FakeAdapter) => (adapter.lateEvidence = true), 'adapter-receipt-invalid'],
      [(adapter: FakeAdapter) => (adapter.mismatchAction = true), 'adapter-receipt-invalid'],
    ] as const) {
      clearEnvironmentAciSessionRegistryForTests();
      const adapter = new FakeAdapter();
      configure(adapter);
      const receipt = await createEnvironmentAciCoordinator(adapter, hostCapability(), {
        now: () => NOW,
        artifactValidator: acceptArtifacts,
      }).runScenario(scenario());
      expect(receipt.status).toBe('FAIL');
      expect(receipt.reason).toBe(reason);
      expect(receipt.negativePaths).toContain('adapter-receipt-mismatch');
    }
  });

  it('reserves every dispatched sequence before validation and never reuses failures', async () => {
    const value = descriptor({ sessionId: 'session-sequence' });
    const adapter = new FakeAdapter(value);
    adapter.mismatchAction = true;
    const first = createEnvironmentAciCoordinator(adapter, hostCapability(value), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const second = createEnvironmentAciCoordinator(adapter, hostCapability(value), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    expect(
      (
        await first.runScenario(
          scenario({ sessionId: 'session-sequence', executionId: 'execution-invalid' }),
        )
      ).reason,
    ).toBe('adapter-receipt-invalid');
    adapter.mismatchAction = false;
    expect(
      (
        await second.runScenario(
          scenario({ sessionId: 'session-sequence', executionId: 'execution-next' }),
        )
      ).status,
    ).toBe('PASS');
    expect(
      adapter.dispatchedSequences.every((sequence, index, values) => {
        return index === 0 || sequence > values[index - 1];
      }),
    ).toBe(true);

    const directValue = descriptor({ sessionId: 'session-direct-sequence' });
    const directAdapter = new FakeAdapter(directValue);
    const direct = createEnvironmentAciCoordinator(directAdapter, hostCapability(directValue), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const snapshot = await direct.snapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'adapter-web',
      environmentId: 'env-shop',
      sessionId: 'session-direct-sequence',
      scenarioId: 'scenario-direct',
      executionId: 'execution-direct',
      sequence: 1,
      requestedAt: NOW,
    });
    directAdapter.failRestore = true;
    await expect(direct.restore(snapshot)).rejects.toThrow('adapter-failed:restore');
    directAdapter.failRestore = false;
    await expect(
      direct.observe({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'adapter-web',
        environmentId: 'env-shop',
        sessionId: 'session-direct-sequence',
        scenarioId: 'scenario-direct',
        executionId: 'execution-after-failure',
        sequence: 3,
        requestedAt: NOW,
        afterActionId: null,
      }),
    ).resolves.toMatchObject({ sequence: 3 });
    expect(directAdapter.dispatchedSequences).toEqual([1, 2, 3]);
  });

  it('quarantines a timed-out shared session until one deferred cleanup succeeds', async () => {
    const timedDescriptor = descriptor({ operationTimeoutMs: 5, sessionId: 'session-timeout' });
    const adapter = new FakeAdapter(timedDescriptor);
    const lateReset = adapter.deferNext('reset');
    const first = createEnvironmentAciCoordinator(adapter, hostCapability(timedDescriptor), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const second = createEnvironmentAciCoordinator(adapter, hostCapability(timedDescriptor), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const pending = first.runScenario(
      scenario({ sessionId: 'session-timeout', executionId: 'execution-timeout' }),
    );
    await lateReset.started;
    const timedOut = await pending;
    expect(timedOut).toMatchObject({ status: 'FAIL', reason: 'adapter-timeout:reset' });
    expect(timedOut.negativePaths).toContain('adapter-operation-timeout');
    expect(timedOut.negativePaths).toContain('cleanup-deferred');
    expect(timedOut.limitations).toContain('cleanup-deferred');
    expect(timedOut).toMatchObject({ sequence: 1, cleanupObservation: null });
    expect(adapter.calls.filter((call) => call === 'reset')).toHaveLength(1);
    expect(adapter.active).toEqual({ current: 1, maximum: 1 });

    expect(
      await second.runScenario(
        scenario({ sessionId: 'session-timeout', executionId: 'execution-quarantined' }),
      ),
    ).toMatchObject({ status: 'UNVERIFIED', reason: 'environment-session-quarantined' });
    await expect(
      second.reset({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'adapter-web',
        environmentId: 'env-shop',
        sessionId: 'session-timeout',
        scenarioId: 'scenario-blocked',
        executionId: 'execution-blocked',
        sequence: 2,
        requestedAt: NOW,
        reason: 'manual',
      }),
    ).rejects.toThrow('environment-session-quarantined');
    expect(adapter.calls.filter((call) => call === 'reset')).toHaveLength(1);

    const cleanup = adapter.deferNext('reset');
    lateReset.release();
    await cleanup.started;
    expect(adapter.active.maximum).toBe(1);
    expect(
      (
        await first.runScenario(
          scenario({ sessionId: 'session-timeout', executionId: 'execution-cleaning' }),
        )
      ).status,
    ).toBe('UNVERIFIED');
    cleanup.release();
    await cleanup.finished;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      (
        await second.runScenario(
          scenario({ sessionId: 'session-timeout', executionId: 'execution-recovered' }),
        )
      ).status,
    ).toBe('PASS');
    expect(adapter.calls.filter((call) => call === 'reset')).toHaveLength(4);
    expect(adapter.active.maximum).toBe(1);
    expect(new Set(adapter.dispatchedSequences).size).toBe(adapter.dispatchedSequences.length);
    expect(
      adapter.dispatchedSequences.every((sequence, index, values) => {
        return index === 0 || sequence > values[index - 1];
      }),
    ).toBe(true);
  });

  it('keeps never-settling and cleanup-failed sessions blocked without overlap', async () => {
    const neverValue = descriptor({ operationTimeoutMs: 5, sessionId: 'session-never' });
    const neverAdapter = new FakeAdapter(neverValue);
    neverAdapter.deferNext('reset');
    const never = createEnvironmentAciCoordinator(neverAdapter, hostCapability(neverValue), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    await expect(
      never.runScenario(scenario({ sessionId: 'session-never', executionId: 'execution-never' })),
    ).resolves.toMatchObject({ status: 'FAIL', cleanupObservation: null });
    await expect(
      never.runScenario(scenario({ sessionId: 'session-never', executionId: 'execution-blocked' })),
    ).resolves.toMatchObject({
      status: 'UNVERIFIED',
      reason: 'environment-session-quarantined',
    });
    expect(neverAdapter.calls).toEqual(['reset']);
    expect(neverAdapter.active).toEqual({ current: 1, maximum: 1 });

    const failedValue = descriptor({ operationTimeoutMs: 50, sessionId: 'session-cleanup-fails' });
    const failedAdapter = new FakeAdapter(failedValue);
    const late = failedAdapter.deferNext('reset');
    const failed = createEnvironmentAciCoordinator(failedAdapter, hostCapability(failedValue), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    await failed.runScenario(
      scenario({ sessionId: 'session-cleanup-fails', executionId: 'execution-timeout' }),
    );
    failedAdapter.failCleanup = true;
    const cleanup = failedAdapter.deferNext('reset');
    late.release();
    await cleanup.started;
    cleanup.release();
    await cleanup.finished;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(
      failed.runScenario(
        scenario({ sessionId: 'session-cleanup-fails', executionId: 'execution-still-blocked' }),
      ),
    ).resolves.toMatchObject({
      status: 'UNVERIFIED',
      reason: 'environment-session-quarantined',
    });
    expect(failedAdapter.calls).toEqual(['reset', 'reset']);
    expect(failedAdapter.active.maximum).toBe(1);
  });

  it('retains every reserved sequence when an observation times out after its action', async () => {
    const value = descriptor({ operationTimeoutMs: 5, sessionId: 'session-observation-timeout' });
    const adapter = new FakeAdapter(value);
    const lateObservation = adapter.deferNext('observe');
    const coordinator = createEnvironmentAciCoordinator(adapter, hostCapability(value), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const pending = coordinator.runScenario(
      scenario({
        sessionId: 'session-observation-timeout',
        executionId: 'execution-observation-timeout',
      }),
    );
    await lateObservation.started;
    await expect(pending).resolves.toMatchObject({
      status: 'FAIL',
      sequence: 3,
      negativePaths: expect.arrayContaining(['adapter-operation-timeout', 'cleanup-deferred']),
    });
    expect(adapter.dispatchedSequences).toEqual([1, 2, 3]);
    lateObservation.release();
  });

  it('returns a timeout-backed deadline receipt and rejects a rehashed PASS after its deadline', async () => {
    const value = descriptor({ operationTimeoutMs: 50, sessionId: 'session-deadline-timeout' });
    const adapter = new FakeAdapter(value);
    const lateReset = adapter.deferNext('reset');
    const coordinator = createEnvironmentAciCoordinator(adapter, hostCapability(value), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const pending = coordinator.runScenario(
      scenario({
        sessionId: 'session-deadline-timeout',
        executionId: 'execution-deadline-timeout',
        deadlineAt: '2026-09-04T00:00:00.001Z',
      }),
    );
    await lateReset.started;
    await expect(pending).resolves.toMatchObject({
      status: 'FAIL',
      reason: 'adapter-timeout:reset',
      negativePaths: expect.arrayContaining(['adapter-operation-timeout', 'cleanup-deferred']),
    });
    lateReset.release();

    clearEnvironmentAciSessionRegistryForTests();
    const complete = await createEnvironmentAciCoordinator(new FakeAdapter(), hostCapability(), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    }).runScenario(scenario());
    const body: Record<string, unknown> = { ...complete };
    delete body.receiptSha256;
    const afterDeadlineBody = {
      ...body,
      deadlineAt: '2026-09-04T00:00:00.500Z',
      completedAt: LATER,
    };
    expect(() =>
      parseEnvironmentScenarioReceipt({
        ...afterDeadlineBody,
        receiptSha256: hashEnvironmentAciPayload(afterDeadlineBody),
      }),
    ).toThrow(/deadline|timeout-backed/i);
  });

  it('quarantines a session after an immediate scenario cleanup failure', async () => {
    const value = descriptor({ sessionId: 'session-immediate-cleanup-failure' });
    const adapter = new FakeAdapter(value);
    adapter.failCleanup = true;
    const coordinator = createEnvironmentAciCoordinator(adapter, hostCapability(value), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    await expect(
      coordinator.runScenario(
        scenario({
          sessionId: 'session-immediate-cleanup-failure',
          executionId: 'execution-immediate-cleanup-failure',
        }),
      ),
    ).resolves.toMatchObject({ status: 'FAIL', reason: 'cleanup-failed' });
    const callsBeforeBlock = adapter.calls.length;
    await expect(
      coordinator.runScenario(
        scenario({
          sessionId: 'session-immediate-cleanup-failure',
          executionId: 'execution-immediate-cleanup-blocked',
        }),
      ),
    ).resolves.toMatchObject({
      status: 'UNVERIFIED',
      reason: 'environment-session-quarantined',
    });
    await expect(
      coordinator.reset({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'adapter-web',
        environmentId: 'env-shop',
        sessionId: 'session-immediate-cleanup-failure',
        scenarioId: 'scenario-immediate-cleanup-blocked',
        executionId: 'execution-immediate-cleanup-blocked',
        sequence: 9,
        requestedAt: NOW,
        reason: 'manual',
      }),
    ).rejects.toThrow('environment-session-quarantined');
    expect(adapter.calls).toHaveLength(callsBeforeBlock);
  });

  it('redacts raw adapter failures', async () => {
    const failedDescriptor = descriptor({ sessionId: 'session-error' });
    const failing = new FakeAdapter(failedDescriptor);
    failing.failRestore = true;
    const failingCoordinator = createEnvironmentAciCoordinator(
      failing,
      hostCapability(failedDescriptor),
      { now: () => NOW, artifactValidator: acceptArtifacts },
    );
    const snapshot = await failingCoordinator.snapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'adapter-web',
      environmentId: 'env-shop',
      sessionId: 'session-error',
      scenarioId: 'scenario-error',
      executionId: 'execution-error',
      sequence: 1,
      requestedAt: NOW,
    });
    await expect(failingCoordinator.restore(snapshot)).rejects.toThrow('adapter-failed:restore');
  });

  it('binds, validates, and consumes snapshots once across coordinator instances', async () => {
    const value = descriptor({ sessionId: 'session-snapshot' });
    const adapter = new FakeAdapter(value);
    const first = createEnvironmentAciCoordinator(adapter, hostCapability(value), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const second = createEnvironmentAciCoordinator(adapter, hostCapability(value), {
      now: () => NOW,
      artifactValidator: acceptArtifacts,
    });
    const snapshot = await first.snapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'adapter-web',
      environmentId: 'env-shop',
      sessionId: 'session-snapshot',
      scenarioId: 'scenario-snapshot',
      executionId: 'execution-snapshot',
      sequence: 1,
      requestedAt: NOW,
    });
    expect((await second.restore(snapshot)).sequence).toBe(2);
    await expect(first.restore(snapshot)).rejects.toThrow(/consumed|replay/i);
    expect(() =>
      createEnvironmentSnapshot({
        ...snapshot,
        snapshotSha256: snapshot.snapshotSha256,
      } as never),
    ).toThrow(/unrecognized|unknown/i);

    const failedValue = descriptor({ sessionId: 'session-snapshot-failed' });
    const failedAdapter = new FakeAdapter(failedValue);
    failedAdapter.failRestore = true;
    const failedFirst = createEnvironmentAciCoordinator(
      failedAdapter,
      hostCapability(failedValue),
      { now: () => NOW, artifactValidator: acceptArtifacts },
    );
    const failedSecond = createEnvironmentAciCoordinator(
      failedAdapter,
      hostCapability(failedValue),
      { now: () => NOW, artifactValidator: acceptArtifacts },
    );
    const failedSnapshot = await failedFirst.snapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'adapter-web',
      environmentId: 'env-shop',
      sessionId: 'session-snapshot-failed',
      scenarioId: 'scenario-snapshot-failed',
      executionId: 'execution-snapshot-failed',
      sequence: 1,
      requestedAt: NOW,
    });
    await expect(failedFirst.restore(failedSnapshot)).rejects.toThrow('adapter-failed:restore');
    await expect(failedSecond.restore(failedSnapshot)).rejects.toThrow(/consumed|replay/i);
  });

  it('requires trusted contained refs and rejects a real symlink escape', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgewright-pf2-artifacts-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'forgewright-pf2-outside-'));
    temporaryDirectories.push(root, outside);
    fs.mkdirSync(path.join(root, 'evidence'));
    fs.writeFileSync(path.join(root, 'evidence', 'valid.json'), '{}');
    fs.writeFileSync(path.join(outside, 'secret.json'), '{}');
    fs.symlinkSync(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const validate = createTrustedArtifactRefValidator(root);
    const bytes = Buffer.byteLength('{}');
    const sha256 = createHash('sha256').update('{}').digest('hex');
    expect(() =>
      validate({ ref: 'evidence/valid.json', sha256, bytes, mediaType: 'application/json' }),
    ).not.toThrow();
    expect(() =>
      validate({ ref: 'escape/secret.json', sha256, bytes, mediaType: 'application/json' }),
    ).toThrow(/symlink|contained/i);

    const untrustedDescriptor = descriptor({ sessionId: 'session-untrusted' });
    const adapter = new FakeAdapter(untrustedDescriptor);
    const coordinator = createEnvironmentAciCoordinator(
      adapter,
      hostCapability(untrustedDescriptor),
      { now: () => NOW },
    );
    expect(
      (
        await coordinator.runScenario(
          scenario({ sessionId: 'session-untrusted', executionId: 'execution-untrusted' }),
        )
      ).status,
    ).toBe('UNVERIFIED');
    await expect(
      coordinator.collectEvidence({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'adapter-web',
        environmentId: 'env-shop',
        sessionId: 'session-untrusted',
        scenarioId: 'scenario-untrusted',
        executionId: 'execution-untrusted-direct',
        actionId: 'action-untrusted',
        sequence: 1,
        requestedAt: NOW,
        actionSha256: 'a'.repeat(64),
        observationSha256: 'b'.repeat(64),
      }),
    ).rejects.toThrow(/trusted/i);
  });

  it('strictly rejects unsafe refs, secrets, unknown fields, versions, sizes, and bad timestamps', () => {
    const observation = createEnvironmentObservation({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'adapter-web',
      environmentId: 'env-shop',
      sessionId: 'session-one',
      scenarioId: 'scenario-checkout',
      executionId: 'execution-one',
      sequence: 1,
      requestedAt: NOW,
      observedAt: NOW,
      state: { screen: 'home' },
      limitations: [],
      environmentFingerprint: descriptor().environmentFingerprint,
    });
    expect(() => parseEnvironmentObservation({ ...observation, unexpected: true })).toThrow();
    expect(() =>
      parseEnvironmentObservation({ ...observation, schemaVersion: 'environment-aci/v2' }),
    ).toThrow();
    expect(() =>
      createEnvironmentAction({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'adapter-web',
        environmentId: 'env-shop',
        sessionId: 'session-one',
        scenarioId: 'scenario-checkout',
        executionId: 'execution-one',
        actionId: 'action-secret',
        sequence: 1,
        requestedAt: NOW,
        kind: 'type',
        payload: { password: 'not-allowed' },
      }),
    ).toThrow(/secret|credential/i);
    expect(() =>
      createEnvironmentAction({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'adapter-web',
        environmentId: 'env-shop',
        sessionId: 'session-one',
        scenarioId: 'scenario-checkout',
        executionId: 'execution-one',
        actionId: 'action-large',
        sequence: 1,
        requestedAt: NOW,
        kind: 'type',
        payload: { text: 'x'.repeat(300_000) },
      }),
    ).toThrow(/size limit/i);
    expect(() =>
      createEnvironmentSnapshot({
        schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
        adapterId: 'adapter-web',
        environmentId: 'env-shop',
        sessionId: 'session-one',
        scenarioId: 'scenario-one',
        executionId: 'execution-one',
        sequence: 1,
        requestedAt: LATER,
        snapshotId: 'snapshot-bad',
        snapshotRef: '../snapshot.json',
        snapshotBytes: 1,
        snapshotMediaType: 'application/json',
        createdAt: NOW,
        expiresAt: EXPIRES,
        stateSha256: 'a'.repeat(64),
        environmentFingerprint: descriptor().environmentFingerprint,
      }),
    ).toThrow(/relative|precedes/i);
  });

  it('supports web, Android, and Unity action kinds and exercises every adapter operation', async () => {
    for (const [kind, actionKind] of [
      ['web', 'evaluate-script'],
      ['android', 'adb-intent'],
      ['unity', 'invoke-game-command'],
    ] as const) {
      expect(
        createEnvironmentAciDescriptor({
          adapterId: `adapter-${kind}`,
          environmentId: `environment-${kind}`,
          sessionId: `session-${kind}`,
          kind,
          operationTimeoutMs: 50,
          operations,
          actionKinds: [actionKind],
          environment: { target: kind },
        }).actionKinds,
      ).toEqual([actionKind]);
    }

    const adapter = new FakeAdapter(descriptor({ sessionId: 'session-all-ops' }));
    const coordinator = createEnvironmentAciCoordinator(
      adapter,
      hostCapability(adapter.descriptor),
      { now: () => NOW, artifactValidator: acceptArtifacts },
    );
    const run = await coordinator.runScenario(
      scenario({ sessionId: 'session-all-ops', executionId: 'execution-all-ops' }),
    );
    const snapshot = await coordinator.snapshot({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: 'adapter-web',
      environmentId: 'env-shop',
      sessionId: 'session-all-ops',
      scenarioId: 'scenario-snapshot',
      executionId: 'execution-snapshot',
      sequence: run.sequence + 1,
      requestedAt: NOW,
    });
    await coordinator.restore(snapshot);
    await adapter.runScenario(
      scenario({ sessionId: 'session-all-ops', executionId: 'execution-direct' }),
    );
    expect(new Set(adapter.calls)).toEqual(new Set(ENVIRONMENT_ACI_OPERATIONS));
    expect(parseEnvironmentEvidenceReceipt(run.evidence[0])).toEqual(run.evidence[0]);
    expect(() =>
      validateSnapshotForRestore(snapshot, adapter.descriptor, NOW, snapshot.sequence),
    ).not.toThrow();
  });
});
