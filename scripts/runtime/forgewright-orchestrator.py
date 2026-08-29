import os
import sys
import json
import asyncio
import hashlib
import re
import time
import subprocess
import requests
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Dict
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Repo-relative paths — derived from this script's own location.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from skill_routing import route_skills  # noqa: E402 — sys.path must precede this repo-relative import.
from agent_loop_replay import (  # noqa: E402 — same repo-relative runtime module.
    Journal,
    JournalError,
    ReplayCursor,
    digest,
    normalize,
)

# Provider / model are read exclusively from env vars so that the harness
# controls them without needing to hard-code any model name in this file.
_PROVIDER = os.environ.get("FORGEWRIGHT_PROVIDER", "runtime")
_DEFERRED_SKILL_TOOL = "fw_load_skill_overlay"
_SAFE_SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_SAFE_CALLER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_FILESYSTEM_TOOLS = {
    "read_file": ("path",),
    "read_multiple_files": ("paths",),
    "write_file": ("path",),
    "edit_file": ("path",),
    "create_directory": ("path",),
    "list_directory": ("path",),
    "directory_tree": ("path",),
    "move_file": ("source", "destination"),
    "search_files": ("path",),
    "get_file_info": ("path",),
    "list_allowed_directories": (),
}
_CONTINUITY_SCRIPT = Path(_REPO_ROOT) / "scripts" / "memory" / "continuity.py"


class ContinuityBridge:
    """Bounded context-only bridge; never grants execution or tool authority."""

    def __init__(
        self,
        workspace: str,
        project_id: str,
        task: str,
        environ: dict[str, str] | None = None,
    ):
        self.workspace = workspace
        self.project_id = project_id
        self.task = ""
        self.session = ""
        self.required = (environ or os.environ).get(
            "FORGEWRIGHT_CONTINUITY_REQUIRED", ""
        ).lower() in {"1", "true", "yes"}
        self.environs = {
            **os.environ,
            "FORGEWRIGHT_WORKSPACE": workspace,
            **(environ or {}),
        }
        self.binding: dict[str, Any] | None = None
        self.request_sequence = 0
        self.process_nonce = hashlib.sha256(os.urandom(32)).hexdigest()[:12]
        self.bind_task(task)

    def bind_task(self, task: str) -> None:
        self.task = task
        explicit = self.environs.get("FORGEWRIGHT_SESSION_ID", "")
        identity = explicit if explicit else task
        self.session = hashlib.sha256(
            f"{self.project_id}:{self.workspace}:{identity}".encode()
        ).hexdigest()[:32]
        self.binding = None
        self.request_sequence = 0

    def _run(self, *args: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        result = subprocess.run(
            [sys.executable, str(_CONTINUITY_SCRIPT), *args],
            input=json.dumps(payload) if payload is not None else None,
            text=True,
            capture_output=True,
            env=self.environs,
            timeout=5,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"continuity_failed:{result.stderr.strip()}")
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            raise RuntimeError("continuity_failed:response_not_object")
        return value

    def resume(self) -> dict[str, Any]:
        value = self._run("resume", "--session", self.session)
        self.binding = value if value.get("status") == "resumable-context" else None
        return value

    def checkpoint(
        self, boundary: str, turn: int, max_steps: int, max_tool_calls: int
    ) -> None:
        payload = {
            "objective": self.task,
            "acceptance_ids": [],
            "non_goals": [],
            "plan": [{"step": boundary, "status": "in_progress"}],
            "verified_facts": [],
            "assumptions": [],
            "limitations": ["context-only; workspace re-grounding required"],
            "change_refs": [],
            "command_refs": [],
            "evidence_refs": [],
            "blockers": [],
            "next_action": "re-ground workspace before action",
            "owned_process_leases": [],
        }
        checkpoint = self._run(
            "checkpoint",
            "--session",
            self.session,
            "--turn",
            f"turn-{turn}",
            "--reason",
            boundary,
            "--boundary",
            boundary,
            "--max-steps",
            str(max_steps),
            "--max-tool-calls",
            str(max_tool_calls),
            payload=payload,
        )
        self.binding = {
            "status": "resumable-context",
            "authority": "context-only",
            "requires_workspace_regrounding": True,
            "checkpoint": checkpoint,
            "continuation_nonce": checkpoint["continuation"]["nonce"],
            "remaining_budget": {
                "steps": max_steps,
                "tool_calls": max_tool_calls,
            },
        }

    def consume(self, steps: int, tool_calls: int) -> None:
        if self.binding is None:
            return
        checkpoint = self.binding["checkpoint"]
        self.request_sequence += 1
        result = self._run(
            "consume",
            "--session",
            self.session,
            "--checkpoint-hash",
            checkpoint["checkpoint_hash"],
            "--nonce",
            self.binding["continuation_nonce"],
            "--request-id",
            f"runtime-{self.process_nonce}-{self.request_sequence}",
            "--steps",
            str(steps),
            "--tool-calls",
            str(tool_calls),
        )
        self.binding["remaining_budget"] = {
            "steps": result["remaining_steps"],
            "tool_calls": result["remaining_tool_calls"],
        }

    def compact_context(self) -> dict[str, Any] | None:
        if self.binding is None:
            return None
        checkpoint = self.binding.get("checkpoint", {})
        return {
            "authority": "context-only",
            "requires_workspace_regrounding": True,
            "objective": checkpoint.get("objective"),
            "plan": checkpoint.get("plan", []),
            "blockers": checkpoint.get("blockers", []),
            "next_action": checkpoint.get("next_action"),
            "remaining_budget": self.binding.get("remaining_budget"),
            "checkpoint_hash": checkpoint.get("checkpoint_hash"),
        }


def is_material_effect(server: str, tool: str) -> bool:
    forgewright_reads = {
        "fw_get_current_phase",
        "fw_check_pipeline_compliance",
        "fw_load_skill_overlay",
    }
    return (server == "forgewright" and tool not in forgewright_reads) or (
        server == "filesystem"
        and tool in {"write_file", "edit_file", "create_directory", "move_file"}
    )


class RecordedLoopFailure(RuntimeError):
    def __init__(self, failure: dict[str, Any]):
        super().__init__("recorded_loop_failure")
        self.failure = failure


def _first_nonempty(*values: str | None) -> str:
    return next((value.strip() for value in values if value and value.strip()), "")


def resolve_model(environ: dict[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    model = _first_nonempty(env.get("FORGEWRIGHT_MODEL"), env.get("NINEROUTER_MODEL"))
    if not model:
        raise ValueError(
            "FORGEWRIGHT_MODEL is required (NINEROUTER_MODEL is a legacy fallback)"
        )
    return model


def resolve_api_key(environ: dict[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    return _first_nonempty(
        env.get("FORGEWRIGHT_API_KEY"), env.get("NINEROUTER_API_KEY")
    )


def resolve_api_url(environ: dict[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    exact_url = _first_nonempty(env.get("FORGEWRIGHT_API_URL"))
    if exact_url:
        return exact_url
    legacy_base = _first_nonempty(env.get("NINEROUTER_BASE_URL"))
    if legacy_base:
        if legacy_base.endswith("/chat/completions"):
            return legacy_base
        return legacy_base.rstrip("/") + "/chat/completions"
    raise ValueError(
        "FORGEWRIGHT_API_URL or NINEROUTER_BASE_URL must be explicitly configured"
    )


def resolve_code_dir(value: str) -> str:
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError(f"code_dir is not a directory: {path}")
    if path == Path(path.anchor):
        raise ValueError("code_dir cannot be the filesystem root")
    return str(path)


def validate_production_containment(environ: dict[str, str] | None = None) -> None:
    env = os.environ if environ is None else environ
    mode = env.get("FORGEWRIGHT_RUNTIME_MODE", "").strip().lower()
    legacy_production = env.get("FORGEWRIGHT_PRODUCTION", "").lower() in {
        "1",
        "true",
        "yes",
    }
    if mode not in {"", "local", "production"}:
        raise ValueError("FORGEWRIGHT_RUNTIME_MODE must be local or production")
    if mode == "local" and legacy_production:
        raise ValueError(
            "FORGEWRIGHT_RUNTIME_MODE=local conflicts with legacy production"
        )
    production = mode == "production" or (not mode and legacy_production)
    if not production:
        return
    if not _SAFE_CALLER_ID.fullmatch(env.get("FORGEWRIGHT_CALLER_ID", "")):
        raise ValueError(
            "FORGEWRIGHT_CALLER_ID must be a safe identifier in production"
        )
    if env.get("FORGEWRIGHT_CONTAINMENT_PROFILE") != "application":
        raise ValueError(
            "FORGEWRIGHT_CONTAINMENT_PROFILE=application is required in production"
        )


def validate_filesystem_tool_call(
    tool: str, arguments: dict[str, Any], code_dir: str
) -> str | None:
    fields = _FILESYSTEM_TOOLS.get(tool)
    if fields is None:
        return "Execution Error: filesystem tool is not allowlisted."
    root = Path(code_dir).resolve(strict=True)
    for field in fields:
        raw_values = arguments.get(field)
        values = raw_values if field == "paths" else [raw_values]
        if not isinstance(values, list) or not values:
            return "Execution Error: filesystem path arguments are invalid."
        for raw in values:
            if not isinstance(raw, str) or not raw or "\x00" in raw:
                return "Execution Error: filesystem path arguments are invalid."
            candidate = Path(raw)
            lexical = candidate if candidate.is_absolute() else root.joinpath(candidate)
            normalized = Path(os.path.normpath(str(lexical)))
            try:
                relative = normalized.relative_to(root)
            except ValueError:
                return "Execution Error: filesystem path escapes the workspace."
            current = root
            for part in relative.parts:
                current = current / part
                if current.is_symlink():
                    return "Execution Error: filesystem path uses a symlink."
            write_target = tool in {"write_file", "edit_file", "create_directory"} or (
                tool == "move_file" and field == "destination"
            )
            parent = normalized.parent if write_target else normalized
            try:
                resolved_parent = parent.resolve(strict=True)
            except OSError:
                return "Execution Error: filesystem path parent is invalid."
            if resolved_parent != root and root not in resolved_parent.parents:
                return "Execution Error: filesystem path escapes the workspace."
    return None


def _positive_int(environ: dict[str, str], name: str, default: int) -> int:
    raw = environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer") from error
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _optional_positive_int(environ: dict[str, str], name: str) -> int | None:
    """Read an optional positive limit; missing or zero means unlimited."""
    raw = environ.get(name)
    if raw is None or not raw.strip():
        return None
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer or 0") from error
    if value < 0:
        raise ValueError(f"{name} must be a positive integer or 0")
    return value or None


@dataclass(frozen=True)
class RuntimeLimits:
    max_turns: int | None
    max_tool_calls_per_turn: int
    max_tool_calls_total: int
    max_output_tokens: int
    max_http_response_bytes: int
    max_tool_argument_bytes: int
    max_tool_result_bytes: int
    max_context_bytes: int
    max_tools: int
    max_tool_schema_bytes: int
    mcp_timeout_seconds: int
    runtime_timeout_seconds: int

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "RuntimeLimits":
        env = dict(os.environ if environ is None else environ)
        return cls(
            # Goal execution has no default turn quota. An explicit positive
            # value remains available as an emergency runtime circuit breaker.
            max_turns=_optional_positive_int(env, "FORGEWRIGHT_MAX_TURNS"),
            max_tool_calls_per_turn=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_CALLS_PER_TURN", 8
            ),
            max_tool_calls_total=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_CALLS_TOTAL", 40
            ),
            max_output_tokens=_positive_int(env, "FORGEWRIGHT_MAX_OUTPUT_TOKENS", 8192),
            max_http_response_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_HTTP_RESPONSE_BYTES", 2_000_000
            ),
            max_tool_argument_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_ARGUMENT_BYTES", 100_000
            ),
            max_tool_result_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_RESULT_BYTES", 250_000
            ),
            max_context_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_CONTEXT_BYTES", 1_000_000
            ),
            max_tools=_positive_int(env, "FORGEWRIGHT_MAX_TOOLS", 256),
            max_tool_schema_bytes=_positive_int(
                env, "FORGEWRIGHT_MAX_TOOL_SCHEMA_BYTES", 500_000
            ),
            mcp_timeout_seconds=_positive_int(
                env, "FORGEWRIGHT_MCP_TIMEOUT_SECONDS", 120
            ),
            runtime_timeout_seconds=_positive_int(
                env, "FORGEWRIGHT_RUNTIME_TIMEOUT_SECONDS", 3600
            ),
        )


def qualified_tool_name(server: str, tool: str) -> str:
    raw = f"mcp_{server}__{tool}"
    sanitized = re.sub(r"[^A-Za-z0-9_-]", "_", raw)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]
    prefix = sanitized[: 64 - len(digest) - 2]
    return f"{prefix}__{digest}"


