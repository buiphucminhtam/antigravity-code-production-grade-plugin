import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RuntimeCheckpointError,
  RuntimeCheckpointStore,
  type RuntimeCheckpointInput,
} from './runtime-checkpoint.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'forgewright-runtime-checkpoint-'));
  roots.push(path);
  return path;
}

function input(overrides: Partial<RuntimeCheckpointInput> = {}): RuntimeCheckpointInput {
  return {
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    trajectoryId: 'trajectory-1',
    writerEpoch: 3,
    boundary: 'step-boundary',
    ledgerTip: { sequence: 7, hash: 'b'.repeat(64) },
    capabilityHash: 'c'.repeat(64),
    treeFingerprint: `TREE:${'d'.repeat(64)}`,
    snapshot: {
      state: 'ACTIVE',
      activeOperationCount: 0,
      openScopeCount: 1,
      registeredDisposerCount: 0,
    },
    budget: { steps: 3, tools: 4, deadlineAtMs: 2_000 },
    ...overrides,
  };
}

function expected(value: RuntimeCheckpointInput, checkpointHash: string) {
  return {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    trajectoryId: value.trajectoryId,
    checkpointHash,
    capabilityHash: value.capabilityHash,
    treeFingerprint: value.treeFingerprint,
    writerEpoch: value.writerEpoch,
    ledgerTip: value.ledgerTip,
  };
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('RuntimeCheckpointStore', () => {
  it('round-trips a quiescent binding and enforces cumulative continuation budgets', () => {
    const store = new RuntimeCheckpointStore(root());
    const checkpointInput = input();
    const checkpoint = store.append(checkpointInput, 1_000);

    const resumed = store.resume(expected(checkpointInput, checkpoint.hash), 1_500);
    expect(resumed).toMatchObject({
      checkpoint: { checkpointId: checkpoint.checkpointId, previousHash: null },
      remainingBudget: { steps: 3, tools: 4 },
      nextWriterEpoch: 4,
      toolAuthority: false,
      requiresWorkspaceRegrounding: true,
    });
    const first = store.consume(
      checkpoint.checkpointId,
      resumed.continuationNonce,
      'request-1',
      1,
      2,
      1_500,
    );
    expect(first).toMatchObject({ remainingSteps: 2, remainingTools: 2 });
    const second = store.consume(
      checkpoint.checkpointId,
      resumed.continuationNonce,
      'request-2',
      2,
      1,
      1_600,
    );
    expect(second).toMatchObject({ remainingSteps: 0, remainingTools: 1 });
    expect(store.resume(expected(checkpointInput, checkpoint.hash), 1_700).remainingBudget).toEqual(
      {
        steps: 0,
        tools: 1,
      },
    );
    expect(() =>
      store.consume(checkpoint.checkpointId, resumed.continuationNonce, 'request-2', 0, 1, 1_700),
    ).toThrowError('CHECKPOINT_REPLAY');
    expect(() =>
      store.consume(checkpoint.checkpointId, resumed.continuationNonce, 'request-3', 1, 0, 1_700),
    ).toThrowError('CHECKPOINT_BUDGET_OVERRUN');
  });

  it('rejects non-quiescent checkpoints, stale bindings, wrong tips, and expiry', () => {
    const store = new RuntimeCheckpointStore(root());
    expect(() =>
      store.append(input({ snapshot: { ...input().snapshot, activeOperationCount: 1 } }), 1_000),
    ).toThrowError('CHECKPOINT_NOT_QUIESCENT');
    const checkpointInput = input();
    const checkpoint = store.append(checkpointInput, 1_000);
    expect(() =>
      store.resume(
        { ...expected(checkpointInput, checkpoint.hash), sessionId: 'other-session' },
        1_500,
      ),
    ).toThrowError('CHECKPOINT_BINDING_MISMATCH');
    expect(() =>
      store.resume(
        {
          ...expected(checkpointInput, checkpoint.hash),
          ledgerTip: { sequence: 8, hash: 'e'.repeat(64) },
        },
        1_500,
      ),
    ).toThrowError('CHECKPOINT_LEDGER_TIP_MISMATCH');
    expect(() => store.resume(expected(checkpointInput, checkpoint.hash), 2_000)).toThrowError(
      'CHECKPOINT_EXPIRED',
    );
  });

  it('rejects corrupt chains, mismatched heads, symlinks, and unexpected entries', () => {
    const storeRoot = root();
    const store = new RuntimeCheckpointStore(storeRoot);
    const checkpointInput = input();
    const checkpoint = store.append(checkpointInput, 1_000);
    const checkpointFile = readdirSync(storeRoot).find((name) => name.startsWith('checkpoint-'))!;
    writeFileSync(join(storeRoot, checkpointFile), '{}');
    expect(() => store.resume(expected(checkpointInput, checkpoint.hash), 1_500)).toThrowError(
      'CHECKPOINT_CHAIN_CORRUPT',
    );

    const headRoot = root();
    const headStore = new RuntimeCheckpointStore(headRoot);
    const headCheckpoint = headStore.append(checkpointInput, 1_000);
    writeFileSync(join(headRoot, 'checkpoint-head.json'), '{}');
    expect(() =>
      headStore.resume(expected(checkpointInput, headCheckpoint.hash), 1_500),
    ).toThrowError('CHECKPOINT_HEAD_MISMATCH');
    expect(() =>
      headStore.append(
        { ...checkpointInput, boundary: 'step-boundary', budget: { ...checkpointInput.budget } },
        1_100,
      ),
    ).toThrowError('CHECKPOINT_HEAD_MISMATCH');

    const outside = root();
    const linked = join(root(), 'linked-root');
    symlinkSync(outside, linked, 'dir');
    expect(() => new RuntimeCheckpointStore(linked)).toThrowError('CHECKPOINT_SYMLINK');
    expect(() => new RuntimeCheckpointStore(join(linked, 'nested'))).toThrowError(
      'CHECKPOINT_SYMLINK',
    );

    const unexpectedRoot = root();
    mkdirSync(join(unexpectedRoot, 'unexpected'));
    expect(() => new RuntimeCheckpointStore(unexpectedRoot)).toThrowError(
      'CHECKPOINT_UNEXPECTED_ENTRY',
    );
  });

  it('rejects unsafe IDs, malformed budgets, and continuation nonce mismatch', () => {
    const store = new RuntimeCheckpointStore(root());
    expect(() => store.append(input({ sessionId: '../escape' }), 1_000)).toThrow(
      RuntimeCheckpointError,
    );
    expect(() =>
      store.append(input({ budget: { steps: 1, tools: 1, deadlineAtMs: 90_000_000 } }), 1_000),
    ).toThrowError('CHECKPOINT_INVALID');
    const checkpoint = store.append(input(), 1_000);
    expect(() =>
      store.consume(checkpoint.checkpointId, 'f'.repeat(64), 'request-1', 1, 0, 1_500),
    ).toThrowError('CHECKPOINT_CONSUME_INVALID');
  });

  it('allows continuation consumption only for the latest checkpoint head', () => {
    const store = new RuntimeCheckpointStore(root());
    const checkpointInput = input();
    const first = store.append(checkpointInput, 1_000);
    store.append({ ...checkpointInput, boundary: 'before-model' }, 1_100);

    expect(() =>
      store.consume(first.checkpointId, first.continuationNonce, 'stale-request', 1, 0, 1_200),
    ).toThrowError('CHECKPOINT_CONSUME_INVALID');
  });

  it('reclaims a dead writer lock but never steals a live one', () => {
    const deadRoot = root();
    const deadStore = new RuntimeCheckpointStore(deadRoot);
    writeFileSync(
      join(deadRoot, '.writer.lock'),
      JSON.stringify({ pid: 2_147_483_647, token: 'dead-token', createdAtMs: 1 }),
    );
    expect(deadStore.append(input(), 1_000)).toMatchObject({ sequence: 1 });

    const liveRoot = root();
    const liveStore = new RuntimeCheckpointStore(liveRoot);
    writeFileSync(
      join(liveRoot, '.writer.lock'),
      JSON.stringify({ pid: process.pid, token: 'live-token', createdAtMs: 1 }),
    );
    expect(() => liveStore.append(input(), 1_000)).toThrowError('CHECKPOINT_BUSY');
  });

  it('holds the checkpoint head fence across asynchronous recovery validation', async () => {
    const store = new RuntimeCheckpointStore(root());
    const checkpointInput = input({
      budget: { steps: 3, tools: 4, deadlineAtMs: Date.now() + 60_000 },
    });
    const checkpoint = store.append(checkpointInput);
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
    const pinned = store.withPinnedLatest(
      {
        workspaceId: checkpoint.workspaceId,
        sessionId: checkpoint.sessionId,
        capabilityHash: checkpoint.capabilityHash,
        treeFingerprint: checkpoint.treeFingerprint,
      },
      async (current) => {
        entered();
        await new Promise<void>((resolve) => (release = resolve));
        return current.hash;
      },
    );
    await enteredPromise;
    expect(() => store.append(checkpointInput)).toThrowError('CHECKPOINT_BUSY');
    release();
    await expect(pinned).resolves.toBe(checkpoint.hash);
  });
});
