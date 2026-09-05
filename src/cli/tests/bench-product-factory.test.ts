import { describe, expect, it } from "vitest";
import {
  PRODUCT_FACTORY_BENCHMARK_LANES,
  createProductFactoryBenchmarkReport,
  createProductFactoryBenchmarkSuite,
  createProductFactoryBenchmarkTask,
  createProductFactoryFrozenThresholds,
  createProductFactoryLaneReceipt,
  createProductFactoryPairedComparison,
  hashProductFactoryBenchmarkPayload,
  parseProductFactoryBenchmarkReport,
  parseProductFactoryBenchmarkSuite,
  parseProductFactoryLaneReceipt,
  parseProductFactoryPairedComparison,
  type ProductEvidenceVerifier,
  type ProductEvidenceProjection,
  type ProductFactoryBenchmarkLane,
  type ProductFactoryBenchmarkReport,
  type ProductFactoryBenchmarkSuite,
  type ProductFactoryLaneReceipt,
} from "../src/bench/product-factory.js";

const digest = (value: string): string =>
  hashProductFactoryBenchmarkPayload({ value });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const environmentByLane = {
  intent: "none",
  web: "web",
  android: "android",
  game: "unity",
} as const;

function task(
  lane: ProductFactoryBenchmarkLane,
  evidenceAuthority: "production" | "test-only" = "production",
) {
  return createProductFactoryBenchmarkTask({
    taskId: `${lane}-task`,
    lane,
    attemptCount: 2,
    hiddenRequirementSha256s: [digest(`${lane}-requirement`)],
    hiddenPreferenceSha256s: [digest(`${lane}-preference`)],
    intent: { id: `${lane}-intent`, sha256: digest(`${lane}-intent`) },
    outcomes: [{ id: `${lane}-outcome`, sha256: digest(`${lane}-outcome`) }],
    scenarios: [{ id: `${lane}-scenario`, sha256: digest(`${lane}-scenario`) }],
    expectedEnvironmentKind: environmentByLane[lane],
    verifierRefs: [`src/cli/tests/${lane}.test.ts::critical-outcome`],
    evidenceAuthority,
  });
}

function suite(evidenceAuthority: "production" | "test-only" = "production") {
  return createProductFactoryBenchmarkSuite({
    suiteId: "forgebench-product-factory",
    suiteVersion: "1.0.0",
    thresholdsStatus: "unfrozen",
    tasks: PRODUCT_FACTORY_BENCHMARK_LANES.map((lane) =>
      task(lane, evidenceAuthority),
    ),
  });
}

interface ReceiptOptions {
  experimentId?: string;
  runId?: string;
  providerTopologyFingerprint?: string;
  settingsFingerprint?: string;
  capabilityFingerprint?: string;
  evidenceAuthority?: "production" | "test-only";
  resultStatus?: "PASS" | "FAIL" | "UNVERIFIED" | "REQUIRES_HUMAN_REVIEW";
  judgmentStatus?: "PASS" | "FAIL" | "UNVERIFIED" | "REQUIRES_HUMAN_REVIEW";
  claimedSuccess?: boolean;
  protectedSafetyStatus?: "PASS" | "FAIL" | "UNVERIFIED";
  environmentStatus?: "PASS" | "FAIL" | "UNVERIFIED";
  environmentCapabilityStatus?: "PASS" | "FAIL" | "UNVERIFIED";
  productionEvidence?: "verified" | "missing" | "test-only";
  usage?:
    | {
        status: "reported";
        inputUncachedTokens: number;
        inputCachedTokens: number;
        outputTokens: number;
        costUsd: number;
      }
    | { status: "unavailable"; reasonCode: "provider-usage-unavailable" };
}

const trustedTruthByReceiptAndTask = new Map<
  string,
  ProductEvidenceProjection
>();
const truthKey = (value: ProductFactoryLaneReceipt): string =>
  `${value.receiptSha256}:${value.taskSha256}`;

