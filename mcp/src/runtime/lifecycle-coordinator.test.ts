import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LifecycleCoordinator } from './lifecycle-coordinator.js';
import { TrajectoryLedger, foldTrajectory } from './trajectory-ledger.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forgewright-coordinator-'));
  roots.push(root);
  const ledger = new TrajectoryLedger({ root, ledgerId: 'trajectory-coordinator' });
  const coordinator = await LifecycleCoordinator.open({
    ledger,
    rootScopeId: 'scope-root',
    workspaceId: 'workspace-a',
    sessionId: 'session-a',
    origin: 'runtime',
    writerEpoch: 7,
    objectiveDigest: 'a'.repeat(64),
  });
  return { root, ledger, coordinator };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('LifecycleCoordinator cancellation', () => {
  it('persists parent cancellation before abort propagation and acknowledgement', async () => {
    const { coordinator, ledger } = await fixture();
    await coordinator.openScope({
      scopeId: 'scope-child',
      parentScopeId: 'scope-root',
      scopeType: 'child',
    });
    const rootSignal = coordinator.signal('scope-root');
    const childSignal = coordinator.signal('scope-child');
    const durableBeforeAbort = new Promise<boolean>((resolve, reject) => {
      rootSignal.addEventListener(
        'abort',
        () => {
          ledger
            .reconstruct()
            .then((events) =>
              resolve(events.some((event) => event.kind === 'cancellation.requested')),
            )
            .catch(reject);
        },
        { once: true },
      );
    });

    await coordinator.cancel('scope-root', 'operator_requested');
    const events = await ledger.reconstruct();

    expect(await durableBeforeAbort).toBe(true);
    expect(rootSignal.aborted).toBe(true);
    expect(childSignal.aborted).toBe(true);
    expect(events.findIndex((event) => event.kind === 'cancellation.requested')).toBeLessThan(
      events.findIndex((event) => event.kind === 'cancellation.acknowledged'),
    );
  });

  it('does not propagate child cancellation to its parent by default', async () => {
    const { coordinator, ledger } = await fixture();
    await coordinator.openScope({
      scopeId: 'scope-child',
      parentScopeId: 'scope-root',
      scopeType: 'child',
    });

    await coordinator.cancel('scope-child', 'child_failed');

    expect(coordinator.signal('scope-child').aborted).toBe(true);
    expect(coordinator.signal('scope-root').aborted).toBe(false);
    expect(coordinator.state).toBe('ACTIVE');
    await coordinator.openScope({
      scopeId: 'scope-sibling',
      parentScopeId: 'scope-root',
      scopeType: 'child',
    });
    await coordinator.registerDisposer(
      {
        disposerId: 'root-disposer',
        scopeId: 'scope-root',
        idempotencyKey: 'root-disposer-key',
        resourceType: 'test',
        resourceDigest: '1'.repeat(64),
      },
      async () => undefined,
    );
    await expect(
      coordinator.runOperation(
        {
          operationId: 'root-operation',
          scopeId: 'scope-root',
          operationType: 'work',
          inputDigest: '2'.repeat(64),
        },
        async () => 'normal-result',
      ),
    ).resolves.toBe('normal-result');
    await expectCode(
      coordinator.openScope({
        scopeId: 'scope-grandchild',
        parentScopeId: 'scope-child',
        scopeType: 'child',
      }),
      'ADMISSIONS_CLOSED',
    );
    const events = await ledger.reconstruct();
    expect(
      events.find(
        (event) =>
          event.kind === 'operation.settled' && event.payload.operationId === 'root-operation',
      ),
    ).toMatchObject({ payload: { outcome: 'completed', lateResultDiscarded: false } });
  });

  it('closes admissions and records one settlement in a cancel/complete race', async () => {
    const { coordinator, ledger } = await fixture();
    let complete!: (value: string) => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => (markEntered = resolve));
    const operation = coordinator.runOperation(
      {
        operationId: 'operation-a',
        scopeId: 'scope-root',
        operationType: 'work',
        inputDigest: 'b'.repeat(64),
      },
      async () =>
        new Promise<string>((resolve) => {
          complete = resolve;
          markEntered();
        }),
    );
    await entered;

    const cancellation = coordinator.cancel('scope-root', 'operator_requested');
    complete('late-value');
    const [operationResult] = await Promise.allSettled([operation, cancellation]);

    expect(operationResult.status).toBe('rejected');
    await expectCode(
      coordinator.openScope({
        scopeId: 'scope-late',
        parentScopeId: 'scope-root',
        scopeType: 'child',
      }),
      'ADMISSIONS_CLOSED',
    );
    await expectCode(
      coordinator.registerDisposer(
        {
          disposerId: 'disposer-late',
          scopeId: 'scope-root',
          idempotencyKey: 'dispose-late',
          resourceType: 'temp',
          resourceDigest: 'c'.repeat(64),
        },
        async () => undefined,
      ),
      'ADMISSIONS_CLOSED',
    );
    const events = await ledger.reconstruct();
    expect(events.filter((event) => event.kind === 'operation.started')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'operation.settled')).toHaveLength(1);
  });
});

