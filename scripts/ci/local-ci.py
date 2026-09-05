#!/usr/bin/env python3
"""Provider-neutral local CI control plane for Forgewright.

Hosted CI systems are optional adapters. This runner is the canonical execution
surface for quality, security, compatibility, review, indexing, and wiki gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = ROOT / ".forgewright" / "reports" / "local-ci"
LOCAL_VENV = ROOT / ".forgewright" / "local-ci-venv"
MIN_NODE_MAJOR = 22
NODE_MATRIX = (22, 24)
# The Python suite includes roadmap verifier tests whose declared subprocess
# budgets can legitimately exceed 15 minutes in aggregate on local machines.
# This is a runner budget only; it does not weaken, skip, or alter any test oracle.
PRECOMMIT_PYTHON_UNIT_TIMEOUT_SECONDS = 1800
# Test fixtures own their repositories. In particular, a partial commit's
# absolute temporary index must never leak into a fixture's git commands.
TEST_GIT_ENV: dict[str, str | None] = dict.fromkeys(
    (
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_PREFIX",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    )
)


class GateFailure(RuntimeError):
    pass


@dataclass
class StepResult:
    name: str
    argv: list[str]
    cwd: str
    exit_code: int | None
    duration_ms: int
    status: str
    note: str = ""


def _which(name: str) -> str | None:
    candidates = [name]
    if os.name == "nt" and not name.endswith(".exe"):
        candidates.extend([f"{name}.cmd", f"{name}.exe"])
    for candidate in candidates:
        found = shutil.which(candidate)
        if found:
            return found
    return None


def _first_existing(*paths: Path) -> Path | None:
    return next((path for path in paths if path.is_file()), None)


def _discover_bash() -> str | None:
    found = _which("bash")
    if found or os.name != "nt":
        return found

    candidates: list[Path] = []
    for env_name in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
        base = os.environ.get(env_name, "").strip()
        if base:
            git_root = Path(base) / "Git"
            candidates.extend(
                (git_root / "bin" / "bash.exe", git_root / "usr" / "bin" / "bash.exe")
            )

    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        git_root = Path(local_app_data) / "Programs" / "Git"
        candidates.extend(
            (git_root / "bin" / "bash.exe", git_root / "usr" / "bin" / "bash.exe")
        )

    git_binary = _which("git")
    if git_binary:
        git_parent = Path(git_binary).resolve().parent
        if git_parent.name.lower() in {"cmd", "bin"}:
            git_root = git_parent.parent
            candidates.extend(
                (git_root / "bin" / "bash.exe", git_root / "usr" / "bin" / "bash.exe")
            )

    for candidate in dict.fromkeys(candidates):
        if candidate.is_file():
            return str(candidate)
    return None


class LocalCI:
    def __init__(
        self, *, dry_run: bool, keep_going: bool, timeout: int, base_ref: str | None
    ):
        self.dry_run = dry_run
        self.keep_going = keep_going
        self.timeout = timeout
        self.base_ref = base_ref
        self.results: list[StepResult] = []
        self.started_at = time.monotonic()
        self.started_wall = datetime.now(timezone.utc)
        self.failed = False
        self.primary_node: str | None = None
        venv_python = LOCAL_VENV / (
            "Scripts/python.exe" if os.name == "nt" else "bin/python"
        )
        self.python = str(venv_python) if venv_python.is_file() else sys.executable

    def run(
        self,
        name: str,
        argv: Sequence[str | Path],
        *,
        cwd: Path = ROOT,
        check: bool = True,
        timeout: int | None = None,
        env: dict[str, str | None] | None = None,
    ) -> int:
        args = [str(item) for item in argv]
        print(f"\n==> local-ci: {name}")
        print("    " + " ".join(args))
        if self.dry_run:
            self.results.append(StepResult(name, args, str(cwd), None, 0, "dry-run"))
            return 0
        started = time.monotonic()
        process = subprocess.Popen(
            args,
            cwd=cwd,
            env=self._effective_env(env),
            start_new_session=os.name != "nt",
            creationflags=(
                subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
            ),
        )
        try:
            code = int(process.wait(timeout=timeout or self.timeout))
            note = ""
        except subprocess.TimeoutExpired:
            note = "timeout; process tree terminated"
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=3)
                except ProcessLookupError:
                    pass
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        pass
            code = 124
        duration_ms = int((time.monotonic() - started) * 1000)
        status = "pass" if code == 0 else "fail"
        self.results.append(
            StepResult(name, args, str(cwd), code, duration_ms, status, note)
        )
        if check and code != 0:
            self.failed = True
            message = f"{name} failed with exit code {code}"
            if self.keep_going:
                print(f"[local-ci] WARN: {message}", file=sys.stderr)
            else:
                raise GateFailure(message)
        return code

    def _effective_env(
        self, overrides: dict[str, str | None] | None = None
    ) -> dict[str, str]:
        env = os.environ.copy()
        path_parts: list[str] = []

        def add_path(path: str) -> None:
            if path not in path_parts:
                path_parts.append(path)

        # Keep the venv's own bin/Scripts directory on PATH. Resolving the
        # interpreter symlink first can jump to the base Homebrew/Python install,
        # causing nested verifier scripts that invoke `python3` to escape the
        # prepared local-CI environment and miss dependencies such as ruff.
        python_dir = str(Path(self.python).parent.absolute())
        add_path(python_dir)
        if self.primary_node:
            node_dir = str(Path(self.primary_node).resolve().parent)
            add_path(node_dir)
            env["FORGEWRIGHT_EFFECTIVE_NODE_BIN"] = self.primary_node
        for component in ("root", "mcp", "cli"):
            for node_modules in self._node_modules_roots(component):
                bin_dir = node_modules / ".bin"
                if bin_dir.is_dir():
                    add_path(str(bin_dir))
        if os.name == "nt":
            # Child verifiers also invoke bash by name. Expose the resolved
            # Git Bash only in this invocation's environment, never globally.
            add_path(str(Path(self.bash).parent))
        env["PATH"] = os.pathsep.join(path_parts + [env.get("PATH", "")])
        if overrides:
            for key, value in overrides.items():
                if value is None:
                    env.pop(key, None)
                else:
                    env[key] = value
        return env

    def capture(
        self,
        argv: Sequence[str | Path],
        *,
        cwd: Path = ROOT,
        timeout: int = 30,
        effective_env: bool = True,
    ) -> str:
        completed = subprocess.run(
            [str(item) for item in argv],
            cwd=cwd,
            env=self._effective_env() if effective_env else os.environ.copy(),
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        if completed.returncode != 0:
            raise GateFailure(
                (completed.stderr or completed.stdout).strip() or "command failed"
            )
        return completed.stdout.strip()

    def _node_sibling_tool(self, name: str) -> str | None:
        if not self.primary_node:
            return None
        directory = Path(self.primary_node).resolve().parent
        candidates = [directory / name]
        if os.name == "nt":
            candidates = [
                directory / f"{name}.cmd",
                directory / f"{name}.exe",
                *candidates,
            ]
        return next((str(path) for path in candidates if path.exists()), None)

    @property
    def npm(self) -> str:
        return self._node_sibling_tool("npm") or _which("npm") or "npm"

    @property
    def npx(self) -> str:
        return self._node_sibling_tool("npx") or _which("npx") or "npx"

    @property
    def node(self) -> str:
        return self.primary_node or _which("node") or "node"

    def _node_modules_roots(self, component: str) -> list[Path]:
        env_names = {
            "root": "FORGEWRIGHT_ROOT_NODE_MODULES",
            "mcp": "FORGEWRIGHT_MCP_NODE_MODULES",
            "cli": "FORGEWRIGHT_CLI_NODE_MODULES",
        }
        configured = os.environ.get(env_names[component], "").strip()
        roots: list[Path] = []
        if configured:
            roots.append(Path(configured).expanduser().resolve())
        if component == "mcp":
            roots.append(ROOT / "mcp" / "node_modules")
        elif component == "cli":
            roots.append(ROOT / "src" / "cli" / "node_modules")
        roots.append(ROOT / "node_modules")
        return list(dict.fromkeys(roots))

    def _node_bin(self, component: str, name: str) -> str | None:
        suffixes = [name]
        if os.name == "nt":
            suffixes = [f"{name}.cmd", f"{name}.exe", name]
        for root in self._node_modules_roots(component):
            for suffix in suffixes:
                candidate = root / ".bin" / suffix
                if candidate.is_file():
                    return str(candidate)
        return None

    def _node_module_file(self, component: str, relative: str) -> Path | None:
        for root in self._node_modules_roots(component):
            candidate = root / relative
            if candidate.is_file():
                return candidate
        return None

    @property
    def bash(self) -> str:
        configured = os.environ.get("FORGEWRIGHT_BASH", "").strip()
        if configured:
            return configured
        found = _discover_bash()
        if not found:
            raise GateFailure(
                "bash is required by current Forgewright shell gates. On Windows install Git Bash/WSL "
                "or set FORGEWRIGHT_BASH to a compatible bash executable."
            )
        return found

    @property
    def gitnexus(self) -> list[str]:
        binary = _which("gitnexus")
        if binary:
            return [binary]
        launcher = ROOT / ".gitnexus" / "run.cjs"
        if launcher.is_file():
            return [self.node, str(launcher)]
        raise GateFailure(
            "GitNexus is unavailable: install gitnexus or generate .gitnexus/run.cjs"
        )

    def _raw_node_major(self, binary: str) -> int:
        output = self.capture(
            [binary, "-p", "process.versions.node.split('.')[0]"],
            effective_env=False,
        )
        return int(output)

    def _candidate_node_paths(self, major: int) -> list[Path]:
        candidates = [
            Path(f"/opt/homebrew/opt/node@{major}/bin/node"),
            Path(f"/usr/local/opt/node@{major}/bin/node"),
        ]
        candidates.extend(
            sorted(
                (Path.home() / ".nvm" / "versions" / "node").glob(f"v{major}*/bin/node")
            )
        )
        candidates.extend(
            sorted(
                (Path.home() / ".local" / "share" / "fnm" / "node-versions").glob(
                    f"v{major}*/installation/bin/node"
                )
            )
        )
        candidates.extend(
            sorted(
                (Path.home() / ".volta" / "tools" / "image" / "node").glob(
                    f"{major}*/bin/node"
                )
            )
        )
        if os.name == "nt":
            appdata_raw = os.environ.get("APPDATA", "").strip()
            if appdata_raw:
                candidates.extend(
                    sorted(Path(appdata_raw).glob(f"nvm/v{major}*/node.exe"))
                )
        return candidates

    def _resolve_node_runtime(self, major: int) -> str:
        env_name = f"FORGEWRIGHT_NODE{major}_BIN"
        configured = os.environ.get(env_name, "").strip()
        if configured:
            path = Path(configured).expanduser().resolve()
            if path.is_file() and self._raw_node_major(str(path)) == major:
                return str(path)
            raise GateFailure(
                f"{env_name} must point to a Node {major} executable: {path}"
            )

        current = _which("node")
        if current and self._raw_node_major(current) == major:
            return current

        for candidate in self._candidate_node_paths(major):
            if not candidate.is_file():
                continue
            try:
                if self._raw_node_major(str(candidate)) == major:
                    return str(candidate.resolve())
            except GateFailure:
                continue

        npx = _which("npx")
        if not npx:
            raise GateFailure(
                f"Node {major} is unavailable. Install it locally or set {env_name}."
            )
        resolved = self.capture(
            [npx, "--yes", f"node@{major}", "-p", "process.execPath"],
            timeout=120,
            effective_env=False,
        )
        path = Path(resolved).expanduser().resolve()
        if not path.is_file() or self._raw_node_major(str(path)) != major:
            raise GateFailure(f"could not resolve a valid Node {major} runtime")
        return str(path)

    def _resolve_primary_node(self) -> str:
        configured = os.environ.get("FORGEWRIGHT_NODE_BIN", "").strip()
        if configured:
            path = Path(configured).expanduser().resolve()
            if not path.is_file():
                raise GateFailure(
                    f"FORGEWRIGHT_NODE_BIN points to a missing file: {path}"
                )
            if self._raw_node_major(str(path)) < MIN_NODE_MAJOR:
                raise GateFailure(
                    f"FORGEWRIGHT_NODE_BIN must be Node >= {MIN_NODE_MAJOR}"
                )
            return str(path)

        current = _which("node")
        if current:
            current_major = self._raw_node_major(current)
            if current_major in NODE_MATRIX:
                return current

        try:
            return self._resolve_node_runtime(24)
        except GateFailure:
            if current and self._raw_node_major(current) >= MIN_NODE_MAJOR:
                return current
            raise

    def preflight(self) -> None:
        if sys.version_info < (3, 11):
            raise GateFailure(
                f"Python >= 3.11 is required; found {platform.python_version()}"
            )
        for executable in ("git", "npm", "npx"):
            if not _which(executable):
                raise GateFailure(f"required executable is missing: {executable}")
        _ = self.bash
        self.primary_node = self._resolve_primary_node()
        effective_major = self._raw_node_major(self.primary_node)
        print(
            f"[local-ci] preflight PASS: node={effective_major} ({self.primary_node}), "
            f"python={platform.python_version()}, os={platform.system()}"
        )

    def bootstrap(self) -> None:
        self.run(
            "node-dependencies",
            [
                self.npm,
                "ci",
                "--prefer-offline",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ],
            timeout=1800,
        )
        venv_python = LOCAL_VENV / (
            "Scripts/python.exe" if os.name == "nt" else "bin/python"
        )
        if not venv_python.is_file():
            self.run("python-venv", [sys.executable, "-m", "venv", str(LOCAL_VENV)])
        self.python = str(venv_python)
        self.run(
            "python-verification-dependencies",
            [
                self.python,
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "-r",
                "requirements-ci.txt",
            ],
            timeout=900,
        )
        self.run("local-git-hooks", ["git", "config", "core.hooksPath", ".husky"])

    def _require_node_dependencies(self) -> None:
        if self.dry_run:
            return
        required = (
            ("mcp", "vitest"),
            ("mcp", "tsc"),
            ("mcp", "eslint"),
            ("mcp", "prettier"),
            ("cli", "vitest"),
            ("cli", "tsc"),
            ("cli", "prettier"),
        )
        missing = [
            f"{component}:{name}"
            for component, name in required
            if not self._node_bin(component, name)
        ]
        if missing:
            raise GateFailure(
                "local Node dependencies are missing "
                f"({', '.join(missing)}); run `npm run ci:bootstrap` first"
            )

    def _require_python_dependencies(self, *modules: str) -> None:
        if self.dry_run:
            return
        code = "import " + ", ".join(modules)
        try:
            self.capture([self.python, "-c", code], timeout=20)
        except GateFailure as error:
            raise GateFailure(
                "local Python verification dependencies are missing; run `npm run ci:bootstrap` first"
            ) from error

    def doctor(self) -> None:
        mcp_ready = bool(
            self._node_bin("mcp", "vitest") and self._node_bin("mcp", "tsc")
        )
        cli_ready = bool(
            self._node_bin("cli", "vitest") and self._node_bin("cli", "tsc")
        )
        try:
            self.capture([self.python, "-c", "import pytest,mcp,yaml"], timeout=20)
            python_ready = True
        except GateFailure:
            python_ready = False

        cache = ROOT / ".forgewright" / "cache"
        markers = [
            name
            for name in ("reindex-needed", "wiki-sync-needed", "mcp-sync-needed")
            if (cache / name).exists()
        ]
        try:
            hook_path = self.capture(["git", "config", "--get", "core.hooksPath"])
        except GateFailure:
            hook_path = ""
        hooks_ready = hook_path == ".husky"
        ready = all((mcp_ready, cli_ready, python_ready, hooks_ready))
        print(
            "[local-ci] tooling: "
            f"mcp={'ready' if mcp_ready else 'missing'} "
            f"cli={'ready' if cli_ready else 'missing'} "
            f"python={'ready' if python_ready else 'missing'} "
            f"hooks={'ready' if hooks_ready else 'misconfigured'}"
        )
        print(f"[local-ci] bootstrap_required={'no' if ready else 'yes'}")
        print(
            f"[local-ci] maintenance_markers={','.join(markers) if markers else 'none'}"
        )

    def quick(self) -> None:
        self.run("product-truth", [self.python, "scripts/ci/verify-product-truth.py"])
        self.run(
            "adversarial-weak-model-rails",
            [self.python, "evals/adversarial-weak-model/run-evals.py", "--self-test"],
        )
        self.run("lite-overlays", [self.python, "scripts/lite/validate-overlays.py"])
        self.run(
            "kernel-token-budget", [self.bash, "scripts/lite/test-kernel-tokens.sh"]
        )
        self.run("git-diff-check", ["git", "diff", "--check"])

    def _working_tree_fingerprint(self) -> str:
        hasher = hashlib.sha256()
        for argv in (
            ["git", "status", "--porcelain=v1", "-z"],
            ["git", "diff", "--binary", "HEAD"],
        ):
            completed = subprocess.run(
                argv,
                cwd=ROOT,
                env=self._effective_env(),
                capture_output=True,
                check=False,
            )
            if completed.returncode != 0:
                raise GateFailure(f"workspace fingerprint failed: {' '.join(argv)}")
            hasher.update(completed.stdout)
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard", "-z"],
            cwd=ROOT,
            env=self._effective_env(),
            capture_output=True,
            check=False,
        )
        if untracked.returncode != 0:
            raise GateFailure(
                "workspace fingerprint failed while listing untracked files"
            )
        for raw in filter(None, untracked.stdout.split(b"\0")):
            path = ROOT / raw.decode("utf-8", errors="surrogateescape")
            hasher.update(raw)
            if path.is_file():
                with path.open("rb") as handle:
                    while chunk := handle.read(1024 * 1024):
                        hasher.update(chunk)
        return hasher.hexdigest()

    def full(self) -> None:
        self._require_node_dependencies()
        self._require_python_dependencies("pytest", "mcp", "yaml")
        before = self._working_tree_fingerprint() if not self.dry_run else "dry-run"
        self.run(
            "required-repository-checks",
            [self.bash, "scripts/ci/run-required-checks.sh"],
            timeout=1800,
        )
        self.run(
            "skill-contracts",
            [
                self.bash,
                "scripts/testing/test-runner.sh",
                "--all",
                "--contract-only",
                "--no-color",
            ],
            timeout=900,
        )
        self.run("lite-overlays", [self.python, "scripts/lite/validate-overlays.py"])
        self.run(
            "kernel-token-budget", [self.bash, "scripts/lite/test-kernel-tokens.sh"]
        )
        if not self.dry_run:
            after = self._working_tree_fingerprint()
            status = "pass" if after == before else "fail"
            self.results.append(
                StepResult(
                    "generated-drift",
                    ["workspace-fingerprint"],
                    str(ROOT),
                    0 if status == "pass" else 1,
                    0,
                    status,
                )
            )
            if after != before:
                self.failed = True
                raise GateFailure("verification generated unexpected workspace drift")

    def security(self) -> None:
        self.run(
            "root-production-audit",
            [
                self.npm,
                "audit",
                "--package-lock-only",
                "--omit=dev",
                "--audit-level=high",
            ],
        )
        self.run(
            "standalone-mcp-production-audit",
            [
                self.npm,
                "--prefix",
                "mcp",
                "audit",
                "--package-lock-only",
                "--omit=dev",
                "--workspaces=false",
                "--audit-level=high",
            ],
        )
        self.run(
            "local-automation-policy",
            [self.python, "scripts/ci/verify-local-automation-policy.py"],
        )
        staged = self.capture(["git", "diff", "--cached", "--name-only"])
        if staged:
            self.run(
                "staged-secret-and-commit-policy",
                [self.bash, "scripts/ci/validate-commit.sh", "--staged"],
            )

    def _node_runtime(self, major: int) -> str:
        if self.primary_node and self._raw_node_major(self.primary_node) == major:
            return self.primary_node
        return self._resolve_node_runtime(major)

    def compatibility(self) -> None:
        self._require_node_dependencies()
        self.run("mcp-build", [self.npm, "--prefix", "mcp", "run", "build"])
        self.run("cli-typecheck", [self.npm, "run", "typecheck:cli"])
        self.run("cli-build", [self.npm, "run", "build:cli"])
        if self.dry_run:
            mcp_vitest = ROOT / "mcp" / "node_modules" / "vitest" / "vitest.mjs"
            cli_vitest = ROOT / "src" / "cli" / "node_modules" / "vitest" / "vitest.mjs"
            cli_entry = ROOT / "src" / "cli" / "dist" / "index.js"
        else:
            mcp_vitest = self._node_module_file("mcp", "vitest/vitest.mjs")
            cli_vitest = self._node_module_file("cli", "vitest/vitest.mjs")
            cli_entry = ROOT / "src" / "cli" / "dist" / "index.js"
            if not mcp_vitest or not cli_vitest or not cli_entry.is_file():
                raise GateFailure(
                    "compatibility matrix requires installed dependencies and a built CLI artifact"
                )
        for major in NODE_MATRIX:
            runtime = f"<node-{major}>" if self.dry_run else self._node_runtime(major)
            self.run(
                f"node{major}-mcp-tests",
                [runtime, mcp_vitest, "run", "--reporter=basic"],
                cwd=ROOT / "mcp",
            )
            self.run(
                f"node{major}-cli-tests",
                [runtime, cli_vitest, "run"],
                cwd=ROOT / "src" / "cli",
            )
            self.run(f"node{major}-cli-smoke", [runtime, cli_entry, "--version"])

    def _has_worktree_changes(self) -> bool:
        return bool(self.capture(["git", "status", "--porcelain=v1"]))

    def review(self) -> None:
        staged = bool(self.capture(["git", "diff", "--cached", "--name-only"]))
        if staged:
            scope = "staged"
            extra: list[str] = []
        elif self._has_worktree_changes():
            scope = "all"
            extra = []
        else:
            scope = "compare"
            base = self.base_ref or "HEAD~1"
            extra = ["--base-ref", base]
        self.run(
            "gitnexus-change-impact",
            [
                *self.gitnexus,
                "detect-changes",
                "--scope",
                scope,
                *extra,
                "--repo",
                str(ROOT),
                "--limit",
                "200",
            ],
        )
        openapi_base = self.base_ref or (
            "HEAD" if scope in {"staged", "all"} else "HEAD~1"
        )
        self.run(
            "openapi-contract-check",
            [
                self.python,
                "scripts/ci/openapi-contract-check.py",
                "--base-ref",
                openapi_base,
            ],
        )
        self.run("git-diff-check", ["git", "diff", "--check"])
        if staged:
            self.run(
                "staged-change-policy",
                [self.bash, "scripts/ci/validate-commit.sh", "--staged"],
            )

    def reindex(self, *, force: bool) -> None:
        argv = [*self.gitnexus, "analyze", str(ROOT), "--index-only"]
        if force:
            argv.append("--force")
        self.run("gitnexus-local-index", argv, timeout=900)
        if not self.dry_run:
            (ROOT / ".forgewright" / "cache" / "reindex-needed").unlink(missing_ok=True)

    def wiki(self, *, reindex: bool, generate: bool = False) -> None:
        if reindex:
            self.reindex(force=False)
        sequence = ROOT / "scripts" / "utilities" / "generate-sequence.ts"
        if sequence.is_file():
            tsx = self._node_bin("mcp", "tsx")
            if not tsx:
                raise GateFailure("tsx is missing; run `npm run ci:bootstrap` first")
            self.run("sequence-docs", [tsx, str(sequence)])
        if generate:
            provider = os.environ.get("FORGEWRIGHT_WIKI_PROVIDER", "").strip()
            model = os.environ.get("FORGEWRIGHT_WIKI_MODEL", "").strip()
            if not provider or not model:
                raise GateFailure(
                    "wiki generation requires FORGEWRIGHT_WIKI_PROVIDER and FORGEWRIGHT_WIKI_MODEL"
                )
            self.run(
                "gitnexus-wiki-generate",
                [
                    *self.gitnexus,
                    "wiki",
                    str(ROOT),
                    "--provider",
                    provider,
                    "--model",
                    model,
                ],
                timeout=1800,
            )
        self.run(
            "wiki-drift",
            [self.bash, "scripts/ci/verify-wiki-drift.sh", "--threshold", "0.3"],
        )
        if not self.dry_run:
            (ROOT / ".forgewright" / "cache" / "wiki-sync-needed").unlink(
                missing_ok=True
            )

    def dependencies(self, *, fix: bool) -> None:
        if fix:
            self.run(
                "root-audit-fix",
                [
                    self.npm,
                    "audit",
                    "fix",
                    "--package-lock-only",
                    "--omit=dev",
                    "--ignore-scripts",
                    "--no-fund",
                ],
            )
            self.run(
                "standalone-mcp-audit-fix",
                [
                    self.npm,
                    "--prefix",
                    "mcp",
                    "audit",
                    "fix",
                    "--package-lock-only",
                    "--omit=dev",
                    "--workspaces=false",
                    "--ignore-scripts",
                    "--no-fund",
                ],
            )
        self.security()
        self.run("dependency-outdated-report", [self.npm, "outdated"], check=False)

    def _staged_files(self) -> list[Path]:
        raw = self.capture(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
        )
        return [
            ROOT / item for item in raw.split("\0") if item and (ROOT / item).is_file()
        ]

    def _format_staged(self) -> None:
        staged = self._staged_files()
        if not staged:
            return
        python_files = [path for path in staged if path.suffix == ".py"]
        mcp_ts = [
            path
            for path in staged
            if path.suffix == ".ts" and (ROOT / "mcp" / "src") in path.parents
        ]
        cli_ts = [
            path
            for path in staged
            if path.suffix == ".ts" and (ROOT / "src" / "cli") in path.parents
        ]
        shell_files = [
            path
            for path in staged
            if path.suffix == ".sh" and (ROOT / "scripts") in path.parents
        ]
        touched: list[Path] = []
        if python_files:
            self.run(
                "ruff-staged-check",
                [self.python, "-m", "ruff", "check", "--fix", *python_files],
            )
            self.run(
                "ruff-staged-format",
                [self.python, "-m", "ruff", "format", *python_files],
            )
            touched.extend(python_files)
        if mcp_ts:
            eslint = self._node_bin("mcp", "eslint")
            prettier = self._node_bin("mcp", "prettier")
            assert eslint and prettier
            # Match npm --prefix mcp run lint: flat ESLint configuration is
            # discovered from the component cwd, not the repository root.
            self.run("mcp-eslint-staged", [eslint, "--fix", *mcp_ts], cwd=ROOT / "mcp")
            self.run(
                "mcp-prettier-staged", [prettier, "--write", *mcp_ts], cwd=ROOT / "mcp"
            )
            touched.extend(mcp_ts)
        if cli_ts:
            prettier = self._node_bin("cli", "prettier")
            assert prettier
            self.run(
                "cli-prettier-staged",
                [prettier, "--write", *cli_ts],
                cwd=ROOT / "src" / "cli",
            )
            touched.extend(cli_ts)
        if shell_files:
            shellcheck = _which("shellcheck")
            if not shellcheck:
                raise GateFailure("shellcheck is required for staged shell scripts")
            excludes = (
                "SC2296,SC2034,SC2155,SC2329,SC2005,SC2206,SC2221,SC2222,SC2030,"
                "SC2031,SC2295,SC2148,SC1037,SC2012,SC2016,SC2001,SC2086,SC2115,"
                "SC2126,SC2064,SC2015,SC2162,SC2207,SC2129,SC2038,SC2116,SC2044,"
                "SC2059,SC2120,SC2119,SC2216,SC2320,SC2181,SC2178,SC2128,SC2164"
            )
            self.run("shellcheck-staged", [shellcheck, "-e", excludes, *shell_files])
        if touched:
            relative = [path.relative_to(ROOT) for path in dict.fromkeys(touched)]
            self.run("restage-formatted-files", ["git", "add", "--", *relative])
        self.run("staged-diff-check", ["git", "diff", "--cached", "--check"])

    def precommit(self) -> None:
        self._require_node_dependencies()
        self._require_python_dependencies("pytest", "mcp", "yaml", "ruff")
        self.run(
            "wiki-drift",
            [self.bash, "scripts/ci/verify-wiki-drift.sh", "--threshold", "0.3"],
        )
        self.review()
        self._format_staged()
        mcp_tsc = self._node_bin("mcp", "tsc")
        cli_tsc = self._node_bin("cli", "tsc")
        mcp_vitest = self._node_module_file("mcp", "vitest/vitest.mjs")
        cli_vitest = self._node_module_file("cli", "vitest/vitest.mjs")
        assert mcp_tsc and cli_tsc and mcp_vitest and cli_vitest
        self.run("mcp-typecheck", [mcp_tsc, "--noEmit"], cwd=ROOT / "mcp")
        self.run("cli-typecheck", [cli_tsc, "--noEmit"], cwd=ROOT / "src" / "cli")
        self.run("cli-build", [self.npm, "run", "build:cli"])
        self.run(
            "docs-continuity",
            [
                self.node,
                "src/cli/dist/index.js",
                "docs",
                "gate",
                ".",
                "--staged",
                "--json",
            ],
        )
        self.run(
            "mcp-tests",
            [self.node, mcp_vitest, "run", "--reporter=basic"],
            cwd=ROOT / "mcp",
            env=TEST_GIT_ENV,
        )
        self.run(
            "cli-tests",
            [self.node, cli_vitest, "run"],
            cwd=ROOT / "src" / "cli",
            env=TEST_GIT_ENV,
        )
        self.run(
            "python-unit-tests",
            [
                self.python,
                "-m",
                "pytest",
                "-p",
                "no:cacheprovider",
                "tests/unit_tests/",
            ],
            timeout=PRECOMMIT_PYTHON_UNIT_TIMEOUT_SECONDS,
            env=TEST_GIT_ENV,
        )

    def commit_message(self, message_file: str) -> None:
        commitlint = self._node_bin("mcp", "commitlint")
        if not commitlint:
            raise GateFailure("commitlint is missing; run `npm run ci:bootstrap` first")
        message_path = Path(message_file)
        if not message_path.is_absolute():
            message_path = (ROOT / message_path).resolve()
        self.run(
            "commit-message",
            [commitlint, "--edit", message_path],
            cwd=ROOT / "mcp",
        )

    def all(self) -> None:
        self.full()
        self.compatibility()
        self.review()
        self.wiki(reindex=False)

    def write_report(self, mode: str) -> Path:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        effective_node = ""
        if self.primary_node:
            try:
                effective_node = self.capture(
                    [self.primary_node, "-p", "process.versions.node"],
                    effective_env=False,
                )
            except GateFailure:
                effective_node = "unavailable"
        try:
            head = self.capture(["git", "rev-parse", "HEAD"])
            branch = self.capture(["git", "rev-parse", "--abbrev-ref", "HEAD"])
        except GateFailure:
            head = ""
            branch = ""
        payload = {
            "schema": "forgewright-local-ci/v1",
            "mode": mode,
            "status": "fail" if self.failed else "pass",
            "dryRun": self.dry_run,
            "startedAt": self.started_wall.isoformat(),
            "durationMs": int((time.monotonic() - self.started_at) * 1000),
            "host": {
                "os": platform.system(),
                "python": platform.python_version(),
                "node": effective_node,
                "nodeBinary": self.primary_node or "",
            },
            "repository": {"head": head, "branch": branch},
            "steps": [asdict(item) for item in self.results],
        }
        timestamped = REPORT_DIR / now.strftime("%Y%m%dT%H%M%SZ.json")
        timestamped.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        (REPORT_DIR / "latest.json").write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )
        return timestamped


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Forgewright provider-neutral local CI"
    )
    result.add_argument(
        "mode",
        choices=(
            "doctor",
            "bootstrap",
            "quick",
            "full",
            "security",
            "compat",
            "review",
            "reindex",
            "wiki",
            "deps",
            "precommit",
            "commitmsg",
            "all",
        ),
    )
    result.add_argument("--dry-run", action="store_true")
    result.add_argument(
        "--no-preflight",
        action="store_true",
        help="Testing/planning only; do not use for a real gate",
    )
    result.add_argument("--keep-going", action="store_true")
    result.add_argument("--timeout", type=int, default=600)
    result.add_argument("--base-ref")
    result.add_argument("--message-file")
    result.add_argument(
        "--force", action="store_true", help="Force reindex when mode=reindex"
    )
    result.add_argument(
        "--fix",
        action="store_true",
        help="Apply non-major audit lock fixes when mode=deps",
    )
    result.add_argument(
        "--generate-wiki",
        action="store_true",
        help="Generate local GitNexus wiki when mode=wiki",
    )
    return result


def main() -> int:
    args = parser().parse_args()
    runner = LocalCI(
        dry_run=args.dry_run,
        keep_going=args.keep_going,
        timeout=args.timeout,
        base_ref=args.base_ref,
    )
    try:
        if not args.no_preflight:
            runner.preflight()
        if args.mode == "doctor":
            runner.doctor()
        elif args.mode == "bootstrap":
            runner.bootstrap()
        elif args.mode == "quick":
            runner.quick()
        elif args.mode == "full":
            runner.full()
        elif args.mode == "security":
            runner.security()
        elif args.mode == "compat":
            runner.compatibility()
        elif args.mode == "review":
            runner.review()
        elif args.mode == "reindex":
            runner.reindex(force=args.force)
        elif args.mode == "wiki":
            runner.wiki(reindex=True, generate=args.generate_wiki)
        elif args.mode == "deps":
            runner.dependencies(fix=args.fix)
        elif args.mode == "precommit":
            runner.precommit()
        elif args.mode == "commitmsg":
            if not args.message_file:
                raise GateFailure("commitmsg mode requires --message-file")
            runner.commit_message(args.message_file)
        elif args.mode == "all":
            runner.all()
    except (GateFailure, FileNotFoundError, ValueError) as error:
        runner.failed = True
        print(f"[local-ci] FAIL: {error}", file=sys.stderr)
    report = runner.write_report(args.mode)
    print(f"\n[local-ci] report: {report.relative_to(ROOT)}")
    return 1 if runner.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
