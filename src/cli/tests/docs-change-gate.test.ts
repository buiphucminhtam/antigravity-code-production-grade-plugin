import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyMaterialPaths,
  isMaterialDocsPath,
  runDocsGate,
} from "../src/docs/change-gate.js";

const roots: string[] = [];

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

function currentState(summary = "Current project status.") {
  return {
    schema_version: 1,
    project: {
      summary: "A gate test project.",
      product_type: "tooling",
      lifecycle: "active",
    },
    structure: {
      roots: [
        {
          id: "src",
          path: "src",
          kind: "directory",
          purpose: "Runtime source.",
          owner: "team",
        },
      ],
      dependencies: [],
    },
    roadmap: [],
    flows: [],
    backlog: [],
    status: {
      lifecycle: "active",
      health: "on_track",
      phase: "verification",
      summary,
      updated_at: new Date().toISOString(),
      blockers: [],
      risks: [],
      next_actions: [],
      next_update_at: null,
    },
  };
}

function createProject(name = "gate-project"): string {
  const root = mkdtempSync(join(tmpdir(), `forgewright-${name}-`));
  roots.push(root);
  mkdirSync(join(root, ".forgewright"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Gate project\n", "utf8");
  writeFileSync(join(root, "docs", "Guide.md"), "# Guide\n", "utf8");
  writeFileSync(join(root, "src", "main.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "tests", "main.test.ts"), "// baseline test\n");
  writeJson(join(root, "docs", "project-state.json"), currentState());
  writeJson(join(root, ".forgewright", "docs-manifest.json"), {
    schema_version: 1,
    project: { id: "gate-project", title: "Gate Project" },
    sources: [
      { path: "README.md", type: "overview" },
      { path: "docs/Guide.md", type: "documentation" },
      { path: "docs/project-state.json", type: "metadata" },
    ],
    project_docs: {
      schema_version: 1,
      state: "docs/project-state.json",
      max_stale_days: 30,
    },
    truth: ["README.md", "docs/project-state.json"],
    adapters: { git: true, gitnexus: false, evidence_summary: false },
    privacy: {
      mode: "allowlist",
      allow: ["README.md", "docs/Guide.md", "docs/project-state.json"],
    },
  });
  git(root, "init", "-q");
  git(root, "config", "user.name", "Docs Gate Test");
  git(root, "config", "user.email", "docs-gate@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  return root;
}

function updateState(root: string, summary: string): void {
  writeJson(join(root, "docs", "project-state.json"), currentState(summary));
}

function codes(result: ReturnType<typeof runDocsGate>): string[] {
  return result.doctor.diagnostics.map((diagnostic) => diagnostic.code);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Docs Hub continuity gate", () => {
  it("classifies behavioral policy, config, code, data and game assets fail-closed", () => {
    const state = "docs/project-state.json";
    expect(
      classifyMaterialPaths(
        [
          "README.md",
          "docs/Guide.md",
          "tests/main.test.ts",
          "package-lock.json",
          ".forgewright/cache/docs-index.json",
          "skills/art-director/SKILL.md",
          "kernel/SOLVE.md",
          ".cursor/rules/guard.mdc",
          "AGENTS.md",
          "product-manifest.json",
          "src/main.ts",
          "docs/server.js",
          "docs/status.json",
          "docs/diagram.png",
          "docs/Roadmap.md",
          "Assets/World.unity",
          state,
        ],
        state,
        ["docs/Roadmap.md"],
      ),
    ).toEqual([
      ".cursor/rules/guard.mdc",
      "AGENTS.md",
      "Assets/World.unity",
      "docs/Roadmap.md",
      state,
      "docs/server.js",
      "docs/status.json",
      "kernel/SOLVE.md",
      "product-manifest.json",
      "skills/art-director/SKILL.md",
      "src/main.ts",
    ]);
    expect(isMaterialDocsPath("config/gameplay.json", state)).toBe(true);
    expect(isMaterialDocsPath("docs/Guide.md", state)).toBe(false);
    expect(isMaterialDocsPath("docs/diagram.png", state)).toBe(false);
  });

  it("fails code-only changes and passes code plus canonical state", () => {
    const root = createProject("material");
    writeFileSync(join(root, "src", "main.ts"), "export const value = 2;\n");

    const missingState = runDocsGate(root, { worktree: true });
    expect(missingState.status).toBe("fail");
    expect(codes(missingState)).toContain(
      "MATERIAL_CHANGE_MISSING_PROJECT_STATE",
    );

    updateState(root, "Runtime and status updated together.");
    const complete = runDocsGate(root, { worktree: true });
    expect(complete.status).toBe("pass");
    expect(complete.materialPaths).toEqual([
      "docs/project-state.json",
      "src/main.ts",
    ]);
    expect(complete.verifiedOutputPaths).toContain("index.html");
    expect(complete.verifiedOutputPaths).toContain(
      "projects/gate-project/index.html",
    );
    for (const section of [
      "structure",
      "roadmap",
      "flows",
      "backlog",
      "documents",
      "health",
    ]) {
      expect(complete.verifiedOutputPaths).toContain(
        `projects/gate-project/${section}.html`,
      );
    }
  });

  it("passes documentation-only and test-only changes without pretending they are material", () => {
    const docsRoot = createProject("docs-only");
    writeFileSync(join(docsRoot, "docs", "Guide.md"), "# Updated guide\n");
    const docsResult = runDocsGate(docsRoot, { worktree: true });
    expect(docsResult.status).toBe("pass");
    expect(docsResult.materialPaths).toEqual([]);

    const testsRoot = createProject("tests-only");
    writeFileSync(join(testsRoot, "tests", "main.test.ts"), "// changed\n");
    const testsResult = runDocsGate(testsRoot, { worktree: true });
    expect(testsResult.status).toBe("pass");
    expect(testsResult.materialPaths).toEqual([]);

    const truthRoot = createProject("truth-doc");
    writeFileSync(join(truthRoot, "README.md"), "# Changed product truth\n");
    const truthResult = runDocsGate(truthRoot, { worktree: true });
    expect(truthResult.status).toBe("fail");
    expect(truthResult.materialPaths).toEqual(["README.md"]);
    expect(codes(truthResult)).toContain(
      "MATERIAL_CHANGE_MISSING_PROJECT_STATE",
    );
  });

  it("fails closed for missing, invalid, stale and future project state", () => {
    const missingRoot = createProject("missing-state");
    rmSync(join(missingRoot, "docs", "project-state.json"));
    expect(codes(runDocsGate(missingRoot))).toContain("PROJECT_STATE_MISSING");

    const invalidRoot = createProject("invalid-state");
    writeFileSync(join(invalidRoot, "docs", "project-state.json"), "{bad\n");
    expect(codes(runDocsGate(invalidRoot))).toContain("PROJECT_STATE_INVALID");

    const staleRoot = createProject("stale-state");
    const stale = currentState("Stale state");
    stale.status.updated_at = "2020-01-01T00:00:00Z";
    writeJson(join(staleRoot, "docs", "project-state.json"), stale);
    expect(codes(runDocsGate(staleRoot))).toContain("PROJECT_STATE_STALE");

    const futureRoot = createProject("future-state");
    const future = currentState("Future state");
    future.status.updated_at = "2999-01-01T00:00:00Z";
    writeJson(join(futureRoot, "docs", "project-state.json"), future);
    expect(codes(runDocsGate(futureRoot))).toContain(
      "PROJECT_STATE_FUTURE_TIMESTAMP",
    );
  });

  it("supports staged, worktree and base-ref change views including spaces", () => {
    const stagedRoot = createProject("staged");
    writeFileSync(join(stagedRoot, "src", "with space.ts"), "export {};\n");
    updateState(stagedRoot, "Staged state update.");
    git(stagedRoot, "add", "src/with space.ts", "docs/project-state.json");
    const staged = runDocsGate(stagedRoot, { staged: true });
    expect(staged.status).toBe("pass");
    expect(staged.changedPaths).toContain("src/with space.ts");

    const worktreeRoot = createProject("worktree");
    writeFileSync(join(worktreeRoot, "src", "new file.ts"), "export {};\n");
    updateState(worktreeRoot, "Worktree state update.");
    const worktree = runDocsGate(worktreeRoot);
    expect(worktree.mode).toBe("worktree");
    expect(worktree.status).toBe("pass");
    expect(worktree.changedPaths).toContain("src/new file.ts");

    const baseRoot = createProject("base-ref");
    writeFileSync(
      join(baseRoot, "src", "main.ts"),
      "export const value = 3;\n",
    );
    updateState(baseRoot, "Committed state update.");
    git(baseRoot, "add", ".");
    git(baseRoot, "commit", "-qm", "material change");
    const base = runDocsGate(baseRoot, { baseRef: "HEAD~1" });
    expect(base.mode).toBe("base-ref");
    expect(base.status).toBe("pass");
    expect(base.changedPaths).toEqual([
      "docs/project-state.json",
      "src/main.ts",
    ]);
  });

  it("copies staged Git snapshots without local hardlinks", () => {
    const root = createProject("staged snapshot O'Connor");
    const sourcePath = "src/with space and ' quote.ts";
    writeFileSync(join(root, sourcePath), "export const quoted = true;\n");
    updateState(root, "Staged snapshot copy semantics.");
    git(root, "add", sourcePath, "docs/project-state.json");

    const traceRoot = mkdtempSync(join(tmpdir(), "forgewright-git-trace-"));
    roots.push(traceRoot);
    const tracePath = join(traceRoot, "git-trace.log");
    const previousTrace = process.env.GIT_TRACE;
    process.env.GIT_TRACE = tracePath;
    try {
      expect(runDocsGate(root, { staged: true }).status).toBe("pass");
    } finally {
      if (previousTrace === undefined) {
        delete process.env.GIT_TRACE;
      } else {
        process.env.GIT_TRACE = previousTrace;
      }
    }

    const trace = readFileSync(tracePath, "utf8");
    expect(trace).toContain("clone");
    expect(trace).toContain("--no-hardlinks");
  });

  it("validates staged and base-ref content from their selected Git snapshots", () => {
    const stagedRoot = createProject("staged-snapshot");
    writeFileSync(
      join(stagedRoot, "src", "main.ts"),
      "export const value = 2;\n",
    );
    writeFileSync(join(stagedRoot, "docs", "project-state.json"), "{invalid\n");
    git(stagedRoot, "add", "src/main.ts", "docs/project-state.json");
    updateState(stagedRoot, "Valid only in the unstaged worktree.");
    const staged = runDocsGate(stagedRoot, { staged: true });
    expect(staged.status).toBe("fail");
    expect(codes(staged)).toContain("PROJECT_STATE_INVALID");

    const baseRoot = createProject("base-snapshot");
    writeFileSync(
      join(baseRoot, "src", "main.ts"),
      "export const value = 3;\n",
    );
    writeFileSync(join(baseRoot, "docs", "project-state.json"), "{invalid\n");
    git(baseRoot, "add", "src/main.ts", "docs/project-state.json");
    git(baseRoot, "commit", "-qm", "invalid committed state");
    updateState(baseRoot, "Valid only in the uncommitted worktree.");
    const base = runDocsGate(baseRoot, { baseRef: "HEAD~1" });
    expect(base.status).toBe("fail");
    expect(codes(base)).toContain("PROJECT_STATE_INVALID");
  });

  it("classifies both sides of a rename so material sources cannot move into docs to bypass the gate", () => {
    const root = createProject("rename");
    git(root, "mv", "src/main.ts", "docs/runtime.md");

    const renamed = runDocsGate(root, { staged: true });

    expect(renamed.changedPaths).toEqual(["docs/runtime.md", "src/main.ts"]);
    expect(renamed.materialPaths).toContain("src/main.ts");
    expect(renamed.status).toBe("fail");
    expect(codes(renamed)).toContain("MATERIAL_CHANGE_MISSING_PROJECT_STATE");
  });

  it("scopes nested projects relative to their own root and treats deletions as material", () => {
    const repository = mkdtempSync(join(tmpdir(), "forgewright-monorepo-"));
    roots.push(repository);
    const project = join(repository, "packages", "game project");
    mkdirSync(project, { recursive: true });
    const projectRoot = createProject("nested-source");
    for (const entry of readdirSync(projectRoot)) {
      if (entry === ".git") continue;
      const source = join(projectRoot, entry);
      const destination = join(project, entry);
      cpSync(source, destination, { recursive: true });
    }
    git(repository, "init", "-q");
    git(repository, "config", "user.name", "Docs Gate Test");
    git(repository, "config", "user.email", "docs-gate@example.invalid");
    writeFileSync(
      join(repository, "outside.ts"),
      "export const outside = 1;\n",
    );
    git(repository, "add", ".");
    git(repository, "commit", "-qm", "monorepo baseline");

    writeFileSync(
      join(repository, "outside.ts"),
      "export const outside = 2;\n",
    );
    writeFileSync(join(project, "src", "main.ts"), "export const value = 4;\n");
    updateState(project, "Nested project state update.");
    const nested = runDocsGate(project);
    expect(nested.status).toBe("pass");
    expect(nested.changedPaths).toEqual([
      "docs/project-state.json",
      "src/main.ts",
    ]);

    git(repository, "add", ".");
    git(repository, "commit", "-qm", "nested update");
    rmSync(join(project, "src", "main.ts"));
    const deletion = runDocsGate(project);
    expect(deletion.changedPaths).toContain("src/main.ts");
    expect(deletion.materialPaths).toContain("src/main.ts");
    expect(codes(deletion)).toContain("MATERIAL_CHANGE_MISSING_PROJECT_STATE");
  });

  it("rejects option conflicts, invalid Git roots and tracked generated output", () => {
    const root = createProject("conflict");
    const conflict = runDocsGate(root, { staged: true, worktree: true });
    expect(conflict.status).toBe("fail");
    expect(codes(conflict)).toContain("DOCS_GATE_OPTION_CONFLICT");

    const notGit = mkdtempSync(join(tmpdir(), "forgewright-not-git-"));
    roots.push(notGit);
    const malformed = runDocsGate(notGit);
    expect(malformed.status).toBe("fail");
    expect(codes(malformed)).toContain("GIT_CHANGE_DISCOVERY_FAILED");

    const generatedRoot = createProject("generated");
    mkdirSync(join(generatedRoot, ".forgewright", "docs-hub"), {
      recursive: true,
    });
    writeFileSync(
      join(generatedRoot, ".forgewright", "docs-hub", "index.html"),
      "generated baseline\n",
    );
    expect(runDocsGate(generatedRoot).status).toBe("pass");
    git(generatedRoot, "add", ".forgewright/docs-hub/index.html");
    git(generatedRoot, "commit", "-qm", "track generated fixture");
    writeFileSync(
      join(generatedRoot, ".forgewright", "docs-hub", "index.html"),
      "manual edit\n",
    );
    const generated = runDocsGate(generatedRoot);
    expect(generated.status).toBe("fail");
    expect(codes(generated)).toContain("GENERATED_DOCS_OUTPUT_CHANGED");
  });

  it("uses temporary output and never mutates project source or cache", () => {
    const root = createProject("no-mutation");
    writeFileSync(join(root, "docs", "Guide.md"), "# Fresh guide\n");
    const sourceBefore = readFileSync(join(root, "docs", "Guide.md"), "utf8");
    const temporaryPrefixes = [
      "forgewright-docs-gate-",
      "forgewright-docs-view-",
    ];
    const temporaryBefore = new Set(
      readdirSync(tmpdir()).filter((name) =>
        temporaryPrefixes.some((prefix) => name.startsWith(prefix)),
      ),
    );

    const result = runDocsGate(root);

    const temporaryAfter = readdirSync(tmpdir()).filter(
      (name) =>
        temporaryPrefixes.some((prefix) => name.startsWith(prefix)) &&
        !temporaryBefore.has(name),
    );
    expect(result.status).toBe("pass");
    expect(temporaryAfter).toEqual([]);
    expect(readFileSync(join(root, "docs", "Guide.md"), "utf8")).toBe(
      sourceBefore,
    );
    expect(existsSync(join(root, ".forgewright", "cache"))).toBe(false);
    expect(existsSync(join(root, ".forgewright", "docs-hub"))).toBe(false);
  });
});
