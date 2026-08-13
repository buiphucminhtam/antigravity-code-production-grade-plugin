import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalProjectRoot,
  isSensitivePath,
  resolveWithinProject,
} from "./privacy.js";
import { hashContent } from "./normalize.js";
import {
  DOCS_PROJECT_STATE_SCHEMA_VERSION,
  type DocsProjectState,
} from "./types.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isProjectRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  return !value.split("/").some((segment) => segment === "..");
}

export const projectStateRelativePathSchema = z
  .string()
  .min(1)
  .refine(isProjectRelativePath, {
    message:
      "must be a project-relative path without traversal, absolute prefixes, or backslashes",
  });

const idSchema = z.string().regex(ID_PATTERN, "must be a slug-like ID");
const textSchema = z.string().min(1);
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must use YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "must be a valid calendar date");
const referenceSchema = z
  .object({
    path: projectStateRelativePathSchema,
    anchor: textSchema.optional(),
  })
  .strict();

const projectSchema = z
  .object({
    summary: textSchema,
    product_type: z.enum([
      "product",
      "game",
      "library",
      "service",
      "tooling",
      "other",
    ]),
    lifecycle: z.enum([
      "planning",
      "active",
      "paused",
      "archived",
      "completed",
    ]),
  })
  .strict();

const rootSchema = z
  .object({
    id: idSchema,
    path: projectStateRelativePathSchema,
    kind: textSchema,
    purpose: textSchema,
    owner: textSchema,
  })
  .strict();

const dependencySchema = z
  .object({
    from: idSchema,
    to: idSchema,
    type: textSchema,
  })
  .strict();

const roadmapSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    status: z.enum([
      "proposed",
      "planned",
      "in_progress",
      "blocked",
      "done",
      "cancelled",
    ]),
    priority: z.enum(["low", "medium", "high", "critical"]),
    owner: textSchema,
    target_date: calendarDateSchema.nullable(),
    depends_on: z.array(idSchema),
    references: z.array(referenceSchema),
  })
  .strict();

const flowStepSchema = z
  .object({
    id: idSchema,
    name: textSchema,
    actor: textSchema,
    inputs: z.array(textSchema).min(1),
    outputs: z.array(textSchema).min(1),
    references: z.array(referenceSchema),
  })
  .strict();

const flowSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    status: z.enum(["draft", "active", "deprecated"]),
    trigger: textSchema,
    steps: z
      .array(flowStepSchema)
      .min(1)
      .superRefine(requireUniqueIds("flow steps")),
  })
  .strict();

const backlogSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    type: z.enum(["feature", "bug", "task", "research", "technical_debt"]),
    status: z.enum([
      "proposed",
      "ready",
      "in_progress",
      "blocked",
      "done",
      "cancelled",
    ]),
    priority: z.enum(["low", "medium", "high", "critical"]),
    owner: textSchema,
    acceptance: z.array(textSchema).min(1),
    references: z.array(referenceSchema),
  })
  .strict();

const blockerSchema = z
  .object({ id: idSchema, title: textSchema, owner: textSchema })
  .strict();

const riskSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    owner: textSchema,
    mitigation: textSchema,
  })
  .strict();

const nextActionSchema = z
  .object({
    id: idSchema,
    title: textSchema,
    owner: textSchema,
    due_date: calendarDateSchema.nullable(),
  })
  .strict();

const statusSchema = z
  .object({
    lifecycle: z.enum([
      "planning",
      "active",
      "paused",
      "archived",
      "completed",
    ]),
    health: z.enum(["on_track", "at_risk", "blocked", "unknown"]),
    phase: textSchema,
    summary: textSchema,
    updated_at: z.string().datetime({ offset: true }),
    blockers: z.array(blockerSchema).superRefine(requireUniqueIds("blockers")),
    risks: z.array(riskSchema).superRefine(requireUniqueIds("risks")),
    next_actions: z
      .array(nextActionSchema)
      .superRefine(requireUniqueIds("next actions")),
    next_update_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

function requireUniqueIds(collection: string) {
  return (items: Array<{ id: string }>, context: z.RefinementCtx): void => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: `duplicate ID in ${collection}`,
        });
      }
      seen.add(item.id);
    }
  };
}

export const docsProjectStateSchema = z
  .object({
    schema_version: z.literal(DOCS_PROJECT_STATE_SCHEMA_VERSION),
    project: projectSchema,
    structure: z
      .object({
        roots: z
          .array(rootSchema)
          .min(1, "structure.roots must not be empty")
          .superRefine(requireUniqueIds("structure roots")),
        dependencies: z.array(dependencySchema),
      })
      .strict(),
    roadmap: z.array(roadmapSchema).superRefine(requireUniqueIds("roadmap")),
    flows: z.array(flowSchema).superRefine(requireUniqueIds("flows")),
    backlog: z.array(backlogSchema).superRefine(requireUniqueIds("backlog")),
    status: statusSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (state.project.lifecycle !== state.status.lifecycle) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status", "lifecycle"],
        message: "must match project.lifecycle",
      });
    }

    const rootIds = new Set(state.structure.roots.map((root) => root.id));
    const dependencyKeys = new Set<string>();
    for (const [index, dependency] of state.structure.dependencies.entries()) {
      for (const field of ["from", "to"] as const) {
        if (!rootIds.has(dependency[field])) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["structure", "dependencies", index, field],
            message: "must reference a structure root ID",
          });
        }
      }
      const key = `${dependency.from}\0${dependency.to}\0${dependency.type}`;
      if (dependencyKeys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["structure", "dependencies", index],
          message: "duplicate structure dependency",
        });
      }
      dependencyKeys.add(key);
    }

    const roadmapIds = new Set(state.roadmap.map((item) => item.id));
    for (const [index, item] of state.roadmap.entries()) {
      const seen = new Set<string>();
      for (const [dependencyIndex, dependency] of item.depends_on.entries()) {
        if (!roadmapIds.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roadmap", index, "depends_on", dependencyIndex],
            message: "must reference a roadmap item ID",
          });
        } else if (dependency === item.id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roadmap", index, "depends_on", dependencyIndex],
            message: "must not reference the same roadmap item",
          });
        }
        if (seen.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roadmap", index, "depends_on", dependencyIndex],
            message: "duplicate roadmap dependency",
          });
        }
        seen.add(dependency);
      }
    }

    if (
      state.status.next_update_at &&
      Date.parse(state.status.next_update_at) <
        Date.parse(state.status.updated_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status", "next_update_at"],
        message: "must not be earlier than status.updated_at",
      });
    }
  });

