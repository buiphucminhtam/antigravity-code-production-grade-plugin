export type ModelTier = 'scout' | 'builder' | 'expert';

export interface ModelCapability {
  id: string;
  snapshot: string;
  tiers: ModelTier[];
}

export interface CapabilityProbe {
  probe(): Promise<ModelCapability[]>;
}

export interface ModelProvider {
  complete(request: {
    model: string;
    snapshot: string;
    prompt: string;
    timeoutMs: number;
  }): Promise<{
    output: string;
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number; cost?: number };
  }>;
}

export interface ModelCallRequest {
  taskId: string;
  accountId: string;
  prompt: string;
  riskSignals?: string[];
  estimatedCost?: number;
}

export interface ModelTelemetryEvent {
  task_id: string;
  account_id: string;
  tier: ModelTier;
  model: string;
  snapshot: string;
  reason: string;
  retry_count: number;
  latency_ms: number;
  usage_unavailable: boolean;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  estimated_cost?: number;
}

export interface BudgetPolicy {
  allowOverage?: boolean;
}

export type BudgetStatus = 'ok' | 'warning' | 'authority_required' | 'blocked' | 'allowed_override';

export interface BudgetReservation {
  readonly id: string;
  readonly taskId: string;
  readonly accountId: string;
  readonly estimatedCost: number;
}

export class BudgetLedger {
  private readonly taskSpend = new Map<string, number>();
  private readonly accountSpend = new Map<string, number>();
  private readonly taskReserved = new Map<string, number>();
  private readonly accountReserved = new Map<string, number>();
  private readonly reservations = new Map<string, BudgetReservation>();
  private nextReservationId = 0;

  constructor(private readonly limits: { taskLimit: number; accountLimit: number }) {}

  record(taskId: string, accountId: string, cost: number): void {
    this.taskSpend.set(taskId, (this.taskSpend.get(taskId) ?? 0) + cost);
    this.accountSpend.set(accountId, (this.accountSpend.get(accountId) ?? 0) + cost);
  }

  preflight(
    taskId: string,
    accountId: string,
    estimatedCost: number,
    policy: BudgetPolicy = {},
  ): { status: BudgetStatus; projectedTask: number; projectedAccount: number } {
    return this.evaluate(taskId, accountId, estimatedCost, policy, false);
  }

  reserve(
    taskId: string,
    accountId: string,
    estimatedCost: number,
    policy: BudgetPolicy = {},
  ): {
    status: BudgetStatus;
    reservation?: BudgetReservation;
    projectedTask: number;
    projectedAccount: number;
  } {
    const evaluation = this.evaluate(taskId, accountId, estimatedCost, policy, true);
    if (evaluation.status === 'blocked' || evaluation.status === 'authority_required')
      return evaluation;
    const reservation: BudgetReservation = {
      id: `budget-${++this.nextReservationId}`,
      taskId,
      accountId,
      estimatedCost,
    };
    this.reservations.set(reservation.id, reservation);
    this.taskReserved.set(taskId, (this.taskReserved.get(taskId) ?? 0) + estimatedCost);
    this.accountReserved.set(accountId, (this.accountReserved.get(accountId) ?? 0) + estimatedCost);
    return { ...evaluation, reservation };
  }

  settle(reservation: BudgetReservation, actualCost: number): void {
    this.release(reservation);
    this.record(reservation.taskId, reservation.accountId, actualCost);
  }

  release(reservation: BudgetReservation): void {
    if (!this.reservations.delete(reservation.id)) return;
    this.decrement(this.taskReserved, reservation.taskId, reservation.estimatedCost);
    this.decrement(this.accountReserved, reservation.accountId, reservation.estimatedCost);
  }

