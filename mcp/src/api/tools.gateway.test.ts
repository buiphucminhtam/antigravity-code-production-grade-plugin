import { describe, expect, it, vi } from 'vitest';
import { ToolExecutionGateway } from '../runtime/tool-execution-gateway.js';
import { registerTools } from './tools.js';
import * as skillParser from '../parsers/skill-parser.js';

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
      { deferredSkillNames: ['software-engineer'] },
    );
    const result = await (handlers[1] as Handler)({
      params: { name: 'not-a-published-tool', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toMatchObject({ tool: 'not-a-published-tool', authorized: true });
  });

  it('uses the injected session and monotonically increasing turns', async () => {
    type Handler = (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => Promise<{ isError?: boolean }>;
    const handlers: unknown[] = [];
    const server = {
      setRequestHandler: (_schema: unknown, handler: unknown) => handlers.push(handler),
    };
    const gateway = new ToolExecutionGateway({
      policyEvaluator: { evaluate: async () => ({ action: 'allow' }) },
      middleware: { tool_sandbox: { enabled: false } },
    });
    const execute = vi.spyOn(gateway, 'execute');

    registerTools(server as never, gateway, { sessionId: 'injected-session' });
    await (handlers[1] as Handler)({ params: { name: 'missing-one', arguments: {} } });
    await (handlers[1] as Handler)({ params: { name: 'missing-two', arguments: {} } });

    expect(execute.mock.calls.map(([request]) => request)).toMatchObject([
      { sessionId: 'injected-session', turnNumber: 1 },
      { sessionId: 'injected-session', turnNumber: 2 },
    ]);
  });

  it('exposes only requested bounded skill overlays with stable errors', async () => {
    type Handler = (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => Promise<unknown>;
    const handlers: unknown[] = [];
    const server = {
      setRequestHandler: (_schema: unknown, handler: unknown) => handlers.push(handler),
    };
    vi.spyOn(skillParser, 'loadSkillOverlay').mockReturnValue({
      name: 'software-engineer',
      content: 'overlay',
      digest: 'a'.repeat(64),
      bytes: 7,
      tokens: 2,
    });
    registerTools(
      server as never,
      new ToolExecutionGateway({
        middleware: {
          tool_sandbox: { enabled: false },
          quality_gate: { enabled: false },
          verification: { enabled: false },
          session_deduplication: { enabled: false },
        },
      }),
      { deferredSkillNames: ['software-engineer'] },
    );
    await expect(
      (handlers[1] as Handler)({
        params: { name: 'fw_load_skill_overlay', arguments: { name: 'software-engineer' } },
      }),
    ).resolves.toMatchObject({
      content: [{ text: 'overlay' }],
      structuredContent: { name: 'software-engineer', tokens: 2 },
    });
    await expect(
      (handlers[1] as Handler)({
        params: { name: 'fw_load_skill_overlay', arguments: { name: 'ui-designer' } },
      }),
    ).resolves.toMatchObject({ isError: true, content: [{ text: 'SKILL_OVERLAY_NOT_ALLOWED' }] });
    await expect(
      (handlers[1] as Handler)({
        params: { name: 'fw_load_skill_overlay', arguments: { name: 'software-engineer' } },
      }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'SKILL_OVERLAY_ALREADY_LOADED' }],
    });
  });

  it('allows a retry only after a failed first overlay load', async () => {
    type Handler = (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => Promise<unknown>;
    const handlers: unknown[] = [];
    const server = {
      setRequestHandler: (_schema: unknown, handler: unknown) => handlers.push(handler),
    };
    vi.spyOn(skillParser, 'loadSkillOverlay')
      .mockImplementationOnce(() => {
        throw new skillParser.SkillOverlayError('UNKNOWN_SKILL');
      })
      .mockReturnValue({
        name: 'software-engineer',
        content: 'retry overlay',
        digest: 'b'.repeat(64),
        bytes: 13,
        tokens: 4,
      });
    registerTools(
      server as never,
      new ToolExecutionGateway({
        middleware: {
          tool_sandbox: { enabled: false },
          quality_gate: { enabled: false },
          verification: { enabled: false },
          session_deduplication: { enabled: false },
        },
      }),
      { deferredSkillNames: ['software-engineer'] },
    );
    await expect(
      (handlers[1] as Handler)({
        params: { name: 'fw_load_skill_overlay', arguments: { name: 'software-engineer' } },
      }),
    ).resolves.toMatchObject({ isError: true, content: [{ text: 'UNKNOWN_SKILL' }] });
    await expect(
      (handlers[1] as Handler)({
        params: { name: 'fw_load_skill_overlay', arguments: { name: 'software-engineer' } },
      }),
    ).resolves.toMatchObject({ content: [{ text: 'retry overlay' }] });
  });

  it('does not publish the deferred loader without an allowlist', async () => {
    const handlers: unknown[] = [];
    const server = {
      setRequestHandler: (_schema: unknown, handler: unknown) => handlers.push(handler),
    };
    registerTools(server as never);
    await expect(
      (handlers[0] as () => Promise<{ tools: Array<{ name: string }> }>)(),
    ).resolves.toMatchObject({
      tools: expect.not.arrayContaining([
        expect.objectContaining({ name: 'fw_load_skill_overlay' }),
      ]),
    });
  });
});
