import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  EnvironmentAci,
  EnvironmentScenario,
  EnvironmentScenarioReceipt,
  HostEnvironmentCapability,
  createEnvironmentAciDescriptor,
  createEnvironmentAction,
  createEnvironmentActionResult,
  createEnvironmentEvidenceReceipt,
  createEnvironmentObservation,
  createEnvironmentScenarioReceipt,
  hashEnvironmentAciPayload,
} from './environment-aci.js';
import { ProductIntentCreateInput, createProductIntent } from './product-intent.js';
import {
  ProductOutcomeContractInput,
  createProductOutcomeContract,
  hashProductOutcomePayload,
} from './product-outcome-contract.js';
import { createCriticalJourneyRunner } from './product-outcome-runner.js';
import { judgeProductOutcome } from './product-outcome-judge.js';
import { createEmptyLearningRegistry } from './learning-foundry.js';
import {
  DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST,
  DISPOSABLE_LOCAL_TEST_RECONCILER_DIGEST,
  ArtifactDiscardProjection,
  AttestationChallenge,
  BackendAttestation,
  BackendExecuteRequest,
  BackendExecuteResult,
  BackendExportRequest,
  BackendExportResult,
  BackendProvisionRequest,
  BackendProvisionResult,
  BackendRestoreRequest,
  BackendRestoreResult,
  BackendSnapshotRequest,
  BackendSnapshotResult,
  BackendStartRequest,
  BackendStartResult,
  BackendTeardownRequest,
  BackendTeardownResult,
  DisposableArtifact,
  DisposableEnvironmentBackend,
  DisposableEnvironmentReceipt,
  DisposableEnvironmentRuntime,
  NetworkConnectionReceipt,
  createArtifactDiscardProjection,
  createArtifactVerificationProjection,
  createAttestationVerificationProjection,
  createBackendAttestation,
  createDisposableEnvironmentPolicy,
  createDisposableEnvironmentRegistry,
  createDisposableWorkspace,
  createFilesystemProjection,
  createLocalTestDisposableHostCapabilityFactory,
  createNetworkResolutionProjection,
  createTeardownReconciliationProjection,
  hashDisposableEnvironmentPayload,
} from './disposable-environment.js';
import {
  PRODUCT_FACTORY_RELEASE_MAX_BYTES,
  ProductFactoryReleaseCandidate,
  ProductFactoryReleaseEvaluationContext,
  ProductFactoryReleaseValidationError,
  createProductFactoryAttempt,
  createProductFactoryReference,
  createProductFactoryReleaseCandidate,
  evaluateProductFactoryRelease,
  hashProductFactoryReleasePayload,
  parseProductFactoryReleaseDecision,
} from './product-factory-release.js';

const NOW = '2026-09-05T12:00:00.000Z';
const REQUESTED = '2026-09-05T10:00:00.000Z';
const JUDGED = '2026-09-05T10:30:00.000Z';
const DEADLINE = '2026-09-05T11:00:00.000Z';
const EXPIRES = '2026-09-06T12:00:00.000Z';
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LANES = ['web', 'mobile', 'game'] as const;
const KINDS = { web: 'web', mobile: 'android', game: 'unity' } as const;
const PLATFORMS = { web: 'web', mobile: 'mobile', game: 'game' } as const;
const ACTIONS = {
  web: { kind: 'click', payload: { target: 'confirm' } },
  mobile: { kind: 'tap', payload: { target: 'confirm' } },
  game: { kind: 'invoke', payload: { target: 'controller', command: 'confirm', args: {} } },
} as const;
const GATES = ['engineering', 'security', 'visual', 'runtime', 'release', 'rollback'] as const;
const OPERATIONS = {
  observe: true,
  act: true,
  reset: true,
  snapshot: true,
  restore: true,
  runScenario: true,
  collectEvidence: true,
} as const;
const digest = (value: unknown): string => hashProductFactoryReleasePayload(value);
const fixtureDigest = (value: string): string => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
let fixtureOrdinal = 0;
const fixtureRoots = new Set<string>();
afterEach(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
  fixtureRoots.clear();
});
const SECURITY_PROBES = [
  'path-containment',
  'secret-access',
  'private-egress',
  'stale-snapshot',
  'resource-quota',
] as const;
type SecurityProbeKind = (typeof SECURITY_PROBES)[number];

interface FixtureOptions {
  artifactMismatchLane?: (typeof LANES)[number];
  failOutcomeLane?: (typeof LANES)[number];
  failRuntimeLane?: (typeof LANES)[number];
  orphanLane?: (typeof LANES)[number];
  subjectiveGame?: boolean;
  twoWebAttempts?: boolean;
}

class CanonicalScenarioAci implements EnvironmentAci {
  receipt: EnvironmentScenarioReceipt | undefined;

  constructor(
    private readonly descriptor: ReturnType<typeof createEnvironmentAciDescriptor>,
    private readonly artifactSha256: string,
    private readonly failScenario: boolean,
  ) {}

