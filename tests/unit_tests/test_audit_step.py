import os


def test_audit_file_exists():
    assert os.path.exists("kernel/AUDIT.md"), "kernel/AUDIT.md not found"


def test_audit_step_exists_in_solve():
    with open("kernel/SOLVE.md", "r") as f:
        content = f.read()

    audit_index = content.find("## 7. AUDIT")
    execute_index = content.find("## 6. EXECUTE")
    stuck_index = content.find("## 8. STUCK RULE")

    assert audit_index != -1, "AUDIT step not found in SOLVE.md"
    assert execute_index != -1, "EXECUTE step not found in SOLVE.md"
    assert stuck_index != -1, "STUCK RULE not found in SOLVE.md"
    assert execute_index < audit_index < stuck_index, (
        "AUDIT must appear after EXECUTE and before STUCK RULE"
    )


def test_audit_has_coverage_matrix():
    with open("kernel/AUDIT.md", "r") as f:
        content = f.read()
    assert "REQUIREMENT COVERAGE MATRIX" in content


def test_audit_has_contradiction_scan():
    with open("kernel/AUDIT.md", "r") as f:
        content = f.read()
    assert "CONTRADICTION SCAN" in content


def test_audit_has_cross_entry_consistency():
    with open("kernel/AUDIT.md", "r") as f:
        content = f.read()
    assert "CROSS-ENTRY CONSISTENCY" in content


def test_audit_cross_referenced_in_verify():
    with open("kernel/VERIFY.md", "r") as f:
        content = f.read()
    assert "AUDIT" in content, "VERIFY.md must reference AUDIT"


def test_audit_in_self_check():
    with open("skills/_shared/protocols/self-check.md", "r") as f:
        content = f.read()
    assert "AUDIT coverage matrix" in content, (
        "self-check.md must reference AUDIT coverage matrix"
    )


def test_solve_preamble_requires_evidence_without_audit_ceremony():
    with open("kernel/SOLVE.md", "r") as f:
        content = f.read()
    assert (
        "Verification evidence is always required in substance; ceremony is not"
        in content
    )
    assert "## 7. AUDIT — Proportional Requirement Coverage" in content


def test_quick_audit_does_not_require_matrix():
    with open("kernel/AUDIT.md", "r") as f:
        content = f.read()
    quick = content.split("## QUICK", 1)[1].split("## STANDARD", 1)[0]
    assert "No matrix" in quick
    assert "Confirm the explicit acceptance condition" in quick
