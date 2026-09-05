import { describe, expect, it } from 'vitest';
import {
  AuthorityConflictError,
  PRODUCT_DELTA_SCHEMA_VERSION,
  PRODUCT_INTENT_SCHEMA_VERSION,
  ProductDelta,
  ProductIntentCreateInput,
  ProductIntentValidationError,
  StaleProductDeltaError,
  applyProductDelta,
  createProductIntent,
  evaluateClarificationGate,
  parseProductIntent,
  projectLegacyGoals,
  resolveAuthority,
  stableSafeId,
  validateProductGoalGraph,
} from './product-intent.js';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T01:00:00.000Z';

function makeInput(): ProductIntentCreateInput {
  return {
    intentId: 'intent-shop',
    createdAt: NOW,
    problem: { id: 'problem-checkout', statement: 'Checkout is confusing.', evidenceRefs: [] },
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
        statement: 'Buy an item confidently.',
        desiredOutcomeIds: ['outcome-complete'],
      },
    ],
    desiredOutcomes: [
      {
        id: 'outcome-complete',
        statement: 'Buyer completes checkout.',
        acceptanceRefs: ['accept-checkout'],
      },
    ],
    constraints: [],
    nonGoals: [],
    preferences: [
      { id: 'preference-tone', key: 'tone', value: 'calm', authorityRef: 'source-user' },
    ],
    scenarios: [
      {
        id: 'scenario-web',
        name: 'Web checkout',
        platform: 'web',
        actorIds: ['actor-buyer'],
        jobIds: ['job-buy'],
        outcomeIds: ['outcome-complete'],
        preconditions: ['Cart has an item.'],
        steps: ['Open checkout.', 'Confirm purchase.'],
        expectedOutcomes: ['Order is confirmed.'],
      },
      {
        id: 'scenario-mobile',
        name: 'Mobile checkout',
        platform: 'mobile',
        actorIds: ['actor-buyer'],
        jobIds: ['job-buy'],
        outcomeIds: ['outcome-complete'],
        preconditions: [],
        steps: ['Open the app checkout.'],
        expectedOutcomes: ['Order is confirmed.'],
      },
      {
        id: 'scenario-game',
        name: 'Game shop checkout',
        platform: 'game',
        actorIds: ['actor-buyer'],
        jobIds: ['job-buy'],
        outcomeIds: ['outcome-complete'],
        preconditions: [],
        steps: ['Open the in-game shop.'],
        expectedOutcomes: ['Order is confirmed.'],
      },
    ],
    uncertainty: [
      {
        id: 'unknown-provider',
        statement: 'Which identity provider is required?',
        decisionImpact: 'public-contract',
        evidenceRefs: [],
        reversible: false,
        safeDefault: null,
        researchable: false,
        owner: 'product-owner',
        resolutionState: 'unresolved',
        resolution: null,
        resolutionAuthorityRef: null,
      },
    ],
    decisions: [],
    acceptanceRefs: [{ id: 'accept-checkout', statement: 'Checkout succeeds.', evidenceRef: null }],
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
          statement: 'Complete checkout.',
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
          statement: 'Web checkout scenario.',
          intentRef: 'scenario-web',
        },
        { id: 'goal-feature', type: 'feature', statement: 'Confirmation UI.', intentRef: null },
        { id: 'goal-evidence', type: 'evidence', statement: 'Runtime receipt.', intentRef: null },
        { id: 'goal-metric', type: 'metric', statement: 'Completion rate.', intentRef: null },
      ],
      edges: [
        { id: 'edge-outcome-capability', from: 'goal-outcome', to: 'goal-capability' },
        { id: 'edge-capability-scenario', from: 'goal-capability', to: 'goal-scenario' },
        { id: 'edge-scenario-feature', from: 'goal-scenario', to: 'goal-feature' },
        { id: 'edge-scenario-evidence', from: 'goal-scenario', to: 'goal-evidence' },
        { id: 'edge-scenario-metric', from: 'goal-scenario', to: 'goal-metric' },
      ],
    },
  };
}

function makeDelta(base: ReturnType<typeof createProductIntent>): ProductDelta {
  return {
    schemaVersion: PRODUCT_DELTA_SCHEMA_VERSION,
    deltaId: 'delta-problem',
    intentId: base.intentId,
    baseVersion: base.version,
    baseHash: base.hash,
    recordedAt: LATER,
    operations: [
      {
        kind: 'set-problem',
        problem: { ...base.problem, statement: 'Checkout lacks confidence cues.' },
      },
    ],
  };
}

