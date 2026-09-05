import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionGateway } from '../runtime/tool-execution-gateway.js';
import {
  createProductIntentToolService,
  createProductIntentToolRuntime,
  ProductIntentEventLogPublisher,
  ProductIntentToolError,
  ProductIntentToolRuntime,
  ProductIntentToolRuntimeFactory,
  ProductIntentToolService,
} from '../product-factory/product-intent-runtime.js';
import {
  createProductIntent,
  ProductIntentCreateInput,
  ProductIntentValidationError,
  StaleProductDeltaError,
} from '../product-factory/product-intent.js';
import { PRODUCT_INTENT_UPDATED_EVENT } from '../product-factory/product-intent-service.js';
import { registerTools } from './tools.js';

type Request = {
  params: { name: string; arguments?: Record<string, unknown> };
};
type Handler = (request: Request) => Promise<{
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forgewright-pf1-api-'));
  temporaryDirectories.push(directory);
  return directory;
}

function harness(
  runtime: ProductIntentToolRuntime,
  runtimeFactory: ProductIntentToolRuntimeFactory = () => runtime,
) {
  const handlers: unknown[] = [];
  const server = {
    setRequestHandler: (_schema: unknown, handler: unknown) => handlers.push(handler),
  };
  const gateway = new ToolExecutionGateway({
    policyEvaluator: { evaluate: async () => ({ action: 'allow' }) },
    middleware: {
      tool_sandbox: { enabled: false },
      quality_gate: { enabled: false },
      verification: { enabled: false },
      session_deduplication: { enabled: false },
    },
  });
  const execute = vi.spyOn(gateway, 'execute');
  const factory = vi.fn(runtimeFactory);
  registerTools(server as never, gateway, {
    sessionId: 'product-intent-test',
    productIntentRuntimeFactory: factory,
  });
  return {
    list: handlers[0] as () => Promise<{ tools: Array<Record<string, unknown>> }>,
    call: handlers[1] as Handler,
    execute,
    factory,
  };
}

function fakeRuntime(): ProductIntentToolRuntime {
  return {
    execute: vi.fn(async (name, args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ name, args }) }],
      structuredContent: { name, args },
    })),
  };
}

function intentInput(): ProductIntentCreateInput {
  return {
    intentId: 'intent-api',
    createdAt: '2025-01-01T00:00:00.000Z',
    problem: { id: 'problem-one', statement: 'Original problem.', evidenceRefs: [] },
    targetActors: [
      { id: 'actor-one', name: 'Actor', description: 'Primary actor.', evidenceRefs: [] },
    ],
    jobsToBeDone: [
      {
        id: 'job-one',
        actorIds: ['actor-one'],
        statement: 'Complete the scenario.',
        desiredOutcomeIds: ['outcome-one'],
      },
    ],
    desiredOutcomes: [{ id: 'outcome-one', statement: 'Outcome.', acceptanceRefs: ['accept-one'] }],
    constraints: [],
    nonGoals: [],
    preferences: [],
    scenarios: [
      {
        id: 'scenario-one',
        name: 'Scenario',
        platform: 'cross-platform',
        actorIds: ['actor-one'],
        jobIds: ['job-one'],
        outcomeIds: ['outcome-one'],
        preconditions: [],
        steps: ['Act.'],
        expectedOutcomes: ['Outcome occurs.'],
      },
    ],
    uncertainty: [],
    decisions: [],
    acceptanceRefs: [
      { id: 'accept-one', statement: 'The outcome is observed.', evidenceRef: null },
    ],
    provenance: [
      {
        id: 'source-user',
        source: 'current-explicit-user',
        reference: 'Current request.',
        observedAt: '2025-01-01T00:00:00.000Z',
        current: true,
        approved: true,
      },
    ],
    goalGraph: {
      nodes: [
        { id: 'goal-outcome', type: 'outcome', statement: 'Outcome.', intentRef: 'outcome-one' },
        { id: 'goal-capability', type: 'capability', statement: 'Capability.', intentRef: null },
        {
          id: 'goal-scenario',
          type: 'scenario',
          statement: 'Scenario.',
          intentRef: 'scenario-one',
        },
      ],
      edges: [
        { id: 'edge-one', from: 'goal-outcome', to: 'goal-capability' },
        { id: 'edge-two', from: 'goal-capability', to: 'goal-scenario' },
      ],
    },
  };
}