def _serialized_size(value: Any) -> int:
    return len(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _deferred_skill_names(routing: dict[str, Any]) -> list[str]:
    budget = routing.get("context_budget", {})
    if not isinstance(budget, dict):
        raise RuntimeError("skill routing returned an invalid context budget")
    raw_names = budget.get("deferred_skills", [])
    if not isinstance(raw_names, list) or not all(
        isinstance(name, str) and _SAFE_SKILL_NAME.fullmatch(name) for name in raw_names
    ):
        raise RuntimeError("skill routing returned an invalid deferred skill inventory")
    return list(dict.fromkeys(raw_names))


def _deferred_skill_guidance(names: list[str], exposed_tool_name: str | None) -> str:
    if not names:
        return ""
    inventory = json.dumps(names, ensure_ascii=False, separators=(",", ":"))
    if exposed_tool_name is None:
        return (
            "\n\n## Deferred Skill Overlays\n"
            f"Deferred by the startup context budget: `{inventory}`. "
            "The bounded loader is unavailable in this runtime. Do not read these "
            "paths directly or claim their instructions were loaded."
        )
    example = json.dumps({"name": names[0]}, ensure_ascii=False)
    return (
        "\n\n## Deferred Skill Overlays\n"
        f"Deferred by the startup context budget: `{inventory}`. "
        "Load one only when it becomes materially necessary; never load speculatively "
        "or more than once. Call "
        f"`{exposed_tool_name}` with an exact listed name, for example `{example}`."
    )


def _read_bounded_response(response: Any, max_bytes: int) -> str:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=65_536):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise RuntimeError("runtime budget exceeded: HTTP response bytes")
        chunks.append(chunk)
    return b"".join(chunks).decode("utf-8", errors="replace")


_MODEL = _first_nonempty(
    os.environ.get("FORGEWRIGHT_MODEL"), os.environ.get("NINEROUTER_MODEL")
)

