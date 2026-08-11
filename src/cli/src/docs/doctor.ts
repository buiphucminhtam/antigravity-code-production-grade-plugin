import { readCatalog, scanProject } from "./scanner.js";
import type { DocsCatalog, DocsDiagnostic } from "./types.js";

export interface DocsDoctorReport {
  projectId: string;
  projectTitle: string;
  status: "pass" | "warning" | "fail";
  sourceFingerprint: string;
  storedFingerprint: string | null;
  diagnostics: DocsDiagnostic[];
  summary: {
    documents: number;
    assets: number;
    errors: number;
    warnings: number;
    info: number;
  };
}

export function doctorCatalog(
  catalog: DocsCatalog,
  storedCatalog: DocsCatalog | null,
  options: { strict?: boolean } = {},
): DocsDoctorReport {
  const diagnostics = [...catalog.diagnostics];
  if (
    storedCatalog &&
    storedCatalog.sourceFingerprint !== catalog.sourceFingerprint
  ) {
    diagnostics.push({
      severity: "warning",
      code: "STALE_DOCS_INDEX",
      projectId: catalog.project.id,
      path: ".forgewright/cache/docs-index.json",
      message: "The stored normalized docs index is stale.",
      suggestion: "Run `forge docs scan` or `forge docs build`.",
    });
  }

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  const info = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "info",
  ).length;
  const status =
    errors > 0 || (options.strict && warnings > 0)
      ? "fail"
      : warnings > 0
        ? "warning"
        : "pass";

  return {
    projectId: catalog.project.id,
    projectTitle: catalog.project.title,
    status,
    sourceFingerprint: catalog.sourceFingerprint,
    storedFingerprint: storedCatalog?.sourceFingerprint ?? null,
    diagnostics,
    summary: {
      documents: catalog.documents.length,
      assets: catalog.assets.length,
      errors,
      warnings,
      info,
    },
  };
}

export function doctorProject(
  projectRoot: string,
  options: { strict?: boolean } = {},
): DocsDoctorReport {
  const catalog = scanProject(projectRoot);
  return doctorCatalog(catalog, readCatalog(projectRoot), options);
}
