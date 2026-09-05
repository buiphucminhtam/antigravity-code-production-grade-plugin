import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TrajectoryLedger, canonicalJson } from '../runtime/trajectory-ledger.js';
import {
  CANDIDATE_LESSON_SCHEMA_VERSION,
  InMemoryLearningRegistryRepository,
  LEARNING_FOUNDRY_SCHEMA_VERSION,
  LearningFoundry,
  LearningFoundryError,
  clusterAndDedupeTrajectorySummaries,
  createCandidateLesson,
  createEmptyLearningRegistry,
  createForgeBenchPromotionProjection,
  createIndependentReviewReceipt,
  createOfflineReplayReceipt,
  hashLearningFoundryPayload,
  incrementCandidateLessonCounters,
  issueLocalTestLearningHostCapability,
  parseCandidateLesson,
  parseLearningRegistry,
  parseSanitizedTrajectorySummary,
  type ForgeBenchPromotionProjectionInput,
  type LearningExecutionMode,
  type LearningRegistry,
  type LearningRegistryRepository,
  type TrustedLearningHostCapability,
} from './learning-foundry.js';

const roots: string[] = [];
let registrySequence = 0;
const digest = (label: string) => createHash('sha256').update(label).digest('hex');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function receiptDigest(summary: Record<string, unknown>, sequence: number, hash: string) {
  return createHash('sha256')
    .update(canonicalJson({ ...summary, predecessorTip: { sequence, hash } }), 'utf8')
    .digest('hex');
}

async function terminalLedger(
  options: {
    terminal?: boolean;
    quiescence?: 'confirmed' | 'not_confirmed';
    origin?: string;
    terminalAt?: number;
    finalizationStarted?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'learning-foundry-'));
  roots.push(root);
  const ledger = new TrajectoryLedger({ root, ledgerId: `trajectory-${roots.length}` });
  const opened = await ledger.append({
    eventId: 'opened',
    kind: 'trajectory.opened',
    occurredAtMs: 1,
    causalEventIds: [],
    payload: {
      objectiveDigest: digest('objective'),
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      origin: options.origin ?? 'test-only',
      writerEpoch: 1,
      rootScopeId: 'root-scope',
    },
  });
  if (options.terminal === false) return { ledger, tip: await ledger.tip() };
  const started =
    options.finalizationStarted === false
      ? opened
      : await ledger.append({
          eventId: 'finalization-started',
          kind: 'finalization.started',
          occurredAtMs: 2,
          causalEventIds: ['opened'],
          payload: { reasonCode: 'complete', deadlineAtMs: 100 },
        });
  const quiescence = options.quiescence ?? 'confirmed';
  const receiptSummary = {
    status: 'complete' as const,
    disposedCount: 0,
    failedDisposerCount: 0,
    timedOutDisposerCount: 0,
    unresolvedOperationCount: 0,
    unresolvedScopeCount: 0,
    unresolvedDisposerCount: 0,
    deadlineAtMs: 100,
    quiescence,
  };
  await ledger.append({
    eventId: 'finalization-receipt',
    kind: 'finalization.receipt',
    occurredAtMs: 3,
    causalEventIds: [started.event.eventId],
    payload: {
      ...receiptSummary,
      predecessorSequence: started.tip.sequence,
      predecessorHash: started.tip.hash!,
      receiptDigest: receiptDigest(receiptSummary, started.tip.sequence, started.tip.hash!),
    },
  });
  await ledger.append({
    eventId: 'terminal',
    kind: 'trajectory.terminal',
    occurredAtMs: options.terminalAt ?? 4,
    causalEventIds: ['finalization-receipt'],
    payload: {
      outcome: 'completed',
      summaryDigest: digest('summary'),
      cleanupOutcome: 'completed',
      quiescence,
      receiptEventId: 'finalization-receipt',
    },
  });
  return { ledger, tip: await ledger.tip() };
}

async function capability(registryId: string) {
  return issueLocalTestLearningHostCapability({
    registryId,
    issuerId: 'trusted-host-issuer',
    verifierId: 'forge-bench-verifier',
  });
}

