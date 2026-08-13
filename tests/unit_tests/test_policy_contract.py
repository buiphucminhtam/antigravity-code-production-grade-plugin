from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


PAYMENT_SURFACE = (
    "payment, billing, IAP/in-app purchase, receipt validation, entitlements, "
    "subscription, or checkout"
)


def test_payment_surfaces_are_hard_and_deep_without_file_count_escape() -> None:
    escalate = _normalized(_read("kernel/ESCALATE.md"))
    solve = _normalized(_read("kernel/SOLVE.md"))
    verify = _normalized(_read("kernel/VERIFY.md"))
    quality = _normalized(_read("skills/_shared/protocols/quality-gate.md"))
    mode_execution = _normalized(
        _read("skills/production-grade/references/mode-execution.md")
    )

    assert PAYMENT_SURFACE.lower() in escalate.lower()
    assert "mandatory `HARD` signals regardless of file count" in escalate
    assert (
        "any task touching payment, billing, IAP/in-app purchase, receipt validation, "
        "entitlements, subscription, or checkout is `HARD` and `DEEP` regardless of file count"
        in solve
    )
    assert (
        "small-file or documentation shortcut cannot downgrade this classification"
        in solve
    )
    assert "There is no small-file `QUICK` escape" in quality
    assert "mandatory `HARD` and `DEEP`, regardless of file count" in verify
    assert "no mode shortcut may classify them as `QUICK`" in mode_execution

    contradictory_escapes = (
        "payment changes can be QUICK when only one file changes",
        "small payment changes may be QUICK",
        "payment is QUICK if documentation-only",
    )
    combined = " ".join((escalate, solve, verify, quality, mode_execution)).lower()
    assert not any(escape in combined for escape in contradictory_escapes)


def test_payment_work_requires_reviewer_and_domain_evidence() -> None:
    escalate = _read("kernel/ESCALATE.md")
    verify = _read("kernel/VERIFY.md")
    quality = _read("skills/_shared/protocols/quality-gate.md")
    pipeline = _read("skills/_shared/protocols/pipeline-operating-contract.md")

    combined = " ".join((escalate, verify, quality, pipeline)).lower()
    assert "independent reviewer" in combined
    assert "contract" in combined
    assert "runtime" in combined
    assert "e2e" in combined

    assert "reviewer.status: independent-approved" in verify
    assert "reviewer.status: independent-approved" in quality
    assert "independent-approved reviewer" in pipeline
    assert "negative paths" in verify


def test_completion_evidence_requires_schema_v2_traceability() -> None:
    verify = _read("kernel/VERIFY.md")
    quality = _read("skills/_shared/protocols/quality-gate.md")
    pipeline = _read("skills/_shared/protocols/pipeline-operating-contract.md")

    required_fields = (
        '"schema_version": "2"',
        '"acceptance_criteria":',
        '"id":',
        '"claim":',
        '"test_refs":',
        '"tier":',
        '"command":',
        '"negative_paths":',
        '"limitations":',
        '"implementer_id":',
        '"reviewer":',
        '"tree_sha":',
        '"output_sha256":',
    )
    assert all(field in verify for field in required_fields)
    assert "Schema v1 is legacy and" in verify
    assert "non-completion after v2 activation" in verify
    assert "marker-only" in verify
    assert "schema-v2 evidence mapping each exact" in pipeline
    assert "Schema v1 is" in quality
    assert "marker-only VERIFY output cannot prove completion" in quality


def test_fix_evidence_requires_red_green_and_hard_mutation_backcheck() -> None:
    verify = _read("kernel/VERIFY.md")
    quality = _read("skills/_shared/protocols/quality-gate.md")
    pipeline = _read("skills/_shared/protocols/pipeline-operating-contract.md")

    for text in (verify, quality):
        normalized = _normalized(text)
        assert "observed RED" in text
        assert "same command" in text
        assert "observed GREEN" in text
        assert "controlled mutation" in text or "mutation/backcheck" in text
        assert "clean pre-mutation target tree" in normalized

    assert "v2 RED/GREEN evidence pair plus mutation/backcheck" in pipeline
    assert "Completion is blocked until this sequence is observed" in verify


def test_recovery_policy_preserves_unrelated_work_and_stuck_rule() -> None:
    healing = _read("skills/_shared/protocols/self-healing-execution.md")
    normalized = _normalized(healing)

    assert "same step fails twice" in normalized
    assert "never use `git reset --hard`" in healing
    assert "prove unrelated status/diff is unchanged" in normalized
    assert "MUST run `git reset --hard" not in healing
    assert 'git commit -am "Pre-healing checkpoint"' not in healing


def test_routing_contract_is_local_first_provider_neutral_and_unpinned() -> None:
    senior = _read("skills/_shared/protocols/senior-execution-contract.md")
    escalate = _read("kernel/ESCALATE.md")

    assert "local-first and provider-neutral" in senior
    assert "model pins" in senior
    assert "quota" in senior
    assert "budget_limited" in senior
    assert "never pins a provider, model ID" in escalate
