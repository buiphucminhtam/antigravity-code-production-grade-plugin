/**
 * Session Deduplication Middleware — Middleware ④b
 *
 * Prevents repeated identical tool calls from bloating LLM context.
 * When the same toolName + args is invoked within a deduplication window,
 * returns a cached result instead of re-executing. Saves ~90% of tokens on
 * repeated commands like git status, ls, Grep, Glob, etc.
 *
 * Position: After Guardrail (④), before tool execution.
 * Hook: before_tool()
 */

import { createHash } from 'node:crypto';
import type { ToolContext, MiddlewareResult, ToolResult, MiddlewareConfig } from './types.js';

/** Tools that should NEVER be deduplicated — they have side effects. */
const SIDE_EFFECT_TOOLS = new Set([
  'Write',
  'Edit',
  'Delete',
  'Bash', // Bash deduplication is handled by shell-filter
  'Task', // Creates new agents
  'NotebookEdit',
  'CallMcpTool', // May have side effects
  'fw_load_skill_overlay', // Per-session one-time admission is stateful
]);

interface DedupEntry {
  key: string;
  toolName: string;
  argsHash: string;
  result: ToolResult;
  firstSeen: number;
  lastSeen: number;
  firstSeenTurn: number;
  lastSeenTurn: number;
  seenCount: number;
  resultTokens: number;
}

interface PendingDedupEntry {
  key: string;
  sessionId: string;
  epoch: number;
}

interface DedupMetrics {
  totalCalls: number;
  cacheHits: number;
  cacheMisses: number;
  totalTokensSaved: number;
  byTool: Record<string, { hits: number; tokensSaved: number }>;
}

const DEFAULT_CONFIG = {
  windowTurns: 10,
  windowMs: 300_000, // 5 minutes
  maxStoreSize: 500,
  excludeTools: [] as string[],
  includeTools: [] as string[],
  cacheReads: true,
};

/**
 * Normalize arguments for deterministic hashing.
 * - Sorts keys alphabetically
 * - Removes undefined/null values
 * - Recursively normalizes nested objects
 * - Uses stable JSON stringification
 */
function normalizeArgs(args: Record<string, unknown>): string {
  function sortAndClean(obj: unknown): unknown {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortAndClean);
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      const val = (obj as Record<string, unknown>)[key];
      if (val !== undefined && val !== null) {
        sorted[key] = sortAndClean(val);
      }
    }
    return sorted;
  }

  const cleaned = sortAndClean(args);
  return JSON.stringify(cleaned, null, 0);
}

/** SHA-256 hash of a string, truncated to 16 hex chars for brevity. */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Estimate token count from a tool result. Rough heuristic: ~4 chars per token. */
function estimateTokens(result: ToolResult): number {
  let total = 0;
  for (const block of result.content) {
    if (block.type === 'text') {
      total += Math.ceil(block.text.length / 4);
    }
  }
  return total;
}

export class SessionDeduplicationMiddleware {
  name = 'session-deduplication';
  enabled = true;

  private store = new Map<string, DedupEntry>();
  // A pending miss belongs to one call, session, and epoch. A late read must
  // never be cached into an epoch that a concurrent mutation has advanced.
  private pendingKeys = new Map<string, PendingDedupEntry>();
  private epochs = new Map<string, number>();
  private metrics: DedupMetrics = {
    totalCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalTokensSaved: 0,
    byTool: {},
  };

  private config = { ...DEFAULT_CONFIG };

  configure(config: MiddlewareConfig['session_deduplication']): void {
    if (!config) return;
    this.enabled = config.enabled ?? this.enabled;
    const c = config as Record<string, unknown>;
    this.config = {
      windowTurns: Number(c['window_turns'] ?? c['windowTurns'] ?? DEFAULT_CONFIG.windowTurns),
      windowMs: Number(c['window_ms'] ?? c['windowMs'] ?? DEFAULT_CONFIG.windowMs),
      maxStoreSize: Number(c['max_store_size'] ?? c['maxStoreSize'] ?? DEFAULT_CONFIG.maxStoreSize),
      excludeTools: (Array.isArray(c['exclude_tools'])
        ? c['exclude_tools']
        : Array.isArray(c['excludeTools'])
          ? c['excludeTools']
          : DEFAULT_CONFIG.excludeTools) as string[],
      includeTools: (Array.isArray(c['include_tools'])
        ? c['include_tools']
        : Array.isArray(c['includeTools'])
          ? c['includeTools']
          : DEFAULT_CONFIG.includeTools) as string[],
      cacheReads: Boolean(c['cache_reads'] ?? c['cacheReads'] ?? DEFAULT_CONFIG.cacheReads),
    };
  }

  /** Check if a tool should be deduplicated. */
  private shouldDeduplicate(toolName: string): boolean {
    // Always exclude side-effect tools
    if (SIDE_EFFECT_TOOLS.has(toolName)) return false;

    // Exclude list
    if (this.config.excludeTools.includes(toolName)) return false;

    // Include list — if non-empty, only include listed tools
    if (this.config.includeTools.length > 0) {
      return this.config.includeTools.includes(toolName);
    }

    // Default: deduplicate read-heavy, stateless tools
    return true;
  }

  /** Compute the deduplication key for a tool call. */
  private getEpoch(sessionId: string): number {
    return this.epochs.get(sessionId) ?? 0;
  }

  private computeKey(sessionId: string, toolName: string, args: Record<string, unknown>): string {
    const normalized = normalizeArgs(args);
    return `${sessionId}::${this.getEpoch(sessionId)}::${toolName}::${shortHash(normalized)}`;
  }