  async runScenario(scenario: EnvironmentScenario): Promise<EnvironmentScenarioReceipt> {
    const reset = createEnvironmentObservation({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: scenario.adapterId,
      environmentId: scenario.environmentId,
      sessionId: scenario.sessionId,
      scenarioId: scenario.scenarioId,
      executionId: scenario.executionId,
      sequence: 1,
      requestedAt: scenario.requestedAt,
      afterActionId: null,
      observedAt: scenario.requestedAt,
      state: { confirmed: false },
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
    const action = createEnvironmentAction({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: scenario.adapterId,
      environmentId: scenario.environmentId,
      sessionId: scenario.sessionId,
      scenarioId: scenario.scenarioId,
      executionId: scenario.executionId,
      sequence: 2,
      requestedAt: scenario.requestedAt,
      ...scenario.steps[0]!,
    });
    const actionResult = createEnvironmentActionResult({
      ...action,
      completedAt: scenario.requestedAt,
      status: this.failScenario ? 'FAIL' : 'PASS',
      reason: this.failScenario ? 'canonical-action-failure' : null,
      negativePaths: this.failScenario ? ['canonical-action-failure'] : [],
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
    const observation = this.failScenario
      ? null
      : createEnvironmentObservation({
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          adapterId: scenario.adapterId,
          environmentId: scenario.environmentId,
          sessionId: scenario.sessionId,
          scenarioId: scenario.scenarioId,
          executionId: scenario.executionId,
          sequence: 3,
          requestedAt: scenario.requestedAt,
          afterActionId: action.actionId,
          observedAt: scenario.requestedAt,
          state: { confirmed: true },
          limitations: [],
          environmentFingerprint: this.descriptor.environmentFingerprint,
        });
    const evidence = observation
      ? createEnvironmentEvidenceReceipt({
          schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
          adapterId: scenario.adapterId,
          environmentId: scenario.environmentId,
          sessionId: scenario.sessionId,
          scenarioId: scenario.scenarioId,
          executionId: scenario.executionId,
          actionId: action.actionId,
          sequence: 4,
          requestedAt: scenario.requestedAt,
          actionSha256: action.actionSha256,
          observationSha256: observation.observationSha256,
          collectedAt: scenario.requestedAt,
          status: 'PASS',
          reason: null,
          negativePaths: [],
          limitations: [],
          artifacts: [
            {
              ref: 'evidence/product.json',
              sha256: this.artifactSha256,
              bytes: 128,
              mediaType: 'application/json',
            },
          ],
          environmentFingerprint: this.descriptor.environmentFingerprint,
        })
      : null;
    const cleanupSequence = this.failScenario ? 3 : 5;
    const cleanup = createEnvironmentObservation({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: scenario.adapterId,
      environmentId: scenario.environmentId,
      sessionId: scenario.sessionId,
      scenarioId: scenario.scenarioId,
      executionId: scenario.executionId,
      sequence: cleanupSequence,
      requestedAt: scenario.requestedAt,
      afterActionId: null,
      observedAt: scenario.requestedAt,
      state: { confirmed: false },
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
    this.receipt = createEnvironmentScenarioReceipt({
      ...scenario,
      status: this.failScenario ? 'FAIL' : 'PASS',
      reason: this.failScenario ? 'canonical-action-failure' : null,
      negativePaths: this.failScenario ? ['canonical-action-failure'] : [],
      limitations: [],
      startedAt: scenario.requestedAt,
      completedAt: scenario.requestedAt,
      sequence: cleanupSequence,
      resetObservation: reset,
      actions: [action],
      actionResults: [actionResult],
      observations: observation ? [observation] : [],
      evidence: evidence ? [evidence] : [],
      cleanupObservation: cleanup,
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
    return this.receipt;
  }

  observe(): never {
    throw new Error('not used');
  }
  act(): never {
    throw new Error('not used');
  }
  reset(): never {
    throw new Error('not used');
  }
  snapshot(): never {
    throw new Error('not used');
  }
  restore(): never {
    throw new Error('not used');
  }
  collectEvidence(): never {
    throw new Error('not used');
  }
}

function intentInput(lane: (typeof LANES)[number], ordinal: number): ProductIntentCreateInput {
  return {
    intentId: `intent-${lane}-${ordinal}`,
    createdAt: REQUESTED,
    problem: {
      id: `problem-${lane}-${ordinal}`,
      statement: 'A reference product needs an observable outcome.',
      evidenceRefs: [],
    },
    targetActors: [
      {
        id: `actor-${lane}-${ordinal}`,
        name: 'Reference user',
        description: 'A target user exercising the reference product.',
        evidenceRefs: [],
      },
    ],
    jobsToBeDone: [
      {
        id: `job-${lane}-${ordinal}`,
        actorIds: [`actor-${lane}-${ordinal}`],
        statement: 'Complete the critical journey.',
        desiredOutcomeIds: [`outcome-${lane}-${ordinal}`],
      },
    ],
    desiredOutcomes: [
      {
        id: `outcome-${lane}-${ordinal}`,
        statement: 'The critical journey completes.',
        acceptanceRefs: [`accept-${lane}-${ordinal}`],
      },
    ],
    constraints: [],
    nonGoals: [],
    preferences: [],
    scenarios: [
      {
        id: `scenario-${lane}-${ordinal}`,
        name: `${lane} critical journey`,
        platform: PLATFORMS[lane],
        actorIds: [`actor-${lane}-${ordinal}`],
        jobIds: [`job-${lane}-${ordinal}`],
        outcomeIds: [`outcome-${lane}-${ordinal}`],
        preconditions: [],
        steps: ['Confirm the product outcome.'],
        expectedOutcomes: ['Confirmation is observable.'],
      },
    ],
    uncertainty: [],
    decisions: [],
    acceptanceRefs: [
      {
        id: `accept-${lane}-${ordinal}`,
        statement: 'Confirmation is observable.',
        evidenceRef: null,
      },
    ],
    provenance: [
      {
        id: `source-${lane}-${ordinal}`,
        source: 'current-explicit-user',
        reference: 'Current release requirement.',
        observedAt: REQUESTED,
        current: true,
        approved: true,
      },
    ],
    goalGraph: {
      nodes: [
        {
          id: `goal-outcome-${lane}-${ordinal}`,
          type: 'outcome',
          statement: 'Critical journey completes.',
          intentRef: `outcome-${lane}-${ordinal}`,
        },
        {
          id: `goal-capability-${lane}-${ordinal}`,
          type: 'capability',
          statement: 'Reference capability exists.',
          intentRef: null,
        },
        {
          id: `goal-scenario-${lane}-${ordinal}`,
          type: 'scenario',
          statement: 'Critical journey is exercised.',
          intentRef: `scenario-${lane}-${ordinal}`,
        },
      ],
      edges: [
        {
          id: `edge-outcome-${lane}-${ordinal}`,
          from: `goal-outcome-${lane}-${ordinal}`,
          to: `goal-capability-${lane}-${ordinal}`,
        },
        {
          id: `edge-scenario-${lane}-${ordinal}`,
          from: `goal-capability-${lane}-${ordinal}`,
          to: `goal-scenario-${lane}-${ordinal}`,
        },
      ],
    },
  };
}

async function canonicalOutcome(
  lane: (typeof LANES)[number],
  ordinal: number,
  artifactSha256: string,
  failScenario: boolean,
) {
  const intent = createProductIntent(intentInput(lane, ordinal));
  const descriptor = createEnvironmentAciDescriptor({
    adapterId: `adapter-${lane}-${ordinal}`,
    environmentId: `environment-${lane}-${ordinal}`,
    sessionId: `session-${lane}-${ordinal}`,
    kind: KINDS[lane],
    operationTimeoutMs: 500,
    operations: OPERATIONS,
    actionKinds: [ACTIONS[lane].kind],
    environment: { lane, fixture: ordinal },
  });
  const scenarioId = intent.scenarios[0]!.id;
  const outcomeId = intent.desiredOutcomes[0]!.id;
  const contractInput: ProductOutcomeContractInput = {
    contractId: `contract-${lane}-${ordinal}`,
    intent: { intentId: intent.intentId, version: intent.version, hash: intent.hash },
    desiredOutcomeIds: [outcomeId],
    scenarioIds: [scenarioId],
    environment: {
      adapterId: descriptor.adapterId,
      environmentId: descriptor.environmentId,
      sessionId: descriptor.sessionId,
      kind: descriptor.kind,
      environmentFingerprint: descriptor.environmentFingerprint,
      capabilityFingerprint: descriptor.capabilityFingerprint,
    },
    evidenceAuthority: 'test-only',
    syntheticUser: false,
    journeys: [
      {
        scenarioId,
        desiredOutcomeIds: [outcomeId],
        applicable: true,
        runnable: true,
        stateReason: null,
        actions: [{ actionId: `action-${lane}-${ordinal}`, ...ACTIONS[lane] }],
        assertions: [
          {
            id: `assert-${lane}-${ordinal}`,
            category: 'requirement',
            subject: {
              kind: 'observation',
              actionId: `action-${lane}-${ordinal}`,
              path: ['confirmed'],
            },
            expected: { kind: 'boolean', operator: 'equals', value: true },
          },
        ],
        requiredEvidence: [
          {
            id: `evidence-${lane}-${ordinal}`,
            actionId: `action-${lane}-${ordinal}`,
            mediaTypes: ['application/json'],
            minimumArtifacts: 1,
          },
        ],
        negativePaths: ['canonical-action-failure'],
        limitations: [],
      },
    ],
  };
  const contract = createProductOutcomeContract(contractInput, intent, descriptor);
  const host: HostEnvironmentCapability = {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    enabled: true,
    environmentFingerprint: descriptor.environmentFingerprint,
    capabilityFingerprint: descriptor.capabilityFingerprint,
    operationTimeoutMs: descriptor.operationTimeoutMs,
    operations: OPERATIONS,
    reason: null,
    limitations: [],
  };
  const executionId = `execution-${lane}-${ordinal}-${failScenario ? 'fail' : 'pass'}`;
  const expectedScenario: EnvironmentScenario = {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: descriptor.adapterId,
    environmentId: descriptor.environmentId,
    sessionId: descriptor.sessionId,
    scenarioId,
    executionId,
    requestedAt: REQUESTED,
    deadlineAt: DEADLINE,
    steps: [{ actionId: `action-${lane}-${ordinal}`, ...ACTIONS[lane] }],
  };
  const aci = new CanonicalScenarioAci(descriptor, artifactSha256, failScenario);
  const result = await createCriticalJourneyRunner(aci, descriptor, host).run({
    contract,
    intent,
    scenarioId,
    executionId,
    requestedAt: REQUESTED,
    deadlineAt: DEADLINE,
  });
  if (!aci.receipt) throw new Error('Canonical scenario receipt was not produced.');
  const resultVerification = { contract, intent, expectedScenario, scenarioReceipt: aci.receipt };
  const specialistReceipts: unknown[] = [];
  const judgment = await judgeProductOutcome({
    runnerResult: result,
    runnerVerification: resultVerification,
    specialistReceipts,
    judgedAt: JUDGED,
  });
  return {
    descriptor,
    intent,
    contract,
    proof: { result, resultVerification, judgment, specialistReceipts, judgedAt: JUDGED },
  };
}

type DisposableRequest =
  | BackendProvisionRequest
  | BackendStartRequest
  | BackendExecuteRequest
  | BackendSnapshotRequest
  | BackendRestoreRequest
  | BackendExportRequest
  | BackendTeardownRequest;

class CanonicalDisposableBackend implements DisposableEnvironmentBackend {
  readonly backendId: string;
  readonly runtimeId: string;
  readonly calls: DisposableRequest[] = [];

  constructor(
    lane: (typeof LANES)[number],
    private readonly artifact: DisposableArtifact,
    private readonly failExecute: boolean,
    private readonly orphanProcesses: number,
    private readonly cpuMillis = 10,
  ) {
    this.backendId = `backend-${lane}`;
    this.runtimeId = `runtime-${lane}`;
  }

  async provision(request: BackendProvisionRequest): Promise<BackendProvisionResult> {
    this.calls.push(request);
    return {
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      runtimeHandle: 'runtime-handle',
      rootRef: 'isolated/root',
      filesystemConsumeToken: request.filesystemProjection?.projectionSha256 ?? null,
    };
  }
  async start(request: BackendStartRequest): Promise<BackendStartResult> {
    this.calls.push(request);
    return {
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      ready: true,
    };
  }
  async execute(request: BackendExecuteRequest): Promise<BackendExecuteResult> {
    this.calls.push(request);
    return {
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      exitCode: this.failExecute ? 1 : 0,
      cpuMillis: this.cpuMillis,
      peakMemoryBytes: 1_024,
      peakPids: 1,
      outputBytes: 16,
      diskBytes: 128,
      outputSha256: fixtureDigest(`output-${request.environmentId}`),
      connections: request.networkDestinations.map((destination): NetworkConnectionReceipt => ({
        protocol: destination.protocol,
        hostname: destination.hostname,
        port: destination.port,
        connectedIp: destination.chosenIp,
        pinToken: destination.pinToken,
        resolutionSha256: destination.resolutionSha256,
      })),
    };
  }
  async snapshot(request: BackendSnapshotRequest): Promise<BackendSnapshotResult> {
    this.calls.push(request);
    return {
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      snapshotId: 'unused-snapshot',
      snapshotRef: 'snapshots/unused.bin',
      snapshotBytes: 1,
      snapshotMediaType: 'application/octet-stream',
      stateSha256: fixtureDigest('unused-snapshot'),
    };
  }
  async restore(request: BackendRestoreRequest): Promise<BackendRestoreResult> {
    this.calls.push(request);
    return {
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      restoredStateSha256: request.snapshot.stateSha256,
    };
  }
  async exportArtifacts(request: BackendExportRequest): Promise<BackendExportResult> {
    this.calls.push(request);
    return {
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      artifacts: [this.artifact],
    };
  }
  async teardown(request: BackendTeardownRequest): Promise<BackendTeardownResult> {
    this.calls.push(request);
    return {
      environmentId: request.environmentId,
      operationSequence: request.operationSequence,
      generation: request.generation,
      orphanProcesses: this.orphanProcesses,
      mountedFilesystems: 0,
      networkLeases: 0,
    };
  }
}

function issueAttestation(challenge: AttestationChallenge): BackendAttestation {
  return createBackendAttestation({
    attestationId: `attestation-${challenge.environmentId}-${challenge.operationSequence}`,
    issuerId: 'local-test-issuer',
    verifierId: 'local-test-verifier',
    verifierDigest: DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST,
    reconcilerId: 'local-test-reconciler',
    reconcilerDigest: DISPOSABLE_LOCAL_TEST_RECONCILER_DIGEST,
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
    projectionId: `attestation-proof-${challenge.environmentId}-${challenge.operationSequence}`,
    attestationSha256: attestation.attestationSha256,
    verifierId: 'local-test-verifier',
    verifierDigest: DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST,
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

async function canonicalDisposableReceipts(
  lane: (typeof LANES)[number],
  environmentId: string,
  artifactSha256: string,
  options: FixtureOptions,
  probeKind?: SecurityProbeKind,
): Promise<DisposableEnvironmentReceipt[]> {
  const root = mkdtempSync(join(tmpdir(), `pf7-${lane}-`));
  fixtureRoots.add(root);
  mkdirSync(join(root, 'readonly'));
  mkdirSync(join(root, 'work'));
  mkdirSync(join(root, 'work', 'mounts'));
  writeFileSync(join(root, 'readonly', 'input.txt'), 'immutable');
  const workspace = createDisposableWorkspace({ workspaceId: `workspace-${lane}`, root });
  const policy = createDisposableEnvironmentPolicy({
    policyId: `policy-${lane}`,
    capabilities: {
      filesystem: {
        enabled: true,
        readOnlyPaths: ['readonly'],
        writablePaths: ['work'],
        mounts: [
          {
            mountId: `input-${lane}`,
            sourceRef: 'readonly/input.txt',
            targetRef: 'work/mounts/input.txt',
            sourceSha256: fixtureDigest('immutable'),
            access: 'read-only',
          },
        ],
      },
      network: { enabled: probeKind !== undefined, egressAllowlist: [] },
      process: {
        enabled: true,
        allowedExecutables: ['node'],
        environmentAllowlist: { CI: 'true' },
        childProcesses: 'deny',
        maxArgCount: 8,
        maxArgBytes: 1_024,
      },
      secret: { enabled: probeKind !== undefined, allowedHandles: [] },
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
  const backendArtifactSha256 =
    options.artifactMismatchLane === lane
      ? fixtureDigest(`wrong-artifact-${lane}`)
      : artifactSha256;
  const backend = new CanonicalDisposableBackend(
    lane,
    {
      ref: 'product.json',
      sha256: backendArtifactSha256,
      bytes: 128,
      mediaType: 'application/json',
    },
    options.failRuntimeLane === lane,
    options.orphanLane === lane ? 1 : 0,
    probeKind === 'resource-quota' ? 101 : 10,
  );
  const registry = createDisposableEnvironmentRegistry({
    registryId: `registry-${lane}-${randomUUID()}`,
  });
  const capability = createLocalTestDisposableHostCapabilityFactory().mint({
    capabilityId: `capability-${lane}`,
    backendId: backend.backendId,
    runtimeId: backend.runtimeId,
    capabilitySha256: policy.capabilitySha256,
    issuedAt: NOW,
    expiresAt: EXPIRES,
  });
  const runtime = new DisposableEnvironmentRuntime({
    environmentId,
    backend,
    registry,
    hostCapability: capability,
    policy,
    workspace,
    attestationProvider: issueAttestation,
    attestationProjectionVerifier: projectAttestation,
    filesystemProjectionVerifier: (input) => createFilesystemProjection(input),
    networkProjectionVerifier: (destination) =>
      createNetworkResolutionProjection({
        projectionId: `network-${lane}`,
        verifierId: 'local-test-verifier',
        verifierDigest: DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST,
        destination,
        firstResolution: ['93.184.216.34'],
        secondResolution: ['93.184.216.34'],
        chosenIp: '93.184.216.34',
        pinToken: `pin-${lane}`,
        verifiedAt: NOW,
        expiresAt: EXPIRES,
      }),
    artifactVerifier: (artifacts, expected) =>
      artifacts.map((artifact, index) =>
        createArtifactVerificationProjection({
          projectionId: `artifact-${lane}-${index}`,
          verifierId: 'local-test-verifier',
          verifierDigest: DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST,
          ref: artifact.ref,
          mediaType: expected[index]!.mediaType,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
          fileIdentity: `file-${lane}-${index}`,
          verifiedAt: NOW,
        }),
      ),
    artifactRevoker: (artifacts, exportResultSha256): ArtifactDiscardProjection =>
      createArtifactDiscardProjection({
        projectionId: `discard-${lane}`,
        verifierId: 'local-test-verifier',
        verifierDigest: DISPOSABLE_LOCAL_TEST_VERIFIER_DIGEST,
        exportResultSha256,
        discardedRefs: artifacts.map(({ ref }) => ref),
        discardedAt: NOW,
      }),
    teardownReconciler: (input) => createTeardownReconciliationProjection(input),
    now: () => new Date(NOW),
  });
  const receipts = [await runtime.provision(), await runtime.start()];
  if (probeKind !== undefined) {
    // Exercise the canonical runtime; never hand-author a negative receipt.
    // Each probe owns a separate simulated runtime, preserving lifecycle sequencing.
    const command = {
      argv: ['node', '--version'],
      cwd: 'work',
      environmentKeys: ['CI'],
      secretHandles: [] as string[],
      networkDestinations: [],
    };
    let receipt: DisposableEnvironmentReceipt;
    try {
      switch (probeKind) {
        case 'path-containment':
          receipt = await runtime.execute({ ...command, cwd: '../outside' });
          break;
        case 'secret-access':
          receipt = await runtime.execute({ ...command, secretHandles: ['unapproved-handle'] });
          break;
        case 'private-egress':
          receipt = await runtime.execute({
            ...command,
            networkDestinations: [{ protocol: 'https', hostname: '127.0.0.1', port: 443 }],
          });
          break;
        case 'stale-snapshot': {
          const captured = await runtime.snapshot({ ttlMs: 60_000 });
          if (captured.snapshot === null) {
            throw new Error(
              `Canonical snapshot was not produced: ${captured.code}; lifecycle=${receipts.map(({ code }) => code).join(',')}`,
            );
          }
          await runtime.execute(command);
          receipt = await runtime.restore(captured.snapshot);
          break;
        }
        case 'resource-quota':
          receipt = await runtime.execute(command);
          break;
      }
      return [receipt];
    } finally {
      await runtime.teardown();
    }
  }
  receipts.push(
    await runtime.execute({
      argv: ['node', '--version'],
      cwd: 'work',
      environmentKeys: ['CI'],
      secretHandles: [],
      networkDestinations: [],
    }),
  );
  receipts.push(
    await runtime.exportArtifacts({
      artifacts: [{ ref: 'product.json', mediaType: 'application/json' }],
      maxBytes: 256,
    }),
  );
  receipts.push(await runtime.teardown());
  return receipts;
}

function subjectiveBoundary(lane: (typeof LANES)[number], unresolved: boolean) {
  const none = { status: 'not-applicable' as const, evidenceSha256: null };
  const reviewed = { status: 'human-reviewed' as const, evidenceSha256: digest(`${lane}-review`) };
  const open = { status: 'unresolved' as const, evidenceSha256: null };
  return lane === 'game'
    ? {
        fun: unresolved ? open : reviewed,
        taste: reviewed,
        commercialAppeal: reviewed,
        userResearch: reviewed,
      }
    : { fun: none, taste: none, commercialAppeal: none, userResearch: reviewed };
}

async function fixture(options: FixtureOptions = {}): Promise<ProductFactoryReleaseCandidate> {
  const ordinal = fixtureOrdinal++;
  const candidateId = `candidate-${ordinal}`;
  const sourceRevisionSha256 = digest(`source-${ordinal}`);
  const artifacts = Object.fromEntries(
    LANES.map((lane) => [lane, fixtureDigest(`artifact-${lane}-${ordinal}`)]),
  ) as Record<(typeof LANES)[number], string>;
  const outcomeRecords = await Promise.all(
    LANES.map((lane) =>
      canonicalOutcome(lane, ordinal, artifacts[lane], options.failOutcomeLane === lane),
    ),
  );
  const references = outcomeRecords.map((record, index) => {
    const lane = LANES[index]!;
    return createProductFactoryReference({
      lane,
      productId: `reference-${lane}-${ordinal}`,
      sourceRevisionSha256,
      artifactSha256: artifacts[lane],
      intentId: record.intent.intentId,
      intentVersion: record.intent.version,
      intentHash: record.intent.hash,
      lockedIntentSha256: digest({
        schemaVersion: 'locked-intent-projection/v2',
        intentId: record.intent.intentId,
        intentVersion: record.intent.version,
        intentHash: record.intent.hash,
      }),
      acceptanceContractSha256: record.contract.contractSha256,
      scenarioId: record.intent.scenarios[0]!.id,
      aciDescriptor: record.descriptor,
      maintainedAt: '2026-09-01T00:00:00.000Z',
      maintenanceExpiresAt: '2026-10-01T00:00:00.000Z',
      subjectiveBoundary: subjectiveBoundary(lane, options.subjectiveGame === true),
    });
  });
  const attemptGroups = await Promise.all(
    references.map(async (reference, index) => {
      const record = outcomeRecords[index]!;
      const lane = reference.lane;
      if (lane !== 'web' || !options.twoWebAttempts) {
        return {
          lane,
          referenceSha256: reference.referenceSha256,
          attempts: [
            createProductFactoryAttempt({
              referenceSha256: reference.referenceSha256,
              attemptId: `attempt-${lane}-${ordinal}-0`,
              index: 0,
              previousAttemptSha256: null,
              sourceRevisionSha256,
              artifactSha256: reference.artifactSha256,
              lockedIntentSha256: reference.lockedIntentSha256,
              acceptanceContractSha256: reference.acceptanceContractSha256,
              scenarioId: reference.scenarioId,
              revisionDelta: null,
              outcomeProof: record.proof,
              failureEvidenceSha256:
                record.proof.result.status === 'FAIL' ? record.proof.result.resultSha256 : null,
            }),
          ],
        };
      }
      const failedArtifact = fixtureDigest(`failed-web-artifact-${ordinal}`);
      // Retry the same locked intent/contract, not another fixture's identity.
      const failed = await canonicalOutcome(lane, ordinal, failedArtifact, true);
      const first = createProductFactoryAttempt({
        referenceSha256: reference.referenceSha256,
        attemptId: `attempt-web-${ordinal}-0`,
        index: 0,
        previousAttemptSha256: null,
        sourceRevisionSha256: digest(`failed-source-${ordinal}`),
        artifactSha256: failedArtifact,
        lockedIntentSha256: reference.lockedIntentSha256,
        acceptanceContractSha256: reference.acceptanceContractSha256,
        scenarioId: reference.scenarioId,
        revisionDelta: null,
        outcomeProof: failed.proof,
        failureEvidenceSha256: failed.proof.result.resultSha256,
      });
      const deltaCore = {
        schemaVersion: 'release-revision-delta/v2' as const,
        failureAttemptSha256: first.attemptSha256,
        failureEvidenceSha256: first.failureEvidenceSha256!,
        baseArtifactSha256: first.artifactSha256,
        targetArtifactSha256: reference.artifactSha256,
        lockedIntentSha256: reference.lockedIntentSha256,
        intentHashBefore: reference.intentHash,
        intentHashAfter: reference.intentHash,
        acceptanceContractSha256: reference.acceptanceContractSha256,
        intentChanged: false as const,
        authorizedScope: 'implementation-correction' as const,
      };
      const second = createProductFactoryAttempt({
        referenceSha256: reference.referenceSha256,
        attemptId: `attempt-web-${ordinal}-1`,
        index: 1,
        previousAttemptSha256: first.attemptSha256,
        sourceRevisionSha256,
        artifactSha256: reference.artifactSha256,
        lockedIntentSha256: reference.lockedIntentSha256,
        acceptanceContractSha256: reference.acceptanceContractSha256,
        scenarioId: reference.scenarioId,
        revisionDelta: { ...deltaCore, deltaSha256: digest(deltaCore) },
        outcomeProof: record.proof,
        failureEvidenceSha256: null,
      });
      return { lane, referenceSha256: reference.referenceSha256, attempts: [first, second] };
    }),
  );
  const isolation = await Promise.all(
    references.map(async (reference) => {
      const core = {
        schemaVersion: 'release-isolation-evidence/v2' as const,
        lane: reference.lane,
        referenceSha256: reference.referenceSha256,
        receipts: await canonicalDisposableReceipts(
          reference.lane,
          recordForLane(outcomeRecords, reference.lane).descriptor.environmentId,
          reference.artifactSha256,
          options,
        ),
        securityProbes: await Promise.all(
          SECURITY_PROBES.map(async (kind) => ({
            kind,
            receipt: (
              await canonicalDisposableReceipts(
                reference.lane,
                `${recordForLane(outcomeRecords, reference.lane).descriptor.environmentId}-${kind}`,
                reference.artifactSha256,
                {},
                kind,
              )
            )[0]!,
          })),
        ),
      };
      return { ...core, evidenceSha256: digest(core) };
    }),
  );
  const gateGroups = references.map((reference) => ({
    lane: reference.lane,
    referenceSha256: reference.referenceSha256,
    gates: GATES.map((category) => {
      const core = {
        schemaVersion: 'release-gate-reference/v2' as const,
        lane: reference.lane,
        referenceSha256: reference.referenceSha256,
        category,
        applicable: true,
        evidenceRefSha256: digest(`${reference.lane}-${category}-${ordinal}`),
      };
      return { ...core, gateSha256: digest(core) };
    }),
  }));
  const forgeBenchReference = {
    schemaVersion: 'release-forgebench-reference/v2' as const,
    comparisonSha256: digest(`comparison-${ordinal}`),
    capturedAt: NOW,
  };
  const learningEvidence = {
    schemaVersion: 'release-learning-evidence/v2' as const,
    registry: createEmptyLearningRegistry(`pf7-registry-${ordinal}`),
    promotions: [],
    rollbacks: [],
  };
  return createProductFactoryReleaseCandidate({
    candidateId,
    evaluationId: `evaluation-${ordinal}`,
    implementerId: `implementer-${ordinal}`,
    evidenceNonce: `evidence-${randomUUID()}`,
    sourceRevisionSha256,
    createdAt: NOW,
    expiresAt: EXPIRES,
    references,
    attemptGroups: attemptGroups.map((group) => ({
      ...group,
      attempts: group.attempts.map((attempt) => ({
        ...attempt,
        outcomeProof: {
          ...attempt.outcomeProof,
          specialistReceipts: [...attempt.outcomeProof.specialistReceipts],
        },
      })),
    })),
    forgeBenchReference,
    learningEvidence,
    isolation,
    gateGroups,
  });
}

function recordForLane<T>(records: readonly T[], lane: (typeof LANES)[number]): T {
  return records[LANES.indexOf(lane)]!;
}

function context(date: Date = new Date(NOW)): ProductFactoryReleaseEvaluationContext {
  return { now: date, receiptMaxAgeMs: RECEIPT_MAX_AGE_MS };
}

function candidateInput(candidate: ProductFactoryReleaseCandidate) {
  return Object.fromEntries(
    Object.entries(candidate).filter(
      ([key]) => !['schemaVersion', 'candidateSha256'].includes(key),
    ),
  );
}

function rehashCandidate(
  candidate: ProductFactoryReleaseCandidate,
): ProductFactoryReleaseCandidate {
  const hashable = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => key !== 'candidateSha256'),
  );
  return { ...candidate, candidateSha256: digest(hashable) };
}

function rehashAttempt(
  candidate: ProductFactoryReleaseCandidate,
  laneIndex: number,
  attemptIndex: number,
) {
  const attempt = candidate.attemptGroups[laneIndex]!.attempts[attemptIndex]!;
  attempt.attemptSha256 = digest(
    Object.fromEntries(Object.entries(attempt).filter(([key]) => key !== 'attemptSha256')),
  );
  candidate.candidateSha256 = rehashCandidate(candidate).candidateSha256;
}

describe('PF7 canonical release-readiness evidence', () => {
  it('keeps canonical local evidence UNVERIFIED with no production activation path', async () => {
    const candidate = await fixture();
    const decision = await evaluateProductFactoryRelease(candidate, context());
    expect(candidate.references.map(({ lane }) => lane)).toEqual(LANES);
    expect(decision).toMatchObject({ status: 'UNVERIFIED', activationEligible: false });
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'production-authority-unavailable',
        'forgebench-upstream-unverified',
        'gates-upstream-unverified',
        'isolation-local-test-only',
      ]),
    );
    expect('verifyOutcomeProjection' in context()).toBe(false);
    for (const isolation of candidate.isolation) {
      expect(
        isolation.securityProbes.map(({ kind, receipt }) => [kind, receipt.status, receipt.code]),
      ).toEqual([
        ['path-containment', 'FAIL', 'PATH_NOT_CONTAINED'],
        ['secret-access', 'FAIL', 'SECRET_HANDLE_NOT_ALLOWED'],
        ['private-egress', 'FAIL', 'EGRESS_PRIVATE_DESTINATION'],
        ['stale-snapshot', 'FAIL', 'SNAPSHOT_STALE'],
        ['resource-quota', 'BLOCKED', 'RESOURCE_QUOTA_EXCEEDED'],
      ]);
      expect(
        isolation.securityProbes.every(({ receipt }) => receipt.productionEligible === false),
      ).toBe(true);
    }
  });

  it('rejects legacy candidates missing evaluation identity, learning arrays, or security probes', async () => {
    const candidate = await fixture();
    const missingId = candidateInput(candidate);
    delete missingId.evaluationId;
    expect(() => createProductFactoryReleaseCandidate(missingId as never)).toThrow(
      ProductFactoryReleaseValidationError,
    );
    const legacyLearning = {
      ...candidateInput(candidate),
      learningEvidence: {
        schemaVersion: 'release-learning-evidence/v2',
        registry: candidate.learningEvidence.registry,
        promotion: null,
        rollback: null,
      },
    };
    expect(() => createProductFactoryReleaseCandidate(legacyLearning as never)).toThrow(
      ProductFactoryReleaseValidationError,
    );
    const missingProbes = clone(candidateInput(candidate));
    delete (missingProbes.isolation as Record<string, unknown>[])[0]!.securityProbes;
    expect(() => createProductFactoryReleaseCandidate(missingProbes as never)).toThrow(
      ProductFactoryReleaseValidationError,
    );
  });

  it('does not certify misordered canonical security probes even when their hashes are recomputed', async () => {
    const candidate = clone(await fixture());
    const isolation = candidate.isolation[0]!;
    (isolation.securityProbes as unknown[]).reverse();
    isolation.evidenceSha256 = digest(
      Object.fromEntries(Object.entries(isolation).filter(([key]) => key !== 'evidenceSha256')),
    );
    const decision = await evaluateProductFactoryRelease(rehashCandidate(candidate), context());
    expect(decision).toMatchObject({ status: 'UNVERIFIED', activationEligible: false });
    expect(decision.reasons).toContain('security-probes-unverified');
  });

  it('rejects malformed receipt-age contexts rather than coercing or defaulting them', async () => {
    const candidate = await fixture();
    for (const receiptMaxAgeMs of [
      undefined,
      null,
      '1000',
      NaN,
      Infinity,
      -1,
      RECEIPT_MAX_AGE_MS + 1,
    ]) {
      await expect(
        evaluateProductFactoryRelease(candidate, {
          now: new Date(NOW),
          receiptMaxAgeMs,
        } as never),
      ).rejects.toMatchObject({ code: 'RELEASE_MALFORMED' });
    }
  });

  it('rejects previously consumed canonical evidence under a new evaluation and nonce', async () => {
    const candidate = await fixture();
    await evaluateProductFactoryRelease(candidate, context());
    const replay = createProductFactoryReleaseCandidate({
      ...candidateInput(candidate),
      evaluationId: `replay-${randomUUID()}`,
      evidenceNonce: `replay-${randomUUID()}`,
    } as never);
    await expect(evaluateProductFactoryRelease(replay, context())).rejects.toMatchObject({
      code: 'RELEASE_REPLAY_REJECTED',
    });
  });

  it('preserves the exact three maintained canonical ACI descriptor lanes', async () => {
    const candidate = await fixture();
    const input = candidateInput(candidate);
    expect(() =>
      createProductFactoryReleaseCandidate({
        ...input,
        references: candidate.references.slice(0, 2),
      } as never),
    ).toThrow(ProductFactoryReleaseValidationError);
    expect(() =>
      createProductFactoryReleaseCandidate({
        ...input,
        references: [candidate.references[1], candidate.references[0], candidate.references[2]],
      } as never),
    ).toThrow(ProductFactoryReleaseValidationError);
    const tampered = clone(candidate.references[0]);
    tampered.aciDescriptor.environmentFingerprint = digest('invented-fingerprint');
    const referenceHashable = Object.fromEntries(
      Object.entries(tampered).filter(([key]) => key !== 'referenceSha256'),
    );
    tampered.referenceSha256 = digest(referenceHashable);
    expect(() => createProductFactoryReference(tampered as never)).toThrow(
      ProductFactoryReleaseValidationError,
    );
  });

  it('accepts observed failure only as a canonical linked revision followed by a retry', async () => {
    const candidate = await fixture({ twoWebAttempts: true });
    const web = candidate.attemptGroups[0]!;
    expect(web.attempts).toHaveLength(2);
    expect(web.attempts[1]!.revisionDelta?.failureAttemptSha256).toBe(
      web.attempts[0]!.attemptSha256,
    );
    await expect(evaluateProductFactoryRelease(candidate, context())).resolves.toMatchObject({
      status: 'UNVERIFIED',
      activationEligible: false,
    });
    const changed = clone(candidate);
    (
      changed.attemptGroups[0]!.attempts[1]!.revisionDelta! as unknown as Record<string, unknown>
    ).intentChanged = true;
    changed.attemptGroups[0]!.attempts[1]!.revisionDelta!.deltaSha256 = digest(
      Object.fromEntries(
        Object.entries(changed.attemptGroups[0]!.attempts[1]!.revisionDelta!).filter(
          ([key]) => key !== 'deltaSha256',
        ),
      ),
    );
    rehashAttempt(changed, 0, 1);
    await expect(evaluateProductFactoryRelease(changed, context())).rejects.toThrow(
      ProductFactoryReleaseValidationError,
    );
  });

  it('rejects PF3 negative deletion and rehash against canonical result dependencies', async () => {
    const candidate = clone(await fixture({ failOutcomeLane: 'web' }));
    const attempt = candidate.attemptGroups[0]!.attempts[0]!;
    const result = attempt.outcomeProof.result as Record<string, unknown>;
    result.negativePaths = [];
    result.status = 'UNVERIFIED';
    result.reason = 'required-evidence-missing';
    result.resultSha256 = hashProductOutcomePayload(
      Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'resultSha256')),
    );
    rehashAttempt(candidate, 0, 0);
    await expect(evaluateProductFactoryRelease(candidate, context())).rejects.toThrow(
      ProductFactoryReleaseValidationError,
    );
  });

  it('rejects PF6 negative deletion and rehash through its canonical receipt parser', async () => {
    const candidate = clone(await fixture({ failRuntimeLane: 'mobile' }));
    const receipt = candidate.isolation[1]!.receipts.find(
      (value: DisposableEnvironmentReceipt) => value.operation === 'execute',
    )! as DisposableEnvironmentReceipt;
    const payload = Object.fromEntries(
      Object.entries(receipt).filter(([key]) => key !== 'receiptSha256'),
    ) as Record<string, unknown>;
    payload.negativePaths = [];
    payload.status = 'UNVERIFIED';
    payload.code = 'EXECUTED';
    Object.assign(receipt, payload, { receiptSha256: hashDisposableEnvironmentPayload(payload) });
    const evidence = candidate.isolation[1]!;
    evidence.evidenceSha256 = digest(
      Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'evidenceSha256')),
    );
    candidate.candidateSha256 = rehashCandidate(candidate).candidateSha256;
    await expect(evaluateProductFactoryRelease(candidate, context())).rejects.toThrow(
      ProductFactoryReleaseValidationError,
    );
  });

  it.each([
    ['canonical PF3 outcome failure', { failOutcomeLane: 'web' }],
    ['canonical PF6 execution failure', { failRuntimeLane: 'mobile' }],
    ['canonical PF6 artifact mismatch', { artifactMismatchLane: 'game' }],
    ['canonical PF6 orphaned teardown', { orphanLane: 'web' }],
  ] as const)('gives canonical negative evidence precedence for %s', async (_label, options) => {
    const decision = await evaluateProductFactoryRelease(await fixture(options), context());
    expect(decision).toMatchObject({ status: 'FAIL', activationEligible: false });
  });

  it('keeps PF4 and opaque gates untrusted and rejects the retired PF5 rollback boolean', async () => {
    const candidate = await fixture();
    const claimed = clone(candidate) as ProductFactoryReleaseCandidate & {
      forgeBenchReference: Record<string, unknown>;
      learningEvidence: Record<string, unknown>;
    };
    claimed.forgeBenchReference.status = 'PASS';
    claimed.forgeBenchReference.thresholdsFrozen = true;
    claimed.learningEvidence.rollbackAvailable = true;
    const rehashed = rehashCandidate(claimed);
    await expect(evaluateProductFactoryRelease(rehashed, context())).rejects.toThrow(
      ProductFactoryReleaseValidationError,
    );
  });

  it('routes unresolved game fun/taste/commercial boundaries to human review', async () => {
    const decision = await evaluateProductFactoryRelease(
      await fixture({ subjectiveGame: true }),
      context(),
    );
    expect(decision).toMatchObject({
      status: 'REQUIRES_HUMAN_REVIEW',
      activationEligible: false,
    });
    expect(decision.reasons).toContain('subjective-review-open');
  });

  it('has a fixed bounded surface and no callback or synchronous-hang execution path', async () => {
    const candidate = await fixture();
    let called = false;
    const unsafeContext = {
      ...context(),
      verifyOutcomeProjection: () => {
        called = true;
        for (;;) {
          // This callback must never be accepted or invoked.
        }
      },
    };
    await expect(evaluateProductFactoryRelease(candidate, unsafeContext as never)).rejects.toThrow(
      ProductFactoryReleaseValidationError,
    );
    expect(called).toBe(false);
    const oversized = clone(candidate);
    oversized.attemptGroups[0]!.attempts = Array.from(
      { length: 17 },
      () => oversized.attemptGroups[0]!.attempts[0]!,
    );
    oversized.candidateSha256 = rehashCandidate(oversized).candidateSha256;
    const startedAt = performance.now();
    await expect(evaluateProductFactoryRelease(oversized, context())).rejects.toThrow(
      ProductFactoryReleaseValidationError,
    );
    expect(performance.now() - startedAt).toBeLessThan(250);
    await expect(
      evaluateProductFactoryRelease('x'.repeat(PRODUCT_FACTORY_RELEASE_MAX_BYTES + 1), context()),
    ).rejects.toMatchObject({ code: 'RELEASE_SIZE_LIMIT' });
  });

  it('snapshots mutable Date context before canonical awaits', async () => {
    const candidate = await fixture();
    const date = new Date(NOW);
    const pending = evaluateProductFactoryRelease(candidate, context(date));
    date.setUTCFullYear(2036);
    const decision = await pending;
    expect(decision.reasons).not.toContain('stale-candidate');
    expect(decision.evaluatedAt).toBe(NOW);
  });

  it('is idempotent for the same nonce+candidate and rejects nonce reuse by another candidate', async () => {
    const candidate = await fixture();
    const first = await evaluateProductFactoryRelease(candidate, context());
    const second = await evaluateProductFactoryRelease(candidate, context());
    expect(second).toEqual(first);
    await expect(parseProductFactoryReleaseDecision(first, candidate, context())).resolves.toEqual(
      first,
    );
    const other = await fixture();
    const replay = createProductFactoryReleaseCandidate({
      ...candidateInput(other),
      evidenceNonce: candidate.evidenceNonce,
    } as never);
    await expect(evaluateProductFactoryRelease(replay, context())).rejects.toMatchObject({
      code: 'RELEASE_REPLAY_REJECTED',
    });
  });

  it('recomputes semantic decisions and rejects rehashed status or activation forgery', async () => {
    const candidate = await fixture();
    const decision = await evaluateProductFactoryRelease(candidate, context());
    const forgedInput = { ...decision, status: 'FAIL', activationEligible: true };
    const forged = {
      ...forgedInput,
      decisionSha256: digest(
        Object.fromEntries(Object.entries(forgedInput).filter(([key]) => key !== 'decisionSha256')),
      ),
    };
    await expect(parseProductFactoryReleaseDecision(forged, candidate, context())).rejects.toThrow(
      ProductFactoryReleaseValidationError,
    );
  });

  it('rejects secret-like content and direct ACI hash forgery', async () => {
    const candidate = await fixture();
    const input = candidateInput(candidate) as Record<string, unknown>;
    input.implementerId = ['ghp', 'A'.repeat(40)].join('_');
    expect(() => createProductFactoryReleaseCandidate(input as never)).toThrow(
      ProductFactoryReleaseValidationError,
    );
    const descriptor = clone(candidate.references[0]!.aciDescriptor);
    descriptor.environment = { forged: true };
    descriptor.environmentFingerprint = hashEnvironmentAciPayload({ forged: true });
    const changed = clone(candidate.references[0]!);
    changed.aciDescriptor = descriptor;
    expect(() => createProductFactoryReference(changed as never)).toThrow(
      ProductFactoryReleaseValidationError,
    );
  });
});
