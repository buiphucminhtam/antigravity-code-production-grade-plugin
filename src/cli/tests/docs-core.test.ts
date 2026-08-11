import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DocsManifestError,
  initManifest,
  loadManifest,
  validateManifest,
} from "../src/docs/manifest.js";
import {
  DocsPathError,
  isAllowedByPrivacy,
  matchesGlob,
  resolveWithinProject,
} from "../src/docs/privacy.js";
import {
  addRegistryProject,
  loadRegistry,
  removeRegistryProject,
} from "../src/docs/registry.js";
import {
  getCatalogPath,
  scanProject,
  writeCatalog,
} from "../src/docs/scanner.js";
import { doctorProject } from "../src/docs/doctor.js";
import { resolveCatalogLinks } from "../src/docs/links.js";
import { executeDocsBuild } from "../src/commands/docs.js";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "docs-hub",
);
const tempRoots: string[] = [];

function tempProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `forgewright-docs-${name}-`));
  tempRoots.push(root);
  return root;
}

function copyFixture(name: "forgewright" | "pixelworld"): string {
  const root = tempProject(name);
  cpSync(join(fixtureRoot, name), root, { recursive: true });
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(() => {
  delete process.env.FORGEWRIGHT_HOME;
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("docs manifest and registry", () => {
  it("initializes idempotently without overwriting an existing manifest", () => {
    const root = copyFixture("forgewright");
    const first = initManifest(root);
    expect(first.status).toBe("created");
    const customized = {
      ...first.manifest,
      project: { ...first.manifest.project, title: "Owner title" },
    };
    writeJson(first.path, customized);

    const second = initManifest(root);
    expect(second.status).toBe("already_exists");
    expect(second.manifest.project.title).toBe("Owner title");
    expect(JSON.parse(readFileSync(first.path, "utf8")).project.title).toBe(
      "Owner title",
    );
  });

  it("rejects invalid schemas and traversal paths clearly", () => {
    expect(() =>
      validateManifest({
        schema_version: 1,
        project: { id: "Bad ID", title: "" },
        sources: [{ path: "../private", type: "documentation" }],
        privacy: { mode: "allowlist" },
      }),
    ).toThrow(DocsManifestError);

    const root = tempProject("traversal");
    expect(() =>
      resolveWithinProject(root, "../outside", { mustExist: false }),
    ).toThrow(DocsPathError);
  });

  it("adds, canonicalizes, lists, updates and removes registry projects", () => {
    const root = copyFixture("forgewright");
    initManifest(root);
    const home = tempProject("home");
    process.env.FORGEWRIGHT_HOME = home;
    const registryPath = join(home, "docs-hub", "projects.json");

    const added = addRegistryProject(root, registryPath);
    expect(added.status).toBe("added");
    expect(added.project.root).toBe(realpathSync(root));
    expect(loadRegistry(registryPath).projects).toHaveLength(1);
    expect(addRegistryProject(root, registryPath).status).toBe("updated");
    expect(removeRegistryProject(added.project.id, registryPath)?.root).toBe(
      realpathSync(root),
    );
    expect(loadRegistry(registryPath).projects).toEqual([]);
  });

  it("rejects duplicate project IDs for different registry roots", () => {
    const firstRoot = copyFixture("forgewright");
    const secondRoot = copyFixture("forgewright");
    initManifest(firstRoot);
    initManifest(secondRoot);
    const home = tempProject("duplicate-id-home");
    const registryPath = join(home, "docs-hub", "projects.json");

    addRegistryProject(firstRoot, registryPath);
    expect(() => addRegistryProject(secondRoot, registryPath)).toThrow(
      /already registered/,
    );
    expect(loadRegistry(registryPath).projects).toHaveLength(1);
    expect(loadRegistry(registryPath).projects[0].root).toBe(
      realpathSync(firstRoot),
    );
  });
});

describe("privacy-safe scanning and deterministic normalization", () => {
  it("supports Docs, docs, README-only and empty legacy projects", () => {
    const forgewright = copyFixture("forgewright");
    const pixelworld = copyFixture("pixelworld");
    const readmeOnly = tempProject("readme");
    writeFileSync(join(readmeOnly, "README.md"), "# Readme only\n", "utf8");
    const empty = tempProject("empty");

    const forgewrightCatalog = scanProject(forgewright);
    expect(forgewrightCatalog.documents.map((doc) => doc.sourcePath)).toEqual(
      expect.arrayContaining(["README.md", "docs/architecture.md"]),
    );
    expect(
      forgewrightCatalog.diagnostics.some(
        (diagnostic) => diagnostic.code === "BROKEN_LINK",
      ),
    ).toBe(false);
    expect(
      scanProject(pixelworld).documents.map((doc) => doc.sourcePath),
    ).toEqual(
      expect.arrayContaining([
        "README.md",
        "Docs/DanDao_GDD.md",
        "Docs/Design/Architecture_Guidelines.md",
      ]),
    );
    expect(scanProject(readmeOnly).documents).toHaveLength(1);
    expect(scanProject(empty).documents).toHaveLength(0);
  });

  it("excludes sensitive paths before content enters the catalog", () => {
    const root = tempProject("sensitive");
    mkdirSync(join(root, "Docs"), { recursive: true });
    mkdirSync(join(root, "credentials"), { recursive: true });
    writeFileSync(join(root, "Docs", "safe.md"), "# Safe\n", "utf8");
    writeFileSync(
      join(root, "credentials", "secret.md"),
      "# SECRET_DO_NOT_INGEST\n",
      "utf8",
    );
    writeJson(join(root, ".forgewright", "docs-manifest.json"), {
      schema_version: 1,
      project: { id: "sensitive", title: "Sensitive" },
      sources: [
        { path: "Docs", type: "documentation" },
        { path: "credentials", type: "documentation" },
      ],
      truth: [],
      privacy: {
        mode: "allowlist",
        allow: ["Docs", "credentials"],
        exclude: [],
      },
    });

    const catalog = scanProject(root);
    const serialized = JSON.stringify(catalog);
    expect(catalog.documents.map((doc) => doc.sourcePath)).toEqual([
      "Docs/safe.md",
    ]);
    expect(serialized).not.toContain("SECRET_DO_NOT_INGEST");
    expect(
      catalog.diagnostics.some(
        (diagnostic) => diagnostic.code === "SENSITIVE_SOURCE_REJECTED",
      ),
    ).toBe(true);
  });

  it("reports a broken contained symlink without treating it as a privacy escape", () => {
    const root = tempProject("broken-symlink");
    mkdirSync(join(root, "Docs"), { recursive: true });
    symlinkSync(
      join(root, "Docs", "missing.md"),
      join(root, "Docs", "link.md"),
    );
    initManifest(root);

    const catalog = scanProject(root);
    expect(
      catalog.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "BROKEN_SYMLINK" &&
          diagnostic.severity === "warning",
      ),
    ).toBe(true);
    expect(
      catalog.diagnostics.some(
        (diagnostic) => diagnostic.code === "PATH_CONTAINMENT_FAILED",
      ),
    ).toBe(false);
  });

  it("blocks a symlink that resolves outside the project root", () => {
    const root = tempProject("symlink-escape");
    const outside = tempProject("outside");
    mkdirSync(join(root, "Docs"), { recursive: true });
    writeFileSync(join(outside, "external.md"), "# External\n", "utf8");
    symlinkSync(
      join(outside, "external.md"),
      join(root, "Docs", "external.md"),
    );
    initManifest(root);

    const catalog = scanProject(root);
    expect(
      catalog.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "PATH_CONTAINMENT_FAILED" &&
          diagnostic.severity === "error",
      ),
    ).toBe(true);
    expect(catalog.documents).toHaveLength(0);
  });

  it("keeps stable IDs and catalog fingerprints across repeated scans", () => {
    const root = copyFixture("forgewright");
    initManifest(root);
    const first = scanProject(root);
    const second = scanProject(root);
    expect(second.documents.map((doc) => doc.id)).toEqual(
      first.documents.map((doc) => doc.id),
    );
    expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
    const path = writeCatalog(first);
    expect(path).toBe(getCatalogPath(root));
    expect(existsSync(path)).toBe(true);
  });

  it("reports broken links, anchors, diagrams and stale indexes", () => {
    const root = tempProject("doctor");
    mkdirSync(join(root, "Docs"), { recursive: true });
    writeFileSync(
      join(root, "Docs", "broken.md"),
      [
        "# Broken",
        "",
        "[missing](missing.md)",
        "![missing image](missing.png)",
        "[anchor](#not-there)",
        "",
        "```mermaid",
        "unknownDiagram A --> B",
        "```",
      ].join("\n"),
      "utf8",
    );
    initManifest(root);
    const catalog = scanProject(root);
    expect(catalog.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "BROKEN_LINK",
        "BROKEN_ASSET",
        "BROKEN_ANCHOR",
        "INVALID_DIAGRAM",
      ]),
    );
    writeCatalog(catalog);
    writeFileSync(join(root, "Docs", "broken.md"), "# Changed\n", "utf8");

    const report = doctorProject(root, { strict: true });
    expect(report.status).toBe("fail");
    expect(report.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["STALE_DOCS_INDEX"]),
    );
  });

  it("implements allowlist and glob matching for top-level and nested docs", () => {
    expect(matchesGlob("guide.md", "**/*.md")).toBe(true);
    expect(matchesGlob("Design/guide.md", "**/*.md")).toBe(true);
    expect(
      isAllowedByPrivacy("Docs/Design/guide.md", ["Docs"], ["Docs/private/**"]),
    ).toBe(true);
    expect(
      isAllowedByPrivacy(
        "Docs/private/secret.md",
        ["Docs"],
        ["Docs/private/**"],
      ),
    ).toBe(false);
  });

  it("loads a legacy manifest without writing project files", () => {
    const root = copyFixture("pixelworld");
    const loaded = loadManifest(root);
    expect(loaded.legacy).toBe(true);
    expect(loaded.manifestPath).toBeNull();
    expect(existsSync(join(root, ".forgewright", "docs-manifest.json"))).toBe(
      false,
    );
  });

  it("resolves explicit cross-project links when projects build together", () => {
    const projectA = tempProject("project-a");
    const projectB = tempProject("project-b");
    for (const root of [projectA, projectB]) {
      mkdirSync(join(root, "Docs"), { recursive: true });
    }
    writeFileSync(
      join(projectA, "Docs", "a.md"),
      "# A\n\n[Project B](forgewright://project-b/Docs/b.md#target)\n",
      "utf8",
    );
    writeFileSync(join(projectB, "Docs", "b.md"), "# B\n\n## Target\n", "utf8");
    const manifestA = initManifest(projectA);
    const manifestB = initManifest(projectB);
    writeJson(manifestA.path, {
      ...manifestA.manifest,
      project: { id: "project-a", title: "Project A" },
    });
    writeJson(manifestB.path, {
      ...manifestB.manifest,
      project: { id: "project-b", title: "Project B" },
    });

    const [catalogA, catalogB] = resolveCatalogLinks([
      scanProject(projectA),
      scanProject(projectB),
    ]);
    const link = catalogA.documents[0].links[0];
    expect(link.resolvedDocumentId).toBe(catalogB.documents[0].id);
    expect(link.resolvedRoute).toContain("project-b/docs/Docs/b.md.html");
    expect(
      catalogA.diagnostics.some(
        (diagnostic) => diagnostic.code === "UNKNOWN_PROJECT_LINK",
      ),
    ).toBe(false);
  });

  it("degrades GitNexus explicitly when stale or unavailable", () => {
    const unavailableRoot = tempProject("gitnexus-unavailable");
    mkdirSync(join(unavailableRoot, "Docs"), { recursive: true });
    writeFileSync(
      join(unavailableRoot, "Docs", "guide.md"),
      "# Guide\n",
      "utf8",
    );
    const unavailableManifest = initManifest(unavailableRoot);
    writeJson(unavailableManifest.path, {
      ...unavailableManifest.manifest,
      adapters: {
        ...unavailableManifest.manifest.adapters,
        gitnexus: true,
      },
    });
    expect(scanProject(unavailableRoot).project.facts.gitnexus.status).toBe(
      "unavailable",
    );

    const staleRoot = tempProject("gitnexus-stale");
    mkdirSync(join(staleRoot, "Docs"), { recursive: true });
    writeFileSync(join(staleRoot, "Docs", "guide.md"), "# Guide\n", "utf8");
    spawnSync("git", ["init"], { cwd: staleRoot });
    spawnSync("git", ["config", "user.email", "docs@example.test"], {
      cwd: staleRoot,
    });
    spawnSync("git", ["config", "user.name", "Docs Test"], { cwd: staleRoot });
    spawnSync("git", ["add", "."], { cwd: staleRoot });
    spawnSync("git", ["commit", "-m", "fixture"], { cwd: staleRoot });
    const staleManifest = initManifest(staleRoot);
    writeJson(staleManifest.path, {
      ...staleManifest.manifest,
      adapters: { ...staleManifest.manifest.adapters, gitnexus: true },
    });
    writeJson(join(staleRoot, ".gitnexus", "meta.json"), {
      lastCommit: "0000000000000000000000000000000000000000",
      indexedAt: "2026-08-01T00:00:00Z",
      stats: { nodes: 10, processes: 2 },
    });
    const staleCatalog = scanProject(staleRoot);
    expect(staleCatalog.project.facts.gitnexus.status).toBe("stale");
    expect(
      staleCatalog.diagnostics.some(
        (diagnostic) => diagnostic.code === "GITNEXUS_STALE",
      ),
    ).toBe(true);
  });

  it("preserves successful project output when another batch project fails", () => {
    const validRoot = copyFixture("forgewright");
    initManifest(validRoot);
    const invalidRoot = tempProject("invalid-batch-project");
    writeJson(join(invalidRoot, ".forgewright", "docs-manifest.json"), {
      schema_version: 99,
      project: { id: "invalid", title: "Invalid" },
      sources: [],
      privacy: { mode: "allowlist" },
    });
    const output = join(tempProject("batch-output"), "site");

    const result = executeDocsBuild([validRoot, invalidRoot], output);
    expect(result.failures).toHaveLength(1);
    expect(result.buildResult?.projects.map((project) => project.id)).toEqual([
      "forgewright-fixture",
    ]);
    expect(
      existsSync(join(output, "projects", "forgewright-fixture", "index.html")),
    ).toBe(true);
  });
});
