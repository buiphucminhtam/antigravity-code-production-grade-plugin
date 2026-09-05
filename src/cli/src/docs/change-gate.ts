import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { doctorCatalog } from "./doctor.js";
import type { DocsDoctorReport } from "./doctor.js";
import { buildDocsHub } from "./render.js";
import { scanProject } from "./scanner.js";
import { normalizeRelativePath } from "./privacy.js";
import type { DocsCatalog, DocsDiagnostic } from "./types.js";

export type DocsGateMode = "staged" | "worktree" | "base-ref";

export interface DocsGateOptions {
  staged?: boolean;
  worktree?: boolean;
  baseRef?: string;
}

export interface DocsGateResult {
  status: "pass" | "fail";
  mode: DocsGateMode;
  changedPaths: string[];
  materialPaths: string[];
  statePath: string | null;
  stateUpdatedAt: string | null;
  doctor: {
    summary: DocsDoctorReport["summary"] | null;
    diagnostics: DocsDiagnostic[];
  };
  verifiedOutputPaths: string[];
}

class DocsGateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DocsGateError";
    this.code = code;
  }
}

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pipfile.lock",
  "poetry.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const DOCUMENT_EXTENSIONS = new Set([
  ".adoc",
  ".markdown",
  ".md",
  ".mdx",
  ".org",
  ".rst",
  ".tex",
  ".txt",
]);
const DOCUMENT_ASSET_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".svg",
  ".webp",
]);
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const PROJECT_MANIFESTS = new Set([
  "cargo.toml",
  "composer.json",
  "dockerfile",
  "gemfile",
  "go.mod",
  "makefile",
  "mix.exs",
  "package.json",
  "pipfile",
  "poetry.lock",
  "pyproject.toml",
  "requirements.txt",
  "setup.cfg",
  "setup.py",
]);

const GENERATED_DIRECTORIES = new Set(["build", "coverage", "dist"]);
const TEST_DIRECTORIES = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
]);
const DOCUMENT_DIRECTORIES = new Set([
  "adr",
  "doc",
  "docs",
  "documentation",
  "wiki",
]);
const MATERIAL_DIRECTORIES = new Set([
  "app",
  "bin",
  "client",
  "config",
  "configs",
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  ".github",
  "kernel",
  "lib",
  "runtime",
  "prompt",
  "prompts",
  "rule",
  "rules",
  "schema",
  "schemas",
  "server",
  "script",
  "scripts",
  "skill",
  "skills",
  "source",
  "src",
  "template",
  "templates",
  "workflow",
  "workflows",
]);
const MATERIAL_FILENAMES = new Set([
  "agents.md",
  "claude.md",
  "product-manifest.json",
]);
const BENIGN_JUNK_FILENAMES = new Set([
  ".ds_store",
  ".gitkeep",
  ".keep",
  "desktop.ini",
  "thumbs.db",
]);

function sortPaths(paths: Iterable<string>): string[] {
  return [...new Set(paths)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function parseNulDelimitedPaths(output: Buffer | string): string[] {
  const text = Buffer.isBuffer(output) ? output.toString("utf8") : output;
  const paths = text
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => path.replace(/\\/g, "/"));
  for (const path of paths) {
    if (
      path.includes("\uFFFD") ||
      path.startsWith("/") ||
      path.split("/").some((segment) => segment === "..")
    ) {
      throw new DocsGateError(
        "GIT_PATH_INVALID",
        `Git returned a non-relative path: ${path}`,
      );
    }
  }
  return sortPaths(paths);
}

function parseNulDelimitedDiffPaths(output: Buffer | string): string[] {
  const text = Buffer.isBuffer(output) ? output.toString("utf8") : output;
  const tokens = text.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const paths: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status || !/^[ACDMRTUXB][0-9]*$/.test(status)) {
      throw new DocsGateError(
        "GIT_CHANGE_DISCOVERY_FAILED",
        `Git returned an invalid name-status record: ${status ?? "<missing>"}`,
      );
    }
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const path = tokens[index++];
      if (path === undefined) {
        throw new DocsGateError(
          "GIT_CHANGE_DISCOVERY_FAILED",
          `Git returned an incomplete name-status record for ${status}.`,
        );
      }
      paths.push(path);
    }
  }
  return parseNulDelimitedPaths(`${paths.join("\0")}\0`);
}

