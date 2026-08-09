#!/usr/bin/env python3
"""Adversarial weak-model evaluation harness for Forgewright.

The deterministic replay modes validate the grader itself. Only --live produces
empirical model evidence. The harness grades observable workspace diffs,
verification command exits, and bounded stdout contracts; it never grades hidden
reasoning.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import inspect
import json
import os
import re
import shutil
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

REPORT_SCHEMA_VERSION = 2
LIVE_HARNESS_SEMANTICS_VERSION = "agy-isolated-least-privilege-v2"
SUITE_FILE = Path(__file__).with_name("suite.json")
REPO_ROOT = Path(__file__).resolve().parents[2]
ORCHESTRATOR = REPO_ROOT / "scripts" / "runtime" / "forgewright-orchestrator.py"
EXECUTION_POLICY = REPO_ROOT / ".forgewright" / "execution-policy.yaml"


class EvalError(ValueError):
    pass


def _canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_suite(path: Path = SUITE_FILE) -> dict[str, Any]:
    suite = json.loads(path.read_text(encoding="utf-8"))
    validate_suite(suite)
    return suite


def _suite_fingerprint(suite: dict[str, Any]) -> str:
    """Fingerprint task definitions and every checked-in fixture byte."""
    fixture_hashes: dict[str, str] = {}
    base = Path(__file__).parent
    for task in suite["tasks"]:
        source = base / task["workspace"]
        if not source.is_dir():
            raise EvalError(f"task {task['id']}: fixture missing: {source}")
        for path in sorted(p for p in source.rglob("*") if p.is_file()):
            key = f"{task['id']}/{path.relative_to(source).as_posix()}"
            fixture_hashes[key] = hashlib.sha256(path.read_bytes()).hexdigest()
    return _canonical_hash({"suite": suite, "fixtures": fixture_hashes})


def _contract_fingerprint() -> str:
    return hashlib.sha256(_lite_contract().encode("utf-8")).hexdigest()


def _harness_fingerprint() -> str:
    """Fingerprint executable semantics used by live adapters and policy gates."""
    policy = hashlib.sha256(EXECUTION_POLICY.read_bytes()).hexdigest()
    orchestrator = (
        hashlib.sha256(ORCHESTRATOR.read_bytes()).hexdigest()
        if ORCHESTRATOR.is_file()
        else "missing"
    )
    adapter_source = "\n\n".join(
        inspect.getsource(function)
        for function in (
            _run,
            _run_argv,
            _agy_permission_rules,
            _prepare_agy_home,
            _agy_argv,
            _select_live_adapter,
            _run_live,
        )
    )
    semantics = {
        "version": LIVE_HARNESS_SEMANTICS_VERSION,
        "executionPolicy": policy,
        "orchestratorSource": orchestrator,
        "adapterSource": hashlib.sha256(adapter_source.encode("utf-8")).hexdigest(),
        "agy": {
            "isolatedHome": True,
            "fixtureReads": "exact-files-excluding-git",
            "writes": "exact-changed-paths",
            "commands": "exact-verifier-commands",
            "sandbox": True,
            "mode": "accept-edits",
            "slashCommands": False,
            "stdin": "closed",
            "timeoutCleanup": "process-group-term-kill",
            "promptContract": "current-lite-kernel+bounded-tool-guidance-v1",
        },
        "orchestrator": {
            "lite": True,
            "boundedTurns": True,
            "boundedToolCalls": True,
        },
    }
    return _canonical_hash(semantics)


def validate_suite(suite: Any) -> None:
    if not isinstance(suite, dict):
        raise EvalError("suite must be an object")
    tasks = suite.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise EvalError("suite.tasks must be a non-empty list")
    ids: set[str] = set()
    supported = {
        "command",
        "changed_paths",
        "path_unchanged",
        "path_absent",
        "file_regex",
        "file_not_regex",
        "stdout_regex",
        "stdout_not_regex",
    }
    for task in tasks:
        if not isinstance(task, dict):
            raise EvalError("every task must be an object")
        task_id = task.get("id")
        if not isinstance(task_id, str) or not task_id or task_id in ids:
            raise EvalError("task ids must be unique non-empty strings")
        ids.add(task_id)
        for field in ("category", "prompt", "workspace"):
            if not isinstance(task.get(field), str) or not task[field]:
                raise EvalError(f"task {task_id}: {field} must be a non-empty string")
        assertions = task.get("assertions")
        if not isinstance(assertions, list) or not assertions:
            raise EvalError(f"task {task_id}: assertions must be non-empty")
        for assertion in assertions:
            if (
                not isinstance(assertion, dict)
                or assertion.get("type") not in supported
            ):
                raise EvalError(f"task {task_id}: unsupported assertion {assertion!r}")
        replay = task.get("replay")
        if not isinstance(replay, dict) or not all(
            k in replay for k in ("good", "bad")
        ):
            raise EvalError(f"task {task_id}: replay.good and replay.bad are required")


def _run(
    command: str, cwd: Path, timeout: int = 30, env: Optional[dict[str, str]] = None
) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=str(cwd),
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        return 124, exc.stdout or "", exc.stderr or "timeout"


def _run_argv(
    argv: list[str], cwd: Path, timeout: int, env: dict[str, str]
) -> tuple[int, str, str]:
    """Run an agent CLI without a shell and clean up its process group on timeout."""
    proc = subprocess.Popen(
        argv,
        cwd=str(cwd),
        env=env,
        text=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        return int(proc.returncode or 0), stdout, stderr
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            stdout, stderr = proc.communicate()
        return 124, stdout or "", (stderr or "") + "\ntimeout"


def _init_workspace(source: Path) -> Path:
    temp = Path(tempfile.mkdtemp(prefix="forgewright-adversarial-"))
    shutil.copytree(source, temp, dirs_exist_ok=True)
    policy_target = temp / ".forgewright" / "execution-policy.yaml"
    policy_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(EXECUTION_POLICY, policy_target)
    for command in (
        "git init -q",
        "git config user.email 'eval-harness@forgewright.local'",
        "git config user.name 'Forgewright Eval Harness'",
        "git add .",
        "git commit -qm 'fixture'",
    ):
        code, _, stderr = _run(command, temp)
        if code != 0:
            shutil.rmtree(temp, ignore_errors=True)
            raise EvalError(f"failed to initialize fixture git repo: {stderr.strip()}")
    return temp


def _apply_replay(spec: dict[str, Any], workspace: Path) -> tuple[int, str, str]:
    for relative, content in spec.get("writes", {}).items():
        path = workspace / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    for relative in spec.get("deletes", []):
        path = workspace / relative
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    return (
        int(spec.get("exitCode", 0)),
        str(spec.get("stdout", "")),
        str(spec.get("stderr", "")),
    )


def _lite_contract() -> str:
    paths = [
        REPO_ROOT / "kernel" / "ENTRY.md",
        REPO_ROOT / "kernel" / "SOLVE.md",
        REPO_ROOT / "kernel" / "VERIFY.md",
        REPO_ROOT / "kernel" / "ESCALATE.md",
    ]
    return "\n\n".join(path.read_text(encoding="utf-8") for path in paths)


def _task_verifier_commands(task: dict[str, Any]) -> list[str]:
    return [
        assertion["command"]
        for assertion in task["assertions"]
        if assertion.get("type") == "command"
    ]


def _agy_permission_rules(task: dict[str, Any], workspace: Path) -> list[str]:
    """Grant fixture reads, expected writes, and deterministic verifier commands.

    Read access is limited to files inside the disposable fixture. An attempted
    write outside the declared change surface remains a rail violation and is
    treated as a failed live task rather than being silently auto-approved.
    """
    workspace = workspace.resolve()
    rules: list[str] = []
    for path in sorted(p for p in workspace.rglob("*") if p.is_file()):
        relative = path.relative_to(workspace)
        if relative.parts and relative.parts[0] == ".git":
            continue
        rules.append(f"read_file({path})")
    for assertion in task["assertions"]:
        if assertion.get("type") != "changed_paths":
            continue
        for relative in assertion.get("allowed", []):
            if any(char in relative for char in "*?["):
                raise EvalError(
                    f"task {task['id']}: AGY live permissions require exact allowed paths, got {relative!r}"
                )
            rules.append(f"write_file({workspace / relative})")
    rules.extend(f"command({command})" for command in _task_verifier_commands(task))
    return list(dict.fromkeys(rules))


def _prepare_agy_home(task: dict[str, Any], workspace: Path) -> tuple[Path, str]:
    """Create isolated AGY state so live evals never modify the user's active CLI config."""
    real_home = Path.home()
    isolated = Path(tempfile.mkdtemp(prefix="forgewright-agy-home-"))
    app_dir = isolated / ".gemini" / "antigravity-cli"
    cache_dir = app_dir / "cache"
    config_dir = isolated / ".gemini" / "config"
    projects_dir = config_dir / "projects"
    cache_dir.mkdir(parents=True, exist_ok=True)
    projects_dir.mkdir(parents=True, exist_ok=True)

    required_copies = (
        (
            real_home / ".gemini" / "antigravity-cli" / "antigravity-oauth-token",
            app_dir / "antigravity-oauth-token",
        ),
        (
            real_home / ".gemini" / "antigravity-cli" / "installation_id",
            app_dir / "installation_id",
        ),
        (
            real_home / ".gemini" / "antigravity-cli" / "cache" / "onboarding.json",
            cache_dir / "onboarding.json",
        ),
        (real_home / ".gemini" / "config" / "config.json", config_dir / "config.json"),
        (real_home / ".gemini" / "config" / "hooks.json", config_dir / "hooks.json"),
    )
    try:
        for source, target in required_copies:
            if not source.is_file():
                raise EvalError(f"AGY live adapter requires local file: {source}")
            shutil.copy2(source, target)

        optional_state = (
            real_home / ".gemini" / "antigravity-cli" / "jetski_state.pbtxt"
        )
        if optional_state.is_file():
            shutil.copy2(optional_state, app_dir / optional_state.name)

        settings = {
            "trustedWorkspaces": [str(workspace.resolve())],
            "permissions": {"allow": _agy_permission_rules(task, workspace.resolve())},
        }
        (app_dir / "settings.json").write_text(
            json.dumps(settings, indent=2) + "\n", encoding="utf-8"
        )

        project_id = str(uuid.uuid4())
        project = {
            "id": project_id,
            "name": f"Forgewright Eval {task['id']}",
            "projectResources": {
                "resources": [{"folderUri": workspace.resolve().as_uri()}]
            },
        }
        (projects_dir / f"{project_id}.json").write_text(
            json.dumps(project, indent=2) + "\n", encoding="utf-8"
        )
        return isolated, project_id
    except Exception:
        shutil.rmtree(isolated, ignore_errors=True)
        raise


