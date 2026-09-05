import { describe, expect, it } from 'vitest';
import { createEnvironmentAciDescriptor } from './environment-aci.js';
import { ProductIntentCreateInput, createProductIntent } from './product-intent.js';
import {
  PRODUCT_OUTCOME_CONTRACT_SCHEMA_VERSION,
  ProductOutcomeContractInput,
  ProductOutcomeContractValidationError,
  createProductOutcomeContract,
  parseProductOutcomeContract,
  validateProductOutcomeContractReferences,
} from './product-outcome-contract.js';

const NOW = '2026-09-04T00:00:00.000Z';

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
        preconditions: ['A cart exists.'],
        steps: ['Open checkout.', 'Confirm the order.'],
        expectedOutcomes: ['A confirmation is visible.'],
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

const operations = {
  observe: true,
  act: true,
  reset: true,
  snapshot: true,
  restore: true,
  runScenario: true,
  collectEvidence: true,
} as const;

function descriptor() {
  return createEnvironmentAciDescriptor({
    adapterId: 'adapter-web',
    environmentId: 'environment-shop',
    sessionId: 'session-shop',
    kind: 'web',
    operationTimeoutMs: 500,
    operations,
    actionKinds: ['click', 'navigate', 'type'],
    environment: { browser: 'chromium', viewport: { width: 1280, height: 720 } },
  });
}

