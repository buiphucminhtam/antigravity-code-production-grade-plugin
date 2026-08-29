import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  McpRuntimeLifecycle,
  RuntimeShutdownController,
  StartupFailureCleanupController,
  lifecycleShutdownTimeoutMs,
  openRuntimeAfterLease,
} from './mcp-runtime-lifecycle.js';
import { RuntimeCheckpointStore } from './runtime-checkpoint.js';

const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forgewright-mcp-runtime-'));
  roots.push(root);
  return root;
}

function fakeRuntime(events: string[], finalizeError?: Error) {
  return {
    coordinator: {
      cancel: vi.fn(async () => {
        events.push('cancel');
      }),
      finalize: vi.fn(async () => {
        events.push('finalize');
        if (finalizeError) throw finalizeError;
        return { quiescence: 'confirmed' as const };
      }),
    },
  };
}

describe('McpRuntimeLifecycle identity and trajectory setup', () => {
  it('opens one provider-neutral trajectory with stable shared identity', async () => {
    const root = tempRoot();
    const runtime = await McpRuntimeLifecycle.open({
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      env: { FORGEWRIGHT_TRAJECTORY_ROOT: root },
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    });

    expect(runtime.workspaceId).toBe('workspace-a');
    expect(runtime.sessionId).toBe('session-a');
    expect(runtime.trajectoryId).toBe('mcp-11111111-2222-4333-8444-555555555555');
    expect(runtime.gatewayContext).toEqual({ lifecycle: runtime.coordinator });
    const events = await runtime.ledger.reconstruct();
    expect(events.slice(0, 2)).toMatchObject([
      {
        kind: 'trajectory.opened',
        payload: {
          workspaceId: 'workspace-a',
          sessionId: 'session-a',
          origin: 'mcp-runtime',
          writerEpoch: 1,
        },
      },
      {
        kind: 'scope.opened',
        payload: { scopeId: runtime.rootScopeId, parentScopeId: null, scopeType: 'root' },
      },
    ]);
    expect(events[0]?.payload).not.toHaveProperty('objective');
    expect((events[0]?.payload as { objectiveDigest?: string }).objectiveDigest).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('fails closed when an explicit trajectory id collides', async () => {
    const root = tempRoot();
    const input = {
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      env: {
        FORGEWRIGHT_TRAJECTORY_ROOT: root,
        FORGEWRIGHT_TRAJECTORY_ID: 'explicit-trajectory',
      },
    };
    await McpRuntimeLifecycle.open(input);
    await expect(McpRuntimeLifecycle.open(input)).rejects.toMatchObject({ code: 'INVALID_EVENT' });
  });

  it('creates and resumes an exact runtime checkpoint with a fenced writer epoch', async () => {
    const trajectoryRoot = tempRoot();
    const checkpointRoot = tempRoot();
    const capabilityHash = 'c'.repeat(64);
    const treeFingerprint = `TREE:${'d'.repeat(64)}`;
    const nowMs = Date.now();
    const opened = await McpRuntimeLifecycle.open({
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      env: { FORGEWRIGHT_TRAJECTORY_ROOT: trajectoryRoot },
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    });
    const store = new RuntimeCheckpointStore(checkpointRoot);
    const checkpoint = await opened.checkpoint(
      store,
      'pre-compaction',
      capabilityHash,
      treeFingerprint,
      { steps: 4, tools: 5, deadlineAtMs: nowMs + 60_000 },
      nowMs,
    );

    const resumed = await McpRuntimeLifecycle.resumeFromCheckpoint({
      checkpointStore: store,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      capabilityHash,
      treeFingerprint,
      env: { FORGEWRIGHT_TRAJECTORY_ROOT: trajectoryRoot },
    });

    expect(resumed.writerEpoch).toBe(2);
    expect(resumed.trajectoryId).toBe(opened.trajectoryId);
    expect(await resumed.ledger.reconstruct()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'trajectory.recovered',
          payload: expect.objectContaining({
            checkpointHash: checkpoint.hash,
            previousWriterEpoch: 1,
            writerEpoch: 2,
          }),
        }),
      ]),
    );
  });
});

