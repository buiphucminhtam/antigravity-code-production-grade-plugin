import {
  readFileSync,
  existsSync,
  mkdtempSync,
  cpSync,
  rmSync,
  writeFileSync,
  renameSync,
  realpathSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { BenchmarkSuiteSchema } from "./types.js";
import type {
  TaskResult,
  AttemptResult,
  VerifierResult,
  BenchmarkReport,
  BenchmarkSuite,
  ProviderUsage,
  ProviderUsageAdapter,
  ProviderUsageAdapterInput,
  ProviderUsageObservation,
  ProviderUsageReceipt,
} from "./types.js";
import { calculateMetrics } from "./metrics.js";

const VERIFIER_VERSION = "1";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function outputMetadata(text: string): {
  sha256: string;
  bytes: number;
} {
  return {
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

function suiteContractFingerprint(suite: BenchmarkSuite): string {
  return sha256Canonical({
    version: suite.version,
    name: suite.name,
    description: suite.description,
    defaultAttempts: suite.defaultAttempts,
    defaultTimeoutMs: suite.defaultTimeoutMs,
    tasks: suite.tasks.map(
      ({ providerSettings: _providerSettings, ...task }) => task,
    ),
  });
}

function verifierFingerprint(suite: BenchmarkSuite): string {
  return sha256Canonical(
    suite.tasks.map(({ id, verifierCommands }) => ({ id, verifierCommands })),
  );
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

export function parseCommandString(cmdStr: string): {
  program: string;
  args: string[];
} {
  const matches = cmdStr.match(/"[^"]*"|'[^']*'|[^\s"']+/g);
  if (!matches) {
    return { program: cmdStr, args: [] };
  }
  const program = matches[0].replace(/^["']|["']$/g, "");
  const args = matches.slice(1).map((arg) => arg.replace(/^["']|["']$/g, ""));
  return { program, args };
}

export function sanitizeOutput(text: string): string {
  if (!text) {
    return "";
  }
  const maxLen = 2048;
  let sanitized =
    text.length > maxLen ? text.slice(0, maxLen) + "\n[TRUNCATED]" : text;
  sanitized = sanitized.replace(/(sk-[a-zA-Z0-9]{32,})/g, "[REDACTED_API_KEY]");
  sanitized = sanitized.replace(
    /(AIzaSy[a-zA-Z0-9-_]{33})/g,
    "[REDACTED_API_KEY]",
  );
  return sanitized;
}

export type ProcessAdapter = (
  input: {
    taskId: string;
    prompt: string;
    model: string;
    workspace: string;
    timeoutMs: number;
  },
  spawnFn: typeof spawn,
) => Promise<{
  exitStatus: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}>;

export const ADAPTERS: Record<string, ProcessAdapter> = {
  agy: async (input, spawnFn) => {
    const contractContent = JSON.stringify(
      {
        contract_version: "1.0",
        task_id: input.taskId,
        task_name: `Benchmark Task ${input.taskId}`,
        acceptance_criteria: [],
        inputs: {
          prompt: input.prompt,
        },
      },
      null,
      2,
    );

    const instructionsContent = `# Instructions for ${input.taskId}
1. Implement the request in the contract:
${input.prompt}
2. Write DELIVERY.json. Do not commit.
`;

    writeFileSync(
      join(input.workspace, "CONTRACT.json"),
      contractContent,
      "utf8",
    );
    writeFileSync(
      join(input.workspace, "WORKER_INSTRUCTIONS.md"),
      instructionsContent,
      "utf8",
    );

    // Bench tasks run in disposable isolated fixtures. Sandbox + explicit edit
    // mode bounds execution, but does not claim project rule-hook enforcement.
    const args = [
      "--model",
      input.model,
      "--sandbox",
      "--mode",
      "accept-edits",
      "--print",
      "Read WORKER_INSTRUCTIONS.md and CONTRACT.json, execute only the contracted task, run its verification commands, and write DELIVERY.json.",
    ];

    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const child = spawnFn("agy", args, {
        cwd: input.workspace,
        env: {
          ...process.env,
          FORGEWRIGHT_WORKSPACE: realpathSync(input.workspace),
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      let timer: NodeJS.Timeout | null = null;
      if (input.timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitStatus: null,
            durationMs: Date.now() - startTime,
            stdout,
            stderr,
          });
        }, input.timeoutMs);
      }

      child.on("error", (err) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(err);
      });

      child.on("exit", (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve({
          exitStatus: code,
          durationMs: Date.now() - startTime,
          stdout,
          stderr,
        });
      });
    });
  },

  codex: async (input, spawnFn) => {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--model",
      input.model,
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      input.prompt,
    ];

    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const child = spawnFn("codex", args, {
        cwd: input.workspace,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      let timer: NodeJS.Timeout | null = null;
      if (input.timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitStatus: null,
            durationMs: Date.now() - startTime,
            stdout,
            stderr,
          });
        }, input.timeoutMs);
      }

      child.on("error", (err) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(err);
      });

      child.on("exit", (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve({
          exitStatus: code,
          durationMs: Date.now() - startTime,
          stdout,
          stderr,
        });
      });
    });
  },

  gemini: async (input, spawnFn) => {
    // Use actual Gemini CLI flags: -m/--model, -p/--prompt for non-interactive
    // headless stdout mode, -y/--yolo to auto-approve all actions (safe in CI).
    const args = ["-m", input.model, "-y", "-p", input.prompt];

    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const child = spawnFn("gemini", args, {
        cwd: input.workspace,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      let timer: NodeJS.Timeout | null = null;
      if (input.timeoutMs > 0) {
        timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            exitStatus: null,
            durationMs: Date.now() - startTime,
            stdout,
            stderr,
          });
        }, input.timeoutMs);
      }

      child.on("error", (err) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(err);
      });

      child.on("exit", (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve({
          exitStatus: code,
          durationMs: Date.now() - startTime,
          stdout,
          stderr,
        });
      });
    });
  },
};

