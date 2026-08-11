import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { canonicalProjectRoot, normalizeRelativePath } from "./privacy.js";
import {
  DOCS_SCHEMA_VERSION,
  type DocsDiagnostic,
  type DocsManifest,
  type DocsSource,
  type ManifestLoadResult,
} from "./types.js";

export const DOCS_MANIFEST_PATH = join(".forgewright", "docs-manifest.json");

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      normalizeRelativePath(value);
      return true;
    } catch {
      return false;
    }
  }, "must be a project-relative path without '..' traversal");

const sourceSchema = z
  .object({
    path: relativePathSchema,
    type: z.enum([
      "documentation",
      "overview",
      "architecture",
      "product",
      "testing",
      "operations",
      "assets",
      "metadata",
    ]),
    include: z.array(z.string().min(1)).optional(),
    exclude: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const docsManifestSchema = z
  .object({
    schema_version: z.literal(DOCS_SCHEMA_VERSION),
    project: z
      .object({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        title: z.string().min(1),
      })
      .strict(),
    sources: z.array(sourceSchema).min(1),
    truth: z.array(relativePathSchema).optional(),
    adapters: z
      .object({
        git: z.boolean().optional(),
        gitnexus: z.boolean().optional(),
        evidence_summary: z.boolean().optional(),
      })
      .strict()
      .optional(),
    privacy: z
      .object({
        mode: z.literal("allowlist"),
        allow: z.array(relativePathSchema).optional(),
        exclude: z.array(relativePathSchema).optional(),
      })
      .strict(),
  })
  .strict();

export class DocsManifestError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "DocsManifestError";
    this.details = details;
  }
}

function slugifyProjectId(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function humanizeProjectTitle(input: string): string {
  return input
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function readPackageIdentity(
  projectRoot: string,
): { id: string; title: string } | null {
  const packagePath = join(projectRoot, "package.json");
  if (!existsSync(packagePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: unknown;
      displayName?: unknown;
    };
    const rawName =
      typeof parsed.name === "string"
        ? parsed.name.replace(/^@[^/]+\//, "")
        : basename(projectRoot);
    const title =
      typeof parsed.displayName === "string"
        ? parsed.displayName
        : humanizeProjectTitle(rawName);
    return { id: slugifyProjectId(rawName), title };
  } catch {
    return null;
  }
}

function discoverSources(projectRoot: string): DocsSource[] {
  const directoryNames = new Set(["Docs", "docs", "documentation", "wiki"]);
  const sources: DocsSource[] = readdirSync(projectRoot, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory() && directoryNames.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      path: entry.name,
      type: "documentation" as const,
      include: [
        "**/*.md",
        "**/*.markdown",
        "**/*.json",
        "**/*.yaml",
        "**/*.yml",
        "**/*.svg",
        "**/*.png",
        "**/*.jpg",
        "**/*.jpeg",
        "**/*.gif",
        "**/*.webp",
      ],
    }));

  for (const readme of ["README.md", "README.vi.md"]) {
    if (existsSync(join(projectRoot, readme))) {
      sources.push({ path: readme, type: "overview" });
    }
  }

  if (existsSync(join(projectRoot, ".forgewright", "project-profile.json"))) {
    sources.push({
      path: ".forgewright/project-profile.json",
      type: "metadata",
    });
  }

  if (sources.length === 0) {
    sources.push({ path: "README.md", type: "overview" });
  }
  return sources;
}

export function createDefaultManifest(projectRootInput: string): DocsManifest {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const identity = readPackageIdentity(projectRoot) ?? {
    id: slugifyProjectId(basename(projectRoot)),
    title: humanizeProjectTitle(basename(projectRoot)),
  };
  const sources = discoverSources(projectRoot);

  return {
    schema_version: DOCS_SCHEMA_VERSION,
    project: identity,
    sources,
    truth: sources
      .filter((source) => source.type === "overview")
      .map((source) => source.path),
    adapters: {
      git: true,
      gitnexus: existsSync(join(projectRoot, ".gitnexus", "meta.json")),
      evidence_summary: false,
    },
    privacy: {
      mode: "allowlist",
      allow: sources.map((source) => source.path),
      exclude: [
        "**/.env*",
        "**/credentials/**",
        "**/secrets/**",
        "**/node_modules/**",
        "**/.worktrees/**",
      ],
    },
  };
}

export function validateManifest(input: unknown): DocsManifest {
  const parsed = docsManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new DocsManifestError(
      "Invalid Forgewright docs manifest.",
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      ),
    );
  }
  return parsed.data;
}

export function initManifest(
  projectRootInput: string,
  options: { force?: boolean } = {},
): {
  path: string;
  status: "created" | "already_exists" | "overwritten";
  manifest: DocsManifest;
} {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const manifestPath = join(projectRoot, DOCS_MANIFEST_PATH);
  if (existsSync(manifestPath) && !options.force) {
    return {
      path: manifestPath,
      status: "already_exists",
      manifest: validateManifest(
        JSON.parse(readFileSync(manifestPath, "utf8")),
      ),
    };
  }

  const manifest = createDefaultManifest(projectRoot);
  mkdirSync(join(projectRoot, ".forgewright"), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    path: manifestPath,
    status: options.force ? "overwritten" : "created",
    manifest,
  };
}

export function loadManifest(projectRootInput: string): ManifestLoadResult {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const manifestPath = join(projectRoot, DOCS_MANIFEST_PATH);
  if (existsSync(manifestPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new DocsManifestError(
        `Docs manifest is not valid JSON: ${manifestPath}`,
        [error instanceof Error ? error.message : String(error)],
      );
    }
    return {
      manifest: validateManifest(parsed),
      manifestPath,
      legacy: false,
      diagnostics: [],
    };
  }

  const manifest = createDefaultManifest(projectRoot);
  const diagnostics: DocsDiagnostic[] = [
    {
      severity: "warning",
      code: "LEGACY_MANIFEST_FALLBACK",
      projectId: manifest.project.id,
      message:
        "No .forgewright/docs-manifest.json was found; using safe legacy source discovery.",
      suggestion:
        "Run `forge docs init` to make the documentation contract explicit.",
    },
  ];
  return {
    manifest,
    manifestPath: null,
    legacy: true,
    diagnostics,
  };
}