function isTrackedPath(projectRoot: string, path: string): boolean {
  const result = spawnSync(
    "git",
    ["-C", projectRoot, "ls-files", "--error-unmatch", "--", path],
    {
      stdio: "ignore",
      timeout: 10_000,
    },
  );
  if (result.error) {
    throw new DocsGateError(
      "GIT_CHANGE_DISCOVERY_FAILED",
      `Unable to verify whether a generated path is tracked: ${result.error.message}`,
    );
  }
  return result.status === 0;
}

function runGitOutput(projectRoot: string, args: string[]): Buffer {
  const result = spawnSync("git", ["-C", projectRoot, ...args], {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8").trim()
      : String(result.stderr ?? "").trim();
    throw new DocsGateError(
      "GIT_CHANGE_DISCOVERY_FAILED",
      `Unable to read Git changes${stderr ? `: ${stderr}` : "."}`,
    );
  }
  return Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? "");
}

function runGit(projectRoot: string, args: string[]): string[] {
  return parseNulDelimitedPaths(runGitOutput(projectRoot, args));
}

function runGitDiff(projectRoot: string, args: string[]): string[] {
  return parseNulDelimitedDiffPaths(runGitOutput(projectRoot, args));
}

function stagedPaths(projectRoot: string): string[] {
  return runGitDiff(projectRoot, [
    "diff",
    "--relative",
    "-M",
    "--cached",
    "--name-status",
    "-z",
    "--diff-filter=ACMRD",
  ]);
}

function worktreePaths(projectRoot: string): string[] {
  return sortPaths([
    ...runGitDiff(projectRoot, [
      "diff",
      "--relative",
      "-M",
      "--name-status",
      "-z",
      "--diff-filter=ACMRD",
    ]),
    ...stagedPaths(projectRoot),
    ...runGit(projectRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]),
  ]);
}

function baseRefPaths(projectRoot: string, baseRef: string): string[] {
  if (!baseRef.trim() || baseRef.startsWith("-")) {
    throw new DocsGateError(
      "GIT_BASE_REF_INVALID",
      "--base-ref must be a non-empty Git revision.",
    );
  }
  return runGitDiff(projectRoot, [
    "diff",
    "--relative",
    "-M",
    "--name-status",
    "-z",
    "--diff-filter=ACMRD",
    `${baseRef}...HEAD`,
  ]);
}

interface ProjectView {
  projectRoot: string;
  temporaryParent: string | null;
}

function gitText(projectRoot: string, args: string[]): string {
  const value = runGitOutput(projectRoot, args).toString("utf8").trim();
  if (!value || value.includes("\0")) {
    throw new DocsGateError(
      "GIT_SNAPSHOT_FAILED",
      "Git returned an invalid value while preparing the selected project view.",
    );
  }
  return value;
}

function selectedProjectView(
  projectRoot: string,
  mode: DocsGateMode,
): ProjectView {
  if (mode === "worktree") {
    return { projectRoot, temporaryParent: null };
  }

  const repositoryRoot = realpathSync(
    resolve(gitText(projectRoot, ["rev-parse", "--show-toplevel"])),
  );
  const projectPath = relative(repositoryRoot, projectRoot);
  if (
    projectPath === ".." ||
    projectPath.startsWith(`..${sep}`) ||
    resolve(repositoryRoot, projectPath) !== projectRoot
  ) {
    throw new DocsGateError(
      "GIT_SNAPSHOT_FAILED",
      "Project root is outside the Git repository selected for the docs gate.",
    );
  }

  const temporaryParent = mkdtempSync(join(tmpdir(), "forgewright-docs-view-"));
  try {
    const snapshotRoot = join(temporaryParent, "repository");
    runGitOutput(repositoryRoot, [
      "clone",
      "--quiet",
      "--no-checkout",
      "--local",
      "--no-hardlinks",
      "--",
      repositoryRoot,
      snapshotRoot,
    ]);
    if (mode === "staged") {
      runGitOutput(repositoryRoot, [
        "checkout-index",
        "--all",
        "--force",
        `--prefix=${snapshotRoot}/`,
      ]);
    } else {
      const head = gitText(projectRoot, ["rev-parse", "--verify", "HEAD"]);
      runGitOutput(snapshotRoot, ["checkout", "--quiet", "--detach", head]);
    }
    return {
      projectRoot: resolve(snapshotRoot, projectPath),
      temporaryParent,
    };
  } catch (error) {
    rmSync(temporaryParent, { recursive: true, force: true });
    throw error;
  }
}

