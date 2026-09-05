import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { execNpmSync } from "../../../scripts/ci/native-node-commands.mjs";
import {
  PRODUCT_FACTORY_BENCHMARK_LANES,
  createProductFactoryBenchmarkSuite,
  createProductFactoryBenchmarkTask,
  createProductFactoryLaneReceipt,
  type ProductFactoryBenchmarkSuite,
} from "../src/bench/product-factory.js";
import {
  runProductFactoryStructuralIngestion,
  validateProductFactoryCommandOptions,
  writeProductFactoryReportAtomic,
} from "../src/bench/product-factory-cli.js";

function supportsFileSymlinks(): boolean {
  const root = mkdtempSync(
    join(tmpdir(), "forgewright-product-symlink-probe-"),
  );
  try {
    const target = join(root, "target.txt");
    writeFileSync(target, "probe\n", "utf8");
    symlinkSync(target, join(root, "link.txt"), "file");
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return false;
    }
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fileSymlinksSupported = supportsFileSymlinks();

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function createSuite(): ProductFactoryBenchmarkSuite {
  return createProductFactoryBenchmarkSuite({
    suiteId: "product-command-suite",
    suiteVersion: "1.0.0",
    thresholdsStatus: "unfrozen",
    tasks: PRODUCT_FACTORY_BENCHMARK_LANES.map((lane) =>
      createProductFactoryBenchmarkTask({
        taskId: `task-${lane}`,
        lane,
        attemptCount: 1,
        hiddenRequirementSha256s: [digest(`requirement-${lane}`)],
        hiddenPreferenceSha256s: [digest(`preference-${lane}`)],
        intent: { id: `intent-${lane}`, sha256: digest(`intent-${lane}`) },
        outcomes: [
          { id: `outcome-${lane}`, sha256: digest(`outcome-${lane}`) },
        ],
        scenarios: [
          { id: `scenario-${lane}`, sha256: digest(`scenario-${lane}`) },
        ],
        expectedEnvironmentKind:
          lane === "intent"
            ? "none"
            : lane === "web"
              ? "web"
              : lane === "android"
                ? "android"
                : "unity",
        verifierRefs: [`tests/${lane}.test.ts::verifies-outcome`],
        evidenceAuthority: "production",
      }),
    ),
  });
}

function createReceipts(suite: ProductFactoryBenchmarkSuite, runId: string) {
  return suite.tasks.map((task) =>
    createProductFactoryLaneReceipt({
      experimentId: "experiment-one",
      runId,
      taskId: task.taskId,
      taskSha256: task.taskSha256,
      attemptIndex: 1,
      lane: task.lane,
      suiteSha256: suite.suiteSha256,
      verifierFingerprint: task.verifierFingerprint,
      providerTopologyFingerprint: digest("provider-topology"),
      settingsFingerprint: digest("settings"),
      evidenceAuthority: "production",
      productOutcome: {
        resultSha256: digest(`result-${task.taskId}`),
        resultStatus: "PASS",
        judgmentSha256: digest(`judgment-${task.taskId}`),
        judgmentStatus: "PASS",
        claimedSuccess: true,
      },
      environment: {
        kind: task.expectedEnvironmentKind,
        environmentFingerprint: digest(`environment-${task.taskId}`),
        capabilityFingerprint: digest(`capability-${task.taskId}`),
        capabilityStatus: "PASS",
        status: "PASS",
      },
      protectedSafetyStatus: "PASS",
      userInterventionCount: 0,
      clarificationCount: 0,
      retryCount: 0,
      wallTimeMs: 1,
      usage: {
        status: "reported",
        inputUncachedTokens: 1,
        inputCachedTokens: 0,
        outputTokens: 1,
        costUsd: 0.01,
      },
      limitationCodes: ["structural-fixture"],
      productionEvidence: "verified",
    }),
  );
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "forge-product-command-"));
  const suite = createSuite();
  const suitePath = join(directory, "suite.json");
  const receiptsPath = join(directory, "receipts.json");
  writeFileSync(suitePath, JSON.stringify(suite), "utf8");
  writeFileSync(
    receiptsPath,
    JSON.stringify(createReceipts(suite, "run-one")),
    "utf8",
  );
  return { directory, suite, suitePath, receiptsPath };
}

