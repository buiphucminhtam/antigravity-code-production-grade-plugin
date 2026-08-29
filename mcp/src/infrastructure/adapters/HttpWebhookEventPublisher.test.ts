import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import {
  HttpWebhookEventPublisher,
  type WebhookFetch,
  type WebhookResolver,
} from './HttpWebhookEventPublisher.js';

function identity(workspacePath = '/workspace', sessionId = 'session') {
  return {
    kind: 'canonical-mcp-runtime' as const,
    mode: 'production' as const,
    callerId: 'trusted-caller',
    workspaceId: createHash('sha256').update(workspacePath, 'utf8').digest('hex'),
    sessionId,
    profile: 'application' as const,
    profileDigest: createHash('sha256').update('production:application').digest('hex'),
    policyDigest: 'b'.repeat(64),
  };
}

function resolver(...addresses: string[]): WebhookResolver {
  return vi.fn(async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }) as const),
  );
}

function fetcher(response: { status?: number; remoteAddress?: string; location?: string } = {}) {
  return vi.fn(async (request) => ({
    status: response.status ?? 204,
    remoteAddress: response.remoteAddress ?? request.resolvedAddress,
    location: response.location,
  })) as WebhookFetch;
}

describe('HttpWebhookEventPublisher containment', () => {
  it('does nothing when no webhook URL is configured', async () => {
    const resolve = resolver('127.0.0.1');
    const fetch = fetcher();
    const publisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      env: {},
      resolver: resolve,
      fetch,
    });

    await expect(publisher.publishAsync('PIPELINE_STATE_UPDATE', {})).resolves.toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['external HTTP', 'http://example.com:80', '93.184.216.34'],
    ['credentials', 'https://user:secret@example.com:443', '93.184.216.34'],
    ['private IPv4', 'https://example.com:443', '10.0.0.1'],
    ['link-local metadata', 'https://example.com:443', '169.254.169.254'],
    ['multicast', 'https://example.com:443', '224.0.0.1'],
    ['unspecified', 'https://example.com:443', '0.0.0.0'],
    ['private IPv6', 'https://example.com:443', 'fd00::1'],
    ['site-local IPv6', 'https://example.com:443', 'fec0::1'],
    ['NAT64 private IPv4', 'https://example.com:443', '64:ff9b::a00:1'],
    ['6to4 private IPv4', 'https://example.com:443', '2002:0a00:0001::1'],
    ['Teredo transition', 'https://example.com:443', '2001::1'],
    ['former 6bone IPv6', 'https://example.com:443', '3ffe::1'],
    ['documentation IPv6', 'https://example.com:443', '3fff::1'],
  ])('rejects %s before transport', async (_label, url, address) => {
    const fetch = fetcher();
    const publisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      url,
      allowedPorts: [80, 443],
      externalHttpsHosts: ['example.com'],
      callerIdentity: identity(),
      resolver: resolver(address),
      fetch,
    });

    await expect(publisher.publishAsync('PIPELINE_STATE_UPDATE', {})).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows an explicitly permitted loopback port without production identity', async () => {
    const fetch = fetcher();
    const publisher = new HttpWebhookEventPublisher('/workspace/private', 'session', {
      url: 'http://localhost:4318',
      allowedPorts: [4318],
      resolver: resolver('127.0.0.1'),
      fetch,
      timeoutMs: 321,
    });

    await expect(
      publisher.publishAsync('PIPELINE_STATE_UPDATE', { status: 'active' }),
    ).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedAddress: '127.0.0.1',
        timeoutMs: 321,
        url: expect.objectContaining({ pathname: '/api/v1/state' }),
      }),
    );
  });

  it('allows one exact external HTTPS host with identity and minimized payload', async () => {
    const fetch = fetcher();
    const publisher = new HttpWebhookEventPublisher('/workspace/private', 'session-a', {
      url: 'https://events.example.com:443',
      allowedPorts: [443],
      externalHttpsHosts: ['events.example.com'],
      callerIdentity: identity('/workspace/private', 'session-a'),
      resolver: resolver('93.184.216.34'),
      fetch,
      token: 'token-value',
    });

    await expect(publisher.publishAsync('COST_UPDATE', { total: 2 })).resolves.toBe(true);
    const request = vi.mocked(fetch).mock.calls[0][0];
    expect(request.headers).toMatchObject({ 'X-Forgewright-Token': 'token-value' });
    expect(JSON.parse(request.body)).toMatchObject({
      eventName: 'COST_UPDATE',
      sessionId: 'session-a',
      workspaceId: expect.stringMatching(/^[0-9a-f]{64}$/),
      payload: { total: 2 },
    });
    expect(request.body).not.toContain('/workspace/private');
  });

  it('allows currently allocated global-unicast IPv6 with exact production authority', async () => {
    const address = '2606:4700:4700::1111';
    const fetch = fetcher({ remoteAddress: address });
    const publisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      url: 'https://events.example.com:443',
      allowedPorts: [443],
      externalHttpsHosts: ['events.example.com'],
      callerIdentity: identity(),
      resolver: resolver(address),
      fetch,
    });

    await expect(publisher.publishAsync('COST_UPDATE', {})).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedAddress: address, family: 6 }),
    );
  });

  it('denies external HTTPS without canonical production identity', async () => {
    const fetch = fetcher();
    const publisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      url: 'https://events.example.com:443',
      allowedPorts: [443],
      externalHttpsHosts: ['events.example.com'],
      resolver: resolver('93.184.216.34'),
      fetch,
    });

    await expect(publisher.publishAsync('COST_UPDATE', {})).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['local mode', { mode: 'local' }],
    ['missing caller', { callerId: null }],
    ['unsafe caller', { callerId: '../caller' }],
    ['wrong workspace', { workspaceId: 'f'.repeat(64) }],
    ['wrong session', { sessionId: 'other-session' }],
    ['wrong profile', { profile: 'unconfined' }],
    ['forged profile digest', { profileDigest: 'f'.repeat(64) }],
    ['missing policy digest', { policyDigest: '' }],
  ])('denies external HTTPS for %s trust context', async (_label, change) => {
    const fetch = fetcher();
    const publisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      url: 'https://events.example.com:443',
      allowedPorts: [443],
      externalHttpsHosts: ['events.example.com'],
      callerIdentity: { ...identity(), ...change } as never,
      resolver: resolver('93.184.216.34'),
      fetch,
    });

    await expect(publisher.publishAsync('COST_UPDATE', {})).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not grant loopback trust to an arbitrary hostname that resolves locally', async () => {
    const fetch = fetcher();
    const publisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      url: 'https://evil.example:443',
      allowedPorts: [443],
      resolver: resolver('127.0.0.1'),
      fetch,
    });

    await expect(publisher.publishAsync('COST_UPDATE', {})).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects disallowed ports, redirects, and remote-address rebinding', async () => {
    const disallowed = fetcher();
    const disallowedPort = new HttpWebhookEventPublisher('/workspace', 'session', {
      url: 'http://127.0.0.1:9000',
      allowedPorts: [4318],
      resolver: resolver('127.0.0.1'),
      fetch: disallowed,
    });
    await expect(disallowedPort.publishAsync('PIPELINE_STATE_UPDATE', {})).resolves.toBe(false);
    expect(disallowed).not.toHaveBeenCalled();

    const redirect = fetcher({ status: 302, location: 'https://evil.example/' });
    const redirectPublisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      url: 'http://127.0.0.1:4318',
      allowedPorts: [4318],
      resolver: resolver('127.0.0.1'),
      fetch: redirect,
    });
    await expect(redirectPublisher.publishAsync('PIPELINE_STATE_UPDATE', {})).resolves.toBe(false);

    const rebound = fetcher({ remoteAddress: '127.0.0.2' });
    const reboundPublisher = new HttpWebhookEventPublisher('/workspace', 'session', {
      url: 'http://localhost:4318',
      allowedPorts: [4318],
      resolver: resolver('127.0.0.1'),
      fetch: rebound,
    });
    await expect(reboundPublisher.publishAsync('PIPELINE_STATE_UPDATE', {})).resolves.toBe(false);
  });
});
