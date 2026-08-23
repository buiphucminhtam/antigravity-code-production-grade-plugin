import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LEASE_SCHEMA = 'forgewright-mcp-lifecycle-lease/v1' as const;

export interface ProcessIdentity {
  pid: number;
  pidStartedAt: string;
  pgid: number;
  parentPid: number;
  parentStartedAt: string;
  commandDigest: string;
}

export interface ProcessInspector {
  inspect(pid: number): Promise<ProcessIdentity | null>;
}

export interface SignalSender {
  signal(pid: number, signal: NodeJS.Signals): Promise<void>;
}

export interface LifecycleLease {
  schema: typeof LEASE_SCHEMA;
  leaseId: string;
  ownerToken: string;
  version: number;
  workspaceId: string;
  sessionId: string;
  identity: ProcessIdentity;
  commandDigest: string;
  issuedAtMs: number;
  expiresAtMs: number;
  inFlight: number;
  status: 'open' | 'closed';
  handoff?: {
    fromSessionId: string;
    toSessionId: string;
    atMs: number;
  };
}

interface AcquireInput {
  workspaceId: string;
  sessionId: string;
  identity: ProcessIdentity;
  ttlMs: number;
  inFlight?: number;
}

interface StoreOptions {
  root?: string;
  inspector?: ProcessInspector;
  sender?: SignalSender;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  graceMs?: number;
}

export type ReapResult =
  | 'reaped'
  | 'unowned'
  | 'owner_mismatch'
  | 'identity_mismatch'
  | 'in_flight'
  | 'not_expired'
  | 'dead_reclaimed'
  | 'closed';
export type ReleaseResult =
  'released' | 'unowned' | 'owner_mismatch' | 'version_mismatch' | 'closed';

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameIdentity(left: ProcessIdentity, right: ProcessIdentity): boolean {
  return (
    left.pid === right.pid &&
    left.pidStartedAt === right.pidStartedAt &&
    left.pgid === right.pgid &&
    left.parentPid === right.parentPid &&
    left.parentStartedAt === right.parentStartedAt &&
    left.commandDigest === right.commandDigest
  );
}

function hasBoundCommandIdentity(lease: LifecycleLease): boolean {
  return (
    /^[0-9a-f]{64}$/.test(lease.commandDigest) &&
    lease.commandDigest === lease.identity.commandDigest
  );
}

async function psValue(pid: number, field: string): Promise<string> {
  const { stdout } = await execFileAsync('ps', ['-o', `${field}=`, '-p', String(pid)]);
  return stdout.trim();
}

class SystemProcessInspector implements ProcessInspector {
  async inspect(pid: number): Promise<ProcessIdentity | null> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
      const [pidStartedAt, pgidRaw, parentRaw, command] = await Promise.all([
        psValue(pid, 'lstart'),
        psValue(pid, 'pgid'),
        psValue(pid, 'ppid'),
        psValue(pid, 'command'),
      ]);
      const parentPid = Number.parseInt(parentRaw, 10);
      const pgid = Number.parseInt(pgidRaw, 10);
      const parentStartedAt = parentPid > 0 ? await psValue(parentPid, 'lstart') : '';
      if (
        !pidStartedAt ||
        !command ||
        !Number.isSafeInteger(parentPid) ||
        !Number.isSafeInteger(pgid)
      ) {
        return null;
      }
      return {
        pid,
        pidStartedAt,
        pgid,
        parentPid,
        parentStartedAt,
        commandDigest: digest(command),
      };
    } catch {
      return null;
    }
  }
}

class SystemSignalSender implements SignalSender {
  async signal(pid: number, signal: NodeJS.Signals): Promise<void> {
    process.kill(pid, signal);
  }
}

export class LifecycleLeaseStore {
  readonly root: string;
  private readonly inspector: ProcessInspector;
  private readonly sender: SignalSender;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly graceMs: number;

