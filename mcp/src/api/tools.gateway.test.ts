import { describe, expect, it } from 'vitest';
import { ToolExecutionGateway } from '../runtime/tool-execution-gateway.js';
import { registerTools } from './tools.js';

describe('registerTools gateway traversal', () => {
  it('routes canonical MCP call handlers through ToolExecutionGateway', async () => {
    type Handler = (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => Promise<{ isError?: boolean }>;
    const handlers: unknown[] = [];
    const server = {
      setRequestHandler: (_schema: unknown, handler: unknown) => handlers.push(handler),
    };
    const telemetry: unknown[] = [];
    registerTools(
      server as never,
      new ToolExecutionGateway({
        telemetry: (event) => telemetry.push(event),
        policyEvaluator: { evaluate: async () => ({ action: 'allow' }) },
        middleware: { tool_sandbox: { enabled: true, enable_audit: false } },
      }),
    );
    const result = await (handlers[1] as Handler)({
      params: { name: 'not-a-published-tool', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toMatchObject({ tool: 'not-a-published-tool', authorized: true });
  });
});
