import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/docs/markdown.js";
import { exportObsidianVault } from "../src/docs/obsidian.js";
import { buildDocsHub, renderStaticSite } from "../src/docs/render.js";
import { buildSearchIndex, searchDocuments } from "../src/docs/search.js";
import type { DocsCatalog, DocsProjectState } from "../src/docs/types.js";

function catalog(root: string): DocsCatalog {
  const doc = {
    id: "doc-1",
    projectId: "demo",
    sourcePath: "Docs/Guide.md",
    route: "projects/demo/docs/Docs/Guide.md.html",
    title: "Guide",
    type: "documentation" as const,
    format: "markdown" as const,
    status: null,
    sourceOfTruth: true,
    tags: ["guide"],
    headings: [{ level: 1, text: "Guide", slug: "guide", line: 1 }],
    links: [],
    codeRefs: [],
    diagrams: [],
    backlinks: [],
    related: [],
    warnings: [],
    contentHash: "hash",
    content:
      "# Guide\n\nA **safe** guide.\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
  };
  return {
    schema_version: 1,
    project: {
      id: "demo",
      title: "Demo",
      root,
      manifestPath: null,
      legacy: false,
      truthDocuments: [doc.sourcePath],
      facts: {
        git: { available: false, branch: null, commit: null, dirty: null },
        gitnexus: {
          status: "disabled",
          indexedCommit: null,
          indexedAt: null,
          processes: null,
          symbols: null,
        },
        profile: {},
      },
      health: { errors: 0, warnings: 0, info: 0 },
      scanStatus: "ok",
    },
    documents: [doc],
    assets: [],
    relations: [],
    diagnostics: [],
    sourceFingerprint: "fingerprint",
  };
}

function catalogWithId(root: string, id: string, title: string): DocsCatalog {
  const value = catalog(root);
  value.project.id = id;
  value.project.title = title;
  value.project.truthDocuments = ["Docs/Guide.md"];
  value.documents[0].id = `doc-${id}`;
  value.documents[0].projectId = id;
  value.documents[0].route = `projects/${id}/docs/Docs/Guide.md.html`;
  value.sourceFingerprint = `fingerprint-${id}`;
  return value;
}

function catalogWithAsset(root: string): DocsCatalog {
  const value = catalog(root);
  const sourcePath = "Docs/assets/diagram.svg";
  mkdirSync(join(root, "Docs", "assets"), { recursive: true });
  writeFileSync(join(root, sourcePath), "<svg />\n", "utf8");
  value.assets = [
    {
      id: "asset-1",
      projectId: "demo",
      sourcePath,
      route: "projects/demo/assets/Docs/assets/diagram.svg",
      mediaType: "image/svg+xml",
      contentHash: "asset-hash",
    },
  ];
  return value;
}

