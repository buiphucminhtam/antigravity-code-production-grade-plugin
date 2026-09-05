import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ENVIRONMENT_ACI_SCHEMA_VERSION,
  EnvironmentAci,
  EnvironmentScenario,
  HostEnvironmentCapability,
  createEnvironmentAciDescriptor,
  createEnvironmentAction,
  createEnvironmentActionResult,
  createEnvironmentEvidenceReceipt,
  createEnvironmentObservation,
  createEnvironmentScenarioReceipt,
} from './environment-aci.js';
import { ProductIntentCreateInput, createProductIntent } from './product-intent.js';
import {
  ProductOutcomeContractInput,
  createProductOutcomeContract,
  hashProductOutcomePayload,
} from './product-outcome-contract.js';
import {
  PRODUCT_OUTCOME_RESULT_SCHEMA_VERSION,
  ProductionEnvironmentAttestation,
  createCriticalJourneyRunner,
  parseProductOutcomeResultReceipt,
} from './product-outcome-runner.js';

const NOW = '2026-09-04T00:00:00.000Z';
const DEADLINE = '2026-09-04T00:10:00.000Z';

const operations = {
  observe: true,
  act: true,
  reset: true,
  snapshot: true,
  restore: true,
  runScenario: true,
  collectEvidence: true,
} as const;

function intentInput(): ProductIntentCreateInput {
  return {
    intentId: 'intent-shop',
    createdAt: NOW,
    problem: { id: 'problem-shop', statement: 'Checkout needs proof.', evidenceRefs: [] },
    targetActors: [
      {
        id: 'actor-buyer',
        name: 'Buyer',
        description: 'A person buying an item.',
        evidenceRefs: [],
      },
    ],
    jobsToBeDone: [
      {
        id: 'job-buy',
        actorIds: ['actor-buyer'],
        statement: 'Buy an item.',
        desiredOutcomeIds: ['outcome-complete'],
      },
    ],
    desiredOutcomes: [
      {
        id: 'outcome-complete',
        statement: 'Checkout completes.',
        acceptanceRefs: ['accept-complete'],
      },
    ],
    constraints: [],
    nonGoals: [],
    preferences: [],
    scenarios: [
      {
        id: 'scenario-web',
        name: 'Web checkout',
        platform: 'web',
        actorIds: ['actor-buyer'],
        jobIds: ['job-buy'],
        outcomeIds: ['outcome-complete'],
        preconditions: [],
        steps: ['Confirm checkout.'],
        expectedOutcomes: ['Confirmation is visible.'],
      },
    ],
    uncertainty: [],
    decisions: [],
    acceptanceRefs: [
      { id: 'accept-complete', statement: 'Confirmation is visible.', evidenceRef: null },
    ],
    provenance: [
      {
        id: 'source-user',
        source: 'current-explicit-user',
        reference: 'Current user request.',
        observedAt: NOW,
        current: true,
        approved: true,
      },
    ],
    goalGraph: {
      nodes: [
        {
          id: 'goal-outcome',
          type: 'outcome',
          statement: 'Checkout completes.',
          intentRef: 'outcome-complete',
        },
        {
          id: 'goal-capability',
          type: 'capability',
          statement: 'Checkout capability.',
          intentRef: null,
        },
        {
          id: 'goal-scenario',
          type: 'scenario',
          statement: 'Web checkout.',
          intentRef: 'scenario-web',
        },
      ],
      edges: [
        { id: 'edge-outcome-capability', from: 'goal-outcome', to: 'goal-capability' },
        { id: 'edge-capability-scenario', from: 'goal-capability', to: 'goal-scenario' },
      ],
    },
  };
}

