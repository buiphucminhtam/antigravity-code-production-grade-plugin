import fs from 'fs';
import os from 'os';
import path from 'path';
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

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of workspaces.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('FileSystemStateRepository', () => {
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

  it('times out on a fresh cross-process lock and recovers a stale lock', async () => {
    const root = workspace();
    const repo = repository(root, { lockTimeoutMs: 40, lockStaleMs: 10_000, lockRetryMs: 5 });
    const lockFile = `${stateFile(root)}.lock`;
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, 'held', 'utf-8');

    await expect(repo.save(DEFAULT_STATE)).rejects.toThrow('Timed out acquiring state lock');

    const stale = new Date(Date.now() - 20_000);
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