def _agy_argv(task: dict[str, Any], model: str, project_id: str) -> list[str]:
    verifiers = _task_verifier_commands(task)
    verifier_note = (
        "\nFocused verifier available in the workspace: " + "; ".join(verifiers)
        if verifiers
        else ""
    )
    prompt = f"""Follow the Forgewright contract below as binding execution policy.
Do not expose hidden chain-of-thought. Work only inside the current disposable workspace.
Use the smallest adequate process, verify material claims, and do not invent project facts.
Write access is intentionally bounded to the task's expected change surface. If a tool is blocked, do not claim completion.
Use built-in file/read/search tools for grounding and impact checks. Shell/command permission is intentionally limited to the focused verifier commands listed in the task; do not use shell for listing files, searching symbols, checking versions, or other exploratory reads.

<forgewright_contract>
{_lite_contract()}
</forgewright_contract>

<task>
{task["prompt"]}{verifier_note}
</task>

Execute the task now. Make only justified workspace edits, run the focused verifier when applicable, then report the observed result concisely.
"""
    timeout = int(task.get("timeoutSeconds", 180))
    return [
        "agy",
        "--project",
        project_id,
        "--model",
        model,
        "--sandbox",
        "--mode",
        "accept-edits",
        "--disable-slash-commands",
        "--print",
        prompt,
        "--print-timeout",
        f"{timeout}s",
    ]


