import { describe, expect, it } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runBenchmarkSuite,
  parseCommandString,
  sanitizeOutput,
} from "../src/bench/runner.js";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

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

describe("Benchmark runner", () => {
  it("parses command strings with quotes correctly", () => {
    expect(parseCommandString("node verify.js \"arg 1\" 'arg 2'")).toEqual({
      program: "node",
      args: ["verify.js", "arg 1", "arg 2"],
    });
    expect(parseCommandString("npm run test")).toEqual({
      program: "npm",
      args: ["run", "test"],
    });
  });

  it("sanitizes output of sensitive API keys and truncates long text", () => {
    const raw =
      "API Key: sk-[REDACTED]\nGoogle Key: AIzaSy1234567890-abcdefghij123456789012\nSome long text ".repeat(
        100,
      );
    const sanitized = sanitizeOutput(raw);
    expect(sanitized).toContain("[REDACTED_API_KEY]");
    expect(sanitized).toContain("[TRUNCATED]");
    expect(sanitized.length).toBeLessThan(3000);
  });

  it("generates plan in dry-run mode and does not spawn processes", async () => {
    const tempDir = join(tmpdir(), `test-suite-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    const suiteContent = {
      version: "1.0",
      name: "Smoke Test Suite",
      defaultProviderSettings: {
        provider: "agy",
        model: "Gemini 3.5 Flash (High)",
      },
      defaultAttempts: 1,
      defaultTimeoutMs: 10000,
      tasks: [
        {
          id: "task-1",
          category: "smoke",
          prompt: "Verify the login feature.",
          verifierCommands: ["node verify.js"],
        },
      ],
    };

    writeFileSync(suitePath, JSON.stringify(suiteContent), "utf8");

    const { spawnFn, spawnCalls } = createMockSpawn(0);
    const { report, plan } = await runBenchmarkSuite(suitePath, {
      run: false,
      spawnFn,
    });

    expect(report).toBeUndefined();
    expect(plan).toContain("Benchmark Suite: Smoke Test Suite");
    expect(plan).toContain("Task ID: task-1");
    expect(spawnCalls.length).toBe(0);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails suite parsing if task IDs are duplicates", async () => {
    const tempDir = join(tmpdir(), `test-suite-dup-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    const suiteContent = {
      version: "1.0",
      name: "Duplicate Suite",
      defaultProviderSettings: {
        provider: "agy",
        model: "Gemini 3.5 Flash (High)",
      },
      defaultAttempts: 1,
      defaultTimeoutMs: 10000,
      tasks: [
        {
          id: "task-1",
          category: "smoke",
          prompt: "Prompt 1",
          verifierCommands: ["node verify.js"],
        },
        {
          id: "task-1",
          category: "smoke",
          prompt: "Prompt 2",
          verifierCommands: ["node verify.js"],
        },
      ],
    };

    writeFileSync(suitePath, JSON.stringify(suiteContent), "utf8");

    await expect(
      runBenchmarkSuite(suitePath, { run: false }),
    ).rejects.toThrow();

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("performs live runs spawning adapters and verifiers correctly", async () => {
    const tempDir = join(tmpdir(), `test-suite-live-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    const suiteContent = {
      version: "1.0",
      name: "Live Test Suite",
      defaultProviderSettings: {
        provider: "agy",
        model: "Gemini 3.5 Flash (High)",
      },
      defaultAttempts: 2,
      defaultTimeoutMs: 10000,
      tasks: [
        {
          id: "task-1",
          category: "smoke",
          prompt: "Prompt 1",
          verifierCommands: ["node verify.js"],
        },
      ],
    };

    writeFileSync(suitePath, JSON.stringify(suiteContent), "utf8");

    const { spawnFn, spawnCalls } = createMockSpawn(
      0,
      "success_stdout",
      "no_errors",
    );
    const { report } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn,
    });

    expect(report).toBeDefined();
    expect(report?.summary.totalTasks).toBe(1);
    expect(report?.tasks[0].attempts.length).toBe(2);
    expect(report?.tasks[0].attempts[0].stdoutSha256).toBe(
      createHash("sha256").update("success_stdout").digest("hex"),
    );
    expect(report?.tasks[0].attempts[0].stdoutBytes).toBe(14);
    expect(report?.tasks[0].attempts[0].stderrSha256).toBe(
      createHash("sha256").update("no_errors").digest("hex"),
    );
    expect(report?.tasks[0].attempts[0].stderrBytes).toBe(9);

    // Check spawned adapter and verifier calls
    expect(spawnCalls.length).toBe(4); // 2 runs (adapter + verifier) per attempt
    expect(spawnCalls[0].program).toBe("agy");
    expect(spawnCalls[0].options.shell).toBe(false);
    expect([
      spawnCalls[0].options.cwd,
      `/private${spawnCalls[0].options.cwd}`,
    ]).toContain(spawnCalls[0].options.env.FORGEWRIGHT_WORKSPACE);
    expect(spawnCalls[1].program).toBe("node");
    expect(spawnCalls[1].args).toEqual(["verify.js"]);
    expect(spawnCalls[1].options.shell).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects empty verifierCommands array", async () => {
    const tempDir = join(tmpdir(), `test-suite-empty-verifier-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    const suiteContent = {
      version: "1.0",
      name: "Empty Verifier Suite",
      defaultProviderSettings: {
        provider: "agy",
        model: "Gemini 3.5 Flash (High)",
      },
      defaultAttempts: 1,
      defaultTimeoutMs: 10000,
      tasks: [
        {
          id: "task-1",
          category: "smoke",
          prompt: "Prompt 1",
          verifierCommands: [],
        },
      ],
    };

    writeFileSync(suitePath, JSON.stringify(suiteContent), "utf8");

    await expect(
      runBenchmarkSuite(suitePath, { run: false }),
    ).rejects.toThrow();

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("checks exact argv shapes for Agy, Codex and Gemini adapters", async () => {
    const tempDir = join(tmpdir(), `test-suite-argv-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Test Agy
    const suitePathAgy = join(tempDir, "suite-agy.json");
    writeFileSync(
      suitePathAgy,
      JSON.stringify({
        version: "1.0",
        name: "Agy Argv Suite",
        defaultProviderSettings: { provider: "agy", model: "Gemini-3.5" },
        tasks: [
          {
            id: "task-1",
            category: "smoke",
            prompt: "Hello Prompt",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    const { spawnFn: spawnFnAgy, spawnCalls: spawnCallsAgy } =
      createMockSpawn(0);
    await runBenchmarkSuite(suitePathAgy, { run: true, spawnFn: spawnFnAgy });

    const agyCall = spawnCallsAgy.find((c) => c.program === "agy");
    expect(agyCall).toBeDefined();
    expect(agyCall?.args).toEqual([
      "--model",
      "Gemini-3.5",
      "--sandbox",
      "--mode",
      "accept-edits",
      "--print",
      "Read WORKER_INSTRUCTIONS.md and CONTRACT.json, execute only the contracted task, run its verification commands, and write DELIVERY.json.",
    ]);

    // Test Codex
    const suitePathCodex = join(tempDir, "suite-codex.json");
    writeFileSync(
      suitePathCodex,
      JSON.stringify({
        version: "1.0",
        name: "Codex Argv Suite",
        defaultProviderSettings: { provider: "codex", model: "GPT-5.5" },
        tasks: [
          {
            id: "task-2",
            category: "smoke",
            prompt: "Hello Prompt",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    const { spawnFn: spawnFnCodex, spawnCalls: spawnCallsCodex } =
      createMockSpawn(0);
    await runBenchmarkSuite(suitePathCodex, {
      run: true,
      spawnFn: spawnFnCodex,
    });

    const codexCall = spawnCallsCodex.find((c) => c.program === "codex");
    expect(codexCall).toBeDefined();
    expect(codexCall?.args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--model",
      "GPT-5.5",
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      "Hello Prompt",
    ]);

    // Test Gemini
    const suitePathGemini = join(tempDir, "suite-gemini.json");
    writeFileSync(
      suitePathGemini,
      JSON.stringify({
        version: "1.0",
        name: "Gemini Argv Suite",
        defaultProviderSettings: { provider: "gemini", model: "Gemini-3.1" },
        tasks: [
          {
            id: "task-3",
            category: "smoke",
            prompt: "Hello Prompt",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    const { spawnFn: spawnFnGemini, spawnCalls: spawnCallsGemini } =
      createMockSpawn(0);
    await runBenchmarkSuite(suitePathGemini, {
      run: true,
      spawnFn: spawnFnGemini,
    });

    const geminiCall = spawnCallsGemini.find((c) => c.program === "gemini");
    expect(geminiCall).toBeDefined();
    expect(geminiCall?.args).toEqual([
      "-m",
      "Gemini-3.1",
      "-y",
      "-p",
      "Hello Prompt",
    ]);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects suites with no tasks", async () => {
    const tempDir = join(tmpdir(), `test-suite-empty-tasks-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "Empty Task Suite",
        defaultProviderSettings: { provider: "agy", model: "Gemini-3.5" },
        tasks: [],
      }),
      "utf8",
    );

    await expect(runBenchmarkSuite(suitePath, { run: false })).rejects.toThrow(
      "Benchmark suite must include at least one task",
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects an explicitly configured missing workspace before spawning", async () => {
    const tempDir = join(
      tmpdir(),
      `test-suite-missing-workspace-${Date.now()}`,
    );
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "Missing Workspace Suite",
        defaultProviderSettings: { provider: "agy", model: "Gemini-3.5" },
        tasks: [
          {
            id: "task-1",
            category: "smoke",
            prompt: "Prompt 1",
            workspace: "missing-workspace",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    const { spawnFn, spawnCalls } = createMockSpawn(0);

    await expect(
      runBenchmarkSuite(suitePath, { run: true, spawnFn }),
    ).rejects.toThrow(
      "Workspace for task task-1 must exist and be a directory",
    );
    expect(spawnCalls.length).toBe(0);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("considers attempt successful only if exitStatus === 0 and verifiers pass", async () => {
    const tempDir = join(tmpdir(), `test-suite-success-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    const suiteContent = {
      version: "1.0",
      name: "Exit status test suite",
      defaultProviderSettings: { provider: "agy", model: "Gemini-3.5" },
      tasks: [
        {
          id: "task-1",
          category: "smoke",
          prompt: "Prompt 1",
          verifierCommands: ["node verify.js"],
        },
      ],
    };
    writeFileSync(suitePath, JSON.stringify(suiteContent), "utf8");

    // Case 1: exitStatus !== 0 (failure), verifier passes
    const spawnCalls: any[] = [];
    const customSpawn = ((program: string, args: string[], options: any) => {
      spawnCalls.push({ program, args, options });
      const cp = new EventEmitter() as any;
      cp.stdout = Readable.from([""]);
      cp.stderr = Readable.from([""]);
      cp.kill = () => {};
      process.nextTick(() => {
        cp.emit("exit", program === "agy" ? 1 : 0, null);
      });
      return cp;
    }) as any;

    const { report: reportExitFail } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn: customSpawn,
    });
    expect(reportExitFail?.tasks[0].passed).toBe(false);

    // Case 2: spawn error (exitStatus null), verifier passes
    const customSpawnError = ((
      program: string,
      args: string[],
      options: any,
    ) => {
      const cp = new EventEmitter() as any;
      cp.stdout = Readable.from([""]);
      cp.stderr = Readable.from([""]);
      cp.kill = () => {};
      process.nextTick(() => {
        if (program === "agy") {
          cp.emit("error", new Error("spawn error"));
        } else {
          cp.emit("exit", 0, null);
        }
      });
      return cp;
    }) as any;

    const { report: reportError } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn: customSpawnError,
    });
    expect(reportError?.tasks[0].passed).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("marks timed-out attempts as failed even when verifiers pass", async () => {
    const tempDir = join(tmpdir(), `test-suite-timeout-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const suitePath = join(tempDir, "suite.json");

    writeFileSync(
      suitePath,
      JSON.stringify({
        version: "1.0",
        name: "Timeout test suite",
        defaultProviderSettings: { provider: "agy", model: "Gemini-3.5" },
        defaultTimeoutMs: 1,
        tasks: [
          {
            id: "task-1",
            category: "smoke",
            prompt: "Prompt 1",
            verifierCommands: ["node verify.js"],
          },
        ],
      }),
      "utf8",
    );

    let agentKilled = false;
    const customSpawnTimeout = ((
      program: string,
      args: string[],
      options: any,
    ) => {
      const cp = new EventEmitter() as any;
      cp.stdout = Readable.from([""]);
      cp.stderr = Readable.from([""]);
      cp.kill = () => {
        agentKilled = true;
        return true;
      };
      if (program !== "agy") {
        process.nextTick(() => {
          cp.emit("exit", 0, null);
        });
      }
      return cp;
    }) as any;

    const { report } = await runBenchmarkSuite(suitePath, {
      run: true,
      spawnFn: customSpawnTimeout,
    });

    expect(agentKilled).toBe(true);
    expect(report?.tasks[0].attempts[0].exitStatus).toBeNull();
    expect(report?.tasks[0].attempts[0].verifierResults[0].passed).toBe(true);
    expect(report?.tasks[0].attempts[0].passed).toBe(false);
    expect(report?.tasks[0].passed).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
