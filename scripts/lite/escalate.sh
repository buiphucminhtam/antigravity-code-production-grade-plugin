#!/usr/bin/env bash
# scripts/lite/escalate.sh
# Builds context packets (task, evidence, diff, slices) and delegates to configured expert CLI.
# Supported CLIs: agy (--print), claude (-p/--print), codex (exec <prompt>), gemini (-p/--prompt)
# Budget enforcement: reads expertMode.budget from .production-grade.yaml
# Output: .forgewright/escalations/<timestamp>-<short-task>.json
# Secrets are redacted before any packet is written.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Respect a pre-existing PROJECT_ROOT (e.g., set by test harness or CI).
# Only compute from script path when not already exported.
: "${PROJECT_ROOT:="$(cd "$SCRIPT_DIR/../.." && pwd)"}"
export PROJECT_ROOT


python3 - "$@" << 'PYEOF'
import sys
import os
import subprocess
import json
import re
import shlex
import signal
import tempfile
import time
import shutil

# ---------------------------------------------------------------------------
# Config: read expertMode from .production-grade.yaml (no yaml lib required)
# ---------------------------------------------------------------------------

def _yaml_scalar(text, key):
    """Extract a scalar value from a YAML block without a YAML parser."""
    # Match key: value or key: "value"
    m = re.search(
        r'(?m)^[ \t]*' + re.escape(key) + r':\s*(?:"([^"]*?)"|\'([^\']*?)\'|([^\n#]*))',
        text
    )
    if not m:
        return None
    val = (m.group(1) or m.group(2) or m.group(3) or "").strip()
    return val if val not in ("null", "~", "") else None


