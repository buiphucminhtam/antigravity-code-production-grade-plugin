import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import { IEventPublisher } from '../../core/ports/IEventPublisher.js';

export interface WebhookCallerIdentity {
  kind: 'canonical-mcp-runtime';
  mode: 'production';
  callerId: string;
  workspaceId: string;
  sessionId: string;
  profile: 'application';
  profileDigest: string;
  policyDigest: string;
}

export interface WebhookAddress {
  address: string;
  family: 4 | 6;
}

export type WebhookResolver = (hostname: string) => Promise<readonly WebhookAddress[]>;

export interface WebhookFetchRequest {
  url: URL;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  resolvedAddress: string;
  family: 4 | 6;
}

export interface WebhookFetchResponse {
  status: number;
  remoteAddress: string;
  location?: string;
}

export type WebhookFetch = (request: WebhookFetchRequest) => Promise<WebhookFetchResponse>;

export interface HttpWebhookEventPublisherOptions {
  url?: string | null;
  token?: string | null;
  allowedPorts?: readonly number[];
  externalHttpsHosts?: readonly string[];
  callerIdentity?: WebhookCallerIdentity;
  resolver?: WebhookResolver;
  fetch?: WebhookFetch;
  timeoutMs?: number;
  env?: Readonly<Record<string, string | undefined>>;
}

const DEFAULT_TIMEOUT_MS = 2_000;
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SAFE_CALLER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function parsePorts(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === '') return [80, 443];
  return raw.split(',').map((value) => {
    const port = Number(value.trim());
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error('FORGEWRIGHT_WEBHOOK_ALLOWED_PORTS contains an invalid port');
    }
    return port;
  });
}

function normalizeHost(value: string): string {
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return unwrapped.toLowerCase().replace(/\.$/, '');
}

function parseHosts(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw.split(',').map((value) => {
    const host = normalizeHost(value.trim());
    if (!HOST.test(host) && isIP(host) === 0) {
      throw new Error('FORGEWRIGHT_WEBHOOK_EXTERNAL_HTTPS_HOSTS contains an invalid host');
    }
    return host;
  });
}

function effectivePort(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function validatePorts(ports: readonly number[]): number[] {
  for (const port of ports) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error('webhook allowedPorts contains an invalid port');
    }
  }
  return [...ports];
}

function ipv4Parts(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split('.').map(Number);
  return parts.length === 4 ? parts : null;
}

function ipv6Words(address: string): number[] | null {
  if (address.includes('%') || address.includes('.') || isIP(address) !== 6) return null;
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (value: string): number[] | null => {
    if (value === '') return [];
    const groups = value.split(':');
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (left === null || right === null) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const omitted = 8 - left.length - right.length;
  if (omitted < 1) return null;
  return [...left, ...Array<number>(omitted).fill(0), ...right];
}

function isLoopback(address: string): boolean {
  const normalized = normalizeHost(address);
  const ipv4 = ipv4Parts(normalized);
  if (ipv4 !== null) return ipv4[0] === 127;
  return normalized === '::1' || normalized.startsWith('::ffff:127.');
}

function isPublicAddress(address: string): boolean {
  const normalized = normalizeHost(address);
  const ipv4 = ipv4Parts(normalized);
  if (ipv4 !== null) {
    const [a, b] = ipv4;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    ) {
      return false;
    }
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    const embedded = normalized.slice('::ffff:'.length);
    return ipv4Parts(embedded) !== null && isPublicAddress(embedded);
  }
  if (isIP(normalized) !== 6) return false;
  const words = ipv6Words(normalized);
  if (words === null) return false;
  const [first, second] = words;
  // Fail closed to the currently allocated global-unicast space. This denies
  // site-local, unique-local, link-local, multicast, NAT64 and other special
  // prefixes outside 2000::/3, including IPv4-embedded transition ranges.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2002 || first === 0x3ffe || first === 0x3fff) return false;
  if (
    first === 0x2001 &&
    (second === 0 ||
      second === 2 ||
      second === 0x0db8 ||
      (second & 0xfff0) === 0x0010 ||
      (second & 0xfff0) === 0x0020)
  ) {
    return false; // Teredo, benchmarking, documentation, and ORCHID.
  }
  return true;
}

