import importlib.util
import json
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


def _project_state() -> dict:
    return json.loads((ROOT / "docs/project-state.json").read_text(encoding="utf-8"))


def _completion_manifest() -> dict:
    return json.loads(
        (ROOT / "docs/roadmap-completion.json").read_text(encoding="utf-8")
    )


def test_pf7_stays_blocked_without_current_reference_lane_evidence() -> None:
    state = _project_state()
    pf7 = next(item for item in state["roadmap"] if item["id"] == "product-factory-pf7")

    assert pf7["status"] == "blocked"
    summary = state["status"]["summary"]
    assert "PF7 is blocked" in summary
    assert "web/mobile/game production evidence" in summary


def test_pf7_completion_axes_cannot_self_certify_missing_production_evidence() -> None:
    manifest = _completion_manifest()
    pf7 = next(item for item in manifest["deliverables"] if item["id"] == "PF7")

    assert pf7["implementation"] == "partial"
    assert pf7["integration"] == "partial"
    assert pf7["activation"] == "not-enabled"
    assert pf7["production_evidence"] == "missing"
    assert pf7["outcome"] == "not-measured"


def test_required_local_ci_runs_the_canonical_product_factory_verifier() -> None:
    required_checks = (ROOT / "scripts/ci/run-required-checks.sh").read_text(
        encoding="utf-8"
    )
    assert (
        "run_required product-factory npm run verify:product-factory" in required_checks
    )

    verifier = (ROOT / "scripts/ci/verify-product-factory.py").read_text(
        encoding="utf-8"
    )
    assert "src/product-factory/product-factory-release.test.ts" in verifier


def test_product_factory_verifier_bounds_every_subprocess(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module_path = ROOT / "scripts/ci/verify-product-factory.py"
    spec = importlib.util.spec_from_file_location("verify_product_factory", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def expire(argv: list[str], **kwargs: object) -> None:
        assert argv == ["probe"]
        assert kwargs["timeout"] == 7
        raise subprocess.TimeoutExpired(argv, timeout=7)

    # This test isolates timeout handling from native executable resolution.
    # Windows correctly rejects the synthetic `probe` executable before launch,
    # so keep argv identity-bound while exercising only subprocess timeout semantics.
    monkeypatch.setattr(module, "native_argv", lambda argv: list(argv))
    monkeypatch.setattr(module.subprocess, "run", expire)
    with pytest.raises(SystemExit, match="probe-gate timed out after 7 seconds"):
        module.run("probe-gate", ["probe"], timeout_seconds=7)
