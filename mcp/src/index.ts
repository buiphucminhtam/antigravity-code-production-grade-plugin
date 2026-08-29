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
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerPrompts } from './api/prompts.js';
import { registerTools } from './api/tools.js';
import { LifecycleLeaseStore, type LifecycleLease } from './runtime/lifecycle-lease.js';
import {
  McpRuntimeLifecycle,
  RuntimeShutdownController,
  StartupFailureCleanupController,
  lifecycleShutdownTimeoutMs,
  openRuntimeAfterLease,
  type RuntimeCloseResult,
  type RuntimeShutdownReason,
} from './runtime/mcp-runtime-lifecycle.js';
import { ToolExecutionGateway } from './runtime/tool-execution-gateway.js';
import { ExecutionContainment, loadRuntimeTrustContext } from './runtime/execution-containment.js';
import { setWorkspaceRoot } from './state/pipeline-manager.js';
import { setMcpServer, setRuntimeTrustContext } from './state/rpc-client.js';

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

const leaseStore = new LifecycleLeaseStore();
let activeLease: LifecycleLease | null = null;
let runtime: McpRuntimeLifecycle | null = null;
let shutdownController: RuntimeShutdownController | null = null;
let shutdownPromise: Promise<RuntimeCloseResult> | null = null;

function workspaceId(workspace = process.cwd()): string {
  return createHash('sha256').update(workspace).digest('hex');
}

function sessionId(): string {
  return process.env.FORGEWRIGHT_SESSION_ID ?? `mcp-process-${process.pid}`;
}

const DEFERRED_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function deferredSkillAllowlist(
  raw = process.env.FORGEWRIGHT_DEFERRED_SKILLS_JSON,
): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FORGEWRIGHT_DEFERRED_SKILLS_JSON must be valid JSON');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((name) => typeof name !== 'string' || !DEFERRED_SKILL_NAME.test(name))
  ) {
    throw new Error('FORGEWRIGHT_DEFERRED_SKILLS_JSON must be an array of safe skill names');
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error('FORGEWRIGHT_DEFERRED_SKILLS_JSON must not contain duplicate skill names');
  }
  return parsed;
}

async function releaseActiveLease(): Promise<void> {
  const lease = activeLease;
  activeLease = null;
  if (lease === null) return;
  const result = await leaseStore.release(lease.leaseId, lease.ownerToken, lease.version);
  if (result !== 'released' && result !== 'closed') {
    throw new Error(`LEASE_RELEASE_REFUSED:${result}`);
  }
}

async function closeWithoutLifecycle(): Promise<RuntimeCloseResult> {
  const diagnostics: string[] = [];
  try {
    await releaseActiveLease();
  } catch {
    diagnostics.push('LEASE_RELEASE_FAILED');
  }
  try {
    await server.close();
  } catch {
    diagnostics.push('SERVER_CLOSE_FAILED');
  }
  return { outcome: 'failed', quiescence: 'not_confirmed', diagnostics };
}

function shutdown(reason: RuntimeShutdownReason): Promise<RuntimeCloseResult> {
  if (shutdownPromise !== null) return shutdownPromise;
  shutdownPromise = shutdownController?.close(reason) ?? closeWithoutLifecycle();
  return shutdownPromise;
}

function reportDiagnostics(result: RuntimeCloseResult): void {
  if (result.diagnostics.length === 0) return;
  console.error(`[Forgewright Global MCP] Shutdown diagnostics: ${result.diagnostics.join(',')}`);
}

function installShutdownHandlers(): void {
  process.stdin.once('end', () => void shutdown('stdin-eof').then(reportDiagnostics));
  process.stdin.once('close', () => void shutdown('stdin-close').then(reportDiagnostics));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(reportDiagnostics)
        .finally(() => process.exit(0));
    });
  }
}

export async function run(): Promise<void> {
  setWorkspaceRoot();
  setMcpServer(server);
  registerPrompts(server);
  const trust = loadRuntimeTrustContext();

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
  const exactWorkspaceId = workspaceId(trust.workspace);
  const exactSessionId = sessionId();
  const shutdownTimeoutMs = lifecycleShutdownTimeoutMs();
  activeLease = await leaseStore.acquire({
    workspaceId: exactWorkspaceId,
    sessionId: exactSessionId,
    identity,
    ttlMs,
  });

  const startupFailureCleanup = new StartupFailureCleanupController({
    timeoutMs: shutdownTimeoutMs,
    releaseLease: releaseActiveLease,
    closeServer: () => server.close(),
  });

  try {
    runtime = await openRuntimeAfterLease(
      () =>
        McpRuntimeLifecycle.open({
          workspaceId: exactWorkspaceId,
          sessionId: exactSessionId,
        }),
      startupFailureCleanup,
    );
  } catch (error) {
    const diagnostics = await startupFailureCleanup.close();
    if (diagnostics.length > 0) {
      console.error(`[Forgewright Global MCP] Shutdown diagnostics: ${diagnostics.join(',')}`);
    }
    throw error;
  }

  shutdownController = new RuntimeShutdownController({
    runtime,
    timeoutMs: shutdownTimeoutMs,
    releaseLease: releaseActiveLease,
    closeServer: () => server.close(),
    log: (message) => console.error(message),
  });

  setRuntimeTrustContext(trust, exactWorkspaceId, exactSessionId);
  const gateway = new ToolExecutionGateway({
    ...runtime.gatewayContext,
    containment: new ExecutionContainment(trust),
  });
  registerTools(server, gateway, {
    sessionId: exactSessionId,
    deferredSkillNames: deferredSkillAllowlist(),
  });
  installShutdownHandlers();
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    console.error(
      `[Forgewright Global MCP] Running — workspace: ${process.cwd()} lease: ${activeLease.leaseId} trajectory: ${runtime.trajectoryId}`,
    );
  } catch (error) {
    reportDiagnostics(await shutdown('connect-failed'));
    throw error;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  run().catch((error) => {
    console.error('[Forgewright Global MCP] Fatal error:', error);
    void shutdown('fatal')
      .then(reportDiagnostics)
      .finally(() => process.exit(1));
  });
}
