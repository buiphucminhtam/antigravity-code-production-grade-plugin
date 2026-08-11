import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocsCatalog, DocsDocument } from "./types.js";

export interface SearchEntry {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  route: string;
  sourcePath: string;
  type: string;
  tags: string[];
  headings: string[];
  text: string;
}
export interface SearchIndex {
  schema_version: 1;
  sourceFingerprint: string;
  documents: SearchEntry[];
}

function plainText(document: DocsDocument): string {
  return document.content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`\[\]()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

export function buildSearchIndex(catalogs: DocsCatalog[]): SearchIndex {
  return {
    schema_version: 1,
    sourceFingerprint:
      catalogs
        .map((catalog) => catalog.sourceFingerprint)
        .sort()
        .join(":") || "static",
    documents: catalogs
      .flatMap((catalog) =>
        catalog.documents.map((document) => ({
          id: document.id,
          projectId: catalog.project.id,
          projectTitle: catalog.project.title,
          title: document.title,
          route: document.route,
          sourcePath: document.sourcePath,
          type: document.type,
          tags: document.tags,
          headings: document.headings.map((heading) => heading.text),
          text: plainText(document),
        })),
      )
      .sort((a, b) =>
        `${a.projectTitle}/${a.title}/${a.projectId}/${a.sourcePath}/${a.id}`.localeCompare(
          `${b.projectTitle}/${b.title}/${b.projectId}/${b.sourcePath}/${b.id}`,
        ),
      ),
  };
}

export function writeSearchIndex(
  index: SearchIndex,
  outputDir: string,
): string {
  const path = join(outputDir, "search-index.json");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return path;
}

export function searchDocuments(
  index: SearchIndex,
  query: string,
): SearchEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return index.documents;
  return index.documents.filter((entry) => {
    const haystack = [
      entry.projectTitle,
      entry.title,
      entry.sourcePath,
      ...entry.tags,
      ...entry.headings,
      entry.text,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
