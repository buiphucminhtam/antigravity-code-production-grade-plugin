#!/usr/bin/env python3
"""
Forgewright Memory Middleware
============================
Automatic memory checkpoint system for cross-IDE compatibility.
Works with Claude Code, Cursor, VS Code, JetBrains, etc.

Triggers:
  - Material scope or decision change
  - Material verifier result
  - Supported pre-compaction event or handoff
  - Stuck/block or terminal boundary
  - Manual trigger

Usage:
  python3 memory-middleware.py tick          # Increment message count
  python3 memory-middleware.py checkpoint   # Force save
  python3 memory-middleware.py resume       # Load context + handover
  python3 memory-middleware.py status       # Show status
  python3 memory-middleware.py handover     # Generate handover document
  python3 memory-middleware.py start        # Initialize session
  python3 memory-middleware.py daemon       # Run as background daemon

Environment Variables:
  MEMORY_CHECKPOINT_INTERVAL: Messages between checkpoints (default: 3)
  MEMORY_TOKEN_THRESHOLD_WARN: Warning threshold % (default: 80)
  MEMORY_TOKEN_THRESHOLD_CRITICAL: Critical threshold % (default: 95)
  MEMORY_DB_DIR: Session storage directory
  FORGEWRIGHT_WORKSPACE: Override workspace root detection
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ────────────────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────────────────

HOME = Path.home()


def _resolve_workspace_root() -> Path:
    """Resolve canonical workspace root using git."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return Path(result.stdout.strip())
    except Exception:
        pass
    cwd = Path.cwd()
    if ".git" in (cwd / ".git").read_text() if (cwd / ".git").exists() else False:
        return cwd
    return cwd


WORKSPACE_ROOT = Path(
    os.environ.get("FORGEWRIGHT_WORKSPACE", str(_resolve_workspace_root()))
)
_MEMORY_DB_OVERRIDE = os.environ.get("MEMORY_DB_DIR", "").strip()
_WORKSPACE_MEMORY_ROOT = WORKSPACE_ROOT / ".forgewright" / "runtime" / "memory"
MEMORY_DB_DIR = (
    Path(_MEMORY_DB_OVERRIDE).expanduser()
    if _MEMORY_DB_OVERRIDE
    else _WORKSPACE_MEMORY_ROOT
)
SESSION_FILE = MEMORY_DB_DIR / "current-session.json"

# Canonical absolute paths for workspace-relative files
SUMMARY_FILE = (
    WORKSPACE_ROOT / ".forgewright" / "subagent-context" / "CONVERSATION_SUMMARY.md"
)
HANDOVER_DIR = (
    MEMORY_DB_DIR.parent / "memory-bank"
    if _MEMORY_DB_OVERRIDE
    else MEMORY_DB_DIR / "memory-bank"
)
HANDOVER_FILE = HANDOVER_DIR / "HANDOVER.md"

# session-log.json path resolution
# Resolution: FORGEWRIGHT_SESSION_LOG env > project-local runtime state.
FORGEWRIGHT_SESSION_LOG = os.environ.get("FORGEWRIGHT_SESSION_LOG", "")


def get_session_log_path() -> Path:
    """Resolve session-log.json location with env override.

    Resolution order:
      1. FORGEWRIGHT_SESSION_LOG env var (highest priority)
      2. project-local .forgewright/runtime/memory/session-log.json
    """
    if FORGEWRIGHT_SESSION_LOG:
        return Path(FORGEWRIGHT_SESSION_LOG)

    return MEMORY_DB_DIR / "session-log.json"


SESSION_LOG = get_session_log_path()

# activeContext.md path
ACTIVE_CONTEXT_FILE = HANDOVER_DIR / "activeContext.md"

# Simulated token usage (0-100 scale)
# In production, this would be estimated from actual context usage
_simulated_token_pct = 0

CHECKPOINT_INTERVAL = int(os.environ.get("MEMORY_CHECKPOINT_INTERVAL", "3"))
# Token thresholds: WARN at 80%, CRITICAL at 95%
TOKEN_THRESHOLD_WARN = int(os.environ.get("MEMORY_TOKEN_THRESHOLD_WARN", "80"))
TOKEN_THRESHOLD_CRITICAL = int(os.environ.get("MEMORY_TOKEN_THRESHOLD_CRITICAL", "95"))


def parse_iso_datetime(dt_str: str) -> datetime:
    """Safely parse ISO 8601 datetime strings, handling 'Z' suffix and double offsets."""
    clean_str = dt_str
    if clean_str.endswith("Z"):
        clean_str = clean_str[:-1]
        if not re.search(r"[-+]\d{2}:\d{2}$", clean_str):
            clean_str += "+00:00"
    # Deduplicate double offsets if any
    clean_str = re.sub(r"(\+\d{2}:\d{2})\+\d{2}:\d{2}$", r"\1", clean_str)
    clean_str = re.sub(r"(-\d{2}:\d{2})-\d{2}:\d{2}$", r"\1", clean_str)
    return datetime.fromisoformat(clean_str)


# ────────────────────────────────────────────────────────────────────────────
# Colors (for terminal output)
# ────────────────────────────────────────────────────────────────────────────


class Colors:
    GREEN = "\033[0;32m"
    YELLOW = "\033[1;33m"
    RED = "\033[0;31m"
    BLUE = "\033[0;34m"
    NC = "\033[0m"


def log(msg: str, color: str = Colors.GREEN):
    print(f"{color}[memory-middleware]{Colors.NC} {msg}")


def warn(msg: str):
    print(
        f"{Colors.YELLOW}[memory-middleware]{Colors.NC} WARNING: {msg}", file=sys.stderr
    )


def error(msg: str):
    print(f"{Colors.RED}[memory-middleware]{Colors.NC} ERROR: {msg}", file=sys.stderr)


# ────────────────────────────────────────────────────────────────────────────
# Session Management
# ────────────────────────────────────────────────────────────────────────────


