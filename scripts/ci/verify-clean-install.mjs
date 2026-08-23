#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const snapshot = mkdtempSync(join(tmpdir(), "forgewright-clean-install-"));
const excluded = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  ".forgewright",
  ".DS_Store",
]);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function copy(relativePath) {
  const source = join(root, relativePath);
  const destination = join(snapshot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !excluded.has(basename(path)),
  });
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: snapshot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  for (const path of [
    "package.json",
    "package-lock.json",
    "mcp",
    "src/cli",
    "tests/golden",
    "docs/guides/forge-init-onboard.md",
  ]) {
    copy(path);
  }

  run("git", ["init", "--quiet"]);
  run(npm, ["ci", "--no-audit", "--no-fund"]);
  run(npm, ["--prefix", "mcp", "run", "build"]);
  run(npm, ["--prefix", "src/cli", "run", "typecheck"]);
  run(npm, ["--prefix", "src/cli", "run", "build"]);
  run("node", ["tests/golden/forge-init-onboard.test.mjs"]);

  const required = [
    "mcp/build/index.js",
    "src/cli/dist/index.js",
    "src/cli/dist/index.d.ts",
  ];
  for (const path of required) {
    if (!existsSync(join(snapshot, path))) {
      throw new Error(`clean install build is missing ${path}`);
    }
  }

  console.log("clean install: npm ci PASS");
  console.log("clean build: MCP build + CLI typecheck/build PASS");
  console.log("clean golden path: forge init/onboard PASS");
  console.log("clean install evidence: PASS");
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