  constructor(options: StoreOptions = {}) {
    this.root = resolve(
      options.root ??
        process.env.FORGEWRIGHT_MCP_LEASE_ROOT ??
        join(homedir(), '.forgewright', 'runtime', 'mcp-leases'),
    );
    this.inspector = options.inspector ?? new SystemProcessInspector();
    this.sender = options.sender ?? new SystemSignalSender();
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)));
    this.graceMs = options.graceMs ?? 1_000;
  }

  async inspectCurrent(pid = process.pid): Promise<ProcessIdentity> {
    const identity = await this.inspector.inspect(pid);
    if (identity === null) throw new Error(`process_identity_unavailable:${pid}`);
    return identity;
  }

  async acquire(input: AcquireInput): Promise<LifecycleLease> {
    if (
      !input.workspaceId ||
      !input.sessionId ||
      input.ttlMs < 0 ||
      !/^[0-9a-f]{64}$/.test(input.identity.commandDigest)
    ) {
      throw new Error('invalid_lease_input');
    }
    await this.ensureRoot();
    const now = this.now();
    const lease: LifecycleLease = {
      schema: LEASE_SCHEMA,
      leaseId: `mcp-${randomBytes(16).toString('hex')}`,
      ownerToken: randomBytes(32).toString('hex'),
      version: 1,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      identity: { ...input.identity },
      commandDigest: input.identity.commandDigest,
      issuedAtMs: now,
      expiresAtMs: now + input.ttlMs,
      inFlight: input.inFlight ?? 0,
      status: 'open',
    };
    await this.atomicWrite(lease);
    return lease;
  }

  async handoff(
    leaseId: string,
    ownerToken: string,
    version: number,
    sessionId: string,
  ): Promise<LifecycleLease> {
    return this.withLock(leaseId, async () => {
      const current = await this.requireLease(leaseId);
      if (current.ownerToken !== ownerToken) throw new Error('owner_mismatch');
      if (current.version !== version) throw new Error('version_mismatch');
      if (current.status !== 'open') throw new Error('closed');
      const next: LifecycleLease = {
        ...current,
        ownerToken: randomBytes(32).toString('hex'),
        version: current.version + 1,
        sessionId,
        handoff: {
          fromSessionId: current.sessionId,
          toSessionId: sessionId,
          atMs: this.now(),
        },
      };
      await this.atomicWrite(next);
      return next;
    });
  }

  async release(leaseId: string, ownerToken: string, version: number): Promise<ReleaseResult> {
    return this.withLock(leaseId, async () => {
      const current = await this.readLease(leaseId);
      if (current === null) return 'unowned';
      if (current.ownerToken !== ownerToken) return 'owner_mismatch';
      if (current.version !== version) return 'version_mismatch';
      if (current.status === 'closed') return 'closed';
      await this.atomicWrite({
        ...current,
        version: current.version + 1,
        status: 'closed',
        inFlight: 0,
      });
      return 'released';
    });
  }

  async reap(leaseId: string, ownerToken: string): Promise<ReapResult> {
    return this.withLock(leaseId, async () => {
      const initial = await this.readLease(leaseId);
      if (initial === null) return 'unowned';
      if (initial.ownerToken !== ownerToken) return 'owner_mismatch';
      if (initial.status !== 'open') return 'closed';
      if (initial.inFlight > 0) return 'in_flight';
      if (!hasBoundCommandIdentity(initial)) return 'identity_mismatch';

      const observed = await this.inspector.inspect(initial.identity.pid);
      if (observed === null) {
        await this.closeWithinLock(initial);
        return 'dead_reclaimed';
      }
      if (!sameIdentity(initial.identity, observed)) return 'identity_mismatch';
      if (this.now() < initial.expiresAtMs) return 'not_expired';

      const beforeTerm = await this.readLease(leaseId);
      const termIdentity = await this.inspector.inspect(initial.identity.pid);
      const termStatus = this.validateSignalTarget(beforeTerm, initial, ownerToken, termIdentity);
      if (termStatus !== null) return termStatus;

      await this.sender.signal(initial.identity.pid, 'SIGTERM');
      await this.wait(this.graceMs);

      const afterTerm = await this.inspector.inspect(initial.identity.pid);
      if (afterTerm !== null) {
        const beforeKill = await this.readLease(leaseId);
        const killIdentity = await this.inspector.inspect(initial.identity.pid);
        const killStatus = this.validateSignalTarget(beforeKill, initial, ownerToken, killIdentity);
        if (killStatus !== null) return killStatus;
        await this.sender.signal(initial.identity.pid, 'SIGKILL');
      }
      const final = await this.readLease(leaseId);
      if (final === null || final.ownerToken !== ownerToken || final.version !== initial.version) {
        return 'owner_mismatch';
      }
      if (final.status !== 'open') return 'closed';
      await this.closeWithinLock(final);
      return 'reaped';
    });
  }

  async reconcile(): Promise<Array<{ leaseId: string; result: ReapResult | 'reconcile_error' }>> {
    await this.ensureRoot();
    const entries = await readdir(this.root, { withFileTypes: true });
    const leaseIds = entries
      .filter((entry) => entry.isFile() && /^mcp-[a-f0-9]{32}\.json$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .sort();
    const results: Array<{ leaseId: string; result: ReapResult | 'reconcile_error' }> = [];
    for (const leaseId of leaseIds) {
      const lease = await this.readLease(leaseId);
      if (lease === null || lease.status !== 'open') continue;
      try {
        results.push({ leaseId, result: await this.reap(leaseId, lease.ownerToken) });
      } catch {
        results.push({ leaseId, result: 'reconcile_error' });
      }
    }
    return results;
  }

  private validateSignalTarget(
    current: LifecycleLease | null,
    initial: LifecycleLease,
    ownerToken: string,
    observed: ProcessIdentity | null,
  ): ReapResult | null {
    if (current === null) return 'unowned';
    if (current.ownerToken !== ownerToken || current.version !== initial.version) {
      return 'owner_mismatch';
    }
    if (current.status !== 'open') return 'closed';
    if (current.inFlight > 0) return 'in_flight';
    if (
      !hasBoundCommandIdentity(current) ||
      !sameIdentity(current.identity, initial.identity) ||
      observed === null ||
      !sameIdentity(initial.identity, observed)
    ) {
      return 'identity_mismatch';
    }
    return null;
  }

  private async closeWithinLock(lease: LifecycleLease): Promise<void> {
    await this.atomicWrite({
      ...lease,
      version: lease.version + 1,
      status: 'closed',
      inFlight: 0,
    });
  }

  private leasePath(leaseId: string): string {
    if (!/^mcp-[a-f0-9]{32}$/.test(leaseId)) throw new Error('invalid_lease_id');
    return join(this.root, `${leaseId}.json`);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }

  private async readLease(leaseId: string): Promise<LifecycleLease | null> {
    try {
      const parsed = JSON.parse(await readFile(this.leasePath(leaseId), 'utf8')) as LifecycleLease;
      return parsed.schema === LEASE_SCHEMA ? parsed : null;
    } catch {
      return null;
    }
  }

  private async requireLease(leaseId: string): Promise<LifecycleLease> {
    const lease = await this.readLease(leaseId);
    if (lease === null) throw new Error('unowned');
    return lease;
  }

  private async atomicWrite(lease: LifecycleLease): Promise<void> {
    await this.ensureRoot();
    const destination = this.leasePath(lease.leaseId);
    const temporary = `${destination}.tmp-${randomBytes(8).toString('hex')}`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(lease));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
    const directory = await open(this.root, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private async withLock<T>(leaseId: string, action: () => Promise<T>): Promise<T> {
    await this.ensureRoot();
    const lockPath = join(this.root, `${leaseId}.lock`);
    let handle;
    const retryDelayMs = 5;
    const maxAttempts = Math.max(20, Math.ceil((this.graceMs + 1_000) / retryDelayMs));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        handle = await open(lockPath, 'wx', 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await this.wait(retryDelayMs);
      }
    }
    if (handle === undefined) throw new Error('lease_lock_timeout');
    try {
      return await action();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export async function removeClosedLeaseFile(root: string, leaseId: string): Promise<void> {
  const path = join(resolve(root), `${leaseId}.json`);
  await rm(path, { force: true });
}