def get_project_name() -> str:
    """Get project name from git remote."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            name = result.stdout.strip().split("/")[-1]
            return name.replace(".git", "")
    except Exception:
        pass
    return "local-project"


# Track last checkpoint time to prevent rapid double-checkpoints
_last_checkpoint_time: Optional[datetime] = None
_CHECKPOINT_COOLDOWN_SECONDS = 5


def _atomic_write_json(filepath: Path, data: dict) -> None:
    """Write JSON atomically using temp file + rename."""
    tmp = filepath.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2))
        tmp.rename(filepath)
    except OSError as e:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise IOError(f"Failed to write {filepath}: {e}") from e


def init_session() -> dict:
    """Initialize new session with idempotent directory creation."""
    try:
        MEMORY_DB_DIR.mkdir(parents=True, exist_ok=True)
        SUMMARY_FILE.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise RuntimeError(f"Cannot create session directories: {e}") from e

    session = {
        "session_id": f"session-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}",
        "project": get_project_name(),
        "started_at": datetime.now(timezone.utc).isoformat() + "Z",
        "message_count": 0,
        "last_checkpoint_at": datetime.now(timezone.utc).isoformat() + "Z",
        "checkpoints": [],
    }

    _atomic_write_json(SESSION_FILE, session)
    log(f"Session started: {session['session_id']}")
    return session


def load_session() -> dict:
    """Load current session or create new one."""
    if SESSION_FILE.exists():
        try:
            with open(SESSION_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            warn(f"Session file corrupted ({e}), creating new session")
            corrupt_backup = SESSION_FILE.with_suffix(".json.corrupt")
            try:
                SESSION_FILE.rename(corrupt_backup)
            except OSError:
                pass
    return init_session()


def save_session(session: dict):
    """Save session to file atomically."""
    _atomic_write_json(SESSION_FILE, session)


# ────────────────────────────────────────────────────────────────────────────
# Token Threshold Hooks (NEW v8.1)
# ────────────────────────────────────────────────────────────────────────────


def get_simulated_token_pct() -> int:
    """Get simulated token percentage for testing."""
    return _simulated_token_pct


def set_simulated_token_pct(pct: int):
    """Set simulated token percentage for testing."""
    global _simulated_token_pct
    _simulated_token_pct = max(0, min(100, pct))


def check_token_threshold() -> tuple[bool, bool]:
    """
    Check if token threshold is reached.
    Returns: (should_warn, should_handover)
    - should_warn: True if >= WARN threshold (80%)
    - should_handover: True if >= CRITICAL threshold (95%)
    """
    pct = get_simulated_token_pct()
    should_warn = pct >= TOKEN_THRESHOLD_WARN
    should_handover = pct >= TOKEN_THRESHOLD_CRITICAL
    return should_warn, should_handover


def log_token_warning():
    """Log warning about token usage."""
    pct = get_simulated_token_pct()
    log(f"⧖ Token usage at {pct}% — consider checkpoint", Colors.YELLOW)


# ────────────────────────────────────────────────────────────────────────────
# Handover Generation (NEW v8.1)
# ────────────────────────────────────────────────────────────────────────────


def generate_handover(
    goals: str = "", next_steps: str = "", decisions: str = "", blockers: str = ""
) -> Optional[str]:
    """
    Generate a handover document from current session state.
    Returns the path to the generated handover file, or None on failure.
    """
    try:
        session = load_session()
    except Exception as e:
        warn(f"Could not load session for handover: {e}")
        session = {
            "session_id": "unknown",
            "project": "unknown",
            "checkpoints": [],
            "message_count": 0,
            "last_checkpoint_at": "N/A",
        }

    try:
        HANDOVER_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        error(f"Cannot create handover directory: {e}")
        return None

    previous_handover = load_handover()

    timestamp = datetime.now(timezone.utc)
    date_str = timestamp.strftime("%Y%m%d-%H%M%S")

    completed_items = []
    for cp in session.get("checkpoints", [])[-5:]:
        completed_items.append(f"- {cp.get('summary', cp.get('reason', 'checkpoint'))}")

    content = f"""# Handover Document — {session.get("session_id", "unknown")}

**Generated**: {timestamp.isoformat()}Z
**Version**: 1.0
**Project**: {session.get("project", "unknown")}

## Session Goals
{goals or "_Not specified_"}

## Completed Work
{chr(10).join(completed_items) if completed_items else "_No checkpoints yet_"}

## Key Decisions
{decisions or previous_handover.get("decisions", "_None recorded_") if previous_handover else "_None recorded_"}

## Blockers & Open Questions
{blockers or previous_handover.get("blockers", "_None_") if previous_handover else "_None_"}

## Next Steps
{next_steps or previous_handover.get("next_steps", "_Not specified_") if previous_handover else "_Not specified_"}