export async function runVerifierCommand(
  cmdStr: string,
  workspace: string,
  spawnFn: typeof spawn,
): Promise<VerifierResult> {
  const { program, args } = parseCommandString(cmdStr);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawnFn(program, args, {
      cwd: workspace,
      shell: false,
    });

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      const stdoutMeta = outputMetadata(stdout);
      const stderrMeta = outputMetadata(
        stderr + (stderr ? "\n" : "") + err.message,
      );
      resolve({
        command: cmdStr,
        exitCode: null,
        stdoutSha256: stdoutMeta.sha256,
        stdoutBytes: stdoutMeta.bytes,
        stderrSha256: stderrMeta.sha256,
        stderrBytes: stderrMeta.bytes,
        passed: false,
      });
    });

    child.on("exit", (code) => {
      const stdoutMeta = outputMetadata(stdout);
      const stderrMeta = outputMetadata(stderr);
      resolve({
        command: cmdStr,
        exitCode: code,
        stdoutSha256: stdoutMeta.sha256,
        stdoutBytes: stdoutMeta.bytes,
        stderrSha256: stderrMeta.sha256,
        stderrBytes: stderrMeta.bytes,
        passed: code === 0,
      });
    });
  });
}

export interface RunOptions {
  run: boolean;
  spawnFn?: typeof spawn;
  usageAdapter?: ProviderUsageAdapter;
}

