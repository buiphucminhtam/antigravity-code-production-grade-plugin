import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";
import { loadManifest } from "./manifest.js";
import {
  canonicalProjectRoot,
  DocsPathError,
  isAllowedByPrivacy,
  isSensitivePath,
  matchesGlob,
  normalizeRelativePath,
  resolveWithinProject,
} from "./privacy.js";
import {
  collectProjectFacts,
  hashContent,
  normalizeAsset,
  normalizeTextDocument,
} from "./normalize.js";
import { resolveCatalogLinks } from "./links.js";
import {
  DOCS_SCHEMA_VERSION,
  type DocsAsset,
  type DocsCatalog,
  type DocsDiagnostic,
  type DocsDocument,
  type DocsSource,
} from "./types.js";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".json", ".yaml", ".yml"]);
const ASSET_EXTENSIONS = new Set([
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function projectRelative(projectRoot: string, absolutePath: string): string {
  return normalizeRelativePath(
    relative(projectRoot, absolutePath).replace(/\\/g, "/"),
  );
}

function sourceAllows(source: DocsSource, sourceRelativePath: string): boolean {
  const included =
    !source.include ||
    source.include.length === 0 ||
    source.include.some((glob) => matchesGlob(sourceRelativePath, glob));
  const excluded =
    source.exclude?.some((glob) => matchesGlob(sourceRelativePath, glob)) ??
    false;
  return included && !excluded;
}

function scanSource(input: {
  projectRoot: string;
  projectId: string;
  source: DocsSource;
  truth: string[];
  allow: string[];
  exclude: string[];
  documents: Map<string, DocsDocument>;
  assets: Map<string, DocsAsset>;
  diagnostics: DocsDiagnostic[];
}): void {
  const sourcePath = normalizeRelativePath(input.source.path);
  if (isSensitivePath(sourcePath)) {
    input.diagnostics.push({
      severity: "error",
      code: "SENSITIVE_SOURCE_REJECTED",
      projectId: input.projectId,
      path: sourcePath,
      message:
        "Manifest source is blocked by the built-in sensitive-path policy.",
      suggestion: "Move curated documentation to an approved docs root.",
    });
    return;
  }

  let absoluteSource: string;
  try {
    absoluteSource = resolveWithinProject(input.projectRoot, sourcePath, {
      mustExist: true,
    });
  } catch (error) {
    input.diagnostics.push({
      severity: "warning",
      code: "SOURCE_UNAVAILABLE",
      projectId: input.projectId,
      path: sourcePath,
      message: error instanceof Error ? error.message : String(error),
      suggestion: "Create the source path or update the docs manifest.",
    });
    return;
  }

  const sourceIsFile = statSync(absoluteSource).isFile();
  const seenDirectories = new Set<string>();

  const visit = (absolutePath: string, presentedPath: string): void => {
    let containedPath: string;
    try {
      containedPath = resolveWithinProject(input.projectRoot, presentedPath, {
        mustExist: true,
      });
    } catch (error) {
      const unavailable =
        error instanceof DocsPathError && error.code === "PATH_NOT_FOUND";
      input.diagnostics.push({
        severity: unavailable ? "warning" : "error",
        code: unavailable ? "BROKEN_SYMLINK" : "PATH_CONTAINMENT_FAILED",
        projectId: input.projectId,
        path: presentedPath,
        message: error instanceof Error ? error.message : String(error),
        ...(unavailable
          ? {
              suggestion:
                "Repair or remove the broken symlink from the approved docs root.",
            }
          : {}),
      });
      return;
    }

    const pathStat = statSync(containedPath);
    if (pathStat.isDirectory()) {
      if (lstatSync(absolutePath).isSymbolicLink()) {
        input.diagnostics.push({
          severity: "info",
          code: "SYMLINK_DIRECTORY_SKIPPED",
          projectId: input.projectId,
          path: presentedPath,
          message:
            "Contained directory symlink was validated but skipped to avoid cycles.",
        });
        return;
      }
      if (seenDirectories.has(containedPath)) return;
      seenDirectories.add(containedPath);
      for (const entry of readdirSync(containedPath, {
        withFileTypes: true,
      }).sort((left, right) => left.name.localeCompare(right.name))) {
        const childPresented = `${presentedPath}/${entry.name}`.replace(
          /\/+/g,
          "/",
        );
        if (isSensitivePath(childPresented)) continue;
        visit(join(containedPath, entry.name), childPresented);
      }
      return;
    }

    if (!pathStat.isFile()) return;
    const relativePath = projectRelative(input.projectRoot, absolutePath);
    const relativeToSource = sourceIsFile
      ? (relativePath.split("/").at(-1) ?? relativePath)
      : relative(sourcePath, relativePath).replace(/\\/g, "/");
    if (!sourceAllows(input.source, relativeToSource)) return;

    if (!isAllowedByPrivacy(relativePath, input.allow, input.exclude)) {
      return;
    }

    const extension = extname(relativePath).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
      if (pathStat.size > MAX_TEXT_BYTES) {
        input.diagnostics.push({
          severity: "warning",
          code: "DOCUMENT_TOO_LARGE",
          projectId: input.projectId,
          path: relativePath,
          message: `Document exceeds the ${MAX_TEXT_BYTES}-byte safe read limit.`,
        });
        return;
      }
      const content = readFileSync(containedPath, "utf8");
      const document = normalizeTextDocument({
        projectId: input.projectId,
        sourcePath: relativePath,
        source: input.source,
        content,
        truth: input.truth,
      });
      if (input.documents.has(relativePath)) {
        input.diagnostics.push({
          severity: "info",
          code: "DUPLICATE_SOURCE",
          projectId: input.projectId,
          path: relativePath,
          message:
            "Document matched more than one manifest source; first match wins.",
        });
      } else {
        input.documents.set(relativePath, document);
      }
      return;
    }

    if (ASSET_EXTENSIONS.has(extension)) {
      const asset = normalizeAsset({
        projectId: input.projectId,
        sourcePath: relativePath,
        content: readFileSync(containedPath),
      });
      if (!input.assets.has(relativePath))
        input.assets.set(relativePath, asset);
    }
  };

  visit(absoluteSource, sourcePath);
}

function addCatalogDiagnostics(catalog: DocsCatalog): void {
  const lowerPaths = new Map<string, string>();
  for (const item of [...catalog.documents, ...catalog.assets]) {
    const lower = item.sourcePath.toLowerCase();
    const existing = lowerPaths.get(lower);
    if (existing && existing !== item.sourcePath) {
      catalog.diagnostics.push({
        severity: "error",
        code: "CASE_COLLISION",
        projectId: catalog.project.id,
        path: item.sourcePath,
        message: `Path collides with "${existing}" on case-insensitive filesystems.`,
        suggestion:
          "Rename one source so paths differ by more than letter casing.",
      });
    } else {
      lowerPaths.set(lower, item.sourcePath);
    }
  }

  for (const truthPath of catalog.project.truthDocuments) {
    if (
      !catalog.documents.some((document) => document.sourcePath === truthPath)
    ) {
      catalog.diagnostics.push({
        severity: "warning",
        code: "MISSING_TRUTH_DOCUMENT",
        projectId: catalog.project.id,
        path: truthPath,
        message: "Declared source-of-truth document was not found in the scan.",
        suggestion: "Fix the truth path or add it to an approved source.",
      });
    }
  }

  for (const document of catalog.documents) {
    for (const warning of document.warnings) {
      catalog.diagnostics.push({
        severity: "info",
        code: "DOCUMENT_METADATA_FALLBACK",
        projectId: catalog.project.id,
        path: document.sourcePath,
        message: warning,
      });
    }
    for (const diagram of document.diagrams) {
      if (!diagram.valid) {
        catalog.diagnostics.push({
          severity: "error",
          code: "INVALID_DIAGRAM",
          projectId: catalog.project.id,
          path: document.sourcePath,
          message: `${diagram.error ?? "Invalid diagram"} (line ${diagram.line}).`,
          suggestion:
            "Fix Mermaid syntax; the portal will keep a text fallback.",
        });
      }
    }
  }

  const gitnexusStatus = catalog.project.facts.gitnexus.status;
  if (gitnexusStatus === "stale") {
    catalog.diagnostics.push({
      severity: "warning",
      code: "GITNEXUS_STALE",
      projectId: catalog.project.id,
      message: "GitNexus metadata is stale relative to the current Git commit.",
      suggestion:
        "Run `node .gitnexus/run.cjs analyze` before publishing traceability.",
    });
  } else if (gitnexusStatus === "unavailable") {
    catalog.diagnostics.push({
      severity: "warning",
      code: "GITNEXUS_UNAVAILABLE",
      projectId: catalog.project.id,
      message:
        "GitNexus was enabled but no readable index metadata is available.",
      suggestion:
        "Index the project or disable the adapter in the docs manifest.",
    });
  }
}

export function refreshCatalogSummary(catalog: DocsCatalog): DocsCatalog {
  catalog.documents.sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath),
  );
  catalog.assets.sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath),
  );
  catalog.diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      (left.path ?? "").localeCompare(right.path ?? "") ||
      left.code.localeCompare(right.code),
  );
  catalog.sourceFingerprint = hashContent(
    JSON.stringify({
      manifest: catalog.project.manifestPath
        ? ".forgewright/docs-manifest.json"
        : "legacy",
      project: {
        id: catalog.project.id,
        title: catalog.project.title,
        truth: catalog.project.truthDocuments,
      },
      documents: catalog.documents.map((document) => [
        document.sourcePath,
        document.contentHash,
      ]),
      assets: catalog.assets.map((asset) => [
        asset.sourcePath,
        asset.contentHash,
      ]),
      git: catalog.project.facts.git.commit,
      gitnexus: catalog.project.facts.gitnexus.indexedCommit,
    }),
  );
  const counts = { errors: 0, warnings: 0, info: 0 };
  for (const diagnostic of catalog.diagnostics) {
    if (diagnostic.severity === "error") counts.errors += 1;
    else if (diagnostic.severity === "warning") counts.warnings += 1;
    else counts.info += 1;
  }
  catalog.project.health = counts;
  catalog.project.scanStatus =
    counts.errors > 0 ? "error" : counts.warnings > 0 ? "warning" : "ok";
  return catalog;
}