function runCommand(
  value: ReturnType<typeof fixture>,
  receiptsPath = value.receiptsPath,
  outputPath = join(value.directory, "report.json"),
  extraArgs: string[] = [],
) {
  return spawnSync(
    process.execPath,
    [
      join(process.cwd(), "dist", "index.js"),
      "bench",
      value.suitePath,
      "--product-receipts",
      receiptsPath,
      "--experiment-id",
      "experiment-one",
      "--variant",
      "baseline",
      "--output",
      outputPath,
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
}

describe("product receipt benchmark CLI ingestion", () => {
  beforeAll(() => {
    execNpmSync(["run", "build"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  });

  it("writes a four-lane structural report that is always unverified", async () => {
    const value = fixture();
    try {
      const result = await runProductFactoryStructuralIngestion({
        suitePath: value.suitePath,
        receiptsPath: value.receiptsPath,
        experimentId: "experiment-one",
        variant: "baseline",
      });

      expect(result.report.status).toBe("UNVERIFIED");
      expect(result.report.productionEvidence).toBe("missing");
      expect(result.report.lanes).toEqual(["android", "game", "intent", "web"]);
      expect(result.report.receiptVerifications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "UNVERIFIED",
            reasonCode: "evidence-verifier-unavailable",
          }),
        ]),
      );
      expect(result.report.metrics.global.productOutcomeSuccessRate).toBe(0);
      expect(JSON.stringify(result.report)).not.toContain("Bearer ");
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it("binds a candidate to an exact baseline report SHA", async () => {
    const value = fixture();
    try {
      const baseline = await runProductFactoryStructuralIngestion({
        suitePath: value.suitePath,
        receiptsPath: value.receiptsPath,
        experimentId: "experiment-one",
        variant: "baseline",
      });
      const baselinePath = join(value.directory, "baseline.json");
      writeFileSync(baselinePath, JSON.stringify(baseline.report), "utf8");
      writeFileSync(
        value.receiptsPath,
        JSON.stringify(createReceipts(value.suite, "run-two")),
        "utf8",
      );

      const candidate = await runProductFactoryStructuralIngestion({
        suitePath: value.suitePath,
        receiptsPath: value.receiptsPath,
        experimentId: "experiment-one",
        variant: "candidate",
        baselineReport: baselinePath,
      });

      expect(candidate.report.baselineReportSha256).toBe(
        baseline.report.reportSha256,
      );
      expect(candidate.report.status).toBe("UNVERIFIED");
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it("rejects unsafe files and never echoes raw receipt contents", async () => {
    const value = fixture();
    const unsafePath = join(value.directory, "unsafe.json");
    const extraPath = join(value.directory, "extra.json");
    const oversizedPath = join(value.directory, "oversized.json");
    try {
      await expect(
        runProductFactoryStructuralIngestion({
          suitePath: value.suitePath,
          receiptsPath: join(value.directory, "missing.json"),
          experimentId: "experiment-one",
          variant: "baseline",
        }),
      ).rejects.toThrow("PRODUCT_FACTORY_CLI_PATH_INVALID");

      writeFileSync(oversizedPath, "x".repeat(512 * 1024 + 1), "utf8");
      await expect(
        runProductFactoryStructuralIngestion({
          suitePath: value.suitePath,
          receiptsPath: oversizedPath,
          experimentId: "experiment-one",
          variant: "baseline",
        }),
      ).rejects.toThrow("PRODUCT_FACTORY_CLI_SIZE_LIMIT");

      writeFileSync(
        unsafePath,
        JSON.stringify([{ secret: "Bearer dont-print-me" }]),
        "utf8",
      );
      await expect(
        runProductFactoryStructuralIngestion({
          suitePath: value.suitePath,
          receiptsPath: unsafePath,
          experimentId: "experiment-one",
          variant: "baseline",
        }),
      ).rejects.toThrow("PRODUCT_FACTORY_CLI_INPUT_INVALID");

      writeFileSync(
        extraPath,
        JSON.stringify([
          { ...createReceipts(value.suite, "run-one")[0], extra: true },
        ]),
        "utf8",
      );
      await expect(
        runProductFactoryStructuralIngestion({
          suitePath: value.suitePath,
          receiptsPath: extraPath,
          experimentId: "experiment-one",
          variant: "baseline",
        }),
      ).rejects.toThrow("PRODUCT_FACTORY_CLI_INPUT_INVALID");
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it.skipIf(!fileSymlinksSupported)(
    "rejects symlinked receipt files",
    async () => {
      const value = fixture();
      const symlinkPath = join(value.directory, "receipts-link.json");
      try {
        symlinkSync(value.receiptsPath, symlinkPath);
        await expect(
          runProductFactoryStructuralIngestion({
            suitePath: value.suitePath,
            receiptsPath: symlinkPath,
            experimentId: "experiment-one",
            variant: "baseline",
          }),
        ).rejects.toThrow("PRODUCT_FACTORY_CLI_PATH_INVALID");
      } finally {
        rmSync(value.directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects live execution and invalid product-only option combinations", () => {
    expect(() =>
      validateProductFactoryCommandOptions({
        productReceipts: "receipts.json",
        experimentId: "experiment-one",
        variant: "baseline",
        run: true,
      }),
    ).toThrow("PRODUCT_FACTORY_CLI_RUN_CONFLICT");
    expect(() =>
      validateProductFactoryCommandOptions({ experimentId: "experiment-one" }),
    ).toThrow("PRODUCT_FACTORY_CLI_MODE_REQUIRED");
    expect(() =>
      validateProductFactoryCommandOptions({
        productReceipts: "receipts.json",
        experimentId: "experiment-one",
        variant: "candidate",
      }),
    ).toThrow("PRODUCT_FACTORY_CLI_BASELINE_REQUIRED");
    expect(() =>
      validateProductFactoryCommandOptions({
        productReceipts: "",
        experimentId: "experiment-one",
        variant: "baseline",
      }),
    ).toThrow("PRODUCT_FACTORY_CLI_RECEIPTS_REQUIRED");
  });

  it.skipIf(!fileSymlinksSupported)(
    "uses a random safe temp writer and rejects symlinked output targets",
    async () => {
      const value = fixture();
      const outputPath = join(value.directory, "report.json");
      const legacyTempPath = `${outputPath}.tmp`;
      const victimPath = join(value.directory, "victim.txt");
      try {
        const { report } = await runProductFactoryStructuralIngestion({
          suitePath: value.suitePath,
          receiptsPath: value.receiptsPath,
          experimentId: "experiment-one",
          variant: "baseline",
        });
        writeFileSync(victimPath, "unchanged", "utf8");
        symlinkSync(victimPath, legacyTempPath);

        writeProductFactoryReportAtomic(outputPath, report);

        expect(readFileSync(victimPath, "utf8")).toBe("unchanged");
        expect(JSON.parse(readFileSync(outputPath, "utf8")).status).toBe(
          "UNVERIFIED",
        );

        const linkedOutput = join(value.directory, "linked-report.json");
        symlinkSync(victimPath, linkedOutput);
        expect(() =>
          writeProductFactoryReportAtomic(linkedOutput, report),
        ).toThrow("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
        expect(readFileSync(victimPath, "utf8")).toBe("unchanged");
      } finally {
        rmSync(value.directory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!fileSymlinksSupported)(
    "protects CLI output against file symlinks",
    () => {
      const value = fixture();
      const outputPath = join(value.directory, "report.json");
      const victimPath = join(value.directory, "legacy-temp-victim.txt");
      try {
        writeFileSync(victimPath, "unchanged", "utf8");
        symlinkSync(victimPath, `${outputPath}.tmp`);
        const valid = runCommand(value);
        expect(valid.status).toBe(1);
        expect(readFileSync(outputPath, "utf8")).toContain(
          '\"status\": \"UNVERIFIED\"',
        );
        expect(readFileSync(victimPath, "utf8")).toBe("unchanged");
        const linkedOutput = join(
          value.directory,
          "linked-command-report.json",
        );
        symlinkSync(victimPath, linkedOutput);
        const linked = runCommand(value, value.receiptsPath, linkedOutput);
        expect(linked.status).toBe(1);
        expect(linked.stderr).toContain("PRODUCT_FACTORY_CLI_OUTPUT_INVALID");
        expect(readFileSync(victimPath, "utf8")).toBe("unchanged");
      } finally {
        rmSync(value.directory, { recursive: true, force: true });
      }
    },
  );

  it("runs the built command as structural-only with stable, secret-free errors", () => {
    const value = fixture();
    const outputPath = join(value.directory, "report.json");
    const run = (
      receiptsPath: string,
      selectedOutputPath = outputPath,
      extraArgs: string[] = [],
    ) => runCommand(value, receiptsPath, selectedOutputPath, extraArgs);
    try {
      const valid = run(value.receiptsPath);
      expect(valid.status).toBe(1);
      expect(readFileSync(outputPath, "utf8")).toContain(
        '"status": "UNVERIFIED"',
      );
      expect(valid.stdout).toContain("Structural ingestion only");

      const canary = "raw-canary-do-not-echo";
      const unsafePath = join(value.directory, "unsafe-receipts.json");
      writeFileSync(unsafePath, JSON.stringify([{ secret: canary }]), "utf8");
      const unsafe = run(unsafePath);
      expect(unsafe.status).toBe(1);
      expect(unsafe.stderr).toContain("PRODUCT_FACTORY_CLI_INPUT_INVALID");
      expect(unsafe.stderr).not.toContain(canary);

      const empty = run("");
      expect(empty.status).toBe(1);
      expect(empty.stderr).toContain("PRODUCT_FACTORY_CLI_RECEIPTS_REQUIRED");
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });
});
