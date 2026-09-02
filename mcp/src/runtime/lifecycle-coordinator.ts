import { createHash, randomUUID } from 'node:crypto';

import {
  canonicalJson,
  foldTrajectory,
  type AppendEventInput,
  type LedgerTip,
  type QuiescenceStatus,
  type TrajectoryEvent,
  type TrajectoryEventKind,
  type TrajectoryLedger,
  type TrajectoryOutcome,
  type TrajectoryPayloadMap,
} from './trajectory-ledger.js';

export type LifecycleCoordinatorErrorCode =
  | 'ADMISSIONS_CLOSED'
  | 'UNKNOWN_SCOPE'
  | 'DUPLICATE_SCOPE'
  | 'DUPLICATE_DISPOSER_CONFLICT'
  | 'DUPLICATE_OPERATION'
  | 'ROOT_SCOPE_CLOSE_FORBIDDEN'
  | 'SCOPE_ALREADY_CLOSED'
  | 'SCOPE_NOT_QUIESCENT'
  | 'LATE_RESULT_DISCARDED'
  | 'INVALID_TIMEOUT'
  | 'FINALIZATION_STORAGE_UNCERTAIN'
  | 'RECOVERY_TERMINAL'
  | 'RECOVERY_NONQUIESCENT'
  | 'RECOVERY_REBIND_REQUIRED'
  | 'RECOVERY_EPOCH_MISMATCH'
  | 'RECOVERY_TIP_MISMATCH'
  | 'RECOVERY_IDENTITY_MISMATCH'
  | 'RECOVERY_ROOT_INVALID'
  | 'COORDINATOR_TERMINAL';

export class LifecycleCoordinatorError extends Error {
  constructor(
    readonly code: LifecycleCoordinatorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LifecycleCoordinatorError';
  }
}

export interface LifecycleCoordinatorOpenOptions {
  ledger: TrajectoryLedger;
  rootScopeId: string;
  workspaceId: string;
  sessionId: string;
  origin: string;
  writerEpoch: number;
  objectiveDigest: string;
}

export interface LifecycleCoordinatorRecoverOptions {
  ledger: TrajectoryLedger;
  workspaceId: string;
  sessionId: string;
  checkpointHash: string;
  checkpointTip: LedgerTip;
  writerEpoch: number;
  reasonCode?: string;
}

export interface OpenScopeInput {
  scopeId: string;
  parentScopeId: string;
  scopeType: string;
}

export interface DisposerRegistrationInput {
  disposerId: string;
  scopeId: string;
  idempotencyKey: string;
  resourceType: string;
  resourceDigest: string;
}

export interface RegisteredDisposerDescriptor extends DisposerRegistrationInput {
  ordinal: number;
}

export interface OperationInput {
  operationId: string;
  scopeId: string;
  operationType: string;
  inputDigest: string;
}

export interface FinalizeOptions {
  timeoutMs: number;
  outcome: Exclude<TrajectoryOutcome, 'timed_out'>;
  reasonCode?: string;
}

export interface FinalizationResult {
  status: 'complete' | 'partial' | 'failed' | 'timed_out';
  quiescence: QuiescenceStatus;
  disposedCount: number;
  failedDisposerCount: number;
  timedOutDisposerCount: number;
  unresolvedOperationCount: number;
  unresolvedScopeCount: number;
  unresolvedDisposerCount: number;
  deadlineAtMs: number;
  receiptEventId: string;
  terminalEventId: string;
}

export interface CoordinatorSnapshot {
  state: 'ACTIVE' | 'CANCELLING' | 'FINALIZING' | 'TERMINAL';
  activeOperationCount: number;
  openScopeCount: number;
  registeredDisposerCount: number;
}

export type DisposerHandler = () => void | Promise<void>;
export type OperationHandler<Result> = (signal: AbortSignal) => Result | Promise<Result>;

interface ScopeState {
  scopeId: string;
  parentScopeId: string | null;
  scopeType: string;
  controller: AbortController;
  openedEventId: string;
  open: boolean;
}