function contractInput(): ProductOutcomeContractInput {
  return {
    contractId: 'contract-checkout',
    intent: { intentId: 'intent-shop', version: 1, hash: '0'.repeat(64) },
    desiredOutcomeIds: ['outcome-complete'],
    scenarioIds: ['scenario-web'],
    environment: {
      adapterId: 'adapter-web',
      environmentId: 'environment-shop',
      sessionId: 'session-shop',
      kind: 'web',
      environmentFingerprint: '0'.repeat(64),
      capabilityFingerprint: '0'.repeat(64),
    },
    evidenceAuthority: 'production',
    syntheticUser: false,
    journeys: [
      {
        scenarioId: 'scenario-web',
        desiredOutcomeIds: ['outcome-complete'],
        applicable: true,
        runnable: true,
        stateReason: null,
        actions: [
          { actionId: 'action-open', kind: 'navigate', payload: { path: '/checkout' } },
          { actionId: 'action-confirm', kind: 'click', payload: { target: 'confirm' } },
        ],
        assertions: [
          {
            id: 'assert-confirmed',
            category: 'requirement',
            subject: {
              kind: 'observation',
              actionId: 'action-confirm',
              path: ['screen'],
            },
            expected: { kind: 'string', operator: 'equals', value: 'confirmed' },
          },
          {
            id: 'assert-no-errors',
            category: 'reliability',
            subject: { kind: 'receipt', field: 'negative-path-count' },
            expected: { kind: 'number', operator: 'equals', value: 0 },
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
        negativePaths: ['target-not-found', 'checkout-error'],
        limitations: [],
      },
    ],
  };
}

function createValidContract() {
  const intent = createProductIntent(intentInput());
  const environment = descriptor();
  return {
    intent,
    environment,
    contract: createProductOutcomeContract(
      {
        ...contractInput(),
        intent: { intentId: intent.intentId, version: intent.version, hash: intent.hash },
        environment: {
          adapterId: environment.adapterId,
          environmentId: environment.environmentId,
          sessionId: environment.sessionId,
          kind: environment.kind,
          environmentFingerprint: environment.environmentFingerprint,
          capabilityFingerprint: environment.capabilityFingerprint,
        },
      },
      intent,
      environment,
    ),
  };
}

describe('product-outcome-contract/v1', () => {
  it('seals a canonical strict contract bound to exact intent and ACI descriptor identities', () => {
    const { contract, intent, environment } = createValidContract();
    expect(contract.schemaVersion).toBe(PRODUCT_OUTCOME_CONTRACT_SCHEMA_VERSION);
    expect(contract.intent).toEqual({
      intentId: intent.intentId,
      version: intent.version,
      hash: intent.hash,
    });
    expect(contract.environment).toMatchObject({
      adapterId: environment.adapterId,
      environmentId: environment.environmentId,
      kind: 'web',
      environmentFingerprint: environment.environmentFingerprint,
      capabilityFingerprint: environment.capabilityFingerprint,
    });
    expect(parseProductOutcomeContract(contract)).toEqual(contract);
    expect(contract.contractSha256).toMatch(/^[a-f0-9]{64}$/);

    const reordered = createProductOutcomeContract(
      {
        ...contractInput(),
        intent: contract.intent,
        environment: contract.environment,
        journeys: contract.journeys.map((journey) => ({
          ...journey,
          negativePaths: [...journey.negativePaths].reverse(),
          assertions: [...journey.assertions].reverse(),
        })),
      },
      intent,
      environment,
    );
    expect(reordered.contractSha256).toBe(contract.contractSha256);
  });

  it('rejects stale intent bindings and dangling or wrong scenario/outcome/platform/action references', () => {
    const { contract, intent, environment } = createValidContract();
    expect(() =>
      validateProductOutcomeContractReferences(
        { ...contract, intent: { ...contract.intent, version: 2 } },
        intent,
        environment,
      ),
    ).toThrow(ProductOutcomeContractValidationError);
    expect(() =>
      createProductOutcomeContract(
        { ...contractInput(), desiredOutcomeIds: ['outcome-missing'] },
        intent,
        environment,
      ),
    ).toThrow(/OUTCOME_REFERENCE_INVALID/);
    expect(() =>
      createProductOutcomeContract(
        { ...contractInput(), scenarioIds: ['scenario-missing'] },
        intent,
        environment,
      ),
    ).toThrow(/SCENARIO_REFERENCE_INVALID/);
    expect(() =>
      createProductOutcomeContract(
        {
          ...contractInput(),
          environment: { ...contractInput().environment, kind: 'android' },
        },
        intent,
        environment,
      ),
    ).toThrow(/ENVIRONMENT_BINDING_INVALID/);
    expect(() =>
      createProductOutcomeContract(
        {
          ...contractInput(),
          journeys: contractInput().journeys.map((journey) => ({
            ...journey,
            actions: [{ actionId: 'action-tap', kind: 'tap', payload: { target: 'confirm' } }],
          })),
        },
        intent,
        environment,
      ),
    ).toThrow(/ACTION_KIND_INVALID/);
  });

  it('uses finite typed assertions, forbids executable assertion strings, and fences subjective game claims', () => {
    const { intent, environment } = createValidContract();
    expect(() =>
      createProductOutcomeContract(
        {
          ...contractInput(),
          journeys: contractInput().journeys.map((journey) => ({
            ...journey,
            assertions: [
              {
                id: 'assert-code',
                category: 'security',
                code: 'return process.env.SECRET',
              },
            ] as never,
          })),
        },
        intent,
        environment,
      ),
    ).toThrow(ProductOutcomeContractValidationError);

    const human = createProductOutcomeContract(
      {
        ...contractInput(),
        evidenceAuthority: 'test-only',
        syntheticUser: true,
        journeys: contractInput().journeys.map((journey) => ({
          ...journey,
          assertions: [
            {
              id: 'assert-fun',
              category: 'subjective-game',
              boundary: 'fun',
              prompt: 'Is the interaction fun for the intended player?',
              expected: { kind: 'human-review' },
            },
          ],
        })),
      },
      intent,
      environment,
    );
    expect(human.evidenceAuthority).toBe('test-only');
    expect(human.syntheticUser).toBe(true);
    expect(() =>
      createProductOutcomeContract(
        { ...contractInput(), evidenceAuthority: 'production', syntheticUser: true },
        intent,
        environment,
      ),
    ).toThrow(/SYNTHETIC_USER_AUTHORITY_INVALID/);
  });

  it('fails closed for forged hashes, unknown fields, contradictory run state, and oversize values', () => {
    const { contract, intent, environment } = createValidContract();
    expect(() =>
      parseProductOutcomeContract({ ...contract, contractSha256: 'f'.repeat(64) }),
    ).toThrow(/CONTRACT_DIGEST_INVALID/);
    expect(() => parseProductOutcomeContract({ ...contract, unexpected: true })).toThrow(
      ProductOutcomeContractValidationError,
    );
    expect(() =>
      createProductOutcomeContract(
        {
          ...contractInput(),
          journeys: contractInput().journeys.map((journey) => ({
            ...journey,
            applicable: false,
            runnable: true,
            stateReason: null,
          })),
        },
        intent,
        environment,
      ),
    ).toThrow(/JOURNEY_STATE_INVALID/);
    expect(() =>
      parseProductOutcomeContract({
        ...contract,
        journeys: contract.journeys.map((journey) => ({
          ...journey,
          limitations: ['x'.repeat(300_000)],
        })),
      }),
    ).toThrow(/CONTRACT_SIZE_LIMIT/);
  });

  it('rejects identifier collisions across journey action, assertion, and evidence namespaces', () => {
    const { intent, environment } = createValidContract();
    expect(() =>
      createProductOutcomeContract(
        {
          ...contractInput(),
          journeys: contractInput().journeys.map((journey) => ({
            ...journey,
            assertions: [{ ...journey.assertions[0], id: 'action-confirm' }],
          })),
        },
        intent,
        environment,
      ),
    ).toThrow(/CONTRACT_RELATIONSHIP_INVALID/);
  });
});