function selectedMode(options: DocsGateOptions): DocsGateMode {
  const selected = [
    options.staged ? "staged" : null,
    options.worktree ? "worktree" : null,
    options.baseRef !== undefined ? "base-ref" : null,
  ].filter((value): value is DocsGateMode => value !== null);
  if (selected.length > 1) {
    throw new DocsGateError(
      "DOCS_GATE_OPTION_CONFLICT",
      "Choose only one of --staged, --worktree, or --base-ref.",
    );
  }
  return selected[0] ?? "worktree";
}

function selectedPaths(
  projectRoot: string,
  mode: DocsGateMode,
  baseRef: string | undefined,
): string[] {
  if (mode === "staged") return stagedPaths(projectRoot);
  if (mode === "base-ref") return baseRefPaths(projectRoot, baseRef ?? "");
  return worktreePaths(projectRoot);
}

function pathSegments(path: string): string[] {
  return path.toLowerCase().split("/").filter(Boolean);
}

function isIgnoredGeneratedPath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = pathSegments(path);
  return (
    segments.includes(".git") ||
    lower === ".forgewright/cache" ||
    lower.startsWith(".forgewright/cache/") ||
    isGeneratedDocsOutputPath(path) ||
    segments.some((segment) => GENERATED_DIRECTORIES.has(segment))
  );
}

function isGeneratedDocsOutputPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower === ".forgewright/docs-hub" ||
    lower.startsWith(".forgewright/docs-hub/")
  );
}

function isLockfile(path: string): boolean {
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";
  return LOCKFILES.has(basename);
}

function isTestOnlyPath(path: string): boolean {
  const lower = path.toLowerCase();
  const basename = lower.split("/").at(-1) ?? "";
  return (
    pathSegments(path).some((segment) => TEST_DIRECTORIES.has(segment)) ||
    /(^|[._-])(test|spec)([._-]|$)/.test(basename) ||
    /(^|[._-])test_[^/]+\.(py|pyi)$/.test(basename) ||
    /_test\.(go|py|rs)$/.test(basename) ||
    basename === "conftest.py"
  );
}

function isDocumentationOnlyPath(path: string): boolean {
  const lower = path.toLowerCase();
  const basename = lower.split("/").at(-1) ?? "";
  const extension = basename.includes(".")
    ? `.${basename.split(".").at(-1)}`
    : "";
  return (
    DOCUMENT_EXTENSIONS.has(extension) ||
    /^(readme|changelog|changes|history|license)(\.|$)/.test(basename)
  );
}

function isProjectConfigPath(path: string): boolean {
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    path.toLowerCase() === ".forgewright/docs-manifest.json" ||
    PROJECT_MANIFESTS.has(basename) ||
    /^(\.env|\.nvmrc|\.npmrc|\.tool-versions|tsconfig(?:\.|$)|jsconfig(?:\.|$)|vitest\.config\.|jest\.config\.|vite\.config\.|webpack\.config\.|rollup\.config\.|eslint\.config\.|\.eslintrc|\.prettierrc)/.test(
      basename,
    )
  );
}

function isBenignJunkPath(path: string): boolean {
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    BENIGN_JUNK_FILENAMES.has(basename) ||
    basename.endsWith(".swp") ||
    basename.endsWith(".swo") ||
    basename.endsWith("~")
  );
}

export function isMaterialDocsPath(
  path: string,
  canonicalStatePath?: string | null,
): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  let normalizedState: string | null = null;
  if (canonicalStatePath) {
    try {
      normalizedState = normalizeRelativePath(canonicalStatePath);
    } catch {
      normalizedState = canonicalStatePath.replace(/\\/g, "/");
    }
  }
  if (normalizedState === normalizedPath) return true;
  if (isIgnoredGeneratedPath(normalizedPath)) return false;
  if (isLockfile(normalizedPath)) return false;
  if (isTestOnlyPath(normalizedPath)) return false;

  const segments = pathSegments(normalizedPath);
  if (segments.some((segment) => MATERIAL_DIRECTORIES.has(segment))) {
    return true;
  }
  const basename = segments.at(-1) ?? "";
  const extension = basename.includes(".")
    ? `.${basename.split(".").at(-1)}`
    : "";
  if (MATERIAL_FILENAMES.has(basename)) return true;
  if (isProjectConfigPath(normalizedPath)) return true;
  if (SOURCE_EXTENSIONS.has(extension)) return true;
  if (isDocumentationOnlyPath(normalizedPath)) return false;
  if (
    segments.some((segment) => DOCUMENT_DIRECTORIES.has(segment)) &&
    DOCUMENT_ASSET_EXTENSIONS.has(extension)
  ) {
    return false;
  }
  if (isBenignJunkPath(normalizedPath)) return false;
  return true;
}

