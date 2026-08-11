import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const DENIED_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".ssh",
  ".aws",
  ".gnupg",
  ".worktrees",
  "credentials",
  "credential",
  "secrets",
  "secret",
  "keystore",
  "node_modules",
]);

const DENIED_FORGEWRIGHT_SEGMENTS = new Set([
  "artifacts",
  "audit",
  "deliveries",
  "escalations",
  "execution",
  "goals",
  "logs",
  "memory-bank",
  "mcp-server",
  "runtime",
  "subagent-context",
  "telemetry",
  "verify",
]);

const ALLOWED_FORGEWRIGHT_FILES = new Set([
  ".forgewright/docs-manifest.json",
  ".forgewright/project-profile.json",
  ".forgewright/project.json",
  ".forgewright/code-conventions.md",
]);

const DENIED_BASENAME_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(?:^|[-_.])(secret|credentials?|private[-_.]?key)(?:[-_.]|$)/i,
  /\.(?:pem|key|p8|p12|jks|keystore)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
];

export class DocsPathError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DocsPathError";
    this.code = code;
  }
}

export function normalizeRelativePath(input: string): string {
  const normalized = input
    .normalize("NFC")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");

  if (
    normalized.length === 0 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new DocsPathError(
      "INVALID_RELATIVE_PATH",
      `Expected a non-empty relative path, received "${input}".`,
    );
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new DocsPathError(
      "PATH_TRAVERSAL",
      `Path traversal is not allowed: "${input}".`,
    );
  }

  return segments.filter((segment) => segment !== ".").join("/");
}

export function canonicalProjectRoot(input: string): string {
  const absolute = resolve(input);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new DocsPathError(
      "PROJECT_NOT_FOUND",
      `Project directory does not exist: ${absolute}`,
    );
  }
  return realpathSync(absolute);
}

export function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

export function resolveWithinProject(
  projectRoot: string,
  relativePath: string,
  options: { mustExist?: boolean } = {},
): string {
  const root = canonicalProjectRoot(projectRoot);
  const normalized = normalizeRelativePath(relativePath);
  const lexicalTarget = resolve(root, normalized);

  if (!isPathInside(root, lexicalTarget)) {
    throw new DocsPathError(
      "PATH_TRAVERSAL",
      `Path escapes project root: ${relativePath}`,
    );
  }

  if (!existsSync(lexicalTarget)) {
    if (options.mustExist) {
      throw new DocsPathError(
        "PATH_NOT_FOUND",
        `Path does not exist: ${relativePath}`,
      );
    }
    return lexicalTarget;
  }

  const resolvedTarget = realpathSync(lexicalTarget);
  if (!isPathInside(root, resolvedTarget)) {
    throw new DocsPathError(
      "SYMLINK_ESCAPE",
      `Resolved path escapes project root: ${relativePath}`,
    );
  }
  return resolvedTarget;
}

export function isSensitivePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";

  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))) {
    return true;
  }

  if (segments[0] === ".forgewright") {
    if (ALLOWED_FORGEWRIGHT_FILES.has(normalized.toLowerCase())) {
      return false;
    }
    if (segments.length > 1 && DENIED_FORGEWRIGHT_SEGMENTS.has(segments[1])) {
      return true;
    }
  }

  return DENIED_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

export function isSymlink(path: string): boolean {
  return existsSync(path) && lstatSync(path).isSymbolicLink();
}

export function matchesGlob(path: string, glob: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedGlob = glob.replace(/\\/g, "/").replace(/^\.\/+/, "");
  let pattern = "";

  for (let index = 0; index < normalizedGlob.length; index += 1) {
    const char = normalizedGlob[index];
    if (char === "*") {
      if (normalizedGlob[index + 1] === "*") {
        index += 1;
        if (normalizedGlob[index + 1] === "/") {
          index += 1;
          pattern += "(?:.*/)?";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }

  return new RegExp(`^${pattern}$`, "u").test(normalizedPath);
}

export function isAllowedByPrivacy(
  relativePath: string,
  allow: string[],
  exclude: string[],
): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (isSensitivePath(normalized)) {
    return false;
  }

  const excluded = exclude.some((pattern) => {
    const normalizedPattern = normalizeRelativePath(pattern);
    return (
      normalized === normalizedPattern ||
      normalized.startsWith(`${normalizedPattern}/`) ||
      matchesGlob(normalized, normalizedPattern)
    );
  });
  if (excluded) {
    return false;
  }

  return allow.some((entry) => {
    const normalizedEntry = normalizeRelativePath(entry);
    return (
      normalized === normalizedEntry ||
      normalized.startsWith(`${normalizedEntry}/`) ||
      matchesGlob(normalized, normalizedEntry)
    );
  });
}
