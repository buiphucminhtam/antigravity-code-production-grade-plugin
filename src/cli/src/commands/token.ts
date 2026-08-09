/**
 * Token Command - Token tracking controls
 */
import type { Command } from "commander";
import pc from "picocolors";
import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { isIP } from "net";
import { homedir } from "os";
import { join } from "path";
import {
  findProjectRoot,
  getProductionConfigPath,
} from "../utils/project-config.js";
import {
  DEFAULT_TOKEN_BUDGET,
  ensureBudgetFile,
  getBudgetPath,
  getDefaultUsageDir,
  getTokenTrackingEnabled,
  readBudgetFile,
  setTokenTrackingEnabled,
  summarizeUsage,
  writeBudgetFile,
  logTokenUsage,
  type TokenBudget,
} from "../utils/token-tracking.js";
import { buildEnvelope } from "../types/index.js";
import { VERSION } from "../version.js";
import { EXIT_CODES } from "../exit-codes.js";

export function registerTokenCommand(program: Command): void {
  const token = program
    .command("token")
    .description("Token tracking controls and usage reports");

  token
    .command("status")
    .description("Show token tracking status")
    .option("-j, --json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      await handleStatus(Boolean(options.json));
    });

  token
    .command("on")
    .description("Enable token tracking")
    .option("-j, --json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      await handleToggle(true, Boolean(options.json), "token.on");
    });

  token
    .command("off")
    .description("Disable token tracking without deleting usage data")
    .option("-j, --json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      await handleToggle(false, Boolean(options.json), "token.off");
    });

  token
    .command("budget")
    .description("Show or update token tracking budget")
    .option("--daily <usd>", "Daily budget in USD")
    .option("--weekly <usd>", "Weekly budget in USD")
    .option("--monthly <usd>", "Monthly budget in USD")
    .option("-j, --json", "Output as JSON")
    .action(
      async (options: {
        daily?: string;
        weekly?: string;
        monthly?: string;
        json?: boolean;
      }) => {
        await handleBudget(options);
      },
    );

  token
    .command("report")
    .description("Show usage summary from local token logs")
    .option("--period <day|week|month>", "Report period", "week")
    .option("-j, --json", "Output as JSON")
    .action(async (options: { period: string; json?: boolean }) => {
      await handleReport(options);
    });

  token
    .command("log")
    .description("Log LLM token usage details")
    .requiredOption("--input-tokens <tokens>", "Prompt/input tokens")
    .requiredOption("--output-tokens <tokens>", "Completion/output tokens")
    .requiredOption("--model <model>", "Model name")
    .requiredOption("--provider <provider>", "Provider name")
    .option("--cost <cost>", "USD Cost")
    .requiredOption("--skill <skill>", "Skill name")
    .option("-j, --json", "Output as JSON")
    .action(
      async (options: {
        inputTokens: string;
        outputTokens: string;
        model: string;
        provider: string;
        cost?: string;
        skill: string;
        json?: boolean;
      }) => {
        await handleLogToken(options);
      },
    );

  token
    .command("dashboard")
    .description("Start the token usage dashboard server")
    .option(
      "--host <host>",
      "Bind host (non-loopback requires dashboard auth token env)",
      "127.0.0.1",
    )
    .option("--port <port>", "Dashboard port", "8080")
    .option("-j, --json", "Output startup information as JSON before launching")
    .action(async (options: { host: string; port: string; json?: boolean }) => {
      await handleDashboard(options);
    });
}

async function handleStatus(useJson: boolean): Promise<void> {
  const startTime = Date.now();
  const projectRoot = findProjectRoot();
  const summary = summarizeUsage(projectRoot, 7);
  const data = {
    projectRoot,
    configPath: getProductionConfigPath(projectRoot),
    enabled: getTokenTrackingEnabled(projectRoot),
    usageDir: getDefaultUsageDir(projectRoot),
    budgetPath: getBudgetPath(projectRoot),
    budget: readBudgetFile(projectRoot),
    last7Days: summary,
    sources: {
      forgewrightUsageDir: existsSync(getDefaultUsageDir(projectRoot)),
      claudeTelemetry: existsSync(join(homedir(), ".claude", "telemetry")),
      codexConfig: existsSync(join(homedir(), ".codex")),
    },
  };

  writeOutput("token.status", data, useJson, Date.now() - startTime);
  process.exit(EXIT_CODES.OK);
}

