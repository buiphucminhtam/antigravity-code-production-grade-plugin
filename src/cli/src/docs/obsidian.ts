import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isPathInside } from "./privacy.js";
import type { DocsCatalog } from "./types.js";

export interface ObsidianExportResult {
  outputDir: string;
  projects: number;
  filesWritten: number;
}

function canonicalPotentialPath(input: string): string {
  const absolute = resolve(input);
  let existing = absolute;
  const missingSegments: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missingSegments.unshift(basename(existing));
    existing = parent;
  }
  const canonicalExisting = existsSync(existing)
    ? realpathSync(existing)
    : existing;
  return resolve(canonicalExisting, ...missingSegments);
}

function ensureOutside(outputDir: string, roots: string[]): void {
  const output = canonicalPotentialPath(outputDir);
  for (const root of roots) {
    const canonicalRoot = realpathSync(root);
    if (isPathInside(canonicalRoot, output)) {
      throw new Error(`Obsidian output must be outside project root: ${root}`);
    }
  }
}
function obsidianPath(projectId: string, sourcePath: string): string {
  return join(projectId, sourcePath);
}
function safeDestination(outputDir: string, child: string): string {
  const root = resolve(outputDir);
  const target = resolve(child);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Obsidian output path escapes output directory: ${child}`);
  }
  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const segment of ["", ...segments]) {
    current = segment ? join(current, segment) : current;
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(
          `Refusing Obsidian output destination because it contains a symlink: ${current}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      if (error instanceof Error && error.message.startsWith("Refusing ")) {
        throw error;
      }
      throw new Error(
        `Unable to inspect Obsidian output destination: ${current}`,
        { cause: error },
      );
    }
  }
  return target;
}

export function exportObsidianVault(
  catalogs: DocsCatalog[],
  outputDirInput: string,
): ObsidianExportResult {
  const orderedCatalogs = [...catalogs].sort((left, right) =>
    left.project.id.localeCompare(right.project.id),
  );
  const outputDir = resolve(outputDirInput);
  ensureOutside(
    outputDir,
    orderedCatalogs.map((catalog) => catalog.project.root),
  );
  const safeOutputDir = safeDestination(outputDir, outputDir);
  mkdirSync(safeOutputDir, { recursive: true });
  const files: string[] = [];
  const write = (path: string, content: string): void => {
    const safePath = safeDestination(outputDir, path);
    mkdirSync(dirname(safePath), { recursive: true });
    safeDestination(outputDir, safePath);
    writeFileSync(safePath, content, "utf8");
    files.push(safePath);
  };
  write(
    join(outputDir, "README.md"),
    `# Forgewright Docs Hub\n\n${orderedCatalogs.map((catalog) => `- [[${catalog.project.id}/index|${catalog.project.title}]]`).join("\n")}\n`,
  );
  for (const catalog of orderedCatalogs) {
    const byId = new Map(
      catalog.documents.map((document) => [document.id, document]),
    );
    write(
      join(outputDir, catalog.project.id, "index.md"),
      `# ${catalog.project.title}\n\n${catalog.documents.map((document) => `- [[${document.sourcePath.replace(/\.md$/i, "")}|${document.title}]]`).join("\n")}\n`,
    );
    for (const document of catalog.documents) {
      const destination = join(
        outputDir,
        obsidianPath(catalog.project.id, document.sourcePath),
      );
      let content = document.content;
      for (const link of document.links) {
        if (
          link.resolvedDocumentId &&
          link.target.startsWith("forgewright://")
        ) {
          const target =
            byId.get(link.resolvedDocumentId) ??
            orderedCatalogs
              .flatMap((item) => item.documents)
              .find((item) => item.id === link.resolvedDocumentId);
          if (target) {
            const original = `[${link.label}](${link.target})`;
            const obsidian = `[[${target.projectId}/${target.sourcePath.replace(/\.md$/i, "")}|${link.label}]]`;
            content = content.split(original).join(obsidian);
          }
        }
      }
      const nav = `> [!info] Forgewright Docs Hub\n> Project: [[${catalog.project.id}/index|${catalog.project.title}]] · Source: \`${document.sourcePath}\`\n\n`;
      write(
        destination,
        document.format === "markdown" ? nav + content : content,
      );
    }
    for (const asset of catalog.assets) {
      const target = join(
        outputDir,
        asset.route.replace(
          /^projects\/[^/]+\/assets\//,
          `${catalog.project.id}/`,
        ),
      );
      const safeTarget = safeDestination(outputDir, target);
      mkdirSync(dirname(safeTarget), { recursive: true });
      safeDestination(outputDir, safeTarget);
      copyFileSync(join(catalog.project.root, asset.sourcePath), safeTarget);
      files.push(safeTarget);
    }
  }
  return {
    outputDir,
    projects: orderedCatalogs.length,
    filesWritten: files.length,
  };
}

export const exportToObsidian = exportObsidianVault;