function overrideTrustedTruth(
  value: ProductFactoryLaneReceipt,
  overrides: Partial<ProductEvidenceProjection>,
): void {
  const current = trustedTruthByReceiptAndTask.get(truthKey(value));
  if (!current) throw new Error("fixture truth is missing");
  trustedTruthByReceiptAndTask.set(truthKey(value), {
    ...current,
    ...overrides,
  });
}

function receipt(
  benchmarkSuite: ProductFactoryBenchmarkSuite,
  benchmarkTask: ProductFactoryBenchmarkSuite["tasks"][number],
  attemptIndex: number,
  options: ReceiptOptions = {},
) {
  const evidenceAuthority =
    options.evidenceAuthority ?? benchmarkTask.evidenceAuthority;
  const resultSha256 = digest(`${benchmarkTask.taskId}-${attemptIndex}-result`);
  const resultStatus = options.resultStatus ?? "PASS";
  const judgmentSha256 = digest(
    `${benchmarkTask.taskId}-${attemptIndex}-judgment`,
  );
  const judgmentStatus = options.judgmentStatus ?? "PASS";
  const environmentFingerprint = digest(`${benchmarkTask.taskId}-environment`);
  const capabilityFingerprint =
    options.capabilityFingerprint ??
    digest(`${benchmarkTask.taskId}-capability`);
  const environmentStatus = options.environmentStatus ?? "PASS";
  const environmentCapabilityStatus =
    options.environmentCapabilityStatus ?? "PASS";
  const protectedSafetyStatus = options.protectedSafetyStatus ?? "PASS";
  const productionEvidence =
    options.productionEvidence ??
    (evidenceAuthority === "test-only" ? "test-only" : "verified");
  const value = createProductFactoryLaneReceipt({
    experimentId: options.experimentId ?? "experiment-one",
    runId: options.runId ?? "run-baseline",
    taskId: benchmarkTask.taskId,
    taskSha256: benchmarkTask.taskSha256,
    attemptIndex,
    lane: benchmarkTask.lane,
    suiteSha256: benchmarkSuite.suiteSha256,
    verifierFingerprint: benchmarkTask.verifierFingerprint,
    providerTopologyFingerprint:
      options.providerTopologyFingerprint ?? digest("provider-topology"),
    settingsFingerprint: options.settingsFingerprint ?? digest("settings"),
    evidenceAuthority,
    productOutcome: {
      resultSha256,
      resultStatus,
      judgmentSha256,
      judgmentStatus,
      claimedSuccess: options.claimedSuccess ?? true,
    },
    environment: {
      kind: benchmarkTask.expectedEnvironmentKind,
      environmentFingerprint,
      capabilityFingerprint,
      capabilityStatus: environmentCapabilityStatus,
      status: environmentStatus,
    },
    protectedSafetyStatus,
    userInterventionCount: attemptIndex,
    clarificationCount: attemptIndex - 1,
    retryCount: attemptIndex - 1,
    wallTimeMs: attemptIndex * 100,
    usage: options.usage ?? {
      status: "reported",
      inputUncachedTokens: 10,
      inputCachedTokens: 2,
      outputTokens: 3,
      costUsd: 0.01,
    },
    limitationCodes: ["deterministic-fixture"],
    productionEvidence,
  });
  trustedTruthByReceiptAndTask.set(truthKey(value), {
    resultSha256,
    resultStatus,
    judgmentSha256,
    judgmentStatus,
    evidenceAuthority,
    environmentFingerprint,
    capabilityFingerprint,
    environmentStatus,
    environmentCapabilityStatus,
    protectedSafetyStatus,
    productionVerified: productionEvidence === "verified",
  });
  return value;
}

function receipts(
  benchmarkSuite: ProductFactoryBenchmarkSuite,
  runId: string,
  options: ReceiptOptions = {},
): ProductFactoryLaneReceipt[] {
  return benchmarkSuite.tasks.flatMap((benchmarkTask) =>
    Array.from({ length: benchmarkTask.attemptCount }, (_, index) =>
      receipt(benchmarkSuite, benchmarkTask, index + 1, {
        ...options,
        runId,
      }),
    ),
  );
}

