export const DOCS_SCHEMA_VERSION = 1 as const;

export type DocsSourceType =
  | "documentation"
  | "overview"
  | "architecture"
  | "product"
  | "testing"
  | "operations"
  | "assets"
  | "metadata";

export interface DocsSource {
  path: string;
  type: DocsSourceType;
  include?: string[];
  exclude?: string[];
}

export interface DocsManifest {
  schema_version: typeof DOCS_SCHEMA_VERSION;
  project: {
    id: string;
    title: string;
  };
  sources: DocsSource[];
  truth?: string[];
  adapters?: {
    git?: boolean;
    gitnexus?: boolean;
    evidence_summary?: boolean;
  };
  privacy: {
    mode: "allowlist";
    allow?: string[];
    exclude?: string[];
  };
}

export interface DocsRegistryProject {
  id: string;
  title: string;
  root: string;
  manifest: string | null;
}

export interface DocsRegistry {
  schema_version: typeof DOCS_SCHEMA_VERSION;
  projects: DocsRegistryProject[];
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface DocsDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  projectId: string;
  path?: string;
  message: string;
  suggestion?: string;
}

export interface DocsHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export type DocsLinkKind = "document" | "asset" | "external" | "anchor";

export interface DocsLink {
  label: string;
  target: string;
  kind: DocsLinkKind;
  line: number;
  image: boolean;
  anchor?: string;
  resolvedDocumentId?: string;
  resolvedAssetId?: string;
  resolvedRoute?: string;
}

export interface DocsDiagram {
  id: string;
  type: string;
  source: string;
  line: number;
  valid: boolean;
  error?: string;
  labels: string[];
}

export interface DocsDocument {
  id: string;
  projectId: string;
  sourcePath: string;
  route: string;
  title: string;
  type: DocsSourceType;
  format: "markdown" | "json" | "yaml";
  status: string | null;
  sourceOfTruth: boolean;
  tags: string[];
  headings: DocsHeading[];
  links: DocsLink[];
  codeRefs: string[];
  diagrams: DocsDiagram[];
  backlinks: string[];
  related: string[];
  warnings: string[];
  contentHash: string;
  content: string;
}

export interface DocsAsset {
  id: string;
  projectId: string;
  sourcePath: string;
  route: string;
  mediaType: string;
  contentHash: string;
}

export type DocsRelationType =
  "links-to" | "embeds" | "backlink" | "related" | "code-ref" | "truth";

export interface DocsRelation {
  from: string;
  to: string;
  type: DocsRelationType;
  source: string;
  confidence: number;
}

export interface ProjectFacts {
  git: {
    available: boolean;
    branch: string | null;
    commit: string | null;
    dirty: boolean | null;
  };
  gitnexus: {
    status: "available" | "stale" | "unavailable" | "disabled";
    indexedCommit: string | null;
    indexedAt: string | null;
    processes: number | null;
    symbols: number | null;
  };
  profile: Record<string, unknown>;
}

export interface DocsProjectRecord {
  id: string;
  title: string;
  root: string;
  manifestPath: string | null;
  legacy: boolean;
  truthDocuments: string[];
  facts: ProjectFacts;
  health: {
    errors: number;
    warnings: number;
    info: number;
  };
  scanStatus: "ok" | "warning" | "error";
}

export interface DocsCatalog {
  schema_version: typeof DOCS_SCHEMA_VERSION;
  project: DocsProjectRecord;
  documents: DocsDocument[];
  assets: DocsAsset[];
  relations: DocsRelation[];
  diagnostics: DocsDiagnostic[];
  sourceFingerprint: string;
}

export interface ManifestLoadResult {
  manifest: DocsManifest;
  manifestPath: string | null;
  legacy: boolean;
  diagnostics: DocsDiagnostic[];
}

export interface DocsBuildResult {
  outputDir: string;
  projects: Array<{
    id: string;
    title: string;
    documents: number;
    diagnostics: number;
  }>;
  filesWritten: number;
}
