import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IEventPublisher } from '../core/ports/IEventPublisher.js';
import { createHash } from 'node:crypto';
import type { RuntimeTrustContext } from '../runtime/execution-containment.js';
import { McpEventPublisher } from '../infrastructure/adapters/McpEventPublisher.js';
import { FileLogEventPublisher } from '../infrastructure/adapters/FileLogEventPublisher.js';
import {
  HttpWebhookEventPublisher,
  type HttpWebhookEventPublisherOptions,
  type WebhookCallerIdentity,
} from '../infrastructure/adapters/HttpWebhookEventPublisher.js';
import { CombinedEventPublisher } from '../infrastructure/adapters/CombinedEventPublisher.js';

let mcpServer: Server | null = null;
let mcpPublisher: McpEventPublisher | null = null;
let callerIdentity: WebhookCallerIdentity | undefined;
type WebhookPublisherFactory = (
  workspacePath: string,
  sessionId: string | undefined,
  options: HttpWebhookEventPublisherOptions,
) => IEventPublisher;
const defaultWebhookPublisherFactory: WebhookPublisherFactory = (
  workspacePath,
  sessionId,
  options,
) => new HttpWebhookEventPublisher(workspacePath, sessionId, options);
let webhookPublisherFactory = defaultWebhookPublisherFactory;

export function setMcpServer(server: Server): void {
  mcpServer = server;
  if (mcpPublisher) {
    mcpPublisher.setServer(server);
  }
}

const SAFE_CALLER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export function setRuntimeTrustContext(
  trust: RuntimeTrustContext,
  workspaceId: string,
  sessionId: string,
): void {
  if (trust.mode !== 'production') {
    callerIdentity = undefined;
    return;
  }
  const expectedWorkspaceId = createHash('sha256').update(trust.workspace, 'utf8').digest('hex');
  const expectedProfileDigest = createHash('sha256')
    .update(`${trust.mode}:${trust.profile}`, 'utf8')
    .digest('hex');
  if (
    !trust.callerId ||
    !SAFE_CALLER_ID.test(trust.callerId) ||
    trust.profile !== 'application' ||
    trust.profileDigest !== expectedProfileDigest ||
    !DIGEST.test(trust.policyDigest) ||
    workspaceId !== expectedWorkspaceId ||
    sessionId.length < 1
  ) {
    throw new Error('RUNTIME_TRUST_CONTEXT_INVALID');
  }
  callerIdentity = {
    kind: 'canonical-mcp-runtime',
    mode: 'production',
    callerId: trust.callerId,
    workspaceId,
    sessionId,
    profile: 'application',
    profileDigest: trust.profileDigest,
    policyDigest: trust.policyDigest,
  };
}

export function _setWebhookPublisherFactoryForTests(factory: WebhookPublisherFactory): void {
  webhookPublisherFactory = factory;
}

export function createHttpWebhookPublisher(
  workspacePath: string,
  sessionId?: string,
): IEventPublisher {
  return webhookPublisherFactory(workspacePath, sessionId ?? callerIdentity?.sessionId, {
    callerIdentity,
  });
}

export const _createHttpWebhookPublisherForTests = createHttpWebhookPublisher;

export function _resetRpcClientForTests(): void {
  mcpServer = null;
  mcpPublisher = null;
  callerIdentity = undefined;
  webhookPublisherFactory = defaultWebhookPublisherFactory;
}

function getSessionId(): string | undefined {
  return process.env.FORGEWRIGHT_SESSION_ID;
}

export function initRpcClient(): void {
  // Deprecated
}

export function emitRpcEvent(eventName: string, payload: unknown): void {
  const sessionId = getSessionId();
  const workspacePath = process.cwd();

  if (!mcpPublisher) {
    mcpPublisher = new McpEventPublisher(workspacePath, sessionId);
    if (mcpServer) mcpPublisher.setServer(mcpServer);
  }

  const filePublisher = new FileLogEventPublisher(workspacePath);
  const httpPublisher = createHttpWebhookPublisher(workspacePath, sessionId);

  const combined = new CombinedEventPublisher([mcpPublisher, filePublisher, httpPublisher]);

  combined.publish(eventName, payload);
}