function catalogWithState(root: string): DocsCatalog {
  const value = catalog(root);
  const state: DocsProjectState = {
    schema_version: 1,
    project: {
      summary: "State summary <script>alert(1)</script>",
      product_type: "service",
      lifecycle: "active",
    },
    structure: {
      roots: [
        {
          id: "src",
          path: "src",
          kind: "directory",
          purpose: "Runtime source",
          owner: "Ada",
        },
      ],
      dependencies: [{ from: "src", to: "docs", type: "publishes" }],
    },
    roadmap: [
      {
        id: "ship",
        title: "Ship <feature>",
        status: "in_progress",
        priority: "high",
        owner: "Ada",
        target_date: "2026-09-01",
        depends_on: ["src"],
        references: [
          { path: "Docs/Guide.md", anchor: "getting-started" },
          {
            path: "Docs/Guide.md",
            anchor: '"><script>alert(1)</script>',
          },
          { path: "Docs/<missing>.md", anchor: "<unsafe>" },
        ],
      },
    ],
    flows: [
      {
        id: "publish",
        title: "Publish flow",
        status: "active",
        trigger: "A document changes",
        steps: [
          {
            id: "scan",
            name: "Scan",
            actor: "CLI",
            inputs: ["source"],
            outputs: ["catalog"],
            references: [{ path: "Docs/Guide.md" }],
          },
          {
            id: "publish-result",
            name: "Publish result",
            actor: "Renderer",
            inputs: [],
            outputs: [],
            references: [],
          },
        ],
      },
    ],
    backlog: [
      {
        id: "test",
        title: "Add coverage",
        type: "task",
        status: "ready",
        priority: "medium",
        owner: "Lin",
        acceptance: ["HTML is escaped"],
        references: [{ path: "Docs/Guide.md", anchor: "Tests" }],
      },
    ],
    status: {
      lifecycle: "active",
      health: "on_track",
      phase: "implementation",
      summary: "Ready to publish.",
      updated_at: "2026-08-12T10:00:00+07:00",
      blockers: [{ id: "block", title: "Await approval", owner: "Ada" }],
      risks: [
        {
          id: "risk",
          title: "Missing owner",
          owner: "Lin",
          mitigation: "Assign one",
        },
      ],
      next_actions: [
        {
          id: "act",
          title: "Review output",
          owner: "Ada",
          due_date: null,
        },
      ],
      next_update_at: "2026-08-19T10:00:00+07:00",
    },
  };
  value.project.state = state;
  value.project.statePath = "docs/project-state.json";
  value.project.stateHash = "state-hash";
  return value;
}

function catalogWithEmptyState(root: string): DocsCatalog {
  const value = catalogWithState(root);
  const state = value.project.state!;
  state.structure.dependencies = [];
  state.roadmap = [];
  state.flows = [];
  state.backlog = [];
  state.status.blockers = [];
  state.status.risks = [];
  state.status.next_actions = [];
  state.status.next_update_at = null;
  return value;
}

function readTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else {
        result[absolute.slice(root.length + 1)] = readFileSync(
          absolute,
          "utf8",
        );
      }
    }
  };
  visit(root);
  return result;
}

