import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { doctorCatalog } from "../docs/doctor.js";
import { initManifest } from "../docs/manifest.js";
import { exportObsidianVault } from "../docs/obsidian.js";
import {
  addRegistryProject,
  getDocsHubHome,
  loadRegistry,
  removeRegistryProject,
  resolveRegistryProject,
} from "../docs/registry.js";
import { buildDocsHub } from "../docs/render.js";
import { resolveCatalogLinks } from "../docs/links.js";
import {
  readCatalog,
  refreshCatalogSummary,
  scanProject,
  writeCatalog,
} from "../docs/scanner.js";
import type { DocsBuildResult, DocsCatalog } from "../docs/types.js";
import { EXIT_CODES } from "../exit-codes.js";
import { buildEnvelope } from "../types/index.js";
import { VERSION } from "../version.js";

type DocsOptions = {
  all?: boolean;
  force?: boolean;
  json?: boolean;
  output?: string;
  strict?: boolean;
  write?: boolean;
};

const PRIVACY_BLOCKING_CODES = new Set([
  "EMPTY_PRIVACY_ALLOWLIST",
  "PATH_CONTAINMENT_FAILED",
  "SENSITIVE_SOURCE_REJECTED",
]);

function useJson(program: Command, options: DocsOptions): boolean {
  return Boolean(options.json || program.opts().json || !process.stdout.isTTY);
}

function writeSuccess(
  tool: string,
  data: unknown,
  json: boolean,
  startedAt: number,
): void {
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        buildEnvelope(tool, data, {
          ok: true,
          duration_ms: Date.now() - startedAt,
          version: VERSION,
        }),
      )}\n`,
    );
    return;
  }
  process.stdout.write(`${pc.green("✓")} ${tool}\n`);
  if (data && typeof data === "object") {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }
}

function writeFailure(
  tool: string,
  message: string,
  details: unknown,
  json: boolean,
  startedAt: number,
  exitCode: number = EXIT_CODES.CONFIG_ERROR,
): void {
  const envelope = buildEnvelope(tool, details, {
    ok: false,
    duration_ms: Date.now() - startedAt,
    version: VERSION,
    error: { code: exitCode, message, details },
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } else {
    process.stderr.write(`${pc.red("Error:")} ${message}\n`);
  }
  process.exitCode = exitCode;
}

function resolveProjectRoots(
  target: string | undefined,
  all: boolean | undefined,
): string[] {
  if (all) {
    return loadRegistry().projects.map((project) => project.root);
  }

  const input = target ?? process.cwd();
  if (existsSync(input)) {
    return [resolve(input)];
  }
  const registered = resolveRegistryProject(input);
  if (!registered) {
    throw new Error(
      `Unknown project "${input}". Pass a path or add it with \`forge docs registry add\`.`,
    );
  }
  return [registered.root];
}

