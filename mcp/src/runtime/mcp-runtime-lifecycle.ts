import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { LifecycleCoordinator, type FinalizationResult } from './lifecycle-coordinator.js';
import { TrajectoryLedger, type LedgerTip } from './trajectory-ledger.js';
import {
  RuntimeCheckpointStore,
  type ContinuationBudget,
  type RuntimeCheckpoint,
  type SemanticBoundary,
} from './runtime-checkpoint.js';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const OBJECTIVE = 'forgewright-mcp-runtime-session';

export type RuntimeShutdownReason =
  'stdin-eof' | 'stdin-close' | 'SIGINT' | 'SIGTERM' | 'fatal' | 'connect-failed';

export interface RuntimeCloseResult {
  outcome: 'completed' | 'cancelled' | 'failed';
  quiescence: 'confirmed' | 'not_confirmed';
  diagnostics: string[];
  finalization?: FinalizationResult;
}

export interface McpRuntimeLifecycleOpenOptions {
  workspaceId: string;
  sessionId: string;
  env?: Readonly<Record<string, string | undefined>>;
  randomUUID?: () => string;
}

interface McpRuntimeLifecycleResumeOptions {
  workspaceId: string;
  sessionId: string;
  trajectoryId: string;
  checkpointHash: string;
  checkpointTip: LedgerTip;
  writerEpoch: number;
  reasonCode?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

export interface McpRuntimeLifecycleResumeFromCheckpointOptions {
  checkpointStore: RuntimeCheckpointStore;
  workspaceId: string;
  sessionId: string;
  capabilityHash: string;
  treeFingerprint: string;
  reasonCode?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

interface CoordinatorLike {
  cancel(scopeId?: string, reasonCode?: string): Promise<void>;
  finalize(options: {
    timeoutMs: number;
    outcome: 'completed' | 'cancelled' | 'failed';
    reasonCode?: string;
  }): Promise<Pick<FinalizationResult, 'quiescence'> & Partial<FinalizationResult>>;
}

interface RuntimeLike {
  coordinator: CoordinatorLike;
}

type BoundedResult<Value> =
  { status: 'completed'; value: Value } | { status: 'failed' } | { status: 'timed_out' };

export interface RuntimeShutdownControllerOptions {
  runtime: RuntimeLike;
  timeoutMs: number;
  releaseLease: () => Promise<unknown>;
  closeServer: () => Promise<unknown>;
  log?: (message: string) => void;
}

export interface StartupFailureCleanupControllerOptions {
  timeoutMs: number;
  releaseLease: () => Promise<unknown>;
  closeServer: () => Promise<unknown>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function shutdownOutcome(reason: RuntimeShutdownReason): RuntimeCloseResult['outcome'] {
  if (reason === 'stdin-eof' || reason === 'stdin-close') return 'completed';
  if (reason === 'SIGINT' || reason === 'SIGTERM') return 'cancelled';
  return 'failed';
}

function cancellationReason(reason: RuntimeShutdownReason): string {
  if (reason === 'SIGINT' || reason === 'SIGTERM') return 'operator_signal';
  if (reason === 'connect-failed') return 'transport_connect_failed';
  return 'runtime_fatal';
}

async function settleWithin<Value>(
  operation: () => Promise<Value>,
  timeoutMs: number,
): Promise<BoundedResult<Value>> {
  let timer: NodeJS.Timeout | undefined;
  const task = Promise.resolve().then(operation);
  const timedOut = new Promise<{ status: 'timed_out' }>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timed_out' }), timeoutMs);
  });
  try {
    const result = await Promise.race([
      task.then(
        (value) => ({ status: 'completed' as const, value }),
        () => ({ status: 'failed' as const }),
      ),
      timedOut,
    ]);
    if (result.status === 'timed_out') void task.catch(() => undefined);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function remainingTimeoutMs(deadlineAtMs: number): number {
  return Math.max(1, deadlineAtMs - Date.now());
}

export function lifecycleShutdownTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.FORGEWRIGHT_LIFECYCLE_SHUTDOWN_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error('FORGEWRIGHT_LIFECYCLE_SHUTDOWN_TIMEOUT_MS must be a positive integer');
  }
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('FORGEWRIGHT_LIFECYCLE_SHUTDOWN_TIMEOUT_MS must be a positive integer');
  }
  return timeoutMs;
}

export class McpRuntimeLifecycle {
  readonly gatewayContext: { lifecycle: LifecycleCoordinator };
  private closePromise: Promise<RuntimeCloseResult> | null = null;

  private constructor(
    readonly ledger: TrajectoryLedger,
    readonly coordinator: LifecycleCoordinator,
    readonly workspaceId: string,
    readonly sessionId: string,
    readonly trajectoryId: string,
    readonly rootScopeId: string,
    readonly writerEpoch: number,
  ) {
    this.gatewayContext = { lifecycle: coordinator };
  }

