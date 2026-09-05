#!/usr/bin/env python3
"""Fail-closed local verifier for the Product Factory upgrade program.

The command list is intentionally explicit. Each roadmap phase adds its
contract tests here only after the preceding phase has passed its focused
gate, so a missing test file or executable is a hard failure rather than a
silent skip.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TIMEOUT_SECONDS = 300


def run(
    name: str,
    argv: list[str],
    *,
    cwd: Path = ROOT,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> None:
    print(f"\n==> product-factory: {name}", flush=True)
    print("    " + " ".join(argv), flush=True)
    try:
        completed = subprocess.run(
            argv,
            cwd=cwd,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise SystemExit(f"{name} timed out after {timeout_seconds} seconds") from error
    if completed.returncode != 0:
        raise SystemExit(f"{name} failed with exit code {completed.returncode}")


def main() -> int:
    run(
        "pf0-instruction-provenance-baseline",
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            "tests/unit_tests/test_product_factory_audit.py",
        ],
    )
    run(
        "pf0-python-contract-compile",
        [
            sys.executable,
            "-m",
            "py_compile",
            "scripts/product_factory/audit.py",
            "scripts/product_factory/baseline.py",
        ],
    )
    run(
        "pf1-product-intent-and-canonical-mcp-bridge",
        [
            "npm",
            "test",
            "--",
            "--reporter=basic",
            "--no-cache",
            "src/product-factory/product-intent.test.ts",
            "src/product-factory/product-intent-service.test.ts",
            "src/api/product-intent-tools.test.ts",
            "src/runtime/execution-containment.test.ts",
            "src/api/tools.gateway.test.ts",
        ],
        cwd=ROOT / "mcp",
    )
    run(
        "pf2-environment-aci-and-domain-adapters",
        [
            "npm",
            "test",
            "--",
            "--reporter=basic",
            "--no-cache",
            "src/product-factory/environment-aci.test.ts",
            "src/product-factory/adapters/web-environment-aci.test.ts",
            "src/product-factory/adapters/android-environment-aci.test.ts",
            "src/product-factory/adapters/unity-environment-aci.test.ts",
        ],
        cwd=ROOT / "mcp",
    )
    run(
        "pf3-product-outcome-runner-and-judge",
        [
            "npm",
            "test",
            "--",
            "--reporter=basic",
            "--no-cache",
            "src/product-factory/product-outcome-contract.test.ts",
            "src/product-factory/web-outcome-compatibility.test.ts",
            "src/product-factory/product-outcome-runner.test.ts",
            "src/product-factory/product-outcome-judge.test.ts",
        ],
        cwd=ROOT / "mcp",
    )
    run(
        "pf4-forgebench-product-lanes-and-cli-ingestion",
        [
            "npm",
            "test",
            "--",
            "tests/bench-product-factory.test.ts",
            "tests/bench-product-command.test.ts",
            "tests/bench-comparable.test.ts",
            "tests/bench-runner.test.ts",
            "tests/bench-metrics.test.ts",
        ],
        cwd=ROOT / "src" / "cli",
    )
    run(
        "pf5-evidence-gated-learning-foundry",
        [
            "npm",
            "test",
            "--",
            "--reporter=basic",
            "--no-cache",
            "src/product-factory/learning-foundry.test.ts",
        ],
        cwd=ROOT / "mcp",
    )
    run(
        "pf6-disposable-secure-runtime",
        [
            "npm",
            "test",
            "--",
            "--reporter=basic",
            "--no-cache",
            "src/product-factory/disposable-environment.test.ts",
            "src/runtime/execution-containment.test.ts",
            "src/runtime/lifecycle-lease.test.ts",
            "src/runtime/lifecycle-coordinator.test.ts",
            "src/runtime/mcp-runtime-lifecycle.test.ts",
        ],
        cwd=ROOT / "mcp",
    )
    run(
        "pf7-fail-closed-release-readiness-contract",
        [
            "npm",
            "test",
            "--",
            "--reporter=basic",
            "--no-cache",
            "src/product-factory/product-factory-release.test.ts",
        ],
        cwd=ROOT / "mcp",
    )
    run("pf1-pf7-typescript-contract", ["npx", "tsc", "--noEmit"], cwd=ROOT / "mcp")
    run(
        "pf4-cli-typescript-contract",
        ["npx", "tsc", "--noEmit"],
        cwd=ROOT / "src" / "cli",
    )
    run(
        "pf7-release-truthfulness-guard",
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            "tests/unit_tests/test_product_factory_release_status.py",
        ],
    )
    print("\nProduct Factory verifier: PASS", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
