import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { IStateRepository } from '../../core/ports/IStateRepository.js';

interface StateEnvelope<T> {
  schemaVersion: 1;
  revision: number;
  state: T;
}

interface StateLockOwner {
  version: 1;
  ownerToken: string;
  pid: number;
  createdAtMs: number;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export interface FileSystemStateRepositoryOptions {
  lockTimeoutMs?: number;
  lockStaleMs?: number;
  lockRetryMs?: number;
  maxStateBytes?: number;
  maxLockBytes?: number;
}

export class StatePersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StatePersistenceError';
  }
}

export class FileSystemStateRepository<T> implements IStateRepository<T> {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly stateFile: string;
  private readonly dirPath: string;
  private readonly lockFile: string;
  private readonly lockTimeoutMs: number;
  private readonly lockStaleMs: number;
  private readonly lockRetryMs: number;
  private readonly maxStateBytes: number;
  private readonly maxLockBytes: number;

  constructor(
    workspacePath: string,
    filename: string = 'state.json',
    private readonly parseState: (value: unknown) => T,
    options: FileSystemStateRepositoryOptions = {},
  ) {
    const workspace = path.resolve(workspacePath);
    const workspaceInfo = fs.lstatSync(workspace);
    if (
      workspaceInfo.isSymbolicLink() ||
      !workspaceInfo.isDirectory() ||
      workspace === path.parse(workspace).root
    ) {
      throw new StatePersistenceError('Workspace must be a non-symlink non-root directory.');
    }
    if (
      path.basename(filename) !== filename ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(filename)
    ) {
      throw new StatePersistenceError('State filename must be a safe basename.');
    }
    this.dirPath = path.join(fs.realpathSync(workspace), '.forgewright');
    this.stateFile = path.join(this.dirPath, filename);
    this.lockFile = `${this.stateFile}.lock`;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.lockStaleMs = options.lockStaleMs ?? 30_000;
    this.lockRetryMs = options.lockRetryMs ?? 10;
    this.maxStateBytes = boundedSize(
      options.maxStateBytes,
      1024 * 1024,
      16 * 1024 * 1024,
      'maxStateBytes',
    );
    this.maxLockBytes = boundedSize(options.maxLockBytes, 1024, 64 * 1024, 'maxLockBytes');
    this.ensureContained(false);
  }

  async load(): Promise<T | null> {
    return this.readEnvelope().state;
  }

  private readEnvelope(): { state: T | null; revision: number } {
    this.ensureContained(false);
    if (!fs.existsSync(this.stateFile)) return { state: null, revision: 0 };
    try {
      const info = fs.lstatSync(this.stateFile);
      if (info.isSymbolicLink() || !info.isFile() || info.size > this.maxStateBytes) {
        throw new StatePersistenceError('State file is unsafe or exceeds its size limit.');
      }
      const fd = fs.openSync(this.stateFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const raw = fs.readFileSync(fd, 'utf-8');
      fs.closeSync(fd);
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'schemaVersion' in parsed &&
        'revision' in parsed &&
        'state' in parsed
      ) {
        const envelope = parsed as Record<string, unknown>;
        if (
          envelope.schemaVersion !== 1 ||
          !Number.isSafeInteger(envelope.revision) ||
          (envelope.revision as number) < 1
        ) {
          throw new StatePersistenceError('Unsupported or invalid state envelope.');
        }
        return {
          state: this.parseState(envelope.state),
          revision: envelope.revision as number,
        };
      }
      // Valid legacy raw state is read at revision 0 and migrated on the next write.
      return { state: this.parseState(parsed), revision: 0 };
    } catch (error) {
      if (error instanceof StatePersistenceError) throw error;
      throw new StatePersistenceError(`Failed to load state from ${this.stateFile}.`, {
        cause: error,
      });
    }
  }

  async save(state: T): Promise<void> {
    await this.withLock(async () => {
      const current = this.readEnvelope();
      this.writeEnvelope(this.parseState(state), current.revision + 1);
    });
  }

  async update(partialState: Partial<T>): Promise<void> {
    await this.transact((currentState) => {
      if (!currentState) {
        throw new StatePersistenceError('Cannot update state before it has been initialized.');
      }
      return { ...currentState, ...partialState } as T;
    });
  }

  async transact(mutator: (state: T | null) => T | null | Promise<T | null>): Promise<T | null> {
    return this.withLock(async () => {
      const current = this.readEnvelope();
      const candidate = await mutator(current.state);
      if (candidate === null) return null;
      const next = this.parseState(candidate);
      this.writeEnvelope(next, current.revision + 1);
      return next;
    });
  }