async function handleToggle(
  enabled: boolean,
  useJson: boolean,
  tool: string,
): Promise<void> {
  const startTime = Date.now();
  const projectRoot = findProjectRoot();
  setTokenTrackingEnabled(projectRoot, enabled);

  const data = {
    projectRoot,
    configPath: getProductionConfigPath(projectRoot),
    enabled,
    usageDir: getDefaultUsageDir(projectRoot),
    budgetPath: ensureBudgetFile(projectRoot),
  };

  writeOutput(tool, data, useJson, Date.now() - startTime);
  process.exit(EXIT_CODES.OK);
}

async function handleBudget(options: {
  daily?: string;
  weekly?: string;
  monthly?: string;
  json?: boolean;
}): Promise<void> {
  const startTime = Date.now();
  const useJson = Boolean(options.json) || !process.stdout.isTTY;
  const projectRoot = findProjectRoot();
  const existing = readBudgetFile(projectRoot) ?? DEFAULT_TOKEN_BUDGET;
  const shouldUpdate =
    options.daily !== undefined ||
    options.weekly !== undefined ||
    options.monthly !== undefined;

  const budget: TokenBudget = {
    daily:
      options.daily !== undefined
        ? parseUsd(options.daily, "daily", useJson)
        : existing.daily,
    weekly:
      options.weekly !== undefined
        ? parseUsd(options.weekly, "weekly", useJson)
        : existing.weekly,
    monthly:
      options.monthly !== undefined
        ? parseUsd(options.monthly, "monthly", useJson)
        : existing.monthly,
  };

  if (shouldUpdate) {
    writeBudgetFile(projectRoot, budget);
  } else {
    ensureBudgetFile(projectRoot, budget);
  }

  writeOutput(
    "token.budget",
    {
      projectRoot,
      budgetPath: getBudgetPath(projectRoot),
      updated: shouldUpdate,
      budget,
    },
    useJson,
    Date.now() - startTime,
  );
  process.exit(EXIT_CODES.OK);
}

async function handleReport(options: {
  period: string;
  json?: boolean;
}): Promise<void> {
  const startTime = Date.now();
  const useJson = Boolean(options.json) || !process.stdout.isTTY;
  const projectRoot = findProjectRoot();
  const days = periodToDays(options.period, useJson);
  const summary = summarizeUsage(projectRoot, days);

  writeOutput(
    "token.report",
    {
      projectRoot,
      period: options.period,
      summary,
    },
    useJson,
    Date.now() - startTime,
  );
  process.exit(EXIT_CODES.OK);
}

async function handleDashboard(options: {
  host: string;
  port: string;
  json?: boolean;
}): Promise<void> {
  const startTime = Date.now();
  const useJson = Boolean(options.json) || !process.stdout.isTTY;
  const projectRoot = findProjectRoot();
  const scriptPath = join(projectRoot, "scripts", "token-api-server.py");
  const host = parseDashboardHost(options.host, useJson);
  const port = parsePort(options.port, useJson);
  const authRequired = !isLoopbackDashboardHost(host);

  if (
    authRequired &&
    !process.env.FORGEWRIGHT_TOKEN_DASHBOARD_AUTH_TOKEN?.trim()
  ) {
    fail(
      "Non-loopback dashboard binding requires FORGEWRIGHT_TOKEN_DASHBOARD_AUTH_TOKEN.",
      useJson,
      EXIT_CODES.USAGE_ERROR,
    );
  }

  if (!existsSync(scriptPath)) {
    fail(
      `Token dashboard script not found: ${scriptPath}`,
      useJson,
      EXIT_CODES.MISSING_DEPENDENCY,
    );
  }

  const python = findPythonCommand();
  if (!python) {
    fail(
      "No Python launcher found. Install python, python3, or py to run the dashboard.",
      useJson,
      EXIT_CODES.MISSING_DEPENDENCY,
    );
  }

  const displayHost = isIP(host) === 6 ? `[${host}]` : host;
  const data = {
    projectRoot,
    scriptPath,
    host,
    port,
    authRequired,
    url: `http://${displayHost}:${port}/dashboard`,
    python,
  };

  if (useJson) {
    writeOutput("token.dashboard", data, true, Date.now() - startTime);
  } else {
    console.log(pc.green(`Starting token dashboard: ${data.url}`));
    console.log(pc.dim("Press Ctrl+C to stop."));
  }

  const child = spawn(
    python,
    [scriptPath, "--host", host, "--port", String(port)],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? EXIT_CODES.OK);
  });
}

