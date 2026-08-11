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
import type { DocsCatalog } from "../src/docs/types.js";

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
    expect(
      readFileSync(join(output, ".forgewright-docs-hub"), "utf8"),
    ).toContain("forge docs build");
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