## Recent Context
Total checkpoints: {len(session.get("checkpoints", []))}
Last checkpoint: {session.get("last_checkpoint_at", "N/A")}
Messages since checkpoint: {session.get("message_count", 0)}
"""

    try:
        handover_path = HANDOVER_DIR / f"handover-{date_str}.md"
        handover_path.write_text(content)
        HANDOVER_FILE.write_text(content)
        log(f"Handover generated: {handover_path}")
        return str(handover_path)
    except OSError as e:
        error(f"Failed to write handover file: {e}")
        return None


def load_handover() -> Optional[dict]:
    """
    Load the most recent handover document.
    Returns dict with parsed content or None if not found.
    """
    # Try HANDOVER.md first
    if HANDOVER_FILE.exists():
        try:
            content = HANDOVER_FILE.read_text()
            return _parse_handover_content(content)
        except OSError as e:
            warn(f"Could not read HANDOVER.md: {e}")

    # Fallback: find most recent timestamped handover
    if HANDOVER_DIR.exists():
        try:
            handovers = sorted(HANDOVER_DIR.glob("handover-*.md"), reverse=True)
            if handovers:
                try:
                    content = handovers[0].read_text()
                    return _parse_handover_content(content)
                except OSError as e:
                    warn(f"Could not read {handovers[0]}: {e}")
        except OSError as e:
            warn(f"Could not list handover directory: {e}")

    return None


def _parse_handover_content(content: str) -> dict:
    """Parse handover markdown into structured dict."""
    result = {"decisions": [], "blockers": [], "next_steps": [], "raw": content}

    current_section = None
    for line in content.split("\n"):
        line_lower = line.lower().strip()

        if line_lower.startswith("## session goals"):
            current_section = "goals"
            continue
        elif line_lower.startswith("## completed work"):
            current_section = "completed"
            continue
        elif line_lower.startswith("## key decisions"):
            current_section = "decisions"
            continue
        elif line_lower.startswith("## blockers"):
            current_section = "blockers"
            continue
        elif line_lower.startswith("## next steps"):
            current_section = "next_steps"
            continue

        if current_section == "decisions" and line.strip().startswith("-"):
            result["decisions"].append(line.strip())
        elif current_section == "blockers" and line.strip().startswith("-"):
            result["blockers"].append(line.strip())
        elif current_section == "next_steps" and line.strip().startswith("-"):
            result["next_steps"].append(line.strip())

    return result


# ─────────────────────────────────────────────────────────────────────────────
# session-log.json Management (SAVE/Resume)
# ─────────────────────────────────────────────────────────────────────────────


def ensure_session_log() -> dict:
    """Ensure session-log.json exists with valid structure. Returns the log dict."""
    SESSION_LOG.parent.mkdir(parents=True, exist_ok=True)

    if not SESSION_LOG.exists():
        log_data = {"sessions": []}
        with open(SESSION_LOG, "w") as f:
            json.dump(log_data, f, indent=2)

    try:
        with open(SESSION_LOG) as f:
            data = json.load(f)
        if "sessions" not in data:
            data = {"sessions": []}
            with open(SESSION_LOG, "w") as f:
                json.dump(data, f, indent=2)
        return data
    except (json.JSONDecodeError, IOError) as e:
        warn(f"Session log corrupted ({e}), resetting")
        log_data = {"sessions": []}
        with open(SESSION_LOG, "w") as f:
            json.dump(log_data, f, indent=2)
        return log_data


def _mark_sessions_interrupted(log_data: dict):
    """Mark any in_progress sessions as interrupted."""
    now = datetime.now(timezone.utc).isoformat() + "Z"
    for session in log_data.get("sessions", []):
        if session.get("status") == "in_progress":
            session["status"] = "interrupted"
            session["interrupted_at"] = now


def start_session(
    mode: str = "unknown", request: str = "", current_phase: str = None
) -> dict:
    """Start a new session in session-log.json. Returns the new session entry."""
    log_data = ensure_session_log()
    _mark_sessions_interrupted(log_data)

    ts = datetime.now(timezone.utc).isoformat() + "Z"
    session_id = f"session-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}"

    new_session = {
        "session_id": session_id,
        "project": get_project_name(),
        "started_at": ts,
        "last_update": ts,
        "status": "in_progress",
        "mode": mode,
        "request": request,
        "current_phase": current_phase,
        "completed_phases": [],
        "tasks": {},
        "gates": {},
        "errors": [],
        "events": [],
        "quality_scores": [],
        "files_changed": 0,
        "summary": None,
        "next_steps": [],
        "metadata": {"ide": _detect_ide(), "context_pct": 0, "last_message_at": ts},
    }

    log_data["sessions"].append(new_session)

    with open(SESSION_LOG, "w") as f:
        json.dump(log_data, f, indent=2)

    log(f"Session started: {session_id} ({mode})")
    return new_session


def get_current_session() -> dict | None:
    """Get the most recent in_progress session, or None if none exists."""
    log_data = ensure_session_log()
    for session in reversed(log_data.get("sessions", [])):
        if session.get("status") == "in_progress":
            return session
    return None


def get_last_session() -> dict | None:
    """Get the most recent session regardless of status."""
    log_data = ensure_session_log()
    sessions = log_data.get("sessions", [])
    return sessions[-1] if sessions else None


def update_session(**kwargs) -> dict | None:
    """Update the current session with given fields. Returns updated session or None."""
    log_data = ensure_session_log()
    session = None
    for s in reversed(log_data.get("sessions", [])):
        if s.get("status") == "in_progress":
            session = s
            break
    if not session:
        return None

    for key, value in kwargs.items():
        if key in ("current_phase", "mode", "request", "summary", "files_changed"):
            session[key] = value

    session["last_update"] = datetime.now(timezone.utc).isoformat() + "Z"

    log_data["sessions"] = [
        s for s in log_data["sessions"] if s["session_id"] != session["session_id"]
    ]
    log_data["sessions"].append(session)

    with open(SESSION_LOG, "w") as f:
        json.dump(log_data, f, indent=2)

    return session


def add_task(task_id: str, status: str, summary: str = "") -> dict | None:
    """Add or update a task in the current session. Returns the task entry."""
    log_data = ensure_session_log()
    session = None
    for s in reversed(log_data.get("sessions", [])):
        if s.get("status") == "in_progress":
            session = s
            break
    if not session:
        return None

    ts = datetime.now(timezone.utc).isoformat() + "Z"
    task = {"status": status, "summary": summary, "updated_at": ts}
    session["tasks"][task_id] = task
    session["last_update"] = ts

    with open(SESSION_LOG, "w") as f:
        json.dump(log_data, f, indent=2)

    log(f"Task {task_id}: {status} — {summary}")
    return task


def add_event(event_type: str, **kwargs) -> dict | None:
    """Add an event to the current session. Returns the event entry."""
    log_data = ensure_session_log()
    session = None
    for s in reversed(log_data.get("sessions", [])):
        if s.get("status") == "in_progress":
            session = s
            break
    if not session:
        return None

    event = {
        "type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat() + "Z",
        **kwargs,
    }
    session.setdefault("events", []).append(event)
    session["last_update"] = datetime.now(timezone.utc).isoformat() + "Z"

    with open(SESSION_LOG, "w") as f:
        json.dump(log_data, f, indent=2)

    return event


def end_session(summary: str = "", next_steps: list = None) -> dict | None:
    """Mark current session as completed. Returns the finished session."""
    log_data = ensure_session_log()
    session = None
    for s in reversed(log_data.get("sessions", [])):
        if s.get("status") == "in_progress":
            session = s
            break
    if not session:
        warn("No active session to end")
        return None

    ts = datetime.now(timezone.utc).isoformat() + "Z"
    session["status"] = "completed"
    session["completed_at"] = ts
    session["last_update"] = ts
    session["summary"] = summary
    if next_steps:
        session["next_steps"] = next_steps

    start = parse_iso_datetime(session["started_at"])
    end = datetime.now(timezone.utc)
    duration_min = int((end - start).total_seconds() / 60)
    session["duration_minutes"] = duration_min

    with open(SESSION_LOG, "w") as f:
        json.dump(log_data, f, indent=2)

    log(f"Session {session['session_id']} completed ({duration_min} min)")

    update_active_context()
    auto_ingest_session_decisions(session)
    return session


def _detect_ide() -> str:
    """Detect the current IDE from environment."""
    if os.environ.get("CURSOR"):
        return "cursor"
    if os.environ.get("CLAUDE_DESKTOP"):
        return "claude-code"
    if os.environ.get("VSCODE"):
        return "vscode"
    return "unknown"


# ─────────────────────────────────────────────────────────────────────────────
# Memory Operations
# ─────────────────────────────────────────────────────────────────────────────


def auto_ingest_session_decisions(session: dict) -> int:
    """
    Auto-ingest key decisions from completed session into mem0.
    Returns number of decisions ingested.
    """
    ingested = 0
    try:
        script_dir = Path(__file__).parent
        mem0_script = script_dir / "mem0-v2.py"
        if not mem0_script.exists():
            return 0

        session_id = session.get("session_id", "")
        mode = session.get("mode", "unknown")
        summary = session.get("summary", "")
        tasks = session.get("tasks", {})
        next_steps = session.get("next_steps", [])

        # Ingest session summary as a session memory
        if summary:
            cmd = [
                "python3",
                str(mem0_script),
                "add",
                f"SESSION: [{session_id}] | Mode: {mode} | Summary: {summary}",
                "--category",
                "session",
                "--importance",
                "6",
            ]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                ingested += 1

        # Ingest completed tasks
        completed = [
            (tid, t) for tid, t in tasks.items() if t.get("status") == "completed"
        ]
        for tid, task in completed:
            cmd = [
                "python3",
                str(mem0_script),
                "add",
                f"SESSION_TASK: [{session_id}] T{tid} completed: {task.get('summary', '')}",
                "--category",
                "tasks",
                "--importance",
                "5",
            ]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                ingested += 1

        # Ingest next steps
        if next_steps:
            for step in next_steps[:5]:  # Max 5 steps
                cmd = [
                    "python3",
                    str(mem0_script),
                    "add",
                    f"SESSION_NEXT: [{session_id}] {step}",
                    "--category",
                    "tasks",
                    "--importance",
                    "4",
                ]
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                if r.returncode == 0:
                    ingested += 1

        if ingested > 0:
            log(f"Auto-ingested {ingested} decisions from session {session_id}")
        return ingested
    except Exception as e:
        warn(f"Could not auto-ingest session decisions: {e}")
        return 0


def save_graph_nodes_edges(summary: str, checkpoint_id: str):
    """Save episodic/semantic nodes and links in Layer 2 graph memory."""
    try:
        script_dir = Path(__file__).parent
        mem0_script = script_dir / "mem0-v2.py"
        extract_script = script_dir / "checkpoint-extract.sh"
        if not mem0_script.exists():
            return

        # 1. Create Episodic Node for this checkpoint
        cmd = [
            "python3",
            str(mem0_script),
            "graph-add-node",
            checkpoint_id,
            "episodic",
            f"Checkpoint {checkpoint_id}",
            f"Summary: {summary}",
        ]
        subprocess.run(cmd, capture_output=True, text=True, timeout=5)

        # 2. Get current session context
        session = get_current_session()
        if session:
            session_id = session.get("session_id")
            session_title = f"Session {session_id}"
            session_content = f"Request: {session.get('request', '')} | Mode: {session.get('mode', '')}"
            cmd = [
                "python3",
                str(mem0_script),
                "graph-add-node",
                session_id,
                "episodic",
                session_title,
                session_content,
            ]
            subprocess.run(cmd, capture_output=True, text=True, timeout=5)

            # Link checkpoint -> session
            cmd = [
                "python3",
                str(mem0_script),
                "graph-link",
                checkpoint_id,
                session_id,
                "--weight",
                "1.0",
                "--type",
                "part_of",
            ]
            subprocess.run(cmd, capture_output=True, text=True, timeout=5)

            # Save request as a Semantic Node and link to session
            request_text = session.get("request", "")
            if request_text:
                req_node_id = f"req_{session_id}"
                cmd = [
                    "python3",
                    str(mem0_script),
                    "graph-add-node",
                    req_node_id,
                    "semantic",
                    "Session Request",
                    request_text,
                ]
                subprocess.run(cmd, capture_output=True, text=True, timeout=5)

                cmd = [
                    "python3",
                    str(mem0_script),
                    "graph-link",
                    session_id,
                    req_node_id,
                    "--weight",
                    "1.0",
                    "--type",
                    "targets",
                ]
                subprocess.run(cmd, capture_output=True, text=True, timeout=5)

        # 3. Extract changed files / skills / configs from checkpoint-extract.sh
        if extract_script.exists():
            try:
                res = subprocess.run(
                    ["bash", str(extract_script)],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if res.returncode == 0 and res.stdout.strip():
                    data = json.loads(res.stdout)
                    changed_files = data.get("files", [])
                    for filepath in changed_files:
                        if not filepath or not filepath.strip():
                            continue

                        node_layer = "semantic"
                        edge_type = "modifies"
                        node_title = ""

                        if filepath.startswith("skills/"):
                            skill_parts = filepath.split("/")
                            if len(skill_parts) > 1:
                                skill_name = skill_parts[1]
                                node_layer = "procedural"
                                node_title = f"Skill: {skill_name}"
                                node_id = f"skill_{skill_name}"
                                edge_type = "updates_skill"
                            else:
                                continue
                        elif filepath.startswith("scripts/"):
                            script_name = Path(filepath).name
                            node_layer = "procedural"
                            node_title = f"Script: {script_name}"
                            node_id = f"script_{script_name}"
                            edge_type = "updates_script"
                        elif any(
                            filepath.endswith(ext)
                            for ext in [".json", ".yaml", ".yml", ".env"]
                        ):
                            config_name = Path(filepath).name
                            node_layer = "semantic"
                            node_title = f"Config: {config_name}"
                            node_id = f"config_{config_name.replace('.', '_')}"
                            edge_type = "modifies_config"
                        else:
                            file_name = Path(filepath).name
                            node_layer = "semantic"
                            node_title = f"File: {file_name}"
                            node_id = f"file_{file_name.replace('.', '_')}"
                            edge_type = "modifies_file"

                        # Add node to graph
                        cmd = [
                            "python3",
                            str(mem0_script),
                            "graph-add-node",
                            node_id,
                            node_layer,
                            node_title,
                            f"File path: {filepath}",
                        ]
                        subprocess.run(cmd, capture_output=True, text=True, timeout=5)

                        # Link checkpoint -> modified node
                        cmd = [
                            "python3",
                            str(mem0_script),
                            "graph-link",
                            checkpoint_id,
                            node_id,
                            "--weight",
                            "1.0",
                            "--type",
                            edge_type,
                        ]
                        subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            except Exception as ex:
                warn(f"Could not extract files for graph linking: {ex}")

    except Exception as e:
        warn(f"Could not update graph nodes/edges: {e}")


def extract_semantic_facts(summary: str, checkpoint_id: str):
    """Scan summary/intent details and recent git commit messages for semantic facts."""
    try:
        script_dir = Path(__file__).parent
        mem0_script = script_dir / "mem0-v2.py"
        if not mem0_script.exists():
            return

        KEEP_PATTERNS = [
            (r"\b(prefer|always use|never use|default to|favorite)\b", "preference"),
            (
                r"\b(when .{3,30}(do|always|never|run|use)|process:|steps:|workflow:|SOP:)\b",
                "sop",
            ),
            (
                r"\b(decided|chose|switched to|replaced|migrated|adopted|selected)\b",
                "decision",
            ),
            (
                r"\b(port \d+|url:|endpoint:|api.key|config|\.env|token stored)\b",
                "config",
            ),
            (r"\b(id:|ID:|task #|#[a-f0-9]{8})\b", "reference"),
        ]

        SKIP_PATTERNS = [
            r"^```",  # Code blocks
            r"^\s*\|",  # Table rows
            r"Traceback ",  # Stack traces
            r"^diff --",  # Diffs
            r"at \w+\.\w+ \(",  # JS stack frames
            r"^\s*\d+:\s",  # Line-numbered code
            r"(password|secret|private.key)\s*[:=]",  # Secrets
        ]

        # Scan git commit log or summary or reason
        try:
            res = subprocess.run(
                ["git", "log", "-1", "--pretty=%B"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            git_msg = res.stdout.strip() if res.returncode == 0 else ""
        except Exception:
            git_msg = ""

        texts_to_scan = [summary, git_msg]

        session = get_current_session()
        if session:
            for task_id, task in session.get("tasks", {}).items():
                task_sum = task.get("summary", "")
                if task_sum:
                    texts_to_scan.append(f"Task T{task_id}: {task_sum}")

        for text in texts_to_scan:
            if not text:
                continue
            for line in text.split("\n"):
                line = line.strip()
                if not line or len(line) < 10:
                    continue
                if any(re.search(pat, line, re.IGNORECASE) for pat in SKIP_PATTERNS):
                    continue
                for pat, category in KEEP_PATTERNS:
                    if re.search(pat, line, re.IGNORECASE):
                        fact_id = f"fact_{hashlib.md5(line.encode()).hexdigest()[:12]}"
                        title = f"Extracted {category.capitalize()}"
                        cmd = [
                            "python3",
                            str(mem0_script),
                            "graph-add-node",
                            fact_id,
                            "semantic",
                            title,
                            line,
                        ]
                        subprocess.run(cmd, capture_output=True, text=True, timeout=5)

                        cmd = [
                            "python3",
                            str(mem0_script),
                            "graph-link",
                            checkpoint_id,
                            fact_id,
                            "--weight",
                            "1.0",
                            "--type",
                            f"has_{category}",
                        ]
                        subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                        break
    except Exception as e:
        warn(f"Could not extract semantic facts: {e}")


def save_to_mem0(summary: str, checkpoint_id: str) -> bool:
    """Save checkpoint to mem0-v2. Returns True on success, False on failure."""
    try:
        script_dir = Path(__file__).parent
        mem0_script = script_dir / "mem0-v2.py"
        if not mem0_script.exists():
            warn(f"mem0-v2.py not found at {mem0_script}, skipping mem0 save")
            return False
        cmd = [
            "python3",
            str(mem0_script),
            "add",
            f"CHECKPOINT: [{checkpoint_id}] | {summary}",
            "--category",
            "session",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            error(f"mem0 save failed: {result.stderr[:200]}")
            return False

        # Save L2 graph structures and extract semantic context
        save_graph_nodes_edges(summary, checkpoint_id)
        extract_semantic_facts(summary, checkpoint_id)
        return True
    except subprocess.TimeoutExpired:
        warn("mem0 save timed out, continuing without mem0 update")
        return False
    except Exception as e:
        warn(f"Could not save to mem0: {e}")
        return False


def append_to_summary(checkpoint_id: str, reason: str, summary: str):
    """Append to conversation summary file."""
    SUMMARY_FILE.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).isoformat() + "Z"

    # Build the line
    new_line = f"| {timestamp} | {checkpoint_id} | {reason} | {summary} |\n"

    if not SUMMARY_FILE.exists():
        header = "| Timestamp | Checkpoint | Reason | Summary |\n|-----------|------------|--------|----------|\n"
        try:
            SUMMARY_FILE.write_text(
                "# Conversation Summary\n\n## Session Log\n\n" + header + new_line
            )
        except OSError as e:
            warn(f"Could not create summary file: {e}")
        return

    try:
        with open(SUMMARY_FILE, "a") as f:
            f.write(new_line)
    except OSError as e:
        warn(f"Could not append to summary file: {e}")


def update_memory_bank_progress(summary: str):
    """Update Memory Bank progress.md at checkpoint (NEW v8.0)."""
    progress_file = Path(".forgewright/memory-bank/progress.md")

    if not progress_file.exists():
        return

    try:
        content = progress_file.read_text()

        # Update last_updated in header
        today = datetime.now().strftime("%Y-%m-%d")
        if "Last Updated:" in content:
            import re

            content = re.sub(
                r"Last Updated: \d{4}-\d{2}-\d{2}", f"Last Updated: {today}", content
            )

        progress_file.write_text(content)
        log("Memory Bank progress.md updated")
    except Exception as e:
        warn(f"Could not update Memory Bank: {e}")


def update_active_context():
    """Update activeContext.md from session state.

    Triggered on every checkpoint + at session end.
    Generates structured markdown with current work, checkpoints, open tasks, blockers.
    """
    ACTIVE_CONTEXT_FILE.parent.mkdir(parents=True, exist_ok=True)

    session = load_session()
    session_log = ensure_session_log()
    current_session = None
    for s in reversed(session_log.get("sessions", [])):
        if s.get("status") == "in_progress":
            current_session = s
            break

    now = datetime.now(timezone.utc).isoformat() + "Z"
    checkpoints = session.get("checkpoints", [])
    last_cp = checkpoints[-1] if checkpoints else None

    # Build open tasks list
    open_tasks = []
    completed_tasks = []
    if current_session:
        for task_id, task in current_session.get("tasks", {}).items():
            if task.get("status") != "completed":
                open_tasks.append(f"- [ ] {task_id}: {task.get('summary', '')}")
            else:
                completed_tasks.append(f"- [x] {task_id}: {task.get('summary', '')}")

    # Build blockers/errors
    blockers = []
    if current_session:
        for event in current_session.get("events", []):
            if event.get("type") in ("SKILL_FAILED", "ERROR"):
                blockers.append(
                    f"- {event.get('type')}: {event.get('details', event.get('error_type', 'unknown'))}"
                )

    content = f"""# Active Context