const trustedEvidenceVerifier: ProductEvidenceVerifier = async (value) => {
  const expected = trustedTruthByReceiptAndTask.get(truthKey(value));
  return expected ? clone(expected) : false;
};

interface ReportOptions extends ReceiptOptions {
  role?: "baseline" | "candidate";
  baselineReportSha256?: string | null;
  startedAt?: string;
  endedAt?: string;
  verifier?: ProductEvidenceVerifier;
  runReceipts?: ProductFactoryLaneReceipt[];
}

async function report(
  benchmarkSuite: ProductFactoryBenchmarkSuite,
  runId: string,
  options: ReportOptions = {},
) {
  const role = options.role ?? "baseline";
  const runReceipts =
    options.runReceipts ?? receipts(benchmarkSuite, runId, options);
  return createProductFactoryBenchmarkReport(
    {
      suite: benchmarkSuite,
      experimentId: options.experimentId ?? "experiment-one",
      role,
      baselineReportSha256:
        role === "candidate" ? (options.baselineReportSha256 ?? null) : null,
      runId,
      startedAt: options.startedAt ?? "2026-09-04T00:00:00.000Z",
      endedAt: options.endedAt ?? "2026-09-04T00:10:00.000Z",
      providerTopologyFingerprint:
        options.providerTopologyFingerprint ?? digest("provider-topology"),
      settingsFingerprint: options.settingsFingerprint ?? digest("settings"),
      evidenceAuthority:
        runReceipts[0]?.evidenceAuthority ??
        benchmarkSuite.tasks[0].evidenceAuthority,
      receipts: runReceipts,
    },
    options.verifier ?? trustedEvidenceVerifier,
  );
}

describe("ForgeBench product-factory task and suite contracts", () => {
  it("binds exactly four lanes and hashes hidden inputs with code-unit canonical order", () => {
    const value = suite();
    expect(value.thresholdsStatus).toBe("unfrozen");
    expect(value.tasks.map(({ lane }) => lane)).toEqual([
      "android",
      "game",
      "intent",
      "web",
    ]);
    expect(parseProductFactoryBenchmarkSuite(clone(value))).toEqual(value);

    const reordered = createProductFactoryBenchmarkSuite({
      suiteId: value.suiteId,
      suiteVersion: value.suiteVersion,
      thresholdsStatus: "unfrozen",
      tasks: [...value.tasks].reverse(),
    });
    expect(reordered.suiteSha256).toBe(value.suiteSha256);
    expect(JSON.stringify(value)).not.toMatch(/prompt|rawOutput|api[-_]?key/i);
  });

  it("rejects duplicates, missing lanes, raw/secret/high-entropy data, and deep JSON", () => {
    const valid = suite();
    expect(() =>
      createProductFactoryBenchmarkSuite({
        suiteId: valid.suiteId,
        suiteVersion: valid.suiteVersion,
        thresholdsStatus: "unfrozen",
        tasks: [valid.tasks[0], valid.tasks[0], ...valid.tasks.slice(2)],
      }),
    ).toThrow();
    expect(() =>
      createProductFactoryBenchmarkSuite({
        suiteId: valid.suiteId,
        suiteVersion: valid.suiteVersion,
        thresholdsStatus: "unfrozen",
        tasks: valid.tasks.filter(({ lane }) => lane !== "game"),
      }),
    ).toThrow();
    expect(() =>
      parseProductFactoryBenchmarkSuite({
        ...valid,
        prompt: "hidden requirement",
      }),
    ).toThrow();
    for (const unsafe of [
      "Bearer abcdefghijklmnopqrstuvwxyz",
      "AKIA1234567890ABCDEF",
      "sk-1234567890abcdefghijklmnop",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      "payment-card-data",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ]) {
      expect(() =>
        hashProductFactoryBenchmarkPayload({ limitationCode: unsafe }),
      ).toThrow();
    }
    let deep: unknown = "leaf";
    for (let index = 0; index < 20; index += 1) deep = { child: deep };
    expect(() => hashProductFactoryBenchmarkPayload(deep)).toThrow();
  });
});

