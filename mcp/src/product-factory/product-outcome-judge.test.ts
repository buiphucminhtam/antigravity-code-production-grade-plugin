import { describe, expect, it } from 'vitest';
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
} from './environment-aci.js';
import { ProductIntentCreateInput, createProductIntent } from './product-intent.js';
import {
  ProductOutcomeAssertionCategory,
  ProductOutcomeContractInput,
  createProductOutcomeContract,
  hashProductOutcomePayload,
} from './product-outcome-contract.js';
import {
  ProductionEnvironmentAttestation,
  createCriticalJourneyRunner,
} from './product-outcome-runner.js';
import {
  PRODUCT_OUTCOME_JUDGMENT_SCHEMA_VERSION,
  PRODUCT_OUTCOME_SPECIALIST_RECEIPT_SCHEMA_VERSION,
  ProductOutcomeJudgeInput,
  ProductOutcomeJudgeValidationError,
  ProductOutcomeSpecialistCategory,
  ProductOutcomeSpecialistReceipt,
  ProductOutcomeSpecialistReceiptInput,
  createProductOutcomeSpecialistReceipt,
  deriveRequiredProductOutcomeSpecialistCategories,
  judgeProductOutcome,
  parseProductOutcomeJudgment,
  parseProductOutcomeSpecialistReceipt,
} from './product-outcome-judge.js';

const REQUESTED = '2026-09-04T00:00:00.000Z';
const ISSUED = '2026-09-04T00:05:00.000Z';
const JUDGED = '2026-09-04T00:10:00.000Z';
const EXPIRES = '2026-09-04T01:00:00.000Z';
const DEADLINE = '2026-09-04T00:20:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
let fixtureSequence = 0;

const operations = {
  observe: true,
  act: true,
  reset: true,
  snapshot: true,
  restore: true,
  runScenario: true,
  collectEvidence: true,
} as const;

class JudgeScenarioAci implements EnvironmentAci {
  receipt: EnvironmentScenarioReceipt | undefined;

  constructor(private readonly descriptor: ReturnType<typeof createEnvironmentAciDescriptor>) {}

