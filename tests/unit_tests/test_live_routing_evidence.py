import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "evals" / "routing" / "live_evidence.py"


def _adapter(path: Path) -> None:
    path.write_text(
        """import hashlib, hmac, json, os, sys
request = json.load(sys.stdin)
kind = os.environ['ADAPTER_KIND']
if kind == 'router':
    tier = request['expected_tier']
    print(json.dumps({'initial_tier': tier, 'selected_tier': tier, 'escalation_count': 0}))
elif kind == 'provider':
    print(json.dumps({'output': 'verified-output', 'provider': 'fixture', 'model': 'fixture-model',
      'resolved_snapshot': 'fixture-model-v1', 'execution_id': request['role'] + '-' + request['task_id'],
      'cost': 1.0 if request['role'] == 'baseline' else 0.5, 'cost_unit': 'usd'}))
elif kind == 'verifier':
    print(json.dumps({'passed': True, 'safety_regression': False, 'verifier': 'fixture-verifier',
      'resolved_snapshot': 'fixture-verifier-v1', 'execution_id': request['role'] + '-' + request['task_id']}))
else:
    evidence = request['evidence']
    payload = json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    print(json.dumps({'attestation_hmac_sha256': hmac.new(b'x' * 32, payload, hashlib.sha256).hexdigest()}))
""",
        encoding="utf-8",
    )


def test_canary_runner_produces_attested_gate_accepted_receipt(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter.py"
    output = tmp_path / "receipt.json"
    _adapter(adapter)
    command = json.dumps([sys.executable, str(adapter)])
    env = {
        **os.environ,
        "FORGEWRIGHT_LIVE_ROUTING": "1",
    }
    result = subprocess.run(
        [
            sys.executable,
            str(RUNNER),
            "canary",
            "--router-command-json",
            command,
            "--provider-command-json",
            command,
            "--verifier-command-json",
            command,
            "--attester-command-json",
            command,
            "--output",
            str(output),
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    receipt = json.loads(output.read_text(encoding="utf-8"))
    assert len(receipt["records"]) == 10
    assert "prompt" not in json.dumps(receipt)
    assert "verified-output" not in json.dumps(receipt)
    gate = subprocess.run(
        [
            sys.executable,
            str(ROOT / "evals" / "routing" / "control_plane.py"),
            str(output),
        ],
        cwd=ROOT,
        env={**os.environ, "FORGEWRIGHT_ROUTING_EVIDENCE_KEY": "x" * 32},
        capture_output=True,
        text=True,
        check=False,
    )
    assert gate.returncode == 0, gate.stderr
    assert json.loads(gate.stdout)["canary_passed"] is True


def test_runner_is_opt_in_and_fails_closed_on_metadata_drift(tmp_path: Path) -> None:
    adapter = tmp_path / "adapter.py"
    _adapter(adapter)
    command = json.dumps([sys.executable, str(adapter)])
    result = subprocess.run(
        [
            sys.executable,
            str(RUNNER),
            "shadow",
            "--router-command-json",
            command,
            "--provider-command-json",
            command,
            "--verifier-command-json",
            command,
            "--attester-command-json",
            command,
            "--output",
            str(tmp_path / "receipt.json"),
        ],
        cwd=ROOT,
        env={**os.environ, "FORGEWRIGHT_ROUTING_EVIDENCE_KEY": "x" * 32},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "FORGEWRIGHT_LIVE_ROUTING=1" in result.stderr


def test_adapter_stderr_cannot_leak_into_runner_error(tmp_path: Path) -> None:
    adapter = tmp_path / "failing.py"
    adapter.write_text(
        "import sys; sys.stderr.write('SECRET-PROMPT'); raise SystemExit(9)\n",
        encoding="utf-8",
    )
    command = json.dumps([sys.executable, str(adapter)])
    result = subprocess.run(
        [
            sys.executable,
            str(RUNNER),
            "shadow",
            "--router-command-json",
            command,
            "--provider-command-json",
            command,
            "--verifier-command-json",
            command,
            "--attester-command-json",
            command,
            "--output",
            str(tmp_path / "receipt.json"),
        ],
        cwd=ROOT,
        env={**os.environ, "FORGEWRIGHT_LIVE_ROUTING": "1"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "SECRET-PROMPT" not in result.stderr
    assert "stderr suppressed" in result.stderr