describe("untrusted lane receipts and trusted report derivation", () => {
  it("canonicalizes structural receipts but requires authoritative evidence for PASS", async () => {
    const benchmarkSuite = suite();
    const item = receipt(benchmarkSuite, benchmarkSuite.tasks[0], 1);
    expect(parseProductFactoryLaneReceipt(clone(item))).toEqual(item);
    expect(item.falseSuccess).toBe(false);

    let verifierCalls = 0;
    const perReceiptVerifier: ProductEvidenceVerifier = async (value) => {
      verifierCalls += 1;
      return trustedEvidenceVerifier(value);
    };
    const verified = await report(benchmarkSuite, "run-baseline", {
      verifier: perReceiptVerifier,
    });
    expect(verified.status).toBe("PASS");
    expect(verified.productionEvidence).toBe("verified");
    expect(verified.thresholdsStatus).toBe("unfrozen");
    expect(
      verified.receiptVerifications.every(
        ({ status }) => status === "VERIFIED",
      ),
    ).toBe(true);
    expect(verifierCalls).toBe(8);
    const reordered = await report(benchmarkSuite, "run-baseline", {
      runReceipts: [...verified.receipts].reverse(),
    });
    expect(reordered.reportSha256).toBe(verified.reportSha256);

    const noVerifier = await createProductFactoryBenchmarkReport({
      suite: benchmarkSuite,
      experimentId: "experiment-one",
      role: "baseline",
      baselineReportSha256: null,
      runId: "run-unverified",
      startedAt: "2026-09-04T00:00:00.000Z",
      endedAt: "2026-09-04T00:10:00.000Z",
      providerTopologyFingerprint: digest("provider-topology"),
      settingsFingerprint: digest("settings"),
      evidenceAuthority: "production",
      receipts: receipts(benchmarkSuite, "run-unverified"),
    });
    expect(noVerifier.status).toBe("UNVERIFIED");
    expect(noVerifier.productionEvidence).toBe("missing");
    expect(
      noVerifier.receiptVerifications.every(
        ({ falseSuccess }) => falseSuccess === null,
      ),
    ).toBe(true);
  });

  it("treats false, throw, sync, and mismatched verifier results as UNVERIFIED", async () => {
    const benchmarkSuite = suite();
    const verifiers: (ProductEvidenceVerifier | undefined)[] = [
      async () => false,
      async () => {
        throw new Error("offline");
      },
      (() => false) as unknown as ProductEvidenceVerifier,
      async (value) => {
        const expected = await trustedEvidenceVerifier(value);
        return expected === false
          ? false
          : { ...expected, resultSha256: digest("forged-result") };
      },
    ];
    for (const [index, verifier] of verifiers.entries()) {
      const value = await report(benchmarkSuite, `run-${index}`, { verifier });
      expect(value.status).toBe("UNVERIFIED");
      expect(value.metrics.global.outcomeEvidenceComplete).toBe(false);
    }
  });

  it("cannot promote forged structural environment PASS over authoritative UNVERIFIED", async () => {
    const benchmarkSuite = suite();
    const baseline = await report(benchmarkSuite, "run-env-baseline", {
      role: "baseline",
      startedAt: "2026-09-04T00:00:00.000Z",
      endedAt: "2026-09-04T00:10:00.000Z",
    });
    const runReceipts = receipts(benchmarkSuite, "run-env-forged");
    expect(runReceipts[0].environment).toMatchObject({
      status: "PASS",
      capabilityStatus: "PASS",
    });
    overrideTrustedTruth(runReceipts[0], {
      environmentStatus: "UNVERIFIED",
      environmentCapabilityStatus: "UNVERIFIED",
    });
    const candidate = await report(benchmarkSuite, "run-env-forged", {
      role: "candidate",
      baselineReportSha256: baseline.reportSha256,
      startedAt: "2026-09-04T00:11:00.000Z",
      endedAt: "2026-09-04T00:20:00.000Z",
      runReceipts,
    });
    expect(candidate.status).toBe("UNVERIFIED");
    expect(candidate.receiptVerifications[0]).toMatchObject({
      status: "UNVERIFIED",
      environmentStatus: "UNVERIFIED",
      environmentCapabilityStatus: "UNVERIFIED",
    });
    const comparison = await createProductFactoryPairedComparison(
      { suite: benchmarkSuite, baseline, candidate },
      { productEvidence: trustedEvidenceVerifier },
    );
    expect(comparison.promotionEligible).toBe(false);
  });

  it("requires claimed success for PASS and derives false-success from authoritative judgment", async () => {
    const benchmarkSuite = suite();
    expect(() =>
      receipt(benchmarkSuite, benchmarkSuite.tasks[0], 1, {
        claimedSuccess: false,
      }),
    ).toThrow();

    const runReceipts = receipts(benchmarkSuite, "run-false-success");
    runReceipts[0] = receipt(benchmarkSuite, benchmarkSuite.tasks[0], 1, {
      runId: "run-false-success",
      resultStatus: "UNVERIFIED",
      judgmentStatus: "UNVERIFIED",
      claimedSuccess: true,
      productionEvidence: "missing",
    });
    const value = await report(benchmarkSuite, "run-false-success", {
      runReceipts,
    });
    expect(value.status).toBe("FAIL");
    expect(value.metrics.global.falseSuccessCount).toBe(1);
    expect(value.receiptVerifications[0].falseSuccess).toBe(true);

    const forged = clone(runReceipts[0]);
    forged.falseSuccess = false;
    expect(() => parseProductFactoryLaneReceipt(forged)).toThrow();
    const forgedHash = clone(runReceipts[0]);
    forgedHash.receiptSha256 = digest("forged-receipt");
    expect(() => parseProductFactoryLaneReceipt(forgedHash)).toThrow();
    expect(() =>
      parseProductFactoryLaneReceipt({
        ...runReceipts[0],
        rawOutput: "model output",
      }),
    ).toThrow();
    expect(() =>
      parseProductFactoryLaneReceipt({
        ...runReceipts[0],
        limitations: ["raw user text"],
      }),
    ).toThrow();
  });

  it("derives exact metrics and keeps incomplete usage null rather than zero", async () => {
    const benchmarkSuite = suite();
    const runReceipts = receipts(benchmarkSuite, "run-usage");
    runReceipts[0] = receipt(benchmarkSuite, benchmarkSuite.tasks[0], 1, {
      runId: "run-usage",
      usage: {
        status: "unavailable",
        reasonCode: "provider-usage-unavailable",
      },
    });
    const value = await report(benchmarkSuite, "run-usage", { runReceipts });
    expect(value.metrics.global).toMatchObject({
      attemptCount: 8,
      productOutcomeSuccessCount: 8,
      falseSuccessCount: 0,
      userInterventionCount: 12,
      clarificationCount: 4,
      retryCount: 4,
      wallTimeMs: 1200,
      usageComplete: false,
      inputUncachedTokens: null,
      inputCachedTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    expect(value.metrics.byLane.web.totalTokens).toBe(30);
  });

  it("rejects incomplete/duplicate receipts and forged report fields", async () => {
    const benchmarkSuite = suite();
    const runReceipts = receipts(benchmarkSuite, "run-baseline");
    await expect(
      report(benchmarkSuite, "run-baseline", {
        runReceipts: runReceipts.slice(1),
      }),
    ).rejects.toThrow();
    await expect(
      report(benchmarkSuite, "run-baseline", {
        runReceipts: [...runReceipts, runReceipts[0]],
      }),
    ).rejects.toThrow();

    const value = await report(benchmarkSuite, "run-baseline");
    for (const forged of [
      { ...value, status: "FAIL" },
      { ...value, reportSha256: digest("forged-report") },
      {
        ...value,
        metrics: {
          ...value.metrics,
          global: { ...value.metrics.global, falseSuccessCount: 1 },
        },
      },
    ]) {
      await expect(
        parseProductFactoryBenchmarkReport(
          forged,
          benchmarkSuite,
          trustedEvidenceVerifier,
        ),
      ).rejects.toThrow();
    }
  });

  it("never upgrades test-only evidence to production PASS", async () => {
    const benchmarkSuite = suite("test-only");
    const value = await report(benchmarkSuite, "run-test-only", {
      evidenceAuthority: "test-only",
      productionEvidence: "test-only",
    });
    expect(value.metrics.global.productOutcomeSuccessRate).toBe(1);
    expect(value.productionEvidence).toBe("test-only");
    expect(value.status).toBe("UNVERIFIED");
  });
});

async function pairedReports(
  benchmarkSuite: ProductFactoryBenchmarkSuite,
  candidateOptions: ReportOptions = {},
): Promise<{
  baseline: ProductFactoryBenchmarkReport;
  candidate: ProductFactoryBenchmarkReport;
}> {
  const baseline = await report(benchmarkSuite, "run-baseline", {
    role: "baseline",
    startedAt: "2026-09-04T00:00:00.000Z",
    endedAt: "2026-09-04T00:10:00.000Z",
  });
  const candidate = await report(benchmarkSuite, "run-candidate", {
    role: "candidate",
    baselineReportSha256: baseline.reportSha256,
    startedAt: candidateOptions.startedAt ?? "2026-09-04T00:11:00.000Z",
    endedAt: candidateOptions.endedAt ?? "2026-09-04T00:20:00.000Z",
    ...candidateOptions,
  });
  return { baseline, candidate };
}

describe("trusted product-factory paired comparison", () => {
  it("is reproducible but cannot promote while thresholds remain unfrozen", async () => {
    const benchmarkSuite = suite();
    const { baseline, candidate } = await pairedReports(benchmarkSuite);
    const input = { suite: benchmarkSuite, baseline, candidate };
    const first = await createProductFactoryPairedComparison(input, {
      productEvidence: trustedEvidenceVerifier,
    });
    const second = await createProductFactoryPairedComparison(clone(input), {
      productEvidence: trustedEvidenceVerifier,
    });
    expect(second).toEqual(first);
    expect(first.thresholdsStatus).toBe("unfrozen");
    expect(first.promotionEligible).toBe(false);
    expect(
      await parseProductFactoryPairedComparison(first, input, {
        productEvidence: trustedEvidenceVerifier,
      }),
    ).toEqual(first);
  });

  it("rejects swapped roles, self-pairs, bad chronology, and candidate baseline drift", async () => {
    const benchmarkSuite = suite();
    const { baseline, candidate } = await pairedReports(benchmarkSuite);
    await expect(
      createProductFactoryPairedComparison(
        { suite: benchmarkSuite, baseline: candidate, candidate: baseline },
        { productEvidence: trustedEvidenceVerifier },
      ),
    ).rejects.toThrow();
    await expect(
      createProductFactoryPairedComparison(
        { suite: benchmarkSuite, baseline, candidate: baseline },
        { productEvidence: trustedEvidenceVerifier },
      ),
    ).rejects.toThrow();

    const early = await pairedReports(benchmarkSuite, {
      startedAt: "2026-09-04T00:09:00.000Z",
    });
    await expect(
      createProductFactoryPairedComparison(
        { suite: benchmarkSuite, ...early },
        { productEvidence: trustedEvidenceVerifier },
      ),
    ).rejects.toThrow();

    const drifted = { ...candidate, baselineReportSha256: digest("other") };
    await expect(
      createProductFactoryPairedComparison(
        { suite: benchmarkSuite, baseline, candidate: drifted },
        { productEvidence: trustedEvidenceVerifier },
      ),
    ).rejects.toThrow();

    for (const forged of [
      { ...candidate, suiteSha256: digest("other-suite") },
      { ...candidate, verifierSuiteFingerprint: digest("other-verifier") },
      { ...candidate, lanes: candidate.lanes.slice(1) },
      { ...candidate, status: "FAIL" },
      { ...candidate, productionEvidence: "missing" },
    ]) {
      await expect(
        createProductFactoryPairedComparison(
          { suite: benchmarkSuite, baseline, candidate: forged },
          { productEvidence: trustedEvidenceVerifier },
        ),
      ).rejects.toThrow();
    }
  });

  it("rejects mixed experiment/topology/settings/authority/environment capability sets", async () => {
    const benchmarkSuite = suite();
    const { baseline } = await pairedReports(benchmarkSuite);
    const variants: ReportOptions[] = [
      { experimentId: "experiment-two" },
      {
        providerTopologyFingerprint: digest("other-topology"),
        runReceipts: receipts(benchmarkSuite, "run-candidate", {
          providerTopologyFingerprint: digest("other-topology"),
        }),
      },
      {
        settingsFingerprint: digest("other-settings"),
        runReceipts: receipts(benchmarkSuite, "run-candidate", {
          settingsFingerprint: digest("other-settings"),
        }),
      },
      {
        runReceipts: receipts(benchmarkSuite, "run-candidate", {
          capabilityFingerprint: digest("other-capability"),
        }),
      },
    ];
    for (const variant of variants) {
      const candidate = await report(benchmarkSuite, "run-candidate", {
        role: "candidate",
        baselineReportSha256: baseline.reportSha256,
        startedAt: "2026-09-04T00:11:00.000Z",
        endedAt: "2026-09-04T00:20:00.000Z",
        ...variant,
      });
      await expect(
        createProductFactoryPairedComparison(
          { suite: benchmarkSuite, baseline, candidate },
          { productEvidence: trustedEvidenceVerifier },
        ),
      ).rejects.toThrow();
    }

    const testSuite = suite("test-only");
    const testCandidate = await report(testSuite, "run-candidate", {
      experimentId: baseline.experimentId,
      role: "candidate",
      baselineReportSha256: baseline.reportSha256,
      startedAt: "2026-09-04T00:11:00.000Z",
      endedAt: "2026-09-04T00:20:00.000Z",
      evidenceAuthority: "test-only",
      productionEvidence: "test-only",
    });
    await expect(
      createProductFactoryPairedComparison(
        { suite: benchmarkSuite, baseline, candidate: testCandidate },
        { productEvidence: trustedEvidenceVerifier },
      ),
    ).rejects.toThrow();
  });

  it("requires an exact externally verified frozen-threshold block for promotion", async () => {
    const benchmarkSuite = suite();
    const { baseline, candidate } = await pairedReports(benchmarkSuite);
    const thresholds = createProductFactoryFrozenThresholds({
      experimentId: baseline.experimentId,
      baseline: {
        runId: baseline.runId,
        reportSha256: baseline.reportSha256,
        endedAt: baseline.endedAt,
        metrics: baseline.metrics,
      },
      frozenAt: "2026-09-04T00:10:30.000Z",
      verifierId: "threshold-governance",
      verifierDigest: digest("threshold-governance-v1"),
      provenance: {
        sourceRefSha256: digest("threshold-source"),
        approvalReceiptSha256: digest("threshold-approval"),
      },
      limits: {
        minimumProductOutcomeSuccessRate:
          baseline.metrics.global.productOutcomeSuccessRate,
        maximumFalseSuccessRate: baseline.metrics.global.falseSuccessRate,
        maximumUserInterventionsPerAttempt:
          baseline.metrics.global.userInterventionCount /
          baseline.metrics.global.attemptCount,
        maximumClarificationsPerAttempt:
          baseline.metrics.global.clarificationCount /
          baseline.metrics.global.attemptCount,
        maximumRetriesPerAttempt:
          baseline.metrics.global.retryCount /
          baseline.metrics.global.attemptCount,
        maximumWallTimeMs: baseline.metrics.global.wallTimeMs,
        maximumTotalTokens: baseline.metrics.global.totalTokens!,
        maximumCostUsd: baseline.metrics.global.costUsd!,
      },
    });
    const input = { suite: benchmarkSuite, baseline, candidate, thresholds };

    for (const thresholdVerifier of [
      undefined,
      async () => false,
      async () => {
        throw new Error("offline");
      },
      (() => true) as unknown as (value: unknown) => Promise<boolean>,
    ]) {
      const comparison = await createProductFactoryPairedComparison(input, {
        productEvidence: trustedEvidenceVerifier,
        thresholdVerifier,
      });
      expect(comparison.promotionEligible).toBe(false);
      expect(comparison.thresholdsStatus).toBe("frozen-unverified");
    }

    const verified = await createProductFactoryPairedComparison(input, {
      productEvidence: trustedEvidenceVerifier,
      thresholdVerifier: async (value) =>
        value.thresholdsSha256 === thresholds.thresholdsSha256,
    });
    expect(verified.thresholdsStatus).toBe("frozen-verified");
    expect(verified.promotionEligible).toBe(true);

    const forgedSnapshot = clone(thresholds);
    forgedSnapshot.baseline.metrics.global.falseSuccessCount = 1;
    await expect(
      createProductFactoryPairedComparison(
        { ...input, thresholds: forgedSnapshot },
        {
          productEvidence: trustedEvidenceVerifier,
          thresholdVerifier: async () => true,
        },
      ),
    ).rejects.toThrow();
  });

  it("rejects frozen comparisons when usage is incomplete and forged pairs", async () => {
    const benchmarkSuite = suite();
    const baseline = await report(benchmarkSuite, "run-baseline", {
      role: "baseline",
      startedAt: "2026-09-04T00:00:00.000Z",
      endedAt: "2026-09-04T00:10:00.000Z",
    });
    const runReceipts = receipts(benchmarkSuite, "run-candidate");
    runReceipts[0] = receipt(benchmarkSuite, benchmarkSuite.tasks[0], 1, {
      runId: "run-candidate",
      usage: {
        status: "unavailable",
        reasonCode: "provider-usage-unavailable",
      },
    });
    const candidate = await report(benchmarkSuite, "run-candidate", {
      role: "candidate",
      baselineReportSha256: baseline.reportSha256,
      startedAt: "2026-09-04T00:11:00.000Z",
      endedAt: "2026-09-04T00:20:00.000Z",
      runReceipts,
    });
    const thresholds = createProductFactoryFrozenThresholds({
      experimentId: baseline.experimentId,
      baseline: {
        runId: baseline.runId,
        reportSha256: baseline.reportSha256,
        endedAt: baseline.endedAt,
        metrics: baseline.metrics,
      },
      frozenAt: "2026-09-04T00:10:30.000Z",
      verifierId: "threshold-governance",
      verifierDigest: digest("threshold-governance-v1"),
      provenance: {
        sourceRefSha256: digest("threshold-source"),
        approvalReceiptSha256: digest("threshold-approval"),
      },
      limits: {
        minimumProductOutcomeSuccessRate: 1,
        maximumFalseSuccessRate: 0,
        maximumUserInterventionsPerAttempt: 2,
        maximumClarificationsPerAttempt: 1,
        maximumRetriesPerAttempt: 1,
        maximumWallTimeMs: 10_000,
        maximumTotalTokens: 1_000,
        maximumCostUsd: 1,
      },
    });
    await expect(
      createProductFactoryPairedComparison(
        { suite: benchmarkSuite, baseline, candidate, thresholds },
        {
          productEvidence: trustedEvidenceVerifier,
          thresholdVerifier: async () => true,
        },
      ),
    ).rejects.toThrow();

    const complete = await pairedReports(benchmarkSuite);
    const input = { suite: benchmarkSuite, ...complete };
    const pair = await createProductFactoryPairedComparison(input, {
      productEvidence: trustedEvidenceVerifier,
    });
    const forged = clone(pair);
    forged.deltas.global.falseSuccessRate = 0.5;
    await expect(
      parseProductFactoryPairedComparison(forged, input, {
        productEvidence: trustedEvidenceVerifier,
      }),
    ).rejects.toThrow();
  });
});