  /** In explicit-allowlist mode, every non-allowlisted tool is conservatively mutating. */
  private isSuccessfulMutation(ctx: ToolContext): boolean {
    if (ctx.call.result?.isError) return false;
    if (this.config.includeTools.length > 0) {
      return !this.config.includeTools.includes(ctx.call.toolName);
    }
    return SIDE_EFFECT_TOOLS.has(ctx.call.toolName);
  }

  private bumpEpoch(sessionId: string): void {
    const nextEpoch = this.getEpoch(sessionId) + 1;
    this.epochs.set(sessionId, nextEpoch);
    for (const [callId, pending] of this.pendingKeys) {
      if (pending.sessionId === sessionId && pending.epoch < nextEpoch) {
        this.pendingKeys.delete(callId);
      }
    }
  }

  /** Evict expired entries from the dedup store. */
  private evictExpired(turnNumber: number): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      const turnExpired = turnNumber - entry.lastSeenTurn > this.config.windowTurns;
      const timeExpired = now - entry.lastSeen > this.config.windowMs;
      if (turnExpired || timeExpired) {
        this.store.delete(key);
      }
    }
  }

  /** Evict oldest entries if store exceeds max size. */
  private evictOldest(): void {
    if (this.store.size < this.config.maxStoreSize) return;
    const target = Math.floor(this.config.maxStoreSize * 0.7);
    const entries = Array.from(this.store.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (let i = 0; i < entries.length && this.store.size > target; i++) {
      this.store.delete(entries[i][0]);
    }
  }

  /** Main deduplication check — runs before every tool call. */
  before_tool(ctx: ToolContext): MiddlewareResult {
    this.metrics.totalCalls++;
    if (!this.enabled) return { action: 'pass', context: ctx };

    // Initialize per-tool metrics
    if (!this.metrics.byTool[ctx.call.toolName]) {
      this.metrics.byTool[ctx.call.toolName] = { hits: 0, tokensSaved: 0 };
    }

    // Should this tool be deduplicated?
    if (!this.shouldDeduplicate(ctx.call.toolName)) {
      return { action: 'pass', context: ctx };
    }

    // Evict expired entries
    this.evictExpired(ctx.turnNumber);

    // Compute key
    const key = this.computeKey(ctx.sessionId, ctx.call.toolName, ctx.call.toolArgs);
    const existing = this.store.get(key);

    if (existing) {
      // Update existing entry
      existing.lastSeen = Date.now();
      existing.lastSeenTurn = ctx.turnNumber;
      existing.seenCount++;
      existing.resultTokens = estimateTokens(existing.result);

      const tokensSaved = existing.resultTokens;
      const turnsAgo = ctx.turnNumber - existing.firstSeenTurn;
      const summary = `🔄 [${existing.seenCount}× duplicate — first seen ${turnsAgo} turn${turnsAgo === 1 ? '' : 's'} ago, saved ~${tokensSaved} tokens]`;

      this.metrics.cacheHits++;
      this.metrics.totalTokensSaved += tokensSaved;
      this.metrics.byTool[ctx.call.toolName].hits++;
      this.metrics.byTool[ctx.call.toolName].tokensSaved += tokensSaved;

      return {
        action: 'cached',
        context: ctx,
        cachedResult: existing.result,
        dedup: {
          seenCount: existing.seenCount,
          firstSeenTurn: existing.firstSeenTurn,
          tokensSaved,
          summary,
        },
      };
    }

    // MISS — tool IS deduplicable and not in store
    // Mark as pending so after_tool knows to cache the result
    this.pendingKeys.set(ctx.call.id, {
      key,
      sessionId: ctx.sessionId,
      epoch: this.getEpoch(ctx.sessionId),
    });
    return { action: 'pass', context: ctx };
  }

  /** Store the result after tool execution (only for pending misses). */
  after_tool(ctx: ToolContext): void {
    if (!this.enabled) return;
    if (!ctx.call.result) return;

    const result = ctx.call.result;
    const pending = this.pendingKeys.get(ctx.call.id);

    if (this.isSuccessfulMutation(ctx)) {
      this.bumpEpoch(ctx.sessionId);
      return;
    }

    // Only store if this key was a pending miss from before_tool
    if (!pending) return;
    this.pendingKeys.delete(ctx.call.id);

    // A mutation completed while this read was pending; discard the old result.
    if (pending.sessionId !== ctx.sessionId || pending.epoch !== this.getEpoch(ctx.sessionId))
      return;

    // Skip large results
    const tokens = estimateTokens(result);
    if (tokens > 25_000) return;

    this.store.set(pending.key, {
      key: pending.key,
      toolName: ctx.call.toolName,
      argsHash: shortHash(normalizeArgs(ctx.call.toolArgs)),
      result,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      firstSeenTurn: ctx.turnNumber,
      lastSeenTurn: ctx.turnNumber,
      seenCount: 1,
      resultTokens: tokens,
    });
    this.evictOldest();
    this.metrics.cacheMisses++;
  }

  /** Clear all cached entries and pending keys. */
  reset(): void {
    this.store.clear();
    this.pendingKeys.clear();
    this.epochs.clear();
  }

  /** Clear metrics only. */
  resetMetrics(): void {
    this.metrics = {
      totalCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalTokensSaved: 0,
      byTool: {},
    };
  }

  /** Get current metrics for reporting. */
  getMetrics(): Readonly<DedupMetrics> {
    return { ...this.metrics };
  }

  /** Get hit rate as a percentage. */
  getHitRate(): number {
    if (this.metrics.totalCalls === 0) return 0;
    return Math.round((this.metrics.cacheHits / this.metrics.totalCalls) * 100 * 100) / 100;
  }

  /** Get store size for monitoring. */
  getStoreSize(): number {
    return this.store.size;
  }
}