function service(
  repository: LearningRegistryRepository,
  hostCapability: TrustedLearningHostCapability,
  mode: LearningExecutionMode = 'maintenance',
  config: { now?: () => number; freshnessHorizonMs?: number } = {},
) {
  return new LearningFoundry({
    mode,
    implementerId: 'implementer-one',
    freshnessHorizonMs: config.freshnessHorizonMs ?? 10,
    now: config.now ?? (() => 4),
    repository,
    hostCapability,
    comparisonVerifier: async (projection) => structuredClone(projection),
    reviewVerifier: async (review) => structuredClone(review),
  });
}

async function lessonFixture(overrides: { usefulCount?: number; harmfulCount?: number } = {}) {
  const registryId = `learning-registry-${++registrySequence}`;
  const registry = createEmptyLearningRegistry(registryId);
  const repository = new InMemoryLearningRegistryRepository(registry);
  const hostCapability = await capability(registryId);
  const foundry = service(repository, hostCapability);
  const { ledger, tip } = await terminalLedger();
  const summary = await foundry.summarizeTrajectory({ ledger, expectedTip: tip });
  const dimensions = {
    rootCause: 'cleanup ordering defect',
    correction: 'settle cleanup before reporting completion',
    applicability: { appliesTo: ['runtime.cleanup'], excludes: ['runtime.read-only'] },
    productScope: 'product.runtime',
  };
  const [cluster] = clusterAndDedupeTrajectorySummaries(
    [summary, structuredClone(summary)],
    dimensions,
  );
  const candidate = createCandidateLesson({
    cluster,
    ...dimensions,
    sourceVerifierSha256s: [digest('verifier')],
    usefulCount: overrides.usefulCount ?? 2,
    harmfulCount: overrides.harmfulCount ?? 0,
    baseRegistryId: registry.registryId,
    baseRegistryRevision: registry.revision,
    baseRegistrySha256: registry.registrySha256,
    baseIntelligenceVersion: registry.active.version,
    baseIntelligenceSha256: registry.active.sha256,
  });
  return { registry, repository, hostCapability, summary, cluster, candidate, dimensions };
}

async function promotionBundle(
  overrides: Partial<ForgeBenchPromotionProjectionInput> = {},
  lessonOverrides: { usefulCount?: number; harmfulCount?: number } = {},
) {
  const fixture = await lessonFixture(lessonOverrides);
  const projection = createForgeBenchPromotionProjection({
    comparisonSha256: digest('comparison'),
    suiteSha256: digest('suite'),
    baselineReportSha256: digest('baseline'),
    candidateReportSha256: digest('candidate-report'),
    evidenceAuthority: 'test-only',
    thresholdsVerified: true,
    promotionEligible: true,
    protectedSafetyPreserved: true,
    protectedFalseSuccessPreserved: true,
    outcomeDelta: 0.125,
    nonRegressionSummarySha256: digest('non-regression'),
    verifierId: 'forge-bench-verifier',
    verifierDigest: digest('forge-bench-verifier'),
    ...overrides,
  });
  const replayReceipt = createOfflineReplayReceipt({ candidate: fixture.candidate, projection });
  const review = createIndependentReviewReceipt({
    reviewLevel: 'review-2',
    reviewerId: 'reviewer-two',
    implementerId: 'implementer-one',
    candidateSha256: fixture.candidate.candidateSha256,
    comparisonSha256: projection.comparisonSha256,
    protectedSafetyPreserved: projection.protectedSafetyPreserved,
    protectedFalseSuccessPreserved: projection.protectedFalseSuccessPreserved,
    status: 'independent-approved',
  });
  return {
    ...fixture,
    projection,
    replayReceipt,
    review,
    reversible: { applySha256: digest('apply'), rollbackSha256: digest('rollback') },
  };
}