  async runScenario(scenario: EnvironmentScenario) {
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
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
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
      state: { confirmed: true },
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
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
      collectedAt: scenario.requestedAt,
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      artifacts: [
        { ref: 'evidence/confirmation.png', sha256: HASH_A, bytes: 128, mediaType: 'image/png' },
      ],
      environmentFingerprint: this.descriptor.environmentFingerprint,
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
      state: { confirmed: false },
      limitations: [],
      environmentFingerprint: this.descriptor.environmentFingerprint,
    });
    this.receipt = createEnvironmentScenarioReceipt({
      ...scenario,
      status: 'PASS',
      reason: null,
      negativePaths: [],
      limitations: [],
      startedAt: scenario.requestedAt,
      completedAt: scenario.requestedAt,
      sequence: 5,
      resetObservation: reset,
      actions: [action],
      actionResults: [actionResult],
      observations: [observation],
      evidence: [evidence],
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

function intentInput(): ProductIntentCreateInput {
  return {
    intentId: 'intent-shop',
    createdAt: REQUESTED,
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
        observedAt: REQUESTED,
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

async function fixture(
  categories: ProductOutcomeAssertionCategory[] = ['requirement', 'performance'],
  evidenceAuthority: 'production' | 'test-only' = 'production',
) {
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
  const assertions: ProductOutcomeContractInput['journeys'][number]['assertions'] = categories.map(
    (category, index) =>
      category === 'subjective-game'
        ? {
            id: `assert-subjective-${index}`,
            category,
            boundary: 'fun',
            prompt: 'Is the experience fun?',
            expected: { kind: 'human-review' },
          }
        : {
            id: `assert-${category}-${index}`,
            category,
            subject: { kind: 'observation', actionId: 'action-confirm', path: ['confirmed'] },
            expected: { kind: 'boolean', operator: 'equals', value: true },
          },
  );
  const contract = createProductOutcomeContract(
    {
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
      evidenceAuthority,
      syntheticUser: false,
      journeys: [
        {
          scenarioId: 'scenario-web',
          desiredOutcomeIds: ['outcome-complete'],
          applicable: true,
          runnable: true,
          stateReason: null,
          actions: [{ actionId: 'action-confirm', kind: 'click', payload: { target: 'confirm' } }],
          assertions,
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
    },
    intent,
    descriptor,
  );
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
  const runInput = {
    contract,
    intent,
    scenarioId: 'scenario-web',
    executionId: `execution-shop-${fixtureSequence++}`,
    requestedAt: REQUESTED,
    deadlineAt: DEADLINE,
  };
  const expectedScenario: EnvironmentScenario = {
    schemaVersion: ENVIRONMENT_ACI_SCHEMA_VERSION,
    adapterId: descriptor.adapterId,
    environmentId: descriptor.environmentId,
    sessionId: descriptor.sessionId,
    scenarioId: runInput.scenarioId,
    executionId: runInput.executionId,
    requestedAt: runInput.requestedAt,
    deadlineAt: runInput.deadlineAt,
    steps: [{ actionId: 'action-confirm', kind: 'click', payload: { target: 'confirm' } }],
  };
  const attestation: ProductionEnvironmentAttestation = {
    contractSha256: contract.contractSha256,
    environmentFingerprint: descriptor.environmentFingerprint,
    capabilityFingerprint: descriptor.capabilityFingerprint,
    scenarioId: runInput.scenarioId,
    executionId: runInput.executionId,
    issuedAt: REQUESTED,
    expiresAt: EXPIRES,
  };
  const aci = new JudgeScenarioAci(descriptor);
  const resultReceipt = await createCriticalJourneyRunner(aci, descriptor, host, {
    productionAttestation: attestation,
    verifyProductionAttestation: async () => true,
  }).run(runInput);
  if (!aci.receipt) throw new Error('Judge fixture did not produce an ACI receipt.');
  return {
    intent,
    contract,
    resultReceipt,
    runnerVerification: {
      contract,
      intent,
      expectedScenario,
      scenarioReceipt: aci.receipt,
      productionAttestation: attestation,
      verifyProductionAttestation: async () => true,
    },
  };
}

function specialistInput(
  value: Awaited<ReturnType<typeof fixture>>,
  category: ProductOutcomeSpecialistCategory,
  overrides: Partial<ProductOutcomeSpecialistReceiptInput> = {},
): ProductOutcomeSpecialistReceiptInput {
  return {
    contractSha256: value.contract.contractSha256,
    intentHash: value.intent.hash,
    resultSha256: value.resultReceipt.resultSha256,
    scenarioId: value.resultReceipt.scenarioId,
    executionId: value.resultReceipt.executionId,
    category,
    applicable: true,
    status: 'PASS',
    evidenceAuthority: 'production',
    verifierId: `verifier-${category}`,
    verifierDigest: HASH_B,
    testRefs: [`mcp/src/product-factory/${category}.test.ts::verifies-${category}`],
    evidence: [{ sha256: HASH_A, bytes: 128, mediaType: 'image/png', refSha256: HASH_B }],
    evidenceSha256: hashProductOutcomePayload([
      { sha256: HASH_A, bytes: 128, mediaType: 'image/png', refSha256: HASH_B },
    ]),
    negativePaths: [],
    limitations: [],
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function input(
  value: Awaited<ReturnType<typeof fixture>>,
  receipts: readonly ProductOutcomeSpecialistReceipt[],
): ProductOutcomeJudgeInput {
  return {
    runnerResult: value.resultReceipt,
    runnerVerification: value.runnerVerification,
    specialistReceipts: receipts,
    judgedAt: JUDGED,
    verifySpecialistReceipt: async (receipt) => receipt.verifierDigest === HASH_B,
  };
}

describe('product-outcome-judge', async () => {
  it('derives explicit required categories and passes only with environment and every category', async () => {
    const value = await fixture(['performance', 'requirement', 'requirement']);
    expect(
      deriveRequiredProductOutcomeSpecialistCategories(
        value.contract,
        value.intent,
        'scenario-web',
      ),
    ).toEqual(['environment', 'performance', 'requirement']);
    const receipts = ['requirement', 'environment', 'performance'].map((category) =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, category as ProductOutcomeSpecialistCategory),
      ),
    );
    const judgment = await judgeProductOutcome(input(value, receipts));
    expect(judgment).toMatchObject({
      schemaVersion: PRODUCT_OUTCOME_JUDGMENT_SCHEMA_VERSION,
      status: 'PASS',
      reason: 'all-required-evidence-passed',
      evidenceAuthority: 'production',
      requiredCategories: ['environment', 'performance', 'requirement'],
    });
    expect(judgment.includedReceiptSha256s).toEqual(
      receipts.map(({ receiptSha256 }) => receiptSha256).sort(),
    );
  });

  it('does not allow build/test or requirement evidence to substitute for environment evidence', async () => {
    const value = await fixture(['requirement']);
    const requirement = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'requirement'),
    );
    expect(await judgeProductOutcome(input(value, [requirement]))).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'required-specialist-missing',
    });
  });

  it('rejects a rehashed forged runner PASS with erased assertions, artifacts, and scenario receipt', async () => {
    const value = await fixture(['requirement']);
    const forgedWithoutHash = {
      ...value.resultReceipt,
      assertionResults: [],
      artifacts: [],
      scenarioExecutionSha256: null,
    };
    const forged = {
      ...forgedWithoutHash,
      resultSha256: hashProductOutcomePayload(forgedWithoutHash),
    };
    await expect(
      judgeProductOutcome({ ...input(value, []), runnerResult: forged }),
    ).rejects.toThrow(ProductOutcomeJudgeValidationError);
  });

  it('fails closed on duplicate or mismatched receipts and downgrades stale evidence', async () => {
    const value = await fixture(['requirement']);
    const environment = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'environment'),
    );
    await expect(judgeProductOutcome(input(value, [environment, environment]))).rejects.toThrow(
      ProductOutcomeJudgeValidationError,
    );
    const mismatched = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'requirement', { executionId: 'execution-other' }),
    );
    await expect(judgeProductOutcome(input(value, [environment, mismatched]))).rejects.toThrow(
      ProductOutcomeJudgeValidationError,
    );
    const stale = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'requirement', { expiresAt: '2026-09-04T00:09:00.000Z' }),
    );
    expect(await judgeProductOutcome(input(value, [environment, stale]))).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'specialist-evidence-stale',
    });
  });

  it('lets applicable nonrequired evidence fail or unverify, and never upgrades test-only authority', async () => {
    const value = await fixture(['requirement']);
    const required = ['environment', 'requirement'].map((category) =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, category as ProductOutcomeSpecialistCategory),
      ),
    );
    const failed = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'security', {
        status: 'FAIL',
        negativePaths: ['security-check-failed'],
      }),
    );
    expect(await judgeProductOutcome(input(value, [...required, failed]))).toMatchObject({
      status: 'FAIL',
      reason: 'negative-path-observed',
    });
    const unverified = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'release', { status: 'UNVERIFIED' }),
    );
    expect(await judgeProductOutcome(input(value, [...required, unverified]))).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'specialist-unverified',
    });
    const testOnly = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'visual', { applicable: false, evidenceAuthority: 'test-only' }),
    );
    expect(await judgeProductOutcome(input(value, [...required, testOnly]))).toMatchObject({
      status: 'PASS',
      evidenceAuthority: 'test-only',
    });
  });

  it('always routes canonical subjective-game signals to human review', async () => {
    const value = await fixture(['requirement', 'subjective-game']);
    const receipts = ['environment', 'requirement'].map((category) =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, category as ProductOutcomeSpecialistCategory),
      ),
    );
    expect(await judgeProductOutcome(input(value, receipts))).toMatchObject({
      status: 'REQUIRES_HUMAN_REVIEW',
      reason: 'subjective-human-review-required',
    });
  });

  it('requires an injected specialist authority and lets trusted failure constrain runner human review', async () => {
    const value = await fixture(['requirement']);
    const required = ['environment', 'requirement'].map((category) =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, category as ProductOutcomeSpecialistCategory),
      ),
    );
    const noVerifier = input(value, required);
    delete noVerifier.verifySpecialistReceipt;
    expect(await judgeProductOutcome(noVerifier)).toMatchObject({
      status: 'UNVERIFIED',
      reason: 'specialist-unverified',
    });
    const humanValue = await fixture(['requirement', 'subjective-game']);
    const humanRequired = ['environment', 'requirement'].map((category) =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(humanValue, category as ProductOutcomeSpecialistCategory),
      ),
    );
    const failed = createProductOutcomeSpecialistReceipt(
      specialistInput(humanValue, 'security', {
        status: 'FAIL',
        negativePaths: ['security-failed'],
      }),
    );
    expect(await judgeProductOutcome(input(humanValue, [...humanRequired, failed]))).toMatchObject({
      status: 'FAIL',
      reason: 'negative-path-observed',
    });
  });

  it('recomputes judgments and rejects rehashed status, category, hash, and authority forgeries', async () => {
    const value = await fixture(['requirement']);
    const receipts = ['environment', 'requirement'].map((category) =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, category as ProductOutcomeSpecialistCategory),
      ),
    );
    const context = input(value, receipts);
    const judgment = await judgeProductOutcome(context);
    expect(await parseProductOutcomeJudgment(judgment, context)).toEqual(judgment);
    for (const patch of [
      { status: 'FAIL', reason: 'specialist-failed' },
      { requiredCategories: ['environment'] },
      { includedReceiptSha256s: [receipts[0]!.receiptSha256] },
      { evidenceAuthority: 'test-only' },
    ]) {
      const forgedWithoutHash = { ...judgment, ...patch };
      delete (forgedWithoutHash as Partial<typeof forgedWithoutHash>).judgmentSha256;
      const forged = {
        ...forgedWithoutHash,
        judgmentSha256: hashProductOutcomePayload(forgedWithoutHash),
      };
      await expect(parseProductOutcomeJudgment(forged, context)).rejects.toThrow(
        ProductOutcomeJudgeValidationError,
      );
    }
  });

  it('canonicalizes collection order and rejects unknown, oversized, or secret-bearing inputs', async () => {
    const value = await fixture(['requirement']);
    const first = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'environment', {
        testRefs: [
          'mcp/src/product-factory/z.test.ts::test-z',
          'mcp/src/product-factory/a.test.ts::test-a',
        ],
      }),
    );
    const second = createProductOutcomeSpecialistReceipt(
      specialistInput(value, 'environment', {
        testRefs: [
          'mcp/src/product-factory/a.test.ts::test-a',
          'mcp/src/product-factory/z.test.ts::test-z',
        ],
      }),
    );
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(PRODUCT_OUTCOME_SPECIALIST_RECEIPT_SCHEMA_VERSION);
    expect(() => parseProductOutcomeSpecialistReceipt({ ...first, unknown: true })).toThrow(
      ProductOutcomeJudgeValidationError,
    );
    expect(() =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, 'environment', { limitations: ['password=do-not-log-this'] }),
      ),
    ).toThrow(ProductOutcomeJudgeValidationError);
    expect(() =>
      parseProductOutcomeSpecialistReceipt({
        ...first,
        limitations: ['x'.repeat(300_000)],
      }),
    ).toThrow(ProductOutcomeJudgeValidationError);
    expect(() =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, 'environment', { testRefs: ['/tmp/forged.test.ts::forged'] }),
      ),
    ).toThrow(ProductOutcomeJudgeValidationError);
    expect(() =>
      createProductOutcomeSpecialistReceipt(
        specialistInput(value, 'environment', { negativePaths: ['sk-abcdefghijklmnop'] }),
      ),
    ).toThrow(ProductOutcomeJudgeValidationError);
  });
});