const defaultResolver: WebhookResolver = async (hostname) => {
  if (isIP(hostname) !== 0) {
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

const defaultFetch: WebhookFetch = async (request) =>
  new Promise<WebhookFetchResponse>((resolve, reject) => {
    const client = request.url.protocol === 'https:' ? https : http;
    const outbound = client.request(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        agent: false,
        lookup: (_hostname, _options, callback) => {
          callback(null, request.resolvedAddress, request.family);
        },
      },
      (response) => {
        const remoteAddress = response.socket.remoteAddress ?? '';
        const location = response.headers.location;
        response.resume();
        response.once('end', () =>
          resolve({ status: response.statusCode ?? 0, remoteAddress, location }),
        );
      },
    );
    outbound.setTimeout(request.timeoutMs, () => {
      outbound.destroy(new Error('webhook transport timed out'));
    });
    outbound.once('error', reject);
    outbound.end(request.body);
  });

export class HttpWebhookEventPublisher implements IEventPublisher {
  private readonly url: string | null;
  private readonly token: string | null;
  private readonly allowedPorts: ReadonlySet<number>;
  private readonly externalHttpsHosts: ReadonlySet<string>;
  private readonly resolver: WebhookResolver;
  private readonly fetch: WebhookFetch;
  private readonly timeoutMs: number;
  private readonly callerIdentity?: WebhookCallerIdentity;

  constructor(
    private readonly workspacePath: string,
    private readonly sessionId?: string,
    options: HttpWebhookEventPublisherOptions = {},
  ) {
    const env = options.env ?? process.env;
    this.url = options.url === undefined ? (env.FORGEWRIGHT_WEBHOOK_URL ?? null) : options.url;
    this.token =
      options.token === undefined ? (env.FORGEWRIGHT_WEBHOOK_TOKEN ?? null) : options.token;
    this.allowedPorts = new Set(
      validatePorts(options.allowedPorts ?? parsePorts(env.FORGEWRIGHT_WEBHOOK_ALLOWED_PORTS)),
    );
    this.externalHttpsHosts = new Set(
      (options.externalHttpsHosts ?? parseHosts(env.FORGEWRIGHT_WEBHOOK_EXTERNAL_HTTPS_HOSTS)).map(
        normalizeHost,
      ),
    );
    this.callerIdentity = options.callerIdentity;
    this.resolver = options.resolver ?? defaultResolver;
    this.fetch = options.fetch ?? defaultFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error('webhook timeoutMs must be a positive integer');
    }
  }

  publish(eventName: string, payload: unknown): void {
    void this.publishAsync(eventName, payload).catch(() => undefined);
  }

  async publishAsync(eventName: string, payload: unknown): Promise<boolean> {
    if (!this.url) return false;
    if (eventName !== 'PIPELINE_STATE_UPDATE' && eventName !== 'COST_UPDATE') return false;
    try {
      const baseUrl = new URL(this.url);
      if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') return false;
      if (baseUrl.username !== '' || baseUrl.password !== '') return false;
      const port = effectivePort(baseUrl);
      if (!this.allowedPorts.has(port)) return false;

      const hostname = normalizeHost(baseUrl.hostname);
      const localDestination = hostname === 'localhost' || isLoopback(hostname);
      const expectedWorkspaceId = createHash('sha256')
        .update(this.workspacePath, 'utf8')
        .digest('hex');
      const expectedProfileDigest = createHash('sha256')
        .update('production:application', 'utf8')
        .digest('hex');
      const externalAuthorized =
        baseUrl.protocol === 'https:' &&
        this.externalHttpsHosts.has(hostname) &&
        this.callerIdentity?.kind === 'canonical-mcp-runtime' &&
        this.callerIdentity.mode === 'production' &&
        typeof this.callerIdentity.callerId === 'string' &&
        SAFE_CALLER_ID.test(this.callerIdentity.callerId) &&
        this.callerIdentity.workspaceId === expectedWorkspaceId &&
        this.callerIdentity.sessionId === this.sessionId &&
        this.callerIdentity.profile === 'application' &&
        this.callerIdentity.profileDigest === expectedProfileDigest &&
        DIGEST.test(this.callerIdentity.policyDigest);
      if (!localDestination && !externalAuthorized) return false;

      const resolved = await this.resolver(hostname);
      if (resolved.length === 0) return false;
      if (localDestination && !resolved.every(({ address }) => isLoopback(address))) return false;
      if (!localDestination && !resolved.every(({ address }) => isPublicAddress(address))) {
        return false;
      }

      const endpoint =
        eventName === 'PIPELINE_STATE_UPDATE' ? '/api/v1/state' : '/api/v1/telemetry';
      const url = new URL(endpoint, baseUrl.origin);
      const body = JSON.stringify({
        eventName,
        sessionId: this.sessionId,
        workspaceId: expectedWorkspaceId,
        payload,
      });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      };
      if (this.token) headers['X-Forgewright-Token'] = this.token;

      const selected = resolved[0];
      const response = await this.fetch({
        url,
        method: 'POST',
        headers,
        body,
        timeoutMs: this.timeoutMs,
        resolvedAddress: selected.address,
        family: selected.family,
      });
      if (normalizeHost(response.remoteAddress) !== normalizeHost(selected.address)) return false;
      if (response.location !== undefined || (response.status >= 300 && response.status < 400)) {
        return false;
      }
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }
}