function fixture(overrides: Partial<ProductOutcomeContractInput> = {}) {
  const intent = createProductIntent(intentInput());
  const descriptor = createEnvironmentAciDescriptor({
    adapterId: 'adapter-web',
    environmentId: 'environment-shop',
    sessionId: 'session-shop',
    kind: 'web',
    operationTimeoutMs: 500,
    operations,
    actionKinds: ['click'],
    environment: { browser: 'chromium' },
  });
  const input: ProductOutcomeContractInput = {
    contractId: 'contract-checkout',
    intent: { intentId: intent.intentId, version: intent.version, hash: intent.hash },
    desiredOutcomeIds: ['outcome-complete'],
    scenarioIds: ['scenario-web'],
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
        scenarioId: 'scenario-web',
        desiredOutcomeIds: ['outcome-complete'],
        applicable: true,
        runnable: true,
        stateReason: null,
        actions: [{ actionId: 'action-confirm', kind: 'click', payload: { target: 'confirm' } }],
        assertions: [
          {
            id: 'assert-confirmed',
            category: 'requirement',
            subject: { kind: 'observation', actionId: 'action-confirm', path: ['screen'] },
            expected: { kind: 'string', operator: 'equals', value: 'confirmed' },
          },
        ],
        requiredEvidence: [
          {
            id: 'evidence-confirmation',
            actionId: 'action-confirm',
            mediaTypes: ['image/png'],
            minimumArtifacts: 1,
          },
        ],
        negativePaths: ['checkout-error'],
        limitations: [],
      },
    ],
    ...overrides,
  };
  const contract = createProductOutcomeContract(input, intent, descriptor);
  const host: HostEnvironmentCapability = {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    enabled: true,
    environmentFingerprint: descriptor.environmentFingerprint,
    capabilityFingerprint: descriptor.capabilityFingerprint,
    operationTimeoutMs: descriptor.operationTimeoutMs,
    operations,
    reason: null,
    limitations: [],
  };
  return { intent, descriptor, contract, host };
}

type ReceiptMode = 'pass' | 'negative' | 'tampered' | 'late' | 'duplicate-artifacts' | 'unsafe';

class ScenarioAci implements EnvironmentAci {
  calls = 0;
  readonly descriptor = createEnvironmentAciDescriptor({
    adapterId: 'adapter-web',
    environmentId: 'environment-shop',
    sessionId: 'session-shop',
    kind: 'web',
    operationTimeoutMs: 500,
    operations,
    actionKinds: ['click'],
    environment: { browser: 'chromium' },
  });
  constructor(private readonly mode: ReceiptMode = 'pass') {}

  async runScenario(scenario: EnvironmentScenario) {
    this.calls += 1;
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
      state: { screen: 'reset' },
      limitations: [],
      environmentFingerprint: fixture().descriptor.environmentFingerprint,
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
      ...scenario.steps[0],
    });
    const actionResult = createEnvironmentActionResult({
      ...action,
      completedAt: scenario.requestedAt,
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      environmentFingerprint: fixture().descriptor.environmentFingerprint,
    });
    const observation = createEnvironmentObservation({
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
      state: { screen: 'confirmed', buildGreen: true },
      limitations: [],
      environmentFingerprint: fixture().descriptor.environmentFingerprint,
    });
    const evidence = createEnvironmentEvidenceReceipt({
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
      collectedAt: this.mode === 'late' ? '2026-09-04T00:20:00.000Z' : scenario.requestedAt,
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      artifacts: [
        {
          ref: 'evidence/confirmation.png',
          sha256: 'a'.repeat(64),
          bytes: 128,
          mediaType: 'image/png',
        },
        ...(this.mode === 'duplicate-artifacts'
          ? [
              {
                ref: 'evidence/confirmation-alias.png',
                sha256: 'a'.repeat(64),
                bytes: 128,
                mediaType: 'image/png',
              },
            ]
          : []),
      ],
      environmentFingerprint: fixture().descriptor.environmentFingerprint,
    });
    const cleanup = createEnvironmentObservation({
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: scenario.adapterId,
      environmentId: scenario.environmentId,
      sessionId: scenario.sessionId,
      scenarioId: scenario.scenarioId,
      executionId: scenario.executionId,
      sequence: 5,
      requestedAt: scenario.requestedAt,
      afterActionId: null,
      observedAt: scenario.requestedAt,
      state: { screen: 'reset' },
      limitations: [],
      environmentFingerprint: fixture().descriptor.environmentFingerprint,
    });
    const receipt = createEnvironmentScenarioReceipt({
      ...scenario,
      status: this.mode === 'negative' ? 'FAIL' : 'PASS',
      reason: this.mode === 'negative' ? 'negative-path-observed' : null,
      negativePaths: this.mode === 'negative' ? ['checkout-error'] : [],
      limitations: this.mode === 'unsafe' ? ['credential-leak'] : [],
      startedAt: scenario.requestedAt,
      completedAt: this.mode === 'late' ? '2026-09-04T00:20:00.000Z' : scenario.requestedAt,
      sequence: 5,
      resetObservation: reset,
      actions: [action],
      actionResults: [actionResult],
      observations: [observation],
      evidence: [evidence],
      cleanupObservation: cleanup,
      environmentFingerprint: fixture().descriptor.environmentFingerprint,
    });
    return this.mode === 'tampered'
      ? { ...receipt, environmentFingerprint: 'f'.repeat(64) }
      : receipt;
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

