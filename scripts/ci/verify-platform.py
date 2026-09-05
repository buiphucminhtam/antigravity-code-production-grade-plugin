#!/usr/bin/env python3
"""Native Mac/Windows integration gate; does not grant production authority."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import platform
import subprocess
import sys
import time

from native_commands import native_argv, native_environment

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    tests = [
        "tests/unit_tests/test_codex_hook_portability.py",
        "tests/unit_tests/test_git_hook_portability.py",
        "tests/unit_tests/test_hook_unicode_transport.py",
        "tests/unit_tests/test_native_ci_commands.py",
        "tests/unit_tests/test_native_node_commands.py",
        "tests/unit_tests/test_local_ci.py",
        "tests/unit_tests/test_ci_workflow.py",
        "tests/unit_tests/test_hook_schema.py",
        "tests/lite/test_gate.py",
        "tests/unit_tests/test_continuity_gate.py",
        "tests/unit_tests/test_continuity_checkpoint.py",
        "tests/unit_tests/test_rule_hook_distribution.py::test_installer_distributes_rule_runtime_and_preserves_user_hooks",
        "tests/unit_tests/test_rule_hook_distribution.py::test_codex_lifecycle_migration_removes_legacy_python3_duplicates",
    ]
    commands = [
        (
            "native-hooks-and-evidence",
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *tests],
        ),
        ("product-factory", [sys.executable, "scripts/ci/verify-product-factory.py"]),
        (
            "mcp-tests",
            ["npm", "--prefix", "mcp", "test", "--", "--reporter=basic", "--no-cache"],
        ),
        ("mcp-lint", ["npm", "--prefix", "mcp", "run", "lint"]),
        ("mcp-format", ["npm", "--prefix", "mcp", "run", "format:check"]),
        ("cli-tests", ["npm", "--prefix", "src/cli", "test"]),
    ]
    if args.browser:
        commands.append(
            ("real-browser-reference", ["npm", "run", "verify:web-reference"])
        )
    rows = []
    environment = native_environment()
    for name, command in commands:
        started = time.monotonic()
        print(f"\n==> native-platform: {name}", flush=True)
        executed = command
        try:
            executed = native_argv(command)
            process = subprocess.Popen(
                executed,
                cwd=ROOT,
                env=environment,
                start_new_session=os.name != "nt",
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                if os.name == "nt"
                else 0,
            )
            try:
                code = process.wait(timeout=600)
            except subprocess.TimeoutExpired:
                # Reclaim only the process tree started for this check.
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        capture_output=True,
                        check=False,
                        timeout=15,
                    )
                else:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                        process.wait(timeout=3)
                    except ProcessLookupError:
                        pass
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=10)
                code = 124
        except subprocess.TimeoutExpired:
            code = 124
        except OSError as error:
            print(f"{name}: {error}", file=sys.stderr)
            code = 127
        rows.append(
            {
                "name": name,
                "argv": command,
                "executed_argv": executed,
                "exit_code": code,
                "seconds": round(time.monotonic() - started, 3),
            }
        )
    report = {
        "schema": "forgewright-native-platform/v1",
        "host": platform.system(),
        "python": platform.python_version(),
        "status": "PASS" if all(row["exit_code"] == 0 for row in rows) else "FAIL",
        "production_eligible": False,
        "browser_requested": args.browser,
        "checks": rows,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report), flush=True)
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