  private evaluate(
    taskId: string,
    accountId: string,
    estimatedCost: number,
    policy: BudgetPolicy,
    includeReservations: boolean,
  ): { status: BudgetStatus; projectedTask: number; projectedAccount: number } {
    const projectedTask =
      (this.taskSpend.get(taskId) ?? 0) +
      (includeReservations ? (this.taskReserved.get(taskId) ?? 0) : 0) +
      estimatedCost;
    const projectedAccount =
      (this.accountSpend.get(accountId) ?? 0) +
      (includeReservations ? (this.accountReserved.get(accountId) ?? 0) : 0) +
      estimatedCost;
    const ratio = Math.max(
      projectedTask / this.limits.taskLimit,
      projectedAccount / this.limits.accountLimit,
    );
    if (ratio >= 1)
      return {
        status: policy.allowOverage ? 'allowed_override' : 'blocked',
        projectedTask,
        projectedAccount,
      };
    if (ratio >= 0.95) return { status: 'authority_required', projectedTask, projectedAccount };
    if (ratio >= 0.8) return { status: 'warning', projectedTask, projectedAccount };
    return { status: 'ok', projectedTask, projectedAccount };
  }

  private decrement(values: Map<string, number>, key: string, amount: number): void {
    const next = (values.get(key) ?? 0) - amount;
    if (next <= 0) values.delete(key);
    else values.set(key, next);
  }
}

interface CircuitState {
  failures: number;
  openedAt?: number;
}

export class ModelCallGateway {
  private capabilities?: Promise<ModelCapability[]>;
  private readonly turns = new Map<string, number>();
  private readonly circuit: CircuitState = { failures: 0 };
  private readonly retry: { maxAttempts: number; baseDelayMs: number };
  private readonly caps: { timeoutMs: number; maxOutputChars: number; maxTurns: number };
  private readonly circuitPolicy: { failureThreshold: number; resetAfterMs: number };

  constructor(
    private readonly options: {
      probe: CapabilityProbe;
      telemetry?: (event: ModelTelemetryEvent) => void;
      budget?: BudgetLedger;
      retry?: { maxAttempts?: number; baseDelayMs?: number };
      circuit?: { failureThreshold?: number; resetAfterMs?: number };
      caps?: { timeoutMs?: number; maxOutputChars?: number; maxTurns?: number };
      authorizeOverage?: (request: ModelCallRequest) => boolean;
    },
  ) {
    this.retry = {
      maxAttempts: options.retry?.maxAttempts ?? 3,
      baseDelayMs: options.retry?.baseDelayMs ?? 100,
    };
    this.circuitPolicy = {
      failureThreshold: options.circuit?.failureThreshold ?? 3,
      resetAfterMs: options.circuit?.resetAfterMs ?? 30_000,
    };
    this.caps = {
      timeoutMs: options.caps?.timeoutMs ?? 30_000,
      maxOutputChars: options.caps?.maxOutputChars ?? 32_768,
      maxTurns: options.caps?.maxTurns ?? 12,
    };
  }

