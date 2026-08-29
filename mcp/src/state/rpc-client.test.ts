import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type {
  HttpWebhookEventPublisherOptions,
  WebhookCallerIdentity,
} from '../infrastructure/adapters/HttpWebhookEventPublisher.js';
import {
  _resetRpcClientForTests,
  _setWebhookPublisherFactoryForTests,
  _createHttpWebhookPublisherForTests,
  setRuntimeTrustContext,
  setMcpServer,
} from './rpc-client.js';

describe('rpc-client webhook identity', () => {
  it('does not manufacture caller authority from setMcpServer', () => {
    let observed: WebhookCallerIdentity | undefined;
    _resetRpcClientForTests();
    _setWebhookPublisherFactoryForTests(
      (
        _workspace: string,
        _session: string | undefined,
        options: HttpWebhookEventPublisherOptions,
      ) => {
        observed = options.callerIdentity;
        return { publish: vi.fn() };
      },
    );

    setMcpServer({} as Server);
    _createHttpWebhookPublisherForTests('/workspace', 'session-a');

    expect(observed).toBeUndefined();
    _resetRpcClientForTests();
  });

  it('passes only an explicitly validated production trust context', () => {
    let observed: WebhookCallerIdentity | undefined;
    _resetRpcClientForTests();
    _setWebhookPublisherFactoryForTests(
      (
        _workspace: string,
        _session: string | undefined,
        options: HttpWebhookEventPublisherOptions,
      ) => {
        observed = options.callerIdentity;
        return { publish: vi.fn() };
      },
    );
    const trust = {
      mode: 'production' as const,
      workspace: '/workspace',
      callerId: 'caller-a',
      profile: 'application',
      profileDigest: createHash('sha256').update('production:application').digest('hex'),
      policyDigest: 'd'.repeat(64),
    };
    const workspaceId = createHash('sha256').update('/workspace').digest('hex');

    setMcpServer({} as Server);
    setRuntimeTrustContext(trust, workspaceId, 'session-a');
    _createHttpWebhookPublisherForTests('/workspace', 'session-a');

    expect(observed).toMatchObject({
      kind: 'canonical-mcp-runtime',
      mode: 'production',
      callerId: 'caller-a',
      workspaceId,
      sessionId: 'session-a',
      profile: 'application',
      profileDigest: trust.profileDigest,
      policyDigest: 'd'.repeat(64),
    });
    _resetRpcClientForTests();
  });
});