export class DocsProjectStateError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "DocsProjectStateError";
    this.details = details;
  }
}

export function validateProjectState(input: unknown): DocsProjectState {
  const parsed = docsProjectStateSchema.safeParse(input);
  if (!parsed.success) {
    throw new DocsProjectStateError(
      "Invalid Forgewright project state.",
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      ),
    );
  }
  return parsed.data;
}

function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "root";
}

function inferredRoots(
  projectRoot: string,
): DocsProjectState["structure"]["roots"] {
  const candidates = readdirSync(projectRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== ".forgewright" &&
        !isSensitivePath(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const usedIds = new Set<string>();
  const roots = candidates.map((path) => {
    const baseId = slugify(path);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    return {
      id,
      path,
      kind: "directory",
      purpose: `Top-level ${path} directory.`,
      owner: "unassigned",
    };
  });

  if (roots.length > 0) return roots;
  return [
    {
      id: "project-root",
      path: ".",
      kind: "project",
      purpose: "Project root; no top-level directories were detected.",
      owner: "unassigned",
    },
  ];
}

export function createDefaultProjectState(
  projectRootInput: string,
): DocsProjectState {
  const projectRoot = canonicalProjectRoot(projectRootInput);
  const summary =
    "Documentation baseline only; roadmap, flows, and backlog are intentionally empty.";
  const updatedAt = new Date().toISOString();
  return {
    schema_version: DOCS_PROJECT_STATE_SCHEMA_VERSION,
    project: {
      summary,
      product_type: "other",
      lifecycle: "planning",
    },
    structure: {
      roots: inferredRoots(projectRoot),
      dependencies: [],
    },
    roadmap: [],
    flows: [],
    backlog: [],
    status: {
      lifecycle: "planning",
      health: "unknown",
      phase: "planning",
      summary,
      updated_at: updatedAt,
      blockers: [],
      risks: [],
      next_actions: [],
      next_update_at: null,
    },
  };
}

export interface ProjectStateLoadResult {
  state: DocsProjectState | null;
  path: string;
  contentHash: string | null;
  error: {
    code: "missing" | "invalid" | "containment";
    message: string;
  } | null;
}

export function safeLoadProjectState(
  projectRootInput: string,
  statePathInput: string,
): ProjectStateLoadResult {
  const path = statePathInput;
  if (!isProjectRelativePath(path)) {
    return {
      state: null,
      path,
      contentHash: null,
      error: {
        code: "containment",
        message: "Project state path must be project-relative and safe.",
      },
    };
  }

  let projectRoot: string;
  try {
    projectRoot = canonicalProjectRoot(projectRootInput);
  } catch (error) {
    return {
      state: null,
      path,
      contentHash: null,
      error: {
        code: "containment",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  let absolutePath: string;
  try {
    absolutePath = resolveWithinProject(projectRoot, path, { mustExist: true });
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    return {
      state: null,
      path,
      contentHash: null,
      error: {
        code: code === "PATH_NOT_FOUND" ? "missing" : "containment",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (!existsSync(absolutePath)) {
    return {
      state: null,
      path,
      contentHash: null,
      error: {
        code: "missing",
        message: `Project state does not exist: ${path}`,
      },
    };
  }

  try {
    let presentedPath = projectRoot;
    for (const segment of path.split("/")) {
      if (segment === ".") continue;
      presentedPath = join(presentedPath, segment);
      if (lstatSync(presentedPath).isSymbolicLink()) {
        return {
          state: null,
          path,
          contentHash: null,
          error: {
            code: "containment",
            message:
              "Project state path must not contain symbolic links; keep it as a regular project-owned file.",
          },
        };
      }
    }
  } catch (error) {
    return {
      state: null,
      path,
      contentHash: null,
      error: {
        code: "containment",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  try {
    const raw = readFileSync(absolutePath, "utf8");
    const contentHash = hashContent(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        state: null,
        path,
        contentHash,
        error: {
          code: "invalid",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    try {
      return {
        state: validateProjectState(parsed),
        path,
        contentHash,
        error: null,
      };
    } catch (error) {
      return {
        state: null,
        path,
        contentHash,
        error: {
          code: "invalid",
          message:
            error instanceof DocsProjectStateError
              ? [error.message, ...error.details].join(" ")
              : error instanceof Error
                ? error.message
                : String(error),
        },
      };
    }
  } catch (error) {
    return {
      state: null,
      path,
      contentHash: null,
      error: {
        code: "invalid",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export const loadProjectState = safeLoadProjectState;