  static async open(options: McpRuntimeLifecycleOpenOptions): Promise<McpRuntimeLifecycle> {
    const env = options.env ?? process.env;
    const uuid = (options.randomUUID ?? nodeRandomUUID)();
    const trajectoryId = env.FORGEWRIGHT_TRAJECTORY_ID ?? `mcp-${uuid}`;
    const rootScopeId = `mcp-root:${uuid}`;
    const root =
      env.FORGEWRIGHT_TRAJECTORY_ROOT ??
      join(homedir(), '.forgewright', 'runtime', 'trajectory-ledgers');
    const ledger = new TrajectoryLedger({ root, ledgerId: trajectoryId });
    const coordinator = await LifecycleCoordinator.open({
      ledger,
      rootScopeId,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      origin: 'mcp-runtime',
      writerEpoch: 1,
      objectiveDigest: sha256(OBJECTIVE),
    });
    return new McpRuntimeLifecycle(
      ledger,
      coordinator,
      options.workspaceId,
      options.sessionId,
      trajectoryId,
      rootScopeId,
      1,
    );
  }

  private static async resume(
    options: McpRuntimeLifecycleResumeOptions,
  ): Promise<McpRuntimeLifecycle> {
    const env = options.env ?? process.env;
    const root =
      env.FORGEWRIGHT_TRAJECTORY_ROOT ??
      join(homedir(), '.forgewright', 'runtime', 'trajectory-ledgers');
    const ledger = new TrajectoryLedger({ root, ledgerId: options.trajectoryId });
    const coordinator = await LifecycleCoordinator.recover({
      ledger,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      checkpointHash: options.checkpointHash,
      checkpointTip: options.checkpointTip,
      writerEpoch: options.writerEpoch,
      reasonCode: options.reasonCode,
    });
    return new McpRuntimeLifecycle(
      ledger,
      coordinator,
      options.workspaceId,
      options.sessionId,
      options.trajectoryId,
      coordinator.rootScopeId,
      options.writerEpoch,
    );
  }

  static async resumeFromCheckpoint(
    options: McpRuntimeLifecycleResumeFromCheckpointOptions,
  ): Promise<McpRuntimeLifecycle> {
    const env = options.env ?? process.env;
    const root =
      env.FORGEWRIGHT_TRAJECTORY_ROOT ??
      join(homedir(), '.forgewright', 'runtime', 'trajectory-ledgers');
    return options.checkpointStore.withPinnedLatest(
      {
        workspaceId: options.workspaceId,
        sessionId: options.sessionId,
        capabilityHash: options.capabilityHash,
        treeFingerprint: options.treeFingerprint,
      },
      async (candidate) => {
        const ledger = new TrajectoryLedger({ root, ledgerId: candidate.trajectoryId });
        const currentTip = await ledger.tip();
        const resumed = options.checkpointStore.resume({
          workspaceId: options.workspaceId,
          sessionId: options.sessionId,
          trajectoryId: candidate.trajectoryId,
          checkpointHash: candidate.hash,
          capabilityHash: options.capabilityHash,
          treeFingerprint: options.treeFingerprint,
          writerEpoch: candidate.writerEpoch,
          ledgerTip: currentTip,
        });
        return McpRuntimeLifecycle.resume({
          workspaceId: options.workspaceId,
          sessionId: options.sessionId,
          trajectoryId: resumed.checkpoint.trajectoryId,
          checkpointHash: resumed.checkpoint.hash,
          checkpointTip: currentTip,
          writerEpoch: resumed.nextWriterEpoch,
          reasonCode: options.reasonCode ?? 'runtime_checkpoint_resume',
          env,
        });
      },
    );
  }

  async checkpoint(
    store: RuntimeCheckpointStore,
    boundary: SemanticBoundary,
    capabilityHash: string,
    treeFingerprint: string,
    budget: ContinuationBudget,
    nowMs = Date.now(),
  ): Promise<RuntimeCheckpoint> {
    const ledgerTip = await this.ledger.tip();
    return store.append(
      {
        workspaceId: this.workspaceId,
        sessionId: this.sessionId,
        trajectoryId: this.trajectoryId,
        writerEpoch: this.writerEpoch,
        boundary,
        ledgerTip,
        capabilityHash,
        treeFingerprint,
        snapshot: this.coordinator.snapshot(),
        budget,
      },
      nowMs,
    );
  }

  close(reason: RuntimeShutdownReason, timeoutMs: number): Promise<RuntimeCloseResult> {
    if (this.closePromise !== null) return this.closePromise;
    this.closePromise = closeLifecycle(this, reason, Date.now() + timeoutMs);
    return this.closePromise;
  }
}