function validateUsageValue(usage: ProviderUsage): void {
  if (usage.status === "unavailable") {
    if (
      typeof usage.reason !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(usage.reason)
    ) {
      throw new Error(
        "Provider usage unavailable receipt requires a safe reason code",
      );
    }
    return;
  }
  for (const [name, value] of Object.entries({
    input_uncached_tokens: usage.input_uncached_tokens,
    input_cached_tokens: usage.input_cached_tokens,
    output_tokens: usage.output_tokens,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Provider usage ${name} must be a non-negative safe integer`,
      );
    }
  }
  if (!Number.isFinite(usage.cost_usd) || usage.cost_usd < 0) {
    throw new Error(
      "Provider usage cost_usd must be a non-negative finite number",
    );
  }
  if (!Number.isFinite(usage.latency_ms) || usage.latency_ms < 0) {
    throw new Error(
      "Provider usage latency_ms must be a non-negative finite number",
    );
  }
}

function bindUsageReceipt(
  observation: ProviderUsageObservation,
  input: ProviderUsageAdapterInput,
): ProviderUsageReceipt {
  if (observation.version !== "1") {
    throw new Error("Provider usage receipt version mismatch");
  }
  if (observation.provider !== input.provider) {
    throw new Error("Provider usage provider mismatch");
  }
  if (observation.model !== input.model) {
    throw new Error("Provider usage model mismatch");
  }
  if (observation.resolved_snapshot_sha256 !== input.resolved_snapshot_sha256) {
    throw new Error("Provider usage resolved snapshot mismatch");
  }
  validateUsageValue(observation.usage);
  const usage: ProviderUsage =
    observation.usage.status === "reported"
      ? {
          status: "reported",
          input_uncached_tokens: observation.usage.input_uncached_tokens,
          input_cached_tokens: observation.usage.input_cached_tokens,
          output_tokens: observation.usage.output_tokens,
          cost_usd: observation.usage.cost_usd,
          latency_ms: observation.usage.latency_ms,
        }
      : { status: "unavailable", reason: observation.usage.reason };
  return {
    version: "1",
    provider: observation.provider,
    model: observation.model,
    resolved_snapshot_sha256: observation.resolved_snapshot_sha256,
    usage,
    task_id: input.task_id,
    attempt_index: input.attempt_index,
    suite_sha256: input.suite_sha256,
    verifier_sha256: input.verifier_sha256,
    provider_topology_sha256: input.provider_topology_sha256,
  };
}

export async function runBenchmarkSuite(
  suitePath: string,
  options: RunOptions,
): Promise<{
  report?: BenchmarkReport;
  plan: string;
}> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs);
  const absoluteSuitePath = resolve(suitePath);
  const suiteDir = dirname(absoluteSuitePath);

  if (!existsSync(absoluteSuitePath)) {
    throw new Error(`Suite file not found: ${suitePath}`);
  }

  const rawSuite = JSON.parse(readFileSync(absoluteSuitePath, "utf8"));
  const parsedSuite = BenchmarkSuiteSchema.parse(rawSuite);

  let plan = `Benchmark Suite: ${parsedSuite.name} (v${parsedSuite.version})\n`;
  plan += `Default Settings: Provider=${parsedSuite.defaultProviderSettings.provider}, Model=${parsedSuite.defaultProviderSettings.model}, Attempts=${parsedSuite.defaultAttempts}, Timeout=${parsedSuite.defaultTimeoutMs}ms\n`;
  plan += `Tasks to run:\n`;

  const tasksToRun = parsedSuite.tasks.map((task) => {
    const provider =
      task.providerSettings?.provider ??
      parsedSuite.defaultProviderSettings.provider;
    const model =
      task.providerSettings?.model ?? parsedSuite.defaultProviderSettings.model;
    const attempts = task.attempts ?? parsedSuite.defaultAttempts;
    const timeoutMs = task.timeoutMs ?? parsedSuite.defaultTimeoutMs;
    const resolvedWorkspace = task.workspace
      ? resolve(suiteDir, task.workspace)
      : "";

    plan += ` - Task ID: ${task.id}\n`;
    plan += `   Category: ${task.category}\n`;
    plan += `   Provider: ${provider}, Model: ${model}\n`;
    plan += `   Attempts: ${attempts}, Timeout: ${timeoutMs}ms\n`;
    plan += `   Workspace: ${resolvedWorkspace || "None (current directory)"}\n`;
    plan += `   Verifier commands: ${task.verifierCommands.join(", ") || "None"}\n`;

    return {
      task,
      provider,
      model,
      attempts,
      timeoutMs,
      resolvedWorkspace,
    };
  });
  const suiteFingerprint = suiteContractFingerprint(parsedSuite);
  const verifierSha256 = verifierFingerprint(parsedSuite);
  const providerTopologySha256 = sha256Canonical(
    tasksToRun.map(({ task, provider }) => ({ task_id: task.id, provider })),
  );
  const resolvedSnapshotSha256 = sha256Canonical(
    tasksToRun.map(({ task, provider, model }) => ({
      task_id: task.id,
      provider,
      model,
      settings_sha256: sha256Canonical(
        task.providerSettings ?? parsedSuite.defaultProviderSettings,
      ),
    })),
  );
  const providers = [...new Set(tasksToRun.map(({ provider }) => provider))];
  const models = [...new Set(tasksToRun.map(({ model }) => model))];
  const reportProvider = providers.length === 1 ? providers[0] : "mixed";
  const reportModel = models.length === 1 ? models[0] : "mixed";

  if (!options.run) {
    return { plan };
  }

  const spawnFn = options.spawnFn ?? spawn;
  const taskResults: TaskResult[] = [];
  let totalAttemptsRun = 0;

  for (const {
    task,
    provider,
    model,
    attempts,
    timeoutMs,
    resolvedWorkspace,
  } of tasksToRun) {
    if (task.workspace) {
      if (
        !existsSync(resolvedWorkspace) ||
        !statSync(resolvedWorkspace).isDirectory()
      ) {
        throw new Error(
          `Workspace for task ${task.id} must exist and be a directory: ${task.workspace}`,
        );
      }
    }

    const adapter = ADAPTERS[provider];
    if (!adapter) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const attemptResults: AttemptResult[] = [];
    for (let k = 1; k <= attempts; k++) {
      let attemptWorkspace = resolvedWorkspace;
      let cleanupFn = () => {};

      const projectTmpDir = join(tmpdir(), "forgewright-bench");
      mkdirSync(projectTmpDir, { recursive: true });

      if (resolvedWorkspace && existsSync(resolvedWorkspace)) {
        const tempBase = join(projectTmpDir, `forge-bench-${task.id}-`);
        attemptWorkspace = mkdtempSync(tempBase);
        cpSync(resolvedWorkspace, attemptWorkspace, { recursive: true });
        cleanupFn = () => {
          try {
            rmSync(attemptWorkspace, { recursive: true, force: true });
          } catch (e) {
            // Ignore cleanup errors
          }
        };
      } else {
        const tempBase = join(projectTmpDir, `forge-bench-empty-${task.id}-`);
        attemptWorkspace = mkdtempSync(tempBase);
        cleanupFn = () => {
          try {
            rmSync(attemptWorkspace, { recursive: true, force: true });
          } catch (e) {
            // Ignore cleanup errors
          }
        };
      }

      totalAttemptsRun++;
      let runResult: {
        exitStatus: number | null;
        durationMs: number;
        stdout: string;
        stderr: string;
      };
      try {
        runResult = await adapter(
          {
            taskId: task.id,
            prompt: task.prompt,
            model,
            workspace: attemptWorkspace,
            timeoutMs,
          },
          spawnFn,
        );
      } catch (err) {
        runResult = {
          exitStatus: null,
          durationMs: 0,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
        };
      }

      const verifierResults: VerifierResult[] = [];
      let allVerifiersPassed = task.verifierCommands.length > 0;
      for (const cmd of task.verifierCommands) {
        const res = await runVerifierCommand(cmd, attemptWorkspace, spawnFn);
        verifierResults.push(res);
        if (!res.passed) {
          allVerifiersPassed = false;
        }
      }

      const usageInput: ProviderUsageAdapterInput = {
        provider,
        model,
        resolved_snapshot_sha256: resolvedSnapshotSha256,
        suite_sha256: suiteFingerprint,
        verifier_sha256: verifierSha256,
        provider_topology_sha256: providerTopologySha256,
        task_id: task.id,
        attempt_index: k,
        adapter_duration_ms: runResult.durationMs,
        verifier_passed: runResult.exitStatus === 0 && allVerifiersPassed,
      };
      const usageObservation: ProviderUsageObservation = options.usageAdapter
        ? await options.usageAdapter(usageInput)
        : {
            version: "1",
            provider,
            model,
            resolved_snapshot_sha256: resolvedSnapshotSha256,
            usage: { status: "unavailable", reason: "adapter_unavailable" },
          };
      const usageReceipt = bindUsageReceipt(usageObservation, usageInput);

      const stdoutMeta = outputMetadata(runResult.stdout);
      const stderrMeta = outputMetadata(runResult.stderr);
      attemptResults.push({
        attemptIndex: k,
        durationMs: runResult.durationMs,
        exitStatus: runResult.exitStatus,
        verifierResults,
        passed: runResult.exitStatus === 0 && allVerifiersPassed,
        provider,
        model,
        taskId: task.id,
        stdoutSha256: stdoutMeta.sha256,
        stdoutBytes: stdoutMeta.bytes,
        stderrSha256: stderrMeta.sha256,
        stderrBytes: stderrMeta.bytes,
        usageReceipt,
      });

      cleanupFn();
    }

    const passedAt1 = attemptResults.length > 0 && attemptResults[0].passed;
    const passed = attemptResults.some((r) => r.passed);

    taskResults.push({
      taskId: task.id,
      category: task.category,
      attempts: attemptResults,
      passed,
      passedAt1,
    });
  }

  const summary = calculateMetrics(taskResults);
  const endedAtMs = Date.now();
  const endedAt = new Date(endedAtMs);
  const e2eWallMs = endedAtMs - startedAtMs;
  const usageReceipts = taskResults.flatMap((task) =>
    task.attempts.flatMap((attempt) =>
      attempt.usageReceipt ? [attempt.usageReceipt] : [],
    ),
  );
  const reportedUsage = usageReceipts.filter(
    (
      receipt,
    ): receipt is ProviderUsageReceipt & {
      usage: Extract<ProviderUsage, { status: "reported" }>;
    } => receipt.usage.status === "reported",
  );
  const usageReported =
    usageReceipts.length === totalAttemptsRun &&
    reportedUsage.length === totalAttemptsRun;
  const usageUnavailableCount = usageReceipts.length - reportedUsage.length;
  const totalReported = <
    Key extends keyof Extract<ProviderUsage, { status: "reported" }>,
  >(
    key: Key,
  ): number | null =>
    usageReported
      ? reportedUsage.reduce(
          (total, receipt) => total + Number(receipt.usage[key]),
          0,
        )
      : null;

  const report: BenchmarkReport = {
    mode: "live",
    suiteName: parsedSuite.name,
    suiteVersion: parsedSuite.version,
    timestamp: endedAt.toISOString(),
    provider: reportProvider,
    model: reportModel,
    defaultAttempts: parsedSuite.defaultAttempts,
    totalTasks: parsedSuite.tasks.length,
    verifierVersion: VERIFIER_VERSION,
    suiteFingerprint,
    verifierFingerprint: verifierSha256,
    measurementRecord: {
      version: "1",
      run_id: randomUUID(),
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      e2e_wall_ms: e2eWallMs,
      provider: reportProvider,
      model: reportModel,
      suite_sha256: suiteFingerprint,
      verifier_sha256: verifierSha256,
      resolved_snapshot_sha256: resolvedSnapshotSha256,
      provider_topology_sha256: providerTopologySha256,
      usage_source: usageReported ? "reported" : "unavailable",
      usage_receipt_count: usageReceipts.length,
      usage_reported_count: reportedUsage.length,
      usage_unavailable_count: usageUnavailableCount,
      input_uncached_tokens: totalReported("input_uncached_tokens"),
      input_cached_tokens: totalReported("input_cached_tokens"),
      output_tokens: totalReported("output_tokens"),
      cost_usd: usageReported
        ? Number(totalReported("cost_usd")!.toFixed(12))
        : null,
      provider_latency_ms: totalReported("latency_ms"),
      critical_path_ms: e2eWallMs,
      critical_path_unverified: true,
      production_evidence: "missing",
    },
    totalAttemptsRun,
    summary,
    tasks: taskResults,
  };

  return { report, plan };
}