  private writeEnvelope(state: T, revision: number): void {
    this.ensureContained(true);
    const envelope: StateEnvelope<T> = { schemaVersion: 1, revision, state };
    const tempFile = `${this.stateFile}.tmp.${process.pid}.${randomUUID()}`;
    try {
      const payload = JSON.stringify(envelope, null, 2);
      if (Buffer.byteLength(payload, 'utf-8') > this.maxStateBytes)
        throw new StatePersistenceError('State exceeds its size limit.');
      const fd = fs.openSync(tempFile, 'wx', 0o600);
      fs.writeFileSync(fd, payload, 'utf-8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      this.ensureContained(false);
      fs.renameSync(tempFile, this.stateFile);
      fs.chmodSync(this.stateFile, 0o600);
      this.fsyncDirectory();
    } catch (error) {
      throw new StatePersistenceError(`Failed to save state to ${this.stateFile}.`, {
        cause: error,
      });
    } finally {
      if (fs.existsSync(tempFile) && !fs.lstatSync(tempFile).isSymbolicLink())
        fs.unlinkSync(tempFile);
    }
  }

  private async withLock<R>(operation: () => Promise<R>): Promise<R> {
    const previous = FileSystemStateRepository.queues.get(this.stateFile) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const queue = previous.then(() => current);
    FileSystemStateRepository.queues.set(this.stateFile, queue);
    await previous;

    this.ensureContained(true);
    const deadline = Date.now() + this.lockTimeoutMs;
    let fd: number | undefined;
    let ownerRecordRaw: string | undefined;
    let result!: R;
    let operationError: unknown;
    let hasOperationError = false;
    let cleanupError: unknown;
    try {
      while (fd === undefined) {
        try {
          fd = fs.openSync(this.lockFile, 'wx', 0o600);
          const owner: StateLockOwner = {
            version: 1,
            ownerToken: randomUUID(),
            pid: process.pid,
            createdAtMs: Date.now(),
          };
          ownerRecordRaw = JSON.stringify(owner);
          fs.writeFileSync(fd, ownerRecordRaw, { encoding: 'utf-8' });
          fs.fsyncSync(fd);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw new StatePersistenceError(`Failed to acquire state lock ${this.lockFile}.`, {
              cause: error,
            });
          }
          if (this.removeStaleLock()) continue;
          if (Date.now() >= deadline) {
            throw new StatePersistenceError(`Timed out acquiring state lock ${this.lockFile}.`, {
              cause: error,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs));
        }
      }
      result = await operation();
    } catch (error) {
      hasOperationError = true;
      operationError = error;
    } finally {
      try {
        if (fd !== undefined) {
          fs.closeSync(fd);
          if (
            ownerRecordRaw !== undefined &&
            fs.readFileSync(this.lockFile, 'utf-8') === ownerRecordRaw
          ) {
            fs.unlinkSync(this.lockFile);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupError = error;
      }
      releaseQueue();
      if (FileSystemStateRepository.queues.get(this.stateFile) === queue) {
        FileSystemStateRepository.queues.delete(this.stateFile);
      }
    }
    if (hasOperationError) throw operationError;
    if (cleanupError !== undefined) throw cleanupError;
    return result;
  }

  private removeStaleLock(): boolean {
    try {
      const info = fs.lstatSync(this.lockFile);
      if (info.isSymbolicLink() || !info.isFile() || info.size > this.maxLockBytes) {
        throw new StatePersistenceError('State lock is unsafe.');
      }
      const ageMs = Date.now() - info.mtimeMs;
      if (ageMs < this.lockStaleMs) return false;
      const fd = fs.openSync(this.lockFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let raw: string;
      try {
        raw = fs.readFileSync(fd, 'utf-8');
      } finally {
        fs.closeSync(fd);
      }
      let owner: StateLockOwner;
      try {
        owner = JSON.parse(raw) as StateLockOwner;
      } catch (error) {
        throw new StatePersistenceError('State lock owner record is invalid.', {
          cause: error,
        });
      }
      if (
        owner.version !== 1 ||
        typeof owner.ownerToken !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(owner.ownerToken) ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1 ||
        !Number.isSafeInteger(owner.createdAtMs) ||
        owner.createdAtMs < 0
      ) {
        throw new StatePersistenceError('State lock owner record is invalid.');
      }
      // PID reuse is handled conservatively: a reused live PID preserves the
      // lock and causes a bounded timeout rather than risking a lost update.
      if (processIsAlive(owner.pid)) return false;
      const current = fs.lstatSync(this.lockFile);
      if (
        current.isSymbolicLink() ||
        !current.isFile() ||
        current.dev !== info.dev ||
        current.ino !== info.ino ||
        fs.readFileSync(this.lockFile, 'utf-8') !== raw
      ) {
        return false;
      }
      fs.unlinkSync(this.lockFile);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw new StatePersistenceError(`Failed to inspect state lock ${this.lockFile}.`, {
        cause: error,
      });
    }
  }

  private ensureContained(createDirectory: boolean): void {
    const workspace = path.dirname(this.dirPath);
    const workspaceInfo = fs.lstatSync(workspace);
    if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory())
      throw new StatePersistenceError('Workspace containment is invalid.');
    if (!fs.existsSync(this.dirPath)) {
      if (!createDirectory) return;
      fs.mkdirSync(this.dirPath, { mode: 0o700 });
    }
    const directoryInfo = fs.lstatSync(this.dirPath);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory())
      throw new StatePersistenceError('State directory is unsafe.');
    fs.chmodSync(this.dirPath, 0o700);
    for (const candidate of [this.stateFile, this.lockFile]) {
      if (!fs.existsSync(candidate)) continue;
      const info = fs.lstatSync(candidate);
      if (info.isSymbolicLink() || !info.isFile())
        throw new StatePersistenceError('State path is unsafe.');
    }
  }

  private fsyncDirectory(): void {
    const fd = fs.openSync(this.dirPath, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
}

function boundedSize(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum)
    throw new StatePersistenceError(`${label} must be a positive bounded safe integer.`);
  return result;
}
