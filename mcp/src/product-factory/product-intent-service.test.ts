import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { IEventPublisher } from '../core/ports/IEventPublisher.js';
import { IStateRepository } from '../core/ports/IStateRepository.js';
import {
  PRODUCT_DELTA_SCHEMA_VERSION,
  ProductDelta,
  ProductIntent,
  ProductIntentCreateInput,
  StaleProductDeltaError,
  createProductIntent,
} from './product-intent.js';
import { PRODUCT_INTENT_UPDATED_EVENT, ProductIntentService } from './product-intent-service.js';

const NOW = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T01:00:00.000Z';
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forgewright-pf1-'));
  temporaryDirectories.push(directory);
  return directory;
}

function input(): ProductIntentCreateInput {
  return {
    intentId: 'intent-service',
    createdAt: NOW,
    problem: { id: 'problem-one', statement: 'Original problem.', evidenceRefs: [] },
    targetActors: [
      { id: 'actor-one', name: 'Actor', description: 'Primary actor.', evidenceRefs: [] },
    ],
    jobsToBeDone: [
      {
        id: 'job-one',
        actorIds: ['actor-one'],
        statement: 'Complete the scenario.',
        desiredOutcomeIds: ['outcome-one'],
      },
    ],
    desiredOutcomes: [{ id: 'outcome-one', statement: 'Outcome.', acceptanceRefs: ['accept-one'] }],
    constraints: [],
    nonGoals: [],
    preferences: [],
    scenarios: [
      {
        id: 'scenario-one',
        name: 'Scenario',
        platform: 'cross-platform',
        actorIds: ['actor-one'],
        jobIds: ['job-one'],
        outcomeIds: ['outcome-one'],
        preconditions: [],
        steps: ['Act.'],
        expectedOutcomes: ['Outcome occurs.'],
      },
    ],
    uncertainty: [],
    decisions: [],
    acceptanceRefs: [
      { id: 'accept-one', statement: 'The scenario outcome is observed.', evidenceRef: null },
    ],
    provenance: [
      {
        id: 'source-user',
        source: 'current-explicit-user',
        reference: 'Current request.',
        observedAt: NOW,
        current: true,
        approved: true,
      },
    ],
    goalGraph: {
      nodes: [
        { id: 'goal-outcome', type: 'outcome', statement: 'Outcome.', intentRef: 'outcome-one' },
        { id: 'goal-capability', type: 'capability', statement: 'Capability.', intentRef: null },
        {
          id: 'goal-scenario',
          type: 'scenario',
          statement: 'Scenario.',
          intentRef: 'scenario-one',
        },
      ],
      edges: [
        { id: 'edge-one', from: 'goal-outcome', to: 'goal-capability' },
        { id: 'edge-two', from: 'goal-capability', to: 'goal-scenario' },
      ],
    },
  };
}

function delta(base: ProductIntent, id: string, statement: string): ProductDelta {
  return {
    schemaVersion: PRODUCT_DELTA_SCHEMA_VERSION,
    deltaId: id,
    intentId: base.intentId,
    baseVersion: base.version,
    baseHash: base.hash,
    recordedAt: LATER,
    operations: [{ kind: 'set-problem', problem: { ...base.problem, statement } }],
  };
}

class EventRecorder implements IEventPublisher {
  readonly events: Array<{ name: string; payload: unknown }> = [];

  publish(name: string, payload: unknown): void {
    this.events.push({ name, payload });
  }
}

describe('ProductIntentService', () => {
  it('atomically rejects one of two concurrent deltas from the same base and publishes only commits', async () => {
    const directory = workspace();
    const events = new EventRecorder();
    const firstService = ProductIntentService.forWorkspace(directory, events);
    const secondService = ProductIntentService.forWorkspace(directory, events);
    const base = await firstService.initialize(input());

    const results = await Promise.allSettled([
      firstService.applyDelta(delta(base, 'delta-first', 'First change.')),
      secondService.applyDelta(delta(base, 'delta-second', 'Second change.')),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(StaleProductDeltaError),
    });
    const persisted = await firstService.load();
    expect(persisted?.version).toBe(2);
    expect(events.events).toHaveLength(2);
    expect(events.events.every(({ name }) => name === PRODUCT_INTENT_UPDATED_EVENT)).toBe(true);
  });

  it('does not publish when persistence rejects the transaction', async () => {
    const events = new EventRecorder();
    const repository: IStateRepository<ProductIntent> = {
      load: async () => null,
      save: async () => undefined,
      update: async () => undefined,
      transact: async () => {
        throw new Error('disk failure');
      },
    };
    const service = new ProductIntentService(repository, events);
    await expect(service.initialize(input())).rejects.toThrow('disk failure');
    expect(events.events).toEqual([]);
  });

  it('publishes only after the repository has committed', async () => {
    const expected = createProductIntent(input());
    let committed = false;
    const repository: IStateRepository<ProductIntent> = {
      load: async () => expected,
      save: async () => undefined,
      update: async () => undefined,
      transact: async (mutator) => {
        const next = await mutator(null);
        committed = true;
        return next;
      },
    };
    const events: IEventPublisher = {
      publish: () => expect(committed).toBe(true),
    };
    await new ProductIntentService(repository, events).initialize(expected);
  });

  it('returns the durable commit when publishing fails and reports delivery diagnostics', async () => {
    const directory = workspace();
    const setup = ProductIntentService.forWorkspace(directory, new EventRecorder());
    const base = await setup.initialize(input());
    const diagnostics: unknown[] = [];
    const service = ProductIntentService.forWorkspace(
      directory,
      {
        publish: () => {
          throw new Error('publisher unavailable');
        },
      },
      {},
      {
        onEventDeliveryFailure: (failure) => diagnostics.push(failure),
      },
    );

    const committed = await service.applyDelta(
      delta(base, 'delta-publish-fails', 'Committed change.'),
    );
    expect(committed.version).toBe(2);
    expect((await service.load())?.hash).toBe(committed.hash);
    expect(diagnostics).toHaveLength(1);
    expect(service.getLastEventDeliveryFailure()).toMatchObject({
      eventName: PRODUCT_INTENT_UPDATED_EVENT,
      intentId: committed.intentId,
      version: 2,
    });
    await expect(
      service.applyDelta(delta(base, 'delta-unsafe-retry', 'Unsafe retry.')),
    ).rejects.toThrow(StaleProductDeltaError);
  });

  it('fails closed when persisted state is malformed or exceeds the repository bound', async () => {
    const malformedWorkspace = workspace();
    fs.mkdirSync(path.join(malformedWorkspace, '.forgewright'));
    fs.writeFileSync(
      path.join(malformedWorkspace, '.forgewright', 'product-intent.json'),
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        state: { schemaVersion: 'product-intent/v2' },
      }),
    );
    await expect(
      ProductIntentService.forWorkspace(malformedWorkspace, new EventRecorder()).load(),
    ).rejects.toThrow();

    const oversizeWorkspace = workspace();
    fs.mkdirSync(path.join(oversizeWorkspace, '.forgewright'));
    fs.writeFileSync(
      path.join(oversizeWorkspace, '.forgewright', 'product-intent.json'),
      'x'.repeat(2048),
    );
    await expect(
      ProductIntentService.forWorkspace(oversizeWorkspace, new EventRecorder(), {
        maxStateBytes: 1024,
      }).load(),
    ).rejects.toThrow(/size limit/);
  });
});