class RepeatedContentAci extends ScenarioAci {
  constructor(
    private readonly failedFinal = false,
    private readonly omitFinalImage = false,
  ) {
    super();
  }

  override async runScenario(scenario: EnvironmentScenario) {
    const base = {
      schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
      adapterId: scenario.adapterId,
      environmentId: scenario.environmentId,
      sessionId: scenario.sessionId,
      scenarioId: scenario.scenarioId,
      executionId: scenario.executionId,
      requestedAt: scenario.requestedAt,
    };
    const fingerprint = this.descriptor.environmentFingerprint;
    const reset = createEnvironmentObservation({
      ...base,
      sequence: 1,
      afterActionId: null,
      observedAt: scenario.requestedAt,
      state: { screen: 'reset' },
      limitations: [],
      environmentFingerprint: fingerprint,
    });
    const entries = scenario.steps.map((step, index) => {
      const sequence = 2 + index * 3;
      const action = createEnvironmentAction({ ...base, ...step, sequence });
      const actionResult = createEnvironmentActionResult({
        ...action,
        completedAt: scenario.requestedAt,
        status: 'PASS',
        reason: null,
        negativePaths: [],
        limitations: [],
        environmentFingerprint: fingerprint,
      });
      const observation = createEnvironmentObservation({
        ...base,
        sequence: sequence + 1,
        afterActionId: step.actionId,
        observedAt: scenario.requestedAt,
        state: {
          screen: this.failedFinal && index === 1 ? 'not-confirmed' : 'confirmed',
        },
        limitations: [],
        environmentFingerprint: fingerprint,
      });
      const omitImage = index === 1 && this.omitFinalImage;
      const evidence = createEnvironmentEvidenceReceipt({
        ...base,
        sequence: sequence + 2,
        actionId: step.actionId,
        actionSha256: action.actionSha256,
        observationSha256: observation.observationSha256,
        collectedAt: scenario.requestedAt,
        status: 'PASS',
        reason: null,
        negativePaths: [],
        limitations: [],
        environmentFingerprint: fingerprint,
        artifacts: [
          {
            ref: `evidence/action-${index}.${omitImage ? 'json' : 'png'}`,
            sha256: (omitImage ? 'b' : 'a').repeat(64),
            bytes: 128,
            mediaType: omitImage ? 'application/json' : 'image/png',
          },
        ],
      });
      return { action, actionResult, observation, evidence };
    });
    const sequence = 2 + entries.length * 3;
    const cleanup = createEnvironmentObservation({
      ...base,
      sequence,
      afterActionId: null,
      observedAt: scenario.requestedAt,
      state: { screen: 'reset' },
      limitations: [],
      environmentFingerprint: fingerprint,
    });
    return createEnvironmentScenarioReceipt({
      ...scenario,
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      startedAt: scenario.requestedAt,
      completedAt: scenario.requestedAt,
      sequence,
      resetObservation: reset,
      cleanupObservation: cleanup,
      actions: entries.map((entry) => entry.action),
      actionResults: entries.map((entry) => entry.actionResult),
      observations: entries.map((entry) => entry.observation),
      evidence: entries.map((entry) => entry.evidence),
      environmentFingerprint: fingerprint,
    });
  }
}

function runInput(value = fixture(), executionId = `execution-${randomUUID()}`) {
  return {
    contract: value.contract,
    intent: value.intent,
    scenarioId: 'scenario-web',
    executionId,
    requestedAt: NOW,
    deadlineAt: DEADLINE,
  };
}

