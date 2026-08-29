import { MiddlewareChain } from '../middleware/chain.js';
import { createHash, randomUUID } from 'node:crypto';
import type { MiddlewareConfig, ToolResult } from '../middleware/types.js';
import {
  ProcessPolicyEvaluator,
  type PolicyAction,
  type PolicyEvaluator,
} from '../middleware/guardrail.js';
import { LifecycleCoordinator, LifecycleCoordinatorError } from './lifecycle-coordinator.js';
import { ExecutionContainment } from './execution-containment.js';

let nextLifecycleSequence = 0;
const INVALID_JSON_INPUT_DIGEST = createHash('sha256')
  .update('TOOL_INPUT_INVALID_JSON', 'utf8')
  .digest('hex');

export interface ToolExecutionRequest {
  name: string;
  arguments: Record<string, unknown>;
  sessionId: string;
  turnNumber: number;
}

export interface ToolExecutionTelemetry {
  tool: string;
  authorized: boolean;
  cached?: boolean;
  middleware_ms?: number;
  quality?: 'pass' | 'warn' | 'blocked';
  verification?: 'pass' | 'fail';
  output_chars?: number;
  policy?: PolicyAction;
  containment?: string;
  containment_profile?: string;
}

class ToolResultLifecycleFailure extends Error {
  readonly code = 'TOOL_RESULT_ERROR';

  constructor(readonly result: ToolResult) {
    super('tool returned an error result');
    this.name = 'ToolResultLifecycleFailure';
  }
}