interface OperationState {
  input: OperationInput;
  fenced: boolean;
  settled: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

interface DisposerState {
  descriptor: RegisteredDisposerDescriptor;
  handler: DisposerHandler;
  registrationEventId: string;
  status: 'registered' | 'started' | 'settled' | 'timed_out';
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function eventId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableErrorCode(error: unknown): string {
  if (
    isRecord(error) &&
    typeof error.code === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'LIFECYCLE_HANDLER_FAILED';
}

function sameRegistration(
  left: RegisteredDisposerDescriptor,
  right: DisposerRegistrationInput,
): boolean {
  return (
    left.disposerId === right.disposerId &&
    left.scopeId === right.scopeId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.resourceType === right.resourceType &&
    left.resourceDigest === right.resourceDigest
  );
}

export class LifecycleCoordinator {
  readonly ledger: TrajectoryLedger;
  readonly rootScopeId: string;
  private lifecycleState: CoordinatorSnapshot['state'] = 'ACTIVE';
  private readonly scopes = new Map<string, ScopeState>();
  private readonly activeOperations = new Map<string, OperationState>();
  private readonly operationIds = new Set<string>();
  private readonly disposers = new Map<string, DisposerState>();
  private readonly disposerByIdempotencyKey = new Map<string, DisposerState>();
  private readonly pendingRegistrations = new Set<Promise<RegisteredDisposerDescriptor>>();
  private readonly cancellationPromises = new Map<string, Promise<void>>();
  private appendTail: Promise<void> = Promise.resolve();
  private registrationTail: Promise<void> = Promise.resolve();
  private finalizationPromise: Promise<FinalizationResult> | null = null;
  private nextDisposerOrdinal = 1;
  private rootCancellationRequested = false;

  private constructor(options: LifecycleCoordinatorOpenOptions) {
    this.ledger = options.ledger;
    this.rootScopeId = options.rootScopeId;
  }

  static async open(options: LifecycleCoordinatorOpenOptions): Promise<LifecycleCoordinator> {
    const coordinator = new LifecycleCoordinator(options);
    const opened = await coordinator.append('trajectory.opened', {
      objectiveDigest: options.objectiveDigest,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      origin: options.origin,
      writerEpoch: options.writerEpoch,
      rootScopeId: options.rootScopeId,
    });
    const rootController = new AbortController();
    const scopeOpened = await coordinator.append(
      'scope.opened',
      { scopeId: options.rootScopeId, parentScopeId: null, scopeType: 'root' },
      [opened.eventId],
    );
    coordinator.scopes.set(options.rootScopeId, {
      scopeId: options.rootScopeId,
      parentScopeId: null,
      scopeType: 'root',
      controller: rootController,
      openedEventId: scopeOpened.eventId,
      open: true,
    });
    return coordinator;
  }

  static async recover(options: LifecycleCoordinatorRecoverOptions): Promise<LifecycleCoordinator> {
    const events = await options.ledger.reconstruct();
    const openedEvents = events.filter((event) => event.kind === 'trajectory.opened');
    if (openedEvents.length !== 1) {
      throw new LifecycleCoordinatorError('RECOVERY_ROOT_INVALID', 'trajectory root is invalid');
    }
    const opened = openedEvents[0];
    if (
      opened.payload.workspaceId !== options.workspaceId ||
      opened.payload.sessionId !== options.sessionId
    ) {
      throw new LifecycleCoordinatorError(
        'RECOVERY_IDENTITY_MISMATCH',
        'trajectory identity does not match recovery identity',
      );
    }
    const folded = foldTrajectory(events);
    if (folded.terminal !== null) {
      throw new LifecycleCoordinatorError('RECOVERY_TERMINAL', 'trajectory is terminal');
    }
    const currentTip = events.at(-1);
    if (
      currentTip === undefined ||
      options.checkpointTip.sequence !== currentTip.sequence ||
      options.checkpointTip.hash !== currentTip.hash
    ) {
      throw new LifecycleCoordinatorError(
        'RECOVERY_TIP_MISMATCH',
        'checkpoint does not bind the current trajectory tip',
      );
    }
    if (folded.latestWriterEpoch === null || options.writerEpoch !== folded.latestWriterEpoch + 1) {
      throw new LifecycleCoordinatorError(
        'RECOVERY_EPOCH_MISMATCH',
        'writer epoch must advance by exactly one',
      );
    }
    if (folded.pendingDisposerIds.length > 0) {
      throw new LifecycleCoordinatorError(
        'RECOVERY_REBIND_REQUIRED',
        'pending disposer callbacks require trusted rebinding',
      );
    }
    if (
      folded.activeOperationIds.length > 0 ||
      folded.cancellationRequested ||
      folded.finalizationStarted
    ) {
      throw new LifecycleCoordinatorError(
        'RECOVERY_NONQUIESCENT',
        'trajectory is not at a safe recovery boundary',
      );
    }
    const rootScopeEvents = events.filter(
      (event): event is Extract<TrajectoryEvent, { kind: 'scope.opened' }> =>
        event.kind === 'scope.opened' && event.payload.scopeId === opened.payload.rootScopeId,
    );
    if (
      rootScopeEvents.length !== 1 ||
      rootScopeEvents[0].payload.parentScopeId !== null ||
      rootScopeEvents[0].payload.scopeType !== 'root' ||
      folded.openScopeIds.length !== 1 ||
      folded.openScopeIds[0] !== opened.payload.rootScopeId
    ) {
      throw new LifecycleCoordinatorError(
        'RECOVERY_ROOT_INVALID',
        'only the original root scope may remain open',
      );
    }

    await options.ledger.append(
      {
        eventId: eventId('trajectory.recovered'),
        kind: 'trajectory.recovered',
        occurredAtMs: Date.now(),
        causalEventIds: [currentTip.eventId],
        payload: {
          checkpointHash: options.checkpointHash,
          previousWriterEpoch: folded.latestWriterEpoch,
          writerEpoch: options.writerEpoch,
          reasonCode: options.reasonCode ?? 'checkpoint_resume',
        },
      },
      options.checkpointTip,
    );

    const coordinator = new LifecycleCoordinator({
      ledger: options.ledger,
      rootScopeId: opened.payload.rootScopeId,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      origin: opened.payload.origin,
      writerEpoch: options.writerEpoch,
      objectiveDigest: opened.payload.objectiveDigest,
    });
    const closedScopeIds = new Set(
      events.filter((event) => event.kind === 'scope.closed').map((event) => event.payload.scopeId),
    );
    for (const scopeEvent of events.filter(
      (event): event is Extract<TrajectoryEvent, { kind: 'scope.opened' }> =>
        event.kind === 'scope.opened',
    )) {
      coordinator.scopes.set(scopeEvent.payload.scopeId, {
        ...scopeEvent.payload,
        controller: new AbortController(),
        openedEventId: scopeEvent.eventId,
        open: !closedScopeIds.has(scopeEvent.payload.scopeId),
      });
    }
    for (const operation of events.filter(
      (event): event is Extract<TrajectoryEvent, { kind: 'operation.started' }> =>
        event.kind === 'operation.started',
    )) {
      coordinator.operationIds.add(operation.payload.operationId);
    }
    const startedDisposers = new Set(
      events
        .filter((event) => event.kind === 'disposer.started')
        .map((event) => event.payload.disposerId),
    );
    const settledDisposers = new Set(
      events
        .filter((event) => event.kind === 'disposer.settled')
        .map((event) => event.payload.disposerId),
    );
    for (const registered of events.filter(
      (event): event is Extract<TrajectoryEvent, { kind: 'disposer.registered' }> =>
        event.kind === 'disposer.registered',
    )) {
      const descriptor = { ...registered.payload };
      const state: DisposerState = {
        descriptor,
        handler: async () => undefined,
        registrationEventId: registered.eventId,
        status: settledDisposers.has(descriptor.disposerId)
          ? 'settled'
          : startedDisposers.has(descriptor.disposerId)
            ? 'started'
            : 'registered',
      };
      coordinator.disposers.set(descriptor.disposerId, state);
      coordinator.disposerByIdempotencyKey.set(descriptor.idempotencyKey, state);
      coordinator.nextDisposerOrdinal = Math.max(
        coordinator.nextDisposerOrdinal,
        descriptor.ordinal + 1,
      );
    }
    return coordinator;
  }

  get state(): CoordinatorSnapshot['state'] {
    return this.lifecycleState;
  }

  snapshot(): CoordinatorSnapshot {
    return {
      state: this.lifecycleState,
      activeOperationCount: this.activeOperations.size,
      openScopeCount: [...this.scopes.values()].filter((scope) => scope.open).length,
      registeredDisposerCount: [...this.disposers.values()].filter(
        (disposer) => disposer.status === 'registered',
      ).length,
    };
  }

  signal(scopeId = this.rootScopeId): AbortSignal {
    return this.requireScope(scopeId).controller.signal;
  }

  async openScope(input: OpenScopeInput): Promise<void> {
    this.assertAdmissionsOpen();
    if (this.scopes.has(input.scopeId)) {
      throw new LifecycleCoordinatorError(
        'DUPLICATE_SCOPE',
        `scope already exists: ${input.scopeId}`,
      );
    }
    const parent = this.requireScope(input.parentScopeId);
    this.assertScopeAdmitting(parent);
    const controller = new AbortController();
    if (parent.controller.signal.aborted) {
      controller.abort(parent.controller.signal.reason);
    } else {
      parent.controller.signal.addEventListener(
        'abort',
        () => controller.abort(parent.controller.signal.reason),
        { once: true },
      );
    }
    const state: ScopeState = {
      ...input,
      controller,
      openedEventId: '',
      open: true,
    };
    this.scopes.set(input.scopeId, state);
    try {
      const opened = await this.append(
        'scope.opened',
        {
          scopeId: input.scopeId,
          parentScopeId: input.parentScopeId,
          scopeType: input.scopeType,
        },
        [parent.openedEventId],
      );
      state.openedEventId = opened.eventId;
    } catch (error) {
      this.scopes.delete(input.scopeId);
      throw error;
    }
  }

  registerDisposer(
    input: DisposerRegistrationInput,
    handler: DisposerHandler,
  ): Promise<RegisteredDisposerDescriptor> {
    try {
      this.assertAdmissionsOpen();
      this.assertScopeAdmitting(this.requireScope(input.scopeId));
    } catch (error) {
      return Promise.reject(error);
    }
    const task = this.registrationTail.then(() => this.registerDisposerNow(input, handler));
    this.registrationTail = task.then(
      () => undefined,
      () => undefined,
    );
    this.pendingRegistrations.add(task);
    task.then(
      () => this.pendingRegistrations.delete(task),
      () => this.pendingRegistrations.delete(task),
    );
    return task;
  }

  runOperation<Result>(input: OperationInput, handler: OperationHandler<Result>): Promise<Result> {
    try {
      this.assertAdmissionsOpen();
      this.assertScopeAdmitting(this.requireScope(input.scopeId));
      if (this.operationIds.has(input.operationId)) {
        throw new LifecycleCoordinatorError(
          'DUPLICATE_OPERATION',
          `operation already active: ${input.operationId}`,
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }
    this.operationIds.add(input.operationId);
    let resolveDone!: () => void;
    const operation: OperationState = {
      input,
      fenced: false,
      settled: false,
      done: new Promise<void>((resolve) => (resolveDone = resolve)),
      resolveDone,
    };
    operation.resolveDone = resolveDone;
    this.activeOperations.set(input.operationId, operation);
    return this.executeOperation(operation, handler);
  }

  cancel(scopeId = this.rootScopeId, reasonCode = 'operator_requested'): Promise<void> {
    if (this.lifecycleState === 'TERMINAL') {
      return Promise.reject(
        new LifecycleCoordinatorError('COORDINATOR_TERMINAL', 'coordinator is terminal'),
      );
    }
    if (this.lifecycleState === 'FINALIZING') {
      scopeId = this.rootScopeId;
      reasonCode = 'finalization';
    }
    return this.cancelScope(scopeId, reasonCode);
  }

  async closeScope(scopeId: string, outcome: TrajectoryOutcome): Promise<void> {
    if (this.lifecycleState === 'TERMINAL') {
      throw new LifecycleCoordinatorError('COORDINATOR_TERMINAL', 'coordinator is terminal');
    }
    if (scopeId === this.rootScopeId) {
      throw new LifecycleCoordinatorError(
        'ROOT_SCOPE_CLOSE_FORBIDDEN',
        'the root scope closes only during finalization',
      );
    }
    const scope = this.requireScope(scopeId);
    if (!scope.open) {
      throw new LifecycleCoordinatorError('SCOPE_ALREADY_CLOSED', `scope is closed: ${scopeId}`);
    }
    const hasActiveOperation = [...this.activeOperations.values()].some(
      (operation) => operation.input.scopeId === scopeId,
    );
    const hasPendingDisposer = [...this.disposers.values()].some(
      (disposer) =>
        disposer.descriptor.scopeId === scopeId &&
        (disposer.status === 'registered' || disposer.status === 'started'),
    );
    const hasOpenChild = [...this.scopes.values()].some(
      (candidate) => candidate.parentScopeId === scopeId && candidate.open,
    );
    if (hasActiveOperation || hasPendingDisposer || hasOpenChild) {
      throw new LifecycleCoordinatorError(
        'SCOPE_NOT_QUIESCENT',
        `scope is not quiescent: ${scopeId}`,
      );
    }
    await this.append('scope.closed', { scopeId, outcome }, [scope.openedEventId]);
    scope.open = false;
  }

  finalize(options: FinalizeOptions): Promise<FinalizationResult> {
    if (this.finalizationPromise !== null) return this.finalizationPromise;
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
      return Promise.reject(
        new LifecycleCoordinatorError('INVALID_TIMEOUT', 'timeoutMs must be a positive integer'),
      );
    }
    if (this.lifecycleState === 'TERMINAL') {
      return Promise.reject(
        new LifecycleCoordinatorError('COORDINATOR_TERMINAL', 'coordinator is terminal'),
      );
    }
    this.lifecycleState = 'FINALIZING';
    this.finalizationPromise = this.performFinalization(options);
    return this.finalizationPromise;
  }

  dispose(options: FinalizeOptions): Promise<FinalizationResult> {
    return this.finalize(options);
  }

  private async registerDisposerNow(
    input: DisposerRegistrationInput,
    handler: DisposerHandler,
  ): Promise<RegisteredDisposerDescriptor> {
    const idempotent = this.disposerByIdempotencyKey.get(input.idempotencyKey);
    if (idempotent !== undefined) {
      if (!sameRegistration(idempotent.descriptor, input)) {
        throw new LifecycleCoordinatorError(
          'DUPLICATE_DISPOSER_CONFLICT',
          `idempotency key conflict: ${input.idempotencyKey}`,
        );
      }
      return { ...idempotent.descriptor };
    }
    const byId = this.disposers.get(input.disposerId);
    if (byId !== undefined) {
      throw new LifecycleCoordinatorError(
        'DUPLICATE_DISPOSER_CONFLICT',
        `disposerId conflict: ${input.disposerId}`,
      );
    }
    const descriptor: RegisteredDisposerDescriptor = {
      ...input,
      ordinal: this.nextDisposerOrdinal,
    };
    this.nextDisposerOrdinal += 1;
    const registered = await this.append('disposer.registered', descriptor);
    const state: DisposerState = {
      descriptor,
      handler,
      registrationEventId: registered.eventId,
      status: 'registered',
    };
    this.disposers.set(descriptor.disposerId, state);
    this.disposerByIdempotencyKey.set(descriptor.idempotencyKey, state);
    return { ...descriptor };
  }

  private async executeOperation<Result>(
    operation: OperationState,
    handler: OperationHandler<Result>,
  ): Promise<Result> {
    let startedEventId: string | null = null;
    try {
      const started = await this.append('operation.started', operation.input);
      startedEventId = started.eventId;
      const result = await handler(this.signal(operation.input.scopeId));
      const late =
        operation.fenced ||
        this.signal(operation.input.scopeId).aborted ||
        this.isScopeCancellationRequested(operation.input.scopeId);
      if (operation.fenced || this.lifecycleState === 'TERMINAL') {
        throw new LifecycleCoordinatorError(
          'LATE_RESULT_DISCARDED',
          `late result discarded: ${operation.input.operationId}`,
        );
      }
      await this.append(
        'operation.settled',
        {
          operationId: operation.input.operationId,
          outcome: late ? 'cancelled' : 'completed',
          outputDigest: null,
          errorCode: late ? 'LATE_RESULT_DISCARDED' : null,
          lateResultDiscarded: late,
        },
        [startedEventId],
      );
      operation.settled = true;
      if (late) {
        throw new LifecycleCoordinatorError(
          'LATE_RESULT_DISCARDED',
          `late result discarded: ${operation.input.operationId}`,
        );
      }
      return result;
    } catch (error) {
      if (
        !operation.settled &&
        startedEventId !== null &&
        !operation.fenced &&
        this.lifecycleState !== 'TERMINAL'
      ) {
        const late =
          operation.fenced ||
          this.signal(operation.input.scopeId).aborted ||
          this.isScopeCancellationRequested(operation.input.scopeId);
        await this.append(
          'operation.settled',
          {
            operationId: operation.input.operationId,
            outcome: late ? 'cancelled' : 'failed',
            outputDigest: null,
            errorCode: late ? 'LATE_RESULT_DISCARDED' : stableErrorCode(error),
            lateResultDiscarded: late,
          },
          [startedEventId],
        );
        operation.settled = true;
      }
      if (operation.fenced && !(error instanceof LifecycleCoordinatorError)) {
        throw new LifecycleCoordinatorError(
          'LATE_RESULT_DISCARDED',
          `late result discarded: ${operation.input.operationId}`,
        );
      }
      throw error;
    } finally {
      this.activeOperations.delete(operation.input.operationId);
      operation.resolveDone();
    }
  }

  private cancelScope(scopeId: string, reasonCode: string): Promise<void> {
    const existing = this.cancellationPromises.get(scopeId);
    if (existing !== undefined) return existing;
    const scope = this.requireScope(scopeId);
    if (scopeId === this.rootScopeId) {
      this.rootCancellationRequested = true;
      if (this.lifecycleState === 'ACTIVE') this.lifecycleState = 'CANCELLING';
    }
    const cancellation = (async () => {
      const requested = await this.append('cancellation.requested', { scopeId, reasonCode });
      this.abortSubtree(scope, reasonCode);
      const observedOperationCount = [...this.activeOperations.values()].filter((operation) =>
        this.isDescendantOrSelf(operation.input.scopeId, scopeId),
      ).length;
      await this.append(
        'cancellation.acknowledged',
        { requestEventId: requested.eventId, scopeId, observedOperationCount },
        [requested.eventId],
      );
    })();
    this.cancellationPromises.set(scopeId, cancellation);
    return cancellation;
  }

  private async performFinalization(options: FinalizeOptions): Promise<FinalizationResult> {
    const deadlineAtMs = Date.now() + options.timeoutMs;
    const finalizationStartedPromise = this.append('finalization.started', {
      reasonCode: options.reasonCode ?? 'finalization',
      deadlineAtMs,
    });
    // The caller's timeout bounds cleanup/quiescence, not the durability write
    // needed to establish that finalization began. Under host I/O pressure a
    // 100ms cleanup budget can otherwise expire while fsync is still persisting
    // the start marker, producing a false storage-uncertain failure. Give the
    // start marker its own bounded persistence window; the original cleanup
    // deadline remains unchanged, so any time consumed here immediately reduces
    // (or exhausts) the remaining cleanup budget.
    const startPersistenceDeadlineAtMs = Date.now() + Math.max(1_000, options.timeoutMs);
    if (
      !(await this.waitUntil(
        finalizationStartedPromise.then(() => undefined),
        startPersistenceDeadlineAtMs,
      ))
    ) {
      throw new LifecycleCoordinatorError(
        'FINALIZATION_STORAGE_UNCERTAIN',
        'finalization start did not persist before deadline',
      );
    }
    const finalizationStarted = await finalizationStartedPromise;
    const registrationsSettled = await this.waitUntil(
      Promise.allSettled([...this.pendingRegistrations, this.registrationTail]).then(
        () => undefined,
      ),
      deadlineAtMs,
    );
    if (!registrationsSettled) {
      throw new LifecycleCoordinatorError(
        'FINALIZATION_STORAGE_UNCERTAIN',
        'pending disposer registration did not settle before finalization deadline',
      );
    }

    const operationsAtFence = [...this.activeOperations.values()];
    const operationsSettled = await this.waitUntil(
      Promise.allSettled(operationsAtFence.map((operation) => operation.done)).then(
        () => undefined,
      ),
      deadlineAtMs,
    );
    let unresolvedOperationCount = 0;
    if (!operationsSettled) {
      unresolvedOperationCount = Math.max(1, this.activeOperations.size);
      await this.cancelScope(this.rootScopeId, 'deadline_exceeded');
      for (const operation of this.activeOperations.values()) operation.fenced = true;
    }

    const disposerOrder = [...this.disposers.values()].sort((left, right) => {
      const depthDifference =
        this.scopeDepth(right.descriptor.scopeId) - this.scopeDepth(left.descriptor.scopeId);
      return depthDifference || right.descriptor.ordinal - left.descriptor.ordinal;
    });
    let disposedCount = 0;
    let failedDisposerCount = 0;
    let timedOutDisposerCount = 0;
    let unresolvedDisposerCount = 0;
    for (const disposer of disposerOrder) {
      if (disposer.status !== 'registered') continue;
      const started = await this.append(
        'disposer.started',
        { disposerId: disposer.descriptor.disposerId },
        [disposer.registrationEventId],
      );
      disposer.status = 'started';
      const invocation = Promise.resolve().then(disposer.handler);
      const settlement = await this.settleBeforeDeadline(invocation, deadlineAtMs);
      if (settlement.status === 'timed_out') {
        timedOutDisposerCount += 1;
        unresolvedDisposerCount += 1;
        disposer.status = 'timed_out';
        void invocation.catch(() => undefined);
        await this.append(
          'disposer.settled',
          {
            disposerId: disposer.descriptor.disposerId,
            outcome: 'timed_out',
            errorCode: 'DISPOSER_TIMEOUT',
          },
          [started.eventId],
        );
      } else if (settlement.status === 'failed') {
        failedDisposerCount += 1;
        disposer.status = 'settled';
        await this.append(
          'disposer.settled',
          {
            disposerId: disposer.descriptor.disposerId,
            outcome: 'failed',
            errorCode: stableErrorCode(settlement.error),
          },
          [started.eventId],
        );
      } else {
        disposedCount += 1;
        disposer.status = 'settled';
        await this.append(
          'disposer.settled',
          { disposerId: disposer.descriptor.disposerId, outcome: 'completed', errorCode: null },
          [started.eventId],
        );
      }
    }

    const timedOut = unresolvedOperationCount > 0 || unresolvedDisposerCount > 0;
    const effectiveOutcome: TrajectoryOutcome = timedOut
      ? 'timed_out'
      : failedDisposerCount > 0 || options.outcome === 'failed'
        ? 'failed'
        : this.rootCancellationRequested || options.outcome === 'cancelled'
          ? 'cancelled'
          : 'completed';
    const scopes = [...this.scopes.values()]
      .filter((scope) => scope.open)
      .sort((left, right) => this.scopeDepth(right.scopeId) - this.scopeDepth(left.scopeId));
    for (const scope of scopes) {
      await this.append(
        'scope.closed',
        {
          scopeId: scope.scopeId,
          outcome: effectiveOutcome,
        },
        [scope.openedEventId],
      );
      scope.open = false;
    }

    await this.flushAppends();
    const unresolvedScopeCount = [...this.scopes.values()].filter((scope) => scope.open).length;
    unresolvedOperationCount = Math.max(unresolvedOperationCount, this.activeOperations.size);
    const quiescence: QuiescenceStatus =
      !timedOut && unresolvedScopeCount === 0 ? 'confirmed' : 'not_confirmed';
    const status: FinalizationResult['status'] = timedOut
      ? 'timed_out'
      : failedDisposerCount > 0
        ? 'partial'
        : 'complete';
    const receiptSummary = {
      status,
      disposedCount,
      failedDisposerCount,
      timedOutDisposerCount,
      unresolvedOperationCount,
      unresolvedScopeCount,
      unresolvedDisposerCount,
      deadlineAtMs,
      quiescence,
    };
    const predecessorTip = await this.ledger.tip();
    if (predecessorTip.hash === null) {
      throw new LifecycleCoordinatorError(
        'COORDINATOR_TERMINAL',
        'finalization predecessor tip is unavailable',
      );
    }
    const receipt = await this.append(
      'finalization.receipt',
      {
        ...receiptSummary,
        predecessorSequence: predecessorTip.sequence,
        predecessorHash: predecessorTip.hash,
        receiptDigest: sha256({ ...receiptSummary, predecessorTip }),
      },
      [finalizationStarted.eventId],
      predecessorTip,
    );
    const cleanupOutcome = timedOut
      ? ('timed_out' as const)
      : failedDisposerCount > 0
        ? ('failed' as const)
        : ('completed' as const);
    const terminal = await this.append(
      'trajectory.terminal',
      {
        outcome: effectiveOutcome,
        summaryDigest: sha256({ ...receiptSummary, receiptEventId: receipt.eventId }),
        cleanupOutcome,
        quiescence,
        receiptEventId: receipt.eventId,
      },
      [receipt.eventId],
    );
    await this.flushAppends();
    this.lifecycleState = 'TERMINAL';
    return {
      ...receiptSummary,
      receiptEventId: receipt.eventId,
      terminalEventId: terminal.eventId,
    };
  }

  private async append<Kind extends TrajectoryEventKind>(
    kind: Kind,
    payload: TrajectoryPayloadMap[Kind],
    causalEventIds: string[] = [],
    expectedTip?: LedgerTip,
  ): Promise<Extract<TrajectoryEvent, { kind: Kind }>> {
    const input = {
      eventId: eventId(kind),
      kind,
      occurredAtMs: Date.now(),
      causalEventIds,
      payload,
    } as Extract<AppendEventInput, { kind: Kind }>;
    const operation = this.appendTail.then(() => this.ledger.append(input, expectedTip));
    this.appendTail = operation.then(
      () => undefined,
      () => undefined,
    );
    const result = await operation;
    return result.event as Extract<TrajectoryEvent, { kind: Kind }>;
  }

  private async flushAppends(): Promise<void> {
    await this.appendTail;
  }

  private assertAdmissionsOpen(): void {
    if (this.lifecycleState !== 'ACTIVE') {
      throw new LifecycleCoordinatorError('ADMISSIONS_CLOSED', 'lifecycle admissions are closed');
    }
  }

  private assertScopeAdmitting(scope: ScopeState): void {
    if (!scope.open || scope.controller.signal.aborted) {
      throw new LifecycleCoordinatorError(
        'ADMISSIONS_CLOSED',
        `scope admissions are closed: ${scope.scopeId}`,
      );
    }
  }

  private requireScope(scopeId: string): ScopeState {
    const scope = this.scopes.get(scopeId);
    if (scope === undefined) {
      throw new LifecycleCoordinatorError('UNKNOWN_SCOPE', `unknown scope: ${scopeId}`);
    }
    return scope;
  }

  private abortSubtree(scope: ScopeState, reasonCode: string): void {
    scope.controller.abort(reasonCode);
    for (const child of this.scopes.values()) {
      if (child.parentScopeId === scope.scopeId) this.abortSubtree(child, reasonCode);
    }
  }

  private isDescendantOrSelf(scopeId: string, ancestorId: string): boolean {
    let current: ScopeState | undefined = this.scopes.get(scopeId);
    while (current !== undefined) {
      if (current.scopeId === ancestorId) return true;
      current = current.parentScopeId === null ? undefined : this.scopes.get(current.parentScopeId);
    }
    return false;
  }

  private isScopeCancellationRequested(scopeId: string): boolean {
    return [...this.cancellationPromises.keys()].some((cancelledScopeId) =>
      this.isDescendantOrSelf(scopeId, cancelledScopeId),
    );
  }

  private scopeDepth(scopeId: string): number {
    let depth = 0;
    let current = this.requireScope(scopeId);
    while (current.parentScopeId !== null) {
      depth += 1;
      current = this.requireScope(current.parentScopeId);
    }
    return depth;
  }

  private async waitUntil(operation: Promise<void>, deadlineAtMs: number): Promise<boolean> {
    const remaining = Math.max(0, deadlineAtMs - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async settleBeforeDeadline(
    operation: Promise<void>,
    deadlineAtMs: number,
  ): Promise<
    { status: 'completed' } | { status: 'failed'; error: unknown } | { status: 'timed_out' }
  > {
    const remaining = Math.max(0, deadlineAtMs - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation.then(
          () => ({ status: 'completed' as const }),
          (error: unknown) => ({ status: 'failed' as const, error }),
        ),
        new Promise<{ status: 'timed_out' }>((resolve) => {
          timer = setTimeout(() => resolve({ status: 'timed_out' }), remaining);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