**Updated**: {now}
**Session**: {session.get("session_id", "N/A")}
**Status**: {current_session.get("status", "N/A") if current_session else session.get("status", "N/A")}
**Phase**: {current_session.get("current_phase", "N/A") if current_session else "N/A"}

## Current Work
{current_session.get("request", "_No active request_") if current_session else "_No active session_"}

## Last Checkpoint
"""
    if last_cp:
        content += f"""- **ID**: {last_cp.get("id", "N/A")}
- **At**: {last_cp.get("at", "N/A")}
- **Summary**: {last_cp.get("summary", "N/A")}

"""
    else:
        content += "- _No checkpoints yet_\n\n"

    content += "## Open Tasks\n"
    if open_tasks:
        content += "\n".join(open_tasks) + "\n"
    else:
        content += "_No open tasks_\n"

    if completed_tasks:
        content += "\n## Completed Tasks\n"
        content += "\n".join(completed_tasks) + "\n"

    if blockers:
        content += "\n## Blockers\n"
        content += "\n".join(blockers) + "\n"

    content += """
## Decisions
<!-- Add key decisions made during this session -->

## Next Steps
<!-- Add planned next steps -->

---
*Auto-generated by memory-middleware.py — do not edit manually*
"""

    try:
        ACTIVE_CONTEXT_FILE.write_text(content)
        log(f"Active context updated: {ACTIVE_CONTEXT_FILE}")
    except OSError as e:
        warn(f"Could not update activeContext.md: {e}")


def generate_summary(reason: str) -> str:
    """
    Generate rich checkpoint summary using checkpoint-extract.sh.
    Extracts semantic context: intent, file categories, decision context.
    Falls back to simple git diff if extraction fails.
    """
    extract_script = (
        Path(__file__).resolve().parents[1] / "runtime" / "checkpoint-extract.sh"
    )

    if extract_script.exists():
        try:
            result = subprocess.run(
                ["bash", str(extract_script), "--reason", reason],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0 and result.stdout.strip():
                import json

                data = json.loads(result.stdout)
                intent = data.get("intent", "modified")
                intent_detail = data.get("intent_detail", "")
                file_counts = data.get("file_counts", {})
                total = data.get("total_files_changed", 0)
                summary_parts = [f"intent:{intent}"]
                if intent_detail:
                    summary_parts.append(intent_detail)
                if file_counts:
                    cats = []
                    for cat, count in file_counts.items():
                        if count > 0:
                            cats.append(f"{count}{cat}")
                    if cats:
                        summary_parts.append(f"files:{','.join(cats)}")
                summary_parts.append(f"total:{total}")
                return " | ".join(summary_parts)
        except Exception:
            pass

    # Fallback: simple git status
    try:
        result = subprocess.run(
            ["git", "status", "--short"], capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            files = result.stdout.strip().split("\n")[:5]
            file_list = " ".join(
                f.split()[1] if len(f.split()) > 1 else f for f in files
            )
            return f"files_changed:{file_list}"
    except Exception:
        pass
    return reason


# ────────────────────────────────────────────────────────────────────────────
# Checkpoint Operations
# ────────────────────────────────────────────────────────────────────────────


def do_checkpoint(reason: str = "manual") -> Optional[str]:
    """Create memory checkpoint with idempotency protection."""
    global _last_checkpoint_time
    now = datetime.now(timezone.utc)

    # Idempotency: skip if checkpoint happened recently
    if _last_checkpoint_time:
        elapsed = (now - _last_checkpoint_time).total_seconds()
        if elapsed < _CHECKPOINT_COOLDOWN_SECONDS:
            log(
                f"Checkpoint skipped: cooldown active ({elapsed:.1f}s < {_CHECKPOINT_COOLDOWN_SECONDS}s)"
            )
            return None

    session = load_session()
    checkpoint_id = f"cp-{now.strftime('%Y%m%d-%H%M%S')}"

    summary = generate_summary(reason)

    # The continuity ledger is the canonical durable handoff. Legacy mem0 and
    # markdown artifacts below remain optional context and cannot authorize a
    # resume, a tool call, or a completion claim.
    continuity_script = Path(__file__).parent / "continuity.py"
    safe_reason = re.sub(r"[^A-Za-z0-9._-]+", "-", reason).strip("-") or "manual"
    turn_id = os.environ.get("FORGEWRIGHT_TURN", "").strip() or checkpoint_id
    turn_id = re.sub(r"[^A-Za-z0-9._-]+", "-", turn_id).strip("-") or checkpoint_id
    continuity_payload = {
        "objective": summary,
        "acceptance_ids": session.get("acceptance_ids", []),
        "non_goals": session.get("non_goals", []),
        "plan": session.get("plan", []),
        "verified_facts": session.get("verified_facts", []),
        "assumptions": session.get("assumptions", []),
        "limitations": [
            "Checkpoint is context-only and requires current workspace re-grounding",
            "Malicious tampering by the same OS user is outside the integrity model",
        ],
        "change_refs": session.get("change_refs", []),
        "command_refs": session.get("command_refs", []),
        "evidence_refs": session.get("evidence_refs", []),
        "blockers": session.get("blockers", []),
        "next_action": session.get(
            "next_action", "Re-ground the current workspace before continuing"
        ),
        "owned_process_leases": session.get("owned_process_leases", []),
    }
    continuity = subprocess.run(
        [
            sys.executable,
            str(continuity_script),
            "checkpoint",
            "--session",
            session["session_id"],
            "--turn",
            turn_id,
            "--reason",
            safe_reason,
        ],
        cwd=WORKSPACE_ROOT,
        input=json.dumps(continuity_payload),
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if continuity.returncode != 0:
        warn("Canonical continuity checkpoint failed; legacy memory was not advanced")
        return None

    # Non-blocking mem0 save
    save_to_mem0(summary, checkpoint_id)

    update_memory_bank_progress(summary)

    session["message_count"] = 0
    session["last_checkpoint_at"] = now.isoformat() + "Z"
    session["checkpoints"].append(
        {
            "id": checkpoint_id,
            "reason": reason,
            "at": now.isoformat() + "Z",
            "summary": summary,
        }
    )
    save_session(session)

    append_to_summary(checkpoint_id, reason, summary)

    update_active_context()

    _last_checkpoint_time = now
    log(f"Checkpoint created: {checkpoint_id} (reason: {reason})")
    return checkpoint_id


def increment_message():
    """Observe a hook tick without treating counts or simulated tokens as truth."""
    log("Event-driven continuity active; tick observed without writing a checkpoint.")


# ────────────────────────────────────────────────────────────────────────────
# Commands
# ────────────────────────────────────────────────────────────────────────────


def cmd_start(args=None):
    """Initialize session tracking."""
    init_session()
    log("Memory middleware ready")
    log("Checkpoint mode: event-driven material boundaries")


def cmd_tick(args=None):
    """Called after each user message (hook)."""
    increment_message()


def cmd_checkpoint(args):
    """Force checkpoint with optional reason."""
    reason = args.reason or "manual"
    do_checkpoint(reason)


def cmd_status(args=None):
    """Show session status including session-log.json."""
    if not SESSION_FILE.exists():
        print("No memory session. Run 'start' to initialize.")

    session = load_session()
    print("=== Memory Session Status ===")
    print(f"Session ID: {session['session_id']}")
    print(f"Project: {session['project']}")
    print(f"Started: {session['started_at']}")
    print(f"Messages since checkpoint: {session['message_count']}")
    print(f"Last checkpoint: {session['last_checkpoint_at']}")
    print(f"Total checkpoints: {len(session['checkpoints'])}")
    print(f"Checkpoint interval: every {CHECKPOINT_INTERVAL} messages")
    print(f"Token warn threshold: {TOKEN_THRESHOLD_WARN}%")
    print(f"Token critical threshold: {TOKEN_THRESHOLD_CRITICAL}%")

    print("\n=== session-log.json Status ===")
    print(f"Path: {SESSION_LOG}")
    current_session = get_current_session()
    if current_session:
        print(f"Status: {current_session['status']}")
        print(f"Mode: {current_session['mode']}")
        print(f"Phase: {current_session.get('current_phase', 'N/A')}")
        print(f"Tasks: {len(current_session.get('tasks', {}))}")
        print(f"Events: {len(current_session.get('events', []))}")
    else:
        print("Status: No active session in session-log.json")
        last = get_last_session()
        if last:
            print(
                f"Last session: {last.get('session_id', '?')} ({last.get('status', '?')})"
            )

    # Show mem0 stats
    print("\n=== mem0 Memory Stats ===")
    try:
        script_dir = Path(__file__).parent
        mem0_script = script_dir / "mem0-v2.py"
        if mem0_script.exists():
            result = subprocess.run(
                ["python3", str(mem0_script), "stats"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                for line in result.stdout.strip().split("\n"):
                    if line.strip():
                        print(f"  {line}")
            else:
                print("  (could not load mem0 stats)")
        else:
            print("  (mem0-v2.py not found)")
    except Exception:
        print("  (mem0 unavailable)")


def cmd_resume(args=None):
    """Resume session - load context."""
    log("Resuming session...")

    session = load_session()
    print(f"\nSession: {session['session_id']}")
    print(f"Project: {session['project']}")

    continuity_script = Path(__file__).parent / "continuity.py"
    continuity = subprocess.run(
        [
            sys.executable,
            str(continuity_script),
            "resume",
            "--session",
            session["session_id"],
        ],
        cwd=WORKSPACE_ROOT,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if continuity.returncode == 0:
        try:
            continuity_state = json.loads(continuity.stdout)
        except json.JSONDecodeError:
            continuity_state = {"status": "fresh-start", "reasons": ["invalid_output"]}
        print("\n=== Canonical Continuity State ===")
        print(json.dumps(continuity_state, ensure_ascii=False, indent=2))
    else:
        warn("Canonical continuity state could not be loaded; start fresh")

    # Load handover document
    handover = load_handover()
    if handover:
        print("\n=== Handover Document Found ===")
        print(handover.get("raw", "Could not parse handover"))
    else:
        print("\n(No handover document found)")

    # Load summary file
    if SUMMARY_FILE.exists():
        print("\n=== Conversation Summary (last 10) ===")
        lines = SUMMARY_FILE.read_text().strip().split("\n")
        for line in lines[-10:]:
            print(line)

    # Search mem0 for recent
    try:
        script_dir = Path(__file__).parent
        mem0_script = script_dir / "mem0-v2.py"
        if mem0_script.exists():
            result = subprocess.run(
                [
                    "python3",
                    str(mem0_script),
                    "list",
                    "--category",
                    "session",
                    "--limit",
                    "5",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                print("\n=== Recent Memories ===")
                print(result.stdout)
        else:
            print("\n(mem0-v2.py not found, skipping memory list)")
    except Exception as e:
        warn(f"Could not load mem0 memories: {e}")


def cmd_handover(args=None):
    """Generate a handover document with optional goals and next_steps."""
    import sys

    goals = ""
    next_steps = ""

    if args and len(sys.argv) > 2:
        goals = sys.argv[2]
    if args and len(sys.argv) > 3:
        next_steps = sys.argv[3]

    path = generate_handover(goals=goals, next_steps=next_steps)
    if path:
        print(f"Handover document generated: {path}")
    else:
        print("Failed to generate handover document.")


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────


def main():
    # Support both flat commands and 'session-log' subcommand
    parser = argparse.ArgumentParser(description="Forgewright Memory Middleware")

    # Check if first arg is 'session-log' for subcommand mode
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "session-log":
        _main_session_log()
        return

    parser.add_argument(
        "command",
        nargs="?",
        default="status",
        choices=[
            "start",
            "tick",
            "checkpoint",
            "status",
            "resume",
            "daemon",
            "handover",
        ],
    )
    parser.add_argument(
        "--reason",
        dest="reason",
        default=None,
        help="Checkpoint reason (used with checkpoint command)",
    )
    args = parser.parse_args()

    if args.command == "daemon":
        error("Daemon mode not yet implemented - use cron/systemd")
        sys.exit(1)

    commands = {
        "start": cmd_start,
        "tick": cmd_tick,
        "checkpoint": cmd_checkpoint,
        "status": cmd_status,
        "resume": cmd_resume,
        "handover": cmd_handover,
    }

    commands[args.command](args)


def _main_session_log():
    """Handle session-log subcommand."""
    import sys

    sub_args = sys.argv[2:] if len(sys.argv) > 2 else []

    if not sub_args or sub_args[0] == "help":
        print("""session-log - Manage session-log.json

