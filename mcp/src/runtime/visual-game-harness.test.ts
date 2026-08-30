import { describe, expect, it, vi } from 'vitest';

import { HARNESS_ADAPTER_SCHEMA, type HarnessAdapter } from './harness-adapter.js';
import {
  VisualGameHarness,
  VisualGameHarnessError,
  type VisualCapabilityReport,
  type VisualGameHarnessPort,
  type VisualGameRequest,
} from './visual-game-harness.js';

function adapter(): HarnessAdapter {
  return {
    schema: HARNESS_ADAPTER_SCHEMA,
    mode: 'native-host-loop',
    capabilities: {
      operations: {
        start: true,
        resume: false,
        fork: false,
        steer: true,
        interrupt: true,
        checkpoint: false,
      },
      precompact: 'native',
    },
    start: vi.fn(async () => ({ sessionId: 'visual-session-1' })),
    steer: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
  };
}

const capabilities: VisualCapabilityReport = {
  status: 'available',
  source: 'active-provider-schema-same-invocation',
  models: [
    {
      id: 'provider-vision-model',
      tiers: ['builder', 'expert'],
      features: ['image_in', 'video_in', 'tool_use'],
      reasoningEfforts: ['medium', 'high'],
    },
  ],
};

function request(overrides: Partial<VisualGameRequest> = {}): VisualGameRequest {
  return {
    planDigest: 'a'.repeat(64),
    objective: 'Implement and visually verify the bounded gameplay interaction.',
    acceptanceCriteria: ['Rendered interaction matches the supplied reference.'],
    taskClass: 'standard',
    role: 'builder',
    modelId: 'provider-vision-model',
    reasoningEffort: 'medium',
    workerCount: 2,
    media: [{ path: 'captures/reference.mp4', kind: 'video', byteSize: 2_000_000 }],
    swarmEnabled: false,
    ...overrides,
  };
}

function port(
  outcomes: Array<{ accepted: boolean; evidenceDigest: string; summary: string }>,
  report: VisualCapabilityReport = capabilities,
): VisualGameHarnessPort {
  let index = 0;
  return {
    adapter: adapter(),
    probeCapabilities: vi.fn(async () => report),
    inspectIteration: vi.fn(async () => outcomes[Math.min(index++, outcomes.length - 1)]),
  };
}

