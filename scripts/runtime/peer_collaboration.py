#!/usr/bin/env python3
"""Bounded, local-only peer collaboration owned by an orchestrator.

The public write API is capability-based: a participant receives an opaque
in-memory channel and the parent receives a separate controller.  Event
payloads are untrusted structured data; this module does not detect prompt
injection.  The JSONL path is protected against symlinked layout components;
portable multi-process replacement races remain outside this in-process lock.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import stat
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Mapping


EVENT_KINDS = (
    "session.opened",
    "assignment.sent",
    "peer.message",
    "artifact.proposed",
    "finding.reported",
    "blocker.reported",
    "decision.requested",
    "decision.issued",
    "session.closed",
    "policy.rejected",
)
PRIVILEGED_KINDS = {
    "session.opened",
    "decision.issued",
    "session.closed",
    "policy.rejected",
}
PEER_PROFILES = ("concept-artist", "art-director")
MAX_PEERS = 3
MAX_ROUNDS = 1
MAX_EVENTS = 12
MAX_EVENT_BYTES = 16 * 1024
MAX_TOTAL_BYTES = MAX_EVENTS * MAX_EVENT_BYTES
MAX_PAYLOAD_DEPTH = 4
MAX_STRING_CHARS = 2048
MAX_LIST_ITEMS = 64
MAX_OBJECT_PROPERTIES = 32
_PAYLOAD_STRING_FIELDS = {
    "assignment_id",
    "blocker_id",
    "decision_event_id",
    "finding_id",
    "message",
    "reason",
    "request_id",
    "selected",
    "summary",
}
_PAYLOAD_LIST_FIELDS = {"evidence", "profiles"}
_PAYLOAD_INTEGER_FIELDS = {"confidence_basis_points"}
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SESSION_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_ARTIFACT_RE = re.compile(
    r"^(?!.*\/(?:\.|\.\.)(?:\/|$))artifact://[a-z0-9][a-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$"
)
_MEDIA_TYPE_RE = re.compile(
    r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;[A-Za-z0-9][A-Za-z0-9._-]{0,31}=[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$"
)
_SCHEMA_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$")


class CollaborationError(ValueError):
    """Base error for invalid collaboration data or state."""


class PolicyError(CollaborationError):
    """Raised when a policy is invalid or rejects an event."""


class EventValidationError(CollaborationError):
    """Raised when an event envelope or untrusted payload is invalid."""


class EventLogError(CollaborationError):
    """Raised when the local append-only log is missing or tampered with."""


class _ParentCapability:
    __slots__ = ()


class _ParticipantCapability:
    __slots__ = ("sender_id",)

    def __init__(self, sender_id: str) -> None:
        self.sender_id = sender_id


class _LogAppendCapability:
    __slots__ = ()


def _canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise EventValidationError(f"value is not canonical JSON: {exc}") from exc


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or len(value) > 64:
        raise EventValidationError(f"{field} must be an ISO-8601 datetime")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EventValidationError(f"{field} must be an ISO-8601 datetime") from exc
    if parsed.tzinfo is None:
        raise EventValidationError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("clock datetime must include a timezone")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _check_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise EventValidationError(f"{field} must be a bounded identifier")
    return value


def _check_previous_hash(value: str) -> None:
    if value and not _SHA256_RE.fullmatch(value):
        raise EventValidationError("previous hash must be a lowercase SHA-256 digest")


def _key_is_forbidden(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    forbidden = {
        "admin",
        "authorization",
        "authorize",
        "blob",
        "capabilities",
        "command",
        "commands",
        "content_bytes",
        "credential",
        "credentials",
        "developer",
        "developer_message",
        "exec",
        "execute",
        "ignore_instructions",
        "instructions",
        "permissions",
        "policy",
        "policy_override",
        "path",
        "paths",
        "privileged",
        "recursive_spawn",
        "role",
        "shell",
        "shared_path",
        "shared_paths",
        "spawn",
        "system",
        "system_prompt",
        "tool",
        "tools",
        "token",
        "tokens",
        "token_budget",
        "cost",
        "cost_budget",
        "artifact_content",
        "artifact_data",
        "file_content",
        "goal_quota",
        "quota",
        "budget_limited",
        "write_path",
        "write_paths",
    }
    return normalized in forbidden or normalized.endswith("_quota")


def _validate_json_value(value: Any, *, depth: int = 0, path: str = "payload") -> None:
    if depth > MAX_PAYLOAD_DEPTH:
        raise EventValidationError(f"{path} exceeds maximum payload depth")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise EventValidationError(f"{path} contains a non-finite number")
        return
    if isinstance(value, str):
        if len(value) > MAX_STRING_CHARS:
            raise EventValidationError(f"{path} contains an oversized string")
        return
    if isinstance(value, list):
        if len(value) > MAX_LIST_ITEMS:
            raise EventValidationError(f"{path} contains too many list items")
        for index, item in enumerate(value):
            _validate_json_value(item, depth=depth + 1, path=f"{path}[{index}]")
        return
    if isinstance(value, dict):
        if len(value) > MAX_OBJECT_PROPERTIES:
            raise EventValidationError(f"{path} contains too many properties")
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key) > 128:
                raise EventValidationError(f"{path} has an invalid property name")
            if _key_is_forbidden(key):
                raise EventValidationError(
                    f"{path}.{key} is a privileged or quota field"
                )
            _validate_json_value(item, depth=depth + 1, path=f"{path}.{key}")
        return
    raise EventValidationError(f"{path} contains a non-JSON value")


def _validate_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise EventValidationError("payload must be an object")
    if len(payload) > MAX_OBJECT_PROPERTIES:
        raise EventValidationError("payload contains too many properties")
    unknown = (
        set(payload)
        - _PAYLOAD_STRING_FIELDS
        - _PAYLOAD_LIST_FIELDS
        - _PAYLOAD_INTEGER_FIELDS
    )
    if unknown:
        label = (
            "privileged or unknown"
            if any(_key_is_forbidden(str(key)) for key in unknown)
            else "unknown"
        )
        raise EventValidationError(f"payload has {label} fields: {sorted(unknown)}")
    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        if not isinstance(key, str) or len(key) > 128:
            raise EventValidationError("payload has an invalid property name")
        if key in _PAYLOAD_STRING_FIELDS:
            if not isinstance(value, str) or not value or len(value) > MAX_STRING_CHARS:
                raise EventValidationError(
                    f"payload.{key} must be a bounded non-empty string"
                )
        elif key in _PAYLOAD_LIST_FIELDS:
            if not isinstance(value, list) or len(value) > MAX_LIST_ITEMS:
                raise EventValidationError(
                    f"payload.{key} must be a bounded string list"
                )
            if not all(
                isinstance(item, str) and 0 < len(item) <= MAX_STRING_CHARS
                for item in value
            ):
                raise EventValidationError(
                    f"payload.{key} must contain bounded strings"
                )
        elif key in _PAYLOAD_INTEGER_FIELDS:
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or not 0 <= value <= 10000
            ):
                raise EventValidationError(
                    f"payload.{key} must be an integer between 0 and 10000"
                )
        _validate_json_value(value, path=f"payload.{key}")
        normalized[key] = copy.deepcopy(value)
    return normalized


def _validate_artifact_ref(ref: Any, *, path: str = "artifact_refs") -> dict[str, Any]:
    if not isinstance(ref, dict):
        raise EventValidationError(f"{path} items must be objects")
    allowed = {"uri", "sha256", "media_type", "schema"}
    unknown = set(ref) - allowed
    if unknown:
        raise EventValidationError(f"{path} has unknown fields: {sorted(unknown)}")
    if set(ref) < {"uri", "sha256", "media_type"}:
        raise EventValidationError(f"{path} requires uri, sha256, and media_type")
    uri = ref["uri"]
    if (
        not isinstance(uri, str)
        or not _ARTIFACT_RE.fullmatch(uri)
        or "\\" in uri
        or "?" in uri
        or "#" in uri
        or "//" in uri[len("artifact://") :]
    ):
        raise EventValidationError(f"{path}.uri must be a safe artifact:// URI")
    digest = ref["sha256"]
    if not isinstance(digest, str) or not _SHA256_RE.fullmatch(digest):
        raise EventValidationError(f"{path}.sha256 must be a lowercase SHA-256 digest")
    media_type = ref["media_type"]
    if (
        not isinstance(media_type, str)
        or len(media_type) > 160
        or not _MEDIA_TYPE_RE.fullmatch(media_type)
    ):
        raise EventValidationError(f"{path}.media_type must be a bounded media type")
    if "schema" in ref:
        schema = ref["schema"]
        if (
            not isinstance(schema, str)
            or not _SCHEMA_RE.fullmatch(schema)
            or ".." in schema
        ):
            raise EventValidationError(
                f"{path}.schema must be a safe schema identifier"
            )
    return copy.deepcopy(ref)


def validate_artifact_refs(
    refs: Any, *, context: str = "artifact_refs"
) -> tuple[dict[str, Any], ...]:
    """Validate immutable artifact metadata for trusted host planning."""

    if not isinstance(refs, list) or len(refs) > 8:
        raise EventValidationError(f"{context} must contain at most 8 references")
    normalized = [
        _validate_artifact_ref(ref, path=f"{context}[{index}]")
        for index, ref in enumerate(refs)
    ]
    if len({_canonical_bytes(ref) for ref in normalized}) != len(normalized):
        raise EventValidationError(f"{context} must contain unique references")
    return tuple(normalized)


def _event_without_hash(data: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: copy.deepcopy(value)
        for key, value in data.items()
        if key != "content_hash"
    }


def _chain_hash(data: Mapping[str, Any], previous_hash: str) -> str:
    _check_previous_hash(previous_hash)
    material = (
        previous_hash.encode("ascii")
        + b"\n"
        + _canonical_bytes(_event_without_hash(data))
    )
    return hashlib.sha256(material).hexdigest()


def _validate_event_dict(
    data: Any,
    *,
    require_hash: bool = True,
    max_event_bytes: int = MAX_EVENT_BYTES,
) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise EventValidationError("event must be an object")
    required = {
        "schema_version",
        "event_id",
        "session_id",
        "task_id",
        "sequence",
        "round",
        "created_at",
        "deadline_at",
        "sender_id",
        "recipient_id",
        "kind",
        "parent_event_ids",
        "payload",
        "artifact_refs",
        "content_hash",
    }
    if set(data) != required:
        missing = sorted(required - set(data))
        unknown = sorted(set(data) - required)
        raise EventValidationError(
            f"event fields mismatch; missing={missing}, unknown={unknown}"
        )
    if data["schema_version"] != 1 or isinstance(data["schema_version"], bool):
        raise EventValidationError("unsupported event schema_version")
    for field in ("event_id", "session_id", "task_id", "sender_id", "recipient_id"):
        _check_id(data[field], field)
    sequence = data["sequence"]
    if (
        isinstance(sequence, bool)
        or not isinstance(sequence, int)
        or not 1 <= sequence <= MAX_EVENTS
    ):
        raise EventValidationError("sequence must be between 1 and 12")
    round_number = data["round"]
    if (
        isinstance(round_number, bool)
        or not isinstance(round_number, int)
        or not 0 <= round_number <= MAX_ROUNDS
    ):
        raise EventValidationError("round must be 0 or 1")
    created = _parse_time(data["created_at"], "created_at")
    deadline = _parse_time(data["deadline_at"], "deadline_at")
    if created > deadline:
        raise EventValidationError("created_at cannot be after deadline_at")
    if data["kind"] not in EVENT_KINDS:
        raise EventValidationError("unsupported event kind")
    parents = data["parent_event_ids"]
    if (
        not isinstance(parents, list)
        or len(parents) > MAX_EVENTS
        or not all(isinstance(parent, str) for parent in parents)
        or len(set(parents)) != len(parents)
    ):
        raise EventValidationError("parent_event_ids must be a bounded unique list")
    if sequence == 1 and (data["kind"] != "session.opened" or parents):
        raise EventValidationError("sequence 1 must be parentless session.opened")
    if sequence > 1 and not parents:
        raise EventValidationError(
            "events after session.opened require a causal parent"
        )
    for parent in parents:
        _check_id(parent, "parent_event_ids item")
    payload = _validate_payload(data["payload"])
    refs = data["artifact_refs"]
    if not isinstance(refs, list) or len(refs) > 8:
        raise EventValidationError("artifact_refs must contain at most 8 items")
    normalized_refs = [
        _validate_artifact_ref(ref, path=f"artifact_refs[{i}]")
        for i, ref in enumerate(refs)
    ]
    if len({_canonical_bytes(ref) for ref in normalized_refs}) != len(normalized_refs):
        raise EventValidationError("artifact_refs must be unique")
    if require_hash and (
        not isinstance(data["content_hash"], str)
        or not _SHA256_RE.fullmatch(data["content_hash"])
    ):
        raise EventValidationError("content_hash must be a lowercase SHA-256 digest")
    normalized = copy.deepcopy(data)
    normalized["created_at"] = _iso(created)
    normalized["deadline_at"] = _iso(deadline)
    normalized["payload"] = payload
    normalized["artifact_refs"] = normalized_refs
    encoded_size = len(_canonical_bytes(normalized))
    if encoded_size > max_event_bytes:
        raise EventValidationError(f"event exceeds max_event_bytes ({max_event_bytes})")
    return normalized


@dataclass(frozen=True, slots=True)
class PeerEvent:
    """Strict, versioned collaboration event envelope."""

    schema_version: int
    event_id: str
    session_id: str
    task_id: str
    sequence: int
    round: int
    created_at: str
    deadline_at: str
    sender_id: str
    recipient_id: str
    kind: str
    parent_event_ids: tuple[str, ...]
    payload: Mapping[str, Any]
    artifact_refs: tuple[Mapping[str, Any], ...]
    content_hash: str

    @classmethod
    def from_dict(
        cls,
        data: Mapping[str, Any],
        *,
        max_event_bytes: int = MAX_EVENT_BYTES,
    ) -> "PeerEvent":
        normalized = _validate_event_dict(dict(data), max_event_bytes=max_event_bytes)
        return cls(
            schema_version=normalized["schema_version"],
            event_id=normalized["event_id"],
            session_id=normalized["session_id"],
            task_id=normalized["task_id"],
            sequence=normalized["sequence"],
            round=normalized["round"],
            created_at=normalized["created_at"],
            deadline_at=normalized["deadline_at"],
            sender_id=normalized["sender_id"],
            recipient_id=normalized["recipient_id"],
            kind=normalized["kind"],
            parent_event_ids=tuple(normalized["parent_event_ids"]),
            payload=copy.deepcopy(normalized["payload"]),
            artifact_refs=tuple(copy.deepcopy(normalized["artifact_refs"])),
            content_hash=normalized["content_hash"],
        )

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        session_id: str,
        task_id: str,
        sequence: int,
        round: int,
        created_at: datetime | str,
        deadline_at: datetime | str,
        sender_id: str,
        recipient_id: str,
        kind: str,
        parent_event_ids: Iterable[str] = (),
        payload: Mapping[str, Any] | None = None,
        artifact_refs: Iterable[Mapping[str, Any]] = (),
        previous_hash: str = "",
    ) -> "PeerEvent":
        if isinstance(created_at, datetime):
            created_at = _iso(created_at)
        if isinstance(deadline_at, datetime):
            deadline_at = _iso(deadline_at)
        data: dict[str, Any] = {
            "schema_version": 1,
            "event_id": event_id,
            "session_id": session_id,
            "task_id": task_id,
            "sequence": sequence,
            "round": round,
            "created_at": created_at,
            "deadline_at": deadline_at,
            "sender_id": sender_id,
            "recipient_id": recipient_id,
            "kind": kind,
            "parent_event_ids": list(parent_event_ids),
            "payload": dict(payload or {}),
            "artifact_refs": [dict(ref) for ref in artifact_refs],
            "content_hash": "0" * 64,
        }
        normalized = _validate_event_dict(data, require_hash=False)
        normalized["content_hash"] = _chain_hash(normalized, previous_hash)
        return cls.from_dict(normalized)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "event_id": self.event_id,
            "session_id": self.session_id,
            "task_id": self.task_id,
            "sequence": self.sequence,
            "round": self.round,
            "created_at": self.created_at,
            "deadline_at": self.deadline_at,
            "sender_id": self.sender_id,
            "recipient_id": self.recipient_id,
            "kind": self.kind,
            "parent_event_ids": list(self.parent_event_ids),
            "payload": copy.deepcopy(dict(self.payload)),
            "artifact_refs": copy.deepcopy(list(self.artifact_refs)),
            "content_hash": self.content_hash,
        }

    def verify_hash(self, previous_hash: str = "") -> None:
        expected = _chain_hash(self.to_dict(), previous_hash)
        if self.content_hash != expected:
            raise EventLogError(f"content hash mismatch for event {self.event_id}")


def validate_event(
    data: Mapping[str, Any] | PeerEvent,
    *,
    max_event_bytes: int = MAX_EVENT_BYTES,
) -> PeerEvent:
    """Validate an event envelope and its bounded untrusted data."""

    if isinstance(data, PeerEvent):
        normalized = _validate_event_dict(
            data.to_dict(), max_event_bytes=max_event_bytes
        )
        return PeerEvent.from_dict(normalized, max_event_bytes=max_event_bytes)
    return PeerEvent.from_dict(data, max_event_bytes=max_event_bytes)


@dataclass(frozen=True, slots=True)
class Participant:
    id: str
    profile: str


@dataclass(frozen=True, slots=True)
class CollaborationPolicy:
    """Validated policy for one bounded collaboration profile."""

    schema_version: int
    policy_id: str
    participants: tuple[Participant, ...]
    max_peers: int
    max_rounds: int
    max_events: int
    max_payload_bytes: int
    max_event_bytes: int
    max_total_bytes: int
    deadline_seconds: int
    orchestrator_id: str
    system_id: str
    recursive_spawning: bool
    peer_write_paths: tuple[str, ...]
    allowed_recipients: Mapping[str, tuple[str, ...]]
    allowed_kinds: Mapping[str, tuple[str, ...]]

    @property
    def participant_ids(self) -> frozenset[str]:
        return frozenset(participant.id for participant in self.participants)

    @property
    def actor_ids(self) -> frozenset[str]:
        return self.participant_ids | {self.orchestrator_id, self.system_id}

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "policy_id": self.policy_id,
            "participants": [
                {"id": item.id, "profile": item.profile} for item in self.participants
            ],
            "max_peers": self.max_peers,
            "max_rounds": self.max_rounds,
            "max_events": self.max_events,
            "max_payload_bytes": self.max_payload_bytes,
            "max_event_bytes": self.max_event_bytes,
            "max_total_bytes": self.max_total_bytes,
            "deadline_seconds": self.deadline_seconds,
            "orchestrator_id": self.orchestrator_id,
            "system_id": self.system_id,
            "recursive_spawning": self.recursive_spawning,
            "peer_write_paths": list(self.peer_write_paths),
            "allowed_recipients": {
                key: list(value) for key, value in self.allowed_recipients.items()
            },
            "allowed_kinds": {
                key: list(value) for key, value in self.allowed_kinds.items()
            },
        }


def validate_policy(
    data: Mapping[str, Any] | CollaborationPolicy,
) -> CollaborationPolicy:
    """Validate strict policy shape and the fixed initial peer profiles."""

    if isinstance(data, CollaborationPolicy):
        data = data.to_dict()
    if not isinstance(data, dict):
        raise PolicyError("policy must be an object")
    required = {
        "schema_version",
        "policy_id",
        "participants",
        "max_peers",
        "max_rounds",
        "max_events",
        "max_payload_bytes",
        "max_event_bytes",
        "max_total_bytes",
        "deadline_seconds",
        "orchestrator_id",
        "system_id",
        "recursive_spawning",
        "peer_write_paths",
        "allowed_recipients",
        "allowed_kinds",
    }
    if set(data) != required:
        raise PolicyError(
            f"policy fields mismatch; missing={sorted(required - set(data))}, unknown={sorted(set(data) - required)}"
        )
    if data["schema_version"] != 1 or isinstance(data["schema_version"], bool):
        raise PolicyError("unsupported policy schema_version")
    policy_id = data["policy_id"]
    if not isinstance(policy_id, str) or not _SESSION_RE.fullmatch(policy_id):
        raise PolicyError("policy_id must be a safe identifier")
    participants_data = data["participants"]
    if not isinstance(participants_data, list) or len(participants_data) != 2:
        raise PolicyError(
            "initial participants must be exactly concept-artist and art-director"
        )
    participants: list[Participant] = []
    for item in participants_data:
        if not isinstance(item, dict) or set(item) != {"id", "profile"}:
            raise PolicyError("participants must contain only id and profile")
        participant_id = item["id"]
        profile = item["profile"]
        if (
            participant_id not in PEER_PROFILES
            or profile not in PEER_PROFILES
            or participant_id != profile
        ):
            raise PolicyError(
                "initial profiles must be concept-artist and art-director"
            )
        participants.append(Participant(participant_id, profile))
    if {item.profile for item in participants} != set(PEER_PROFILES):
        raise PolicyError(
            "initial profiles must be exactly concept-artist and art-director"
        )
    if len({item.id for item in participants}) != len(participants):
        raise PolicyError("participant ids must be unique")

    def bounded_int(name: str, minimum: int, maximum: int) -> int:
        value = data[name]
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not minimum <= value <= maximum
        ):
            raise PolicyError(f"{name} must be between {minimum} and {maximum}")
        return value

    max_peers = bounded_int("max_peers", 2, MAX_PEERS)
    max_rounds = bounded_int("max_rounds", 1, MAX_ROUNDS)
    max_events = bounded_int("max_events", 1, MAX_EVENTS)
    max_payload_bytes = bounded_int("max_payload_bytes", 1, MAX_EVENT_BYTES)
    max_event_bytes = bounded_int("max_event_bytes", 1, MAX_EVENT_BYTES)
    max_total_bytes = bounded_int("max_total_bytes", max_event_bytes, MAX_TOTAL_BYTES)
    deadline_seconds = bounded_int("deadline_seconds", 1, 86400)
    if max_peers < len(participants):
        raise PolicyError("max_peers cannot be smaller than the initial peer set")
    if max_payload_bytes > max_event_bytes:
        raise PolicyError("max_payload_bytes cannot exceed max_event_bytes")
    if policy_id == "concept-art-direction-v1" and (
        max_payload_bytes,
        max_event_bytes,
        max_total_bytes,
    ) != (MAX_EVENT_BYTES, MAX_EVENT_BYTES, MAX_TOTAL_BYTES):
        raise PolicyError("concept-art-direction-v1 byte limits are fixed")
    if data["orchestrator_id"] != "orchestrator" or data["system_id"] != "system":
        raise PolicyError("orchestrator_id and system_id are fixed")
    if data["recursive_spawning"] is not False:
        raise PolicyError("recursive_spawning must be false")
    if data["peer_write_paths"] != []:
        raise PolicyError(
            "peer_write_paths must be empty; peers are advisory and read-only"
        )

    actors = set(PEER_PROFILES) | {"orchestrator", "system"}
    recipients = data["allowed_recipients"]
    kinds = data["allowed_kinds"]
    if not isinstance(recipients, dict) or set(recipients) != actors:
        raise PolicyError("allowed_recipients must explicitly list every actor")
    if not isinstance(kinds, dict) or set(kinds) != actors:
        raise PolicyError("allowed_kinds must explicitly list every actor")
    normalized_recipients: dict[str, tuple[str, ...]] = {}
    normalized_kinds: dict[str, tuple[str, ...]] = {}
    for actor in sorted(actors):
        recipient_list = recipients[actor]
        if not isinstance(recipient_list, list) or len(set(recipient_list)) != len(
            recipient_list
        ):
            raise PolicyError(f"allowed_recipients.{actor} must be a unique list")
        if not all(isinstance(item, str) and item in actors for item in recipient_list):
            raise PolicyError(f"allowed_recipients.{actor} contains an unknown actor")
        normalized_recipients[actor] = tuple(recipient_list)
        kind_list = kinds[actor]
        if not isinstance(kind_list, list) or len(set(kind_list)) != len(kind_list):
            raise PolicyError(f"allowed_kinds.{actor} must be a unique list")
        if not all(isinstance(item, str) and item in EVENT_KINDS for item in kind_list):
            raise PolicyError(f"allowed_kinds.{actor} contains an unknown event kind")
        normalized_kinds[actor] = tuple(kind_list)
    return CollaborationPolicy(
        schema_version=1,
        policy_id=policy_id,
        participants=tuple(participants),
        max_peers=max_peers,
        max_rounds=max_rounds,
        max_events=max_events,
        max_payload_bytes=max_payload_bytes,
        max_event_bytes=max_event_bytes,
        max_total_bytes=max_total_bytes,
        deadline_seconds=deadline_seconds,
        orchestrator_id="orchestrator",
        system_id="system",
        recursive_spawning=False,
        peer_write_paths=(),
        allowed_recipients=normalized_recipients,
        allowed_kinds=normalized_kinds,
    )


def load_policy(path: str | Path) -> CollaborationPolicy:
    """Load and validate a policy JSON document without executing its contents."""

    policy_path = Path(path)
    try:
        data = json.loads(policy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PolicyError(f"could not load policy: {exc}") from exc
    return validate_policy(data)


def _validate_policy_event(policy: CollaborationPolicy, event: PeerEvent) -> None:
    if event.sender_id not in policy.actor_ids:
        raise PolicyError("sender is not a policy participant")
    if event.recipient_id not in policy.actor_ids:
        raise PolicyError("recipient is not a policy participant")
    if event.kind in PRIVILEGED_KINDS and event.sender_id != policy.orchestrator_id:
        raise PolicyError(
            "only the orchestrator may publish lifecycle, decision, or rejection events"
        )
    if event.sender_id == policy.system_id:
        raise PolicyError("system is a recipient, not an event publisher")
    if event.recipient_id not in policy.allowed_recipients[event.sender_id]:
        raise PolicyError("recipient is not allowed for sender")
    if event.kind not in policy.allowed_kinds[event.sender_id]:
        raise PolicyError("event kind is not allowed for sender")
    if event.sender_id in policy.participant_ids and event.kind in PRIVILEGED_KINDS:
        raise PolicyError("peer may not publish a control-plane event")


def _assert_no_symlink_components(path: Path) -> None:
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        try:
            mode = os.lstat(current).st_mode
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise EventLogError(f"cannot inspect collaboration path: {exc}") from exc
        if stat.S_ISLNK(mode):
            raise EventLogError(f"collaboration path contains a symlink: {current}")


def _canonicalize_collaboration_root(path: Path) -> Path:
    """Canonicalize ancestors above the caller root; reject the root itself if symlinked."""

    absolute = Path(os.path.abspath(path))
    try:
        mode = os.lstat(absolute).st_mode
    except FileNotFoundError:
        mode = None
    except OSError as exc:
        raise EventLogError(f"cannot inspect collaboration root: {exc}") from exc
    if mode is not None and stat.S_ISLNK(mode):
        raise EventLogError(f"collaboration root is a symlink: {absolute}")
    return Path(os.path.realpath(absolute))


def _assert_regular_or_missing(path: Path, *, directory: bool = False) -> None:
    try:
        mode = os.lstat(path).st_mode
    except FileNotFoundError:
        return
    except OSError as exc:
        raise EventLogError(f"cannot inspect collaboration path: {exc}") from exc
    if stat.S_ISLNK(mode):
        raise EventLogError(f"collaboration path is a symlink: {path}")
    if directory and not stat.S_ISDIR(mode):
        raise EventLogError(f"collaboration path must be a directory: {path}")
    if not directory and not stat.S_ISREG(mode):
        raise EventLogError(f"event log must be a regular file: {path}")


def _open_nofollow(path: Path, flags: int, mode: int = 0o600) -> int:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags | nofollow, mode)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            os.close(fd)
            raise EventLogError(f"event log must be a regular file: {path}")
        return fd
    except OSError as exc:
        raise EventLogError(f"could not open event log safely: {exc}") from exc


class JsonlEventLog:
    """Fsync'd JSONL log with bounded streaming reads and parent-only append."""

    def __init__(
        self,
        root: str | Path = ".forgewright",
        session_id: str | None = None,
        *,
        max_event_bytes: int = MAX_EVENT_BYTES,
        max_total_bytes: int = MAX_TOTAL_BYTES,
        max_events: int = MAX_EVENTS,
    ) -> None:
        if session_id is None:
            candidate = Path(root)
            if candidate.name != "events.jsonl":
                raise EventLogError("session_id is required when root is a directory")
            self.session_id = candidate.parent.name
            _assert_regular_or_missing(candidate)
            self.root = _canonicalize_collaboration_root(candidate.parent.parent.parent)
            self.path = self.root / "collaboration" / self.session_id / "events.jsonl"
        else:
            if not isinstance(session_id, str) or not _SESSION_RE.fullmatch(session_id):
                raise EventLogError("session_id must be a safe local directory name")
            self.session_id = session_id
            self.root = _canonicalize_collaboration_root(Path(root))
            self.path = self.root / "collaboration" / session_id / "events.jsonl"
        if not 1 <= max_event_bytes <= MAX_EVENT_BYTES:
            raise EventLogError("max_event_bytes is outside the hard 16 KiB bound")
        if not max_event_bytes <= max_total_bytes <= MAX_TOTAL_BYTES:
            raise EventLogError("max_total_bytes is outside the bounded policy range")
        if not 1 <= max_events <= MAX_EVENTS:
            raise EventLogError("max_events is outside the bounded policy range")
        self.max_event_bytes = max_event_bytes
        self.max_total_bytes = max_total_bytes
        self.max_events = max_events
        self._lock = threading.RLock()
        self._append_capability = _LogAppendCapability()
        self._prepare_layout()

    def _prepare_layout(self) -> None:
        with self._lock:
            _assert_no_symlink_components(self.root)
            _assert_regular_or_missing(self.root, directory=True)
            self.root.mkdir(parents=True, exist_ok=True)
            _assert_regular_or_missing(self.root, directory=True)
            collaboration_root = self.root / "collaboration"
            _assert_no_symlink_components(collaboration_root)
            _assert_regular_or_missing(collaboration_root, directory=True)
            collaboration_root.mkdir(exist_ok=True)
            _assert_regular_or_missing(collaboration_root, directory=True)
            session_root = collaboration_root / self.session_id
            _assert_no_symlink_components(session_root)
            _assert_regular_or_missing(session_root, directory=True)
            session_root.mkdir(exist_ok=True)
            _assert_regular_or_missing(session_root, directory=True)
            trusted_root = self.root.resolve(strict=True)
            resolved_parent = self.path.parent.resolve(strict=True)
            if not resolved_parent.is_relative_to(trusted_root):
                raise EventLogError(
                    "event log parent escapes trusted collaboration root"
                )
            _assert_no_symlink_components(self.path)
            _assert_regular_or_missing(self.path)

    def _iter_raw_lines(self) -> Iterator[bytes]:
        self._prepare_layout()
        if not self.path.exists():
            return
        fd = _open_nofollow(self.path, os.O_RDONLY)
        buffer = bytearray()
        try:
            while True:
                chunk = os.read(fd, 8192)
                if not chunk:
                    break
                buffer.extend(chunk)
                while b"\n" in buffer:
                    line, _, remainder = buffer.partition(b"\n")
                    buffer = bytearray(remainder)
                    if line.endswith(b"\r"):
                        line = line[:-1]
                    if len(line) > self.max_event_bytes:
                        raise EventLogError(
                            "event log line exceeds max_event_bytes before JSON parse"
                        )
                    if not line:
                        raise EventLogError("blank line in event log")
                    yield bytes(line)
                if len(buffer) > self.max_event_bytes:
                    raise EventLogError(
                        "event log line exceeds max_event_bytes before JSON parse"
                    )
            if buffer:
                if len(buffer) > self.max_event_bytes:
                    raise EventLogError(
                        "event log line exceeds max_event_bytes before JSON parse"
                    )
                yield bytes(buffer)
        except OSError as exc:
            raise EventLogError(f"could not stream event log: {exc}") from exc
        finally:
            os.close(fd)

    def _read_state(self) -> tuple[list[PeerEvent], int]:
        with self._lock:
            events: list[PeerEvent] = []
            seen: set[str] = set()
            previous_hash = ""
            total_bytes = 0
            for line_number, line in enumerate(self._iter_raw_lines(), 1):
                total_bytes += len(line) + 1
                if total_bytes > self.max_total_bytes:
                    raise EventLogError("event log exceeds max_total_bytes")
                if line_number > self.max_events:
                    raise EventLogError("event log exceeds max_events")
                try:
                    raw = json.loads(line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise EventLogError(f"invalid JSON at line {line_number}") from exc
                event = PeerEvent.from_dict(raw, max_event_bytes=self.max_event_bytes)
                if event.event_id in seen or event.sequence != line_number:
                    raise EventLogError(
                        f"non-deterministic sequence or duplicate id at line {line_number}"
                    )
                if event.session_id != self.session_id:
                    raise EventLogError(f"event session mismatch at line {line_number}")
                event.verify_hash(previous_hash)
                events.append(event)
                seen.add(event.event_id)
                previous_hash = event.content_hash
            return events, total_bytes

    def read_events(self) -> list[PeerEvent]:
        """Read a bounded log; each line is size-checked before JSON parsing."""

        return self._read_state()[0]

    def _parent_append_capability(self) -> _LogAppendCapability:
        return self._append_capability

    def append(self, event: PeerEvent | Mapping[str, Any], **_: Any) -> PeerEvent:
        raise EventLogError(
            "direct log append is unavailable; use the parent controller"
        )

    def _append(
        self, event: PeerEvent | Mapping[str, Any], capability: _LogAppendCapability
    ) -> PeerEvent:
        if capability is not self._append_capability:
            raise EventLogError("only the parent-owned append capability may append")
        with self._lock:
            normalized = validate_event(event, max_event_bytes=self.max_event_bytes)
            existing, total_bytes = self._read_state()
            if normalized.sequence != len(existing) + 1:
                raise EventLogError("event sequence is not append-only")
            previous_hash = existing[-1].content_hash if existing else ""
            normalized.verify_hash(previous_hash)
            encoded = _canonical_bytes(normalized.to_dict())
            if len(encoded) > self.max_event_bytes:
                raise EventLogError("event exceeds max_event_bytes")
            if total_bytes + len(encoded) + 1 > self.max_total_bytes:
                raise EventLogError("event log exceeds max_total_bytes")
            self._prepare_layout()
            fd = _open_nofollow(self.path, os.O_APPEND | os.O_CREAT | os.O_WRONLY)
            try:
                line = encoded + b"\n"
                written = 0
                while written < len(line):
                    written += os.write(fd, line[written:])
                os.fsync(fd)
            except OSError as exc:
                raise EventLogError(f"could not append event log: {exc}") from exc
            finally:
                os.close(fd)
            return normalized


class ParentController:
    """Opaque orchestrator-only controller; not JSON serializable by design."""

    __slots__ = ("_broker", "_capability")

    def __init__(
        self, broker: "InProcessBroker", capability: _ParentCapability
    ) -> None:
        self._broker = broker
        self._capability = capability

    def publish(self, event: PeerEvent | Mapping[str, Any]) -> PeerEvent:
        return self._broker._publish_from_parent(self._capability, event)

    def publish_or_fallback(
        self, event: PeerEvent | Mapping[str, Any]
    ) -> PeerEvent | dict[str, Any]:
        try:
            return self.publish(event)
        except CollaborationError as exc:
            event_id = (
                event.event_id
                if isinstance(event, PeerEvent)
                else event.get("event_id")
                if isinstance(event, dict)
                else None
            )
            return self._broker.serial_fallback(
                str(exc), event_id=event_id if isinstance(event_id, str) else None
            )


class ParticipantChannel:
    """Opaque participant-only ingress channel for a future host adapter."""

    __slots__ = ("_broker", "_capability")

    def __init__(
        self, broker: "InProcessBroker", capability: _ParticipantCapability
    ) -> None:
        self._broker = broker
        self._capability = capability

    def publish(self, event: PeerEvent | Mapping[str, Any]) -> PeerEvent:
        return self._broker._publish_from_participant(self._capability, event)


class InProcessBroker:
    """Serial, thread-safe mailbox broker and final-arbiter boundary."""

    def __init__(
        self,
        policy: CollaborationPolicy | Mapping[str, Any],
        session_id: str,
        task_id: str,
        *,
        event_log: JsonlEventLog | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.policy = validate_policy(policy)
        if not _SESSION_RE.fullmatch(session_id):
            raise PolicyError(
                "session_id must be safe for a local collaboration directory"
            )
        _check_id(task_id, "task_id")
        self.session_id = session_id
        self.task_id = task_id
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.log = event_log or JsonlEventLog(
            session_id=session_id,
            max_event_bytes=self.policy.max_event_bytes,
            max_total_bytes=self.policy.max_total_bytes,
            max_events=self.policy.max_events,
        )
        self.log.max_event_bytes = self.policy.max_event_bytes
        self.log.max_total_bytes = self.policy.max_total_bytes
        self.log.max_events = self.policy.max_events
        self._lock = threading.RLock()
        self._parent_capability = _ParentCapability()
        self._parent_controller = ParentController(self, self._parent_capability)
        self._participant_capabilities = {
            participant.id: _ParticipantCapability(participant.id)
            for participant in self.policy.participants
        }
        self._participant_channels = {
            participant_id: ParticipantChannel(self, capability)
            for participant_id, capability in self._participant_capabilities.items()
        }
        self._events, self._total_bytes = self.log._read_state()
        if self._events:
            fold_session_events(
                self._events,
                policy=self.policy,
                max_event_bytes=self.policy.max_event_bytes,
                max_total_bytes=self.policy.max_total_bytes,
            )
        self._index = {event.event_id: event for event in self._events}
        self._session_deadline = self._events[0].deadline_at if self._events else None
        self._mailboxes: dict[str, list[PeerEvent]] = {
            actor: [] for actor in self.policy.actor_ids
        }
        for event in self._events:
            self._mailboxes[event.recipient_id].append(event)

    @property
    def events(self) -> tuple[PeerEvent, ...]:
        with self._lock:
            return tuple(self._events)

    @property
    def tip_hash(self) -> str:
        with self._lock:
            return self._events[-1].content_hash if self._events else ""

    def parent_controller(self) -> ParentController:
        return self._parent_controller

    def participant_channel(self, participant_id: str) -> ParticipantChannel:
        if participant_id not in self._participant_channels:
            raise PolicyError("unknown participant channel")
        return self._participant_channels[participant_id]

    def publish(self, *_: Any, **__: Any) -> PeerEvent:
        raise PolicyError(
            "broker.publish is removed; use parent_controller or participant_channel"
        )

    def _now(self) -> datetime:
        value = self.clock()
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise PolicyError("clock must return a timezone-aware datetime")
        return value.astimezone(timezone.utc)

    def _publish_from_parent(
        self, capability: _ParentCapability, event: PeerEvent | Mapping[str, Any]
    ) -> PeerEvent:
        if capability is not self._parent_capability:
            raise PolicyError("invalid parent capability")
        return self._publish(
            event, expected_sender=self.policy.orchestrator_id, parent=True
        )

    def _publish_from_participant(
        self, capability: _ParticipantCapability, event: PeerEvent | Mapping[str, Any]
    ) -> PeerEvent:
        expected_sender = next(
            (
                participant_id
                for participant_id, value in self._participant_capabilities.items()
                if value is capability
            ),
            None,
        )
        if expected_sender is None:
            raise PolicyError("invalid participant capability")
        return self._publish(event, expected_sender=expected_sender, parent=False)

    def _publish(
        self,
        event: PeerEvent | Mapping[str, Any],
        *,
        expected_sender: str,
        parent: bool,
    ) -> PeerEvent:
        with self._lock:
            normalized = validate_event(
                event, max_event_bytes=self.policy.max_event_bytes
            )
            if normalized.sender_id != expected_sender:
                raise PolicyError("capability cannot publish for another sender")
            if parent and normalized.sender_id != self.policy.orchestrator_id:
                raise PolicyError("parent controller can publish only as orchestrator")
            _validate_policy_event(self.policy, normalized)
            existing = self._index.get(normalized.event_id)
            if existing is not None:
                previous_hash = (
                    self._events[existing.sequence - 2].content_hash
                    if existing.sequence > 1
                    else ""
                )
                if normalized.content_hash != _chain_hash(
                    normalized.to_dict(), previous_hash
                ):
                    raise PolicyError("duplicate event_id has an invalid content hash")
                if existing.to_dict() != normalized.to_dict():
                    raise PolicyError("duplicate event_id has mutated content")
                return existing
            if (
                normalized.session_id != self.session_id
                or normalized.task_id != self.task_id
            ):
                raise PolicyError("event session or task does not match broker")
            if normalized.sequence != len(self._events) + 1:
                raise PolicyError(
                    "event sequence must be the next append-only sequence"
                )
            if normalized.sequence > self.policy.max_events:
                raise PolicyError("event exceeds the policy event limit")
            now = self._now()
            created = _parse_time(normalized.created_at, "created_at")
            deadline = _parse_time(normalized.deadline_at, "deadline_at")
            if now > deadline:
                raise PolicyError("event deadline has passed")
            if normalized.sequence == 1:
                if normalized.kind != "session.opened" or normalized.parent_event_ids:
                    raise PolicyError(
                        "session.opened must be the first event without parents"
                    )
                if normalized.round != 0:
                    raise PolicyError("session.opened must use round 0")
                if deadline > now + timedelta(seconds=self.policy.deadline_seconds):
                    raise PolicyError("session deadline exceeds the policy deadline")
                self._session_deadline = normalized.deadline_at
            else:
                if self._events[-1].kind == "session.closed":
                    raise PolicyError("session is already closed")
                if normalized.kind == "session.opened":
                    raise PolicyError("session.opened may only appear once")
                if self._session_deadline != normalized.deadline_at:
                    raise PolicyError(
                        "events may not extend or change the session deadline"
                    )
                previous_created = _parse_time(
                    self._events[-1].created_at, "created_at"
                )
                if created < previous_created:
                    raise PolicyError("created_at must be monotonic with sequence")
                if normalized.round < self._events[-1].round:
                    raise PolicyError("round may not regress")
                if not normalized.parent_event_ids:
                    raise PolicyError(
                        "events after session.opened require a causal parent"
                    )
            if created > deadline or (
                self._session_deadline
                and deadline > _parse_time(self._session_deadline, "deadline_at")
            ):
                raise PolicyError("event is outside the hard session deadline")
            known_ids = self._index.keys()
            for parent_id in normalized.parent_event_ids:
                if parent_id not in known_ids:
                    raise PolicyError(
                        "all parent_event_ids must reference earlier events"
                    )
                parent_event = self._index[parent_id]
                if parent_event.sequence >= normalized.sequence:
                    raise PolicyError(
                        "parent_event_ids cannot reference a future event"
                    )
            if (
                normalized.kind == "session.closed"
                and normalized.recipient_id != self.policy.system_id
            ):
                raise PolicyError("session.closed must be delivered to system")
            if (
                len(_canonical_bytes(normalized.payload))
                > self.policy.max_payload_bytes
            ):
                raise PolicyError("payload exceeds max_payload_bytes")
            encoded_size = len(_canonical_bytes(normalized.to_dict()))
            if encoded_size > self.policy.max_event_bytes:
                raise PolicyError("event exceeds max_event_bytes")
            if self._total_bytes + encoded_size + 1 > self.policy.max_total_bytes:
                raise PolicyError("session exceeds max_total_bytes")
            normalized.verify_hash(
                self._events[-1].content_hash if self._events else ""
            )
            appended = self.log._append(
                normalized, self.log._parent_append_capability()
            )
            self._events.append(appended)
            self._total_bytes += encoded_size + 1
            self._index[appended.event_id] = appended
            self._mailboxes[appended.recipient_id].append(appended)
            return appended

    def mailbox(
        self, recipient_id: str, *, drain: bool = False
    ) -> tuple[PeerEvent, ...]:
        with self._lock:
            if recipient_id not in self._mailboxes:
                raise PolicyError("unknown mailbox recipient")
            messages = tuple(self._mailboxes[recipient_id])
            if drain:
                self._mailboxes[recipient_id].clear()
            return messages

    def serial_fallback(
        self, reason: str, *, event_id: str | None = None
    ) -> dict[str, Any]:
        """Return a deterministic parent-arbiter fallback without peer execution."""

        bounded_reason = (
            str(reason).strip().replace("\n", " ")[:256]
            or "invalid collaboration request"
        )
        result: dict[str, Any] = {
            "mode": "serial",
            "accepted": False,
            "reason": bounded_reason,
            "final_arbiter": self.policy.orchestrator_id,
        }
        if event_id is not None and _ID_RE.fullmatch(event_id):
            result["rejected_event_id"] = event_id
        return result

    def publish_or_fallback(
        self, event: PeerEvent | Mapping[str, Any]
    ) -> dict[str, Any]:
        try:
            normalized = validate_event(
                event, max_event_bytes=self.policy.max_event_bytes
            )
            return self.serial_fallback(
                "capability required", event_id=normalized.event_id
            )
        except CollaborationError as exc:
            event_id = (
                event.event_id
                if isinstance(event, PeerEvent)
                else event.get("event_id")
                if isinstance(event, dict)
                else None
            )
            return self.serial_fallback(
                str(exc), event_id=event_id if isinstance(event_id, str) else None
            )


def fold_session_events(
    events: Iterable[PeerEvent | Mapping[str, Any]],
    *,
    policy: CollaborationPolicy | Mapping[str, Any] | None = None,
    max_event_bytes: int = MAX_EVENT_BYTES,
    max_total_bytes: int = MAX_TOTAL_BYTES,
) -> dict[str, Any]:
    """Replay a validated event iterable without buffering unbounded input."""

    validated_policy = validate_policy(policy) if policy is not None else None
    if validated_policy is not None:
        max_event_bytes = validated_policy.max_event_bytes
        max_total_bytes = validated_policy.max_total_bytes
        max_events = validated_policy.max_events
    else:
        max_events = MAX_EVENTS
    folded: list[PeerEvent] = []
    by_id: dict[str, PeerEvent] = {}
    previous_hash = ""
    total_bytes = 0
    session_id: str | None = None
    task_id: str | None = None
    deadline_at: str | None = None
    closed = False
    for event_data in events:
        if len(folded) >= max_events:
            raise EventLogError("fold exceeds max_events")
        event = validate_event(event_data, max_event_bytes=max_event_bytes)
        if (
            validated_policy is not None
            and len(_canonical_bytes(event.payload))
            > validated_policy.max_payload_bytes
        ):
            raise EventLogError("fold exceeds max_payload_bytes")
        encoded_size = len(_canonical_bytes(event.to_dict()))
        total_bytes += encoded_size + 1
        if total_bytes > max_total_bytes:
            raise EventLogError("fold exceeds max_total_bytes")
        if session_id is None:
            session_id, task_id, deadline_at = (
                event.session_id,
                event.task_id,
                event.deadline_at,
            )
            if (
                event.sequence != 1
                or event.kind != "session.opened"
                or event.parent_event_ids
            ):
                raise EventLogError("fold must begin with session.opened")
        elif (event.session_id, event.task_id) != (session_id, task_id):
            raise EventLogError("fold contains multiple sessions or tasks")
        if closed:
            raise EventLogError("fold contains an event after session.closed")
        if event.sequence != len(folded) + 1:
            raise EventLogError("fold sequence is not deterministic")
        if event.event_id in by_id:
            raise EventLogError("fold contains a duplicate event id")
        if event.parent_event_ids and not all(
            parent in by_id for parent in event.parent_event_ids
        ):
            raise EventLogError("fold contains an unknown or future causal parent")
        if event.sequence > 1 and not event.parent_event_ids:
            raise EventLogError("events after session.opened require a causal parent")
        if deadline_at != event.deadline_at:
            raise EventLogError("fold contains a changed session deadline")
        if folded and event.round < folded[-1].round:
            raise EventLogError("fold round regresses")
        event.verify_hash(previous_hash)
        if validated_policy is not None:
            _validate_policy_event(validated_policy, event)
        if event.kind == "session.closed":
            if event.recipient_id != "system":
                raise EventLogError("session.closed must be delivered to system")
            closed = True
        folded.append(event)
        by_id[event.event_id] = event
        previous_hash = event.content_hash
    return {
        "session_id": session_id,
        "task_id": task_id,
        "event_count": len(folded),
        "round": max((event.round for event in folded), default=0),
        "closed": closed,
        "events": [event.to_dict() for event in folded],
        "assignments": [
            event.to_dict() for event in folded if event.kind == "assignment.sent"
        ],
        "messages": [
            event.to_dict() for event in folded if event.kind == "peer.message"
        ],
        "artifacts": [
            event.to_dict() for event in folded if event.kind == "artifact.proposed"
        ],
        "findings": [
            event.to_dict() for event in folded if event.kind == "finding.reported"
        ],
        "blockers": [
            event.to_dict() for event in folded if event.kind == "blocker.reported"
        ],
        "decision_requests": [
            event.to_dict() for event in folded if event.kind == "decision.requested"
        ],
        "decisions": [
            event.to_dict() for event in folded if event.kind == "decision.issued"
        ],
        "rejections": [
            event.to_dict() for event in folded if event.kind == "policy.rejected"
        ],
    }


__all__ = [
    "CollaborationError",
    "CollaborationPolicy",
    "EventLogError",
    "EventValidationError",
    "InProcessBroker",
    "JsonlEventLog",
    "ParticipantChannel",
    "ParentController",
    "Participant",
    "PeerEvent",
    "PolicyError",
    "fold_session_events",
    "load_policy",
    "validate_event",
    "validate_artifact_refs",
    "validate_policy",
]