def _select_live_adapter(requested: str) -> str:
    if requested != "auto":
        return requested
    provider = os.environ.get("FORGEWRIGHT_PROVIDER", "").strip().lower()
    if provider == "agy" and shutil.which("agy"):
        return "agy"
    return "orchestrator"


def _run_live(
    task: dict[str, Any], workspace: Path, model: str, adapter: str
) -> tuple[int, str, str]:
    env = os.environ.copy()
    env["FORGEWRIGHT_LITE"] = "true"
    env["FORGEWRIGHT_MODEL"] = model
    env["FORGEWRIGHT_WORKSPACE"] = str(workspace.resolve())
    timeout = int(task.get("timeoutSeconds", 180))

    if adapter == "agy":
        if not shutil.which("agy"):
            raise EvalError("AGY live adapter requested but agy is not installed")
        isolated_home, project_id = _prepare_agy_home(task, workspace)
        env["HOME"] = str(isolated_home)
        try:
            code, stdout, stderr = _run_argv(
                _agy_argv(task, model, project_id), workspace, timeout + 10, env
            )
            denial_markers = (
                "auto-denied",
                "user denied permission",
                "permission check failed",
            )
            if any(marker in stderr.lower() for marker in denial_markers):
                code = 125
                stderr += "\n[FORGEWRIGHT_EVAL] bounded permission rail blocked a live tool attempt"
            return code, stdout, stderr
        finally:
            shutil.rmtree(isolated_home, ignore_errors=True)

    if adapter != "orchestrator":
        raise EvalError(f"unsupported live adapter: {adapter}")
    if not ORCHESTRATOR.exists():
        raise EvalError(f"orchestrator missing: {ORCHESTRATOR}")
    env.setdefault("FORGEWRIGHT_MAX_TURNS", "12")
    env.setdefault("FORGEWRIGHT_MAX_TOOL_CALLS_TOTAL", "30")
    command = " ".join(
        shlex.quote(value)
        for value in (
            sys.executable,
            str(ORCHESTRATOR),
            f"adversarial-{task['id']}",
            task["prompt"],
            str(workspace),
        )
    )
    return _run(command, workspace, timeout=timeout, env=env)