_API_KEY = resolve_api_key()
try:
    _BASE_URL = resolve_api_url()
except ValueError:
    _BASE_URL = ""


class ForgewrightAgent:
    def __init__(
        self,
        project_id: str,
        code_dir: str,
        continuity: ContinuityBridge | None = None,
        journal_mode: str | None = None,
        journal: Journal | None = None,
    ):
        self.project_id = project_id
        self.code_dir = resolve_code_dir(code_dir)
        self.messages = []
        self.limits = RuntimeLimits.from_env()
        self._started_at: float | None = None
        self.continuity = continuity or ContinuityBridge(self.code_dir, project_id, "")
        self.journal_mode = journal_mode or os.environ.get(
            "FORGEWRIGHT_LOOP_JOURNAL_MODE", "off"
        )
        if self.journal_mode not in {"off", "record", "replay"}:
            raise ValueError(
                "FORGEWRIGHT_LOOP_JOURNAL_MODE must be off, record, or replay"
            )
        if self.journal_mode != "off" and journal is None:
            journal_root = Path(
                os.environ.get(
                    "FORGEWRIGHT_LOOP_JOURNAL_DIR",
                    str(Path(self.code_dir) / ".forgewright" / "agent-loop"),
                )
            )
            configured_loop_id = os.environ.get("FORGEWRIGHT_LOOP_ID")
            if self.journal_mode == "replay" and not configured_loop_id:
                raise ValueError("FORGEWRIGHT_LOOP_ID is required for replay mode")
            loop_id = configured_loop_id or (
                "loop-"
                + hashlib.sha256(
                    f"{self.project_id}:{self.code_dir}".encode("utf-8")
                ).hexdigest()[:16]
                + "-"
                + os.urandom(6).hex()
            )
            journal = Journal(journal_root, loop_id)
        self.journal = journal
        self.replay_cursor = (
            ReplayCursor(journal.read())
            if self.journal_mode == "replay" and journal is not None
            else None
        )

    def _journal_append(self, kind: str, payload: dict[str, Any]) -> None:
        if self.journal_mode == "record":
            assert self.journal is not None
            self.journal.append(kind, payload)

    def _raise_if_recorded_failure(self) -> None:
        if self.journal_mode != "replay" or self.replay_cursor is None:
            return
        peeked = self.replay_cursor.peek()
        if (
            peeked is not None
            and peeked[0] == "lifecycle.event"
            and peeked[1].get("phase") == "runtime.failed"
        ):
            raise RecordedLoopFailure(
                {key: value for key, value in peeked[1].items() if key != "phase"}
            )

    def _journal_expect(self, kind: str, payload: dict[str, Any]) -> None:
        if self.journal_mode == "replay":
            assert self.replay_cursor is not None
            self._raise_if_recorded_failure()
            self.replay_cursor.expect(kind, payload)

    def _journal_take(self, kind: str) -> dict[str, Any]:
        if self.journal_mode != "replay" or self.replay_cursor is None:
            raise JournalError("replay_not_active")
        self._raise_if_recorded_failure()
        return self.replay_cursor.take(kind)

    def _journal_lifecycle(self, phase: str, **details: Any) -> None:
        payload = {"phase": phase, **details}
        self._journal_append("lifecycle.event", payload)
        self._journal_expect("lifecycle.event", payload)

    def _journal_containment(
        self,
        *,
        turn: int,
        index: int,
        tool: str,
        server: str | None,
        decision: str | None,
    ) -> str:
        payload = {
            "turn": turn,
            "index": index,
            "tool": tool,
            "server": server,
            "decision": decision,
        }
        if self.journal_mode == "record":
            if decision is None:
                raise JournalError("invalid_containment_decision")
            self._journal_append("containment.decision", payload)
            return decision
        if self.journal_mode == "replay":
            recorded = self._journal_take("containment.decision")
            for key in ("turn", "index", "tool", "server"):
                if recorded.get(key) != payload[key]:
                    raise JournalError("replay_mismatch")
            recorded_decision = recorded.get("decision")
            if recorded_decision not in {
                "admitted",
                "denied",
                "denied-unknown-tool",
            }:
                raise JournalError("replay_mismatch")
            return recorded_decision
        return decision or "admitted"

    def _journal_boundary(
        self,
        boundary: str,
        turn: int,
        total_tool_calls: int,
        steps: int,
        tool_calls: int,
        checkpoint_status: str,
    ) -> str:
        payload = {
            "boundary": boundary,
            "turn": turn,
            "total_tool_calls": total_tool_calls,
            "steps": steps,
            "tool_calls": tool_calls,
            "checkpoint_status": checkpoint_status,
        }
        if self.journal_mode == "record":
            self._journal_append("checkpoint.boundary", payload)
            return checkpoint_status
        if self.journal_mode == "replay":
            recorded = self._journal_take("checkpoint.boundary")
            for key in (
                "boundary",
                "turn",
                "total_tool_calls",
                "steps",
                "tool_calls",
            ):
                if recorded.get(key) != payload[key]:
                    raise JournalError("replay_mismatch")
            status = recorded.get("checkpoint_status")
            if status not in {"checkpointed", "optional-failed"}:
                raise JournalError("replay_mismatch")
            return status
        return checkpoint_status

    @staticmethod
    def _abstract_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        abstract: list[dict[str, Any]] = []
        for message in messages:
            content = message.get("content", "")
            content_digest = message.get("_forgewright_content_digest")
            if not isinstance(content_digest, str):
                content_digest = digest(content if isinstance(content, str) else "")
            item: dict[str, Any] = {
                "role": str(message.get("role", "")),
                "content_digest": content_digest,
            }
            for key in ("name", "tool_call_id"):
                if key in message:
                    item[key] = str(message[key])
            tool_calls = []
            for call in message.get("tool_calls", []) or []:
                function = call.get("function", {})
                argument_digest = function.get("_forgewright_arguments_digest")
                if not isinstance(argument_digest, str):
                    raw = function.get("arguments", "{}")
                    try:
                        argument_digest = digest(json.loads(raw))
                    except (TypeError, json.JSONDecodeError):
                        argument_digest = digest(str(raw))
                tool_calls.append(
                    {
                        "id": str(call.get("id", "")),
                        "name": str(function.get("name", "")),
                        "arguments_digest": argument_digest,
                    }
                )
            if tool_calls:
                item["tool_calls"] = tool_calls
            abstract.append(item)
        return abstract

    @staticmethod
    def _abstract_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        abstract: list[dict[str, Any]] = []
        for tool in tools:
            function = tool.get("function", {})
            description_digest = function.get("_forgewright_description_digest")
            if not isinstance(description_digest, str):
                description_digest = digest(str(function.get("description", "")))
            parameters_digest = function.get("_forgewright_parameters_digest")
            if not isinstance(parameters_digest, str):
                parameters_digest = digest(function.get("parameters", {}))
            abstract.append(
                {
                    "type": str(tool.get("type", "")),
                    "name": str(function.get("name", "")),
                    "description_digest": description_digest,
                    "parameters_digest": parameters_digest,
                }
            )
        return abstract

    def _normalize_model_response(self, reply: dict[str, Any]) -> dict[str, Any]:
        content = reply.get("content", "")
        if not isinstance(content, str):
            content = ""
        content = content.replace("\r\n", "\n").replace("\r", "\n")
        if len(content.encode("utf-8")) > self.limits.max_tool_result_bytes:
            raise JournalError("model_response_size_limit")
        calls: list[dict[str, Any]] = []
        for item in reply.get("tool_calls", []) or []:
            function = item.get("function", {})
            raw_arguments = function.get("arguments", "{}")
            if not isinstance(raw_arguments, str):
                raise JournalError("invalid_tool_envelope")
            arguments = json.loads(raw_arguments)
            if not isinstance(arguments, dict):
                raise JournalError("invalid_tool_envelope")
            calls.append(
                {
                    "id": str(item.get("id", "")),
                    "name": str(function.get("name", "")),
                    "arguments_digest": digest(normalize(arguments)),
                    "arguments_bytes": len(raw_arguments.encode("utf-8")),
                }
            )
        return {
            "content_digest": digest(content),
            "content_bytes": len(content.encode("utf-8")),
            "content_present": bool(content),
            "tool_calls": calls,
        }

    @staticmethod
    def _restore_model_response(payload: dict[str, Any]) -> dict[str, Any]:
        content_digest = payload.get("content_digest")
        if not isinstance(content_digest, str):
            raise JournalError("replay_mismatch")
        reply: dict[str, Any] = {
            "content": "[replayed model content]"
            if payload.get("content_present")
            else "",
            "_forgewright_content_digest": content_digest,
        }
        calls = payload.get("tool_calls", [])
        if calls:
            reply["tool_calls"] = [
                {
                    "id": call["id"],
                    "type": "function",
                    "function": {
                        "name": call["name"],
                        "arguments": "{}",
                        "_forgewright_arguments_digest": call["arguments_digest"],
                    },
                }
                for call in calls
            ]
        return reply

    def _model_exchange(self, tools: list[dict[str, Any]], turn: int) -> dict[str, Any]:
        if _serialized_size(self.messages) > self.limits.max_context_bytes:
            raise RuntimeError("runtime budget exceeded: context bytes")
        request = {
            "turn": turn,
            "messages_digest": digest(self._abstract_messages(self.messages)),
            "tools_digest": digest(self._abstract_tools(tools)),
        }
        self._journal_append("model.request", request)
        self._journal_expect("model.request", request)
        if self.journal_mode == "replay":
            return self._restore_model_response(self._journal_take("model.response"))
        reply = self._call_api(tools)
        if self.journal_mode == "record":
            normalized = self._normalize_model_response(reply)
            self._journal_append("model.response", normalized)
            return reply
        return reply

    def _tool_request(
        self,
        turn: int,
        index: int,
        tool: str,
        arguments: dict[str, Any],
        arguments_digest: str | None = None,
    ) -> None:
        payload = {
            "turn": turn,
            "index": index,
            "tool": tool,
            "arguments_digest": arguments_digest or digest(arguments),
        }
        self._journal_append("tool.request", payload)
        self._journal_expect("tool.request", payload)

    def _record_tool_result(
        self, turn: int, index: int, tool: str, output: str, is_error: bool
    ) -> None:
        payload = {
            "turn": turn,
            "index": index,
            "tool": tool,
            "is_error": is_error,
            "output_digest": digest(output),
            "output_bytes": len(output.encode("utf-8")),
        }
        self._journal_append("tool.result", payload)

    def _take_tool_result(
        self, turn: int, index: int, tool: str
    ) -> tuple[str, bool, str]:
        payload = self._journal_take("tool.result")
        if (
            payload.get("turn") != turn
            or payload.get("index") != index
            or payload.get("tool") != tool
        ):
            raise JournalError("replay_mismatch")
        output_digest = payload.get("output_digest")
        if not isinstance(output_digest, str) or len(output_digest) != 64:
            raise JournalError("replay_mismatch")
        return (
            f"[replayed tool result:{output_digest}]",
            bool(payload.get("is_error", False)),
            output_digest,
        )

    def _journal_tool_semantics(
        self,
        original_tool_name: str,
        turn: int,
        output: str,
        is_error: bool,
        result_digest: str | None = None,
    ) -> None:
        base = {"turn": turn, "result_digest": result_digest or digest(output)}
        if original_tool_name == "fw_request_gate_approval":
            kind = "approval.rejected" if is_error else "approval.requested"
            self._journal_append(kind, base)
            self._journal_expect(kind, base)
        elif original_tool_name == "fw_approve_gate":
            kind = "approval.rejected" if is_error else "approval.approved"
            self._journal_append(kind, base)
            self._journal_expect(kind, base)
        elif original_tool_name == "fw_check_pipeline_compliance":
            payload = {
                "turn": turn,
                "evidence_digest": result_digest or digest(output),
            }
            self._journal_append("evidence.recorded", payload)
            self._journal_expect("evidence.recorded", payload)

    def _continuity_boundary(
        self,
        boundary: str,
        turn: int,
        total_tool_calls: int,
        *,
        steps: int = 0,
        tool_calls: int = 0,
    ) -> None:
        checkpoint_status = "checkpointed"
        if self.journal_mode != "replay":
            try:
                if steps > 0 or tool_calls > 0:
                    self.continuity.consume(steps, tool_calls)
                bound_budget = (
                    self.continuity.binding.get("remaining_budget", {})
                    if self.continuity.binding is not None
                    else {}
                )
                remaining_steps = (
                    128
                    if self.limits.max_turns is None
                    else max(0, min(128, self.limits.max_turns - turn + 1))
                )
                remaining_tools = max(
                    0, min(256, self.limits.max_tool_calls_total - total_tool_calls)
                )
                if isinstance(bound_budget.get("steps"), int):
                    remaining_steps = min(remaining_steps, bound_budget["steps"])
                if isinstance(bound_budget.get("tool_calls"), int):
                    remaining_tools = min(remaining_tools, bound_budget["tool_calls"])
                self.continuity.checkpoint(
                    boundary, turn, remaining_steps, remaining_tools
                )
            except Exception as error:
                if self.continuity.required:
                    raise RuntimeError("continuity_required_failed") from error
                checkpoint_status = "optional-failed"
                print(f"[!] Continuity warning: {error}")
        self._journal_boundary(
            boundary,
            turn,
            total_tool_calls,
            steps=steps,
            tool_calls=tool_calls,
            checkpoint_status=checkpoint_status,
        )

    def _continuity_consume(self, *, steps: int = 0, tool_calls: int = 0) -> None:
        if self.journal_mode == "replay":
            return
        try:
            self.continuity.consume(steps, tool_calls)
        except Exception as error:
            if self.continuity.required:
                raise RuntimeError("continuity_required_failed") from error
            print(f"[!] Continuity warning: {error}")

    def _remaining_timeout(self, operation_cap: float) -> float:
        if self._started_at is None:
            return min(operation_cap, float(self.limits.runtime_timeout_seconds))
        remaining = self.limits.runtime_timeout_seconds - (
            time.monotonic() - self._started_at
        )
        if remaining <= 0:
            raise RuntimeError("runtime budget exceeded: total runtime")
        return min(operation_cap, remaining)

    def _call_api(self, tools: List[Dict]) -> Dict:
        """Call the Chat Completions API."""
        if not _BASE_URL:
            print("[!] FORGEWRIGHT_API_URL or NINEROUTER_BASE_URL env var is not set.")
            sys.exit(1)
        if not _API_KEY:
            print("[!] FORGEWRIGHT_API_KEY or NINEROUTER_API_KEY env var is not set.")
            sys.exit(1)
        if not _MODEL:
            print("[!] FORGEWRIGHT_MODEL env var is not set.")
            sys.exit(1)
        headers = {
            "Authorization": f"Bearer {_API_KEY}",
            "Content-Type": "application/json",
        }

        if _serialized_size(self.messages) > self.limits.max_context_bytes:
            raise RuntimeError("runtime budget exceeded: context bytes")
        data = {
            "model": _MODEL,
            "messages": self.messages,
            "temperature": 0.1,
            "max_tokens": self.limits.max_output_tokens,
        }
        if tools:
            data["tools"] = tools

        print(f"[*] Calling {_PROVIDER}/{_MODEL} (Messages: {len(self.messages)})...")
        resp = requests.post(
            _BASE_URL,
            headers=headers,
            json=data,
            timeout=self._remaining_timeout(120),
            stream=True,
        )
        response_text = _read_bounded_response(
            resp, self.limits.max_http_response_bytes
        )

        if response_text.startswith("data: "):
            lines = response_text.split("\n")
            content = ""
            tool_calls = {}
            for line in lines:
                line = line.strip()
                if line.startswith("data: ") and line != "data: [DONE]":
                    try:
                        chunk = json.loads(line[6:])
                        if not chunk.get("choices"):
                            continue
                        delta = chunk["choices"][0].get("delta", {})
                        if "content" in delta and delta["content"]:
                            content += delta["content"]
                        if "tool_calls" in delta:
                            for tc in delta["tool_calls"]:
                                tc_index = tc.get("index")
                                if tc_index not in tool_calls:
                                    tool_calls[tc_index] = {
                                        "id": tc.get("id"),
                                        "type": tc.get("type", "function"),
                                        "function": {"name": "", "arguments": ""},
                                    }
                                if tc.get("function"):
                                    if (
                                        "name" in tc["function"]
                                        and tc["function"]["name"]
                                    ):
                                        tool_calls[tc_index]["function"]["name"] += tc[
                                            "function"
                                        ]["name"]
                                    if (
                                        "arguments" in tc["function"]
                                        and tc["function"]["arguments"]
                                    ):
                                        tool_calls[tc_index]["function"][
                                            "arguments"
                                        ] += tc["function"]["arguments"]
                    except Exception:  # noqa: E722
                        pass

            message = {"role": "assistant"}
            if content:
                message["content"] = content
            if tool_calls:
                message["tool_calls"] = [
                    tool_calls[idx] for idx in sorted(tool_calls.keys())
                ]
            return message
        else:
            try:
                text = response_text.replace("data: [DONE]", "").strip()
                resp_json = json.loads(text)
            except Exception:
                print(f"[!] API Error, non-JSON response: {repr(response_text)}")
                sys.exit(1)

            if "choices" not in resp_json:
                print(f"[!] API Error: {resp_json}")
                sys.exit(1)

            return resp_json["choices"][0]["message"]

    def _record_loop_failure(self, error: BaseException) -> None:
        assert self.journal is not None
        events = self.journal.read()
        if events and events[-1]["kind"] in {"loop.completed", "loop.failed"}:
            return
        failure = {
            "error_type": type(error).__name__,
            "error_digest": digest(str(error)),
            "after_event_sequence": len(events),
        }
        self._journal_append("lifecycle.event", {"phase": "runtime.failed", **failure})
        self._journal_append("loop.failed", failure)

    def _consume_recorded_failure(self, error: BaseException) -> bool:
        if not isinstance(error, RecordedLoopFailure) or self.replay_cursor is None:
            return False
        expected_sequence = self.replay_cursor.index
        lifecycle_failure = self.replay_cursor.take("lifecycle.event")
        failure = {
            key: value for key, value in lifecycle_failure.items() if key != "phase"
        }
        if (
            failure != error.failure
            or failure.get("after_event_sequence") != expected_sequence
            or self.replay_cursor.take("loop.failed") != failure
        ):
            raise JournalError("replay_mismatch") from error
        self.replay_cursor.finish()
        return True

    async def run(self, task: str):
        if self.journal_mode == "record":
            assert self.journal is not None
            self.journal.begin_record()
        self._started_at = time.monotonic()
        loop_binding = {
            "project_id": self.project_id,
            "workspace_digest": digest(self.code_dir),
            "task_digest": digest(task),
        }
        try:
            self._journal_lifecycle("runtime.started", **loop_binding)
            await self._run_inner(task)
        except (Exception, SystemExit) as error:
            if self.journal_mode == "record":
                self._record_loop_failure(error)
            elif self.journal_mode == "replay":
                self._consume_recorded_failure(error)
            print(f"[!] Orchestrator Error: {str(error)}")
            raise SystemExit(1) from None
        finally:
            if self.journal_mode == "record" and self.journal is not None:
                self.journal.end_record()

    async def _run_inner(self, task: str):
        if self.journal_mode == "replay":
            continuity_context = {"status": "replay-offline"}
        else:
            validate_production_containment()
            self.continuity.bind_task(task)
            try:
                continuity_context = self.continuity.resume()
            except Exception as error:
                if self.continuity.required:
                    raise RuntimeError("continuity_required_failed") from error
                print(f"[!] Continuity warning: {error}")
                continuity_context = {"status": "fresh-start"}

        # 1. Auto-Setup MCP for the project if manifest does not exist
        manifest_path = os.path.join(self.code_dir, ".antigravity", "mcp-manifest.json")
        forgewright_manifest_path = os.path.join(
            self.code_dir, "..", ".forgewright", "mcp-manifest.json"
        )
        if (
            self.journal_mode != "replay"
            and not os.path.exists(manifest_path)
            and not os.path.exists(forgewright_manifest_path)
        ):
            print(
                f"[*] Missing MCP Manifest in '{self.code_dir}'. Running auto-setup..."
            )
            # Use the repo-relative mcp-setup script.
            mcp_setup_script = os.path.join(
                _REPO_ROOT, "scripts", "forgewright-mcp-setup.sh"
            )
            try:
                subprocess.run(
                    ["bash", mcp_setup_script],
                    cwd=self.code_dir,
                    check=True,
                    timeout=self._remaining_timeout(300),
                )
            except Exception as e:
                print(f"[!] Warning: Auto-setup failed: {e}")

        # Define isolated path for DB
        gitnexus_db_path = os.path.normpath(
            os.path.join(self.code_dir, "..", "gitnexus_db")
        )

        gitnexus_env = {**os.environ}
        gitnexus_env["FORGEWRIGHT_WORKSPACE"] = self.code_dir
        gitnexus_env["GITNEXUS_DB"] = gitnexus_db_path

        mcp_servers = [
            {
                "name": "filesystem",
                "params": StdioServerParameters(
                    command="npx",
                    args=[
                        "-y",
                        "@modelcontextprotocol/server-filesystem",
                        self.code_dir,
                    ],
                    env=gitnexus_env,
                ),
            },
            {
                "name": "gitnexus",
                "params": StdioServerParameters(
                    command="gitnexus",
                    args=["mcp"],
                    cwd=self.code_dir,
                    env=gitnexus_env,
                ),
            },
        ]
        if os.environ.get("FORGEWRIGHT_ENABLE_NLM", "").lower() in {"1", "true", "yes"}:
            mcp_servers.append(
                {
                    "name": "nlm",
                    "optional": True,
                    "params": StdioServerParameters(
                        command="nlm", args=["mcp"], env={**os.environ}
                    ),
                }
            )

        if os.path.exists(
            os.path.join(self.code_dir, ".antigravity", "mcp-manifest.json")
        ) or os.path.exists(
            os.path.join(self.code_dir, "..", ".forgewright", "mcp-manifest.json")
        ):
            # Use the repo-relative launcher script.
            mcp_launcher = os.path.join(
                _REPO_ROOT, "scripts", "forgewright-mcp-launcher.sh"
            )
            mcp_servers.append(
                {
                    "name": "forgewright",
                    "optional": True,
                    "params": StdioServerParameters(
                        command="bash",
                        args=[mcp_launcher],
                        env={**os.environ, "FORGEWRIGHT_WORKSPACE": self.code_dir},
                    ),
                }
            )

        # Extract project context for the agent runtime.
        project_context = ""
        readme_path = os.path.join(self.code_dir, "README.md")
        profile_path = os.path.join(
            self.code_dir, "..", ".forgewright", "project-profile.json"
        )
        pkg_path = os.path.join(self.code_dir, "package.json")

        try:
            if os.path.exists(readme_path):
                with open(readme_path, "r", encoding="utf-8") as f:
                    project_context = f.read()[:2000]
            elif os.path.exists(profile_path):
                with open(profile_path, "r", encoding="utf-8") as f:
                    project_context = f.read()[:2000]
            elif os.path.exists(pkg_path):
                with open(pkg_path, "r", encoding="utf-8") as f:
                    project_context = f.read()[:2000]
            else:
                project_context = "Chưa có thông tin README.md hoặc project-profile.json. Đây có thể là dự án mới khởi tạo."
        except Exception:
            project_context = "Không thể đọc thông tin ngữ cảnh dự án do lỗi cấp quyền hoặc định dạng file."

        # Determine if running in Lite mode vs Legacy Mode
        use_lite = os.environ.get("FORGEWRIGHT_LITE", "false").lower() == "true"
        deferred_skill_names: list[str] = []

        if use_lite:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            repo_root = os.path.abspath(os.path.join(script_dir, "../.."))
            kernel_dir = os.path.join(repo_root, "kernel")

            entry_content = ""
            solve_content = ""
            verify_content = ""
            escalate_content = ""

            entry_path = os.path.join(kernel_dir, "ENTRY.md")
            if os.path.exists(entry_path):
                with open(entry_path, "r", encoding="utf-8") as f:
                    entry_content = f.read()

            solve_path = os.path.join(kernel_dir, "SOLVE.md")
            if os.path.exists(solve_path):
                with open(solve_path, "r", encoding="utf-8") as f:
                    solve_content = f.read()

            verify_path = os.path.join(kernel_dir, "VERIFY.md")
            if os.path.exists(verify_path):
                with open(verify_path, "r", encoding="utf-8") as f:
                    verify_content = f.read()

            escalate_path = os.path.join(kernel_dir, "ESCALATE.md")
            if os.path.exists(escalate_path):
                with open(escalate_path, "r", encoding="utf-8") as f:
                    escalate_content = f.read()

            # The local config owns ordered mode routing and its cap. Ordinary
            # prompts with no configured mode intentionally keep the safe base
            # Lite prompt without a skill overlay.
            routing = route_skills(prompt=task, project_root=repo_root)
            if routing["status"] != "ok":
                raise RuntimeError(
                    "skill routing failed: " + "; ".join(routing["errors"])
                )
            deferred_skill_names = _deferred_skill_names(routing)
            deferred_inventory_json = json.dumps(
                deferred_skill_names, ensure_ascii=False, separators=(",", ":")
            )
            for server in mcp_servers:
                if server["name"] == "forgewright":
                    server["params"].env = {
                        **(server["params"].env or {}),
                        "FORGEWRIGHT_DEFERRED_SKILLS_JSON": deferred_inventory_json,
                    }

            skill_overlay_content = ""
            for skill in routing["skills"]:
                with open(skill["lite_path"], "r", encoding="utf-8") as f:
                    skill_overlay_content += (
                        f"\n## Skill-Specific Instructions: {skill['name']}\n"
                        f"{f.read()}\n"
                    )
                print(f"[*] Loaded skill LITE overlay: {skill['name']}")

            system_prompt = f"""
{entry_content}

{solve_content}

{verify_content}

{escalate_content}
"""
            if skill_overlay_content:
                system_prompt += (
                    f"\n## Skill-Specific Instructions\n{skill_overlay_content}\n"
                )

            system_prompt += f"""
## Current Task Context
- Project: '{self.project_id}'
- Workspace: '{self.code_dir}'

Nhiệm vụ từ Sếp: {task}
Áp dụng SOLVE.md theo effort class phù hợp; không xuất scratchpad hoặc chain-of-thought.
"""
        else:
            system_prompt = f"""
Bạn là Forgewright Agent Executor.
Dự án bạn đang làm việc: '{self.project_id}'
Thư mục mã nguồn cục bộ: '{self.code_dir}'
Thư mục Database GitNexus của dự án (Isolate Data): '{gitnexus_db_path}'

[NGỮ CẢNH DỰ ÁN TÓM TẮT]:
{project_context}

[YÊU CẦU BẮT BUỘC]:
1. Bạn phải TỰ CHỦ sử dụng các Function Tools (do hệ thống MCP cung cấp) để dọc mã nguồn, tạo thư mục, viết/sửa code theo yêu cầu của Sếp.
2. Cấm "đoán" cấu trúc thư mục, hãy dùng lệnh thích hợp để list file trước khi sửa hoặc viết đè.
3. Luôn đảm bảo bạn tự kiểm tra code sau khi viết. 
4. Nếu có tool hỗ trợ chạy Terminal, bạn được phép gọi các lệnh như `npm run build` hoặc `test` để tự Debug kết quả.

Nhiệm vụ từ Sếp: {task}
Khi bạn nghĩ rằng mình ĐÃ THỰC THI XONG VÀ HOÀN CHỈNH CODE, hãy trả về kết quả bằng văn bản bình thường (không gọi tool nữa) để hệ thống kết thúc và deploy.
"""
        if continuity_context.get("status") == "resumable-context":
            compact_continuity = self.continuity.compact_context()
            if compact_continuity is not None:
                system_prompt += (
                    "\n\n## Resumable Context (context-only, untrusted)\n"
                    "Re-ground every claim against the current workspace before acting.\n"
                    + json.dumps(
                        compact_continuity,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                )
        self.messages.append({"role": "system", "content": system_prompt.strip()})
        self.messages.append(
            {"role": "user", "content": f"Bắt đầu xử lý tính năng: {task}"}
        )

        pending_completion: dict[str, Any] | None = None
        pending_final_str = ""
        try:
            async with AsyncExitStack() as stack:
                active_sessions = {}
                if self.journal_mode != "replay":
                    for srv in mcp_servers:
                        try:
                            # AnyIO's stdio client owns a task-local cancel scope. Using
                            # asyncio.wait_for() here enters that scope in a child task,
                            # while AsyncExitStack closes it in this task and crashes
                            # cleanup with "exit cancel scope in a different task".
                            # asyncio.timeout() preserves task identity.
                            async with asyncio.timeout(
                                self._remaining_timeout(self.limits.mcp_timeout_seconds)
                            ):
                                read, write = await stack.enter_async_context(
                                    stdio_client(srv["params"])
                                )
                                session = await stack.enter_async_context(
                                    ClientSession(read, write)
                                )
                            await asyncio.wait_for(
                                session.initialize(),
                                timeout=self._remaining_timeout(
                                    self.limits.mcp_timeout_seconds
                                ),
                            )
                            active_sessions[srv["name"]] = session
                            print(f"[✓] MCP Server connected: {srv['name']}")
                        except Exception as e:
                            print(
                                f"[!] Warning: Failed to connect to MCP Server: {srv['name']} - {e}"
                            )
                            if not srv.get("optional", False):
                                raise RuntimeError(
                                    f"Required MCP server failed: {srv['name']}"
                                ) from e

                    if not active_sessions:
                        raise RuntimeError(
                            "No MCP Servers could be connected. Check dependencies."
                        )

                tools_payload = []
                tool_to_session_map = {}
                deferred_loader_name: str | None = None
                tool_catalog: list[dict[str, Any]] = []
                loop_binding = {
                    "project_id": self.project_id,
                    "workspace_digest": digest(self.code_dir),
                    "task_digest": digest(task),
                }
                if self.journal_mode == "replay":
                    started = self._journal_take("loop.started")
                    if any(
                        started.get(key) != value for key, value in loop_binding.items()
                    ):
                        raise JournalError("replay_mismatch")
                    tool_catalog = normalize(started.get("tools", []))
                    if not isinstance(tool_catalog, list):
                        raise JournalError("replay_mismatch")
                    for entry in tool_catalog:
                        exposed_name = entry["exposed_name"]
                        original_name = entry["original_name"]
                        server_name = entry["server_name"]
                        tool_to_session_map[exposed_name] = (
                            None,
                            original_name,
                            server_name,
                        )
                        if (
                            server_name == "forgewright"
                            and original_name == _DEFERRED_SKILL_TOOL
                        ):
                            deferred_loader_name = exposed_name
                        tools_payload.append(
                            {
                                "type": "function",
                                "function": {
                                    "name": exposed_name,
                                    "description": "",
                                    "parameters": {},
                                    "_forgewright_description_digest": entry[
                                        "description_digest"
                                    ],
                                    "_forgewright_parameters_digest": entry[
                                        "parameters_digest"
                                    ],
                                },
                            }
                        )
                else:
                    for srv_name, session in active_sessions.items():
                        mcp_tools = await asyncio.wait_for(
                            session.list_tools(),
                            timeout=self._remaining_timeout(
                                self.limits.mcp_timeout_seconds
                            ),
                        )
                        for tool in mcp_tools.tools:
                            if (
                                srv_name == "filesystem"
                                and tool.name not in _FILESYSTEM_TOOLS
                            ):
                                raise RuntimeError(
                                    f"Filesystem MCP advertised unknown capability: {tool.name}"
                                )
                            if (
                                srv_name == "forgewright"
                                and tool.name == _DEFERRED_SKILL_TOOL
                                and not deferred_skill_names
                            ):
                                raise RuntimeError(
                                    "Forgewright MCP exposed deferred loader without inventory"
                                )
                            exposed_name = qualified_tool_name(srv_name, tool.name)
                            if exposed_name in tool_to_session_map:
                                raise RuntimeError(
                                    f"Qualified MCP tool collision: {exposed_name}"
                                )
                            tool_to_session_map[exposed_name] = (
                                session,
                                tool.name,
                                srv_name,
                            )
                            if (
                                srv_name == "forgewright"
                                and tool.name == _DEFERRED_SKILL_TOOL
                            ):
                                deferred_loader_name = exposed_name
                            catalog_entry = {
                                "exposed_name": exposed_name,
                                "original_name": tool.name,
                                "server_name": srv_name,
                                "description_digest": digest(tool.description or ""),
                                "description_bytes": len(
                                    (tool.description or "").encode("utf-8")
                                ),
                                "parameters_digest": digest(tool.inputSchema),
                                "parameters_bytes": _serialized_size(tool.inputSchema),
                            }
                            tool_catalog.append(catalog_entry)
                            tools_payload.append(
                                {
                                    "type": "function",
                                    "function": {
                                        "name": exposed_name,
                                        "description": tool.description,
                                        "parameters": tool.inputSchema,
                                    },
                                }
                            )
                tool_count = len(tool_catalog)
                tool_schema_bytes = _serialized_size(tools_payload)
                if self.journal_mode == "replay":
                    if started.get("tool_count") != tool_count or not isinstance(
                        started.get("tool_schema_bytes"), int
                    ):
                        raise JournalError("replay_mismatch")
                    tool_schema_bytes = started["tool_schema_bytes"]
                else:
                    self._journal_append(
                        "loop.started",
                        {
                            **loop_binding,
                            "tool_count": tool_count,
                            "tool_schema_bytes": tool_schema_bytes,
                            "tools": tool_catalog,
                        },
                    )
                if tool_count > self.limits.max_tools:
                    raise RuntimeError("runtime budget exceeded: tool count")
                if tool_schema_bytes > self.limits.max_tool_schema_bytes:
                    raise RuntimeError("runtime budget exceeded: tool schema bytes")

                if use_lite and deferred_skill_names:
                    self.messages[0]["content"] += _deferred_skill_guidance(
                        deferred_skill_names, deferred_loader_name
                    )

                total_tool_calls = 0
                loaded_deferred_skills: set[str] = set()
                turn = 0
                while True:
                    turn += 1
                    if (
                        self.limits.max_turns is not None
                        and turn > self.limits.max_turns
                    ):
                        raise RuntimeError("runtime limit exceeded: max turns")
                    if (
                        time.monotonic() - self._started_at
                        > self.limits.runtime_timeout_seconds
                    ):
                        raise RuntimeError("runtime budget exceeded: total runtime")

                    # 2. Provider-neutral model reasoning
                    self._continuity_boundary(
                        "before-model", turn, total_tool_calls, steps=1
                    )
                    reply = self._model_exchange(tools_payload, turn)
                    self.messages.append(reply)

                    # 3. Tool Execution Phase
                    if "tool_calls" in reply and reply["tool_calls"]:
                        if (
                            len(reply["tool_calls"])
                            > self.limits.max_tool_calls_per_turn
                        ):
                            raise RuntimeError(
                                "runtime budget exceeded: tool calls per turn"
                            )
                        for tool_index, tcall in enumerate(reply["tool_calls"], 1):
                            tname = tcall["function"]["name"]
                            total_tool_calls += 1
                            if total_tool_calls > self.limits.max_tool_calls_total:
                                raise RuntimeError(
                                    "runtime budget exceeded: total tool calls"
                                )
                            raw_arguments = tcall["function"].get("arguments", "")
                            if (
                                len(raw_arguments.encode("utf-8"))
                                > self.limits.max_tool_argument_bytes
                            ):
                                raise RuntimeError(
                                    "runtime budget exceeded: tool argument bytes"
                                )
                            targs = json.loads(raw_arguments)
                            if not isinstance(targs, dict):
                                raise ValueError(
                                    "MCP tool arguments must decode to an object"
                                )
                            replay_arguments_digest = tcall["function"].get(
                                "_forgewright_arguments_digest"
                            )
                            if self.journal_mode == "replay" and (
                                not isinstance(replay_arguments_digest, str)
                                or len(replay_arguments_digest) != 64
                            ):
                                raise JournalError("replay_mismatch")
                            self._tool_request(
                                turn,
                                tool_index,
                                tname,
                                targs,
                                replay_arguments_digest,
                            )
                            print(f" ⚙️  Thực thi Tool: {tname} | Args: {targs}")

                            replay_taken = False
                            result_is_error = True
                            result_digest: str | None = None
                            semantic_tool = tname
                            target = tool_to_session_map.get(tname)
                            if not target:
                                self._journal_containment(
                                    turn=turn,
                                    index=tool_index,
                                    tool=tname,
                                    server=None,
                                    decision=(
                                        None
                                        if self.journal_mode == "replay"
                                        else "denied-unknown-tool"
                                    ),
                                )
                                res_text = f"Execution Error: Unknown tool {tname} - It was not supplied by any connected MCP server."
                            else:
                                target_session, original_tool_name, server_name = target
                                semantic_tool = original_tool_name
                                try:
                                    if is_material_effect(
                                        server_name, original_tool_name
                                    ):
                                        self._continuity_boundary(
                                            "before-effect",
                                            turn,
                                            total_tool_calls,
                                            tool_calls=1,
                                        )
                                    else:
                                        self._continuity_consume(tool_calls=1)
                                    containment_error = None
                                    if self.journal_mode == "replay":
                                        containment_decision = (
                                            self._journal_containment(
                                                turn=turn,
                                                index=tool_index,
                                                tool=tname,
                                                server=server_name,
                                                decision=None,
                                            )
                                        )
                                        containment_error = (
                                            None
                                            if containment_decision == "admitted"
                                            else "Execution Error: replayed containment denial."
                                        )
                                        result = None
                                    elif server_name == "filesystem":
                                        containment_error = (
                                            validate_filesystem_tool_call(
                                                original_tool_name, targs, self.code_dir
                                            )
                                        )
                                        if containment_error is not None:
                                            res_text = containment_error
                                            result = None
                                        else:
                                            result = None
                                    if self.journal_mode != "replay":
                                        self._journal_containment(
                                            turn=turn,
                                            index=tool_index,
                                            tool=tname,
                                            server=server_name,
                                            decision=(
                                                "denied"
                                                if containment_error is not None
                                                else "admitted"
                                            ),
                                        )
                                    requested_skill = targs.get("name")
                                    if (
                                        containment_error is None
                                        and server_name != "filesystem"
                                        and use_lite
                                        and tname == deferred_loader_name
                                    ):
                                        if requested_skill not in deferred_skill_names:
                                            res_text = (
                                                "Execution Error: skill is not in the "
                                                "current deferred inventory"
                                            )
                                            result = None
                                        elif requested_skill in loaded_deferred_skills:
                                            res_text = (
                                                "Execution Error: deferred skill overlay "
                                                "was already loaded"
                                            )
                                            result = None
                                        else:
                                            if self.journal_mode == "replay":
                                                (
                                                    res_text,
                                                    result_is_error,
                                                    result_digest,
                                                ) = self._take_tool_result(
                                                    turn, tool_index, tname
                                                )
                                                replay_taken = True
                                                result = None
                                            else:
                                                result = await asyncio.wait_for(
                                                    target_session.call_tool(
                                                        original_tool_name,
                                                        arguments=targs,
                                                    ),
                                                    timeout=self._remaining_timeout(
                                                        self.limits.mcp_timeout_seconds
                                                    ),
                                                )
                                    elif containment_error is None:
                                        if self.journal_mode == "replay":
                                            (
                                                res_text,
                                                result_is_error,
                                                result_digest,
                                            ) = self._take_tool_result(
                                                turn, tool_index, tname
                                            )
                                            replay_taken = True
                                            result = None
                                        else:
                                            result = await asyncio.wait_for(
                                                target_session.call_tool(
                                                    original_tool_name, arguments=targs
                                                ),
                                                timeout=self._remaining_timeout(
                                                    self.limits.mcp_timeout_seconds
                                                ),
                                            )
                                    if result is not None:
                                        res_text = "\n".join(
                                            [
                                                c.text
                                                for c in result.content
                                                if hasattr(c, "text")
                                            ]
                                        )
                                        result_is_error = bool(
                                            getattr(result, "isError", False)
                                        )
                                        if (
                                            use_lite
                                            and tname == deferred_loader_name
                                            and not getattr(result, "isError", False)
                                        ):
                                            loaded_deferred_skills.add(requested_skill)
                                except Exception as e:
                                    res_text = f"Execution Error: {str(e)}"
                                    result_is_error = True
                            res_text = res_text.replace("\r\n", "\n").replace(
                                "\r", "\n"
                            )
                            if self.journal_mode == "replay" and not replay_taken:
                                (
                                    res_text,
                                    result_is_error,
                                    result_digest,
                                ) = self._take_tool_result(
                                    turn,
                                    tool_index,
                                    tname,
                                )
                            if (
                                len(res_text.encode("utf-8"))
                                > self.limits.max_tool_result_bytes
                            ):
                                raise RuntimeError(
                                    "runtime budget exceeded: tool result bytes"
                                )
                            if (
                                use_lite
                                and tname == deferred_loader_name
                                and not result_is_error
                            ):
                                loaded_deferred_skills.add(requested_skill)
                            self._record_tool_result(
                                turn,
                                tool_index,
                                tname,
                                res_text,
                                result_is_error,
                            )
                            self._journal_tool_semantics(
                                semantic_tool,
                                turn,
                                res_text,
                                result_is_error,
                                result_digest,
                            )

                            tool_message = {
                                "role": "tool",
                                "tool_call_id": tcall["id"],
                                "name": tname,
                                "content": res_text,
                            }
                            if result_digest is not None:
                                tool_message["_forgewright_content_digest"] = (
                                    result_digest
                                )
                            self.messages.append(tool_message)
                        self._continuity_boundary(
                            "step-boundary", turn, total_tool_calls
                        )
                    else:
                        # Final output reached
                        final_str = reply.get("content", "")
                        final_digest = reply.get("_forgewright_content_digest")
                        if not isinstance(final_digest, str):
                            final_digest = digest(final_str)
                        pending_completion = {
                            "turn": turn,
                            "total_tool_calls": total_tool_calls,
                            "final_digest": final_digest,
                        }
                        pending_final_str = final_str
                        break
            if pending_completion is None:
                raise RuntimeError("agent loop ended without a terminal result")
            self._journal_lifecycle(
                "runtime.completed",
                turn=pending_completion["turn"],
                total_tool_calls=pending_completion["total_tool_calls"],
                final_digest=pending_completion["final_digest"],
            )
            self._journal_append("loop.completed", pending_completion)
            self._journal_expect("loop.completed", pending_completion)
            if self.journal_mode == "replay":
                assert self.replay_cursor is not None
                self.replay_cursor.finish()
            print(f"\n[🏁 KẾT THÚC TASK]\n{pending_final_str}")
        except (Exception, SystemExit):
            raise


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(
            "Usage: python3 forgewright-orchestrator.py <PROJECT_ID> <TASK_PROMPT> [CODE_DIR]"
        )
        sys.exit(1)

    pid = sys.argv[1]
    task_desc = sys.argv[2]
    # Default to a subdirectory inside the repo root rather than /root/projects.
    cdir = (
        sys.argv[3]
        if len(sys.argv) > 3
        else os.path.join(_REPO_ROOT, "projects", pid, "code")
    )

    agent = ForgewrightAgent(pid, cdir)
    asyncio.run(agent.run(task_desc))
