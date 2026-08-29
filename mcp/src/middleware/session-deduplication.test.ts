/**
 * Tests for Session Deduplication Middleware
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionDeduplicationMiddleware } from './session-deduplication.js';
import type { ToolContext, ToolCall } from './types.js';

function makeCtx(
  toolName: string,
  toolArgs: Record<string, unknown> = {},
  result?: { content: Array<{ type: 'text'; text: string }>; isError?: boolean },
): ToolContext {
  const call: ToolCall = {
    id: `call-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    toolName,
    toolArgs,
    startTime: Date.now(),
  };
  if (result) call.result = result;
  return {
    call,
    skillId: 'software-engineer',
    mode: 'feature',
    phase: 'build',
    turnNumber: 1,
    sessionId: 'test-session',
    userMessage: 'test',
  };
}

describe('SessionDeduplicationMiddleware', () => {
  let mw: SessionDeduplicationMiddleware;

  beforeEach(() => {
    mw = new SessionDeduplicationMiddleware();
    mw.configure({ enabled: true });
  });

  describe('shouldDeduplicate', () => {
    it('does not cache when explicitly disabled', () => {
      mw.configure({ enabled: false });
      const first = makeCtx('Grep', { pattern: 'stateful' });
      first.call.result = { content: [{ type: 'text', text: 'first' }] };
      expect(mw.before_tool(first).action).toBe('pass');
      mw.after_tool(first);
      expect(mw.before_tool(makeCtx('Grep', { pattern: 'stateful' })).action).toBe('pass');
    });

    it('does not deduplicate the stateful overlay loader', () => {
      const first = makeCtx('fw_load_skill_overlay', { name: 'software-engineer' });
      first.call.result = { content: [{ type: 'text', text: 'overlay' }] };
      mw.before_tool(first);
      mw.after_tool(first);
      expect(
        mw.before_tool(makeCtx('fw_load_skill_overlay', { name: 'software-engineer' })).action,
      ).toBe('pass');
    });
    it('should NOT deduplicate Write (side effect)', () => {
      const ctx = makeCtx('Write', { path: '/tmp/test.txt' });
      const result = mw.before_tool(ctx);
      expect(result.action).toBe('pass');
    });

    it('should NOT deduplicate Delete (side effect)', () => {
      const ctx = makeCtx('Delete', { path: '/tmp/test.txt' });
      const result = mw.before_tool(ctx);
      expect(result.action).toBe('pass');
    });

    it('should deduplicate Grep', () => {
      const ctx = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      const result = mw.before_tool(ctx);
      expect(result.action).toBe('pass'); // First call = miss
    });

    it('should deduplicate Glob', () => {
      const ctx = makeCtx('Glob', { glob: '**/*.ts' });
      const result = mw.before_tool(ctx);
      expect(result.action).toBe('pass'); // First call = miss
    });

    it('should deduplicate SemanticSearch', () => {
      const ctx = makeCtx('SemanticSearch', { query: 'auth middleware' });
      const result = mw.before_tool(ctx);
      expect(result.action).toBe('pass'); // First call = miss
    });

    it('should deduplicate Read', () => {
      const ctx = makeCtx('Read', { path: '/src/index.ts' });
      const result = mw.before_tool(ctx);
      expect(result.action).toBe('pass'); // First call = miss
    });

    it('should deduplicate FetchMcpResource', () => {
      const ctx = makeCtx('FetchMcpResource', {
        server: 'forgewright',
        uri: 'forgewright://repos',
      });
      const result = mw.before_tool(ctx);
      expect(result.action).toBe('pass'); // First call = miss
    });
  });

  describe('key generation', () => {
    it('should produce same key for identical tool+args (different order)', () => {
      // Key normalization sorts args alphabetically, so different order = same key
      const ctx1 = makeCtx('Grep', {
        path: '/src',
        pattern: 'TODO',
        output_mode: 'content',
      });
      const ctx2 = makeCtx('Grep', {
        pattern: 'TODO',
        path: '/src',
        output_mode: 'content',
      });

      // Call 1: miss
      const r1 = mw.before_tool(ctx1);
      expect(r1.action).toBe('pass');
      ctx1.call.result = {
        content: [{ type: 'text' as const, text: 'TODO: x' }],
      };
      mw.after_tool(ctx1);

      // Call 2: hit (same normalized key)
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('cached');
      if (r2.action === 'cached') {
        expect(r2.dedup.seenCount).toBe(2);
      }
    });

    it('should produce different keys for different args', () => {
      const ctx1 = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      const ctx2 = makeCtx('Grep', { path: '/src', pattern: 'FIXME' });

      // Call 1: miss
      const r1 = mw.before_tool(ctx1);
      expect(r1.action).toBe('pass');
      ctx1.call.result = { content: [{ type: 'text' as const, text: 'TODO' }] };
      mw.after_tool(ctx1);

      // Call 2: miss (different pattern = different key)
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('pass');
    });

    it('should produce different keys for different tools', () => {
      const ctx1 = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      const ctx2 = makeCtx('Glob', { glob: '**/*.ts' });

      // Call 1: miss
      const r1 = mw.before_tool(ctx1);
      expect(r1.action).toBe('pass');
      ctx1.call.result = { content: [{ type: 'text' as const, text: 'TODO' }] };
      mw.after_tool(ctx1);

      // Call 2: miss (different tool = different key)
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('pass');
    });

    it('should ignore null/undefined in args', () => {
      const ctx1 = makeCtx('Read', { path: '/src/index.ts', limit: undefined });
      const ctx2 = makeCtx('Read', { path: '/src/index.ts' });

      // Call 1: miss
      const r1 = mw.before_tool(ctx1);
      expect(r1.action).toBe('pass');
      ctx1.call.result = {
        content: [{ type: 'text' as const, text: 'file content' }],
      };
      mw.after_tool(ctx1);

      // Call 2: hit (undefined was normalized away)
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('cached');
    });
  });

  describe('dedup caching', () => {
    it('does not cache a read that was pending when a successful mutation advanced its session epoch', () => {
      mw.configure({ include_tools: ['Read'] });
      const pendingRead = makeCtx('Read', { path: '/state.json' });
      pendingRead.sessionId = 'session-a';
      expect(mw.before_tool(pendingRead).action).toBe('pass');

      const mutation = makeCtx('fw_advance_to_next_phase');
      mutation.sessionId = 'session-a';
      mutation.call.result = { content: [{ type: 'text', text: 'advanced' }] };
      expect(mw.before_tool(mutation).action).toBe('pass');
      mw.after_tool(mutation);

      pendingRead.call.result = { content: [{ type: 'text', text: 'stale state' }] };
      mw.after_tool(pendingRead);

      const nextRead = makeCtx('Read', { path: '/state.json' });
      nextRead.sessionId = 'session-a';
      expect(mw.before_tool(nextRead).action).toBe('pass');
      expect(mw.getStoreSize()).toBe(0);
    });

    it('should return cached result on duplicate call', () => {
      const baseArgs = {
        path: '/src',
        pattern: 'TODO',
        output_mode: 'content',
      };
      const cachedResult = {
        content: [{ type: 'text' as const, text: 'TODO: fix this\nTODO: do that' }],
      };

      // Store first result
      const ctx1 = makeCtx('Grep', baseArgs);
      ctx1.call.result = cachedResult;
      const r1 = mw.before_tool(ctx1);
      expect(r1.action).toBe('pass');
      mw.after_tool(ctx1);

      // Second call with same args = cache hit
      const ctx2 = makeCtx('Grep', baseArgs);
      const r2 = mw.before_tool(ctx2);

      expect(r2.action).toBe('cached');
      if (r2.action === 'cached') {
        expect(r2.cachedResult.content[0].text).toBe('TODO: fix this\nTODO: do that');
        expect(r2.dedup.seenCount).toBe(2);
        expect(r2.dedup.tokensSaved).toBeGreaterThan(0);
      }
    });

    it('should count multiple duplicates', () => {
      const baseArgs = { path: '/src', pattern: 'TODO', output_mode: 'content' };
      const result = {
        content: [{ type: 'text' as const, text: 'TODO line' }],
      };

      // 5 calls total
      for (let i = 0; i < 5; i++) {
        const ctx = makeCtx('Grep', baseArgs);
        ctx.call.result = result;
        const r = mw.before_tool(ctx);
        if (r.action === 'pass') mw.after_tool(ctx);
      }

      // 6th call hits cache
      const finalCtx = makeCtx('Grep', baseArgs);
      const final = mw.before_tool(finalCtx);
      expect(final.action).toBe('cached');
      if (final.action === 'cached') {
        expect(final.dedup.seenCount).toBe(6);
      }
    });
  });

  describe('turn window', () => {
    it('should deduplicate within window_turns', () => {
      mw.configure({ window_turns: 10 });

      const baseArgs = { path: '/src', pattern: 'TODO' };
      const result = { content: [{ type: 'text' as const, text: 'result' }] };

      // Call at turn 1
      const ctx1 = makeCtx('Grep', baseArgs);
      ctx1.call.result = result;
      ctx1.turnNumber = 1;
      mw.before_tool(ctx1);
      mw.after_tool(ctx1);

      // Call at turn 5 (within window)
      const ctx2 = makeCtx('Grep', baseArgs);
      ctx2.call.result = result;
      ctx2.turnNumber = 5;
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('cached');
    });

    it('should NOT deduplicate outside window_turns', () => {
      mw.configure({ window_turns: 3 });

      const baseArgs = { path: '/src', pattern: 'TODO' };
      const result = { content: [{ type: 'text' as const, text: 'result' }] };

      // Call at turn 1
      const ctx1 = makeCtx('Grep', baseArgs);
      ctx1.call.result = result;
      ctx1.turnNumber = 1;
      mw.before_tool(ctx1);
      mw.after_tool(ctx1);

      // Call at turn 10 (outside window)
      const ctx2 = makeCtx('Grep', baseArgs);
      ctx2.call.result = result;
      ctx2.turnNumber = 10;
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('pass'); // Entry was evicted
    });
  });

  describe('metrics', () => {
    it('should track hits and misses', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'hello world' }],
      };
      const baseArgs = { path: '/src', pattern: 'TODO' };

      // 3 calls: 1 miss + 2 hits
      for (let i = 0; i < 3; i++) {
        const ctx = makeCtx('Grep', baseArgs);
        ctx.call.result = result;
        const r = mw.before_tool(ctx);
        if (r.action === 'pass') mw.after_tool(ctx);
      }

      const metrics = mw.getMetrics();
      expect(metrics.totalCalls).toBe(3);
      expect(metrics.cacheHits).toBe(2); // 2nd + 3rd calls
      expect(metrics.cacheMisses).toBe(1); // 1st call
      expect(mw.getHitRate()).toBeCloseTo(66.67, 1); // 2/3 ≈ 66.67%
    });

    it('should track per-tool metrics', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'result' }],
      };

      // First call = miss
      const ctx1 = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      ctx1.call.result = result;
      mw.before_tool(ctx1);
      mw.after_tool(ctx1);

      // Second call = hit
      const ctx2 = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      mw.before_tool(ctx2);

      const metrics = mw.getMetrics();
      expect(metrics.byTool['Grep']).toBeDefined();
      expect(metrics.byTool['Grep'].hits).toBe(1);
      expect(metrics.byTool['Grep'].tokensSaved).toBeGreaterThan(0);
    });

    it('should compute hit rate correctly', () => {
      const result = { content: [{ type: 'text' as const, text: 'test' }] };

      // 11 calls with same args:
      // Call 1: miss (stored in cache)
      // Calls 2-11: hit (all return cached result)
      for (let i = 0; i < 11; i++) {
        const ctx = makeCtx('Read', { path: '/src/file.ts' });
        ctx.call.result = result;
        const r = mw.before_tool(ctx);
        if (r.action === 'pass') mw.after_tool(ctx);
      }

      // 1 miss + 10 hits → 10/11 ≈ 90.91%
      expect(mw.getHitRate()).toBeCloseTo(90.91, 1);
    });
  });

  describe('reset', () => {
    it('should clear store on reset', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'result' }],
      };
      const ctx = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      ctx.call.result = result;
      mw.before_tool(ctx);
      mw.after_tool(ctx);

      expect(mw.getStoreSize()).toBe(1);
      mw.reset();
      expect(mw.getStoreSize()).toBe(0);
    });

    it('should clear metrics on resetMetrics', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'result' }],
      };
      const ctx = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      ctx.call.result = result;
      mw.before_tool(ctx);
      mw.after_tool(ctx);

      expect(mw.getMetrics().totalCalls).toBe(1);
      mw.resetMetrics();
      expect(mw.getMetrics().totalCalls).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty args', () => {
      const ctx = makeCtx('Read', {});
      const r = mw.before_tool(ctx);
      expect(r.action).toBe('pass');
    });

    it('should handle deeply nested args', () => {
      const args = {
        query: {
          filters: [
            { field: 'status', operator: 'eq', value: 'active' },
            { field: 'age', operator: 'gt', value: 18 },
          ],
          pagination: { page: 1, limit: 50 },
        },
      };

      // Call 1: miss
      const ctx1 = makeCtx('SemanticSearch', args);
      ctx1.call.result = {
        content: [{ type: 'text' as const, text: 'results' }],
      };
      mw.before_tool(ctx1);
      mw.after_tool(ctx1);

      // Call 2: hit
      const ctx2 = makeCtx('SemanticSearch', args);
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('cached');
    });

    it('should skip large results (> 25k tokens)', () => {
      const largeText = 'x'.repeat(200_000); // ~50k tokens
      const ctx1 = makeCtx('Read', { path: '/large-file.txt' });
      ctx1.call.result = {
        content: [{ type: 'text' as const, text: largeText }],
      };
      mw.before_tool(ctx1);
      mw.after_tool(ctx1); // Should skip

      // Store was not updated
      expect(mw.getStoreSize()).toBe(0);

      // Second call should also be miss
      const ctx2 = makeCtx('Read', { path: '/large-file.txt' });
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('pass');
    });

    it('should respect exclude_tools config', () => {
      mw.configure({ exclude_tools: ['Grep', 'Glob'] });

      // Excluded tool should never be cached
      const ctx1 = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      ctx1.call.result = {
        content: [{ type: 'text' as const, text: 'result' }],
      };
      mw.before_tool(ctx1);
      mw.after_tool(ctx1);

      expect(mw.getStoreSize()).toBe(0);

      const ctx2 = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('pass'); // Not cached
    });

    it('should respect include_tools config (only include listed tools)', () => {
      mw.configure({ include_tools: ['Read'] });

      // Read: should be deduplicated
      const ctx1 = makeCtx('Read', { path: '/src/index.ts' });
      ctx1.call.result = {
        content: [{ type: 'text' as const, text: 'file content' }],
      };
      mw.before_tool(ctx1);
      mw.after_tool(ctx1);

      const ctx2 = makeCtx('Read', { path: '/src/index.ts' });
      const r2 = mw.before_tool(ctx2);
      expect(r2.action).toBe('cached');

      // Grep: NOT in include list = never cached
      mw.reset();
      const ctx3 = makeCtx('Grep', { path: '/src', pattern: 'TODO' });
      ctx3.call.result = {
        content: [{ type: 'text' as const, text: 'result' }],
      };
      mw.before_tool(ctx3);
      mw.after_tool(ctx3);
      expect(mw.getStoreSize()).toBe(0);
    });
  });
});
