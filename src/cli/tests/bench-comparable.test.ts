/**
 * bench-comparable.test.ts
 *
 * Tests for comparable benchmark evaluation:
 *  1. Fake-binary integration test for the Gemini adapter (no paid calls).
 *  2. k≥3 aggregation and confidence margin validation.
 *  3. Regression: old mock-vs-live comparison must exit non-zero (incomparable).
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { runBenchmarkSuite } from "../src/bench/runner.js";
import {
  createPairedComparison,
  validateComparableReports,
  type ComparableReport,
} from "../src/bench/compare.js";

// ---------------------------------------------------------------------------
// Helper: create a mock spawn that returns a fixed exit code / stdout / stderr.
// ---------------------------------------------------------------------------
function createMockSpawn(exitCode: number, stdoutText = "", stderrText = "") {
  const spawnCalls: { program: string; args: string[]; options: any }[] = [];
  const spawnFn = ((program: string, args: string[], options: any) => {
    spawnCalls.push({ program, args, options });
    const cp = new EventEmitter() as any;
    cp.stdout = Readable.from([stdoutText]);
    cp.stderr = Readable.from([stderrText]);
    cp.kill = () => {};
    setTimeout(() => {
      cp.emit("exit", exitCode, null);
    }, 5);
    return cp;
  }) as any;
  return { spawnFn, spawnCalls };
}

// ---------------------------------------------------------------------------
// 1. Fake-binary integration test for the Gemini adapter.
//    Creates a real executable on disk and uses a real spawn() wrapper so
//    the actual process-spawning code path is exercised (not a constant mock).
// ---------------------------------------------------------------------------
describe("Gemini adapter — fake-binary integration", () => {
  it("invokes gemini binary with -m <model> -y -p <prompt> and captures stdout", async () => {
    const tempDir = join(tmpdir(), `test-gemini-fakebin-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Fake 'gemini' binary: echoes its argv to stdout then exits 0.
    const fakeBinDir = join(tempDir, "bin");
    mkdirSync(fakeBinDir, { recursive: true });
    const fakeBin = join(fakeBinDir, "gemini");
    writeFileSync(
      fakeBin,
      [
        "#!/usr/bin/env node",
        // Print all argv after "node <script>" as comma-separated.
        "process.stdout.write('fake-gemini-args:' + process.argv.slice(2).join(',') + '\\n');",
        "process.exit(0);",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    // Verifier that always passes.
    writeFileSync(join(tempDir, "verify.js"), "process.exit(0);\n", "utf8");

    const suitePath = join(tempDir, "suite.json");
    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "Gemini Fake Binary Suite",
        defaultProviderSettings: {
          provider: "gemini",
          model: "gemini-2.5-flash",
        },
        defaultAttempts: 1,
        defaultTimeoutMs: 5000,
        tasks: [
          {
            id: "gemini-fake-1",
            category: "smoke",
            prompt: "hello world",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    // Inject the fake bin directory at the front of PATH.
    const patchedPath = `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`;

    const { spawn: realSpawn } = await import("node:child_process");
    const patchedSpawn: typeof realSpawn = (program, args, options) => {
      const merged = {
        ...(options ?? {}),
        env: { ...(options as any)?.env, PATH: patchedPath },
      };
      if (process.platform === "win32" && program === "gemini") {
        return realSpawn(
          process.execPath,
          [fakeBin, ...(args as string[])],
          merged as any,
        ) as any;
      }
      return realSpawn(program, args as string[], merged as any) as any;
    };

    const { report } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn: patchedSpawn as any,
    });

    expect(report).toBeDefined();
    const attempt = report!.tasks[0].attempts[0];

    // Process must have exited cleanly.
    expect(attempt.exitStatus).toBe(0);

    // The report binds output without persisting the prompt-bearing text.
    const expectedOutput =
      "fake-gemini-args:-m,gemini-2.5-flash,-y,-p,hello world\n";
    expect(attempt.stdoutSha256).toBe(
      createHash("sha256").update(expectedOutput).digest("hex"),
    );
    expect(attempt.stdoutBytes).toBe(Buffer.byteLength(expectedOutput));
    expect(JSON.stringify(report)).not.toContain("hello world");

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 2. k≥3 aggregation and confidence margin validation.
// ---------------------------------------------------------------------------
describe("k≥3 aggregation and confidence margin", () => {
  it("emits a live measurement record that is directly comparable to itself", async () => {
    const tempDir = join(tmpdir(), `test-k3-record-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "K3 Record Suite",
        defaultProviderSettings: { provider: "agy", model: "test-model" },
        defaultAttempts: 3,
        tasks: [
          {
            id: "record-task",
            category: "smoke",
            prompt: "Do the thing.",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    const { report } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn: createMockSpawn(0).spawnFn,
    });

    expect(report).toMatchObject({
      mode: "live",
      defaultAttempts: 3,
      totalTasks: 1,
      verifierVersion: "1",
    });
    expect(report?.measurementRecord).toMatchObject({
      version: "1",
      usage_source: "unavailable",
      input_uncached_tokens: null,
      input_cached_tokens: null,
      output_tokens: null,
      critical_path_unverified: true,
    });
    expect(report?.measurementRecord.run_id).toEqual(expect.any(String));
    expect(report?.measurementRecord.started_at).toEqual(expect.any(String));
    expect(report?.measurementRecord.ended_at).toEqual(expect.any(String));
    expect(report?.measurementRecord.e2e_wall_ms).toEqual(expect.any(Number));
    expect(report?.measurementRecord.critical_path_ms).toEqual(
      expect.any(Number),
    );
    expect(report?.measurementRecord.suite_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report?.measurementRecord.verifier_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(validateComparableReports(report!, report!)).toEqual({
      comparable: true,
    });

    const reorderedSuitePath = join(tempDir, "reordered-suite.json");
    writeFileSync(
      reorderedSuitePath,
      JSON.stringify({
        tasks: [
          {
            verifierCommands: ["node verify.js"],
            prompt: "Do the thing.",
            category: "smoke",
            id: "record-task",
          },
        ],
        defaultAttempts: 3,
        defaultProviderSettings: { model: "test-model", provider: "agy" },
        name: "K3 Record Suite",
        version: "1.0",
      }),
      "utf8",
    );
    const { report: reorderedReport } = await runBenchmarkSuite(
      reorderedSuitePath,
      { run: true, spawnFn: createMockSpawn(0).spawnFn },
    );
    expect(reorderedReport?.measurementRecord.suite_sha256).toBe(
      report?.measurementRecord.suite_sha256,
    );
    expect(reorderedReport?.measurementRecord.verifier_sha256).toBe(
      report?.measurementRecord.verifier_sha256,
    );

    const candidateSuitePath = join(tempDir, "candidate-suite.json");
    writeFileSync(
      candidateSuitePath,
      JSON.stringify({
        ...JSON.parse(readFileSync(suitePath, "utf8")),
        defaultProviderSettings: {
          provider: "agy",
          model: "candidate-model",
        },
      }),
      "utf8",
    );
    const { report: candidateReport } = await runBenchmarkSuite(
      candidateSuitePath,
      { run: true, spawnFn: createMockSpawn(0).spawnFn },
    );
    expect(candidateReport?.measurementRecord.suite_sha256).toBe(
      report?.measurementRecord.suite_sha256,
    );
    expect(candidateReport?.measurementRecord.provider_topology_sha256).toBe(
      report?.measurementRecord.provider_topology_sha256,
    );
    expect(
      candidateReport?.measurementRecord.resolved_snapshot_sha256,
    ).not.toBe(report?.measurementRecord.resolved_snapshot_sha256);
    expect(createPairedComparison(report!, candidateReport!)).toMatchObject({
      usage_comparable: false,
      production_evidence: "missing",
    });

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("records pass@k=true when only the third attempt succeeds", async () => {
    const tempDir = join(tmpdir(), `test-k3-late-pass-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "K3 Late Pass Suite",
        defaultProviderSettings: { provider: "agy", model: "test-model" },
        defaultAttempts: 3,
        defaultTimeoutMs: 10000,
        tasks: [
          {
            id: "task-k3-late",
            category: "smoke",
            prompt: "Do the thing.",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    writeFileSync(join(tempDir, "verify.js"), "process.exit(0);\n", "utf8");

    let callCount = 0;
    // agy fails on attempts 1 and 2, succeeds on attempt 3.
    const customSpawn = ((program: string, _args: string[], _options: any) => {
      const cp = new EventEmitter() as any;
      cp.stdout = Readable.from([""]);
      cp.stderr = Readable.from([""]);
      cp.kill = () => {};
      process.nextTick(() => {
        if (program === "agy") {
          callCount++;
          cp.emit("exit", callCount <= 2 ? 1 : 0, null);
        } else {
          cp.emit("exit", 0, null);
        }
      });
      return cp;
    }) as any;

    const { report } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn: customSpawn,
    });

    expect(report).toBeDefined();
    const task = report!.tasks[0];

    expect(task.attempts.length).toBe(3);
    expect(task.attempts[0].passed).toBe(false); // k=1 failed
    expect(task.attempts[1].passed).toBe(false); // k=2 failed
    expect(task.attempts[2].passed).toBe(true); // k=3 passed

    expect(task.passedAt1).toBe(false); // pass@1 is false
    expect(task.passed).toBe(true); // pass@k is true

    // Aggregate metrics.
    expect(report!.summary.passAt1Count).toBe(0);
    expect(report!.summary.passAt1Rate).toBe(0);
    expect(report!.summary.passAtKCount).toBe(1);
    expect(report!.summary.passAtKRate).toBe(1);

    // The delta (pass@k − pass@1) must be strictly positive.
    const delta = report!.summary.passAtKRate - report!.summary.passAt1Rate;
    expect(delta).toBeGreaterThan(0);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports correct per-category k=3 aggregation across multiple tasks", async () => {
    const tempDir = join(tmpdir(), `test-k3-multi-cat-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "K3 Multi Category Suite",
        defaultProviderSettings: { provider: "agy", model: "test-model" },
        defaultAttempts: 3,
        defaultTimeoutMs: 10000,
        tasks: [
          {
            id: "cat-a-1",
            category: "cat-a",
            prompt: "Task A1",
            verifierCommands: ["node verify.js"],
          },
          {
            id: "cat-a-2",
            category: "cat-a",
            prompt: "Task A2",
            verifierCommands: ["node verify.js"],
          },
          {
            id: "cat-b-1",
            category: "cat-b",
            prompt: "Task B1",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    writeFileSync(join(tempDir, "verify.js"), "process.exit(0);\n", "utf8");

    // All agy calls succeed on first attempt.
    const { spawnFn } = createMockSpawn(0);

    const { report } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn,
    });

    expect(report).toBeDefined();
    expect(report!.summary.totalTasks).toBe(3);
    expect(report!.summary.passAt1Count).toBe(3);
    expect(report!.summary.passAtKCount).toBe(3);
    expect(report!.summary.passAt1Rate).toBeCloseTo(1.0);
    expect(report!.summary.passAtKRate).toBeCloseTo(1.0);

    // Per-category checks.
    expect(report!.summary.categories["cat-a"].totalTasks).toBe(2);
    expect(report!.summary.categories["cat-a"].passAt1Count).toBe(2);
    expect(report!.summary.categories["cat-a"].passAt1Rate).toBeCloseTo(1.0);
    expect(report!.summary.categories["cat-b"].totalTasks).toBe(1);
    expect(report!.summary.categories["cat-b"].passAt1Count).toBe(1);

    // Every task must have exactly 3 attempt records.
    for (const task of report!.tasks) {
      expect(task.attempts.length).toBe(3);
    }

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 3. Regression: comparable-report validation rejects incomparable pairs.
// ---------------------------------------------------------------------------
describe("comparable-report validation (regression)", () => {
  const baseReport: ComparableReport = {
    mode: "live",
    model: "gemini-2.5-flash",
    provider: "gemini",
    suiteVersion: "1.0",
    suiteName: "Test Suite",
    defaultAttempts: 3,
    totalTasks: 5,
    verifierVersion: "1",
    timestamp: "2026-07-04T00:00:00Z",
  };

  it("rejects a mock report compared to a live report", () => {
    const mockReport: ComparableReport = {
      ...baseReport,
      mode: "mock",
      model: "mocked",
    };
    const result = validateComparableReports(mockReport, baseReport);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/mock/i);
  });

  it("rejects reports with mismatched providers", () => {
    const otherProvider: ComparableReport = {
      ...baseReport,
      provider: "codex",
    };
    const result = validateComparableReports(baseReport, otherProvider);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/provider/i);
  });

  it("rejects reports with mismatched models", () => {
    const otherModel: ComparableReport = {
      ...baseReport,
      model: "gemini-2.0-flash",
    };
    const result = validateComparableReports(baseReport, otherModel);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/model/i);
  });

  it("rejects reports with mismatched task counts", () => {
    const fewerTasks: ComparableReport = { ...baseReport, totalTasks: 3 };
    const result = validateComparableReports(baseReport, fewerTasks);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/task/i);
  });

  it("rejects reports with mismatched attempts", () => {
    const fewerAttempts: ComparableReport = {
      ...baseReport,
      defaultAttempts: 1,
    };
    const result = validateComparableReports(baseReport, fewerAttempts);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/attempt/i);
  });

  it("rejects reports with mismatched verifier versions", () => {
    const otherVerifier: ComparableReport = {
      ...baseReport,
      verifierVersion: "2",
    };
    const result = validateComparableReports(baseReport, otherVerifier);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/verifier/i);
  });

  it("rejects reports with mismatched suite names", () => {
    const otherSuite: ComparableReport = {
      ...baseReport,
      suiteName: "Other Suite",
    };
    const result = validateComparableReports(baseReport, otherSuite);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/suite/i);
  });

  it("rejects reports with mismatched suite versions", () => {
    const otherSuiteVersion: ComparableReport = {
      ...baseReport,
      suiteVersion: "2.0",
    };
    const result = validateComparableReports(baseReport, otherSuiteVersion);
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/suite.*version/i);
  });

  it("rejects measurement fingerprint mismatches when both reports include records", () => {
    const withRecord: ComparableReport = {
      ...baseReport,
      measurementRecord: {
        version: "1",
        run_id: "run-a",
        started_at: "2026-07-04T00:00:00Z",
        ended_at: "2026-07-04T00:00:01Z",
        e2e_wall_ms: 1000,
        provider: "gemini",
        model: "gemini-2.5-flash",
        suite_sha256: "a".repeat(64),
        verifier_sha256: "b".repeat(64),
        resolved_snapshot_sha256: "c".repeat(64),
        provider_topology_sha256: "d".repeat(64),
        usage_source: "unavailable",
        usage_receipt_count: 3,
        usage_reported_count: 0,
        usage_unavailable_count: 3,
        input_uncached_tokens: null,
        input_cached_tokens: null,
        output_tokens: null,
        cost_usd: null,
        provider_latency_ms: null,
        critical_path_ms: 1000,
        critical_path_unverified: true,
        production_evidence: "missing",
      },
    };

    const suiteMismatch = validateComparableReports(withRecord, {
      ...withRecord,
      measurementRecord: {
        ...withRecord.measurementRecord!,
        suite_sha256: "c".repeat(64),
      },
    });
    expect(suiteMismatch.comparable).toBe(false);
    expect(suiteMismatch.reason).toMatch(/suite.*fingerprint/i);

    const verifierMismatch = validateComparableReports(withRecord, {
      ...withRecord,
      measurementRecord: {
        ...withRecord.measurementRecord!,
        verifier_sha256: "d".repeat(64),
      },
    });
    expect(verifierMismatch.comparable).toBe(false);
    expect(verifierMismatch.reason).toMatch(/verifier.*fingerprint/i);
  });

  it("accepts two live reports with identical metadata", () => {
    const legacyReport: ComparableReport = { ...baseReport };
    const liteReport: ComparableReport = { ...baseReport };
    const result = validateComparableReports(legacyReport, liteReport);
    expect(result.comparable).toBe(true);
  });
});

describe("structured provider usage and paired A/B receipts", () => {
  it("distinguishes reported adapter usage from unavailable without persisting private data", async () => {
    const tempDir = join(tmpdir(), `test-provider-usage-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");
    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "Provider Usage Fixture",
        defaultProviderSettings: {
          provider: "agy",
          model: "fixture-model",
          options: { privateKey: "must-not-persist" },
        },
        defaultAttempts: 3,
        tasks: [
          {
            id: "usage-task",
            category: "fixture",
            prompt: "private fixture prompt",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(join(tempDir, "verify.js"), "process.exit(0);\n", "utf8");
    const { spawnFn } = createMockSpawn(0, "private model output");
    const seenInputs: unknown[] = [];

    const { report } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn,
      usageAdapter: async (input) => {
        seenInputs.push(input);
        return {
          version: "1",
          provider: input.provider,
          model: input.model,
          resolved_snapshot_sha256: input.resolved_snapshot_sha256,
          usage: {
            status: "reported",
            input_uncached_tokens: 100,
            input_cached_tokens: 20,
            output_tokens: 30,
            cost_usd: 0.0125,
            latency_ms: 75,
            raw_output: "adapter output must not persist",
          },
          prompt: "adapter prompt must not persist",
          api_key: "adapter key must not persist",
        } as never;
      },
    });

    expect(seenInputs).toHaveLength(3);
    expect(JSON.stringify(seenInputs)).not.toMatch(/prompt|output|key/i);
    expect(report?.measurementRecord).toMatchObject({
      usage_source: "reported",
      input_uncached_tokens: 300,
      input_cached_tokens: 60,
      output_tokens: 90,
      cost_usd: 0.0375,
      provider_latency_ms: 225,
      usage_receipt_count: 3,
      usage_reported_count: 3,
      usage_unavailable_count: 0,
      production_evidence: "missing",
    });
    expect(report?.tasks[0].attempts[0].usageReceipt).toMatchObject({
      provider: "agy",
      model: "fixture-model",
      suite_sha256: report?.suiteFingerprint,
      verifier_sha256: report?.verifierFingerprint,
      usage: { status: "reported" },
    });
    const persisted = JSON.stringify(report);
    expect(persisted).not.toContain("private fixture prompt");
    expect(persisted).not.toContain("private model output");
    expect(persisted).not.toContain("must-not-persist");
    expect(persisted).not.toContain("adapter output must not persist");
    expect(persisted).not.toContain("adapter prompt must not persist");
    expect(persisted).not.toContain("adapter key must not persist");

    const unavailable = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn,
    });
    expect(unavailable.report?.measurementRecord.usage_source).toBe(
      "unavailable",
    );
    expect(unavailable.report?.measurementRecord).toMatchObject({
      usage_receipt_count: 3,
      usage_reported_count: 0,
      usage_unavailable_count: 3,
    });
    expect(
      unavailable.report?.tasks[0].attempts[0].usageReceipt.usage,
    ).toMatchObject({
      status: "unavailable",
    });

    const partial = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn,
      usageAdapter: async (input) => ({
        version: "1",
        provider: input.provider,
        model: input.model,
        resolved_snapshot_sha256: input.resolved_snapshot_sha256,
        usage:
          input.attempt_index === 2
            ? { status: "unavailable", reason: "provider_omitted_usage" }
            : {
                status: "reported",
                input_uncached_tokens: 1,
                input_cached_tokens: 0,
                output_tokens: 1,
                cost_usd: 0.001,
                latency_ms: 10,
              },
      }),
    });
    expect(partial.report?.measurementRecord).toMatchObject({
      usage_source: "unavailable",
      usage_receipt_count: 3,
      usage_reported_count: 2,
      usage_unavailable_count: 1,
      input_uncached_tokens: null,
      cost_usd: null,
    });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects adapter receipts that do not bind the resolved provider snapshot", async () => {
    const tempDir = join(tmpdir(), `test-provider-mismatch-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");
    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "Mismatch Fixture",
        defaultProviderSettings: { provider: "agy", model: "fixture-model" },
        defaultAttempts: 1,
        tasks: [
          {
            id: "task",
            category: "fixture",
            prompt: "fixture",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(join(tempDir, "verify.js"), "process.exit(0);\n", "utf8");

    await expect(
      runBenchmarkSuite(suitePath, {
        run: true,
        spawnFn: createMockSpawn(0).spawnFn,
        usageAdapter: async (input) => ({
          version: "1",
          provider: "other-provider",
          model: input.model,
          resolved_snapshot_sha256: input.resolved_snapshot_sha256,
          usage: { status: "unavailable", reason: "fixture" },
        }),
      }),
    ).rejects.toThrow(/provider.*mismatch/i);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("marks task-level provider/model mixtures and blocks paired claims", async () => {
    const tempDir = join(tmpdir(), `test-provider-topology-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");
    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "Mixed Provider Fixture",
        defaultProviderSettings: { provider: "agy", model: "baseline-model" },
        defaultAttempts: 1,
        tasks: [
          {
            id: "default-task",
            category: "fixture",
            prompt: "private default prompt",
            verifierCommands: ["node verify.js"],
          },
          {
            id: "override-task",
            category: "fixture",
            prompt: "private override prompt",
            providerSettings: { provider: "gemini", model: "override-model" },
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );
    const mixed = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn: createMockSpawn(0).spawnFn,
    });
    expect(mixed.report).toMatchObject({ provider: "mixed", model: "mixed" });
    expect(mixed.report?.measurementRecord).toMatchObject({
      provider: "mixed",
      model: "mixed",
    });
    expect(() =>
      createPairedComparison(mixed.report!, {
        ...mixed.report!,
        measurementRecord: {
          ...mixed.report!.measurementRecord,
          run_id: "other-run",
        },
      }),
    ).toThrow(/one resolved provider and model/i);
    expect(JSON.stringify(mixed.report)).not.toMatch(/private .* prompt/);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates reproducible paired quality/cost/latency deltas and rejects invalid pairs", () => {
    const pairBase: ComparableReport = {
      mode: "live",
      model: "gemini-2.5-flash",
      provider: "gemini",
      suiteVersion: "1.0",
      suiteName: "Test Suite",
      defaultAttempts: 3,
      totalTasks: 5,
      verifierVersion: "1",
      timestamp: "2026-08-28T00:00:00.000Z",
    };
    const measurement = {
      version: "1" as const,
      run_id: "baseline-run",
      started_at: "2026-08-28T00:00:00.000Z",
      ended_at: "2026-08-28T00:00:01.000Z",
      e2e_wall_ms: 1000,
      provider: "gemini",
      model: "gemini-2.5-flash",
      suite_sha256: "a".repeat(64),
      verifier_sha256: "b".repeat(64),
      resolved_snapshot_sha256: "c".repeat(64),
      provider_topology_sha256: "e".repeat(64),
      usage_source: "reported" as const,
      usage_receipt_count: 3,
      usage_reported_count: 3,
      usage_unavailable_count: 0,
      input_uncached_tokens: 100,
      input_cached_tokens: 10,
      output_tokens: 20,
      cost_usd: 0.02,
      provider_latency_ms: 500,
      critical_path_ms: 1000,
      critical_path_unverified: true,
      production_evidence: "missing" as const,
    };
    const baseline = {
      ...pairBase,
      suiteFingerprint: "a".repeat(64),
      verifierFingerprint: "b".repeat(64),
      measurementRecord: measurement,
      summary: { passAt1Rate: 0.4, passAtKRate: 0.6 },
    };
    const candidate = {
      ...baseline,
      model: "candidate-model",
      measurementRecord: {
        ...measurement,
        run_id: "candidate-run",
        model: "candidate-model",
        resolved_snapshot_sha256: "d".repeat(64),
        cost_usd: 0.015,
        provider_latency_ms: 400,
        e2e_wall_ms: 900,
      },
      summary: { passAt1Rate: 0.6, passAtKRate: 0.8 },
    };

    expect(createPairedComparison(baseline, candidate)).toMatchObject({
      version: "1",
      baseline: {
        run_id: "baseline-run",
        provider: "gemini",
        model: "gemini-2.5-flash",
        resolved_snapshot_sha256: "c".repeat(64),
      },
      candidate: {
        run_id: "candidate-run",
        model: "candidate-model",
        resolved_snapshot_sha256: "d".repeat(64),
      },
      provider_topology_sha256: "e".repeat(64),
      deltas: {
        pass_at_1: 0.2,
        pass_at_k: 0.2,
        cost_usd: -0.005,
        provider_latency_ms: -100,
        e2e_wall_ms: -100,
      },
      production_evidence: "missing",
    });
    expect(() => createPairedComparison(baseline, baseline)).toThrow(
      /self-pair/i,
    );
    expect(() =>
      createPairedComparison(baseline, {
        ...candidate,
        measurementRecord: {
          ...candidate.measurementRecord,
          suite_sha256: "e".repeat(64),
        },
      }),
    ).toThrow(/suite.*fingerprint/i);
    expect(() =>
      createPairedComparison(baseline, {
        ...candidate,
        provider: "codex",
        measurementRecord: {
          ...candidate.measurementRecord,
          provider: "codex",
        },
      }),
    ).toThrow(/provider ecosystem/i);
    expect(() =>
      createPairedComparison(baseline, {
        ...candidate,
        measurementRecord: {
          ...candidate.measurementRecord,
          provider_topology_sha256: "f".repeat(64),
        },
      }),
    ).toThrow(/provider topology/i);
  });
});