describe("Docs Hub static presentation", () => {
  it("renders safe markdown blocks and escapes raw HTML/unsafe URLs", () => {
    const html = renderMarkdown(
      "# Hello\n\n<script>alert(1)</script> [bad](javascript:alert(1))\n\n```ts\nconst x = 1;\n```",
    );
    expect(html).toContain('<h1 id="hello">Hello</h1>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("language-ts");
    expect(renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |")).toContain(
      "<thead>",
    );
  });
  it("builds offline pages, search index, CSS and progressive JS", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-renderer-"));
    const output = join(root, "site");
    const result = renderStaticSite([catalog(root)], { outputDir: output });
    const apiResult = buildDocsHub([catalog(root)], join(root, "api-site"));
    expect(readFileSync(join(output, "index.html"), "utf8")).toContain("Demo");
    expect(readFileSync(join(output, "index.html"), "utf8")).toContain(
      "Project health",
    );
    expect(
      readFileSync(
        join(output, "projects/demo/docs/Docs/Guide.md.html"),
        "utf8",
      ),
    ).toContain("A <strong>safe</strong> guide");
    expect(readFileSync(join(output, "style.css"), "utf8")).toContain(
      "prefers-reduced-motion",
    );
    expect(readFileSync(join(output, "app.js"), "utf8")).toContain(
      "search-index.json",
    );
    expect(readFileSync(join(output, "404.html"), "utf8")).toContain(
      "Page not found",
    );
    const ownership = JSON.parse(
      readFileSync(join(output, ".forgewright-docs-hub"), "utf8"),
    );
    expect(ownership).toEqual({
      schema: "forgewright-docs-hub",
      schema_version: 1,
      source_fingerprints: [{ project_id: "demo", fingerprint: "fingerprint" }],
    });
    expect(ownership).not.toHaveProperty("generated_at");
    expect(
      (
        readFileSync(
          join(output, "projects/demo/docs/Docs/Guide.md.html"),
          "utf8",
        ).match(/<h1/g) ?? []
      ).length,
    ).toBe(1);
    expect(result.files.length).toBeGreaterThan(5);
    expect(
      JSON.parse(readFileSync(result.searchIndex, "utf8")).documents,
    ).toHaveLength(1);
    expect(apiResult.projects[0]?.id).toBe("demo");
    expect(apiResult.filesWritten).toBeGreaterThan(5);
  });
  it("renders project intelligence sections, values, safe refs, and empty states", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-state-renderer-"));
    const output = join(root, "site");
    renderStaticSite([catalogWithState(root)], { outputDir: output });
    const project = readFileSync(
      join(output, "projects/demo/index.html"),
      "utf8",
    );
    const projects = readFileSync(join(output, "index.html"), "utf8");
    expect(project).toContain('id="project-status"');
    expect(project).toContain('id="structure"');
    expect(project).toContain('id="roadmap"');
    expect(project).toContain('id="flows"');
    expect(project).toContain('id="backlog"');
    expect(project).toContain('id="docs-health"');
    expect(project).toContain("implementation");
    expect(project).toContain("State schema version");
    expect(project).toContain("Runtime source");
    expect(project).toContain("publishes");
    expect(project).toContain("Ship &lt;feature&gt;");
    expect(project).toContain("In Progress");
    expect(project).toContain("2026-09-01");
    expect(project).toContain("A document changes");
    expect(project).toContain("Publish flow");
    expect(project).toContain("source");
    expect(project).toContain("catalog");
    expect(project.indexOf("Scan")).toBeLessThan(
      project.indexOf("Publish result"),
    );
    expect(project).toContain("No inputs recorded.");
    expect(project).toContain("No outputs recorded.");
    expect(project).toContain("No references recorded.");
    expect(project).toContain("HTML is escaped");
    expect(project).toContain("Add coverage");
    expect(project).toContain("Await approval");
    expect(project).toContain("Missing owner");
    expect(project).toContain("Review output");
    expect(project).toContain("docs/project-state.json");
    expect(project).toContain("2026-08-12T10:00:00+07:00");
    expect(project).toContain('href="docs/Docs/Guide.md.html#getting-started"');
    expect(project).toContain('href="docs/Docs/Guide.md.html#alert-1"');
    expect(project).toContain("Docs/&lt;missing&gt;.md#&lt;unsafe&gt;");
    expect(project).not.toContain('href="docs/&lt;missing&gt;');
    expect(project).not.toContain(
      'href="docs/Docs/Guide.md.html#&quot;&gt;&lt;script&gt;',
    );
    expect(project).toContain(
      "State summary &lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(project).not.toContain("<script");
    expect(projects).toContain("Project health");
    expect(projects).toContain("On Track");
    expect(projects).toContain("Active");
    expect(projects).toContain("implementation");
    expect(projects).toContain("State freshness");
    expect(projects).toContain("2026-08-12T10:00:00+07:00");
  });
  it("renders explicit messages for empty project-state collections", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-state-empty-"));
    const output = join(root, "site");
    renderStaticSite([catalogWithEmptyState(root)], { outputDir: output });
    const project = readFileSync(
      join(output, "projects/demo/index.html"),
      "utf8",
    );
    expect(project).toContain("No dependencies recorded.");
    expect(project).toContain("No roadmap items recorded.");
    expect(project).toContain("No flows recorded.");
    expect(project).toContain("No backlog items recorded.");
    expect(project).toContain("No blockers recorded.");
    expect(project).toContain("No risks recorded.");
    expect(project).toContain("No next actions recorded.");
    expect(project).toContain("Not scheduled");
  });
  it("renders unavailable state diagnostics and responsive deterministic safeguards", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-state-unavailable-"));
    const output = join(root, "site");
    const value = catalog(root);
    value.diagnostics.push({
      severity: "error",
      code: "PROJECT_STATE_MISSING",
      projectId: "demo",
      path: "docs/project-state.json",
      message: "Project state does not exist.",
    });
    renderStaticSite([value], { outputDir: output });
    const project = readFileSync(
      join(output, "projects/demo/index.html"),
      "utf8",
    );
    const css = readFileSync(join(output, "style.css"), "utf8");
    expect(project).toContain("Project state unavailable.");
    expect(project).toContain("PROJECT_STATE_MISSING");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain("overflow-x: clip");
    expect(css).toContain(".state-grid, .field-list");
    expect(css).toContain("min-width: 0; max-width: 100%");
    expect(css).toContain("table-layout: fixed");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("overflow-wrap: anywhere");
  });
  it("does not present a future project-state timestamp as current", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-state-future-"));
    const output = join(root, "site");
    const value = catalogWithState(root);
    value.diagnostics.push({
      severity: "error",
      code: "PROJECT_STATE_FUTURE_TIMESTAMP",
      projectId: "demo",
      path: "docs/project-state.json",
      message: "Project state timestamp is in the future.",
    });
    renderStaticSite([value], { outputDir: output });
    const project = readFileSync(
      join(output, "projects/demo/index.html"),
      "utf8",
    );
    expect(project).toContain("Future timestamp");
    expect(project).not.toContain("<dd>Current</dd>");
  });
  it("searches project-aware entries", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-search-"));
    const index = buildSearchIndex([catalog(root)]);
    expect(
      searchDocuments(index, "demo safe").map((entry) => entry.id),
    ).toEqual(["doc-1"]);
  });
  it("exports outside roots without modifying source", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-obsidian-"));
    const source = join(root, "Docs");
    require("node:fs").mkdirSync(source);
    writeFileSync(join(source, "Guide.md"), "# Source\n");
    const sourceCatalog = catalog(root);
    sourceCatalog.documents[0].content = "# Source\n";
    const vault = join(resolve(root, ".."), `vault-${Date.now()}`);
    const result = exportObsidianVault([sourceCatalog], vault);
    expect(
      readFileSync(join(vault, "demo", "Docs", "Guide.md"), "utf8"),
    ).toContain("Forgewright Docs Hub");
    expect(result.filesWritten).toBeGreaterThan(1);
    expect(readFileSync(join(source, "Guide.md"), "utf8")).toBe("# Source\n");
    expect(() =>
      exportObsidianVault([sourceCatalog], join(root, "inside")),
    ).toThrow(/outside project root/);
    const symlinkParent = mkdtempSync(
      join(tmpdir(), "forgewright-obsidian-symlink-"),
    );
    const symlinkOutput = join(symlinkParent, "vault");
    symlinkSync(source, symlinkOutput, "dir");
    expect(() => exportObsidianVault([sourceCatalog], symlinkOutput)).toThrow(
      /outside project root/,
    );
    expect(readFileSync(join(source, "Guide.md"), "utf8")).toBe("# Source\n");
  });

  it("rejects nested project, document, and asset symlink destinations", () => {
    const scenarios = [
      { name: "project", relativePath: join("projects", "demo") },
      {
        name: "document",
        relativePath: join("projects", "demo", "docs", "Docs"),
      },
      {
        name: "asset",
        relativePath: join("projects", "demo", "assets", "Docs", "assets"),
      },
      {
        name: "broken document",
        relativePath: join("projects", "demo", "docs", "Docs"),
        broken: true,
      },
      {
        name: "document file target",
        relativePath: join("projects", "demo", "docs", "Docs", "Guide.md.html"),
        file: true,
      },
      {
        name: "asset file target",
        relativePath: join(
          "projects",
          "demo",
          "assets",
          "Docs",
          "assets",
          "diagram.svg",
        ),
        file: true,
      },
    ];

    for (const scenario of scenarios) {
      const root = mkdtempSync(
        join(tmpdir(), `forgewright-renderer-${scenario.name}-`),
      );
      const output = join(root, "site");
      const outside = join(root, "outside");
      mkdirSync(outside, { recursive: true });
      const link = join(output, scenario.relativePath);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(
        scenario.broken ? join(outside, "missing") : outside,
        link,
        scenario.file ? undefined : "dir",
      );

      expect(
        () => renderStaticSite([catalogWithAsset(root)], { outputDir: output }),
        scenario.name,
      ).toThrow(/contains a symlink/);
    }
  });

  it("writes normal nested document and asset destinations", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-renderer-nested-"));
    const output = join(root, "site");
    renderStaticSite([catalogWithAsset(root)], { outputDir: output });

    expect(
      readFileSync(
        join(output, "projects", "demo", "docs", "Docs", "Guide.md.html"),
        "utf8",
      ),
    ).toContain("A <strong>safe</strong> guide");
    expect(
      readFileSync(
        join(
          output,
          "projects",
          "demo",
          "assets",
          "Docs",
          "assets",
          "diagram.svg",
        ),
        "utf8",
      ),
    ).toBe("<svg />\n");
  });

  it("rejects nested project, document, and asset symlinks in Obsidian output", () => {
    const scenarios = [
      { name: "project", relativePath: join("demo") },
      { name: "document", relativePath: join("demo", "Docs") },
      {
        name: "asset",
        relativePath: join("demo", "Docs", "assets"),
      },
      {
        name: "broken document",
        relativePath: join("demo", "Docs"),
        broken: true,
      },
      {
        name: "document file target",
        relativePath: join("demo", "Docs", "Guide.md"),
        file: true,
      },
      {
        name: "asset file target",
        relativePath: join("demo", "Docs", "assets", "diagram.svg"),
        file: true,
      },
    ];

    for (const scenario of scenarios) {
      const root = mkdtempSync(
        join(tmpdir(), `forgewright-obsidian-${scenario.name}-`),
      );
      const output = join(
        resolve(root, ".."),
        `vault-${scenario.name}-${Date.now()}`,
      );
      const outside = join(root, "outside");
      mkdirSync(outside, { recursive: true });
      const link = join(output, scenario.relativePath);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(
        scenario.broken ? join(outside, "missing") : outside,
        link,
        scenario.file ? undefined : "dir",
      );

      expect(
        () => exportObsidianVault([catalogWithAsset(root)], output),
        scenario.name,
      ).toThrow(/contains a symlink/);
    }
  });

  it("writes normal nested document and asset destinations to Obsidian", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-obsidian-nested-"));
    const output = join(resolve(root, ".."), `vault-nested-${Date.now()}`);
    exportObsidianVault([catalogWithAsset(root)], output);

    expect(
      readFileSync(join(output, "demo", "Docs", "Guide.md"), "utf8"),
    ).toContain("Forgewright Docs Hub");
    expect(
      readFileSync(
        join(output, "demo", "Docs", "assets", "diagram.svg"),
        "utf8",
      ),
    ).toBe("<svg />\n");
  });

  it("refuses to replace an unowned output directory", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-owned-output-"));
    const output = join(root, "site");
    mkdirSync(output);
    writeFileSync(join(output, "operator-note.txt"), "keep me\n");
    expect(() => buildDocsHub([catalog(root)], output)).toThrow(
      /unowned output directory/,
    );
  });

  it("recognizes and replaces an output directory with the JSON ownership marker", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-owned-json-"));
    const output = join(root, "site");
    buildDocsHub([catalog(root)], output);
    writeFileSync(join(output, "obsolete.txt"), "replace me\n");

    expect(() => buildDocsHub([catalog(root)], output)).not.toThrow();
    expect(() => readFileSync(join(output, "obsolete.txt"), "utf8")).toThrow();
    expect(
      JSON.parse(readFileSync(join(output, ".forgewright-docs-hub"), "utf8")),
    ).toMatchObject({ schema: "forgewright-docs-hub", schema_version: 1 });
  });

  it("produces byte-equivalent multi-project output regardless of input order", () => {
    const root = mkdtempSync(join(tmpdir(), "forgewright-determinism-"));
    const alpha = catalogWithId(root, "alpha", "Shared title");
    const beta = catalogWithId(root, "beta", "Shared title");
    const firstOutput = join(root, "first");
    const secondOutput = join(root, "second");

    buildDocsHub([beta, alpha], firstOutput);
    buildDocsHub([alpha, beta], secondOutput);

    expect(readTree(firstOutput)).toEqual(readTree(secondOutput));
  });
});