describe('product-intent/v1', () => {
  it('creates stable safe IDs and canonical intent hashes independent of keyed collection order', () => {
    expect(stableSafeId('actor', 'Power User')).toBe(stableSafeId('actor', 'Power User'));
    expect(stableSafeId('actor', 'Power User')).toMatch(/^[a-z0-9-]+$/);
    expect(stableSafeId('abcdefghijklmno-rest', '12345678901234567890123456789-rest')).toMatch(
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    );

    const input = makeInput();
    const first = createProductIntent(input);
    const second = createProductIntent({
      ...input,
      scenarios: [...input.scenarios].reverse(),
      goalGraph: {
        nodes: [...input.goalGraph.nodes].reverse(),
        edges: [...input.goalGraph.edges].reverse(),
      },
    });
    expect(first.hash).toBe(second.hash);
    expect(second.scenarios.map(({ id }) => id)).toEqual([
      'scenario-game',
      'scenario-mobile',
      'scenario-web',
    ]);
    expect(first.schemaVersion).toBe(PRODUCT_INTENT_SCHEMA_VERSION);
  });

  it('fails closed for unknown fields, versions, malformed relationships, hash tampering, and oversize state', () => {
    const valid = createProductIntent(makeInput());
    expect(() => parseProductIntent({ ...valid, unexpected: true })).toThrow(
      ProductIntentValidationError,
    );
    expect(() => parseProductIntent({ ...valid, schemaVersion: 'product-intent/v2' })).toThrow(
      ProductIntentValidationError,
    );
    expect(() =>
      createProductIntent({
        ...makeInput(),
        jobsToBeDone: [{ ...makeInput().jobsToBeDone[0], actorIds: ['actor-missing'] }],
      }),
    ).toThrow(/dangling reference/);
    expect(() => parseProductIntent({ ...valid, hash: 'f'.repeat(64) })).toThrow(/hash/);
    expect(() =>
      parseProductIntent({
        ...valid,
        problem: { ...valid.problem, statement: 'x'.repeat(300_000) },
      }),
    ).toThrow(/size limit/);
  });

  it('requires all routing-critical collections and globally unique entity IDs', () => {
    const required = [
      'targetActors',
      'jobsToBeDone',
      'desiredOutcomes',
      'scenarios',
      'acceptanceRefs',
    ] as const;
    for (const field of required) {
      expect(() => createProductIntent({ ...makeInput(), [field]: [] })).toThrow(
        ProductIntentValidationError,
      );
    }
    expect(() =>
      createProductIntent({ ...makeInput(), goalGraph: { nodes: [], edges: [] } }),
    ).toThrow(ProductIntentValidationError);
    expect(() =>
      createProductIntent({
        ...makeInput(),
        targetActors: [{ ...makeInput().targetActors[0], id: 'problem-checkout' }],
        jobsToBeDone: [{ ...makeInput().jobsToBeDone[0], actorIds: ['problem-checkout'] }],
        scenarios: makeInput().scenarios.map((scenario) => ({
          ...scenario,
          actorIds: ['problem-checkout'],
        })),
      }),
    ).toThrow(/globally unique/);
  });

  it('uses the exact authority order and never promotes stale memory or model prior', () => {
    const resolution = resolveAuthority([
      {
        id: 'memory-later',
        source: 'stale-memory',
        value: 'red',
        observedAt: LATER,
        current: true,
        approved: true,
      },
      {
        id: 'truth-current',
        source: 'approved-project-truth',
        value: 'blue',
        observedAt: NOW,
        current: true,
        approved: true,
      },
      {
        id: 'user-current',
        source: 'current-explicit-user',
        value: 'green',
        observedAt: NOW,
        current: true,
        approved: true,
      },
      {
        id: 'model-later',
        source: 'model-prior',
        value: 'purple',
        observedAt: LATER,
        current: true,
        approved: true,
      },
    ]);
    expect(resolution).toEqual({
      value: 'green',
      authorityId: 'user-current',
      source: 'current-explicit-user',
    });
    expect(
      resolveAuthority([
        {
          id: 'memory-only',
          source: 'stale-memory',
          value: 'red',
          observedAt: LATER,
          current: true,
          approved: true,
        },
      ]),
    ).toBeNull();
  });

  it('fails closed on irreducible equal-authority preference conflicts', () => {
    expect(() =>
      resolveAuthority([
        {
          id: 'user-a',
          source: 'current-explicit-user',
          value: 'compact',
          observedAt: NOW,
          current: true,
          approved: true,
        },
        {
          id: 'user-b',
          source: 'current-explicit-user',
          value: 'spacious',
          observedAt: NOW,
          current: true,
          approved: true,
        },
      ]),
    ).toThrow(AuthorityConflictError);
  });

  it('strictly validates bounded authority candidates before resolving them', () => {
    const valid = {
      id: 'user-valid',
      source: 'current-explicit-user' as const,
      value: 'compact',
      observedAt: NOW,
      current: true,
      approved: true,
    };
    expect(() => resolveAuthority([{ ...valid, observedAt: '2026-09-04' }])).toThrow(
      ProductIntentValidationError,
    );
    expect(() => resolveAuthority([{ ...valid, current: 'true' as unknown as boolean }])).toThrow(
      ProductIntentValidationError,
    );
    expect(() => resolveAuthority([{ ...valid, extra: true } as typeof valid])).toThrow(
      ProductIntentValidationError,
    );
    expect(() =>
      resolveAuthority(Array.from({ length: 257 }, (_, index) => ({ ...valid, id: `u-${index}` }))),
    ).toThrow(ProductIntentValidationError);
  });

  it('asks for a vague decision-changing unknown, but respects delegation, safe defaults, research, and irrelevance', () => {
    const unknown = makeInput().uncertainty[0];
    expect(evaluateClarificationGate([unknown])).toEqual({
      shouldAsk: true,
      questions: [{ uncertaintyId: unknown.id, question: unknown.statement }],
    });
    expect(evaluateClarificationGate([unknown], 'You decide.')).toEqual({
      shouldAsk: false,
      questions: [],
    });
    expect(evaluateClarificationGate([unknown], 'Please, use your judgment!').shouldAsk).toBe(
      false,
    );
    for (const directive of [
      'If you decide, tell me why.',
      'Do not say "you decide."',
      '"You decide."',
      'You decide this one after asking me.',
      "You don't decide.",
    ]) {
      expect(evaluateClarificationGate([unknown], directive).shouldAsk).toBe(true);
    }
    expect(
      evaluateClarificationGate([
        { ...unknown, id: 'unknown-irrelevant', decisionImpact: 'none' },
        {
          ...unknown,
          id: 'unknown-default',
          safeDefault: 'Use the established project convention.',
        },
        { ...unknown, id: 'unknown-researchable', researchable: true },
        { ...unknown, id: 'unknown-reversible', reversible: true },
      ]),
    ).toEqual({ shouldAsk: false, questions: [] });
  });

  it('applies a deterministic delta without rebuilding unrelated current truth and rejects stale/history rewriting input', () => {
    const current = createProductIntent(makeInput());
    const delta = makeDelta(current);
    const updated = applyProductDelta(current, delta);
    expect(updated.problem.statement).toBe('Checkout lacks confidence cues.');
    expect(updated.targetActors).toEqual(current.targetActors);
    expect(updated.scenarios).toEqual(current.scenarios);
    expect(updated.version).toBe(2);
    expect(updated.hash).not.toBe(current.hash);
    expect(applyProductDelta(current, delta)).toEqual(updated);
    expect(() => applyProductDelta(updated, delta)).toThrow(StaleProductDeltaError);
    expect(() =>
      applyProductDelta(current, {
        ...delta,
        operations: [{ kind: 'rewrite-history', version: 99 }],
      }),
    ).toThrow(ProductIntentValidationError);
    expect(() =>
      applyProductDelta(current, {
        ...delta,
        operations: [
          {
            kind: 'upsert-item',
            collection: 'targetActors',
            value: current.scenarios[0],
          },
        ],
      }),
    ).toThrow(ProductIntentValidationError);
    expect(() =>
      applyProductDelta(current, {
        ...delta,
        operations: [{ kind: 'remove-item', collection: 'targetActors', id: 'actor-buyer' }],
      }),
    ).toThrow(/dangling reference/);
  });

  it('persists eligible resolution authority and rejects stale, ineligible, or repeated resolution', () => {
    const current = createProductIntent(makeInput());
    const resolved = applyProductDelta(current, {
      ...makeDelta(current),
      operations: [
        {
          kind: 'resolve-uncertainty',
          id: 'unknown-provider',
          resolution: 'Use the current user choice.',
          authorityRef: 'source-user',
        },
      ],
    });
    expect(resolved.uncertainty[0]).toMatchObject({
      resolutionState: 'resolved',
      resolutionAuthorityRef: 'source-user',
    });
    expect(() =>
      applyProductDelta(resolved, {
        ...makeDelta(resolved),
        deltaId: 'delta-repeat-resolution',
        recordedAt: '2026-09-04T02:00:00.000Z',
        operations: [
          {
            kind: 'resolve-uncertainty',
            id: 'unknown-provider',
            resolution: 'Rewrite it.',
            authorityRef: 'source-user',
          },
        ],
      }),
    ).toThrow(/already resolved/);

    for (const source of ['stale-memory', 'model-prior'] as const) {
      const staleInput = makeInput();
      staleInput.provenance.push({
        id: `source-${source}`,
        source,
        reference: 'Non-authoritative prior.',
        observedAt: NOW,
        current: true,
        approved: true,
      });
      const withStale = createProductIntent(staleInput);
      expect(() =>
        applyProductDelta(withStale, {
          ...makeDelta(withStale),
          operations: [
            {
              kind: 'resolve-uncertainty',
              id: 'unknown-provider',
              resolution: 'Use an ineligible prior.',
              authorityRef: `source-${source}`,
            },
          ],
        }),
      ).toThrow(/ineligible authority/);
    }
    expect(() =>
      applyProductDelta(current, {
        ...makeDelta(current),
        operations: [
          {
            kind: 'resolve-uncertainty',
            id: 'unknown-provider',
            resolution: 'Use missing authority.',
            authorityRef: 'source-missing',
          },
        ],
      }),
    ).toThrow(/dangling/);

    const missingResolutionAuthority = makeInput() as unknown as Record<string, unknown>;
    missingResolutionAuthority.uncertainty = [
      {
        ...makeInput().uncertainty[0],
        resolutionState: 'resolved',
        resolution: 'Resolved without authority.',
        resolutionAuthorityRef: null,
      },
    ];
    expect(() => createProductIntent(missingResolutionAuthority as never)).toThrow(
      ProductIntentValidationError,
    );
  });

  it('rejects future-dated provenance and decisions relative to current truth or delta time', () => {
    const futureInput = makeInput();
    futureInput.provenance[0] = {
      ...futureInput.provenance[0],
      observedAt: '2026-09-05T00:00:00.000Z',
    };
    expect(() => createProductIntent(futureInput)).toThrow(/future/);

    const current = createProductIntent(makeInput());
    expect(() =>
      applyProductDelta(current, {
        ...makeDelta(current),
        operations: [
          {
            kind: 'record-decision',
            decision: {
              id: 'decision-future',
              statement: 'Future decision.',
              rationale: 'Invalid future claim.',
              authorityRef: 'source-user',
              decidedAt: '2026-09-05T00:00:00.000Z',
            },
          },
        ],
      }),
    ).toThrow(/future/);
    expect(() =>
      applyProductDelta(current, {
        ...makeDelta(current),
        operations: [
          {
            kind: 'record-provenance',
            provenance: {
              id: 'source-future',
              source: 'authoritative-research',
              reference: 'Future research.',
              observedAt: '2026-09-05T00:00:00.000Z',
              current: true,
              approved: true,
            },
          },
        ],
      }),
    ).toThrow(/future/);
  });

  it('rejects duplicate nodes, dangling edges, illegal edges, and cycles', () => {
    const graph = makeInput().goalGraph;
    expect(() =>
      validateProductGoalGraph({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }),
    ).toThrow(/duplicate id/);
    expect(() =>
      validateProductGoalGraph({
        ...graph,
        edges: [...graph.edges, { id: 'edge-dangling', from: 'goal-outcome', to: 'goal-missing' }],
      }),
    ).toThrow(/dangling/);
    expect(() =>
      validateProductGoalGraph({
        ...graph,
        edges: [...graph.edges, { id: 'edge-illegal', from: 'goal-outcome', to: 'goal-feature' }],
      }),
    ).toThrow(/Illegal/);
    expect(() =>
      validateProductGoalGraph({
        ...graph,
        edges: [...graph.edges, { id: 'edge-cycle', from: 'goal-feature', to: 'goal-outcome' }],
      }),
    ).toThrow(/cycle/);
    expect(() =>
      validateProductGoalGraph({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === 'goal-feature' ? { ...node, intentRef: 'feature-missing' } : node,
        ),
      }),
    ).toThrow(/intentRef/);
  });

  it('projects one domain-neutral graph read-only for legacy goal and pipeline consumers', () => {
    const intent = createProductIntent(makeInput());
    const projection = projectLegacyGoals(intent);
    expect(projection.currentGoal).toBe(intent.problem.statement);
    expect(projection.phases.map(({ key }) => key)).toEqual([
      'outcomes',
      'capabilities',
      'scenarios',
      'delivery',
    ]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(intent.scenarios.map(({ platform }) => platform).sort()).toEqual([
      'game',
      'mobile',
      'web',
    ]);
  });
});