def _yaml_int(text, key, default):
    v = _yaml_scalar(text, key)
    try:
        return int(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def load_config():
    config_path = os.path.join(os.environ.get("PROJECT_ROOT", "."), ".production-grade.yaml")
    defaults = {
        "activeCli": "agy",
        "fallbackCli": None,
        "maxExpertCallsPerRun": 5,
        "requireConfirmationAbove": 3,
        "providerTimeoutSeconds": 120,
    }
    if not os.path.exists(config_path):
        return defaults

    try:
        with open(config_path, "r") as f:
            text = f.read()
        # Only read inside the expertMode block (stop at next top-level key)
        block_m = re.search(r'(?m)^expertMode:\s*\n((?:[ \t]+.*\n?)*)', text)
        block = block_m.group(0) if block_m else text

        active  = _yaml_scalar(block, "activeCli")  or defaults["activeCli"]
        fallback = _yaml_scalar(block, "fallbackCli")

        budget_block_m = re.search(r'(?m)^[ \t]*budget:\s*\n((?:[ \t]+.*\n?)*)', block)
        budget_block = budget_block_m.group(0) if budget_block_m else ""

        max_calls = _yaml_int(budget_block, "maxExpertCallsPerRun", defaults["maxExpertCallsPerRun"])
        req_confirm = _yaml_int(budget_block, "requireConfirmationAbove", defaults["requireConfirmationAbove"])
        provider_timeout = _yaml_int(
            block,
            "providerTimeoutSeconds",
            defaults["providerTimeoutSeconds"],
        )

        return {
            "activeCli":              active,
            "fallbackCli":            fallback if fallback else None,
            "maxExpertCallsPerRun":   max_calls,
            "requireConfirmationAbove": req_confirm,
            "providerTimeoutSeconds": provider_timeout,
        }
    except Exception:
        return defaults


# ---------------------------------------------------------------------------
# Budget tracking
# ---------------------------------------------------------------------------

def escalation_log_dir():
    root = os.environ.get("PROJECT_ROOT", ".")
    d = os.path.join(root, ".forgewright", "escalations")
    os.makedirs(d, exist_ok=True)
    return d


def count_prior_escalations():
    """Count escalation records created this run (env-keyed so tests can reset)."""
    log_dir = escalation_log_dir()
    run_id = os.environ.get("FW_RUN_ID", "")
    if not run_id:
        # Use today's date as a coarse run boundary
        run_id = time.strftime("%Y%m%d")
    count = 0
    try:
        for fname in os.listdir(log_dir):
            if fname.startswith(run_id) and fname.endswith(".json"):
                count += 1
    except OSError:
        pass
    return count


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------

SECRET_PATTERNS = [
    # Generic high-entropy tokens / keys
    (re.compile(r'(?i)(api[_-]?key|secret|token|password|auth)\s*[:=]\s*\S+'), r'\1=***REDACTED***'),
    # Environment variable assignments with secrets
    (re.compile(r'(?i)\b(OPENAI|ANTHROPIC|GOOGLE|GITHUB|AWS|AZURE)_[A-Z_]*(?:KEY|TOKEN|SECRET)\s*=\s*\S+'),
     r'\g<0>***REDACTED***'),
    # Bearer / Basic auth headers
    (re.compile(r'(?i)(Authorization:\s*(?:Bearer|Basic)\s+)\S+'), r'\1***REDACTED***'),
    # Hex or base64-looking 32+ char strings after = or :
    (re.compile(r'(?<=[=:])([A-Za-z0-9+/]{32,}={0,2})'), '***REDACTED***'),
]


def redact(text):
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


# ---------------------------------------------------------------------------
# Evidence: read real current-turn files from .forgewright/verify/
# ---------------------------------------------------------------------------

def get_evidence():
    root = os.environ.get("PROJECT_ROOT", ".")
    verify_dir = os.path.join(root, ".forgewright", "verify")
    slices = []
    if os.path.isdir(verify_dir):
        # Read files sorted by mtime desc (most recent first), up to 3
        try:
            entries = sorted(
                [os.path.join(verify_dir, f) for f in os.listdir(verify_dir)
                 if os.path.isfile(os.path.join(verify_dir, f))],
                key=os.path.getmtime,
                reverse=True
            )[:3]
            for path in entries:
                try:
                    with open(path, "r", errors="replace") as fh:
                        raw = fh.read(4000)   # cap per-file slice
                    slices.append({"file": os.path.basename(path), "content": redact(raw)})
                except OSError:
                    pass
        except OSError:
            pass

    if slices:
        return slices
    # Fallback: no verify files yet — report that explicitly so downstream tooling
    # knows the evidence is genuinely empty rather than a placeholder.
    return [{"file": "(none)", "content": "No .forgewright/verify files found for this turn."}]


# ---------------------------------------------------------------------------
# Git diff (redacted)
# ---------------------------------------------------------------------------

def get_git_diff():
    try:
        diff = subprocess.check_output(
            ["git", "diff", "HEAD"], text=True, stderr=subprocess.DEVNULL
        )
        return redact(diff[:10000])
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# CLI argv builders — use only validated, documented flags
# ---------------------------------------------------------------------------

CLI_ARGV = {
    # Expert escalation is advisory/read-only. Keep Antigravity sandboxed and
    # force plan mode even when the user's persisted default permits edits.
    "agy":    lambda prompt: ["agy", "--sandbox", "--mode", "plan", "--print", prompt],
    # claude -p <prompt>     (documented: -p / --print)
    "claude": lambda prompt: ["claude", "-p", prompt],
    # codex exec <prompt>    (documented: codex exec [PROMPT])
    "codex":  lambda prompt: ["codex", "exec", prompt],
    # gemini -p <prompt>     (documented: -p / --prompt non-interactive)
    "gemini": lambda prompt: ["gemini", "-p", prompt],
}

KNOWN_CLIS = set(CLI_ARGV.keys())


def build_argv(cli, prompt):
    if cli in CLI_ARGV:
        return CLI_ARGV[cli](prompt)
    raise ValueError(f"Unknown CLI '{cli}'. Supported: {sorted(KNOWN_CLIS)}")


def provider_timeout_seconds(cfg):
    raw = os.environ.get("FORGEWRIGHT_ESCALATION_TIMEOUT_SECS")
    try:
        value = int(raw) if raw is not None else int(cfg["providerTimeoutSeconds"])
    except (KeyError, TypeError, ValueError):
        value = 120
    return max(1, min(value, 3600))


def runtime_lease_cli():
    override = os.environ.get("FORGEWRIGHT_RUNTIME_LEASE_CLI")
    if override:
        return override
    root = os.environ.get("PROJECT_ROOT", ".")
    return os.path.join(root, "scripts", "runtime", "runtime-lease.sh")


def acquire_runtime_lease(pid, argv, timeout_seconds):
    lease_cli = runtime_lease_cli()
    if not os.path.isfile(lease_cli):
        return None, f"Runtime Lifecycle Guard CLI not found: {lease_cli}"
    command = [
        "bash",
        lease_cli,
        "acquire",
        "--role",
        "aux2",
        "--project",
        os.path.realpath(os.environ.get("PROJECT_ROOT", ".")),
        "--pid",
        str(pid),
        "--port",
        "0",
        "--ttl",
        str(timeout_seconds + 30),
        "--policy",
        "reap",
        "--cmd",
        shlex.join(argv),
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)
    if result.returncode != 0 or not result.stdout.strip():
        detail = result.stderr.strip() or f"exit code {result.returncode}"
        return None, detail
    return result.stdout.strip().splitlines()[-1], None


def release_runtime_lease(lease_id, reason):
    if not lease_id:
        return
    try:
        result = subprocess.run(
            [
                "bash",
                runtime_lease_cli(),
                "release",
                "--lease",
                lease_id,
                "--reason",
                reason,
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            print(
                f"[ESCALATE] WARNING: failed to release lease {lease_id}: "
                f"{result.stderr.strip() or result.returncode}",
                file=sys.stderr,
            )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(
            f"[ESCALATE] WARNING: failed to release lease {lease_id}: {exc}",
            file=sys.stderr,
        )


def terminate_leased_process(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    proc.wait(timeout=5)


def run_provider(argv, env, timeout_seconds):
    # The child waits behind a pipe barrier until its RLG lease is recorded.
    # If leasing fails, closing the pipe exits the wrapper without starting the provider.
    wrapper = [
        "bash",
        "-c",
        'IFS= read -r _ || exit 125; exec "$@"',
        "forgewright-provider",
        *argv,
    ]
    proc = subprocess.Popen(
        wrapper,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        start_new_session=True,
    )
    lease_id, lease_error = acquire_runtime_lease(proc.pid, argv, timeout_seconds)
    if not lease_id:
        if proc.stdin is not None:
            proc.stdin.close()
            proc.stdin = None
        stdout, stderr = proc.communicate(timeout=5)
        message = (
            "[ESCALATE] ERROR: Runtime Lifecycle Guard lease acquisition failed; "
            f"provider was not started: {lease_error}\n"
        )
        return subprocess.CompletedProcess(argv, 125, stdout, (stderr or "") + message)

    if proc.stdin is not None:
        proc.stdin.write("start\n")
        proc.stdin.close()
        proc.stdin = None

    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout_seconds)
        return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)
    except subprocess.TimeoutExpired:
        timed_out = True
        terminate_leased_process(proc)
        stdout, stderr = proc.communicate()
        message = f"[ESCALATE] ERROR: provider timed out after {timeout_seconds}s.\n"
        return subprocess.CompletedProcess(argv, 124, stdout, (stderr or "") + message)
    finally:
        release_runtime_lease(
            lease_id, "provider-timeout" if timed_out else "provider-exited"
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = list(sys.argv[1:])
    is_dry_run = "--dry-run" in args
    if is_dry_run:
        args.remove("--dry-run")

    task_desc = " ".join(args) if args else ""
    if not task_desc and not sys.stdin.isatty():
        task_desc = sys.stdin.read().strip()
    if not task_desc:
        task_desc = "No task provided."

    cfg = load_config()
    active_cli  = cfg["activeCli"]
    fallback_cli = cfg["fallbackCli"]
    max_calls   = cfg["maxExpertCallsPerRun"]
    req_confirm = cfg["requireConfirmationAbove"]
    provider_timeout = provider_timeout_seconds(cfg)

    # Validate CLI name early
    if active_cli not in KNOWN_CLIS:
        print(
            f"[ESCALATE] ERROR: activeCli '{active_cli}' is not a supported CLI.\n"
            f"  Supported: {sorted(KNOWN_CLIS)}\n"
            f"  Set expertMode.activeCli in .production-grade.yaml.",
            file=sys.stderr
        )
        sys.exit(1)

    # Budget check
    prior = count_prior_escalations()
    if prior >= max_calls:
        print(
            f"[ESCALATE] BUDGET EXCEEDED: {prior}/{max_calls} expert calls used this run.\n"
            f"  Pausing. Security / schema / public-interface work must wait for user approval.\n"
            f"  Raise expertMode.budget.maxExpertCallsPerRun in .production-grade.yaml to continue.",
            file=sys.stderr
        )
        sys.exit(2)

    if prior >= req_confirm:
        print(
            f"[ESCALATE] CONFIRMATION REQUIRED: {prior}/{req_confirm} calls used (requireConfirmationAbove).\n"
            f"  Re-run with FW_CONFIRM=1 to proceed.",
            file=sys.stderr
        )
        if os.environ.get("FW_CONFIRM") != "1":
            sys.exit(3)

    # Build context packet (diff + evidence redacted)
    evidence_slices = get_evidence()
    git_diff = get_git_diff()

    packet = {
        "task":            task_desc,
        "evidence":        evidence_slices,
        "diff":            git_diff,
        "relevant_slices": [],       # populated by caller if needed
    }

    packet_json = json.dumps(packet, indent=2)

    # Dry-run: print argv and packet, do not call out
    if is_dry_run:
        argv = build_argv(active_cli, task_desc)
        print("[DRY RUN] Context Packet:")
        print(packet_json)
        print(f"[DRY RUN] Would execute argv: {argv}")
        print(f"[DRY RUN] Budget: {prior}/{max_calls} calls used. reqConfirm threshold: {req_confirm}.")
        print(f"[DRY RUN] Provider timeout: {provider_timeout}s.")
        print(f"[DRY RUN] Escalation log dir: {escalation_log_dir()}")
        sys.exit(0)

    # Write packet to temp file (keeps prompt off argv and out of ps output)
    tmp_fd, packet_file = tempfile.mkstemp(suffix=".json", prefix="fw-escalate-")
    try:
        with os.fdopen(tmp_fd, "w") as fh:
            fh.write(packet_json)
        tmp_fd = None  # fdopen took ownership

        # Prompt: inject the full packet JSON as the CLI prompt text
        prompt_text = (
            f"[Forgewright Escalation]\nTask: {task_desc}\n\n"
            f"Evidence:\n{json.dumps(evidence_slices, indent=2)}\n\n"
            f"Diff (redacted):\n{git_diff[:3000] if git_diff else '(none)'}"
        )

        argv = build_argv(active_cli, prompt_text)
        print(f"[ESCALATE] CLI: {argv[0]}, budget {prior+1}/{max_calls}, packet: {packet_file}")

        start_time = time.time()
        delegation_env = os.environ.copy()
        delegation_env["FORGEWRIGHT_WORKSPACE"] = os.path.realpath(
            os.environ.get("PROJECT_ROOT", ".")
        )
        result = run_provider(argv, delegation_env, provider_timeout)
        latency_ms = int((time.time() - start_time) * 1000)

        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)

        # Persist escalation record to .forgewright/escalations/
        log_dir = escalation_log_dir()
        run_id  = os.environ.get("FW_RUN_ID", time.strftime("%Y%m%d"))
        safe_task = re.sub(r'[^A-Za-z0-9_-]', '-', task_desc[:40])
        record_path = os.path.join(log_dir, f"{run_id}-{int(time.time())}-{safe_task}.json")

        record = {
            "timestamp":  time.time(),
            "cli":        active_cli,
            "task":       task_desc,
            "argv":       argv,
            "exit_code":  result.returncode,
            "latency_ms": latency_ms,
            "timeout_seconds": provider_timeout,
            "timed_out": result.returncode == 124,
        }
        with open(record_path, "w") as fh:
            json.dump(record, fh, indent=2)

        print(f"[ESCALATE] Done in {latency_ms}ms. Record: {record_path}")

        # Try fallback CLI on non-zero exit
        if (
            result.returncode not in (0, 125)
            and fallback_cli
            and fallback_cli in KNOWN_CLIS
        ):
            print(f"[ESCALATE] Primary CLI exited {result.returncode}. Trying fallback: {fallback_cli}.")
            fallback_argv = build_argv(fallback_cli, prompt_text)
            fb_result = run_provider(
                fallback_argv, delegation_env, provider_timeout
            )
            print(fb_result.stdout)
            if fb_result.stderr:
                print(fb_result.stderr, file=sys.stderr)
            sys.exit(fb_result.returncode)

        sys.exit(result.returncode)

    except FileNotFoundError:
        print(
            f"[ESCALATE] ERROR: CLI '{active_cli}' not found in PATH.",
            file=sys.stderr
        )
        sys.exit(1)
    finally:
        # Clean up temp packet file reliably
        if tmp_fd is not None:
            try:
                os.close(tmp_fd)
            except OSError:
                pass
        if os.path.exists(packet_file):
            try:
                os.remove(packet_file)
            except OSError:
                pass


if __name__ == "__main__":
    main()
PYEOF