function fakeService(overrides: Partial<ProductIntentToolService> = {}): ProductIntentToolService {
  const intent = createProductIntent(intentInput());
  return {
    load: vi.fn(async () => intent),
    initialize: vi.fn(async () => intent),
    applyDelta: vi.fn(async () => intent),
    getLastEventDeliveryFailure: vi.fn(() => null),
    ...overrides,
  };
}

describe('product-intent canonical MCP tools', () => {
  it('publishes the exact strict top-level schemas', async () => {
    const { list } = harness(fakeRuntime());
    const tools = await list();
    const selected = tools.tools.filter(
      ({ name }) => String(name).startsWith('fw_') && String(name).includes('product'),
    );

    expect(selected).toEqual([
      {
        name: 'fw_get_product_intent',
        description: expect.any(String),
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: 'fw_initialize_product_intent',
        description: expect.any(String),
        inputSchema: {
          type: 'object',
          properties: { intent: { type: 'object' } },
          required: ['intent'],
          additionalProperties: false,
        },
      },
      {
        name: 'fw_apply_product_delta',
        description: expect.any(String),
        inputSchema: {
          type: 'object',
          properties: { delta: { type: 'object' } },
          required: ['delta'],
          additionalProperties: false,
        },
      },
      {
        name: 'fw_get_product_goal_projection',
        description: expect.any(String),
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: 'fw_evaluate_product_clarification',
        description: expect.any(String),
        inputSchema: {
          type: 'object',
          properties: { userDirective: { type: 'string' } },
          additionalProperties: false,
        },
      },
    ]);
  });

  it('routes all five calls through the gateway and injected runtime', async () => {
    const runtime = fakeRuntime();
    const { call, execute, factory } = harness(runtime);
    const calls: Array<[string, Record<string, unknown>]> = [
      ['fw_get_product_intent', {}],
      ['fw_initialize_product_intent', { intent: { problem: 'x' } }],
      ['fw_apply_product_delta', { delta: { operations: [] } }],
      ['fw_get_product_goal_projection', {}],
      ['fw_evaluate_product_clarification', { userDirective: 'you decide' }],
    ];

    for (const [name, args] of calls) {
      await expect(call({ params: { name, arguments: args } })).resolves.toMatchObject({
        structuredContent: { name, args },
      });
    }

    expect(execute).toHaveBeenCalledTimes(5);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(runtime.execute).toHaveBeenCalledTimes(5);
  });

  it('sanitizes runtime factory and dispatch exceptions without leaking messages or paths', async () => {
    const factoryFailure = harness(fakeRuntime(), () => {
      throw new Error('secret factory path /private/workspace');
    });
    const factoryResponse = await factoryFailure.call({
      params: { name: 'fw_get_product_intent', arguments: {} },
    });
    expect(factoryResponse).toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_UNAVAILABLE' }],
    });
    expect(JSON.stringify(factoryResponse)).not.toContain('/private/workspace');

    const dispatchFailure = harness({
      execute: vi.fn(async () => {
        throw new Error('secret dispatch credential');
      }),
    });
    const dispatchResponse = await dispatchFailure.call({
      params: { name: 'fw_get_product_intent', arguments: {} },
    });
    expect(dispatchResponse).toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_UNAVAILABLE' }],
    });
    expect(JSON.stringify(dispatchResponse)).not.toContain('secret dispatch credential');

    const forgedTypedFailure = harness({
      execute: vi.fn(async () => {
        throw new ProductIntentToolError('secret typed error' as never);
      }),
    });
    const forgedTypedResponse = await forgedTypedFailure.call({
      params: { name: 'fw_get_product_intent', arguments: {} },
    });
    expect(forgedTypedResponse).toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_UNAVAILABLE' }],
    });
    expect(JSON.stringify(forgedTypedResponse)).not.toContain('secret typed error');

    const serviceFactoryFailure = harness(
      createProductIntentToolRuntime(() => {
        throw new Error('secret service factory path /private/state');
      }),
    );
    const serviceFactoryResponse = await serviceFactoryFailure.call({
      params: { name: 'fw_get_product_intent', arguments: {} },
    });
    expect(serviceFactoryResponse).toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_UNAVAILABLE' }],
    });
    expect(JSON.stringify(serviceFactoryResponse)).not.toContain('/private/state');
  });

  it('invokes the injected service for get, initialize, delta, projection, and clarification', async () => {
    const service = fakeService();
    const runtime = createProductIntentToolRuntime(() => service);

    await runtime.execute('fw_get_product_intent', {});
    await runtime.execute('fw_initialize_product_intent', { intent: intentInput() });
    await runtime.execute('fw_apply_product_delta', { delta: { operations: [] } });
    await runtime.execute('fw_get_product_goal_projection', {});
    await runtime.execute('fw_evaluate_product_clarification', { userDirective: 'you decide' });

    expect(service.load).toHaveBeenCalledTimes(3);
    expect(service.initialize).toHaveBeenCalledWith(intentInput());
    expect(service.applyDelta).toHaveBeenCalledWith({ operations: [] });
  });

  it('returns explicit uninitialized results without fabricating intent or projection', async () => {
    const service = fakeService({ load: vi.fn(async () => null) });
    const runtime = createProductIntentToolRuntime(() => service);

    for (const [name, args] of [
      ['fw_get_product_intent', {}],
      ['fw_get_product_goal_projection', {}],
      ['fw_evaluate_product_clarification', {}],
    ] as const) {
      await expect(runtime.execute(name, args)).resolves.toMatchObject({
        structuredContent: { initialized: false },
      });
    }
  });

  it('fails malformed, missing, and nested-invalid arguments with stable typed codes', async () => {
    const service = fakeService({
      initialize: vi.fn(async () => {
        throw new ProductIntentValidationError('secret nested validation detail');
      }),
    });
    const runtime = createProductIntentToolRuntime(() => service);
    const { call } = harness(runtime);

    await expect(
      call({ params: { name: 'fw_initialize_product_intent', arguments: {} } }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_INVALID_ARGUMENTS' }],
    });
    await expect(
      call({
        params: {
          name: 'fw_apply_product_delta',
          arguments: { delta: {}, unexpected: true },
        },
      }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_INVALID_ARGUMENTS' }],
    });
    await expect(
      call({
        params: {
          name: 'fw_evaluate_product_clarification',
          arguments: { userDirective: 7 },
        },
      }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_INVALID_ARGUMENTS' }],
    });
    const nested = await call({
      params: { name: 'fw_initialize_product_intent', arguments: { intent: { extra: true } } },
    });
    expect(nested).toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_INVALID' }],
    });
    expect(JSON.stringify(nested)).not.toContain('secret nested validation detail');
  });

  it('reports post-commit event delivery failure without failing the mutation or leaking errors', async () => {
    const intent = createProductIntent(intentInput());
    const service = fakeService({
      initialize: vi.fn(async () => intent),
      getLastEventDeliveryFailure: vi.fn(() => ({
        eventName: PRODUCT_INTENT_UPDATED_EVENT,
        intentId: intent.intentId,
        version: intent.version,
        error: new Error('credential=do-not-leak'),
      })),
    });
    const runtime = createProductIntentToolRuntime(() => service);

    const response = await runtime.execute('fw_initialize_product_intent', {
      intent: intentInput(),
    });

    expect(response).toMatchObject({
      structuredContent: {
        initialized: true,
        intent,
        version: intent.version,
        hash: intent.hash,
        eventDelivery: {
          status: 'failed',
          code: 'PRODUCT_INTENT_EVENT_DELIVERY_FAILED',
          eventName: PRODUCT_INTENT_UPDATED_EVENT,
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain('credential=do-not-leak');
  });

  it('maps stale product deltas to a distinct stable tool error', async () => {
    const service = fakeService({
      applyDelta: vi.fn(async () => {
        throw new StaleProductDeltaError('secret stale state detail');
      }),
    });
    const { call } = harness(createProductIntentToolRuntime(() => service));

    const response = await call({
      params: { name: 'fw_apply_product_delta', arguments: { delta: {} } },
    });

    expect(response).toMatchObject({
      isError: true,
      content: [{ text: 'PRODUCT_INTENT_STALE_DELTA' }],
    });
    expect(JSON.stringify(response)).not.toContain('secret stale state detail');
  });

  it('uses an acknowledging publisher that creates one durable JSONL event', async () => {
    const directory = workspace();
    const runtime = createProductIntentToolRuntime(() => createProductIntentToolService(directory));

    const response = await runtime.execute('fw_initialize_product_intent', {
      intent: intentInput(),
    });

    expect(response.structuredContent).toMatchObject({
      initialized: true,
      eventDelivery: { status: 'delivered' },
    });
    const lines = fs
      .readFileSync(path.join(directory, '.forgewright', 'events.log'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: PRODUCT_INTENT_UPDATED_EVENT,
      payload: { intentId: 'intent-api', version: 1 },
    });
  });

  it('keeps a committed mutation successful when the strict event target is a symlink', async () => {
    const directory = workspace();
    const stateDirectory = path.join(directory, '.forgewright');
    const outsideTarget = path.join(directory, 'outside-events.log');
    fs.mkdirSync(stateDirectory);
    fs.writeFileSync(outsideTarget, 'sentinel\n');
    const linkTarget =
      process.platform === 'win32' ? path.join(directory, 'outside-events') : outsideTarget;
    if (process.platform === 'win32') fs.mkdirSync(linkTarget);
    fs.symlinkSync(
      linkTarget,
      path.join(stateDirectory, 'events.log'),
      process.platform === 'win32' ? 'junction' : 'file',
    );
    expect(fs.lstatSync(path.join(stateDirectory, 'events.log')).isSymbolicLink()).toBe(true);
    const service = createProductIntentToolService(directory);
    expect(service).toBeDefined();
    expect(() => new ProductIntentEventLogPublisher(directory)).not.toThrow();
    const runtime = createProductIntentToolRuntime(() => service);

    const response = await runtime.execute('fw_initialize_product_intent', {
      intent: intentInput(),
    });

    expect(response.structuredContent).toMatchObject({
      initialized: true,
      eventDelivery: {
        status: 'failed',
        code: 'PRODUCT_INTENT_EVENT_DELIVERY_FAILED',
      },
    });
    expect(fs.readFileSync(outsideTarget, 'utf8')).toBe('sentinel\n');
    expect(fs.existsSync(path.join(stateDirectory, 'product-intent.json'))).toBe(true);
  });

  it('keeps a committed mutation successful when the event target is unwritable', async () => {
    const directory = workspace();
    const stateDirectory = path.join(directory, '.forgewright');
    const eventFile = path.join(stateDirectory, 'events.log');
    fs.mkdirSync(stateDirectory);
    fs.writeFileSync(eventFile, 'sentinel\n', { mode: 0o400 });
    const runtime = createProductIntentToolRuntime(() => createProductIntentToolService(directory));

    const response = await runtime.execute('fw_initialize_product_intent', {
      intent: intentInput(),
    });

    expect(response.structuredContent).toMatchObject({
      initialized: true,
      eventDelivery: {
        status: 'failed',
        code: 'PRODUCT_INTENT_EVENT_DELIVERY_FAILED',
      },
    });
    expect(fs.readFileSync(eventFile, 'utf8')).toBe('sentinel\n');
    expect(fs.existsSync(path.join(stateDirectory, 'product-intent.json'))).toBe(true);
  });
});
