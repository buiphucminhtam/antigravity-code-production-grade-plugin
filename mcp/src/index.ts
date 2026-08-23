#!/usr/bin/env node
/**
 * Forgewright Global MCP Server
 *
 * Works across ALL projects. The server:
 * - Loads skills from the Forgewright skills/ directory
 * - Stores per-project state in {workspace}/.forgewright/
 * - Detects the current workspace dynamically
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHash } from 'node:crypto';
import { registerPrompts } from './api/prompts.js';
import { registerTools } from './api/tools.js';
import { LifecycleLeaseStore, type LifecycleLease } from './runtime/lifecycle-lease.js';
import { setWorkspaceRoot } from './state/pipeline-manager.js';
import { setMcpServer } from './state/rpc-client.js';

const server = new Server(
  {
    name: 'forgewright-mcp-global',
    version: '1.0.0',
  },
  {
    capabilities: {
      prompts: {},
      tools: {},
    },
  },
);

// Detect and set workspace root BEFORE registering handlers
setWorkspaceRoot();
setMcpServer(server);

registerPrompts(server);
registerTools(server);

const leaseStore = new LifecycleLeaseStore();
let activeLease: LifecycleLease | null = null;
let shutdownPromise: Promise<void> | null = null;

function workspaceId(): string {
  return createHash('sha256').update(process.cwd()).digest('hex');
}

function sessionId(): string {
  return (
    process.env.FORGEWRIGHT_SESSION_ID ??
    process.env.CODEX_THREAD_ID ??
    `mcp-process-${process.pid}`
  );
}

async function shutdown(reason: string): Promise<void> {
  if (shutdownPromise !== null) return shutdownPromise;
  shutdownPromise = (async () => {
    const lease = activeLease;
    activeLease = null;
    if (lease !== null) {
      const result = await leaseStore.release(lease.leaseId, lease.ownerToken, lease.version);
      if (result !== 'released' && result !== 'closed') {
        console.error(`[Forgewright Global MCP] Lease close refused: ${result} (${reason})`);
      }
    }
    await server.close().catch(() => undefined);
  })();
  return shutdownPromise;
}

function installShutdownHandlers(): void {
  process.stdin.once('end', () => void shutdown('stdin-eof'));
  process.stdin.once('close', () => void shutdown('stdin-close'));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).finally(() => process.exit(0));
    });
  }
}

async function run() {
  const reconciled = await leaseStore.reconcile();
  for (const result of reconciled) {
    if (result.result === 'identity_mismatch' || result.result === 'reconcile_error') {
      console.error(
        `[Forgewright Global MCP] Lease reconciliation refused: ${result.result} (${result.leaseId})`,
      );
    }
  }
  const identity = await leaseStore.inspectCurrent();
  const ttlMs = Number.parseInt(process.env.FORGEWRIGHT_MCP_LEASE_TTL_MS ?? '86400000', 10);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('FORGEWRIGHT_MCP_LEASE_TTL_MS must be a positive integer');
  }
  activeLease = await leaseStore.acquire({
    workspaceId: workspaceId(),
    sessionId: sessionId(),
    identity,
    ttlMs,
  });
  installShutdownHandlers();
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    console.error(
      `[Forgewright Global MCP] Running — workspace: ${process.cwd()} lease: ${activeLease.leaseId}`,
    );
  } catch (error) {
    await shutdown('connect-failed');
    throw error;
  }
}

run().catch((error) => {
  console.error('[Forgewright Global MCP] Fatal error:', error);
  void shutdown('fatal').finally(() => process.exit(1));
});
