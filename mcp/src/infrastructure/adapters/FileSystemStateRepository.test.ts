import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STATE, parsePipelineState } from '../../core/models/PipelineState.js';
import { FileSystemStateRepository, StatePersistenceError } from './FileSystemStateRepository.js';

const workspaces: string[] = [];

function workspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forgewright-state-'));
  workspaces.push(directory);
  return directory;
}

function repository(root: string, options = {}) {
  return new FileSystemStateRepository(root, 'pipeline-state.json', parsePipelineState, options);
}

function stateFile(root: string): string {
  return path.join(root, '.forgewright', 'pipeline-state.json');
}

function outside(root: string): string {
  const directory = path.join(root, '..', `${path.basename(root)}-outside`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of workspaces.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('FileSystemStateRepository', () => {
  it('rejects unsafe workspace components, traversal filenames, and preserves external sentinels', async () => {
    const root = workspace();
    const external = outside(root);
    const sentinel = path.join(external, 'sentinel');
    fs.writeFileSync(sentinel, 'safe');
    fs.symlinkSync(
      external,
      path.join(root, '.forgewright'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => repository(root)).toThrow(StatePersistenceError);
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('safe');

    const clean = workspace();
    expect(
      () => new FileSystemStateRepository(clean, '../escape.json', parsePipelineState),
    ).toThrow(StatePersistenceError);
  });

  it('rejects symlinked state and lock files and oversized state without changing external targets', async () => {
    const root = workspace();
    const external = outside(root);
    const sentinel = path.join(external, 'sentinel');
    fs.writeFileSync(sentinel, 'safe');
    fs.mkdirSync(path.join(root, '.forgewright'));
    if (process.platform !== 'win32') {
      fs.symlinkSync(sentinel, stateFile(root));
      expect(() => repository(root)).toThrow(StatePersistenceError);
      fs.unlinkSync(stateFile(root));
      fs.symlinkSync(sentinel, `${stateFile(root)}.lock`);
      expect(() => repository(root)).toThrow(StatePersistenceError);
      expect(fs.readFileSync(sentinel, 'utf-8')).toBe('safe');
      fs.unlinkSync(`${stateFile(root)}.lock`);
    }
    await expect(
      repository(root, { maxStateBytes: 20 }).save(DEFAULT_STATE),
    ).rejects.toBeInstanceOf(StatePersistenceError);
  });
  it.each([0, -1, Number.NaN, Infinity, 17 * 1024 * 1024])(
    'rejects invalid state size cap %s',
    (maxStateBytes) => {
      expect(() => repository(workspace(), { maxStateBytes })).toThrow(StatePersistenceError);
    },
  );
  it('loads valid legacy raw state and migrates it into a revisioned envelope on write', async () => {
    const root = workspace();
    const file = stateFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_STATE), 'utf-8');

    const repo = repository(root);
    expect(await repo.load()).toEqual(DEFAULT_STATE);
    await repo.save(DEFAULT_STATE);

    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
      schemaVersion: 1,
      revision: 1,
      state: DEFAULT_STATE,
    });
  });

  it('fails closed for corrupt JSON, invalid raw state, and invalid envelopes', async () => {
    const root = workspace();
    const file = stateFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const repo = repository(root);

    for (const value of [
      '{',
      JSON.stringify({ currentPhase: 99 }),
      JSON.stringify({ schemaVersion: 2, revision: 1, state: DEFAULT_STATE }),
    ]) {
      fs.writeFileSync(file, value, 'utf-8');
      await expect(repo.load()).rejects.toBeInstanceOf(StatePersistenceError);
    }
  });

  it('serializes same-process transactions without losing read-modify-write updates', async () => {
    const root = workspace();
    const repo = repository(root);
    await repo.save(DEFAULT_STATE);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repo.transact(async (state) => ({
          ...state!,
          history: [...state!.history, `update-${index}`],
        })),
      ),
    );

    const loaded = await repo.load();
    expect(loaded?.history).toHaveLength(20);
    expect(JSON.parse(fs.readFileSync(stateFile(root), 'utf-8')).revision).toBe(21);
  });

  it('never reclaims a live owner by age and recovers only a dead stale owner', async () => {
    const root = workspace();
    const repo = repository(root, { lockTimeoutMs: 40, lockStaleMs: 10, lockRetryMs: 5 });
    const lockFile = `${stateFile(root)}.lock`;
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    const ownerToken = '00000000-0000-4000-8000-000000000000';
    fs.writeFileSync(
      lockFile,
      JSON.stringify({
        version: 1,
        ownerToken,
        pid: process.pid,
        createdAtMs: Date.now() - 20_000,
      }),
      'utf-8',
    );
    const stale = new Date(Date.now() - 20_000);
    fs.utimesSync(lockFile, stale, stale);

    await expect(repo.save(DEFAULT_STATE)).rejects.toThrow('Timed out acquiring state lock');
    expect(fs.existsSync(lockFile)).toBe(true);

    fs.unlinkSync(lockFile);
    const deadOwner = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
    expect(deadOwner).toBeTypeOf('number');
    fs.writeFileSync(
      lockFile,
      JSON.stringify({
        version: 1,
        ownerToken,
        pid: deadOwner,
        createdAtMs: Date.now() - 20_000,
      }),
      'utf-8',
    );
    fs.utimesSync(lockFile, stale, stale);
    await repo.save(DEFAULT_STATE);
    expect(fs.existsSync(lockFile)).toBe(false);
    expect(await repo.load()).toEqual(DEFAULT_STATE);
  });

  it('never removes a replacement lock when a stale owner finishes', async () => {
    const root = workspace();
    const repo = repository(root);
    const lockFile = `${stateFile(root)}.lock`;

    const lockHarness = repo as unknown as {
      withLock(operation: () => Promise<void>): Promise<void>;
    };
    await lockHarness.withLock(async () => {
      fs.unlinkSync(lockFile);
      fs.writeFileSync(lockFile, 'replacement-owner-token', 'utf-8');
    });

    expect(fs.readFileSync(lockFile, 'utf-8')).toBe('replacement-owner-token');
  });

  it('does not mask an operation error with a lock cleanup error', async () => {
    const root = workspace();
    const repo = repository(root);
    const lockFile = `${stateFile(root)}.lock`;
    const operationError = new Error('operation failed');
    const cleanupError = new Error('cleanup failed');
    const originalReadFileSync = fs.readFileSync;
    const readFileSync = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      if (file === lockFile) throw cleanupError;
      return originalReadFileSync(file, ...args);
    });
    const lockHarness = repo as unknown as {
      withLock(operation: () => Promise<void>): Promise<void>;
    };

    await expect(lockHarness.withLock(async () => Promise.reject(operationError))).rejects.toBe(
      operationError,
    );
    readFileSync.mockRestore();
  });

  it('surfaces a non-ENOENT lock cleanup error after a successful operation', async () => {
    const root = workspace();
    const repo = repository(root);
    const lockFile = `${stateFile(root)}.lock`;
    const cleanupError = new Error('cleanup failed');
    const originalReadFileSync = fs.readFileSync;
    const readFileSync = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      if (file === lockFile) throw cleanupError;
      return originalReadFileSync(file, ...args);
    });
    const lockHarness = repo as unknown as {
      withLock(operation: () => Promise<void>): Promise<void>;
    };

    await expect(lockHarness.withLock(async () => undefined)).rejects.toBe(cleanupError);
    readFileSync.mockRestore();
  });

  it('preserves the prior state and removes its temporary file when rename fails', async () => {
    const root = workspace();
    const repo = repository(root);
    await repo.save(DEFAULT_STATE);
    const file = stateFile(root);
    const original = fs.readFileSync(file, 'utf-8');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('injected rename failure');
    });

    await expect(repo.save({ ...DEFAULT_STATE, currentMode: 'Changed' })).rejects.toThrow(
      StatePersistenceError,
    );
    rename.mockRestore();

    expect(fs.readFileSync(file, 'utf-8')).toBe(original);
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.tmp.'))).toEqual([]);
  });

  it('preserves the prior state when writing a replacement fails', async () => {
    const root = workspace();
    const repo = repository(root);
    await repo.save(DEFAULT_STATE);
    const file = stateFile(root);
    const original = fs.readFileSync(file, 'utf-8');
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('injected write failure');
    });

    await expect(repo.save({ ...DEFAULT_STATE, currentMode: 'Changed' })).rejects.toThrow(
      StatePersistenceError,
    );

    expect(fs.readFileSync(file, 'utf-8')).toBe(original);
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.tmp.'))).toEqual([]);
  });
});