export function classifyMaterialPaths(
  changedPaths: string[],
  canonicalStatePath?: string | null,
  continuousDocsPaths: Iterable<string> = [],
): string[] {
  const continuous = new Set(
    [...continuousDocsPaths].map((path) => path.replace(/\\/g, "/")),
  );
  return sortPaths(
    changedPaths.filter(
      (path) =>
        continuous.has(path.replace(/\\/g, "/")) ||
        isMaterialDocsPath(path, canonicalStatePath),
    ),
  );
}

function continuousDocumentationPaths(catalog: DocsCatalog): string[] {
  const references = catalog.project.state
    ? [
        ...catalog.project.state.roadmap.flatMap((item) => item.references),
        ...catalog.project.state.flows.flatMap((flow) =>
          flow.steps.flatMap((step) => step.references),
        ),
        ...catalog.project.state.backlog.flatMap((item) => item.references),
      ].map((reference) => reference.path)
    : [];
  return sortPaths([
    ...catalog.project.truthDocuments,
    ...references,
    ...(catalog.project.statePath ? [catalog.project.statePath] : []),
  ]);
}

function diagnostic(
  code: string,
  message: string,
  path?: string,
  projectId = "docs-gate",
): DocsDiagnostic {
  return {
    severity: "error",
    code,
    projectId,
    ...(path ? { path } : {}),
    message,
  };
}

function addDiagnostic(report: DocsDoctorReport, item: DocsDiagnostic): void {
  report.diagnostics.push(item);
  report.summary.errors += 1;
  report.status = "fail";
}

function emptyResult(mode: DocsGateMode): DocsGateResult {
  return {
    status: "fail",
    mode,
    changedPaths: [],
    materialPaths: [],
    statePath: null,
    stateUpdatedAt: null,
    doctor: { summary: null, diagnostics: [] },
    verifiedOutputPaths: [],
  };
}

function outputRelativePath(outputDir: string, candidate: string): string {
  const root = resolve(outputDir);
  const target = resolve(candidate);
  const relativePath = relative(root, target).replace(/\\/g, "/");
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("/")
  ) {
    throw new DocsGateError(
      "DOCS_GATE_OUTPUT_ESCAPE",
      `Generated output path escapes the temporary output directory: ${candidate}`,
    );
  }
  return relativePath;
}