describe('concrete, fresh, sanitized trajectory intake', () => {
  it('derives the bounded v1 authority/origin/timestamps/tip summary from a real ledger', async () => {
    expect(LEARNING_FOUNDRY_SCHEMA_VERSION).toBe('learning-foundry/v1');
    const fixture = await lessonFixture();
    expect(fixture.summary).toMatchObject({
      sourceAuthority: 'test-only',
      origin: 'test-only',
      startedAt: 1,
      terminalAt: 4,
      ledgerHead: { sequence: 4 },
      quiescence: 'confirmed',
    });
    expect(Object.isFrozen(fixture.summary)).toBe(true);
    expect(JSON.stringify(fixture.summary)).not.toMatch(/prompt|output|secret/i);
  });

  it('rejects duck-typed, active, non-quiescent, stale-tip, expired, and corrupt ledgers', async () => {
    const fixture = await lessonFixture();
    await expect(
      service(fixture.repository, fixture.hostCapability).summarizeTrajectory({
        ledger: {
          ledgerId: 'fake',
          reconstruct: async () => [],
          tip: async () => ({ sequence: 1, hash: digest('fake') }),
        } as never,
        expectedTip: { sequence: 1, hash: digest('fake') },
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_TRAJECTORY_CORRUPT' });
    const active = await terminalLedger({ terminal: false });
    await expect(
      service(fixture.repository, fixture.hostCapability).summarizeTrajectory({
        ledger: active.ledger,
        expectedTip: active.tip,
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_TRAJECTORY_ACTIVE' });
    const notQuiet = await terminalLedger({ quiescence: 'not_confirmed' });
    await expect(
      service(fixture.repository, fixture.hostCapability).summarizeTrajectory({
        ledger: notQuiet.ledger,
        expectedTip: notQuiet.tip,
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_TRAJECTORY_ACTIVE' });
    const complete = await terminalLedger();
    await expect(
      service(fixture.repository, fixture.hostCapability).summarizeTrajectory({
        ledger: complete.ledger,
        expectedTip: { ...complete.tip, hash: digest('stale') },
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_TRAJECTORY_STALE' });
    await expect(
      service(fixture.repository, fixture.hostCapability, 'maintenance', {
        now: () => 20,
        freshnessHorizonMs: 10,
      }).summarizeTrajectory({ ledger: complete.ledger, expectedTip: complete.tip }),
    ).rejects.toMatchObject({ code: 'LEARNING_TRAJECTORY_STALE' });
  });

  it('rejects raw/secret/high-entropy/nested/tampered summary data', async () => {
    const { summary } = await lessonFixture();
    for (const secret of [
      'ghp_12345678901234567890',
      'github_pat_12345678901234567890',
      'glpat-12345678901234567890',
      'ABCDEFGHIJKLMNOPQRSTUVWX',
    ]) {
      expect(() => hashLearningFoundryPayload({ note: secret })).toThrowError(LearningFoundryError);
    }
    let deep: unknown = 'leaf';
    for (let index = 0; index < 20; index += 1) deep = { child: deep };
    expect(() => hashLearningFoundryPayload(deep)).toThrowError(LearningFoundryError);
    expect(() => parseSanitizedTrajectorySummary({ ...summary, rawOutput: 'x' })).toThrowError(
      LearningFoundryError,
    );
    expect(() =>
      parseSanitizedTrajectorySummary({ ...summary, summarySha256: digest('tampered') }),
    ).toThrowError(LearningFoundryError);
  });
});

describe('semantic clustering and candidate lessons', () => {
  it('deduplicates summaries and keys root cause/correction/applicability/source/workspace/product', async () => {
    const fixture = await lessonFixture();
    expect(fixture.cluster.trajectorySummarySha256s).toEqual([fixture.summary.summarySha256]);
    const [changed] = clusterAndDedupeTrajectorySummaries([fixture.summary], {
      ...fixture.dimensions,
      productScope: 'product.other',
    });
    expect(changed.clusterKey).not.toBe(fixture.cluster.clusterKey);
    expect(fixture.candidate.schemaVersion).toBe(CANDIDATE_LESSON_SCHEMA_VERSION);
    const incremented = incrementCandidateLessonCounters(fixture.candidate, {
      useful: 3,
      harmful: 1,
    });
    expect(incremented).toMatchObject({ usefulCount: 5, harmfulCount: 1 });
  });

  it('rejects candidate semantic/hash tampering and applicability overlap', async () => {
    const fixture = await lessonFixture();
    expect(() =>
      parseCandidateLesson({ ...fixture.candidate, candidateSha256: digest('tampered') }),
    ).toThrowError(LearningFoundryError);
    expect(() =>
      createCandidateLesson({
        ...fixture.candidate,
        schemaVersion: undefined,
        candidateSha256: undefined,
        correction: 'different correction',
      } as never),
    ).toThrowError(LearningFoundryError);
  });
});

describe('opaque host authority and immutable configuration', () => {
  it('rejects cloned/serialized capabilities and constructor mutation cannot elevate mode', async () => {
    const bundle = await promotionBundle();
    expect(() => JSON.stringify(bundle.hostCapability)).toThrowError(LearningFoundryError);
    const clonedCapability = {
      authority: bundle.hostCapability.authority,
      target: bundle.hostCapability.target,
      registryId: bundle.hostCapability.registryId,
      issuerId: bundle.hostCapability.issuerId,
      verifierId: bundle.hostCapability.verifierId,
      schemaVersion: bundle.hostCapability.schemaVersion,
    };
    expect(
      () =>
        new LearningFoundry({
          mode: 'maintenance',
          implementerId: 'implementer-one',
          freshnessHorizonMs: 10,
          now: () => 4,
          repository: bundle.repository,
          hostCapability: clonedCapability,
          comparisonVerifier: async (projection) => projection,
          reviewVerifier: async (review) => review,
        }),
    ).toThrowError(LearningFoundryError);

    const mutable = {
      mode: 'running' as LearningExecutionMode,
      implementerId: 'implementer-one',
      freshnessHorizonMs: 10,
      now: () => 4,
      repository: bundle.repository,
      hostCapability: bundle.hostCapability,
      comparisonVerifier: async (projection: typeof bundle.projection) => projection,
      reviewVerifier: async (review: typeof bundle.review) => review,
    };
    const running = new LearningFoundry(mutable);
    mutable.mode = 'maintenance';
    await expect(running.promote(bundle)).rejects.toMatchObject({
      code: 'LEARNING_NOT_MAINTENANCE',
    });
  });

  it('rejects authority fields at local issuance and requires exact reviewer/projection verifiers', async () => {
    const registryId = `learning-registry-${++registrySequence}`;
    await expect(
      issueLocalTestLearningHostCapability({
        authority: 'test-only',
        registryId,
        issuerId: 'issuer',
        verifierId: 'verifier',
      } as never),
    ).rejects.toBeInstanceOf(LearningFoundryError);
    const bundle = await promotionBundle();
    const untrusted = new LearningFoundry({
      mode: 'maintenance',
      implementerId: 'implementer-one',
      freshnessHorizonMs: 10,
      now: () => 4,
      repository: bundle.repository,
      hostCapability: bundle.hostCapability,
      comparisonVerifier: async (projection) => ({
        ...projection,
        verifierDigest: digest('forged'),
      }),
      reviewVerifier: async (review) => review,
    });
    await expect(untrusted.promote(bundle)).rejects.toMatchObject({
      code: 'LEARNING_UNTRUSTED_COMPARISON',
    });
    const badReview = new LearningFoundry({
      mode: 'maintenance',
      implementerId: 'implementer-one',
      freshnessHorizonMs: 10,
      now: () => 4,
      repository: bundle.repository,
      hostCapability: bundle.hostCapability,
      comparisonVerifier: async (projection) => projection,
      reviewVerifier: async (review) => ({ ...review, status: 'rejected' }),
    });
    await expect(badReview.promote(bundle)).rejects.toMatchObject({
      code: 'LEARNING_UNTRUSTED_REVIEW',
    });
  });
});

describe('maintenance-only evidence-gated promotion', () => {
  it('promotes a frozen trusted local/test-only fixture into only its local registry', async () => {
    const bundle = await promotionBundle();
    const result = await service(bundle.repository, bundle.hostCapability).promote(bundle);
    expect(result).toMatchObject({
      status: 'promoted',
      receipt: {
        registryId: bundle.registry.registryId,
        authority: 'local-test-only',
      },
      registry: {
        revision: 1,
        active: { usefulCount: 2, harmfulCount: 0 },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.deltaPackage)).toBe(true);
  });

  it('never calls repository mutation in running/client mode', async () => {
    const bundle = await promotionBundle();
    for (const mode of ['running', 'client'] as const) {
      let writes = 0;
      const repository: LearningRegistryRepository = {
        registryId: bundle.registry.registryId,
        read: async () => bundle.registry,
        transact: async () => {
          writes += 1;
          throw new Error('must not write');
        },
      };
      await expect(
        service(repository, bundle.hostCapability, mode).promote(bundle),
      ).rejects.toMatchObject({ code: 'LEARNING_NOT_MAINTENANCE' });
      expect(writes).toBe(0);
    }
  });

  it('rejects unfrozen, protected regression, no gain, harm, hot patch, and self review', async () => {
    const cases = [
      await promotionBundle({ thresholdsVerified: false, promotionEligible: false }),
      await promotionBundle({ protectedSafetyPreserved: false }),
      await promotionBundle({ protectedFalseSuccessPreserved: false }),
      await promotionBundle({ outcomeDelta: 0 }),
      await promotionBundle({}, { harmfulCount: 1 }),
    ];
    for (const bundle of cases) {
      await expect(
        service(bundle.repository, bundle.hostCapability).promote(bundle),
      ).rejects.toBeInstanceOf(LearningFoundryError);
    }
    const hotPatch = await promotionBundle();
    await expect(
      service(hotPatch.repository, hotPatch.hostCapability).promote({
        ...hotPatch,
        reversible: { applySha256: digest('same'), rollbackSha256: digest('same') },
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_REVERSIBILITY_REQUIRED' });
    expect(() =>
      createIndependentReviewReceipt({
        reviewLevel: 'review-2',
        reviewerId: 'implementer-one',
        implementerId: 'implementer-one',
        candidateSha256: hotPatch.candidate.candidateSha256,
        comparisonSha256: hotPatch.projection.comparisonSha256,
        protectedSafetyPreserved: true,
        protectedFalseSuccessPreserved: true,
        status: 'independent-approved',
      }),
    ).toThrowError(LearningFoundryError);
  });

  it('prevents test-only capability from applying to shared/production authority', async () => {
    const bundle = await promotionBundle({ evidenceAuthority: 'production' });
    await expect(
      service(bundle.repository, bundle.hostCapability).promote(bundle),
    ).rejects.toMatchObject({
      code: 'LEARNING_HOST_CAPABILITY_INVALID',
    });
  });

  it('shares the registry lock by registryId so concurrent repository instances have one winner', async () => {
    const bundle = await promotionBundle();
    const peer = new InMemoryLearningRegistryRepository(bundle.registry);
    const results = await Promise.allSettled([
      service(bundle.repository, bundle.hostCapability).promote(bundle),
      service(peer, bundle.hostCapability).promote(bundle),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((await peer.read()).history).toHaveLength(1);
  });
});

describe('registry semantic history and exact rollback', () => {
  it('validates chained history, rolls back exactly once, and keeps used sets append-only', async () => {
    const bundle = await promotionBundle();
    const foundry = service(bundle.repository, bundle.hostCapability);
    const promoted = await foundry.promote(bundle);
    const rolledBack = await foundry.rollback({ promotionPackage: promoted.deltaPackage });
    expect(rolledBack).toMatchObject({
      status: 'rolled-back',
      registry: { revision: 2 },
    });
    expect(rolledBack.registry.active).toEqual(bundle.registry.active);
    expect(rolledBack.registry.history.map(({ kind }) => kind)).toEqual(['promotion', 'rollback']);
    expect(rolledBack.registry.usedCandidateSha256s).toContain(bundle.candidate.candidateSha256);
    expect(rolledBack.registry.usedPackageSha256s).toHaveLength(2);
    expect(parseLearningRegistry(structuredClone(rolledBack.registry))).toEqual(
      rolledBack.registry,
    );
    const again = await foundry.rollback({ promotionPackage: promoted.deltaPackage });
    expect(again.status).toBe('idempotent');
    expect(again.registry.registrySha256).toBe(rolledBack.registry.registrySha256);
  });

  it('rejects history tamper, cross-registry rollback, and same-candidate replay after rollback', async () => {
    const bundle = await promotionBundle();
    const foundry = service(bundle.repository, bundle.hostCapability);
    const promoted = await foundry.promote(bundle);
    const rolledBack = await foundry.rollback({ promotionPackage: promoted.deltaPackage });
    const tampered = structuredClone(rolledBack.registry) as LearningRegistry;
    tampered.history[0].previousHash = digest('forged');
    expect(() => parseLearningRegistry(tampered)).toThrowError(LearningFoundryError);

    const otherId = `learning-registry-${++registrySequence}`;
    const otherRegistry = createEmptyLearningRegistry(otherId);
    const otherRepository = new InMemoryLearningRegistryRepository(otherRegistry);
    const otherCapability = await capability(otherId);
    await expect(
      service(otherRepository, otherCapability).rollback({
        promotionPackage: promoted.deltaPackage,
      }),
    ).rejects.toMatchObject({ code: 'LEARNING_ROLLBACK_INVALID' });

    await expect(foundry.promote(bundle)).rejects.toMatchObject({
      code: 'LEARNING_REPLAY_REJECTED',
    });
  });
});

describe('independent re-review reproductions', () => {
  it('does not allow an exported caller callback to mint production/shared authority', async () => {
    const registryId = `learning-registry-${++registrySequence}`;
    await expect(
      issueLocalTestLearningHostCapability({
        authority: 'production',
        target: 'shared',
        registryId,
        issuerId: 'caller-controlled',
        verifierId: 'forge-bench-verifier',
      } as never),
    ).rejects.toBeInstanceOf(LearningFoundryError);
  });

  it('rejects a missing finalization phase and non-finite clocks', async () => {
    const fixture = await lessonFixture();
    const incomplete = await terminalLedger({ finalizationStarted: false });
    await expect(
      service(fixture.repository, fixture.hostCapability).summarizeTrajectory({
        ledger: incomplete.ledger,
        expectedTip: incomplete.tip,
      }),
    ).rejects.toBeInstanceOf(LearningFoundryError);
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        service(fixture.repository, fixture.hostCapability, 'maintenance', {
          now: () => now,
        }).summarizeTrajectory({
          ledger: incomplete.ledger,
          expectedTip: incomplete.tip,
        }),
      ).rejects.toBeInstanceOf(LearningFoundryError);
    }
  });

  it('rejects a rebased candidate with the same semantic lesson after rollback', async () => {
    const bundle = await promotionBundle();
    const foundry = service(bundle.repository, bundle.hostCapability);
    const promoted = await foundry.promote(bundle);
    await foundry.rollback({ promotionPackage: promoted.deltaPackage });
    const current = await bundle.repository.read();
    const rebased = createCandidateLesson({
      cluster: bundle.candidate.cluster,
      rootCause: bundle.candidate.rootCause,
      correction: bundle.candidate.correction,
      applicability: bundle.candidate.applicability,
      productScope: bundle.candidate.productScope,
      sourceVerifierSha256s: bundle.candidate.sourceVerifierSha256s,
      usefulCount: bundle.candidate.usefulCount,
      harmfulCount: bundle.candidate.harmfulCount,
      baseRegistryId: current.registryId,
      baseRegistryRevision: current.revision,
      baseRegistrySha256: current.registrySha256,
      baseIntelligenceVersion: current.active.version,
      baseIntelligenceSha256: current.active.sha256,
    });
    expect(rebased.candidateSha256).not.toBe(bundle.candidate.candidateSha256);
    const replayReceipt = createOfflineReplayReceipt({
      candidate: rebased,
      projection: bundle.projection,
    });
    const review = createIndependentReviewReceipt({
      reviewLevel: 'review-2',
      reviewerId: 'reviewer-two',
      implementerId: 'implementer-one',
      candidateSha256: rebased.candidateSha256,
      comparisonSha256: bundle.projection.comparisonSha256,
      protectedSafetyPreserved: true,
      protectedFalseSuccessPreserved: true,
      status: 'independent-approved',
    });
    await expect(
      foundry.promote({ ...bundle, candidate: rebased, replayReceipt, review }),
    ).rejects.toMatchObject({ code: 'LEARNING_REPLAY_REJECTED' });
  });

  it('rejects nested Slack token families', () => {
    for (const token of [
      'xoxb-synthetic-noncredential-fixture',
      'xoxp-synthetic-noncredential-fixture',
      'xoxa-synthetic-noncredential-fixture',
      'xoxr-synthetic-noncredential-fixture',
    ]) {
      expect(() => hashLearningFoundryPayload({ nested: { value: token } })).toThrowError(
        LearningFoundryError,
      );
    }
  });

  it('keeps semantic identity stable as supporting evidence grows and prevents counter replay', async () => {
    const bundle = await promotionBundle();
    const foundry = service(bundle.repository, bundle.hostCapability);
    const promoted = await foundry.promote(bundle);
    await foundry.rollback({ promotionPackage: promoted.deltaPackage });

    const additionalLedger = await terminalLedger();
    const additionalSummary = await foundry.summarizeTrajectory({
      ledger: additionalLedger.ledger,
      expectedTip: additionalLedger.tip,
    });
    const [expandedCluster] = clusterAndDedupeTrajectorySummaries(
      [additionalSummary, bundle.summary],
      bundle.dimensions,
    );
    const [reorderedCluster] = clusterAndDedupeTrajectorySummaries(
      [bundle.summary, additionalSummary],
      bundle.dimensions,
    );
    expect(reorderedCluster.clusterSha256).toBe(expandedCluster.clusterSha256);
    const current = await bundle.repository.read();
    const rebased = createCandidateLesson({
      cluster: expandedCluster,
      rootCause: bundle.candidate.rootCause,
      correction: bundle.candidate.correction,
      applicability: bundle.candidate.applicability,
      productScope: bundle.candidate.productScope,
      sourceVerifierSha256s: [...bundle.candidate.sourceVerifierSha256s].reverse(),
      usefulCount: 7,
      harmfulCount: 0,
      baseRegistryId: current.registryId,
      baseRegistryRevision: current.revision,
      baseRegistrySha256: current.registrySha256,
      baseIntelligenceVersion: current.active.version,
      baseIntelligenceSha256: current.active.sha256,
    });
    expect(rebased.candidateSha256).not.toBe(bundle.candidate.candidateSha256);
    expect(rebased.semanticLessonSha256).toBe(bundle.candidate.semanticLessonSha256);
    const replayReceipt = createOfflineReplayReceipt({
      candidate: rebased,
      projection: bundle.projection,
    });
    const review = createIndependentReviewReceipt({
      reviewLevel: 'review-2',
      reviewerId: 'reviewer-two',
      implementerId: 'implementer-one',
      candidateSha256: rebased.candidateSha256,
      comparisonSha256: bundle.projection.comparisonSha256,
      protectedSafetyPreserved: true,
      protectedFalseSuccessPreserved: true,
      status: 'independent-approved',
    });
    await expect(
      foundry.promote({ ...bundle, candidate: rebased, replayReceipt, review }),
    ).rejects.toMatchObject({ code: 'LEARNING_REPLAY_REJECTED' });
    expect((await bundle.repository.read()).active.usefulCount).toBe(0);
  });
});