describe('RuntimeShutdownController', () => {
  it('cancels before finalizing a signal and cleans up in exact order', async () => {
    const events: string[] = [];
    const shutdown = new RuntimeShutdownController({
      runtime: fakeRuntime(events),
      timeoutMs: 50,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
    });

    const result = await shutdown.close('SIGTERM');

    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
    expect(result.outcome).toBe('cancelled');
    expect(result.quiescence).toBe('confirmed');
  });

  it('drains stdin as completed without cancellation', async () => {
    const events: string[] = [];
    const runtime = fakeRuntime(events);
    const shutdown = new RuntimeShutdownController({
      runtime,
      timeoutMs: 50,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
    });

    const result = await shutdown.close('stdin-eof');

    expect(events).toEqual(['finalize', 'release', 'close']);
    expect(runtime.coordinator.cancel).not.toHaveBeenCalled();
    expect(result.outcome).toBe('completed');
  });

  it('coalesces duplicate shutdown events onto one close operation', async () => {
    const events: string[] = [];
    const shutdown = new RuntimeShutdownController({
      runtime: fakeRuntime(events),
      timeoutMs: 50,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
    });

    const first = shutdown.close('SIGINT');
    const second = shutdown.close('stdin-close');

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
  });

  it('reports lifecycle failure without confirmed quiescence and still releases then closes', async () => {
    const events: string[] = [];
    const logs: string[] = [];
    const shutdown = new RuntimeShutdownController({
      runtime: fakeRuntime(events, new Error('ledger unavailable')),
      timeoutMs: 50,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
      log: (message) => logs.push(message),
    });

    const result = await shutdown.close('fatal');

    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
    expect(result.quiescence).toBe('not_confirmed');
    expect(result.diagnostics).toEqual(['LIFECYCLE_FINALIZE_FAILED']);
    expect(logs.join('\n')).toContain('quiescence not confirmed');
  });

  it('aggregates cleanup diagnostics in stable lifecycle/lease/server order', async () => {
    const events: string[] = [];
    const shutdown = new RuntimeShutdownController({
      runtime: fakeRuntime(events, new Error('finalize')),
      timeoutMs: 50,
      releaseLease: async () => {
        events.push('release');
        throw new Error('release');
      },
      closeServer: async () => {
        events.push('close');
        throw new Error('close');
      },
    });

    const result = await shutdown.close('connect-failed');

    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
    expect(result.diagnostics).toEqual([
      'LIFECYCLE_FINALIZE_FAILED',
      'LEASE_RELEASE_FAILED',
      'SERVER_CLOSE_FAILED',
    ]);
  });

  it('bounds a hanging finalization attempt before cleanup', async () => {
    const events: string[] = [];
    const runtime = {
      coordinator: {
        cancel: vi.fn(async () => {
          events.push('cancel');
        }),
        finalize: vi.fn(async () => {
          events.push('finalize');
          return new Promise<never>(() => undefined);
        }),
      },
    };
    const shutdown = new RuntimeShutdownController({
      runtime,
      timeoutMs: 10,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
    });

    const result = await shutdown.close('fatal');

    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
    expect(result.quiescence).toBe('not_confirmed');
    expect(result.diagnostics).toEqual(['LIFECYCLE_FINALIZE_TIMEOUT']);
  });

  it('bounds hanging cancellation and still attempts finalization and cleanup', async () => {
    const events: string[] = [];
    const runtime = {
      coordinator: {
        cancel: vi.fn(async () => {
          events.push('cancel');
          return new Promise<never>(() => undefined);
        }),
        finalize: vi.fn(async () => {
          events.push('finalize');
          return { quiescence: 'confirmed' as const };
        }),
      },
    };
    const shutdown = new RuntimeShutdownController({
      runtime,
      timeoutMs: 10,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
    });

    const result = await shutdown.close('SIGINT');

    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
    expect(result.quiescence).toBe('not_confirmed');
    expect(result.diagnostics).toEqual(['LIFECYCLE_CANCEL_TIMEOUT']);
  });

  it('does not confirm quiescence when cancellation delivery fails', async () => {
    const events: string[] = [];
    const runtime = {
      coordinator: {
        cancel: vi.fn(async () => {
          events.push('cancel');
          throw new Error('cancel rejected');
        }),
        finalize: vi.fn(async () => {
          events.push('finalize');
          return { quiescence: 'confirmed' as const };
        }),
      },
    };
    const shutdown = new RuntimeShutdownController({
      runtime,
      timeoutMs: 50,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
    });

    const result = await shutdown.close('fatal');

    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
    expect(result.quiescence).toBe('not_confirmed');
    expect(result.diagnostics).toEqual(['LIFECYCLE_CANCEL_FAILED']);
  });

  it('bounds hanging lease and server cleanup attempts in order', async () => {
    const events: string[] = [];
    const shutdown = new RuntimeShutdownController({
      runtime: fakeRuntime(events),
      timeoutMs: 10,
      releaseLease: async () => {
        events.push('release');
        return new Promise<never>(() => undefined);
      },
      closeServer: async () => {
        events.push('close');
        return new Promise<never>(() => undefined);
      },
    });

    const result = await shutdown.close('stdin-close');

    expect(events).toEqual(['finalize', 'release', 'close']);
    expect(result.diagnostics).toEqual(['LEASE_RELEASE_TIMEOUT', 'SERVER_CLOSE_TIMEOUT']);
  });

  it('shares one absolute deadline across four hanging shutdown stages', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const events: string[] = [];
    const never = async (event: string) => {
      events.push(event);
      return new Promise<never>(() => undefined);
    };
    const timeoutMs = 20;
    const shutdown = new RuntimeShutdownController({
      runtime: {
        coordinator: {
          cancel: async () => never('cancel'),
          finalize: async () => never('finalize'),
        },
      },
      timeoutMs,
      releaseLease: async () => never('release'),
      closeServer: async () => never('close'),
    });
    const startedAtMs = Date.now();

    const closing = shutdown.close('fatal');
    await vi.advanceTimersByTimeAsync(timeoutMs + 4);
    const result = await closing;

    expect(events).toEqual(['cancel', 'finalize', 'release', 'close']);
    expect(Date.now() - startedAtMs).toBeLessThanOrEqual(timeoutMs + 4);
    expect(result.quiescence).toBe('not_confirmed');
    expect(result.diagnostics).toEqual([
      'LIFECYCLE_CANCEL_TIMEOUT',
      'LIFECYCLE_FINALIZE_TIMEOUT',
      'LEASE_RELEASE_TIMEOUT',
      'SERVER_CLOSE_TIMEOUT',
    ]);
  });
});

describe('StartupFailureCleanupController', () => {
  it('cleans a lifecycle-open failure by releasing before closing exactly once', async () => {
    const events: string[] = [];
    const cleanup = new StartupFailureCleanupController({
      timeoutMs: 50,
      releaseLease: async () => events.push('release'),
      closeServer: async () => events.push('close'),
    });

    const opening = openRuntimeAfterLease(async () => {
      events.push('open');
      throw new Error('trajectory collision');
    }, cleanup);

    await expect(opening).rejects.toThrow('trajectory collision');
    await Promise.all([cleanup.close(), cleanup.close()]);
    expect(events).toEqual(['open', 'release', 'close']);
  });
});

describe('lifecycleShutdownTimeoutMs', () => {
  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])('rejects invalid timeout %s', (value) => {
    expect(() =>
      lifecycleShutdownTimeoutMs({ FORGEWRIGHT_LIFECYCLE_SHUTDOWN_TIMEOUT_MS: value }),
    ).toThrow('FORGEWRIGHT_LIFECYCLE_SHUTDOWN_TIMEOUT_MS must be a positive integer');
  });

  it('uses a bounded positive default', () => {
    expect(lifecycleShutdownTimeoutMs({})).toBeGreaterThan(0);
  });
});