function expectedScenario(value: ReturnType<typeof fixture>, input: ReturnType<typeof runInput>) {
  const journey = value.contract.journeys.find(({ scenarioId }) => scenarioId === input.scenarioId);
  if (!journey) throw new Error('test fixture journey missing');
  return {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: value.descriptor.adapterId,
    environmentId: value.descriptor.environmentId,
    sessionId: value.descriptor.sessionId,
    scenarioId: journey.scenarioId,
    executionId: input.executionId,
    requestedAt: input.requestedAt,
    deadlineAt: input.deadlineAt,
    steps: journey.actions.map(({ actionId, kind, payload }) => ({
      actionId,
      kind,
      payload: payload as EnvironmentScenario['steps'][number]['payload'],
    })),
  } satisfies EnvironmentScenario;
}

function productionAttestation(
  value: ReturnType<typeof fixture>,
  input: ReturnType<typeof runInput>,
): ProductionEnvironmentAttestation {
  return {
    contractSha256: value.contract.contractSha256,
    environmentFingerprint: value.descriptor.environmentFingerprint,
    capabilityFingerprint: value.descriptor.capabilityFingerprint,
    scenarioId: input.scenarioId,
    executionId: input.executionId,
    issuedAt: input.requestedAt,
    expiresAt: input.deadlineAt,
  };
}