describe('LifecycleCoordinator registration and finalization', () => {
  it('closes only quiescent non-root scopes after persisting scope.closed', async () => {
    const { coordinator, ledger } = await fixture();
    await coordinator.openScope({
      scopeId: 'scope-clean',
      parentScopeId: 'scope-root',
      scopeType: 'request',
    });
    await expectCode(
      coordinator.closeScope('scope-root', 'completed'),
      'ROOT_SCOPE_CLOSE_FORBIDDEN',
    );
    await expectCode(coordinator.closeScope('scope-missing', 'completed'), 'UNKNOWN_SCOPE');

    let complete!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => (markEntered = resolve));
    const operation = coordinator.runOperation(
      {
        operationId: 'scope-operation',
        scopeId: 'scope-clean',
        operationType: 'work',
        inputDigest: '5'.repeat(64),
      },
      async () =>
        new Promise<void>((resolve) => {
          complete = resolve;
          markEntered();
        }),
    );
    await entered;
    await expectCode(coordinator.closeScope('scope-clean', 'completed'), 'SCOPE_NOT_QUIESCENT');
    complete();
    await operation;

    await coordinator.closeScope('scope-clean', 'completed');
    const events = await ledger.reconstruct();
    expect(events.at(-1)).toMatchObject({
      kind: 'scope.closed',
      payload: { scopeId: 'scope-clean', outcome: 'completed' },
    });
    await expectCode(coordinator.closeScope('scope-clean', 'completed'), 'SCOPE_ALREADY_CLOSED');

    await coordinator.openScope({
      scopeId: 'scope-resource',
      parentScopeId: 'scope-root',
      scopeType: 'request',
    });
    await coordinator.registerDisposer(
      {
        disposerId: 'scope-resource-disposer',
        scopeId: 'scope-resource',
        idempotencyKey: 'scope-resource-key',
        resourceType: 'test',
        resourceDigest: '6'.repeat(64),
      },
      async () => undefined,
    );
    await expectCode(coordinator.closeScope('scope-resource', 'completed'), 'SCOPE_NOT_QUIESCENT');
  });

  it('allows an admitted quiescent child to close while finalization drains', async () => {
    const { coordinator } = await fixture();
    await coordinator.openScope({
      scopeId: 'scope-draining',
      parentScopeId: 'scope-root',
      scopeType: 'request',
    });
    const finalization = coordinator.finalize({ timeoutMs: 1_000, outcome: 'completed' });
    await coordinator.closeScope('scope-draining', 'completed');
    await expect(finalization).resolves.toMatchObject({ quiescence: 'confirmed' });
  });

  it('persists a disposer descriptor before marking the trusted handler registered', async () => {
    const { coordinator, ledger } = await fixture();
    const registration = coordinator.registerDisposer(
      {
        disposerId: 'disposer-a',
        scopeId: 'scope-root',
        idempotencyKey: 'dispose-a',
        resourceType: 'temp_directory',
        resourceDigest: 'd'.repeat(64),
      },
      async () => undefined,
    );

    expect(coordinator.snapshot().registeredDisposerCount).toBe(0);
    const descriptor = await registration;
    const events = await ledger.reconstruct();

    expect(descriptor.ordinal).toBe(1);
    expect(coordinator.snapshot().registeredDisposerCount).toBe(1);
    expect(events.at(-1)).toMatchObject({
      kind: 'disposer.registered',
      payload: {
        disposerId: 'disposer-a',
        scopeId: 'scope-root',
        ordinal: 1,
        idempotencyKey: 'dispose-a',
        resourceDigest: 'd'.repeat(64),
      },
    });
    expect(JSON.stringify(events)).not.toContain('handler');
  });

  it('fails finalization without a receipt or terminal when admitted registration storage stalls', async () => {
    const { coordinator, ledger } = await fixture();
    const append = ledger.append.bind(ledger);
    let releaseRegistration!: () => void;
    const registrationBlock = new Promise<void>((resolve) => (releaseRegistration = resolve));
    vi.spyOn(ledger, 'append').mockImplementation((input, expectedTip) =>
      input.kind === 'disposer.registered'
        ? registrationBlock.then(() => append(input, expectedTip))
        : append(input, expectedTip),
    );
    const registration = coordinator.registerDisposer(
      {
        disposerId: 'stalled-disposer',
        scopeId: 'scope-root',
        idempotencyKey: 'stalled-key',
        resourceType: 'test',
        resourceDigest: 'a'.repeat(64),
      },
      async () => undefined,
    );
    await expectCode(
      coordinator.finalize({ timeoutMs: 10, outcome: 'completed' }),
      'FINALIZATION_STORAGE_UNCERTAIN',
    );
    releaseRegistration();
    await registration;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const events = await ledger.reconstruct();
    expect(events.some((event) => event.kind === 'finalization.receipt')).toBe(false);
    expect(events.some((event) => event.kind === 'trajectory.terminal')).toBe(false);
  });

  it('drains an admitted cooperative operation before completed finalization', async () => {
    const { coordinator, ledger } = await fixture();
    let complete!: (value: string) => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => (markEntered = resolve));
    const operation = coordinator.runOperation(
      {
        operationId: 'operation-drain',
        scopeId: 'scope-root',
        operationType: 'cooperative',
        inputDigest: '3'.repeat(64),
      },
      async () =>
        new Promise<string>((resolve) => {
          complete = resolve;
          markEntered();
        }),
    );
    await entered;

    const finalization = coordinator.finalize({ timeoutMs: 1_000, outcome: 'completed' });
    complete('drained-result');

    await expect(operation).resolves.toBe('drained-result');
    await expect(finalization).resolves.toMatchObject({
      status: 'complete',
      quiescence: 'confirmed',
      unresolvedOperationCount: 0,
    });
    const events = await ledger.reconstruct();
    expect(events.filter((event) => event.kind === 'cancellation.requested')).toHaveLength(0);
    expect(events.find((event) => event.kind === 'operation.settled')).toMatchObject({
      payload: { outcome: 'completed', lateResultDiscarded: false },
    });
  });

  it('rejects an operation ID reused after settlement', async () => {
    const { coordinator } = await fixture();
    const input = {
      operationId: 'operation-once',
      scopeId: 'scope-root',
      operationType: 'work',
      inputDigest: '4'.repeat(64),
    };
    await coordinator.runOperation(input, async () => 'first');

    await expectCode(
      coordinator.runOperation(input, async () => 'second'),
      'DUPLICATE_OPERATION',
    );
  });

  it('runs child-before-parent LIFO, continues after failure, and coalesces finalize/dispose', async () => {
    const { coordinator, ledger } = await fixture();
    await coordinator.openScope({
      scopeId: 'scope-child',
      parentScopeId: 'scope-root',
      scopeType: 'child',
    });
    const calls: string[] = [];
    const register = async (disposerId: string, scopeId: string, fails = false) =>
      coordinator.registerDisposer(
        {
          disposerId,
          scopeId,
          idempotencyKey: `key-${disposerId}`,
          resourceType: 'test',
          resourceDigest: disposerId
            .charCodeAt(disposerId.length - 1)
            .toString(16)
            .padStart(64, '0'),
        },
        async () => {
          calls.push(disposerId);
          if (fails) throw Object.assign(new Error('hidden'), { code: 'EXPECTED_FAILURE' });
        },
      );
    await register('parent-1', 'scope-root');
    await register('child-1', 'scope-child');
    await register('parent-2', 'scope-root');
    await register('child-2', 'scope-child', true);

    const finalized = coordinator.finalize({ timeoutMs: 1_000, outcome: 'completed' });
    const disposed = coordinator.dispose({ timeoutMs: 1_000, outcome: 'completed' });
    const [first, second] = await Promise.all([finalized, disposed]);
    const events = await ledger.reconstruct();

    expect(first).toEqual(second);
    expect(calls).toEqual(['child-2', 'child-1', 'parent-2', 'parent-1']);
    expect(first.failedDisposerCount).toBe(1);
    expect(events.filter((event) => event.kind === 'trajectory.terminal')).toHaveLength(1);
    expect(events.find((event) => event.kind === 'trajectory.terminal')).toMatchObject({
      payload: { outcome: 'failed', cleanupOutcome: 'failed' },
    });
    expect(
      events.filter((event) => event.kind === 'scope.closed').map((event) => event.payload.scopeId),
    ).toEqual(['scope-child', 'scope-root']);
  });

  it('times out a noncooperative operation and fences its late result', async () => {
    const { coordinator, ledger } = await fixture();
    let complete!: (value: string) => void;
    const operation = coordinator.runOperation(
      {
        operationId: 'operation-stuck',
        scopeId: 'scope-root',
        operationType: 'noncooperative',
        inputDigest: 'e'.repeat(64),
      },
      async () => new Promise<string>((resolve) => (complete = resolve)),
    );
    await Promise.resolve();

    const receipt = await coordinator.finalize({ timeoutMs: 100, outcome: 'completed' });

    expect(receipt.status).toBe('timed_out');
    expect(receipt.quiescence).toBe('not_confirmed');
    expect(receipt.unresolvedOperationCount).toBeGreaterThan(0);
    complete('too-late');
    await expectCode(operation, 'LATE_RESULT_DISCARDED');
    const events = await ledger.reconstruct();
    expect(events.at(-1)?.kind).toBe('trajectory.terminal');
    expect(events.filter((event) => event.kind === 'trajectory.terminal')).toHaveLength(1);
  });

  it('emits a confirmed zero-count receipt bound to exactly one terminal', async () => {
    const { coordinator, ledger } = await fixture();
    await coordinator.openScope({
      scopeId: 'scope-child',
      parentScopeId: 'scope-root',
      scopeType: 'child',
    });
    await coordinator.registerDisposer(
      {
        disposerId: 'disposer-a',
        scopeId: 'scope-child',
        idempotencyKey: 'key-a',
        resourceType: 'test',
        resourceDigest: 'f'.repeat(64),
      },
      async () => undefined,
    );

    const receipts = await Promise.all(
      Array.from({ length: 4 }, () =>
        coordinator.finalize({ timeoutMs: 1_000, outcome: 'completed' }),
      ),
    );
    const events = await ledger.reconstruct();
    const receiptEvent = events.find((event) => event.kind === 'finalization.receipt');
    const terminal = events.find((event) => event.kind === 'trajectory.terminal');
    const receiptIndex = events.findIndex((event) => event.kind === 'finalization.receipt');
    const predecessor = events[receiptIndex - 1];

    expect(receipts.every((receipt) => receipt.quiescence === 'confirmed')).toBe(true);
    expect(receiptEvent).toMatchObject({
      payload: {
        unresolvedOperationCount: 0,
        unresolvedScopeCount: 0,
        unresolvedDisposerCount: 0,
        quiescence: 'confirmed',
        predecessorSequence: predecessor.sequence,
        predecessorHash: predecessor.hash,
      },
    });
    expect(terminal?.payload.receiptEventId).toBe(receiptEvent?.eventId);
    expect(events.filter((event) => event.kind === 'trajectory.terminal')).toHaveLength(1);
    expect(
      events.filter((event) => event.kind === 'scope.closed').map((event) => event.payload.outcome),
    ).toEqual(['completed', 'completed']);
    expect(foldTrajectory(events)).toEqual(foldTrajectory(structuredClone(events)));
    expect(await ledger.reconstruct()).toEqual(events);
  });
});

