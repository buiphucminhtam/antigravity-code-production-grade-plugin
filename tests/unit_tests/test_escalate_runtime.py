import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ESCALATE = ROOT / "scripts" / "lite" / "escalate.sh"


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _base_project(tmp_path: Path) -> tuple[Path, Path, dict[str, str]]:
    project = tmp_path / "project"
    project.mkdir()
    (project / ".production-grade.yaml").write_text(
        """expertMode:
  activeCli: "codex"
  fallbackCli: null
  budget:
    maxExpertCallsPerRun: 12
    requireConfirmationAbove: 3
""",
        encoding="utf-8",
    )

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    lease_log = tmp_path / "lease.log"
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{fake_bin}:{env['PATH']}",
            "PROJECT_ROOT": str(project),
            "FORGEWRIGHT_ESCALATION_TIMEOUT_SECS": "1",
            "FORGEWRIGHT_RUNTIME_LEASE_CLI": str(fake_bin / "runtime-lease.sh"),
            "LEASE_LOG": str(lease_log),
            "FW_RUN_ID": "runtime-test",
        }
    )
    return project, fake_bin, env


def test_escalation_times_out_provider_and_releases_lease(tmp_path: Path) -> None:
    project, fake_bin, env = _base_project(tmp_path)
    _write_executable(fake_bin / "codex", "#!/usr/bin/env bash\nsleep 10\n")
    _write_executable(
        fake_bin / "runtime-lease.sh",
        """#!/usr/bin/env bash
printf '%s\n' "$*" >> "$LEASE_LOG"
if [[ "$1" == "acquire" ]]; then
  printf 'rlg-test-timeout\n'
fi
""",
    )

    started = time.monotonic()
    result = subprocess.run(
        ["bash", str(ESCALATE), "bounded provider test"],
        cwd=project,
        env=env,
        text=True,
        capture_output=True,
        check=False,
        timeout=6,
    )
    elapsed = time.monotonic() - started

    assert result.returncode == 124, result.stdout + result.stderr
    assert elapsed < 5
    assert "timed out after 1s" in result.stderr
    lease_calls = Path(env["LEASE_LOG"]).read_text(encoding="utf-8")
    assert "acquire" in lease_calls
    assert "release --lease rlg-test-timeout" in lease_calls


def test_escalation_does_not_start_provider_without_lease(tmp_path: Path) -> None:
    project, fake_bin, env = _base_project(tmp_path)
    provider_started = tmp_path / "provider-started"
    _write_executable(
        fake_bin / "codex",
        f"#!/usr/bin/env bash\nprintf started > '{provider_started}'\n",
    )
    _write_executable(
        fake_bin / "runtime-lease.sh",
        """#!/usr/bin/env bash
printf '%s\n' "$*" >> "$LEASE_LOG"
exit 1
""",
    )

    result = subprocess.run(
        ["bash", str(ESCALATE), "lease failure test"],
        cwd=project,
        env=env,
        text=True,
        capture_output=True,
        check=False,
        timeout=6,
    )

    assert result.returncode == 125, result.stdout + result.stderr
    assert "Runtime Lifecycle Guard lease acquisition failed" in result.stderr
    assert not provider_started.exists()