function canonicalToolInput(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('tool arguments must be finite JSON values');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('tool arguments must be JSON values');
  if (seen.has(value)) throw new TypeError('tool arguments must not contain cycles');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalToolInput(entry, seen)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('tool arguments must use plain JSON objects');
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalToolInput(record[key], seen)}`)
      .join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function toolInputDigest(request: ToolExecutionRequest): string {
  return createHash('sha256')
    .update(canonicalToolInput({ tool: request.name, arguments: request.arguments }), 'utf8')
    .digest('hex');
}

function lifecycleErrorResult(): ToolResult {
  return {
    isError: true,
    content: [
      { type: 'text', text: 'Tool execution is unavailable: lifecycle admissions are closed.' },
    ],
  };
}

function invalidToolArgumentsResult(): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: 'Tool execution arguments must be JSON-compatible.' }],
  };
}

export class ToolExecutionGateway {
  private readonly chain: MiddlewareChain;

  constructor(
    private readonly options: {
      authorize?: (
        toolName: string,
        arguments_: Record<string, unknown>,
      ) => boolean | Promise<boolean>;
      telemetry?: (event: ToolExecutionTelemetry) => void;
      middleware?: MiddlewareConfig;
      policyEvaluator?: PolicyEvaluator;
      lifecycle?: LifecycleCoordinator;
      containment?: ExecutionContainment;
    } = {},
  ) {
    this.chain = new MiddlewareChain({
      policyEvaluator: options.policyEvaluator ?? new ProcessPolicyEvaluator(),
      config: options.middleware ?? {
        tool_sandbox: { enabled: true },
        context_offload: { enabled: true, min_tokens_to_offload: 2_000 },
        session_deduplication: {
          enabled: true,
          include_tools: ['fw_get_current_phase', 'fw_check_pipeline_compliance'],
        },
      },
    });
  }

  async execute(
    request: ToolExecutionRequest,
    execute: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    if (this.options.lifecycle === undefined) {
      const containment = this.options.containment?.admit(request.name, request.arguments);
      if (containment && !containment.allowed) {
        this.options.telemetry?.({
          tool: request.name,
          authorized: false,
          containment: containment.code,
          containment_profile: containment.profileDigest,
        });
        return { isError: true, content: [{ type: 'text', text: containment.code }] };
      }
      return this.executeUnchecked(request, execute);
    }

    const sequence = ++nextLifecycleSequence;
    const scopeId = `tool-scope:${sequence}`;
    const operationId = `tool-operation:${sequence}`;
    const lifecycle = this.options.lifecycle;
    try {
      await lifecycle.openScope({
        scopeId,
        parentScopeId: lifecycle.rootScopeId,
        scopeType: 'tool_execution',
      });
    } catch (error) {
      if (
        error instanceof LifecycleCoordinatorError &&
        (error.code === 'ADMISSIONS_CLOSED' || error.code === 'COORDINATOR_TERMINAL')
      ) {
        return lifecycleErrorResult();
      }
      throw error;
    }

    let outcome: 'completed' | 'failed' | 'cancelled' = 'completed';
    let result: ToolResult | undefined;
    let operationError: unknown;
    let hasOperationError = false;
    try {
      let inputDigest: string;
      let invalidArguments = false;
      try {
        inputDigest = toolInputDigest(request);
      } catch {
        inputDigest = INVALID_JSON_INPUT_DIGEST;
        invalidArguments = true;
      }
      result = await lifecycle.runOperation(
        {
          operationId,
          scopeId,
          operationType: 'tool_execution',
          inputDigest,
        },
        async () => {
          if (invalidArguments) throw new ToolResultLifecycleFailure(invalidToolArgumentsResult());
          const containment = this.options.containment?.admit(request.name, request.arguments);
          if (containment && !containment.allowed) {
            this.options.telemetry?.({
              tool: request.name,
              authorized: false,
              containment: containment.code,
              containment_profile: containment.profileDigest,
            });
            throw new ToolResultLifecycleFailure({
              isError: true,
              content: [{ type: 'text', text: containment.code }],
            });
          }
          const result = await this.executeUnchecked(request, execute);
          if (result.isError) throw new ToolResultLifecycleFailure(result);
          return result;
        },
      );
    } catch (error) {
      if (error instanceof ToolResultLifecycleFailure) {
        outcome = 'failed';
        result = error.result;
      } else {
        outcome =
          error instanceof LifecycleCoordinatorError && error.code === 'LATE_RESULT_DISCARDED'
            ? 'cancelled'
            : 'failed';
        operationError = error;
        hasOperationError = true;
      }
    }
    let closeError: unknown;
    try {
      await lifecycle.closeScope(scopeId, outcome);
    } catch (error) {
      if (!(
        error instanceof LifecycleCoordinatorError &&
        (error.code === 'SCOPE_ALREADY_CLOSED' ||
          error.code === 'COORDINATOR_TERMINAL' ||
          (error.code === 'ADMISSIONS_CLOSED' && lifecycle.state === 'FINALIZING'))
      )) {
        closeError = error;
      }
    }
    if (hasOperationError) throw operationError;
    if (closeError !== undefined) throw closeError;
    return result as ToolResult;
  }

  private async executeUnchecked(
    request: ToolExecutionRequest,
    execute: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const authorized = await (this.options.authorize?.(request.name, request.arguments) ?? true);
    if (!authorized) {
      this.options.telemetry?.({ tool: request.name, authorized: false });
      return {
        isError: true,
        content: [{ type: 'text', text: 'Tool execution is not authorized.' }],
      };
    }
    const completed = await this.chain.executeTool(
      {
        id: `${request.sessionId}:${request.turnNumber}:${request.name}:${randomUUID()}`,
        toolName: request.name,
        toolArgs: request.arguments,
        startTime: Date.now(),
      },
      'orchestrator',
      'feature',
      'build',
      request.turnNumber,
      request.sessionId,
      '',
      execute,
    );
    const quality = completed.qualityGate?.blocked
      ? 'blocked'
      : completed.qualityGate && completed.qualityGate.score < completed.qualityGate.threshold
        ? 'warn'
        : 'pass';
    const policyBlocked =
      completed.guardrail?.action === 'block' || completed.guardrail?.action === 'config-error';
    this.options.telemetry?.({
      tool: request.name,
      authorized: !policyBlocked,
      policy: completed.guardrail?.action,
      cached: completed.cached,
      middleware_ms: completed.middlewareMs,
      quality,
      verification: completed.verification?.status,
      output_chars: completed.result.content
        .map((block) => block.text.length)
        .reduce((total, size) => total + size, 0),
    });
    if (policyBlocked) return completed.result;
    if (!completed.offloadRef) return completed.result;
    return {
      ...completed.result,
      content: [
        {
          type: 'text',
          text: `${completed.result.content[0]?.text ?? ''}\n[offloaded result: ${completed.offloadRef}]`,
        },
      ],
    };
  }
}