describe('VisualGameHarness', () => {
  it('builds a provider-neutral locked visual feedback plan', async () => {
    const runtime = port([{ accepted: true, evidenceDigest: 'b'.repeat(64), summary: 'accepted' }]);
    const harness = new VisualGameHarness(runtime);

    const plan = await harness.plan(request());

    expect(plan).toEqual({
      planDigest: 'a'.repeat(64),
      objective: 'Implement and visually verify the bounded gameplay interaction.',
      acceptanceCriteria: ['Rendered interaction matches the supplied reference.'],
      taskClass: 'standard',
      role: 'builder',
      modelSelection: {
        status: 'verified',
        modelId: 'provider-vision-model',
        capabilitySource: 'active-provider-schema-same-invocation',
        reasoningEffort: 'medium',
      },
      media: [{ path: 'captures/reference.mp4', kind: 'video', byteSize: 2_000_000 }],
      phases: ['inspect', 'plan', 'implement', 'render', 'compare', 'revise', 'audit'],
      loop: {
        maxIterations: 2,
        timeoutMs: 90_000,
        maxWorkers: 2,
        swarmEnabled: false,
      },
    });
  });

  it('runs render-inspect-revise and stores evidence-only receipts', async () => {
    const runtime = port([
      { accepted: false, evidenceDigest: 'b'.repeat(64), summary: 'alignment differs' },
      { accepted: true, evidenceDigest: 'c'.repeat(64), summary: 'acceptance matched' },
    ]);
    const harness = new VisualGameHarness(runtime);

    const receipt = await harness.run(request());

    expect(receipt).toEqual({
      planDigest: 'a'.repeat(64),
      modelId: 'provider-vision-model',
      taskClass: 'standard',
      status: 'accepted',
      iterationCount: 2,
      evidenceDigests: ['b'.repeat(64), 'c'.repeat(64)],
      workerCount: 2,
      swarmEnabled: false,
    });
    expect(runtime.adapter.steer).toHaveBeenCalledTimes(1);
    expect(runtime.adapter.steer).toHaveBeenCalledWith({
      planDigest: 'a'.repeat(64),
      iteration: 2,
      evidenceDigest: 'b'.repeat(64),
      summary: 'alignment differs',
    });
    expect(JSON.stringify(receipt)).not.toContain('alignment differs');
  });

  it('interrupts when the bounded visual loop is exhausted', async () => {
    const runtime = port([
      { accepted: false, evidenceDigest: 'b'.repeat(64), summary: 'first mismatch' },
      { accepted: false, evidenceDigest: 'c'.repeat(64), summary: 'second mismatch' },
    ]);
    const harness = new VisualGameHarness(runtime);

    const receipt = await harness.run(request());

    expect(receipt.status).toBe('iteration_cap_exhausted');
    expect(runtime.adapter.interrupt).toHaveBeenCalledTimes(1);
  });

  it('returns exhaustion even when cleanup crosses the main deadline', async () => {
    const slowAdapter = adapter();
    slowAdapter.interrupt = vi.fn(
      async () => await new Promise<void>((resolve) => setTimeout(resolve, 10)),
    );
    const runtime = port([
      { accepted: false, evidenceDigest: 'b'.repeat(64), summary: 'first mismatch' },
      { accepted: false, evidenceDigest: 'c'.repeat(64), summary: 'second mismatch' },
    ]);
    runtime.adapter = slowAdapter;
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(90_001);

    const receipt = await new VisualGameHarness(runtime).run(request());

    expect(receipt.status).toBe('iteration_cap_exhausted');
    expect(slowAdapter.interrupt).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('fails closed on missing media capability or exact reasoning effort', async () => {
    const noVideo = port([], {
      ...capabilities,
      models: [
        {
          id: 'provider-vision-model',
          tiers: ['builder'],
          features: ['image_in', 'tool_use'],
          reasoningEfforts: ['medium'],
        },
      ],
    });
    await expect(new VisualGameHarness(noVideo).plan(request())).rejects.toMatchObject({
      code: 'required_capability_unavailable:video_in',
    });

    const noMedium = port([], {
      ...capabilities,
      models: [
        {
          id: 'provider-vision-model',
          tiers: ['builder'],
          features: ['image_in', 'video_in', 'tool_use'],
          reasoningEfforts: ['high'],
        },
      ],
    });
    await expect(new VisualGameHarness(noMedium).plan(request())).rejects.toMatchObject({
      code: 'required_reasoning_effort_unavailable:medium',
    });
  });

  it('normalizes malformed provider capability entries to a typed error', async () => {
    const malformed = port([], {
      ...capabilities,
      models: [
        {
          id: 'provider-vision-model',
          tiers: null as unknown as ['builder'],
          features: ['image_in', 'video_in', 'tool_use'],
          reasoningEfforts: ['medium'],
        },
      ],
    });

    await expect(new VisualGameHarness(malformed).plan(request())).rejects.toMatchObject({
      code: 'malformed_model_capability',
    });
  });

  it('rejects swarm, more than three workers, unsafe media, and unbound plans', async () => {
    const harness = new VisualGameHarness(port([]));

    await expect(harness.plan(request({ swarmEnabled: true }))).rejects.toBeInstanceOf(
      VisualGameHarnessError,
    );
    await expect(harness.plan(request({ workerCount: 4 }))).rejects.toMatchObject({
      code: 'worker_cap_exceeded',
    });
    await expect(
      harness.plan(request({ media: [{ path: '../escape.png', kind: 'image', byteSize: 100 }] })),
    ).rejects.toMatchObject({ code: 'unsafe_media_path' });
    await expect(harness.plan(request({ planDigest: 'not-locked' }))).rejects.toMatchObject({
      code: 'invalid_plan_digest',
    });
  });
});
