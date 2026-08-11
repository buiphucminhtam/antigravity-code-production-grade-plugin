import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDiagram } from "./diagrams.js";
import { normalizeRelativePath } from "./privacy.js";
import type {
  DocsAsset,
  DocsDiagram,
  DocsDocument,
  DocsHeading,
  DocsLink,
  DocsManifest,
  DocsSource,
  ProjectFacts,
} from "./types.js";

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function stableId(namespace: string, value: string): string {
  return createHash("sha256")
    .update(`${namespace}:${value.normalize("NFC")}`)
    .digest("hex")
    .slice(0, 16);
}

function encodeRoutePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function documentRoute(projectId: string, sourcePath: string): string {
  return `projects/${encodeURIComponent(projectId)}/docs/${encodeRoutePath(sourcePath)}.html`;
}

export function assetRoute(projectId: string, sourcePath: string): string {
  return `projects/${encodeURIComponent(projectId)}/assets/${encodeRoutePath(sourcePath)}`;
}

export function slugifyHeading(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~[\](){}:;,.!?'"\\/]+/g, " ")
      .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseFrontmatter(content: string): {
  body: string;
  values: Record<string, unknown>;
  lineOffset: number;
} {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { body: content, values: {}, lineOffset: 0 };
  }
  const lines = content.split(/\r?\n/);
  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closing < 0) {
    return { body: content, values: {}, lineOffset: 0 };
  }
  const values: Record<string, unknown> = {};
  for (const line of lines.slice(1, closing)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (match) {
      values[match[1]] = parseScalar(match[2]);
    }
  }
  return {
    body: lines.slice(closing + 1).join("\n"),
    values,
    lineOffset: closing + 1,
  };
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function extractHeadings(content: string, lineOffset: number): DocsHeading[] {
  const headings: DocsHeading[] = [];
  const slugCounts = new Map<string, number>();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[2].replace(/[`*_~]/g, "").trim();
    const base = slugifyHeading(text);
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    headings.push({
      level: match[1].length,
      text,
      slug: count === 0 ? base : `${base}-${count}`,
      line: index + 1 + lineOffset,
    });
  }
  return headings;
}

function extractLinks(content: string, lineOffset: number): DocsLink[] {
  const links: DocsLink[] = [];
  const regex = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of content.matchAll(regex)) {
    const target = match[3].replace(/^<|>$/g, "");
    const image = match[1] === "!";
    let kind: DocsLink["kind"] = image ? "asset" : "document";
    if (target.startsWith("#")) {
      kind = "anchor";
    } else if (/^(?:https?:|mailto:|tel:|data:)/i.test(target)) {
      kind = "external";
    }
    links.push({
      label: match[2] || (image ? "Image" : target),
      target,
      kind,
      line: lineNumberAt(content, match.index ?? 0) + lineOffset,
      image,
    });
  }
  return links;
}

function extractDiagrams(content: string, lineOffset: number): DocsDiagram[] {
  const diagrams: DocsDiagram[] = [];
  const regex = /```mermaid[^\n]*\r?\n([\s\S]*?)```/gi;
  for (const match of content.matchAll(regex)) {
    diagrams.push(
      parseDiagram(
        match[1],
        lineNumberAt(content, match.index ?? 0) + lineOffset,
      ),
    );
  }
  return diagrams;
}

function extractCodeRefs(content: string): string[] {
  const refs = new Set<string>();
  for (const match of content.matchAll(/gitnexus:\/\/[^\s)>\]]+/g)) {
    refs.add(match[0]);
  }
  for (const match of content.matchAll(
    /(?:^|[\s`("'[])((?:src|app|lib|scripts|mcp|tests|skills)\/[A-Za-z0-9_./@-]+\.(?:ts|tsx|js|mjs|cjs|py|sh|md|json|ya?ml)(?:#[A-Za-z0-9_.:-]+)?)/gm,
  )) {
    refs.add(match[1]);
  }
  return [...refs].sort();
}

function titleFromPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name
    .replace(/\.(?:md|markdown|json|ya?ml)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function normalizeTextDocument(input: {
  projectId: string;
  sourcePath: string;
  source: DocsSource;
  content: string;
  truth: string[];
}): DocsDocument {
  const extension = extname(input.sourcePath).toLowerCase();
  const format: DocsDocument["format"] =
    extension === ".json"
      ? "json"
      : extension === ".yaml" || extension === ".yml"
        ? "yaml"
        : "markdown";
  const parsed =
    format === "markdown"
      ? parseFrontmatter(input.content)
      : { body: input.content, values: {}, lineOffset: 0 };
  const headings =
    format === "markdown"
      ? extractHeadings(parsed.body, parsed.lineOffset)
      : [];
  const titleValue = parsed.values.title;
  const title =
    typeof titleValue === "string" && titleValue.trim()
      ? titleValue.trim()
      : (headings[0]?.text ?? titleFromPath(input.sourcePath));
  const tagsValue = parsed.values.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.filter((tag): tag is string => typeof tag === "string")
    : typeof tagsValue === "string"
      ? tagsValue
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];
  const statusValue = parsed.values.status;
  const normalizedPath = normalizeRelativePath(input.sourcePath);

  return {
    id: stableId(input.projectId, normalizedPath),
    projectId: input.projectId,
    sourcePath: normalizedPath,
    route: documentRoute(input.projectId, normalizedPath),
    title,
    type: input.source.type,
    format,
    status: typeof statusValue === "string" ? statusValue : null,
    sourceOfTruth: input.truth.includes(normalizedPath),
    tags: [...new Set(tags)].sort(),
    headings,
    links:
      format === "markdown" ? extractLinks(parsed.body, parsed.lineOffset) : [],
    codeRefs: extractCodeRefs(parsed.body),
    diagrams:
      format === "markdown"
        ? extractDiagrams(parsed.body, parsed.lineOffset)
        : [],
    backlinks: [],
    related: [],
    warnings:
      format === "markdown" && Object.keys(parsed.values).length === 0
        ? [
            "Document has no frontmatter; classification uses manifest and filename defaults.",
          ]
        : [],
    contentHash: hashContent(input.content),
    content: parsed.body,
  };
}

export function normalizeAsset(input: {
  projectId: string;
  sourcePath: string;
  content: Buffer;
}): DocsAsset {
  const extension = extname(input.sourcePath).toLowerCase();
  const mediaTypes: Record<string, string> = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const normalizedPath = normalizeRelativePath(input.sourcePath);
  return {
    id: stableId(input.projectId, `asset:${normalizedPath}`),
    projectId: input.projectId,
    sourcePath: normalizedPath,
    route: assetRoute(input.projectId, normalizedPath),
    mediaType: mediaTypes[extension] ?? "application/octet-stream",
    contentHash: hashContent(input.content),
  };
}

function runGit(projectRoot: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function readCuratedProfile(projectRoot: string): Record<string, unknown> {
  const path = join(projectRoot, ".forgewright", "project-profile.json");
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const profile: Record<string, unknown> = {};
    if (
      typeof raw.schema_version === "string" ||
      typeof raw.schema_version === "number"
    ) {
      profile.schema_version = raw.schema_version;
    }
    if (raw.facts && typeof raw.facts === "object") {
      const facts = raw.facts as Record<string, unknown>;
      profile.facts = {
        git_present:
          typeof facts.git_present === "boolean"
            ? facts.git_present
            : undefined,
        package_json_present:
          typeof facts.package_json_present === "boolean"
            ? facts.package_json_present
            : undefined,
        lockfiles: Array.isArray(facts.lockfiles)
          ? facts.lockfiles
              .filter((item) => typeof item === "string")
              .slice(0, 20)
          : undefined,
      };
    }
    if (raw.fingerprint && typeof raw.fingerprint === "object") {
      const fingerprint = raw.fingerprint as Record<string, unknown>;
      const allowed = [
        "product",
        "language",
        "framework",
        "build_tool",
        "architecture",
        "services",
        "source_of_truth",
      ];
      profile.fingerprint = Object.fromEntries(
        allowed
          .filter((key) => key in fingerprint)
          .map((key) => [key, fingerprint[key]]),
      );
    }
    return profile;
  } catch {
    return {};
  }
}

export function collectProjectFacts(
  projectRoot: string,
  manifest: DocsManifest,
): ProjectFacts {
  const gitEnabled = manifest.adapters?.git !== false;
  const commit = gitEnabled ? runGit(projectRoot, ["rev-parse", "HEAD"]) : null;
  const branch = gitEnabled
    ? runGit(projectRoot, ["branch", "--show-current"])
    : null;
  const dirtyOutput = gitEnabled
    ? runGit(projectRoot, ["status", "--porcelain", "--untracked-files=no"])
    : null;

  const gitnexusEnabled = manifest.adapters?.gitnexus === true;
  const gitnexusPath = join(projectRoot, ".gitnexus", "meta.json");
  let gitnexus: ProjectFacts["gitnexus"] = {
    status: gitnexusEnabled ? "unavailable" : "disabled",
    indexedCommit: null,
    indexedAt: null,
    processes: null,
    symbols: null,
  };
  if (gitnexusEnabled && existsSync(gitnexusPath)) {
    try {
      const meta = JSON.parse(readFileSync(gitnexusPath, "utf8")) as {
        lastCommit?: unknown;
        indexedAt?: unknown;
        stats?: { processes?: unknown; nodes?: unknown };
      };
      const indexedCommit =
        typeof meta.lastCommit === "string" ? meta.lastCommit : null;
      gitnexus = {
        status:
          commit &&
          indexedCommit &&
          (commit !== indexedCommit || Boolean(dirtyOutput))
            ? "stale"
            : "available",
        indexedCommit,
        indexedAt: typeof meta.indexedAt === "string" ? meta.indexedAt : null,
        processes:
          typeof meta.stats?.processes === "number"
            ? meta.stats.processes
            : null,
        symbols:
          typeof meta.stats?.nodes === "number" ? meta.stats.nodes : null,
      };
    } catch {
      gitnexus.status = "unavailable";
    }
  }

  return {
    git: {
      available: commit !== null,
      branch,
      commit,
      dirty: commit === null ? null : Boolean(dirtyOutput),
    },
    gitnexus,
    profile: readCuratedProfile(projectRoot),
  };
}