async function closeLifecycle(
  runtime: RuntimeLike,
  reason: RuntimeShutdownReason,
  deadlineAtMs: number,
): Promise<RuntimeCloseResult> {
  const outcome = shutdownOutcome(reason);
  const diagnostics: string[] = [];
  let cancellationDelivered = true;
  if (outcome !== 'completed') {
    const cancellation = await settleWithin(
      () => runtime.coordinator.cancel(undefined, cancellationReason(reason)),
      remainingTimeoutMs(deadlineAtMs),
    );
    if (cancellation.status === 'failed') {
      cancellationDelivered = false;
      diagnostics.push('LIFECYCLE_CANCEL_FAILED');
    } else if (cancellation.status === 'timed_out') {
      cancellationDelivered = false;
      diagnostics.push('LIFECYCLE_CANCEL_TIMEOUT');
    }
  }
  const finalizationTimeoutMs = remainingTimeoutMs(deadlineAtMs);
  const finalization = await settleWithin(
    () =>
      runtime.coordinator.finalize({
        timeoutMs: finalizationTimeoutMs,
        outcome,
        reasonCode: reason,
      }),
    finalizationTimeoutMs,
  );
  if (finalization.status === 'completed') {
    return {
      outcome,
      quiescence: cancellationDelivered ? finalization.value.quiescence : 'not_confirmed',
      diagnostics,
      finalization: finalization.value as FinalizationResult,
    };
  }
  if (finalization.status === 'failed') {
    diagnostics.push('LIFECYCLE_FINALIZE_FAILED');
  } else {
    diagnostics.push('LIFECYCLE_FINALIZE_TIMEOUT');
  }
  return { outcome, quiescence: 'not_confirmed', diagnostics };
}

export class RuntimeShutdownController {
  private shutdownPromise: Promise<RuntimeCloseResult> | null = null;

  constructor(private readonly options: RuntimeShutdownControllerOptions) {}

  close(reason: RuntimeShutdownReason): Promise<RuntimeCloseResult> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.shutdownPromise = this.performClose(reason);
    return this.shutdownPromise;
  }

  private async performClose(reason: RuntimeShutdownReason): Promise<RuntimeCloseResult> {
    const deadlineAtMs = Date.now() + this.options.timeoutMs;
    const result = await closeLifecycle(this.options.runtime, reason, deadlineAtMs);
    if (result.quiescence !== 'confirmed') {
      this.options.log?.(
        '[Forgewright Global MCP] Lifecycle finalization failed; quiescence not confirmed.',
      );
    }
    const leaseRelease = await settleWithin(
      this.options.releaseLease,
      remainingTimeoutMs(deadlineAtMs),
    );
    if (leaseRelease.status === 'failed') {
      result.diagnostics.push('LEASE_RELEASE_FAILED');
    } else if (leaseRelease.status === 'timed_out') {
      result.diagnostics.push('LEASE_RELEASE_TIMEOUT');
    }
    const serverClose = await settleWithin(
      this.options.closeServer,
      remainingTimeoutMs(deadlineAtMs),
    );
    if (serverClose.status === 'failed') {
      result.diagnostics.push('SERVER_CLOSE_FAILED');
    } else if (serverClose.status === 'timed_out') {
      result.diagnostics.push('SERVER_CLOSE_TIMEOUT');
    }
    return result;
  }
}

export class StartupFailureCleanupController {
  private closePromise: Promise<string[]> | null = null;

  constructor(private readonly options: StartupFailureCleanupControllerOptions) {}

  close(): Promise<string[]> {
    if (this.closePromise !== null) return this.closePromise;
    this.closePromise = this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<string[]> {
    const diagnostics: string[] = [];
    const deadlineAtMs = Date.now() + this.options.timeoutMs;
    const leaseRelease = await settleWithin(
      this.options.releaseLease,
      remainingTimeoutMs(deadlineAtMs),
    );
    if (leaseRelease.status === 'failed') {
      diagnostics.push('LEASE_RELEASE_FAILED');
    } else if (leaseRelease.status === 'timed_out') {
      diagnostics.push('LEASE_RELEASE_TIMEOUT');
    }
    const serverClose = await settleWithin(
      this.options.closeServer,
      remainingTimeoutMs(deadlineAtMs),
    );
    if (serverClose.status === 'failed') {
      diagnostics.push('SERVER_CLOSE_FAILED');
    } else if (serverClose.status === 'timed_out') {
      diagnostics.push('SERVER_CLOSE_TIMEOUT');
    }
    return diagnostics;
  }
}

export async function openRuntimeAfterLease<Value>(
  openRuntime: () => Promise<Value>,
  cleanup: StartupFailureCleanupController,
): Promise<Value> {
  try {
    return await openRuntime();
  } catch (error) {
    await cleanup.close();
    throw error;
  }
}
