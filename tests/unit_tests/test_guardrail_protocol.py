"""Regression tests for the Guardrail Protocol.

Validates that:
- guardrail.md exists and contains all 14 rule categories
- Decision matrix is complete
- All contradictions are fixed (no Vietnamese, fail-closed clarity)
- Kernel files reference guardrail
- Cross-references are wired correctly
"""

import os
import pytest


GUARDRAIL_PATH = "skills/_shared/protocols/guardrail.md"
ENTRY_PATH = "kernel/ENTRY.md"
SOLVE_PATH = "kernel/SOLVE.md"
AUDIT_PATH = "kernel/AUDIT.md"
ESCALATE_PATH = "kernel/ESCALATE.md"
SELF_CHECK_PATH = "skills/_shared/protocols/self-check.md"
SENSITIVE_PATH = "skills/_shared/protocols/sensitive-file-protection.md"
DRYRUN_PATH = "skills/_shared/protocols/dryrun-interceptor.md"


@pytest.fixture
def guardrail_content():
    with open(GUARDRAIL_PATH, "r") as f:
        return f.read()


# --- File existence ---
def test_guardrail_file_exists():
    assert os.path.exists(GUARDRAIL_PATH), "guardrail.md not found"


# --- All 13 rule categories present ---
def test_guardrail_has_destructive_file_ops(guardrail_content):
    assert "### 1. Destructive File Operations" in guardrail_content


def test_guardrail_has_sensitive_file_access(guardrail_content):
    assert "### 2. Sensitive File Access" in guardrail_content


def test_guardrail_has_remote_code_execution(guardrail_content):
    assert "### 3. Remote Code Execution" in guardrail_content


def test_guardrail_has_publishing_release(guardrail_content):
    assert "### 4. Publishing / Release" in guardrail_content


def test_guardrail_has_scope_enforcement(guardrail_content):
    assert "### 5. Scope Enforcement" in guardrail_content


def test_guardrail_has_dry_run_mode(guardrail_content):
    assert "### 6. Dry Run Mode" in guardrail_content


def test_guardrail_has_path_traversal(guardrail_content):
    assert "### 7. Path Traversal" in guardrail_content


def test_guardrail_has_symlink_safety(guardrail_content):
    assert "### 8. Symlink Safety" in guardrail_content


def test_guardrail_has_credential_content(guardrail_content):
    assert "### 9. Credential Content Detection" in guardrail_content


def test_guardrail_has_resource_exhaustion(guardrail_content):
    assert "### 10. Resource Exhaustion" in guardrail_content


def test_guardrail_has_env_persistence(guardrail_content):
    assert "### 11. Environment Persistence" in guardrail_content


def test_guardrail_has_network_exfiltration(guardrail_content):
    assert "### 12. Network Exfiltration" in guardrail_content


def test_guardrail_has_supply_chain(guardrail_content):
    assert "### 13. Supply Chain Safety" in guardrail_content


def test_guardrail_has_documentation_continuity(guardrail_content):
    content = guardrail_content.lower()
    assert "### 14. documentation continuity" in content
    assert "project-state" in content
    assert "forge docs gate" in content
    assert "generated html/css must never be hand-edited" in content


# --- Decision matrix is complete ---
def test_guardrail_decision_matrix_has_new_rows(guardrail_content):
    for rule in [
        "Path traversal",
        "Symlink targets",
        "Credential in content",
        "Resource exhaustion",
        "Env persistence",
        "Network exfiltration",
        "Supply chain",
        "Documentation continuity",
    ]:
        assert rule in guardrail_content, f"Decision matrix missing: {rule}"


# --- Contradictions fixed ---
def test_guardrail_no_vietnamese_text(guardrail_content):
    # Check for Vietnamese characters
    vietnamese_phrase = "Thực thi thành công"
    assert vietnamese_phrase not in guardrail_content, (
        "Vietnamese text should be replaced with English"
    )


def test_guardrail_fail_closed_for_security(guardrail_content):
    assert (
        "fail-closed" in guardrail_content.lower()
        or "DENY (fail-closed)" in guardrail_content
    ), "Guardrail must specify fail-closed for security rules"


def test_guardrail_read_ops_exception(guardrail_content):
    assert (
        "except" in guardrail_content.split("NOT applied")[1].split("\n")[0].lower()
    ), "Line 10 must note the exception for sensitive file reads"


# --- Kernel references ---
def test_guardrail_in_kernel_entry():
    with open(ENTRY_PATH, "r") as f:
        content = f.read()
    assert "guardrail" in content.lower(), "ENTRY.md must reference guardrail"


def test_guardrail_in_kernel_solve():
    with open(SOLVE_PATH, "r") as f:
        content = f.read()
    assert "guardrail" in content.lower(), "SOLVE.md must reference guardrail"


def test_guardrail_in_kernel_audit():
    with open(AUDIT_PATH, "r") as f:
        content = f.read()
    assert "guardrail" in content.lower(), "AUDIT.md must reference guardrail"


def test_guardrail_in_kernel_escalate():
    with open(ESCALATE_PATH, "r") as f:
        content = f.read()
    assert (
        "guardrail" in content.lower() or "Guardrail" in open(ESCALATE_PATH).read()
    ), "ESCALATE.md must reference guardrail"


# --- Cross-references ---
def test_guardrail_in_self_check():
    with open(SELF_CHECK_PATH, "r") as f:
        content = f.read()
    assert "Guardrail" in content or "guardrail" in content, (
        "self-check.md must reference guardrail"
    )


def test_sensitive_file_references_guardrail():
    with open(SENSITIVE_PATH, "r") as f:
        content = f.read()
    assert "Guardrail" in content or "guardrail" in content, (
        "sensitive-file-protection.md must reference guardrail"
    )


def test_no_forgenexus_in_dryrun():
    with open(DRYRUN_PATH, "r") as f:
        content = f.read()
    assert "ForgeNexus" not in content, (
        "dryrun-interceptor.md should use GitNexus, not ForgeNexus"
    )
    assert "GitNexus" in content, "dryrun-interceptor.md should reference GitNexus"


# --- Git credentials added to Rule 2 ---
def test_guardrail_has_git_credentials(guardrail_content):
    assert ".git/config" in guardrail_content, (
        "Rule 2 must include .git/config in sensitive file patterns"
    )
    assert ".git-credentials" in guardrail_content, (
        "Rule 2 must include .git-credentials in sensitive file patterns"
    )
