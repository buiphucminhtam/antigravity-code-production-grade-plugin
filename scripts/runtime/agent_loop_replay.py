#!/usr/bin/env python3
"""Bounded provider-neutral agent-loop journal and strict replay cursor."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import Any, TextIO

if os.name == "nt":
    import msvcrt
else:
    import fcntl

SCHEMA = "forgewright-agent-loop/v1"
FIXTURE_VERSION = "1"
MAX_EVENT_BYTES = 64 * 1024
MAX_JOURNAL_BYTES = 4 * 1024 * 1024
MAX_EVENTS = 10_000
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
KINDS = {
    "loop.started",
    "lifecycle.event",
    "containment.decision",
    "checkpoint.boundary",
    "model.request",
    "model.response",
    "tool.request",
    "tool.result",
    "approval.requested",
    "approval.approved",
    "approval.rejected",
    "evidence.recorded",
    "loop.completed",
    "loop.failed",
}
SECRET = re.compile(
    r"(?:"
    r"(?:sk-|ghp_|AKIA)[A-Za-z0-9_-]{16,}"
    r"|bearer\s+[A-Za-z0-9._~+/=-]{8,}"
    r"|(?:password|passwd|secret|token)\s*[:=]\s*\S{4,}"
    r")",
    re.I,
)
FORBIDDEN = {
    "chain_of_thought",
    "reasoning",
    "scratchpad",
    "api_key",
    "authorization",
    "prompt",
}


class JournalError(RuntimeError):
    pass


def _is_digest(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _is_nonnegative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _exact_keys(payload: dict[str, Any], keys: set[str]) -> None:
    if set(payload) != keys:
        raise JournalError("invalid_payload_schema")


def canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def _validate(value: Any) -> None:
    if isinstance(value, str) and SECRET.search(value):
        raise JournalError("secret_rejected")
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in FORBIDDEN:
                raise JournalError("private_content_rejected")
            _validate(item)
    elif isinstance(value, list):
        for item in value:
            _validate(item)


def normalize(value: Any) -> Any:
    _validate(value)
    if isinstance(value, dict):
        return {str(key): normalize(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > 2**53 - 1:
            raise JournalError("non_json_metadata")
        return value
    raise JournalError("non_json_metadata")


def _validate_payload(kind: str, payload: dict[str, Any]) -> None:
    digest_keys: tuple[str, ...] = ()
    int_keys: tuple[str, ...] = ()
    if kind == "loop.started":
        _exact_keys(
            payload,
            {
                "project_id",
                "workspace_digest",
                "task_digest",
                "tool_count",
                "tool_schema_bytes",
                "tools",
            },
        )
        digest_keys = ("workspace_digest", "task_digest")
        int_keys = ("tool_count", "tool_schema_bytes")
        if (
            not isinstance(payload["project_id"], str)
            or not isinstance(payload["tools"], list)
            or payload["tool_count"] != len(payload["tools"])
        ):
            raise JournalError("invalid_payload_schema")
        for tool in payload["tools"]:
            if not isinstance(tool, dict):
                raise JournalError("invalid_payload_schema")
            _exact_keys(
                tool,
                {
                    "exposed_name",
                    "original_name",
                    "server_name",
                    "description_digest",
                    "description_bytes",
                    "parameters_digest",
                    "parameters_bytes",
                },
            )
            if (
                not all(
                    isinstance(tool[key], str)
                    for key in (
                        "exposed_name",
                        "original_name",
                        "server_name",
                    )
                )
                or not _is_digest(tool["description_digest"])
                or not _is_nonnegative_int(tool["description_bytes"])
                or not _is_digest(tool["parameters_digest"])
                or not _is_nonnegative_int(tool["parameters_bytes"])
            ):
                raise JournalError("invalid_payload_schema")
    elif kind == "lifecycle.event":
        phase = payload.get("phase")
        if phase == "runtime.started":
            _exact_keys(
                payload,
                {"phase", "project_id", "workspace_digest", "task_digest"},
            )
            digest_keys = ("workspace_digest", "task_digest")
            if not isinstance(payload["project_id"], str):
                raise JournalError("invalid_payload_schema")
        elif phase == "runtime.completed":
            _exact_keys(payload, {"phase", "turn", "total_tool_calls", "final_digest"})
            digest_keys = ("final_digest",)
            int_keys = ("turn", "total_tool_calls")
        elif phase == "runtime.failed":
            _exact_keys(
                payload,
                {
                    "phase",
                    "error_type",
                    "error_digest",
                    "after_event_sequence",
                },
            )
            digest_keys = ("error_digest",)
            int_keys = ("after_event_sequence",)
            if not isinstance(payload["error_type"], str):
                raise JournalError("invalid_payload_schema")
        else:
            raise JournalError("invalid_payload_schema")
    elif kind == "containment.decision":
        _exact_keys(payload, {"turn", "index", "tool", "server", "decision"})
        int_keys = ("turn", "index")
        if (
            not isinstance(payload["tool"], str)
            or not (payload["server"] is None or isinstance(payload["server"], str))
            or payload["decision"] not in {"admitted", "denied", "denied-unknown-tool"}
        ):
            raise JournalError("invalid_payload_schema")
    elif kind == "checkpoint.boundary":
        _exact_keys(
            payload,
            {
                "boundary",
                "turn",
                "total_tool_calls",
                "steps",
                "tool_calls",
                "checkpoint_status",
            },
        )
        int_keys = ("turn", "total_tool_calls", "steps", "tool_calls")
        if payload["boundary"] not in {
            "before-model",
            "before-effect",
            "step-boundary",
        } or payload["checkpoint_status"] not in {"checkpointed", "optional-failed"}:
            raise JournalError("invalid_payload_schema")
    elif kind == "model.request":
        _exact_keys(payload, {"turn", "messages_digest", "tools_digest"})
        int_keys = ("turn",)
        digest_keys = ("messages_digest", "tools_digest")
    elif kind == "model.response":
        _exact_keys(
            payload,
            {"content_digest", "content_bytes", "content_present", "tool_calls"},
        )
        digest_keys = ("content_digest",)
        int_keys = ("content_bytes",)
        if not isinstance(payload["content_present"], bool) or not isinstance(
            payload["tool_calls"], list
        ):
            raise JournalError("invalid_payload_schema")
        for call in payload["tool_calls"]:
            if not isinstance(call, dict):
                raise JournalError("invalid_payload_schema")
            _exact_keys(
                call,
                {"id", "name", "arguments_digest", "arguments_bytes"},
            )
            if (
                not isinstance(call["id"], str)
                or not isinstance(call["name"], str)
                or not _is_digest(call["arguments_digest"])
                or not _is_nonnegative_int(call["arguments_bytes"])
            ):
                raise JournalError("invalid_payload_schema")
    elif kind == "tool.request":
        _exact_keys(payload, {"turn", "index", "tool", "arguments_digest"})
        int_keys = ("turn", "index")
        digest_keys = ("arguments_digest",)
        if not isinstance(payload["tool"], str):
            raise JournalError("invalid_payload_schema")
    elif kind == "tool.result":
        _exact_keys(
            payload,
            {"turn", "index", "tool", "is_error", "output_digest", "output_bytes"},
        )
        int_keys = ("turn", "index", "output_bytes")
        digest_keys = ("output_digest",)
        if not isinstance(payload["tool"], str) or not isinstance(
            payload["is_error"], bool
        ):
            raise JournalError("invalid_payload_schema")
    elif kind in {"approval.requested", "approval.approved", "approval.rejected"}:
        _exact_keys(payload, {"turn", "result_digest"})
        int_keys = ("turn",)
        digest_keys = ("result_digest",)
    elif kind == "evidence.recorded":
        _exact_keys(payload, {"turn", "evidence_digest"})
        int_keys = ("turn",)
        digest_keys = ("evidence_digest",)
    elif kind == "loop.completed":
        _exact_keys(payload, {"turn", "total_tool_calls", "final_digest"})
        int_keys = ("turn", "total_tool_calls")
        digest_keys = ("final_digest",)
    elif kind == "loop.failed":
        _exact_keys(payload, {"error_type", "error_digest", "after_event_sequence"})
        digest_keys = ("error_digest",)
        int_keys = ("after_event_sequence",)
        if not isinstance(payload["error_type"], str):
            raise JournalError("invalid_payload_schema")
    else:
        raise JournalError("invalid_payload_schema")
    if not all(_is_digest(payload[key]) for key in digest_keys) or not all(
        _is_nonnegative_int(payload[key]) for key in int_keys
    ):
        raise JournalError("invalid_payload_schema")


def _validate_loop_grammar(events: list[dict[str, Any]]) -> None:
    state = "initial"
    catalog: dict[str, tuple[str, str]] = {}
    expected_calls: list[dict[str, Any]] = []
    call_position = 0
    current_tool: dict[str, Any] | None = None
    current_turn = 0
    total_tool_calls = 0

    def advance_tool() -> str:
        nonlocal call_position, current_tool
        call_position += 1
        current_tool = None
        if call_position < len(expected_calls):
            return "expect-tool-request"
        return "expect-step-boundary"

    for event_index, event in enumerate(events):
        kind = event["kind"]
        payload = event["payload"]
        phase = payload.get("phase")
        if (
            kind == "lifecycle.event"
            and phase == "runtime.failed"
            and state not in {"initial", "terminal", "failing", "completing"}
        ):
            if payload["after_event_sequence"] != event_index:
                raise JournalError("invalid_event_sequence")
            state = "failing"
            continue
        if (
            state == "initial"
            and kind == "lifecycle.event"
            and phase == "runtime.started"
        ):
            state = "started"
        elif state == "started" and kind == "loop.started":
            catalog = {
                tool["exposed_name"]: (tool["original_name"], tool["server_name"])
                for tool in payload["tools"]
            }
            state = "expect-model-boundary"
        elif state == "expect-model-boundary" and kind == "checkpoint.boundary":
            if (
                payload["boundary"] != "before-model"
                or payload["turn"] != current_turn + 1
                or payload["total_tool_calls"] != total_tool_calls
                or payload["steps"] != 1
                or payload["tool_calls"] != 0
            ):
                raise JournalError("invalid_event_sequence")
            current_turn = payload["turn"]
            state = "expect-model-request"
        elif state == "expect-model-request" and kind == "model.request":
            if payload["turn"] != current_turn:
                raise JournalError("invalid_event_sequence")
            state = "expect-model-response"
        elif state == "expect-model-response" and kind == "model.response":
            expected_calls = payload["tool_calls"]
            call_position = 0
            state = "expect-tool-request" if expected_calls else "expect-completion"
        elif state == "expect-tool-request" and kind == "tool.request":
            expected = expected_calls[call_position]
            if (
                payload["turn"] != current_turn
                or payload["index"] != call_position + 1
                or payload["tool"] != expected["name"]
                or payload["arguments_digest"] != expected["arguments_digest"]
            ):
                raise JournalError("invalid_event_sequence")
            total_tool_calls += 1
            current_tool = payload
            state = "expect-effect-or-containment"
        elif state == "expect-effect-or-containment" and kind == "checkpoint.boundary":
            if (
                payload["boundary"] != "before-effect"
                or payload["turn"] != current_turn
                or payload["total_tool_calls"] != total_tool_calls
                or payload["steps"] != 0
                or payload["tool_calls"] != 1
            ):
                raise JournalError("invalid_event_sequence")
            state = "expect-containment"
        elif (
            state in {"expect-effect-or-containment", "expect-containment"}
            and kind == "containment.decision"
        ):
            if current_tool is None:
                raise JournalError("invalid_event_sequence")
            catalog_entry = catalog.get(current_tool["tool"])
            expected_server = catalog_entry[1] if catalog_entry else None
            if (
                payload["turn"] != current_turn
                or payload["index"] != current_tool["index"]
                or payload["tool"] != current_tool["tool"]
                or payload["server"] != expected_server
            ):
                raise JournalError("invalid_event_sequence")
            state = "expect-tool-result"
        elif state == "expect-tool-result" and kind == "tool.result":
            if current_tool is None or any(
                payload[key] != current_tool[key] for key in ("turn", "index", "tool")
            ):
                raise JournalError("invalid_event_sequence")
            original_name = catalog.get(current_tool["tool"], ("", ""))[0]
            if original_name == "fw_request_gate_approval":
                state = "expect-approval-request"
            elif original_name == "fw_approve_gate":
                state = "expect-approval-decision"
            elif original_name == "fw_check_pipeline_compliance":
                state = "expect-evidence"
            else:
                state = advance_tool()
        elif state == "expect-approval-request" and kind in {
            "approval.requested",
            "approval.rejected",
        }:
            if (
                current_tool is None
                or payload["turn"] != current_turn
                or payload["result_digest"]
                != events[event_index - 1]["payload"]["output_digest"]
            ):
                raise JournalError("invalid_event_sequence")
            state = advance_tool()
        elif state == "expect-approval-decision" and kind in {
            "approval.approved",
            "approval.rejected",
        }:
            if (
                current_tool is None
                or payload["turn"] != current_turn
                or payload["result_digest"]
                != events[event_index - 1]["payload"]["output_digest"]
            ):
                raise JournalError("invalid_event_sequence")
            state = advance_tool()
        elif state == "expect-evidence" and kind == "evidence.recorded":
            if (
                current_tool is None
                or payload["turn"] != current_turn
                or payload["evidence_digest"]
                != events[event_index - 1]["payload"]["output_digest"]
            ):
                raise JournalError("invalid_event_sequence")
            state = advance_tool()
        elif state == "expect-step-boundary" and kind == "checkpoint.boundary":
            if (
                payload["boundary"] != "step-boundary"
                or payload["turn"] != current_turn
                or payload["total_tool_calls"] != total_tool_calls
                or payload["steps"] != 0
                or payload["tool_calls"] != 0
            ):
                raise JournalError("invalid_event_sequence")
            state = "expect-model-boundary"
        elif (
            state == "expect-completion"
            and kind == "lifecycle.event"
            and phase == "runtime.completed"
        ):
            response = events[event_index - 1]["payload"]
            if (
                payload["turn"] != current_turn
                or payload["total_tool_calls"] != total_tool_calls
                or payload["final_digest"] != response["content_digest"]
            ):
                raise JournalError("invalid_event_sequence")
            state = "completing"
        elif state == "completing" and kind == "loop.completed":
            previous = {
                key: value
                for key, value in events[event_index - 1]["payload"].items()
                if key != "phase"
            }
            if payload != previous:
                raise JournalError("invalid_event_sequence")
            state = "terminal"
        elif state == "failing" and kind == "loop.failed":
            previous = {
                key: value
                for key, value in events[event_index - 1]["payload"].items()
                if key != "phase"
            }
            if payload != previous:
                raise JournalError("invalid_event_sequence")
            state = "terminal"
        else:
            raise JournalError("invalid_event_sequence")


def _user_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            info = current.lstat()
            if not hasattr(os, "getuid") or info.st_uid == os.getuid():
                return True
        if not current.exists():
            break
    return False


def _lock_stream(stream: TextIO, *, blocking: bool) -> None:
    if os.name == "nt":
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write("\0")
            stream.flush()
        stream.seek(0)
        try:
            msvcrt.locking(
                stream.fileno(),
                msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK,
                1,
            )
        except OSError as error:
            if not blocking:
                raise BlockingIOError(str(error)) from error
            raise
        return
    fcntl.flock(
        stream.fileno(),
        fcntl.LOCK_EX if blocking else fcntl.LOCK_EX | fcntl.LOCK_NB,
    )


class Journal:
    def __init__(self, directory: Path, loop_id: str):
        if not SAFE_ID.fullmatch(loop_id):
            raise JournalError("invalid_loop_id")
        configured = directory.expanduser().absolute()
        if _user_symlink_component(configured):
            raise JournalError("symlink_rejected")
        self.directory = configured.resolve(strict=False)
        self.loop_id = loop_id
        if self.directory.exists() and self.directory.is_symlink():
            raise JournalError("symlink_rejected")
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.path = self.directory / f"{loop_id}.jsonl"
        self.lock_path = self.directory / f".{loop_id}.lock"
        self._record_lock: TextIO | None = None
        if self.path.exists() and self.path.is_symlink():
            raise JournalError("symlink_rejected")

    def append(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        if kind not in KINDS or not isinstance(payload, dict):
            raise JournalError("invalid_event")
        _validate_payload(kind, payload)
        if self._record_lock is not None:
            return self._append_locked(kind, payload)
        descriptor = os.open(
            self.lock_path,
            os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        with os.fdopen(descriptor, "a+", encoding="utf-8") as lock:
            _lock_stream(lock, blocking=True)
            return self._append_locked(kind, payload)

    def begin_record(self) -> None:
        if self._record_lock is not None:
            raise JournalError("journal_already_claimed")
        descriptor = os.open(
            self.lock_path,
            os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        lock = os.fdopen(descriptor, "a+", encoding="utf-8")
        try:
            _lock_stream(lock, blocking=False)
            if self.read():
                raise JournalError("journal_not_fresh")
            self._record_lock = lock
        except BlockingIOError as error:
            lock.close()
            raise JournalError("journal_in_use") from error
        except BaseException:
            lock.close()
            raise

    def end_record(self) -> None:
        if self._record_lock is not None:
            self._record_lock.close()
            self._record_lock = None

    def _append_locked(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        events = self.read()
        if len(events) >= MAX_EVENTS:
            raise JournalError("event_count_limit")
        previous = events[-1]["hash"] if events else ""
        event = {
            "schema": SCHEMA,
            "fixture_version": FIXTURE_VERSION,
            "sequence": len(events) + 1,
            "kind": kind,
            "payload": normalize(payload),
            "previous_hash": previous,
        }
        event["payload_digest"] = digest(event["payload"])
        event["hash"] = digest(event)
        _validate_loop_grammar([*events, event])
        encoded = canonical(event) + b"\n"
        existing = self._read_bytes()
        if (
            len(encoded) > MAX_EVENT_BYTES
            or len(existing) + len(encoded) > MAX_JOURNAL_BYTES
        ):
            raise JournalError("event_size_limit")
        fd, temporary = tempfile.mkstemp(prefix=".journal-", dir=self.directory)
        try:
            if hasattr(os, "fchmod"):
                os.fchmod(fd, 0o600)
            else:
                os.chmod(temporary, 0o600)
            out = os.fdopen(fd, "wb")
            fd = -1
            with out:
                out.write(existing + encoded)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, self.path)
            if os.name != "nt":
                directory_fd = os.open(self.directory, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            return event
        finally:
            if fd >= 0:
                os.close(fd)
            Path(temporary).unlink(missing_ok=True)

    def read(self) -> list[dict[str, Any]]:
        content = self._read_bytes()
        if not content:
            return []
        events: list[dict[str, Any]] = []
        previous = ""
        for sequence, line in enumerate(content.splitlines(), 1):
            if len(line) > MAX_EVENT_BYTES:
                raise JournalError("event_size_limit")
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise JournalError("corrupt_journal") from error
            if (
                not isinstance(event, dict)
                or set(event)
                != {
                    "schema",
                    "fixture_version",
                    "sequence",
                    "kind",
                    "payload",
                    "previous_hash",
                    "payload_digest",
                    "hash",
                }
                or event.get("schema") != SCHEMA
                or event.get("fixture_version") != FIXTURE_VERSION
                or event.get("sequence") != sequence
                or event.get("previous_hash") != previous
                or event.get("kind") not in KINDS
            ):
                raise JournalError("corrupt_journal")
            unsigned = dict(event)
            stored = unsigned.pop("hash", None)
            if stored != digest(unsigned) or event.get("payload_digest") != digest(
                event.get("payload")
            ):
                raise JournalError("corrupt_journal")
            normalize(event["payload"])
            _validate_payload(event["kind"], event["payload"])
            previous = stored
            events.append(event)
            if len(events) > MAX_EVENTS:
                raise JournalError("event_count_limit")
        _validate_loop_grammar(events)
        return events

    def fixture_fingerprint(self) -> str:
        return digest(self.read())

    def _read_bytes(self) -> bytes:
        if not self.path.exists():
            return b""
        try:
            info = self.path.lstat()
            if (
                stat.S_ISLNK(info.st_mode)
                or not stat.S_ISREG(info.st_mode)
                or info.st_size > MAX_JOURNAL_BYTES
            ):
                raise JournalError("corrupt_journal")
            descriptor = os.open(self.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(descriptor, "rb") as stream:
                return stream.read(MAX_JOURNAL_BYTES + 1)
        except OSError as error:
            raise JournalError("corrupt_journal") from error


class ReplayCursor:
    def __init__(self, events: list[dict[str, Any]]):
        self.events, self.index = events, 0

    def expect(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.index >= len(self.events):
            raise JournalError("replay_missing_event")
        event = self.events[self.index]
        if event["kind"] != kind or event["payload_digest"] != digest(
            normalize(payload)
        ):
            raise JournalError(
                f"replay_mismatch:index={self.index}:expected={event['kind']}:actual={kind}"
            )
        self.index += 1
        return event["payload"]

    def take(self, kind: str) -> dict[str, Any]:
        if self.index >= len(self.events) or self.events[self.index]["kind"] != kind:
            expected = (
                self.events[self.index]["kind"]
                if self.index < len(self.events)
                else "<end>"
            )
            raise JournalError(
                f"replay_mismatch:index={self.index}:expected={expected}:actual={kind}"
            )
        event = self.events[self.index]
        self.index += 1
        return event["payload"]

    def peek(self) -> tuple[str, dict[str, Any]] | None:
        if self.index >= len(self.events):
            return None
        event = self.events[self.index]
        return event["kind"], event["payload"]

    def finish(self) -> None:
        if self.index != len(self.events):
            raise JournalError("replay_extra_event")