export function scanProject(projectRootInput: string): DocsCatalog {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const loaded = loadManifest(projectRoot);
  const manifest = loaded.manifest;
  const truth = (manifest.truth ?? []).map(normalizeRelativePath);
  const allow = (
    manifest.privacy.allow ?? manifest.sources.map((source) => source.path)
  ).map(normalizeRelativePath);
  const exclude = (manifest.privacy.exclude ?? []).map(normalizeRelativePath);
  const documents = new Map<string, DocsDocument>();
  const assets = new Map<string, DocsAsset>();
  const diagnostics = [...loaded.diagnostics];

  if (allow.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "EMPTY_PRIVACY_ALLOWLIST",
      projectId: manifest.project.id,
      message: "Privacy mode is allowlist but no allowed paths are configured.",
      suggestion: "Add manifest source paths to privacy.allow.",
    });
  }

  for (const source of manifest.sources) {
    scanSource({
      projectRoot,
      projectId: manifest.project.id,
      source,
      truth,
      allow,
      exclude,
      documents,
      assets,
      diagnostics,
    });
  }

  const catalog: DocsCatalog = {
    schema_version: DOCS_SCHEMA_VERSION,
    project: {
      id: manifest.project.id,
      title: manifest.project.title,
      root: projectRoot,
      manifestPath: loaded.manifestPath,
      legacy: loaded.legacy,
      truthDocuments: truth,
      facts: collectProjectFacts(projectRoot, manifest),
      health: { errors: 0, warnings: 0, info: 0 },
      scanStatus: "ok",
    },
    documents: [...documents.values()],
    assets: [...assets.values()],
    relations: [],
    diagnostics,
    sourceFingerprint: "",
  };
  addCatalogDiagnostics(catalog);
  resolveCatalogLinks([catalog]);
  return refreshCatalogSummary(catalog);
}

export function getCatalogPath(projectRootInput: string): string {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  return join(projectRoot, ".forgewright", "cache", "docs-index.json");
}

export function writeCatalog(catalog: DocsCatalog): string {
  const path = getCatalogPath(catalog.project.root);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return path;
}

export function readCatalog(projectRootInput: string): DocsCatalog | null {
  const path = getCatalogPath(projectRootInput);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as DocsCatalog;
}