describe('LifecycleCoordinator recovery', () => {
  it('recovers one quiescent root at the next writer epoch and continues to terminal', async () => {
    const { ledger } = await fixture();
    const checkpointTip = await ledger.tip();
    const recovered = await LifecycleCoordinator.recover({
      ledger,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      checkpointHash: 'b'.repeat(64),
      checkpointTip,
      writerEpoch: 8,
      reasonCode: 'checkpoint_resume',
    });

    await expect(
      recovered.runOperation(
        {
          operationId: 'after-recovery',
          scopeId: recovered.rootScopeId,
          operationType: 'resume-work',
          inputDigest: 'c'.repeat(64),
        },
        async () => 'continued',
      ),
    ).resolves.toBe('continued');
    await expect(
      recovered.finalize({ timeoutMs: 1_000, outcome: 'completed' }),
    ).resolves.toMatchObject({ status: 'complete', quiescence: 'confirmed' });
    const events = await ledger.reconstruct();
    expect(events.filter((event) => event.kind === 'scope.opened')).toHaveLength(1);
    expect(events.find((event) => event.kind === 'trajectory.recovered')).toMatchObject({
      payload: {
        checkpointHash: 'b'.repeat(64),
        previousWriterEpoch: 7,
        writerEpoch: 8,
        reasonCode: 'checkpoint_resume',
      },
    });
    expect(foldTrajectory(events).latestWriterEpoch).toBe(8);
  });

  it('allows only one concurrent recovery at the same checkpoint tip', async () => {
    const { ledger } = await fixture();
    const checkpointTip = await ledger.tip();
    const input = {
      ledger,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      checkpointHash: 'd'.repeat(64),
      checkpointTip,
      writerEpoch: 8,
      reasonCode: 'checkpoint_resume',
    };

    const results = await Promise.allSettled([
      LifecycleCoordinator.recover(input),
      LifecycleCoordinator.recover(input),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      (await ledger.reconstruct()).filter((event) => event.kind === 'trajectory.recovered'),
    ).toHaveLength(1);
  });

  it('preserves historical operation and disposer idempotency fences across recovery', async () => {
    const { ledger, coordinator } = await fixture();
    await coordinator.runOperation(
      {
        operationId: 'same-operation',
        scopeId: coordinator.rootScopeId,
        operationType: 'test',
        inputDigest: 'a'.repeat(64),
      },
      async () => 'settled',
    );
    const descriptor = await coordinator.registerDisposer(
      {
        disposerId: 'settled-disposer',
        scopeId: coordinator.rootScopeId,
        idempotencyKey: 'settled-key',
        resourceType: 'test',
        resourceDigest: 'b'.repeat(64),
      },
      async () => undefined,
    );
    const registered = (await ledger.reconstruct()).at(-1)!;
    const started = await ledger.append({
      eventId: 'settled-disposer-started',
      kind: 'disposer.started',
      occurredAtMs: 11,
      causalEventIds: [registered.eventId],
      payload: { disposerId: descriptor.disposerId },
    });
    await ledger.append({
      eventId: 'settled-disposer-finished',
      kind: 'disposer.settled',
      occurredAtMs: 12,
      causalEventIds: [started.event.eventId],
      payload: { disposerId: descriptor.disposerId, outcome: 'completed', errorCode: null },
    });
    const recovered = await LifecycleCoordinator.recover({
      ledger,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      checkpointHash: 'c'.repeat(64),
      checkpointTip: await ledger.tip(),
      writerEpoch: 8,
    });

    await expectCode(
      recovered.runOperation(
        {
          operationId: 'same-operation',
          scopeId: recovered.rootScopeId,
          operationType: 'test',
          inputDigest: 'd'.repeat(64),
        },
        async () => 'duplicate',
      ),
      'DUPLICATE_OPERATION',
    );
    const duplicateHandler = vi.fn(async () => undefined);
    await expect(
      recovered.registerDisposer(
        {
          disposerId: 'settled-disposer',
          scopeId: recovered.rootScopeId,
          idempotencyKey: 'settled-key',
          resourceType: 'test',
          resourceDigest: 'b'.repeat(64),
        },
        duplicateHandler,
      ),
    ).resolves.toEqual(descriptor);
    expect(duplicateHandler).not.toHaveBeenCalled();
    expect(
      (await ledger.reconstruct()).filter((event) => event.kind === 'disposer.registered'),
    ).toHaveLength(1);
  });

  it('rejects tip, epoch, identity, terminal, active-operation, and pending-disposer recovery', async () => {
    const tipFixture = await fixture();
    const tip = await tipFixture.ledger.tip();
    await expectCode(
      LifecycleCoordinator.recover({
        ledger: tipFixture.ledger,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        checkpointHash: 'e'.repeat(64),
        checkpointTip: { ...tip, hash: 'f'.repeat(64) },
        writerEpoch: 8,
      }),
      'RECOVERY_TIP_MISMATCH',
    );
    await expectCode(
      LifecycleCoordinator.recover({
        ledger: tipFixture.ledger,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        checkpointHash: 'e'.repeat(64),
        checkpointTip: tip,
        writerEpoch: 9,
      }),
      'RECOVERY_EPOCH_MISMATCH',
    );
    await expectCode(
      LifecycleCoordinator.recover({
        ledger: tipFixture.ledger,
        workspaceId: 'workspace-other',
        sessionId: 'session-a',
        checkpointHash: 'e'.repeat(64),
        checkpointTip: tip,
        writerEpoch: 8,
      }),
      'RECOVERY_IDENTITY_MISMATCH',
    );

    const disposerFixture = await fixture();
    await disposerFixture.coordinator.registerDisposer(
      {
        disposerId: 'pending-disposer',
        scopeId: 'scope-root',
        idempotencyKey: 'pending-key',
        resourceType: 'test',
        resourceDigest: '1'.repeat(64),
      },
      async () => undefined,
    );
    await expectCode(
      LifecycleCoordinator.recover({
        ledger: disposerFixture.ledger,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        checkpointHash: '2'.repeat(64),
        checkpointTip: await disposerFixture.ledger.tip(),
        writerEpoch: 8,
      }),
      'RECOVERY_REBIND_REQUIRED',
    );

    const operationFixture = await fixture();
    const rootOpen = (await operationFixture.ledger.reconstruct()).at(-1)!;
    await operationFixture.ledger.append({
      eventId: 'stale-operation',
      kind: 'operation.started',
      occurredAtMs: 10,
      causalEventIds: [rootOpen.eventId],
      payload: {
        operationId: 'stale-operation',
        scopeId: 'scope-root',
        operationType: 'test',
        inputDigest: '3'.repeat(64),
      },
    });
    await expectCode(
      LifecycleCoordinator.recover({
        ledger: operationFixture.ledger,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        checkpointHash: '4'.repeat(64),
        checkpointTip: await operationFixture.ledger.tip(),
        writerEpoch: 8,
      }),
      'RECOVERY_NONQUIESCENT',
    );

    const childFixture = await fixture();
    await childFixture.coordinator.openScope({
      scopeId: 'open-child',
      parentScopeId: 'scope-root',
      scopeType: 'child',
    });
    await expectCode(
      LifecycleCoordinator.recover({
        ledger: childFixture.ledger,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        checkpointHash: '7'.repeat(64),
        checkpointTip: await childFixture.ledger.tip(),
        writerEpoch: 8,
      }),
      'RECOVERY_ROOT_INVALID',
    );

    const terminalFixture = await fixture();
    await terminalFixture.coordinator.finalize({ timeoutMs: 1_000, outcome: 'completed' });
    await expectCode(
      LifecycleCoordinator.recover({
        ledger: terminalFixture.ledger,
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        checkpointHash: '5'.repeat(64),
        checkpointTip: await terminalFixture.ledger.tip(),
        writerEpoch: 8,
      }),
      'RECOVERY_TERMINAL',
    );
  });
});