  async execute(
    request: ModelCallRequest,
    provider: ModelProvider,
  ): Promise<{
    output: string;
    route: { tier: ModelTier; model: string; snapshot: string; reason: string };
    usageUnavailable: boolean;
  }> {
    const turn = (this.turns.get(request.taskId) ?? 0) + 1;
    if (turn > this.caps.maxTurns) throw new Error('Model turn cap exceeded');
    if (this.options.budget && request.estimatedCost === undefined) {
      throw new Error('Budgeted model calls require an estimated cost');
    }
    this.turns.set(request.taskId, turn);
    this.assertCircuitClosed();
    const route = await this.selectRoute(request.riskSignals ?? []);
    const reservationResult = this.options.budget?.reserve(
      request.taskId,
      request.accountId,
      request.estimatedCost ?? 0,
      { allowOverage: this.options.authorizeOverage?.(request) ?? false },
    );
    if (reservationResult?.status === 'blocked') throw new Error('Budget exhausted; call blocked');
    if (reservationResult?.status === 'authority_required')
      throw new Error('Budget authority required before call');
    const reservation = reservationResult?.reservation;
    const started = Date.now();
    let lastError: unknown;
    for (let attempt = 0; attempt < this.retry.maxAttempts; attempt++) {
      try {
        const response = await this.withTimeout(
          provider.complete({
            model: route.model,
            snapshot: route.snapshot,
            prompt: request.prompt,
            timeoutMs: this.caps.timeoutMs,
          }),
        );
        this.circuit.failures = 0;
        this.circuit.openedAt = undefined;
        if (reservation)
          this.options.budget?.settle(
            reservation,
            response.usage?.cost ?? request.estimatedCost ?? 0,
          );
        this.options.telemetry?.({
          task_id: request.taskId,
          account_id: request.accountId,
          tier: route.tier,
          model: route.model,
          snapshot: route.snapshot,
          reason: route.reason,
          retry_count: attempt,
          latency_ms: Date.now() - started,
          usage_unavailable: response.usage === undefined,
          input_tokens: response.usage?.inputTokens,
          output_tokens: response.usage?.outputTokens,
          cached_tokens: response.usage?.cachedTokens,
          estimated_cost: response.usage?.cost ?? request.estimatedCost,
        });
        return {
          output: response.output.slice(0, this.caps.maxOutputChars),
          route,
          usageUnavailable: response.usage === undefined,
        };
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error)) break;
        if (attempt + 1 < this.retry.maxAttempts && this.retry.baseDelayMs > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, this.retry.baseDelayMs * (attempt + 1)),
          );
      }
    }
    this.circuit.failures++;
    if (this.circuit.failures >= this.circuitPolicy.failureThreshold)
      this.circuit.openedAt = Date.now();
    if (reservation) this.options.budget?.release(reservation);
    throw lastError instanceof Error ? lastError : new Error('Model call failed');
  }

  private async selectRoute(
    riskSignals: string[],
  ): Promise<{ tier: ModelTier; model: string; snapshot: string; reason: string }> {
    const tier: ModelTier = riskSignals.some((signal) =>
      /security|public-api|schema|concurrency/i.test(signal),
    )
      ? 'expert'
      : riskSignals.length > 0
        ? 'builder'
        : 'scout';
    const capabilities = await (this.capabilities ??= this.options.probe.probe());
    const capability = capabilities.find((candidate) => candidate.tiers.includes(tier));
    if (!capability) throw new Error(`No capable model available for ${tier}`);
    return {
      tier,
      model: capability.id,
      snapshot: capability.snapshot,
      reason: riskSignals.length ? `risk:${riskSignals.join(',')}` : 'default-low-risk',
    };
  }

  private assertCircuitClosed(): void {
    if (this.circuit.openedAt === undefined) return;
    if (Date.now() - this.circuit.openedAt >= this.circuitPolicy.resetAfterMs) {
      this.circuit.failures = 0;
      this.circuit.openedAt = undefined;
      return;
    }
    throw new Error('Model circuit is open');
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    const startedAt = performance.now();
    const timeoutError = () =>
      Object.assign(new Error('Model call timed out'), { code: 'MODEL_CALL_TIMEOUT' });
    const guardedPromise = promise.then((value) => {
      // A heavily loaded event loop can delay the timeout callback until after
      // the provider's own completion callback. Enforce the elapsed-time cap at
      // settlement too, so an overdue provider result can never win the race.
      if (performance.now() - startedAt >= this.caps.timeoutMs) throw timeoutError();
      return value;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        guardedPromise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(timeoutError()), this.caps.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private isRetryable(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { retryable?: unknown; status?: unknown; code?: unknown };
    if (candidate.code === 'MODEL_CALL_TIMEOUT') return false;
    if (candidate.retryable === true) return true;
    return (
      candidate.status === 429 || (typeof candidate.status === 'number' && candidate.status >= 500)
    );
  }
}
