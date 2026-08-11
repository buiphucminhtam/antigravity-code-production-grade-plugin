import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { loadManifest } from "./manifest.js";
import { canonicalProjectRoot } from "./privacy.js";
import {
  DOCS_SCHEMA_VERSION,
  type DocsRegistry,
  type DocsRegistryProject,
} from "./types.js";

const registrySchema = z
  .object({
    schema_version: z.literal(DOCS_SCHEMA_VERSION),
    projects: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          root: z.string().min(1),
          manifest: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export function getDocsHubHome(): string {
  const configured = process.env.FORGEWRIGHT_HOME?.trim();
  return configured ? resolve(configured) : join(homedir(), ".forgewright");
}

export function getRegistryPath(): string {
  return join(getDocsHubHome(), "docs-hub", "projects.json");
}

export function loadRegistry(path = getRegistryPath()): DocsRegistry {
  if (!existsSync(path)) {
    return { schema_version: DOCS_SCHEMA_VERSION, projects: [] };
  }

  const parsed = registrySchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid docs registry at ${path}: ${details}`);
  }
  return {
    ...parsed.data,
    projects: [...parsed.data.projects].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}

export function saveRegistry(
  registry: DocsRegistry,
  path = getRegistryPath(),
): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const normalized: DocsRegistry = {
    schema_version: DOCS_SCHEMA_VERSION,
    projects: [...registry.projects].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function addRegistryProject(
  projectRootInput: string,
  path = getRegistryPath(),
): { project: DocsRegistryProject; status: "added" | "updated" } {
  const root = canonicalProjectRoot(projectRootInput);
  const loaded = loadManifest(root);
  const project: DocsRegistryProject = {
    id: loaded.manifest.project.id,
    title: loaded.manifest.project.title,
    root,
    manifest: loaded.manifestPath ? realpathSync(loaded.manifestPath) : null,
  };
  const registry = loadRegistry(path);
  const rootIndex = registry.projects.findIndex((entry) => entry.root === root);
  const idIndex = registry.projects.findIndex(
    (entry) => entry.id === project.id,
  );
  if (idIndex >= 0 && registry.projects[idIndex].root !== root) {
    throw new Error(
      `Docs project id "${project.id}" is already registered for ${registry.projects[idIndex].root}. Choose a unique project.id in .forgewright/docs-manifest.json.`,
    );
  }
  const status = rootIndex >= 0 ? "updated" : "added";
  if (rootIndex >= 0) {
    registry.projects[rootIndex] = project;
  } else {
    registry.projects.push(project);
  }
  saveRegistry(registry, path);
  return { project, status };
}

export function removeRegistryProject(
  idOrPath: string,
  path = getRegistryPath(),
): DocsRegistryProject | null {
  const registry = loadRegistry(path);
  let canonicalInput: string | null = null;
  if (existsSync(idOrPath)) {
    canonicalInput = realpathSync(idOrPath);
  }
  const index = registry.projects.findIndex(
    (entry) => entry.id === idOrPath || entry.root === canonicalInput,
  );
  if (index < 0) {
    return null;
  }
  const [removed] = registry.projects.splice(index, 1);
  saveRegistry(registry, path);
  return removed;
}

export function resolveRegistryProject(
  idOrPath: string,
  path = getRegistryPath(),
): DocsRegistryProject | null {
  if (existsSync(idOrPath)) {
    const root = realpathSync(idOrPath);
    const manifest = loadManifest(root);
    return {
      id: manifest.manifest.project.id,
      title: manifest.manifest.project.title,
      root,
      manifest: manifest.manifestPath,
    };
  }
  return (
    loadRegistry(path).projects.find((entry) => entry.id === idOrPath) ?? null
  );
}