Usage:
  python3 memory-middleware.py session-log create         Create/reset session-log.json
  python3 memory-middleware.py session-log start <mode> <request>  Start a new session
  python3 memory-middleware.py session-log status         Show current session state
  python3 memory-middleware.py session-log task <id> <status> <summary>  Add/update task
  python3 memory-middleware.py session-log phase <name>         Mark phase complete
  python3 memory-middleware.py session-log end [summary]        End current session
  python3 memory-middleware.py session-log list               List all sessions
  python3 memory-middleware.py session-log resume              Show interrupted sessions
""")
        return

    cmd = sub_args[0]

    if cmd == "create":
        ensure_session_log()
        print(f"✓ session-log.json ready at: {SESSION_LOG}")

    elif cmd == "start":
        mode = sub_args[1] if len(sub_args) > 1 else "unknown"
        request = sub_args[2] if len(sub_args) > 2 else ""
        session = start_session(mode=mode, request=request)
        print(f"✓ Session started: {session['session_id']}")
        print(f"  Mode: {session['mode']}")
        print(f"  Request: {session['request']}")
        print(f"  File: {SESSION_LOG}")

    elif cmd == "status":
        session = get_current_session()
        if session:
            print(f"""━━━ Session Status ━━━━━━━━━━━━━━━━━━━━━━
  ID:      {session["session_id"]}
  Status:  {session["status"]}
  Mode:    {session["mode"]}
  Phase:   {session.get("current_phase", "N/A")}
  Tasks:   {len(session.get("tasks", {}))} tracked
  File:    {SESSION_LOG}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━""")
        else:
            print("No active session.")

    elif cmd == "task":
        if len(sub_args) < 3:
            print("Usage: session-log task <id> <status> <summary>")
            sys.exit(1)
        add_task(
            sub_args[1],
            sub_args[2],
            " ".join(sub_args[3:]) if len(sub_args) > 3 else "",
        )

    elif cmd == "phase":
        if len(sub_args) < 2:
            print("Usage: session-log phase <name>")
            sys.exit(1)
        update_session(current_phase=sub_args[1])
        print(f"✓ Phase updated: {sub_args[1]}")

    elif cmd == "end":
        summary = sub_args[1] if len(sub_args) > 1 else ""
        session = end_session(summary=summary)
        if session:
            print(
                f"✓ Session ended: {session['session_id']} ({session.get('duration_minutes', 0)} min)"
            )

    elif cmd == "list":
        log_data = ensure_session_log()
        sessions = log_data.get("sessions", [])
        if not sessions:
            print("No sessions recorded.")
            return
        print(f"━━━ Sessions ({len(sessions)}) ━━━━━━━━━━━━━━━━━━━━━━")
        for s in sessions[-10:]:
            icon = {"completed": "✓", "interrupted": "⚠", "in_progress": "⧖"}.get(
                s.get("status", ""), "?"
            )
            print(
                f"  {icon} {s['session_id']} | {s.get('mode', '?')} | {s['status']} | {s.get('current_phase', 'N/A')}"
            )

    elif cmd == "resume":
        log_data = ensure_session_log()
        interrupted = [
            s
            for s in log_data.get("sessions", [])
            if s.get("status") in ("interrupted", "in_progress")
        ]
        if not interrupted:
            print("No interrupted sessions.")
            return
        for s in interrupted:
            print(f"""⚠ Interrupted session found:
  ID:      {s["session_id"]}
  Mode:    {s.get("mode", "?")}
  Phase:   {s.get("current_phase", "N/A")}
  Started: {s.get("started_at", "?")}
  Request: {s.get("request", "?")}
""")

    else:
        print(f"Unknown session-log command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