function writeOutput<T>(
  tool: string,
  data: T,
  useJson: boolean,
  durationMs: number,
): void {
  if (useJson || !process.stdout.isTTY) {
    const envelope = buildEnvelope(tool, data, {
      ok: true,
      duration_ms: durationMs,
      version: VERSION,
    });
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  console.log();
  console.log(pc.bold(`  ${tool}`));
  console.log(pc.gray("  " + "-".repeat(50)));
  console.log(JSON.stringify(data, null, 2));
  console.log();
}

function parseUsd(value: string, label: string, useJson: boolean): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(
      `Invalid ${label} budget: ${value}. Use a non-negative number.`,
      useJson,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  return parsed;
}

function parseDashboardHost(value: string, useJson: boolean): string {
  const host = value.trim();
  if (host === "localhost" || isIP(host) > 0) {
    return host;
  }
  fail(
    `Invalid dashboard host: ${value}. Use localhost or an IP address.`,
    useJson,
    EXIT_CODES.USAGE_ERROR,
  );
}

function isLoopbackDashboardHost(host: string): boolean {
  if (host === "localhost" || host === "::1") {
    return true;
  }
  return isIP(host) === 4 && host.split(".")[0] === "127";
}

function parsePort(value: string, useJson: boolean): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    fail(
      `Invalid port: ${value}. Use an integer from 1 to 65535.`,
      useJson,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  return parsed;
}

function periodToDays(period: string, useJson: boolean): number {
  if (period === "day") {
    return 1;
  }
  if (period === "week") {
    return 7;
  }
  if (period === "month") {
    return 30;
  }
  fail(
    `Invalid period "${period}". Use day, week, or month.`,
    useJson,
    EXIT_CODES.USAGE_ERROR,
  );
}

function findPythonCommand(): string | null {
  for (const command of ["python3", "python", "py"]) {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf-8",
      shell: process.platform === "win32",
      timeout: 3000,
    });

    if (!result.error && result.status === 0) {
      return command;
    }
  }

  return null;
}

function fail(message: string, useJson: boolean, code: number): never {
  if (useJson || !process.stdout.isTTY) {
    const envelope = buildEnvelope("token.error", null, {
      ok: false,
      duration_ms: 0,
      version: VERSION,
      error: { code, message },
    });
    console.log(JSON.stringify(envelope, null, 2));
  } else {
    console.error(pc.red(`Error: ${message}`));
  }
  process.exit(code);
}

async function handleLogToken(options: {
  inputTokens: string;
  outputTokens: string;
  model: string;
  provider: string;
  cost?: string;
  skill: string;
  json?: boolean;
}): Promise<void> {
  const startTime = Date.now();
  const useJson = Boolean(options.json) || !process.stdout.isTTY;
  const projectRoot = findProjectRoot();

  const inputTokens = Number(options.inputTokens);
  const outputTokens = Number(options.outputTokens);
  const cost = options.cost !== undefined ? Number(options.cost) : null;

  if (!Number.isInteger(inputTokens) || inputTokens < 0) {
    fail(
      "Invalid input-tokens: must be a non-negative integer.",
      useJson,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  if (!Number.isInteger(outputTokens) || outputTokens < 0) {
    fail(
      "Invalid output-tokens: must be a non-negative integer.",
      useJson,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    fail(
      "Invalid cost: must be a non-negative number.",
      useJson,
      EXIT_CODES.USAGE_ERROR,
    );
  }

  const entry = {
    inputTokens,
    outputTokens,
    model: options.model,
    provider: options.provider,
    cost,
    timestamp: new Date().toISOString(),
    skill: options.skill,
  };

  logTokenUsage(projectRoot, entry);

  writeOutput(
    "token.log",
    {
      success: true,
      entry,
    },
    useJson,
    Date.now() - startTime,
  );
  process.exit(EXIT_CODES.OK);
}