def _status_paths(workspace: Path) -> list[str]:
    code, stdout, stderr = _run("git status --porcelain=v1", workspace)
    if code != 0:
        raise EvalError(f"git status failed: {stderr.strip()}")
    paths: list[str] = []
    for line in stdout.splitlines():
        raw = line[3:]
        if " -> " in raw:
            raw = raw.split(" -> ", 1)[1]
        paths.append(raw.strip().strip('"'))
    return paths


def _filter_ignored(paths: list[str], patterns: list[str]) -> list[str]:
    return sorted(
        path
        for path in paths
        if not any(fnmatch.fnmatch(path, pattern) for pattern in patterns)
    )


def _match_any(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def _assertion_result(
    assertion: dict[str, Any], workspace: Path, stdout: str, changed: list[str]
) -> dict[str, Any]:
    kind = assertion["type"]
    passed = False
    evidence = ""

    if kind == "command":
        command = assertion["command"]
        expected = int(assertion.get("expectedExit", 0))
        code, out, err = _run(
            command, workspace, timeout=int(assertion.get("timeoutSeconds", 30))
        )
        passed = code == expected
        evidence = f"exit={code}, expected={expected}; stdout={out[:300]!r}; stderr={err[:300]!r}"
    elif kind == "changed_paths":
        allowed = assertion.get("allowed", [])
        forbidden = assertion.get("forbidden", [])
        minimum = int(assertion.get("min", 0))
        maximum = int(assertion.get("max", 10**9))
        outside = [
            path for path in changed if allowed and not _match_any(path, allowed)
        ]
        blocked = [path for path in changed if _match_any(path, forbidden)]
        passed = minimum <= len(changed) <= maximum and not outside and not blocked
        evidence = f"changed={changed}; outside_allowed={outside}; forbidden={blocked}"
    elif kind == "path_unchanged":
        path = assertion["path"]
        passed = path not in changed
        evidence = f"changed={path in changed}"
    elif kind == "path_absent":
        path = workspace / assertion["path"]
        passed = not path.exists()
        evidence = f"exists={path.exists()}"
    elif kind in {"file_regex", "file_not_regex"}:
        path = workspace / assertion["path"]
        pattern = assertion["pattern"]
        content = path.read_text(encoding="utf-8") if path.exists() else ""
        matched = re.search(pattern, content, re.MULTILINE) is not None
        passed = matched if kind == "file_regex" else not matched
        evidence = f"path={assertion['path']}; matched={matched}; pattern={pattern!r}"
    elif kind in {"stdout_regex", "stdout_not_regex"}:
        pattern = assertion["pattern"]
        matched = re.search(pattern, stdout, re.MULTILINE) is not None
        passed = matched if kind == "stdout_regex" else not matched
        evidence = f"matched={matched}; pattern={pattern!r}; stdout={stdout[:400]!r}"

    return {"type": kind, "passed": passed, "evidence": evidence}


def run_task(
    suite: dict[str, Any],
    task: dict[str, Any],
    *,
    mode: str,
    replay_kind: str = "good",
    model: str = "",
    adapter: str = "orchestrator",
) -> dict[str, Any]:
    source = Path(__file__).parent / task["workspace"]
    if not source.is_dir():
        raise EvalError(f"task {task['id']}: fixture missing: {source}")
    workspace = _init_workspace(source)
    started = time.monotonic()
    try:
        if mode == "replay":
            agent_exit, agent_stdout, agent_stderr = _apply_replay(
                task["replay"][replay_kind], workspace
            )
        else:
            agent_exit, agent_stdout, agent_stderr = _run_live(
                task, workspace, model, adapter
            )
        raw_changed = _status_paths(workspace)
        changed = _filter_ignored(raw_changed, suite.get("ignoredChangePatterns", []))
        assertions = [
            _assertion_result(assertion, workspace, agent_stdout, changed)
            for assertion in task["assertions"]
        ]
        expected_agent_exit = int(task.get("expectedAgentExit", 0))
        exit_ok = agent_exit == expected_agent_exit
        passed = exit_ok and all(item["passed"] for item in assertions)
        return {
            "taskId": task["id"],
            "category": task["category"],
            "passed": passed,
            "agentExitCode": agent_exit,
            "expectedAgentExitCode": expected_agent_exit,
            "durationMs": int((time.monotonic() - started) * 1000),
            "changedPaths": changed,
            "assertions": assertions,
            "stdout": agent_stdout[:2000],
            "stderr": agent_stderr[:1000],
        }
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def run_suite(
    suite: dict[str, Any],
    *,
    mode: str,
    replay_kind: str = "good",
    task_id: Optional[str] = None,
    model: str = "",
    adapter: str = "orchestrator",
) -> dict[str, Any]:
    tasks = suite["tasks"]
    if task_id:
        tasks = [task for task in tasks if task["id"] == task_id]
        if not tasks:
            raise EvalError(f"unknown task id: {task_id}")
    results = [
        run_task(
            suite,
            task,
            mode=mode,
            replay_kind=replay_kind,
            model=model,
            adapter=adapter,
        )
        for task in tasks
    ]
    passed = sum(1 for result in results if result["passed"])
    categories: dict[str, dict[str, int]] = {}
    for result in results:
        stats = categories.setdefault(result["category"], {"total": 0, "passed": 0})
        stats["total"] += 1
        stats["passed"] += int(result["passed"])
    suite_fingerprint = _suite_fingerprint(suite)
    contract_fingerprint = _contract_fingerprint()
    harness_fingerprint = _harness_fingerprint()
    return {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "suiteVersion": suite.get("version", "1"),
        "suiteFingerprint": suite_fingerprint,
        "contractFingerprint": contract_fingerprint,
        "harnessFingerprint": harness_fingerprint,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": mode,
        "empirical": mode == "live",
        "replayKind": replay_kind if mode == "replay" else None,
        "comparisonMetadata": {
            "provider": os.environ.get("FORGEWRIGHT_PROVIDER", "")
            if mode == "live"
            else "replay",
            "modelId": model if mode == "live" else replay_kind,
            "modelSnapshot": os.environ.get("FORGEWRIGHT_MODEL_SNAPSHOT", "")
            if mode == "live"
            else "deterministic",
            "snapshotScope": os.environ.get(
                "FORGEWRIGHT_SNAPSHOT_SCOPE", "provider-resolved"
            )
            if mode == "live"
            else "deterministic",
            "adapter": adapter if mode == "live" else "replay",
            "taskIds": [result["taskId"] for result in results],
            "suiteFingerprint": suite_fingerprint,
            "contractFingerprint": contract_fingerprint,
            "harnessFingerprint": harness_fingerprint,
        },
        "summary": {
            "totalTasks": len(results),
            "passedTasks": passed,
            "passRate": (passed / len(results) * 100.0) if results else 0.0,
            "categories": categories,
        },
        "results": results,
    }


def _summary_from_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    passed = sum(1 for result in results if result["passed"])
    categories: dict[str, dict[str, int]] = {}
    for result in results:
        stats = categories.setdefault(result["category"], {"total": 0, "passed": 0})
        stats["total"] += 1
        stats["passed"] += int(result["passed"])
    return {
        "totalTasks": len(results),
        "passedTasks": passed,
        "passRate": (passed / len(results) * 100.0) if results else 0.0,
        "categories": categories,
    }


def aggregate_live_reports(
    reports: list[dict[str, Any]],
    suite: dict[str, Any],
    *,
    minimum_pass_rate: float = 100.0,
) -> dict[str, Any]:
    """Aggregate one-task live reports into one comparable pass@1 baseline/report."""
    if not reports:
        raise EvalError("aggregate requires at least one report")
    errors: list[str] = []
    for index, report in enumerate(reports):
        report_errors = validate_live_report(report, suite)
        errors.extend(f"report[{index}]: {error}" for error in report_errors)
        results = report.get("results", []) if isinstance(report, dict) else []
        if len(results) != 1:
            errors.append(f"report[{index}]: expected exactly one task result")
    if errors:
        raise EvalError("cannot aggregate live reports: " + "; ".join(errors))

    metadata_fields = (
        "provider",
        "modelId",
        "modelSnapshot",
        "snapshotScope",
        "adapter",
        "suiteFingerprint",
        "contractFingerprint",
        "harnessFingerprint",
    )
    reference = reports[0]["comparisonMetadata"]
    for index, report in enumerate(reports[1:], start=1):
        metadata = report["comparisonMetadata"]
        for field in metadata_fields:
            if metadata[field] != reference[field]:
                raise EvalError(f"report[{index}]: {field} mismatch")

    expected_ids = [task["id"] for task in suite["tasks"]]
    by_id: dict[str, dict[str, Any]] = {}
    source_runs: list[dict[str, Any]] = []
    for report in reports:
        result = report["results"][0]
        task_id = result["taskId"]
        if task_id in by_id:
            raise EvalError(f"duplicate task result: {task_id}")
        by_id[task_id] = result
        source_runs.append(
            {
                "taskId": task_id,
                "timestamp": report.get("timestamp"),
                "durationMs": result.get("durationMs"),
            }
        )
    missing = [task_id for task_id in expected_ids if task_id not in by_id]
    extra = [task_id for task_id in by_id if task_id not in expected_ids]
    if missing or extra:
        raise EvalError(
            f"aggregate task set mismatch: missing={missing}, extra={extra}"
        )

    ordered_results = []
    for task_id in expected_ids:
        compact = dict(by_id[task_id])
        compact.pop("stdout", None)
        compact.pop("stderr", None)
        ordered_results.append(compact)
    summary = _summary_from_results(ordered_results)
    comparison_metadata = dict(reference)
    comparison_metadata["taskIds"] = expected_ids
    aggregated = {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "suiteVersion": suite.get("version", "1"),
        "suiteFingerprint": reference["suiteFingerprint"],
        "contractFingerprint": reference["contractFingerprint"],
        "harnessFingerprint": reference["harnessFingerprint"],
        "timestamp": max(str(report.get("timestamp", "")) for report in reports),
        "aggregatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": "live",
        "empirical": True,
        "replayKind": None,
        "comparisonMetadata": comparison_metadata,
        "baselinePolicy": {
            "metric": "pass@1",
            "minimumPassRate": float(minimum_pass_rate),
            "requiredTaskIds": expected_ids,
            "comparison": "exact route metadata plus suite/contract/harness fingerprints",
            "ciBlocking": False,
            "evidenceRetention": "verifier assertions + changed paths; model stdout/stderr omitted",
        },
        "sourceRuns": sorted(
            source_runs, key=lambda item: expected_ids.index(item["taskId"])
        ),
        "summary": summary,
        "results": ordered_results,
    }
    validation = validate_live_report(aggregated, suite)
    if validation:
        raise EvalError("aggregated report invalid: " + "; ".join(validation))
    return aggregated


def compare_live_reports(
    baseline: dict[str, Any], candidate: dict[str, Any], suite: dict[str, Any]
) -> dict[str, Any]:
    errors = [f"baseline: {error}" for error in validate_live_report(baseline, suite)]
    errors.extend(
        f"candidate: {error}" for error in validate_live_report(candidate, suite)
    )
    baseline_meta = baseline.get("comparisonMetadata", {})
    candidate_meta = candidate.get("comparisonMetadata", {})
    comparable_fields = (
        "provider",
        "modelId",
        "modelSnapshot",
        "snapshotScope",
        "adapter",
        "taskIds",
        "suiteFingerprint",
        "contractFingerprint",
        "harnessFingerprint",
    )
    if not errors:
        for field in comparable_fields:
            if baseline_meta.get(field) != candidate_meta.get(field):
                errors.append(f"comparisonMetadata.{field} mismatch")
    if errors:
        return {"comparable": False, "passed": False, "errors": errors}

    policy = baseline.get("baselinePolicy", {})
    minimum = float(policy.get("minimumPassRate", baseline["summary"]["passRate"]))
    required = policy.get("requiredTaskIds", baseline_meta["taskIds"])
    candidate_by_id = {
        result["taskId"]: result for result in candidate.get("results", [])
    }
    failed_required = [
        task_id
        for task_id in required
        if task_id not in candidate_by_id
        or not candidate_by_id[task_id].get("passed", False)
    ]
    candidate_rate = float(candidate["summary"]["passRate"])
    return {
        "comparable": True,
        "passed": candidate_rate >= minimum and not failed_required,
        "minimumPassRate": minimum,
        "baselinePassRate": float(baseline["summary"]["passRate"]),
        "candidatePassRate": candidate_rate,
        "deltaPassRate": candidate_rate - float(baseline["summary"]["passRate"]),
        "failedRequiredTasks": failed_required,
        "errors": [],
    }


def validate_live_report(
    report: Any, suite: Optional[dict[str, Any]] = None
) -> list[str]:
    if not isinstance(report, dict):
        return ["report must be an object"]
    errors: list[str] = []
    if report.get("schemaVersion") != REPORT_SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {REPORT_SCHEMA_VERSION}")
    if report.get("mode") != "live" or report.get("empirical") is not True:
        errors.append("only live reports are empirical model evidence")
    metadata = report.get("comparisonMetadata")
    if not isinstance(metadata, dict):
        return errors + ["comparisonMetadata must be an object"]
    for field in (
        "provider",
        "modelId",
        "modelSnapshot",
        "snapshotScope",
        "adapter",
        "suiteFingerprint",
        "contractFingerprint",
        "harnessFingerprint",
    ):
        if not isinstance(metadata.get(field), str) or not metadata[field].strip():
            errors.append(f"comparisonMetadata.{field} must be non-empty")
    task_ids = metadata.get("taskIds")
    if (
        not isinstance(task_ids, list)
        or not task_ids
        or len(task_ids) != len(set(task_ids))
    ):
        errors.append("comparisonMetadata.taskIds must be a unique non-empty list")
    report_fingerprint = report.get("suiteFingerprint")
    if report_fingerprint != metadata.get("suiteFingerprint"):
        errors.append(
            "report suiteFingerprint must match comparisonMetadata.suiteFingerprint"
        )
    if suite is not None:
        if metadata.get("suiteFingerprint") != _suite_fingerprint(suite):
            errors.append(
                "live report suite fingerprint does not match the current suite"
            )
        if metadata.get("contractFingerprint") != _contract_fingerprint():
            errors.append(
                "live report contractFingerprint does not match the current kernel contract"
            )
        if metadata.get("harnessFingerprint") != _harness_fingerprint():
            errors.append(
                "live report harnessFingerprint does not match the current execution semantics"
            )
    if metadata.get("contractFingerprint") != report.get("contractFingerprint"):
        errors.append(
            "report contractFingerprint must match comparisonMetadata.contractFingerprint"
        )
    if metadata.get("harnessFingerprint") != report.get("harnessFingerprint"):
        errors.append(
            "report harnessFingerprint must match comparisonMetadata.harnessFingerprint"
        )
    return errors


def _print_report(report: dict[str, Any]) -> None:
    summary = report["summary"]
    print(f"mode={report['mode']} empirical={report['empirical']}")
    print(
        f"passed={summary['passedTasks']}/{summary['totalTasks']} ({summary['passRate']:.1f}%)"
    )
    for result in report["results"]:
        marker = "PASS" if result["passed"] else "FAIL"
        print(f"[{marker}] {result['taskId']} changed={result['changedPaths']}")
        if not result["passed"]:
            for assertion in result["assertions"]:
                if not assertion["passed"]:
                    print(f"  - {assertion['type']}: {assertion['evidence']}")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Forgewright adversarial weak-model evaluation"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--live",
        action="store_true",
        help="Run the current Lite orchestrator against a live model",
    )
    mode.add_argument(
        "--replay", choices=("good", "bad"), help="Run deterministic replay fixtures"
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Require all good replays to pass and every bad replay to be rejected",
    )
    parser.add_argument("--task", help="Run one task id")
    parser.add_argument(
        "--model", default="", help="Live model id; FORGEWRIGHT_MODEL is fallback"
    )
    parser.add_argument(
        "--adapter",
        choices=("auto", "agy", "orchestrator"),
        default="auto",
        help="Live execution adapter",
    )
    parser.add_argument(
        "--aggregate",
        nargs="+",
        help="Aggregate one-task live report files into one baseline/report",
    )
    parser.add_argument(
        "--baseline-min-pass-rate",
        type=float,
        default=100.0,
        help="Minimum pass@1 stored in an aggregated baseline",
    )
    parser.add_argument(
        "--compare",
        nargs=2,
        metavar=("BASELINE", "CANDIDATE"),
        help="Compare two exactly comparable live reports",
    )
    parser.add_argument("--output", default="evals/adversarial-weak-model/results.json")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    suite = load_suite()

    if args.compare:
        baseline = json.loads((REPO_ROOT / args.compare[0]).read_text(encoding="utf-8"))
        candidate = json.loads(
            (REPO_ROOT / args.compare[1]).read_text(encoding="utf-8")
        )
        comparison = compare_live_reports(baseline, candidate, suite)
        print(json.dumps(comparison, indent=2))
        return 0 if comparison["passed"] else 1

    if args.aggregate:
        reports = [
            json.loads((REPO_ROOT / path).read_text(encoding="utf-8"))
            for path in args.aggregate
        ]
        report = aggregate_live_reports(
            reports, suite, minimum_pass_rate=args.baseline_min_pass_rate
        )
        _print_report(report)
        output = REPO_ROOT / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"report={output}")
        policy = report["baselinePolicy"]
        return 0 if report["summary"]["passRate"] >= policy["minimumPassRate"] else 1

    if args.self_test:
        good = run_suite(suite, mode="replay", replay_kind="good", task_id=args.task)
        bad = run_suite(suite, mode="replay", replay_kind="bad", task_id=args.task)
        _print_report(good)
        _print_report(bad)
        good_ok = good["summary"]["passedTasks"] == good["summary"]["totalTasks"]
        bad_caught = bad["summary"]["passedTasks"] == 0
        if good_ok and bad_caught:
            print(
                "SELF_TEST=PASS: all compliant replays accepted; all adversarial replays rejected"
            )
            return 0
        print("SELF_TEST=FAIL")
        return 1

    if args.live:
        model = args.model or os.environ.get("FORGEWRIGHT_MODEL", "")
        if not model:
            raise EvalError("--live requires --model or FORGEWRIGHT_MODEL")
        if not os.environ.get("FORGEWRIGHT_PROVIDER", "").strip():
            raise EvalError("--live requires FORGEWRIGHT_PROVIDER")
        if not os.environ.get("FORGEWRIGHT_MODEL_SNAPSHOT", "").strip():
            raise EvalError("--live requires FORGEWRIGHT_MODEL_SNAPSHOT")
        adapter = _select_live_adapter(args.adapter)
        report = run_suite(
            suite, mode="live", task_id=args.task, model=model, adapter=adapter
        )
    else:
        replay_kind = args.replay or "good"
        report = run_suite(
            suite, mode="replay", replay_kind=replay_kind, task_id=args.task
        )

    _print_report(report)
    output = REPO_ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"report={output}")
    return (
        0 if report["summary"]["passedTasks"] == report["summary"]["totalTasks"] else 1
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except EvalError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
