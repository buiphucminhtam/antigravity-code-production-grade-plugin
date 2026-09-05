import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DisposableEnvironmentError,
  DisposableEnvironmentRuntime,
  createArtifactDiscardProjection,
  createArtifactVerificationProjection,
  createAttestationVerificationProjection,
  createBackendAttestation,
  createContainedArtifactVerifier,
  createDisposableEnvironmentPolicy,
  createDisposableEnvironmentRegistry,
  createDisposableWorkspace,
  createFilesystemProjection,
  createLocalTestDisposableHostCapabilityFactory,
  createNetworkResolutionProjection,
  createTeardownReconciliationProjection,
  evaluateDefaultHostCapability,
  evaluateDisposableEnvironmentProductionEligibility,
  hashDisposableEnvironmentPayload,
  parseDisposableEnvironmentReceipt,
  type ArtifactDiscardProjection,
  type AttestationChallenge,
  type BackendAttestation,
  type BackendExecuteRequest,
  type BackendExecuteResult,
  type BackendExportRequest,
  type BackendExportResult,
  type BackendProvisionRequest,
  type BackendProvisionResult,
  type BackendRestoreRequest,
  type BackendRestoreResult,
  type BackendSnapshotRequest,
  type BackendSnapshotResult,
  type BackendStartRequest,
  type BackendStartResult,
  type BackendTeardownRequest,
  type BackendTeardownResult,
  type DisposableArtifact,
  type DisposableEnvironmentBackend,
  type DisposableEnvironmentPolicy,
  type DisposableEnvironmentReceipt,
  type DisposableEnvironmentRegistry,
  type DisposableEnvironmentRuntimeOptions,
  type DisposableWorkspace,
  type LocalTestDisposableHostCapabilityFactory,
  type NetworkConnectionReceipt,
  type LocalTestDisposableHostCapability,
} from './disposable-environment.js';

const NOW = '2026-09-04T12:00:00.000Z';
const LATER = '2026-09-05T12:00:00.000Z';
const HASH = createHash('sha256').update('fixture').digest('hex');
const VERIFIER_DIGEST = createHash('sha256').update('verifier').digest('hex');
const RECONCILER_DIGEST = createHash('sha256').update('reconciler').digest('hex');

type BackendRequest =
  | BackendProvisionRequest
  | BackendStartRequest
  | BackendExecuteRequest
  | BackendSnapshotRequest
  | BackendRestoreRequest
  | BackendExportRequest
  | BackendTeardownRequest;

class FakeBackend implements DisposableEnvironmentBackend {
  readonly backendId = 'fake-backend';
  readonly runtimeId = 'fake-runtime';
  readonly calls: BackendRequest[] = [];
  maxActive = 0;
  private active = 0;
  private snapshotOrdinal = 0;
  artifacts: DisposableArtifact[] = [];
  provisionHook:
    | ((
        request: BackendProvisionRequest,
      ) => BackendProvisionResult | Promise<BackendProvisionResult>)
    | null = null;
  executeHook:
    | ((request: BackendExecuteRequest) => BackendExecuteResult | Promise<BackendExecuteResult>)
    | null = null;
  restoreHook:
    | ((request: BackendRestoreRequest) => BackendRestoreResult | Promise<BackendRestoreResult>)
    | null = null;
  exportHook:
    ((request: BackendExportRequest) => BackendExportResult | Promise<BackendExportResult>) | null =
    null;
  teardownHook:
    | ((request: BackendTeardownRequest) => BackendTeardownResult | Promise<BackendTeardownResult>)
    | null = null;

  private async tracked<T>(task: () => T | Promise<T>): Promise<T> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      return await task();
    } finally {
      this.active -= 1;
    }
  }

  provision(
    request: BackendProvisionRequest,
    _signal: AbortSignal,
  ): Promise<BackendProvisionResult> {
    this.calls.push(request);
    return this.tracked(
      () =>
        this.provisionHook?.(request) ?? {
          environmentId: request.environmentId,
          operationSequence: request.operationSequence,
          generation: request.generation,
          runtimeHandle: 'runtime-handle',
          rootRef: 'isolated/root',
          filesystemConsumeToken: request.filesystemProjection?.projectionSha256 ?? null,
        },
    );
  }

  start(request: BackendStartRequest, _signal: AbortSignal): Promise<BackendStartResult> {
    this.calls.push(request);
    return this.tracked(() => ({
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      ready: true,
    }));
  }

  execute(request: BackendExecuteRequest, _signal: AbortSignal): Promise<BackendExecuteResult> {
    this.calls.push(request);
    return this.tracked(
      () =>
        this.executeHook?.(request) ?? {
          environmentId: request.environmentId,
          operationSequence: request.operationSequence,
          generation: request.generation,
          exitCode: 0,
          cpuMillis: 10,
          peakMemoryBytes: 1_024,
          peakPids: 1,
          outputBytes: 16,
          diskBytes: 128,
          outputSha256: HASH,
          connections: request.networkDestinations.map((destination): NetworkConnectionReceipt => ({
            protocol: destination.protocol,
            hostname: destination.hostname,
            port: destination.port,
            connectedIp: destination.chosenIp,
            pinToken: destination.pinToken,
            resolutionSha256: destination.resolutionSha256,
          })),
        },
    );
  }

  snapshot(request: BackendSnapshotRequest, _signal: AbortSignal): Promise<BackendSnapshotResult> {
    this.calls.push(request);
    return this.tracked(() => {
      this.snapshotOrdinal += 1;
      return {
        environmentId: request.environmentId,
        operationSequence: request.operationSequence,
        generation: request.generation,
        snapshotId: `snapshot-${this.snapshotOrdinal}`,
        snapshotRef: `snapshots/snapshot-${this.snapshotOrdinal}.bin`,
        snapshotBytes: 64,
        snapshotMediaType: 'application/octet-stream',
        stateSha256: HASH,
      };
    });
  }

  restore(request: BackendRestoreRequest, _signal: AbortSignal): Promise<BackendRestoreResult> {
    this.calls.push(request);
    return this.tracked(
      () =>
        this.restoreHook?.(request) ?? {
          environmentId: request.environmentId,
          operationSequence: request.operationSequence,
          generation: request.generation,
          restoredStateSha256: request.snapshot.stateSha256,
        },
    );
  }

  exportArtifacts(
    request: BackendExportRequest,
    _signal: AbortSignal,
  ): Promise<BackendExportResult> {
    this.calls.push(request);
    return this.tracked(
      () =>
        this.exportHook?.(request) ?? {
          environmentId: request.environmentId,
          operationSequence: request.operationSequence,
          generation: request.generation,
          artifacts: this.artifacts,
        },
    );
  }

  teardown(request: BackendTeardownRequest, _signal: AbortSignal): Promise<BackendTeardownResult> {
    this.calls.push(request);
    return this.tracked(
      () =>
        this.teardownHook?.(request) ?? {
          environmentId: request.environmentId,
          operationSequence: request.operationSequence,
          generation: request.generation,
          orphanProcesses: 0,
          mountedFilesystems: 0,
          networkLeases: 0,
        },
    );
  }
}