function verifyOutput(outputDir: string, catalog: DocsCatalog): string[] {
  const projectRoot = `projects/${encodeURIComponent(catalog.project.id)}`;
  const required = [
    ".forgewright-docs-hub",
    "index.html",
    "style.css",
    "app.js",
    "search-index.json",
    `${projectRoot}/index.html`,
    ...["structure", "roadmap", "flows", "backlog", "documents", "health"].map(
      (section) => `${projectRoot}/${section}.html`,
    ),
    ...catalog.documents.map((document) => document.route),
  ];
  for (const path of required) {
    const absolutePath = resolve(outputDir, path);
    outputRelativePath(outputDir, absolutePath);
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch {
      throw new DocsGateError(
        "DOCS_GATE_OUTPUT_MISSING",
        `Generated Docs Hub output is missing: ${path}`,
      );
    }
    if (!stat.isFile()) {
      throw new DocsGateError(
        "DOCS_GATE_OUTPUT_NOT_REGULAR",
        `Generated Docs Hub output is not a regular file: ${path}`,
      );
    }
  }
  let ownership: unknown;
  try {
    ownership = JSON.parse(
      readFileSync(resolve(outputDir, ".forgewright-docs-hub"), "utf8"),
    );
  } catch (error) {
    throw new DocsGateError(
      "DOCS_GATE_MARKER_INVALID",
      `Generated ownership marker is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const fingerprints =
    ownership &&
    typeof ownership === "object" &&
    "source_fingerprints" in ownership
      ? (ownership as { source_fingerprints?: unknown }).source_fingerprints
      : null;
  const ownsCatalog =
    Array.isArray(fingerprints) &&
    fingerprints.some(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as { project_id?: unknown }).project_id === catalog.project.id &&
        (item as { fingerprint?: unknown }).fingerprint ===
          catalog.sourceFingerprint,
    );
  if (
    !ownership ||
    typeof ownership !== "object" ||
    (ownership as { schema?: unknown }).schema !== "forgewright-docs-hub" ||
    (ownership as { schema_version?: unknown }).schema_version !== 1 ||
    !ownsCatalog
  ) {
    throw new DocsGateError(
      "DOCS_GATE_MARKER_INVALID",
      "Generated ownership marker does not match the current project catalog.",
    );
  }
  return sortPaths(required);
}

function statePathFromCatalog(catalog: DocsCatalog): string | null {
  if (!catalog.project.statePath) return null;
  try {
    return normalizeRelativePath(catalog.project.statePath);
  } catch {
    return catalog.project.statePath.replace(/\\/g, "/");
  }
}

export function runDocsGate(
  projectRootInput: string,
  options: DocsGateOptions = {},
): DocsGateResult {
  let mode: DocsGateMode = "worktree";
  const result = emptyResult(mode);
  let catalog: DocsCatalog | null = null;
  let doctorReport: DocsDoctorReport | null = null;
  let selectedView: ProjectView | null = null;

  try {
    mode = selectedMode(options);
    result.mode = mode;
    const projectRoot = realpathSync(resolve(projectRootInput));
    result.changedPaths = selectedPaths(projectRoot, mode, options.baseRef);
    selectedView = selectedProjectView(projectRoot, mode);
    catalog = scanProject(selectedView.projectRoot);
    result.statePath = statePathFromCatalog(catalog);
    result.stateUpdatedAt = catalog.project.state?.status.updated_at ?? null;
    doctorReport = doctorCatalog(catalog, null, { strict: true });
    result.doctor = {
      summary: doctorReport.summary,
      diagnostics: [...doctorReport.diagnostics],
    };

    for (const path of result.changedPaths.filter(
      (path) =>
        isGeneratedDocsOutputPath(path) && isTrackedPath(projectRoot, path),
    )) {
      addDiagnostic(
        doctorReport,
        diagnostic(
          "GENERATED_DOCS_OUTPUT_CHANGED",
          "Generated Docs Hub output must not be edited or committed; update source documentation instead.",
          path,
          catalog.project.id,
        ),
      );
    }
    result.materialPaths = classifyMaterialPaths(
      result.changedPaths,
      result.statePath,
      continuousDocumentationPaths(catalog),
    );

    if (
      result.materialPaths.length > 0 &&
      (!result.statePath || !result.changedPaths.includes(result.statePath))
    ) {
      addDiagnostic(
        doctorReport,
        diagnostic(
          "MATERIAL_CHANGE_MISSING_PROJECT_STATE",
          "Material changes require the canonical project state path in the same selected change set.",
          result.statePath ?? "project_docs.state",
          catalog.project.id,
        ),
      );
    }

    result.doctor = {
      summary: doctorReport.summary,
      diagnostics: [...doctorReport.diagnostics],
    };
    if (doctorReport.status === "fail") return result;

    const temporaryParent = mkdtempSync(
      join(tmpdir(), "forgewright-docs-gate-"),
    );
    try {
      const outputDir = join(temporaryParent, "site");
      buildDocsHub([catalog], outputDir);
      result.verifiedOutputPaths = verifyOutput(outputDir, catalog);
    } finally {
      rmSync(temporaryParent, { recursive: true, force: true });
    }

    result.status = "pass";
    return result;
  } catch (error) {
    const item = diagnostic(
      error instanceof DocsGateError ? error.code : "DOCS_GATE_FAILED",
      error instanceof Error ? error.message : String(error),
      undefined,
      catalog?.project.id,
    );
    if (doctorReport) {
      addDiagnostic(doctorReport, item);
      result.doctor = {
        summary: doctorReport.summary,
        diagnostics: [...doctorReport.diagnostics],
      };
    } else {
      result.doctor.diagnostics.push(item);
    }
    return result;
  } finally {
    if (selectedView?.temporaryParent) {
      rmSync(selectedView.temporaryParent, { recursive: true, force: true });
    }
  }
}