describe('CriticalJourneyRunner', () => {
  it.each([
    ['each action retains its repeated-content evidence', 1, false, false, 'PASS', null],
    [
      'observed failure is not hidden by cross-action deduplication',
      1,
      true,
      false,
      'FAIL',
      'assertion-failed',
    ],
    [
      'aliases still cannot meet a two-artifact minimum',
      2,
      false,
      false,
      'UNVERIFIED',
      'required-evidence-missing',
    ],
    [
      'a later action cannot borrow an earlier image',
      1,
      false,
      true,
      'UNVERIFIED',
      'required-evidence-missing',
    ],
  ] as const)(
    '%s',
    async (_label, minimumArtifacts, failedFinal, omitFinalImage, status, reason) => {
      const base = fixture();
      const value = fixture({
        journeys: base.contract.journeys.map((journey) => ({
          ...journey,
          actions: [
            { actionId: 'action-first', kind: 'click' as const, payload: { target: 'first' } },
            ...journey.actions,
          ],
          requiredEvidence: [
            {
              id: 'evidence-first',
              actionId: 'action-first',
              mediaTypes: ['image/png'],
              minimumArtifacts,
            },
            ...journey.requiredEvidence.map((item) => ({ ...item, minimumArtifacts })),
          ],
        })),
      });
      const aci = new RepeatedContentAci(failedFinal, omitFinalImage);
      const input = runInput(value);
      const result = await createCriticalJourneyRunner(aci, value.descriptor, value.host).run(
        input,
      );
      expect(result).toMatchObject({ status, reason, executed: true, aciStatus: 'PASS' });
      expect(result.artifacts).toHaveLength(omitFinalImage ? 2 : 1);
      const scenario = expectedScenario(value, input);
      await expect(
        parseProductOutcomeResultReceipt(result, {
          contract: value.contract,
          intent: value.intent,
          expectedScenario: scenario,
          scenarioReceipt: await aci.runScenario(scenario),
        }),
      ).resolves.toEqual(result);
    },
  );

  it('runs the exact critical journey and seals a strict PASS receipt', async () => {
    const value = fixture();
    const aci = new ScenarioAci();
    const input = runInput(value);
    const receipt = await createCriticalJourneyRunner(aci, value.descriptor, value.host).run(input);
    expect(receipt).toMatchObject({
      schemaVersion: PRODUCT_OUTCOME_RESULT_SCHEMA_VERSION,
      status: 'PASS',
      contractSha256: value.contract.contractSha256,
      intentHash: value.intent.hash,
      scenarioId: 'scenario-web',
      executionId: input.executionId,
      executed: true,
      aciStatus: 'PASS',
    });
    expect(receipt.assertionResults).toEqual([
      expect.objectContaining({ assertionId: 'assert-confirmed', status: 'PASS' }),
    ]);
    expect(receipt.artifacts).toHaveLength(1);
    expect(receipt.scenarioExecutionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(aci.calls).toBe(1);
  });

  it('derives FAIL for unmet assertions, declared negative paths, or tampered ACI receipts', async () => {
    const value = fixture({
      journeys: fixture().contract.journeys.map((journey) => ({
        ...journey,
        assertions: journey.assertions.map((assertion) =>
          assertion.category === 'subjective-game'
            ? assertion
            : {
                ...assertion,
                expected: { kind: 'string', operator: 'equals', value: 'missing' },
              },
        ),
      })),
    });
    const unmet = await createCriticalJourneyRunner(
      new ScenarioAci(),
      value.descriptor,
      value.host,
    ).run(runInput(value));
    expect(unmet).toMatchObject({ status: 'FAIL', reason: 'assertion-failed' });

    const negativeValue = fixture();
    const negative = await createCriticalJourneyRunner(
      new ScenarioAci('negative'),
      negativeValue.descriptor,
      negativeValue.host,
    ).run({ ...runInput(negativeValue), executionId: 'execution-negative' });
    expect(negative).toMatchObject({ status: 'FAIL', reason: 'negative-path-observed' });

    const tamperedValue = fixture();
    const tampered = await createCriticalJourneyRunner(
      new ScenarioAci('tampered'),
      tamperedValue.descriptor,
      tamperedValue.host,
    ).run({ ...runInput(tamperedValue), executionId: 'execution-tampered' });
    expect(tampered).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'runtime-outcome-evidence-missing',
      executed: false,
    });
    expect(JSON.stringify(tampered)).not.toMatch(/secret|credential/i);
  });

  it('returns UNVERIFIED without execution for missing capability or missing applicable media', async () => {
    const missingCapability = fixture();
    const aci = new ScenarioAci();
    const unavailable = await createCriticalJourneyRunner(
      aci,
      missingCapability.descriptor,
      undefined,
    ).run(runInput(missingCapability));
    expect(unavailable).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'runtime-outcome-evidence-missing',
      executed: false,
      negativePaths: [],
      limitations: ['runtime-outcome-evidence-missing'],
    });
    expect(aci.calls).toBe(0);

    const evidenceValue = fixture({
      journeys: fixture().contract.journeys.map((journey) => ({
        ...journey,
        requiredEvidence: journey.requiredEvidence.map((requirement) => ({
          ...requirement,
          mediaTypes: ['video/mp4'],
        })),
      })),
    });
    const evidence = await createCriticalJourneyRunner(
      new ScenarioAci(),
      evidenceValue.descriptor,
      evidenceValue.host,
    ).run(runInput(evidenceValue));
    expect(evidence).toMatchObject({ status: 'UNVERIFIED', reason: 'required-evidence-missing' });
  });

  it('never completes subjective or synthetic-user authority and rejects green-build-only success', async () => {
    const base = fixture();
    const human = fixture({
      evidenceAuthority: 'production',
      syntheticUser: false,
      journeys: base.contract.journeys.map((journey) => ({
        ...journey,
        assertions: [
          ...journey.assertions,
          {
            id: 'assert-fun',
            category: 'subjective-game' as const,
            boundary: 'fun' as const,
            prompt: 'Is this fun?',
            expected: { kind: 'human-review' as const },
          },
        ],
      })),
    });
    const humanReceipt = await createCriticalJourneyRunner(
      new ScenarioAci(),
      human.descriptor,
      human.host,
    ).run(runInput(human));
    expect(humanReceipt).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'production-attestation-missing',
    });

    const synthetic = fixture({ evidenceAuthority: 'test-only', syntheticUser: true });
    const syntheticReceipt = await createCriticalJourneyRunner(
      new ScenarioAci(),
      synthetic.descriptor,
      synthetic.host,
    ).run(runInput(synthetic));
    expect(syntheticReceipt).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'synthetic-user-test-only',
      evidenceAuthority: 'test-only',
      negativePaths: [],
      limitations: ['synthetic-user-test-only'],
    });

    const green = fixture({
      journeys: base.contract.journeys.map((journey) => ({
        ...journey,
        assertions: [
          {
            id: 'assert-build-green',
            category: 'release' as const,
            subject: { kind: 'receipt' as const, field: 'status' as const },
            expected: { kind: 'string' as const, operator: 'equals' as const, value: 'PASS' },
          },
        ],
      })),
    });
    const greenReceipt = await createCriticalJourneyRunner(
      new ScenarioAci(),
      green.descriptor,
      green.host,
    ).run(runInput(green));
    expect(greenReceipt).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'runtime-outcome-evidence-missing',
    });
  });

  it('rejects forged status/hash and delegates late receipt/concurrency handling to the ACI boundary', async () => {
    const value = fixture();
    const firstAci = new ScenarioAci();
    const replayInput = runInput(value, 'execution-replay-once');
    const receipt = await createCriticalJourneyRunner(firstAci, value.descriptor, value.host).run(
      replayInput,
    );
    await expect(
      parseProductOutcomeResultReceipt(
        { ...receipt, status: 'FAIL' },
        {
          contract: value.contract,
          intent: value.intent,
          expectedScenario: expectedScenario(value, replayInput),
        },
      ),
    ).rejects.toThrow(/RESULT_DIGEST_INVALID/);

    const replayAci = new ScenarioAci('late');
    const late = await createCriticalJourneyRunner(replayAci, value.descriptor, value.host).run(
      replayInput,
    );
    expect(late).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'runtime-outcome-evidence-missing',
      executed: false,
    });
    expect(replayAci.calls).toBe(0);

    const firstConcurrentAci = new ScenarioAci();
    const secondConcurrentAci = new ScenarioAci();
    const concurrentInput = runInput(value, 'execution-shared-across-runners');
    const concurrent = await Promise.all([
      createCriticalJourneyRunner(firstConcurrentAci, value.descriptor, value.host).run(
        concurrentInput,
      ),
      createCriticalJourneyRunner(secondConcurrentAci, value.descriptor, value.host).run(
        concurrentInput,
      ),
    ]);
    expect(firstConcurrentAci.calls + secondConcurrentAci.calls).toBe(1);
    expect(concurrent.map(({ status }) => status).sort()).toEqual(['PASS', 'UNVERIFIED']);
  });

  it('rejects a recomputed but contradictory result receipt and does not elevate synthetic evidence', async () => {
    const value = fixture();
    const input = runInput(value);
    const receipt = await createCriticalJourneyRunner(
      new ScenarioAci(),
      value.descriptor,
      value.host,
    ).run(input);
    const unsigned = Object.fromEntries(
      Object.entries(receipt).filter(([key]) => key !== 'resultSha256'),
    );
    const contradictory = {
      ...unsigned,
      executed: false,
      aciStatus: null,
      scenarioExecutionSha256: null,
    };
    await expect(
      parseProductOutcomeResultReceipt(
        { ...contradictory, resultSha256: hashProductOutcomePayload(contradictory) },
        {
          contract: value.contract,
          intent: value.intent,
          expectedScenario: expectedScenario(value, input),
        },
      ),
    ).rejects.toThrow(/RESULT_MALFORMED/);
  });

  it('never lets the injected test adapter certify a production contract without a trusted attestation', async () => {
    const production = fixture({ evidenceAuthority: 'production' });
    const aci = new ScenarioAci();
    const receipt = await createCriticalJourneyRunner(
      aci,
      production.descriptor,
      production.host,
    ).run(runInput(production));
    expect(receipt).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'production-attestation-missing',
      executed: false,
    });
    expect(aci.calls).toBe(0);
  });

  it('requires an exact attestation and an authoritative async verifier for production PASS', async () => {
    const value = fixture({ evidenceAuthority: 'production' });
    const input = runInput(value, 'execution-production-authority');
    const attestation = productionAttestation(value, input);
    const runVerifier = vi.fn(async () => true);
    const receipt = await createCriticalJourneyRunner(
      new ScenarioAci(),
      value.descriptor,
      value.host,
      {
        productionAttestation: attestation,
        verifyProductionAttestation: runVerifier,
      },
    ).run(input);
    expect(receipt).toMatchObject({ status: 'PASS', executed: true });
    expect(runVerifier).toHaveBeenCalledTimes(1);
    expect(runVerifier).toHaveBeenCalledWith(attestation);

    const expected = expectedScenario(value, input);
    const scenarioReceipt = await new ScenarioAci().runScenario(expected);
    const baseContext = {
      contract: value.contract,
      intent: value.intent,
      expectedScenario: expected,
      scenarioReceipt,
      productionAttestation: attestation,
    };
    await expect(parseProductOutcomeResultReceipt(receipt, baseContext)).rejects.toThrow(
      /RESULT_BINDING_INVALID/,
    );
    await expect(
      parseProductOutcomeResultReceipt(receipt, {
        ...baseContext,
        verifyProductionAttestation: (() => true) as never,
      }),
    ).rejects.toThrow(/RESULT_BINDING_INVALID/);
    await expect(
      parseProductOutcomeResultReceipt(receipt, {
        ...baseContext,
        verifyProductionAttestation: async () => false,
      }),
    ).rejects.toThrow(/RESULT_BINDING_INVALID/);
    await expect(
      parseProductOutcomeResultReceipt(receipt, {
        ...baseContext,
        verifyProductionAttestation: async () => {
          throw new Error('verifier unavailable');
        },
      }),
    ).rejects.toThrow(/RESULT_BINDING_INVALID/);

    const inexactVerifier = vi.fn(async () => true);
    await expect(
      parseProductOutcomeResultReceipt(receipt, {
        ...baseContext,
        productionAttestation: { ...attestation, executionId: 'execution-inexact' },
        verifyProductionAttestation: inexactVerifier,
      }),
    ).rejects.toThrow(/RESULT_BINDING_INVALID/);
    expect(inexactVerifier).not.toHaveBeenCalled();

    const parseVerifier = vi.fn(async () => true);
    await expect(
      parseProductOutcomeResultReceipt(receipt, {
        ...baseContext,
        verifyProductionAttestation: parseVerifier,
      }),
    ).resolves.toEqual(receipt);
    expect(parseVerifier).toHaveBeenCalledTimes(1);
    expect(parseVerifier).toHaveBeenCalledWith(attestation);

    await expect(
      parseProductOutcomeResultReceipt(receipt, {
        ...baseContext,
        verifyProductionAttestation: async () => true,
        journey: { ...value.contract.journeys[0], assertions: [] },
      } as never),
    ).rejects.toThrow(/RESULT_BINDING_INVALID/);
  });

  it('uses canonical non-execution profiles and rejects arbitrary diagnostic text', async () => {
    const base = fixture();
    const nonRunnable = fixture({
      journeys: base.contract.journeys.map((journey) => ({
        ...journey,
        applicable: false,
        runnable: false,
        stateReason: 'not-applicable',
      })),
    });
    const nonRunnableAci = new ScenarioAci();
    const nonRunnableReceipt = await createCriticalJourneyRunner(
      nonRunnableAci,
      nonRunnable.descriptor,
      nonRunnable.host,
    ).run(runInput(nonRunnable, 'execution-not-runnable'));
    expect(nonRunnableReceipt).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'journey-not-runnable',
      executed: false,
      assertionResults: [],
      artifacts: [],
      negativePaths: [],
      limitations: ['journey-not-runnable'],
    });
    expect(nonRunnableAci.calls).toBe(0);

    const unsafe = fixture();
    const unsafeReceipt = await createCriticalJourneyRunner(
      new ScenarioAci('unsafe'),
      unsafe.descriptor,
      unsafe.host,
    ).run(runInput(unsafe, 'execution-unsafe-diagnostic'));
    expect(unsafeReceipt).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'runtime-outcome-evidence-missing',
      executed: false,
      negativePaths: [],
      limitations: ['runtime-outcome-evidence-missing'],
    });
    expect(JSON.stringify(unsafeReceipt)).not.toContain('credential-leak');

    const synthetic = fixture({ evidenceAuthority: 'test-only', syntheticUser: true });
    const syntheticInput = runInput(synthetic, 'execution-canonical-diagnostic');
    const syntheticReceipt = await createCriticalJourneyRunner(
      new ScenarioAci(),
      synthetic.descriptor,
      synthetic.host,
    ).run(syntheticInput);
    const unsigned = Object.fromEntries(
      Object.entries(syntheticReceipt).filter(([key]) => key !== 'resultSha256'),
    );
    const forged = { ...unsigned, limitations: ['arbitrary-reviewer-text'] };
    await expect(
      parseProductOutcomeResultReceipt(
        { ...forged, resultSha256: hashProductOutcomePayload(forged) },
        {
          contract: synthetic.contract,
          intent: synthetic.intent,
          expectedScenario: expectedScenario(synthetic, syntheticInput),
        },
      ),
    ).rejects.toThrow(/RESULT_MALFORMED/);
  });

  it('deduplicates artifact aliases before evidence counts and retains every human assertion', async () => {
    const base = fixture();
    const duplicateEvidence = fixture({
      journeys: base.contract.journeys.map((journey) => ({
        ...journey,
        requiredEvidence: journey.requiredEvidence.map((requirement) => ({
          ...requirement,
          minimumArtifacts: 2,
        })),
      })),
    });
    const duplicateReceipt = await createCriticalJourneyRunner(
      new ScenarioAci('duplicate-artifacts'),
      duplicateEvidence.descriptor,
      duplicateEvidence.host,
    ).run(runInput(duplicateEvidence, 'execution-duplicate-artifacts'));
    expect(duplicateReceipt).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'required-evidence-missing',
      executed: true,
    });
    expect(duplicateReceipt.artifacts).toHaveLength(1);
    expect(new Set(duplicateReceipt.artifacts.map(({ sha256 }) => sha256)).size).toBe(
      duplicateReceipt.artifacts.length,
    );

    const human = fixture({
      journeys: base.contract.journeys.map((journey) => ({
        ...journey,
        assertions: [
          ...journey.assertions,
          {
            id: 'assert-fun-retained',
            category: 'subjective-game' as const,
            boundary: 'fun' as const,
            prompt: 'Is this fun?',
            expected: { kind: 'human-review' as const },
          },
        ],
      })),
    });
    const humanReceipt = await createCriticalJourneyRunner(
      new ScenarioAci('negative'),
      human.descriptor,
      human.host,
    ).run(runInput(human, 'execution-human-negative'));
    expect(humanReceipt).toMatchObject({ status: 'FAIL', reason: 'negative-path-observed' });
    expect(humanReceipt.assertionResults).toEqual([
      { assertionId: 'assert-confirmed', status: 'PASS', reason: null },
      {
        assertionId: 'assert-fun-retained',
        status: 'REQUIRES_HUMAN_REVIEW',
        reason: 'subjective-human-review-required',
      },
    ]);
  });

  it('does not let receipt artifact-count assertions count duplicate SHA aliases', async () => {
    const base = fixture();
    const value = fixture({
      journeys: base.contract.journeys.map((journey) => ({
        ...journey,
        assertions: [
          {
            id: 'assert-unique-artifact-count',
            category: 'reliability' as const,
            subject: { kind: 'receipt' as const, field: 'artifact-count' as const },
            expected: { kind: 'number' as const, operator: 'at-least' as const, value: 2 },
          },
        ],
      })),
    });
    const receipt = await createCriticalJourneyRunner(
      new ScenarioAci('duplicate-artifacts'),
      value.descriptor,
      value.host,
    ).run(runInput(value, 'execution-artifact-count-aliases'));

    expect(['FAIL', 'UNVERIFIED']).toContain(receipt.status);
    expect(receipt.assertionResults).toEqual([
      {
        assertionId: 'assert-unique-artifact-count',
        status: 'FAIL',
        reason: 'assertion-failed',
      },
    ]);
    expect(receipt.artifacts).toHaveLength(1);
  });

  it('binds result executionId, requestedAt, and deadlineAt exactly to the expected scenario', async () => {
    const value = fixture();
    const input = { ...runInput(value), executionId: 'execution-binding-red' };
    const receipt = await createCriticalJourneyRunner(
      new ScenarioAci(),
      value.descriptor,
      value.host,
    ).run(input);
    const expected = expectedScenario(value, input);
    const scenarioReceipt = await new ScenarioAci().runScenario(expected);
    const unsigned = Object.fromEntries(
      Object.entries(receipt).filter(([key]) => key !== 'resultSha256'),
    );
    for (const mutation of [
      { executionId: 'execution-binding-forged' },
      { requestedAt: '2026-09-03T23:59:00.000Z' },
      { deadlineAt: '2026-09-04T00:11:00.000Z' },
    ]) {
      const forged = { ...unsigned, ...mutation };
      await expect(
        parseProductOutcomeResultReceipt(
          { ...forged, resultSha256: hashProductOutcomePayload(forged) },
          {
            contract: value.contract,
            intent: value.intent,
            expectedScenario: expected,
            scenarioReceipt,
          },
        ),
      ).rejects.toThrow(/RESULT_BINDING_INVALID/);
    }
  });
});