interface Fixture {
  root: string;
  exportRoot: string;
  workspace: DisposableWorkspace;
  policy: DisposableEnvironmentPolicy;
  registry: DisposableEnvironmentRegistry;
  factory: LocalTestDisposableHostCapabilityFactory;
  capability: LocalTestDisposableHostCapability;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'disposable-secure-'));
  const exportRoot = join(root, 'exports');
  mkdirSync(join(root, 'readonly'));
  mkdirSync(join(root, 'work'));
  mkdirSync(join(root, 'work', 'mounts'));
  mkdirSync(exportRoot);
  writeFileSync(join(root, 'readonly', 'input.txt'), 'immutable');
  const sourceSha256 = createHash('sha256').update('immutable').digest('hex');
  const workspace = createDisposableWorkspace({ workspaceId: 'workspace-1', root });
  const policy = createDisposableEnvironmentPolicy({
    policyId: 'policy-1',
    capabilities: {
      filesystem: {
        enabled: true,
        readOnlyPaths: ['readonly'],
        writablePaths: ['work'],
        mounts: [
          {
            mountId: 'input-mount',
            sourceRef: 'readonly/input.txt',
            targetRef: 'work/mounts/input.txt',
            sourceSha256,
            access: 'read-only',
          },
        ],
      },
      network: {
        enabled: true,
        egressAllowlist: [{ protocol: 'https', hostname: 'example.com', port: 443 }],
      },
      process: {
        enabled: true,
        allowedExecutables: ['node'],
        environmentAllowlist: { CI: 'true', NODE_ENV: 'test' },
        childProcesses: 'deny',
        maxArgCount: 8,
        maxArgBytes: 1_024,
      },
      secret: { enabled: true, allowedHandles: ['build-secret'] },
      resource: {
        cpuMillis: 100,
        memoryBytes: 4_096,
        pids: 2,
        wallTimeMs: 1_000,
        outputBytes: 1_024,
        diskBytes: 4_096,
        snapshotBytes: 1_024,
        artifactBytes: 1_024,
      },
    },
  });
  const registry = createDisposableEnvironmentRegistry({
    registryId: `registry-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });
  const factory = createLocalTestDisposableHostCapabilityFactory();
  const capability = factory.mint({
    capabilityId: 'host-capability',
    backendId: 'fake-backend',
    runtimeId: 'fake-runtime',
    capabilitySha256: policy.capabilitySha256,
    issuedAt: NOW,
    expiresAt: LATER,
  });
  return { root, exportRoot, workspace, policy, registry, factory, capability };
}

function issueAttestation(challenge: AttestationChallenge): BackendAttestation {
  return createBackendAttestation({
    attestationId: `attestation-${challenge.operationSequence}`,
    issuerId: 'local-test-issuer',
    verifierId: 'local-test-verifier',
    verifierDigest: VERIFIER_DIGEST,
    reconcilerId: 'local-test-reconciler',
    reconcilerDigest: RECONCILER_DIGEST,
    nonce: challenge.nonce,
    authority: challenge.authority,
    operation: challenge.operation,
    operationSequence: challenge.operationSequence,
    environmentId: challenge.environmentId,
    backendId: challenge.backendId,
    runtimeId: challenge.runtimeId,
    policySha256: challenge.policySha256,
    workspaceSha256: challenge.workspaceSha256,
    capabilitySha256: challenge.capabilitySha256,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  });
}

function projectAttestation(attestation: BackendAttestation, challenge: AttestationChallenge) {
  return createAttestationVerificationProjection({
    projectionId: `attestation-proof-${challenge.operationSequence}`,
    attestationSha256: attestation.attestationSha256,
    verifierId: 'local-test-verifier',
    verifierDigest: VERIFIER_DIGEST,
    nonce: challenge.nonce,
    authority: challenge.authority,
    operation: challenge.operation,
    operationSequence: challenge.operationSequence,
    environmentId: challenge.environmentId,
    backendId: challenge.backendId,
    runtimeId: challenge.runtimeId,
    policySha256: challenge.policySha256,
    workspaceSha256: challenge.workspaceSha256,
    capabilitySha256: challenge.capabilitySha256,
    verifiedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  });
}

type RuntimeOverrides = Partial<
  Pick<
    DisposableEnvironmentRuntimeOptions,
    | 'artifactRevoker'
    | 'artifactVerifier'
    | 'attestationProjectionVerifier'
    | 'attestationProvider'
    | 'filesystemProjectionVerifier'
    | 'networkProjectionVerifier'
    | 'now'
    | 'operationTimeoutMs'
    | 'teardownReconciler'
  >
> & {
  environmentId?: string;
  capability?: LocalTestDisposableHostCapability | null;
};

function runtime(value: Fixture, backend: FakeBackend, overrides: RuntimeOverrides = {}) {
  return new DisposableEnvironmentRuntime({
    environmentId: overrides.environmentId ?? 'environment-1',
    backend,
    registry: value.registry,
    hostCapability: Object.prototype.hasOwnProperty.call(overrides, 'capability')
      ? overrides.capability
      : value.capability,
    policy: value.policy,
    workspace: value.workspace,
    attestationProvider: overrides.attestationProvider ?? issueAttestation,
    attestationProjectionVerifier: overrides.attestationProjectionVerifier ?? projectAttestation,
    filesystemProjectionVerifier: Object.prototype.hasOwnProperty.call(
      overrides,
      'filesystemProjectionVerifier',
    )
      ? overrides.filesystemProjectionVerifier
      : (input) => createFilesystemProjection(input),
    networkProjectionVerifier:
      overrides.networkProjectionVerifier ??
      ((destination) =>
        createNetworkResolutionProjection({
          projectionId: 'network-proof',
          verifierId: 'local-test-verifier',
          verifierDigest: VERIFIER_DIGEST,
          destination,
          firstResolution: ['93.184.216.34'],
          secondResolution: ['93.184.216.34'],
          chosenIp: '93.184.216.34',
          pinToken: 'pin-example',
          verifiedAt: NOW,
          expiresAt: LATER,
        })),
    artifactVerifier:
      overrides.artifactVerifier ??
      ((artifacts, expected) =>
        artifacts.map((artifact, index) =>
          createArtifactVerificationProjection({
            projectionId: `artifact-proof-${index}`,
            verifierId: 'local-test-verifier',
            verifierDigest: VERIFIER_DIGEST,
            ref: artifact.ref,
            mediaType: expected[index].mediaType,
            sha256: artifact.sha256,
            bytes: artifact.bytes,
            fileIdentity: `file-${index}`,
            verifiedAt: NOW,
          }),
        )),
    artifactRevoker:
      overrides.artifactRevoker ??
      ((artifacts, exportResultSha256) =>
        createArtifactDiscardProjection({
          projectionId: 'artifact-discard',
          verifierId: 'local-test-verifier',
          verifierDigest: VERIFIER_DIGEST,
          exportResultSha256,
          discardedRefs: artifacts.map(({ ref }) => ref),
          discardedAt: NOW,
        })),
    teardownReconciler:
      overrides.teardownReconciler ?? ((input) => createTeardownReconciliationProjection(input)),
    operationTimeoutMs: overrides.operationTimeoutMs,
    now: overrides.now ?? (() => new Date(NOW)),
  });
}

function command() {
  return {
    argv: ['node', '--version'],
    cwd: 'work',
    environmentKeys: ['CI'],
    secretHandles: [],
    networkDestinations: [],
  };
}

async function start(subject: DisposableEnvironmentRuntime): Promise<void> {
  expect(await subject.provision()).toMatchObject({ status: 'UNVERIFIED', code: 'PROVISIONED' });
  expect(await subject.start()).toMatchObject({ status: 'UNVERIFIED', code: 'STARTED' });
}

describe('PF6 opaque trust and shared registry', () => {
  it('exposes no public path to production or os-enforced host trust', () => {
    expect(() =>
      (
        createLocalTestDisposableHostCapabilityFactory as unknown as (
          value: Record<string, unknown>,
        ) => unknown
      )({ authority: 'production', isolation: 'os-enforced' }),
    ).toThrow(DisposableEnvironmentError);
  });

  it('keeps host inventory advisory even when availability booleans claim verified', () => {
    const unavailable = { available: false, verified: false, backendId: null, runtimeId: null };
    const result = evaluateDefaultHostCapability({
      observedAt: NOW,
      docker: {
        available: true,
        verified: true,
        backendId: 'docker',
        runtimeId: 'docker-runtime',
      },
      podman: unavailable,
      sandbox: unavailable,
    });
    expect(result).toMatchObject({
      status: 'UNVERIFIED',
      selected: null,
      reasonCode: 'INVENTORY_ONLY_NO_TRUST',
    });
    expect(result.availableHints).toEqual(['docker']);
  });

  it('rejects cloned or contract-only capabilities and boolean verifier callbacks with zero backend effects', async () => {
    const value = fixture();
    const cloned = { ...value.capability } as LocalTestDisposableHostCapability;
    const clonedBackend = new FakeBackend();
    const clonedReceipt = await runtime(value, clonedBackend, { capability: cloned }).provision();
    expect(clonedReceipt).toMatchObject({
      status: 'UNVERIFIED',
      code: 'HOST_CAPABILITY_INVALID',
      operationSequence: 1,
    });
    expect(clonedBackend.calls).toHaveLength(0);

    const booleanBackend = new FakeBackend();
    const booleanReceipt = await runtime(value, booleanBackend, {
      attestationProjectionVerifier: () => true,
    }).provision();
    expect(booleanReceipt).toMatchObject({ status: 'UNVERIFIED', code: 'ATTESTATION_UNVERIFIED' });
    expect(booleanBackend.calls).toHaveLength(0);

    const throwingBackend = new FakeBackend();
    const throwingReceipt = await runtime(value, throwingBackend, {
      attestationProjectionVerifier: () => {
        throw new Error('untrusted verifier detail');
      },
    }).provision();
    expect(throwingReceipt).toMatchObject({ status: 'UNVERIFIED', code: 'ATTESTATION_UNVERIFIED' });
    expect(throwingBackend.calls).toHaveLength(0);

    const noCapabilityBackend = new FakeBackend();
    const noCapabilityReceipt = await runtime(value, noCapabilityBackend, {
      capability: null,
    }).provision();
    expect(noCapabilityReceipt).toMatchObject({
      status: 'UNVERIFIED',
      code: 'HOST_CAPABILITY_INVALID',
      authority: 'none',
      hostIsolation: 'unverified',
      productionEligible: false,
    });
    expect(noCapabilityBackend.calls).toHaveLength(0);
  });

  it('shares state, serialization, sequences, snapshots, and attestation replay across instances', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const first = runtime(value, backend);
    const second = runtime(value, backend);
    expect((await first.execute(command())).operationSequence).toBe(1);
    expect((await second.provision()).operationSequence).toBe(2);
    expect((await first.start()).operationSequence).toBe(3);
    backend.executeHook = async (request) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return {
        environmentId: request.environmentId,
        operationSequence: request.operationSequence,
        generation: request.generation,
        exitCode: 0,
        cpuMillis: 1,
        peakMemoryBytes: 1,
        peakPids: 1,
        outputBytes: 1,
        diskBytes: 1,
        outputSha256: HASH,
        connections: [],
      };
    };
    const [left, right] = await Promise.all([first.execute(command()), second.execute(command())]);
    expect([left.operationSequence, right.operationSequence]).toEqual([4, 5]);
    expect(backend.maxActive).toBe(1);
    expect(first.inspect()).toEqual(second.inspect());

    const snapshot = (await first.snapshot({ ttlMs: 10_000 })).snapshot!;
    expect(await second.restore(snapshot)).toMatchObject({
      status: 'UNVERIFIED',
      code: 'SNAPSHOT_RESTORED',
    });
    expect((await first.restore(snapshot)).code).toBe('SNAPSHOT_REPLAY');
  });

  it('consumes an attestation nonce once across runtime instances', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    let firstAttestation: BackendAttestation | null = null;
    const replayingProvider = (challenge: AttestationChallenge) => {
      firstAttestation ??= issueAttestation(challenge);
      return firstAttestation;
    };
    const first = runtime(value, backend, { attestationProvider: replayingProvider });
    const second = runtime(value, backend, { attestationProvider: replayingProvider });
    expect(await first.provision()).toMatchObject({
      status: 'UNVERIFIED',
      code: 'PROVISIONED',
    });
    expect(await second.start()).toMatchObject({
      status: 'UNVERIFIED',
      code: 'ATTESTATION_REPLAY',
      operationSequence: 2,
    });
    expect(backend.calls.filter(({ operation }) => operation === 'start')).toHaveLength(0);
  });
});

describe('PF6 pinned network and input boundaries', () => {
  it('passes a single globally-routable pin to the backend and requires an exact connection echo', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const subject = runtime(value, backend);
    await start(subject);
    const receipt = await subject.execute({
      ...command(),
      networkDestinations: [{ protocol: 'https', hostname: 'example.com', port: 443 }],
    });
    expect(receipt).toMatchObject({ status: 'UNVERIFIED', code: 'EXECUTED' });
    const request = backend.calls.find(
      ({ operation }) => operation === 'execute',
    ) as BackendExecuteRequest;
    expect(request.networkDestinations[0]).toMatchObject({
      verifiedAddresses: ['93.184.216.34'],
      chosenIp: '93.184.216.34',
      pinToken: 'pin-example',
    });
    expect(receipt.networkProjectionSha256).toHaveLength(1);

    const liarValue = fixture();
    const liarBackend = new FakeBackend();
    liarBackend.executeHook = (input) => ({
      environmentId: input.environmentId,
      operationSequence: input.operationSequence,
      generation: input.generation,
      exitCode: 0,
      cpuMillis: 1,
      peakMemoryBytes: 1,
      peakPids: 1,
      outputBytes: 1,
      diskBytes: 1,
      outputSha256: HASH,
      connections: input.networkDestinations.map((destination) => ({
        protocol: destination.protocol,
        hostname: destination.hostname,
        port: destination.port,
        connectedIp: '10.0.0.9',
        pinToken: destination.pinToken,
        resolutionSha256: destination.resolutionSha256,
      })),
    });
    const liar = runtime(liarValue, liarBackend);
    await start(liar);
    expect(
      await liar.execute({
        ...command(),
        networkDestinations: [{ protocol: 'https', hostname: 'example.com', port: 443 }],
      }),
    ).toMatchObject({ status: 'BLOCKED', code: 'NETWORK_PIN_MISMATCH', stateAfter: 'QUARANTINED' });
  });

  it('rejects unauthorized/private destinations, rebinding, multiple answers, and special IPv6 ranges', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const plain = runtime(value, backend);
    await start(plain);
    expect(
      (
        await plain.execute({
          ...command(),
          networkDestinations: [{ protocol: 'https', hostname: 'evil.example', port: 443 }],
        })
      ).code,
    ).toBe('EGRESS_NOT_ALLOWED');
    expect(
      (
        await plain.execute({
          ...command(),
          networkDestinations: [{ protocol: 'https', hostname: '169.254.169.254', port: 443 }],
        })
      ).code,
    ).toBe('EGRESS_PRIVATE_DESTINATION');

    const cases = [
      {
        first: ['93.184.216.34'],
        second: ['93.184.216.35'],
        chosen: '93.184.216.34',
        code: 'DNS_REBINDING_DETECTED',
      },
      {
        first: ['93.184.216.34', '93.184.216.35'],
        second: ['93.184.216.34', '93.184.216.35'],
        chosen: '93.184.216.34',
        code: 'MULTI_ADDRESS_DESTINATION_DENIED',
      },
      {
        first: ['100::1'],
        second: ['100::1'],
        chosen: '100::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['64:ff9b::1'],
        second: ['64:ff9b::1'],
        chosen: '64:ff9b::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['2001:1::1'],
        second: ['2001:1::1'],
        chosen: '2001:1::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['5f00::1'],
        second: ['5f00::1'],
        chosen: '5f00::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['fec0::1'],
        second: ['fec0::1'],
        chosen: 'fec0::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['::ffff:127.0.0.1'],
        second: ['::ffff:127.0.0.1'],
        chosen: '::ffff:127.0.0.1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['::127.0.0.1'],
        second: ['::127.0.0.1'],
        chosen: '::127.0.0.1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['::ffff:0:127.0.0.1'],
        second: ['::ffff:0:127.0.0.1'],
        chosen: '::ffff:0:127.0.0.1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['100:0:0:1::1'],
        second: ['100:0:0:1::1'],
        chosen: '100:0:0:1::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['400::1'],
        second: ['400::1'],
        chosen: '400::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['3ffe::1'],
        second: ['3ffe::1'],
        chosen: '3ffe::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['2d00::1'],
        second: ['2d00::1'],
        chosen: '2d00::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['3000::1'],
        second: ['3000::1'],
        chosen: '3000::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['::127.0.0.1'],
        second: ['::127.0.0.1'],
        chosen: '::127.0.0.1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['::ffff:0:127.0.0.1'],
        second: ['::ffff:0:127.0.0.1'],
        chosen: '::ffff:0:127.0.0.1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['100:0:0:1::1'],
        second: ['100:0:0:1::1'],
        chosen: '100:0:0:1::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
      {
        first: ['400::1'],
        second: ['400::1'],
        chosen: '400::1',
        code: 'EGRESS_PRIVATE_DESTINATION',
      },
    ];
    for (const address of [
      '2000::1',
      '2001:1000::1',
      'c000::1',
      '2003:4000::1',
      '2420::1',
      '2610:200::1',
      '2611::1',
      '2620:200::1',
      '2620:4f:8000::1',
      '2621::1',
      '2640::1',
      '2810::1',
      '2a20::1',
      '2c10::1',
      '2d00::1',
      '3000::1',
      '3ffe::1',
      '3fff::1',
    ]) {
      cases.push({
        first: [address],
        second: [address],
        chosen: address,
        code: 'EGRESS_PRIVATE_DESTINATION',
      });
    }
    for (const [index, testCase] of cases.entries()) {
      const caseValue = fixture();
      const caseBackend = new FakeBackend();
      const subject = runtime(caseValue, caseBackend, {
        networkProjectionVerifier: (destination) =>
          createNetworkResolutionProjection({
            projectionId: `network-case-${index}`,
            verifierId: 'local-test-verifier',
            verifierDigest: VERIFIER_DIGEST,
            destination,
            firstResolution: testCase.first,
            secondResolution: testCase.second,
            chosenIp: testCase.chosen,
            pinToken: `pin-case-${index}`,
            verifiedAt: NOW,
            expiresAt: LATER,
          }),
      });
      await start(subject);
      const receipt = await subject.execute({
        ...command(),
        networkDestinations: [{ protocol: 'https', hostname: 'example.com', port: 443 }],
      });
      expect(receipt.code).toBe(testCase.code);
      expect(caseBackend.calls.filter(({ operation }) => operation === 'execute')).toHaveLength(0);
    }
  });

  it('allows only frozen IANA allocated native IPv6 prefixes without claiming live routing', async () => {
    for (const [index, address] of [
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '2404:6800:4003::200e',
      '2a00:1450:4001::1',
    ].entries()) {
      const value = fixture();
      const backend = new FakeBackend();
      const subject = runtime(value, backend, {
        networkProjectionVerifier: (destination) =>
          createNetworkResolutionProjection({
            projectionId: `allocated-ipv6-${index}`,
            verifierId: 'local-test-verifier',
            verifierDigest: VERIFIER_DIGEST,
            destination,
            firstResolution: [address],
            secondResolution: [address],
            chosenIp: address,
            pinToken: `allocated-pin-${index}`,
            verifiedAt: NOW,
            expiresAt: LATER,
          }),
      });
      await start(subject);
      const receipt = await subject.execute({
        ...command(),
        networkDestinations: [{ protocol: 'https', hostname: 'example.com', port: 443 }],
      });
      expect(receipt).toMatchObject({ status: 'UNVERIFIED', code: 'EXECUTED' });
      expect(backend.calls.filter(({ operation }) => operation === 'execute')).toHaveLength(1);
    }
  });

  it('uses own-property environment lookup and rejects prototype, control, raw-secret, and invalid handles', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const subject = runtime(value, backend);
    await start(subject);
    for (const key of ['constructor', '__proto__', 'CI\n']) {
      expect((await subject.execute({ ...command(), environmentKeys: [key] })).code).toBe(
        'ENVIRONMENT_NOT_ALLOWED',
      );
    }
    expect((await subject.execute({ ...command(), secretHandles: ['build:secret'] })).code).toBe(
      'INVALID_CONTRACT',
    );
    expect((await subject.execute({ ...command(), secretHandles: ['not-allowed'] })).code).toBe(
      'SECRET_HANDLE_NOT_ALLOWED',
    );
    expect(await subject.execute({ ...command(), secretHandles: ['build-secret'] })).toMatchObject({
      status: 'UNVERIFIED',
      code: 'EXECUTED',
    });
    expect((await subject.execute({ ...command(), cwd: '../escape' })).code).toBe(
      'PATH_NOT_CONTAINED',
    );

    expect(() =>
      createDisposableEnvironmentPolicy({
        policyId: 'raw-secret',
        capabilities: {
          ...value.policy.capabilities,
          process: {
            ...value.policy.capabilities.process,
            environmentAllowlist: { ACCESS: 'Bearer abcdefghijklmnopqrstuvwxyz' },
          },
        },
      }),
    ).toThrow(DisposableEnvironmentError);
    for (const rawToken of [
      'github_pat_11AA22BB33CC44DD55EE66FF77GG88HH99II',
      'glpat-11AA22BB33CC44DD55EE',
    ]) {
      expect(() =>
        createDisposableEnvironmentPolicy({
          policyId: 'raw-token',
          capabilities: {
            ...value.policy.capabilities,
            process: {
              ...value.policy.capabilities.process,
              environmentAllowlist: { CACHE_VALUE: rawToken },
            },
          },
        }),
      ).toThrow(DisposableEnvironmentError);
    }
    for (const [policyId, secretValue] of [
      ['github-fine-grained-pat', 'github_pat_1234567890abcdefghijklmnopqrstuv'],
      ['gitlab-pat', 'glpat-1234567890abcdefghijklmnopqrstuv'],
    ] as const) {
      expect(() =>
        createDisposableEnvironmentPolicy({
          policyId,
          capabilities: {
            ...value.policy.capabilities,
            process: {
              ...value.policy.capabilities.process,
              environmentAllowlist: { ACCESS: secretValue },
            },
          },
        }),
      ).toThrow(DisposableEnvironmentError);
    }
    expect(() =>
      createDisposableEnvironmentPolicy({
        policyId: 'control-value',
        capabilities: {
          ...value.policy.capabilities,
          process: {
            ...value.policy.capabilities.process,
            environmentAllowlist: { SAFE: 'line\nvalue' },
          },
        },
      }),
    ).toThrow(DisposableEnvironmentError);
  });

  it('requires a strict filesystem identity projection and backend consume token', async () => {
    const missingValue = fixture();
    const missingBackend = new FakeBackend();
    const missing = runtime(missingValue, missingBackend, {
      filesystemProjectionVerifier: undefined,
    });
    expect(await missing.provision()).toMatchObject({
      status: 'UNVERIFIED',
      code: 'FILESYSTEM_PROJECTION_MISSING',
    });
    expect(missingBackend.calls).toHaveLength(0);

    const liarValue = fixture();
    const liarBackend = new FakeBackend();
    liarBackend.provisionHook = (request) => ({
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      runtimeHandle: 'runtime-handle',
      rootRef: 'isolated/root',
      filesystemConsumeToken: 'not-the-projection',
    });
    expect(await runtime(liarValue, liarBackend).provision()).toMatchObject({
      status: 'BLOCKED',
      code: 'BACKEND_RESULT_INVALID',
    });

    const pathValue = fixture();
    symlinkSync(pathValue.root, join(pathValue.root, 'work', 'mounts', 'escape'));
    expect(() =>
      createDisposableEnvironmentPolicy({
        policyId: 'bad-target',
        capabilities: {
          ...pathValue.policy.capabilities,
          filesystem: {
            ...pathValue.policy.capabilities.filesystem,
            mounts: [
              {
                ...pathValue.policy.capabilities.filesystem.mounts[0],
                targetRef: 'work/mounts/escape/file',
              },
            ],
          },
        },
      }),
    ).not.toThrow();
    const badPolicy = createDisposableEnvironmentPolicy({
      policyId: 'bad-target-runtime',
      capabilities: {
        ...pathValue.policy.capabilities,
        filesystem: {
          ...pathValue.policy.capabilities.filesystem,
          mounts: [
            {
              ...pathValue.policy.capabilities.filesystem.mounts[0],
              targetRef: 'work/mounts/escape/file',
            },
          ],
        },
      },
    });
    const badCapability = pathValue.factory.mint({
      capabilityId: 'bad-path-capability',
      backendId: 'fake-backend',
      runtimeId: 'fake-runtime',
      capabilitySha256: badPolicy.capabilitySha256,
      issuedAt: NOW,
      expiresAt: LATER,
    });
    expect(
      () =>
        new DisposableEnvironmentRuntime({
          environmentId: 'bad-path-environment',
          backend: new FakeBackend(),
          registry: pathValue.registry,
          hostCapability: badCapability,
          policy: badPolicy,
          workspace: pathValue.workspace,
          now: () => new Date(NOW),
        }),
    ).toThrowError(expect.objectContaining({ code: 'SYMLINK_NOT_ALLOWED' }));
  });
});

describe('PF6 snapshots, artifacts, timeout quarantine, and teardown', () => {
  it('runs the exact lifecycle with canonical receipts and fresh reconciled teardown attempts', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    backend.artifacts = [
      { ref: 'result.json', sha256: HASH, bytes: 12, mediaType: 'application/json' },
    ];
    const subject = runtime(value, backend);
    const receipts: DisposableEnvironmentReceipt[] = [];
    receipts.push(await subject.provision());
    receipts.push(await subject.start());
    receipts.push(await subject.execute(command()));
    const snapshot = await subject.snapshot({ ttlMs: 60_000 });
    receipts.push(snapshot);
    receipts.push(await subject.restore(snapshot.snapshot!));
    receipts.push(
      await subject.exportArtifacts({
        artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
        maxBytes: 64,
      }),
    );
    receipts.push(await subject.teardown());
    receipts.push(await subject.teardown());

    expect(receipts.map(({ status }) => status)).toEqual(
      Array.from({ length: 8 }, () => 'UNVERIFIED'),
    );
    expect(receipts.map(({ operationSequence }) => operationSequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(receipts[6].receiptSha256).not.toBe(receipts[7].receiptSha256);
    expect(backend.calls.filter(({ operation }) => operation === 'teardown')).toHaveLength(2);
    for (const receipt of receipts) {
      expect(
        parseDisposableEnvironmentReceipt(receipt, {
          now: new Date(NOW),
          maxAgeMs: 60_000,
        }).receiptSha256,
      ).toBe(receipt.receiptSha256);
      expect(receipt).toMatchObject({
        authority: 'local-test-only',
        hostIsolation: 'test-simulated',
        productionEligible: false,
      });
      expect(
        evaluateDisposableEnvironmentProductionEligibility(receipt, {
          now: new Date(NOW),
          maxAgeMs: 60_000,
        }),
      ).toMatchObject({ eligible: false, status: 'UNVERIFIED' });
    }
  });

  it('shares bounded snapshots and consumes them before a failed restore verification', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const good = runtime(value, backend);
    await start(good);
    const snapshot = (await good.snapshot({ ttlMs: 60_000 })).snapshot!;
    const rejecting = runtime(value, backend, { attestationProjectionVerifier: () => false });
    expect(await rejecting.restore(snapshot)).toMatchObject({
      status: 'UNVERIFIED',
      code: 'ATTESTATION_UNVERIFIED',
    });
    expect((await good.restore(snapshot)).code).toBe('SNAPSHOT_REPLAY');

    const staleValue = fixture();
    const staleBackend = new FakeBackend();
    const staleRuntime = runtime(staleValue, staleBackend);
    await start(staleRuntime);
    const stale = (await staleRuntime.snapshot({ ttlMs: 60_000 })).snapshot!;
    await staleRuntime.execute(command());
    expect((await staleRuntime.restore(stale)).code).toBe('SNAPSHOT_STALE');

    const other = runtime(staleValue, staleBackend, { environmentId: 'environment-2' });
    await start(other);
    expect((await other.restore(stale)).code).toBe('SNAPSHOT_CROSS_ENVIRONMENT');

    const expiringValue = fixture();
    const expiringBackend = new FakeBackend();
    let clock = Date.parse(NOW);
    const expiring = runtime(expiringValue, expiringBackend, { now: () => new Date(clock) });
    await start(expiring);
    const expired = (await expiring.snapshot({ ttlMs: 10 })).snapshot!;
    clock += 11;
    expect((await expiring.restore(expired)).code).toBe('SNAPSHOT_EXPIRED');
  });

  it('quarantines quota exhaustion and rolls uncertain provisioning back through reconciled teardown', async () => {
    const quotaValue = fixture();
    const quotaBackend = new FakeBackend();
    quotaBackend.executeHook = (request) => ({
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      exitCode: 0,
      cpuMillis: 1,
      peakMemoryBytes: 1,
      peakPids: 1,
      outputBytes: quotaValue.policy.capabilities.resource.outputBytes + 1,
      diskBytes: 1,
      outputSha256: HASH,
      connections: [],
    });
    const quota = runtime(quotaValue, quotaBackend);
    await start(quota);
    expect(await quota.execute(command())).toMatchObject({
      status: 'BLOCKED',
      code: 'RESOURCE_QUOTA_EXCEEDED',
      stateAfter: 'QUARANTINED',
    });
    expect(await quota.teardown()).toMatchObject({
      status: 'UNVERIFIED',
      code: 'TEARDOWN_CONFIRMED',
    });

    const rollbackValue = fixture();
    const rollbackBackend = new FakeBackend();
    rollbackBackend.provisionHook = () => {
      throw new Error('partial provision detail');
    };
    const rollback = runtime(rollbackValue, rollbackBackend);
    expect(await rollback.provision()).toMatchObject({
      status: 'BLOCKED',
      code: 'BACKEND_OPERATION_FAILED',
      stateAfter: 'QUARANTINED',
    });
    expect(await rollback.teardown()).toMatchObject({
      status: 'UNVERIFIED',
      code: 'TEARDOWN_CONFIRMED',
    });
    expect(rollback.inspect().state).toBe('TORN_DOWN');
  });

  it('verifies exports from one O_NOFOLLOW descriptor and revokes tampered output', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const bytes = Buffer.from('{"ok":true}');
    writeFileSync(join(value.exportRoot, 'result.json'), bytes);
    backend.artifacts = [
      {
        ref: 'result.json',
        sha256: '0'.repeat(64),
        bytes: bytes.length,
        mediaType: 'application/json',
      },
    ];
    let revoked: readonly string[] = [];
    const subject = runtime(value, backend, {
      artifactVerifier: createContainedArtifactVerifier({
        artifactRoot: value.exportRoot,
        containingRoot: value.root,
        verifierId: 'local-test-verifier',
        verifierDigest: VERIFIER_DIGEST,
        now: () => new Date(NOW),
      }),
      artifactRevoker: (artifacts, exportResultSha256): ArtifactDiscardProjection => {
        revoked = artifacts.map(({ ref }) => ref);
        return createArtifactDiscardProjection({
          projectionId: 'revoked-tamper',
          verifierId: 'local-test-verifier',
          verifierDigest: VERIFIER_DIGEST,
          exportResultSha256,
          discardedRefs: [...revoked],
          discardedAt: NOW,
        });
      },
    });
    await start(subject);
    const receipt = await subject.exportArtifacts({
      artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
      maxBytes: 64,
    });
    expect(receipt).toMatchObject({
      status: 'BLOCKED',
      code: 'ARTIFACT_VERIFICATION_FAILED',
      artifactDisposition: 'revoked',
    });
    expect(receipt.artifactRevokeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(revoked).toEqual(['result.json']);
  });

  it('records revoke failure when a boolean callback tries to certify discard', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    backend.artifacts = [{ ref: 'result.json', sha256: HASH, bytes: 12, mediaType: 'text/plain' }];
    const subject = runtime(value, backend, {
      artifactRevoker: () => true,
    });
    await start(subject);
    expect(
      await subject.exportArtifacts({
        artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
        maxBytes: 64,
      }),
    ).toMatchObject({
      status: 'BLOCKED',
      code: 'ARTIFACT_REVOKE_UNVERIFIED',
      artifactDisposition: 'revoke-unverified',
    });
  });

  it('never claims revoked when a wrong-count backend result contains a nonconforming artifact', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    backend.artifacts = [
      {
        ref: '../escape',
        sha256: HASH,
        bytes: 12,
        mediaType: 'application/json',
      },
    ];
    let revokeCalls = 0;
    const subject = runtime(value, backend, {
      artifactRevoker: (artifacts, exportResultSha256) => {
        revokeCalls += 1;
        return createArtifactDiscardProjection({
          projectionId: 'wrong-count-discard',
          verifierId: 'local-test-verifier',
          verifierDigest: VERIFIER_DIGEST,
          exportResultSha256,
          discardedRefs: artifacts.map(({ ref }) => ref),
          discardedAt: NOW,
        });
      },
    });
    await start(subject);
    const receipt = await subject.exportArtifacts({
      artifacts: [
        { ref: 'first.json', mediaType: 'application/json' },
        { ref: 'second.json', mediaType: 'application/json' },
      ],
      maxBytes: 64,
    });
    expect(receipt).toMatchObject({
      status: 'BLOCKED',
      code: 'ARTIFACT_REVOKE_UNVERIFIED',
      artifactDisposition: 'revoke-unverified',
    });
    expect(receipt.artifactIdentityEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      parseDisposableEnvironmentReceipt(receipt, {
        now: new Date(NOW),
        maxAgeMs: 60_000,
      }),
    ).not.toThrow();
    expect(revokeCalls).toBeLessThanOrEqual(1);
  });

  it('never certifies revocation from malformed or incomplete backend artifact inventories', async () => {
    const invalidArtifactSets: readonly DisposableArtifact[][] = [
      [],
      [{ ref: 'result.json', sha256: 'not-a-sha', bytes: 12, mediaType: 'application/json' }],
    ];
    for (const [index, invalidArtifacts] of invalidArtifactSets.entries()) {
      const value = fixture();
      const backend = new FakeBackend();
      backend.exportHook = (request) => ({
        environmentId: request.environmentId,
        operationSequence: request.operationSequence,
        generation: request.generation,
        artifacts: invalidArtifacts,
      });
      let revokeCalls = 0;
      const subject = runtime(value, backend, {
        artifactRevoker: (artifacts, exportResultSha256) => {
          revokeCalls += 1;
          return createArtifactDiscardProjection({
            projectionId: `invalid-backend-revoke-${index}`,
            verifierId: 'local-test-verifier',
            verifierDigest: VERIFIER_DIGEST,
            exportResultSha256,
            discardedRefs: artifacts.map(({ ref }) => ref),
            discardedAt: NOW,
          });
        },
      });
      await start(subject);
      expect(
        await subject.exportArtifacts({
          artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
          maxBytes: 64,
        }),
      ).toMatchObject({
        status: 'BLOCKED',
        code: 'ARTIFACT_REVOKE_UNVERIFIED',
        artifactDisposition: 'revoke-unverified',
      });
      expect(revokeCalls).toBe(0);
    }
  });

  it('requires independent reconciliation and rejects both backend and reconciler lies', async () => {
    const missingValue = fixture();
    const missingBackend = new FakeBackend();
    const missing = new DisposableEnvironmentRuntime({
      environmentId: 'environment-1',
      backend: missingBackend,
      registry: missingValue.registry,
      hostCapability: missingValue.capability,
      policy: missingValue.policy,
      workspace: missingValue.workspace,
      attestationProvider: issueAttestation,
      attestationProjectionVerifier: projectAttestation,
      now: () => new Date(NOW),
    });
    expect(await missing.teardown()).toMatchObject({
      status: 'UNVERIFIED',
      code: 'TEARDOWN_RECONCILER_MISSING',
    });
    expect(missingBackend.calls).toHaveLength(0);

    const backendLieValue = fixture();
    const backendLiar = new FakeBackend();
    backendLiar.teardownHook = (request) => ({
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      orphanProcesses: 1,
      mountedFilesystems: 0,
      networkLeases: 0,
    });
    expect(await runtime(backendLieValue, backendLiar).teardown()).toMatchObject({
      status: 'BLOCKED',
      code: 'TEARDOWN_ORPHANS_REMAIN',
    });

    const reconcileLieValue = fixture();
    const reconcileBackend = new FakeBackend();
    const reconcileLiar = runtime(reconcileLieValue, reconcileBackend, {
      teardownReconciler: (input) =>
        createTeardownReconciliationProjection({ ...input, orphanProcesses: 1 }),
    });
    expect(await reconcileLiar.teardown()).toMatchObject({
      status: 'BLOCKED',
      code: 'TEARDOWN_ORPHANS_REMAIN',
    });
  });

  it('bounds hanging trust/backend callbacks, prevents overlap, and does not infer quiescence from settling', async () => {
    const trustValue = fixture();
    const trustBackend = new FakeBackend();
    const hangingTrust = runtime(trustValue, trustBackend, {
      attestationProjectionVerifier: () => new Promise(() => undefined),
      operationTimeoutMs: 10,
    });
    expect(await hangingTrust.provision()).toMatchObject({
      status: 'BLOCKED',
      code: 'TRUST_CALLBACK_TIMEOUT',
      stateAfter: 'QUARANTINED',
    });
    expect(trustBackend.calls).toHaveLength(0);

    const value = fixture();
    const backend = new FakeBackend();
    let settle!: (result: BackendExecuteResult) => void;
    backend.executeHook = (request) =>
      new Promise<BackendExecuteResult>((resolve) => {
        settle = resolve;
        void request;
      });
    const subject = runtime(value, backend, { operationTimeoutMs: 10 });
    await start(subject);
    expect(await subject.execute(command())).toMatchObject({
      status: 'BLOCKED',
      code: 'OPERATION_TIMEOUT',
    });
    expect((await subject.teardown()).code).toBe('LATE_OPERATION_PENDING');
    settle({
      environmentId: 'environment-1',
      operationSequence: 3,
      generation: 2,
      exitCode: 0,
      cpuMillis: 1,
      peakMemoryBytes: 1,
      peakPids: 1,
      outputBytes: 1,
      diskBytes: 1,
      outputSha256: HASH,
      connections: [],
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const reconcilerLiar = runtime(value, backend, {
      operationTimeoutMs: 10,
      teardownReconciler: (input) =>
        createTeardownReconciliationProjection({ ...input, networkLeases: 1 }),
    });
    expect(await reconcilerLiar.teardown()).toMatchObject({
      status: 'BLOCKED',
      code: 'TEARDOWN_ORPHANS_REMAIN',
    });
    expect(backend.maxActive).toBe(1);
  });
});

describe('PF6 semantic receipt validation', () => {
  it('enforces a total mutually-exclusive artifact disposition matrix', async () => {
    const parse = (receipt: unknown) =>
      parseDisposableEnvironmentReceipt(receipt, {
        now: new Date(NOW),
        maxAgeMs: 60_000,
      });
    const rehash = (
      receipt: DisposableEnvironmentReceipt,
      changes: Record<string, unknown>,
    ): Record<string, unknown> => {
      const { receiptSha256: _oldHash, ...payload } = receipt;
      expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
      const changed = { ...payload, ...changes };
      return { ...changed, receiptSha256: hashDisposableEnvironmentPayload(changed) };
    };

    const noneValue = fixture();
    const noneRuntime = runtime(noneValue, new FakeBackend());
    await start(noneRuntime);
    const none = await noneRuntime.exportArtifacts({ artifacts: [], maxBytes: 64 });

    const retainedValue = fixture();
    const retainedBackend = new FakeBackend();
    retainedBackend.artifacts = [
      { ref: 'result.json', sha256: HASH, bytes: 12, mediaType: 'application/json' },
    ];
    const retainedRuntime = runtime(retainedValue, retainedBackend);
    await start(retainedRuntime);
    const retained = await retainedRuntime.exportArtifacts({
      artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
      maxBytes: 64,
    });

    const revokedValue = fixture();
    const revokedBackend = new FakeBackend();
    revokedBackend.artifacts = [
      { ref: 'result.json', sha256: HASH, bytes: 12, mediaType: 'application/json' },
    ];
    const revokedRuntime = runtime(revokedValue, revokedBackend, {
      artifactVerifier: () => false,
    });
    await start(revokedRuntime);
    const revoked = await revokedRuntime.exportArtifacts({
      artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
      maxBytes: 64,
    });

    const unverifiedValue = fixture();
    const unverifiedBackend = new FakeBackend();
    unverifiedBackend.artifacts = [
      { ref: 'result.json', sha256: HASH, bytes: 12, mediaType: 'application/json' },
    ];
    const unverifiedRuntime = runtime(unverifiedValue, unverifiedBackend, {
      artifactVerifier: () => false,
      artifactRevoker: () => false,
    });
    await start(unverifiedRuntime);
    const revokeUnverified = await unverifiedRuntime.exportArtifacts({
      artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
      maxBytes: 64,
    });

    for (const valid of [none, retained, revoked, revokeUnverified]) {
      expect(() => parse(valid)).not.toThrow();
    }
    expect(none.artifactDisposition).toBe('none');
    expect(retained.artifactDisposition).toBe('retained');
    expect(revoked.artifactDisposition).toBe('revoked');
    expect(revokeUnverified.artifactDisposition).toBe('revoke-unverified');

    const artifact = retained.artifacts[0];
    const invalidCases: Array<{
      name: string;
      base: DisposableEnvironmentReceipt;
      changes: Record<string, unknown>;
    }> = [
      { name: 'none-with-inventory', base: none, changes: { artifacts: [artifact] } },
      {
        name: 'none-with-verification',
        base: none,
        changes: { artifactProjectionSha256: [HASH] },
      },
      { name: 'none-with-revoke-proof', base: none, changes: { artifactRevokeSha256: HASH } },
      {
        name: 'none-with-identity-evidence',
        base: none,
        changes: { artifactIdentityEvidenceSha256: HASH },
      },
      { name: 'retained-non-export', base: retained, changes: { operation: 'provision' } },
      { name: 'retained-empty', base: retained, changes: { artifacts: [] } },
      {
        name: 'retained-wrong-proof-count',
        base: retained,
        changes: { artifactProjectionSha256: [] },
      },
      {
        name: 'retained-with-revoke-proof',
        base: retained,
        changes: { artifactRevokeSha256: HASH },
      },
      { name: 'revoked-non-export', base: revoked, changes: { operation: 'start' } },
      { name: 'revoked-without-proof', base: revoked, changes: { artifactRevokeSha256: null } },
      { name: 'revoked-empty', base: revoked, changes: { artifacts: [] } },
      {
        name: 'revoked-with-verification',
        base: revoked,
        changes: { artifactProjectionSha256: [HASH] },
      },
      {
        name: 'revoke-unverified-non-export',
        base: revokeUnverified,
        changes: { operation: 'execute' },
      },
      {
        name: 'revoke-unverified-with-proof',
        base: revokeUnverified,
        changes: { artifactRevokeSha256: HASH },
      },
      {
        name: 'revoke-unverified-without-inventory-or-evidence',
        base: revokeUnverified,
        changes: { artifacts: [], artifactIdentityEvidenceSha256: null },
      },
      {
        name: 'revoke-unverified-ambiguous-inventory-and-evidence',
        base: revokeUnverified,
        changes: { artifactIdentityEvidenceSha256: HASH },
      },
    ];
    for (const testCase of invalidCases) {
      expect(() => parse(rehash(testCase.base, testCase.changes)), testCase.name).toThrow(
        DisposableEnvironmentError,
      );
    }
  });

  it('rejects a rehashed non-export receipt that claims an unproved revoked disposition', async () => {
    const value = fixture();
    const receipt = await runtime(value, new FakeBackend()).provision();
    const { receiptSha256: _oldHash, ...payload } = receipt;
    expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
    const forgedPayload = {
      ...payload,
      artifactDisposition: 'revoked' as const,
      artifacts: [],
      artifactProjectionSha256: [],
      artifactRevokeSha256: null,
    };
    const forged = {
      ...forgedPayload,
      receiptSha256: hashDisposableEnvironmentPayload(forgedPayload),
    };
    expect(() =>
      parseDisposableEnvironmentReceipt(forged, {
        now: new Date(NOW),
        maxAgeMs: 60_000,
      }),
    ).toThrow(DisposableEnvironmentError);
  });

  it('requires operation-specific local success evidence and bounded parser time', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    backend.artifacts = [
      { ref: 'result.json', sha256: HASH, bytes: 12, mediaType: 'application/json' },
    ];
    const subject = runtime(value, backend);
    await start(subject);
    const executed = await subject.execute(command());
    const snapshot = await subject.snapshot({ ttlMs: 60_000 });
    const exported = await subject.exportArtifacts({
      artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
      maxBytes: 64,
    });
    const parseWithTime = parseDisposableEnvironmentReceipt as unknown as (
      input: unknown,
      options: { now: Date; maxAgeMs: number },
    ) => DisposableEnvironmentReceipt;
    for (const [receipt, changes] of [
      [executed, { metrics: null }],
      [snapshot, { snapshot: null }],
      [exported, { artifacts: [], artifactProjectionSha256: [] }],
    ] as const) {
      const { receiptSha256: _oldHash, ...payload } = receipt;
      expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
      const forgedPayload = { ...payload, ...changes };
      const forged = {
        ...forgedPayload,
        receiptSha256: hashDisposableEnvironmentPayload(forgedPayload),
      };
      expect(() => parseWithTime(forged, { now: new Date(NOW), maxAgeMs: 60_000 })).toThrow(
        DisposableEnvironmentError,
      );
    }

    const { receiptSha256: _oldHash, ...payload } = executed;
    expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
    const futurePayload = { ...payload, issuedAt: LATER };
    const future = {
      ...futurePayload,
      receiptSha256: hashDisposableEnvironmentPayload(futurePayload),
    };
    expect(() => parseWithTime(future, { now: new Date(NOW), maxAgeMs: 60_000 })).toThrow(
      DisposableEnvironmentError,
    );
    expect(() =>
      parseWithTime(executed, {
        now: new Date(Date.parse(NOW) + 60_001),
        maxAgeMs: 60_000,
      }),
    ).toThrow(DisposableEnvironmentError);
  });

  it('rejects every local-test receipt that claims PASS verification status', async () => {
    const value = fixture();
    const receipt = await runtime(value, new FakeBackend()).provision();
    expect(receipt).toMatchObject({
      status: 'UNVERIFIED',
      code: 'PROVISIONED',
      authority: 'local-test-only',
      hostIsolation: 'test-simulated',
      productionEligible: false,
    });
    const { receiptSha256: _oldHash, ...payload } = receipt;
    expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
    const passPayload = { ...payload, status: 'PASS' as const };
    const passReceipt = {
      ...passPayload,
      receiptSha256: hashDisposableEnvironmentPayload(passPayload),
    };
    expect(() => parseDisposableEnvironmentReceipt(passReceipt)).toThrow(
      DisposableEnvironmentError,
    );
  });

  it('rejects a rehashed local PASS with malformed time and all-zero structural proofs', async () => {
    const value = fixture();
    const receipt = await runtime(value, new FakeBackend()).provision();
    const { receiptSha256: _oldHash, ...payload } = receipt;
    expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
    const malformedPayload = {
      ...payload,
      status: 'PASS' as const,
      issuedAt: 'not-a-time',
      challengeSha256: '0'.repeat(64),
      attestationSha256: '0'.repeat(64),
      attestationProjectionSha256: '0'.repeat(64),
      backendResultSha256: '0'.repeat(64),
    };
    const malformed = {
      ...malformedPayload,
      receiptSha256: hashDisposableEnvironmentPayload(malformedPayload),
    };
    expect(() => parseDisposableEnvironmentReceipt(malformed)).toThrow(DisposableEnvironmentError);

    const missingProofPayload = { ...payload, challengeSha256: null };
    const missingProof = {
      ...missingProofPayload,
      receiptSha256: hashDisposableEnvironmentPayload(missingProofPayload),
    };
    expect(() => parseDisposableEnvironmentReceipt(missingProof)).toThrow(
      DisposableEnvironmentError,
    );
  });

  it('rejects rehashed production authority markers and never evaluates local evidence as eligible', async () => {
    const value = fixture();
    const receipt = await runtime(value, new FakeBackend()).provision();
    const { receiptSha256: _oldHash, ...payload } = receipt;
    expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
    const productionPayload = {
      ...payload,
      authority: 'production',
      hostIsolation: 'os-enforced',
      productionEligible: true,
    };
    const production = {
      ...productionPayload,
      receiptSha256: hashDisposableEnvironmentPayload(productionPayload),
    };
    expect(() => parseDisposableEnvironmentReceipt(production)).toThrow(DisposableEnvironmentError);
    expect(
      evaluateDisposableEnvironmentProductionEligibility(receipt, {
        now: new Date(NOW),
        maxAgeMs: 60_000,
      }),
    ).toEqual({
      schemaVersion: 'disposable-environment/v1',
      status: 'UNVERIFIED',
      eligible: false,
      reasonCode: 'LOCAL_TEST_EVIDENCE_NOT_PRODUCTION',
      receiptSha256: receipt.receiptSha256,
    });
  });

  it('rejects a correctly rehashed but semantically impossible success', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const receipt = await runtime(value, backend).provision();
    const { receiptSha256: _oldHash, ...payload } = receipt;
    expect(_oldHash).toMatch(/^[a-f0-9]{64}$/);
    const forgedPayload = {
      ...payload,
      operation: 'execute' as const,
      code: 'EXECUTED' as const,
      stateBefore: 'NEW' as const,
      stateAfter: 'TORN_DOWN' as const,
    };
    const forged = {
      ...forgedPayload,
      receiptSha256: hashDisposableEnvironmentPayload(forgedPayload),
    };
    expect(() => parseDisposableEnvironmentReceipt(forged)).toThrow(DisposableEnvironmentError);
  });

  it('requires operation-specific success evidence and rejects materially future receipts', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    const subject = runtime(value, backend);
    await start(subject);

    const executed = await subject.execute(command());
    expect(executed.code).toBe('EXECUTED');
    const { receiptSha256: executeHash, ...executePayload } = executed;
    expect(executeHash).toMatch(/^[a-f0-9]{64}$/);
    const missingMetricsPayload = { ...executePayload, metrics: null };
    expect(() =>
      parseDisposableEnvironmentReceipt({
        ...missingMetricsPayload,
        receiptSha256: hashDisposableEnvironmentPayload(missingMetricsPayload),
      }),
    ).toThrow(DisposableEnvironmentError);

    const snapshotted = await subject.snapshot({ ttlMs: 60_000 });
    expect(snapshotted.code).toBe('SNAPSHOT_CREATED');
    const { receiptSha256: snapshotHash, ...snapshotPayload } = snapshotted;
    expect(snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    const missingSnapshotPayload = { ...snapshotPayload, snapshot: null };
    expect(() =>
      parseDisposableEnvironmentReceipt({
        ...missingSnapshotPayload,
        receiptSha256: hashDisposableEnvironmentPayload(missingSnapshotPayload),
      }),
    ).toThrow(DisposableEnvironmentError);

    backend.artifacts = [
      { ref: 'result.json', sha256: HASH, bytes: 12, mediaType: 'application/json' },
    ];
    const exported = await subject.exportArtifacts({
      artifacts: [{ ref: 'result.json', mediaType: 'application/json' }],
      maxBytes: 64,
    });
    expect(exported.code).toBe('ARTIFACTS_EXPORTED');
    const { receiptSha256: exportHash, ...exportPayload } = exported;
    expect(exportHash).toMatch(/^[a-f0-9]{64}$/);
    const missingArtifactsPayload = {
      ...exportPayload,
      artifacts: [],
      artifactProjectionSha256: [],
    };
    expect(() =>
      parseDisposableEnvironmentReceipt({
        ...missingArtifactsPayload,
        receiptSha256: hashDisposableEnvironmentPayload(missingArtifactsPayload),
      }),
    ).toThrow(DisposableEnvironmentError);

    const futurePayload = { ...executePayload, issuedAt: '2099-01-01T00:00:00.000Z' };
    expect(() =>
      parseDisposableEnvironmentReceipt({
        ...futurePayload,
        receiptSha256: hashDisposableEnvironmentPayload(futurePayload),
      }),
    ).toThrow(DisposableEnvironmentError);
  });

  it('never exposes provider or callback errors in stable receipts', async () => {
    const value = fixture();
    const backend = new FakeBackend();
    backend.provisionHook = () => {
      throw new Error('Bearer super-secret-provider-value');
    };
    const receipt = await runtime(value, backend).provision();
    expect(receipt).toMatchObject({ status: 'BLOCKED', code: 'BACKEND_OPERATION_FAILED' });
    expect(JSON.stringify(receipt)).not.toContain('super-secret-provider-value');
  });
});