function scanRoots(roots: string[]): {
  catalogs: DocsCatalog[];
  failures: Array<{ root: string; message: string }>;
} {
  const catalogs: DocsCatalog[] = [];
  const failures: Array<{ root: string; message: string }> = [];
  for (const root of roots) {
    try {
      catalogs.push(scanProject(root));
    } catch (error) {
      failures.push({
        root,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  resolveCatalogLinks(catalogs);
  for (const catalog of catalogs) refreshCatalogSummary(catalog);
  return { catalogs, failures };
}

function hasPrivacyBlock(catalog: DocsCatalog): boolean {
  return catalog.diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      PRIVACY_BLOCKING_CODES.has(diagnostic.code),
  );
}

function defaultBuildOutput(roots: string[], all: boolean | undefined): string {
  return all || roots.length !== 1
    ? join(getDocsHubHome(), "docs-hub", "site")
    : join(roots[0], ".forgewright", "docs-hub", "site");
}

export interface DocsBatchBuildExecution {
  buildResult: DocsBuildResult | null;
  failures: Array<{ root: string; message: string }>;
  blockedProjects: string[];
  strictProjects: string[];
}

export function executeDocsBuild(
  roots: string[],
  output: string,
  options: { strict?: boolean } = {},
): DocsBatchBuildExecution {
  const scanned = scanRoots(roots);
  const blocked = scanned.catalogs.filter(hasPrivacyBlock);
  const strictFailures = options.strict
    ? scanned.catalogs.filter((catalog) =>
        catalog.diagnostics.some(
          (diagnostic) =>
            diagnostic.severity === "warning" ||
            diagnostic.severity === "error",
        ),
      )
    : [];
  const rejectedIds = new Set([
    ...blocked.map((catalog) => catalog.project.id),
    ...strictFailures.map((catalog) => catalog.project.id),
  ]);
  const buildable = scanned.catalogs.filter(
    (catalog) => !rejectedIds.has(catalog.project.id),
  );
  for (const catalog of buildable) writeCatalog(catalog);
  return {
    buildResult:
      buildable.length > 0 ? buildDocsHub(buildable, resolve(output)) : null,
    failures: scanned.failures,
    blockedProjects: blocked.map((catalog) => catalog.project.id),
    strictProjects: strictFailures.map((catalog) => catalog.project.id),
  };
}

export function registerDocsCommands(program: Command): void {
  const docs = program
    .command("docs")
    .description(
      "Build a privacy-safe, local-first multi-project documentation hub",
    );

  docs
    .command("init [target]")
    .description("Create a project docs manifest without moving source files")
    .option("-f, --force", "Overwrite an existing manifest")
    .option("-j, --json", "Output as JSON")
    .action((target: string | undefined, options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        const result = initManifest(target ?? process.cwd(), {
          force: options.force,
        });
        writeSuccess("forge.docs.init", result, json, startedAt);
      } catch (error) {
        writeFailure(
          "forge.docs.init",
          error instanceof Error ? error.message : String(error),
          null,
          json,
          startedAt,
        );
      }
    });

  const registry = docs
    .command("registry")
    .description("Manage the global Docs Hub project registry");

  registry
    .command("add <path>")
    .description("Register or update a project root")
    .option("-j, --json", "Output as JSON")
    .action((path: string, options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        writeSuccess(
          "forge.docs.registry.add",
          addRegistryProject(path),
          json,
          startedAt,
        );
      } catch (error) {
        writeFailure(
          "forge.docs.registry.add",
          error instanceof Error ? error.message : String(error),
          { path },
          json,
          startedAt,
        );
      }
    });

  registry
    .command("list")
    .description("List registered projects")
    .option("-j, --json", "Output as JSON")
    .action((options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        writeSuccess(
          "forge.docs.registry.list",
          loadRegistry(),
          json,
          startedAt,
        );
      } catch (error) {
        writeFailure(
          "forge.docs.registry.list",
          error instanceof Error ? error.message : String(error),
          null,
          json,
          startedAt,
        );
      }
    });

  registry
    .command("remove <id-or-path>")
    .description("Remove a project from the registry")
    .option("-j, --json", "Output as JSON")
    .action((idOrPath: string, options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        const removed = removeRegistryProject(idOrPath);
        if (!removed) {
          writeFailure(
            "forge.docs.registry.remove",
            `Project is not registered: ${idOrPath}`,
            { idOrPath },
            json,
            startedAt,
          );
          return;
        }
        writeSuccess(
          "forge.docs.registry.remove",
          { removed },
          json,
          startedAt,
        );
      } catch (error) {
        writeFailure(
          "forge.docs.registry.remove",
          error instanceof Error ? error.message : String(error),
          { idOrPath },
          json,
          startedAt,
        );
      }
    });

  docs
    .command("scan [target]")
    .description("Scan approved sources and write a normalized JSON catalog")
    .option("--all", "Scan every registered project")
    .option("--no-write", "Do not write project cache files")
    .option("-j, --json", "Output as JSON")
    .action((target: string | undefined, options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        const roots = resolveProjectRoots(target, options.all);
        const result = scanRoots(roots);
        const catalogs = result.catalogs.map((catalog) => ({
          project: catalog.project,
          documents: catalog.documents.length,
          assets: catalog.assets.length,
          diagnostics: catalog.diagnostics,
          sourceFingerprint: catalog.sourceFingerprint,
          catalogPath: options.write === false ? null : writeCatalog(catalog),
        }));
        if (result.failures.length > 0) {
          writeFailure(
            "forge.docs.scan",
            "One or more projects could not be scanned.",
            { catalogs, failures: result.failures },
            json,
            startedAt,
          );
          return;
        }
        writeSuccess("forge.docs.scan", { catalogs }, json, startedAt);
      } catch (error) {
        writeFailure(
          "forge.docs.scan",
          error instanceof Error ? error.message : String(error),
          null,
          json,
          startedAt,
        );
      }
    });

  docs
    .command("build [target]")
    .description("Build the static HTML/CSS Docs Hub")
    .option("--all", "Build every registered project")
    .option("-o, --output <path>", "Override the generated site directory")
    .option("--strict", "Fail before building when warnings or errors exist")
    .option("-j, --json", "Output as JSON")
    .action((target: string | undefined, options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        const roots = resolveProjectRoots(target, options.all);
        const output = resolve(
          options.output ?? defaultBuildOutput(roots, options.all),
        );
        const execution = executeDocsBuild(roots, output, {
          strict: options.strict,
        });
        if (!execution.buildResult) {
          writeFailure(
            "forge.docs.build",
            "No buildable projects were found.",
            {
              failures: execution.failures,
              blockedProjects: execution.blockedProjects,
              strictProjects: execution.strictProjects,
            },
            json,
            startedAt,
            EXIT_CODES.TOOL_ERROR,
          );
          return;
        }
        if (
          execution.failures.length > 0 ||
          execution.blockedProjects.length > 0 ||
          execution.strictProjects.length > 0
        ) {
          writeFailure(
            "forge.docs.build",
            "Docs Hub built the valid projects, but one or more projects failed.",
            {
              partialBuild: execution.buildResult,
              failures: execution.failures,
              blockedProjects: execution.blockedProjects,
              strictProjects: execution.strictProjects,
            },
            json,
            startedAt,
            EXIT_CODES.TOOL_ERROR,
          );
          return;
        }
        writeSuccess(
          "forge.docs.build",
          execution.buildResult,
          json,
          startedAt,
        );
      } catch (error) {
        writeFailure(
          "forge.docs.build",
          error instanceof Error ? error.message : String(error),
          null,
          json,
          startedAt,
          EXIT_CODES.TOOL_ERROR,
        );
      }
    });

  docs
    .command("doctor [target]")
    .description(
      "Diagnose documentation links, privacy, diagrams and staleness",
    )
    .option("--all", "Diagnose every registered project")
    .option("--strict", "Treat warnings as failures")
    .option("-j, --json", "Output as JSON")
    .action((target: string | undefined, options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        const roots = resolveProjectRoots(target, options.all);
        const scanned = scanRoots(roots);
        const reports = scanned.catalogs.map((catalog) =>
          doctorCatalog(catalog, readCatalog(catalog.project.root), {
            strict: options.strict,
          }),
        );
        const failed =
          scanned.failures.length > 0 ||
          reports.some((report) => report.status === "fail");
        if (failed) {
          writeFailure(
            "forge.docs.doctor",
            "Documentation health checks failed.",
            { reports, failures: scanned.failures },
            json,
            startedAt,
            EXIT_CODES.TOOL_ERROR,
          );
          return;
        }
        writeSuccess(
          "forge.docs.doctor",
          { reports, failures: scanned.failures },
          json,
          startedAt,
        );
      } catch (error) {
        writeFailure(
          "forge.docs.doctor",
          error instanceof Error ? error.message : String(error),
          null,
          json,
          startedAt,
          EXIT_CODES.TOOL_ERROR,
        );
      }
    });

  const exportCommand = docs
    .command("export")
    .description("Export approved documentation to optional formats");

  exportCommand
    .command("obsidian [target]")
    .description("Export a source-preserving Obsidian vault")
    .option("--all", "Export every registered project")
    .option("-o, --output <path>", "Override the external vault directory")
    .option("--strict", "Fail when warnings or errors exist")
    .option("-j, --json", "Output as JSON")
    .action((target: string | undefined, options: DocsOptions) => {
      const startedAt = Date.now();
      const json = useJson(program, options);
      try {
        const roots = resolveProjectRoots(target, options.all);
        const scanned = scanRoots(roots);
        const blocked = scanned.catalogs.filter(hasPrivacyBlock);
        const strictFailures = options.strict
          ? scanned.catalogs.filter((catalog) =>
              catalog.diagnostics.some(
                (diagnostic) =>
                  diagnostic.severity === "warning" ||
                  diagnostic.severity === "error",
              ),
            )
          : [];
        if (
          scanned.failures.length > 0 ||
          blocked.length > 0 ||
          strictFailures.length > 0
        ) {
          writeFailure(
            "forge.docs.export.obsidian",
            "Obsidian export was blocked by diagnostics.",
            {
              failures: scanned.failures,
              blockedProjects: blocked.map((catalog) => catalog.project.id),
              strictProjects: strictFailures.map(
                (catalog) => catalog.project.id,
              ),
            },
            json,
            startedAt,
            EXIT_CODES.TOOL_ERROR,
          );
          return;
        }
        const output = resolve(
          options.output ?? join(getDocsHubHome(), "docs-hub", "obsidian"),
        );
        writeSuccess(
          "forge.docs.export.obsidian",
          exportObsidianVault(scanned.catalogs, output),
          json,
          startedAt,
        );
      } catch (error) {
        writeFailure(
          "forge.docs.export.obsidian",
          error instanceof Error ? error.message : String(error),
          null,
          json,
          startedAt,
          EXIT_CODES.TOOL_ERROR,
        );
      }
    });
}
