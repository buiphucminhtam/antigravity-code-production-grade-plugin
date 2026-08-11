#!/usr/bin/env python3
"""Deterministic, provider-neutral policy for bounded parallel orchestration."""

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any

from .peer_collaboration import (
    PEER_PROFILES,
    CollaborationPolicy,
    EventValidationError as CollaborationEventValidationError,
    PolicyError as CollaborationPolicyError,
    load_policy,
    validate_artifact_refs,
)


HIGH_RISK = {"security", "schema", "public-api", "concurrency"}
STOP_CONDITIONS = [
    "duplicate_findings",
    "scope_covered",
    "same_blocker_twice",
    "deadline_cap",
]
PACKET_FIELDS = (
    "mode",
    "skill_name",
    "skill_path",
    "input_artifacts",
    "output_artifacts",
    "handoff_type",
    "acceptance_checks",
    "artifact_refs",
)
PACKET_LIST_FIELDS = {"input_artifacts", "output_artifacts", "acceptance_checks"}
MAX_PACKET_LIST_ITEMS = 32
MAX_PACKET_STRING_CHARS = 512
MAX_ARTIFACT_REFS = 8
COLLABORATION_ACTIVATION_FIELDS = {
    "mode",
    "profile",
    "participants",
    "purpose",
    "frozen_inputs",
    "fallback",
    "artifact_refs",
}
MAX_COLLABORATION_PURPOSE_CHARS = 512
COLLABORATION_PROFILE_REGISTRY = {
    "concept-art-direction/v1": Path(__file__).resolve().parents[2]
    / "config"
    / "peer-collaboration"
    / "concept-art-direction.v1.json",
}
COLLABORATION_SCHEMA_REFS = {
    "event": "schemas/peer-collaboration-event.v1.schema.json",
    "policy": "schemas/peer-collaboration-policy.v1.schema.json",
}
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_ARTIFACT_URI_RE = re.compile(
    r"^artifact://[a-z0-9][a-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$"
)
_MEDIA_TYPE_RE = re.compile(
    r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;[A-Za-z0-9][A-Za-z0-9._-]{0,31}=[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$"
)
_SCHEMA_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$")


class PolicyError(ValueError):
    """Raised when a policy request is structurally invalid."""


def _validate_artifact_refs(value: Any, *, context: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > MAX_ARTIFACT_REFS:
        raise PolicyError(f"{context} must contain at most {MAX_ARTIFACT_REFS} objects")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, ref in enumerate(value):
        if not isinstance(ref, dict):
            raise PolicyError(f"{context}[{index}] must be an object")
        allowed = {"uri", "sha256", "media_type", "schema"}
        if set(ref) - allowed or set(ref) < {"uri", "sha256", "media_type"}:
            raise PolicyError(
                f"{context}[{index}] requires only uri, sha256, media_type, and optional schema"
            )
        uri = ref["uri"]
        if (
            not isinstance(uri, str)
            or not _ARTIFACT_URI_RE.fullmatch(uri)
            or "\\" in uri
            or "//" in uri[len("artifact://") :]
            or any(part in {".", ".."} for part in uri[len("artifact://") :].split("/"))
        ):
            raise PolicyError(f"{context}[{index}].uri must be a safe artifact:// URI")
        digest = ref["sha256"]
        media_type = ref["media_type"]
        if not isinstance(digest, str) or not _SHA256_RE.fullmatch(digest):
            raise PolicyError(f"{context}[{index}].sha256 must be lowercase SHA-256")
        if not isinstance(media_type, str) or not _MEDIA_TYPE_RE.fullmatch(media_type):
            raise PolicyError(f"{context}[{index}].media_type must be a media type")
        if "schema" in ref and (
            not isinstance(ref["schema"], str)
            or not _SCHEMA_REF_RE.fullmatch(ref["schema"])
            or ".." in ref["schema"]
        ):
            raise PolicyError(
                f"{context}[{index}].schema must be a safe schema reference"
            )
        key = json.dumps(ref, sort_keys=True, separators=(",", ":"))
        if key in seen:
            raise PolicyError(f"{context} must contain unique references")
        seen.add(key)
        normalized.append(deepcopy(ref))
    return normalized


def _load_collaboration_profile(
    request: dict[str, Any],
) -> tuple[str, CollaborationPolicy, dict[str, Any]] | None:
    """Load a strict, repo-owned activation; never accept a path from a request."""
    if "collaboration" not in request:
        return None
    value = request["collaboration"]
    if not isinstance(value, dict) or set(value) != COLLABORATION_ACTIVATION_FIELDS:
        raise PolicyError(
            "collaboration must be an object with exactly mode, profile, participants, "
            "purpose, frozen_inputs, fallback, and artifact_refs"
        )
    if value["mode"] != "bounded-advisory":
        raise PolicyError("collaboration.mode must be bounded-advisory")
    profile = value["profile"]
    if (
        profile != "concept-art-direction/v1"
        or profile not in COLLABORATION_PROFILE_REGISTRY
    ):
        raise PolicyError("unsupported collaboration profile")
    participants = value["participants"]
    if participants != list(PEER_PROFILES):
        raise PolicyError(
            "collaboration.participants must be exactly concept-artist and art-director"
        )
    purpose = value["purpose"]
    if (
        not isinstance(purpose, str)
        or not purpose.strip()
        or len(purpose) > MAX_COLLABORATION_PURPOSE_CHARS
    ):
        raise PolicyError("collaboration.purpose must be a bounded non-empty string")
    if value["frozen_inputs"] is not True:
        raise PolicyError("collaboration.frozen_inputs must be true")
    if value["fallback"] != "parent-serial":
        raise PolicyError("collaboration.fallback must be parent-serial")
    try:
        policy = load_policy(COLLABORATION_PROFILE_REGISTRY[profile])
        refs = validate_artifact_refs(
            value["artifact_refs"], context="collaboration.artifact_refs"
        )
    except (CollaborationPolicyError, CollaborationEventValidationError) as error:
        raise PolicyError(
            f"invalid repo-owned collaboration profile: {error}"
        ) from error
    if not refs:
        raise PolicyError("collaboration.artifact_refs must be non-empty")
    if policy.policy_id != "concept-art-direction-v1" or policy.max_rounds != 1:
        raise PolicyError(
            "collaboration profile does not match concept-art-direction/v1"
        )
    activation = {
        "mode": "bounded-advisory",
        "profile": profile,
        "participants": list(PEER_PROFILES),
        "purpose": purpose.strip(),
        "frozen_inputs": True,
        "fallback": "parent-serial",
        "artifact_refs": [deepcopy(ref) for ref in refs],
    }
    return profile, policy, activation


def _collaboration_session_id(task_id: Any) -> str:
    source = task_id if isinstance(task_id, str) and task_id else "task"
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]
    return f"collab-{digest}"


def _collaboration_plan(
    profile: str,
    policy: CollaborationPolicy,
    task_id: Any,
    request: dict[str, Any],
    scopes: list[dict[str, Any]],
    *,
    concurrency: int,
    activation: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    by_profile: dict[str, dict[str, Any]] = {}
    duplicate_profile: str | None = None
    for scope in scopes:
        packet = scope.get("packet")
        skill_name = packet.get("skill_name") if isinstance(packet, dict) else None
        if skill_name in PEER_PROFILES:
            if skill_name in by_profile:
                duplicate_profile = skill_name
            else:
                by_profile[skill_name] = scope

    fallback_reason: str | None = None
    if request.get("serial") is True:
        raise PolicyError("serial=true cannot request collaboration")
    elif request.get("task_size") == "small":
        fallback_reason = "small_task"
    elif request.get("mechanical_inventory") is True:
        fallback_reason = "mechanical_inventory"
    elif concurrency < 2:
        fallback_reason = "insufficient_peer_capacity"
    elif duplicate_profile is not None:
        fallback_reason = f"duplicate_peer_profile:{duplicate_profile}"
    elif set(by_profile) != set(PEER_PROFILES):
        fallback_reason = "missing_required_peer_role"

    selected = (
        []
        if fallback_reason
        else [by_profile[profile_name] for profile_name in PEER_PROFILES]
    )
    participants = []
    for index, participant in enumerate(policy.participants):
        scope = by_profile.get(participant.profile)
        if fallback_reason or scope is None:
            continue
        participants.append(
            {
                "id": participant.id,
                "profile": participant.profile,
                "collaboration_profile": profile,
                "profile_version": 1,
                "session_id": _collaboration_session_id(task_id),
                "scope_id": scope["id"],
                "worker_id": f"worker-{index + 1}",
                "allowed_recipients": list(policy.allowed_recipients[participant.id]),
                "allowed_kinds": list(policy.allowed_kinds[participant.id]),
                "artifact_refs": deepcopy(activation["artifact_refs"]),
                "purpose": activation["purpose"],
                "frozen_inputs": True,
                "fallback": "parent-serial",
                "event_schema": COLLABORATION_SCHEMA_REFS["event"],
                "policy_schema": COLLABORATION_SCHEMA_REFS["policy"],
                "parent_only_decision": True,
                "peer_writes": False,
                "shared_mutable_paths": False,
                "recursive_spawn": False,
            }
        )
    if fallback_reason:
        participants = []
    plan = {
        "enabled": True,
        "status": "serial-fallback" if fallback_reason else "planned",
        "mode": activation["mode"],
        "profile": profile,
        "version": 1,
        "session_id": _collaboration_session_id(task_id),
        "participants": participants,
        "purpose": activation["purpose"],
        "frozen_inputs": True,
        "fallback": "parent-serial",
        "ownership": {
            "parent": "orchestrator",
            "decision_arbiter": "orchestrator",
            "peer_append": False,
            "peer_writes": False,
            "shared_mutable_paths": False,
            "recursive_spawn": False,
        },
        "limits": {
            "max_peers": policy.max_peers,
            "max_rounds": policy.max_rounds,
            "max_events": policy.max_events,
            "max_payload_bytes": policy.max_payload_bytes,
            "max_event_bytes": policy.max_event_bytes,
            "max_total_bytes": policy.max_total_bytes,
            "deadline_seconds": policy.deadline_seconds,
        },
        "schemas": dict(COLLABORATION_SCHEMA_REFS),
        "artifact_refs": deepcopy(activation["artifact_refs"]),
        "artifact_content_embedded": False,
        "host_capabilities": {
            "required": [
                "parent-mediated-in-process-mailbox",
                "parent-owned-jsonl-event-log",
            ],
            "verified": False,
            "status": "host-required",
        },
        "transport": {
            "preference": "in-process",
            "mode": "parent-mediated",
            "external_agy_peer_transport": False,
        },
        "serial_fallback_reason": fallback_reason,
        "serial_fallback": {"mode": "parent-serial", "reason": "host-required"},
    }
    return (
        plan,
        selected,
        "collaboration_serial_fallback"
        if fallback_reason
        else "collaboration_peer_path",
    )


def _positive_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise PolicyError(f"{name} must be a positive integer")
    return value


def _nonnegative_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise PolicyError(f"{name} must be a non-negative integer")
    return value


def validate_dispatch_packet(
    packet: Any, *, context: str = "packet"
) -> dict[str, Any] | None:
    """Validate and copy an optional immutable skill-aware dispatch packet."""
    if packet is None:
        return None
    if not isinstance(packet, dict):
        raise PolicyError(f"{context} must be an object")

    unknown = sorted(set(packet) - set(PACKET_FIELDS))
    if unknown:
        names = ", ".join(unknown)
        raise PolicyError(
            f"{context} has unknown packet field/type(s): {names}; "
            f"allowed fields are {', '.join(PACKET_FIELDS)}"
        )

    has_skill_name = "skill_name" in packet
    has_skill_path = "skill_path" in packet
    if has_skill_name != has_skill_path:
        raise PolicyError(f"{context} skill_name and skill_path must appear together")

    normalized: dict[str, Any] = {}
    for field in PACKET_FIELDS:
        if field not in packet:
            continue
        value = packet[field]
        if field == "artifact_refs":
            normalized[field] = _validate_artifact_refs(
                value, context=f"{context}.{field}"
            )
        elif field in PACKET_LIST_FIELDS:
            if (
                not isinstance(value, list)
                or len(value) > MAX_PACKET_LIST_ITEMS
                or not all(
                    isinstance(item, str)
                    and bool(item)
                    and len(item) <= MAX_PACKET_STRING_CHARS
                    for item in value
                )
            ):
                raise PolicyError(
                    f"{context}.{field} must be a bounded list of non-empty strings"
                )
        elif (
            not isinstance(value, str)
            or not value
            or len(value) > MAX_PACKET_STRING_CHARS
        ):
            raise PolicyError(
                f"{context}.{field} must be a non-empty string of at most "
                f"{MAX_PACKET_STRING_CHARS} characters"
            )
        normalized[field] = deepcopy(value)

    if has_skill_name:
        skill_name = packet["skill_name"]
        skill_path = packet["skill_path"]
        if "/" in skill_name or "\\" in skill_name or skill_name in {".", ".."}:
            raise PolicyError(
                f"{context}.skill_name must be a single safe skill directory"
            )
        if "\\" in skill_path:
            raise PolicyError(
                f"{context}.skill_path must use repository-relative POSIX paths"
            )
        path = PurePosixPath(skill_path)
        expected_parent = PurePosixPath("skills") / skill_name
        if (
            path.is_absolute()
            or ".." in path.parts
            or path.parent != expected_parent
            or path.name not in {"SKILL.md", "LITE.md"}
            or str(path) != skill_path
        ):
            raise PolicyError(
                f"{context}.skill_path must be skills/{skill_name}/SKILL.md or LITE.md"
            )

    return normalized


def _scopes(request: dict[str, Any]) -> list[dict[str, Any]]:
    scopes = request.get("scopes", [])
    if not isinstance(scopes, list) or not all(
        isinstance(scope, dict) for scope in scopes
    ):
        raise PolicyError("scopes must be an array of objects")
    seen: set[str] = set()
    for scope in scopes:
        scope_id = scope.get("id")
        paths = scope.get("paths")
        risks = scope.get("risk_signals", [])
        if not isinstance(scope_id, str) or not scope_id or scope_id in seen:
            raise PolicyError("scope ids must be unique non-empty strings")
        if (
            not isinstance(paths, list)
            or not paths
            or not all(isinstance(path, str) and path for path in paths)
        ):
            raise PolicyError(f"scope {scope_id} paths must be non-empty strings")
        if not isinstance(risks, list) or not all(
            isinstance(signal, str) for signal in risks
        ):
            raise PolicyError(f"scope {scope_id} risk_signals must be strings")
        if "packet" in scope:
            scope["packet"] = validate_dispatch_packet(
                scope["packet"], context=f"scope {scope_id}.packet"
            )
        seen.add(scope_id)
    return scopes


def _role(scope: dict[str, Any], *, disagreement: bool, mechanical: bool) -> str:
    if mechanical:
        return "scout"
    normalized = {
        signal.lower().replace("_", "-").replace(" ", "-")
        for signal in scope.get("risk_signals", [])
    }
    if disagreement or normalized & HIGH_RISK:
        return "expert"
    return "builder"


def decide_orchestration(request: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic worker/reviewer decision without calling a provider."""
    if not isinstance(request, dict):
        raise PolicyError("request must be an object")
    collaboration_profile = _load_collaboration_profile(request)
    if request.get("hard_token_cap") is True:
        raise PolicyError("hard token cap is unavailable for the AGY runtime")
    scopes = _scopes(request)
    limits = request.get("limits", {})
    if not isinstance(limits, dict):
        raise PolicyError("limits must be an object")
    if limits.get("hard_token_cap") is True:
        raise PolicyError("hard token cap is unavailable for the AGY runtime")
    concurrency = _nonnegative_int(limits.get("concurrency", 1), "limits.concurrency")
    deadline_ms = _positive_int(limits.get("deadline_ms", 30_000), "limits.deadline_ms")
    reviewer_requested = request.get("independent_review") is True
    collaboration_requested = collaboration_profile is not None
    # Legacy manifests may still carry historical token fields, but they are
    # deliberately ignored: planning has no token/cost/goal quota or stop
    # condition and never emits those fields.
    mechanical = request.get("mechanical_inventory") is True
    disagreement = request.get("disagreement") is True

    collaboration_plan = None
    selected: list[dict[str, Any]] = []
    reason = "no_parallel_benefit"
    if collaboration_profile is not None:
        profile, policy, activation = collaboration_profile
        collaboration_plan, selected, reason = _collaboration_plan(
            profile,
            policy,
            request.get("task_id", "task"),
            request,
            scopes,
            concurrency=concurrency,
            activation=activation,
        )
    elif request.get("task_size") == "small":
        reason = "small_task"
    elif request.get("serial") is True:
        reason = "serial_dependency"
    elif mechanical:
        if scopes and concurrency >= 1:
            selected = scopes[:1]
            reason = "mechanical_inventory"
        else:
            reason = "insufficient_capacity"
    else:
        independent = [scope for scope in scopes if scope.get("independent") is True]
        cap = min(len(independent), concurrency, 3)
        if cap >= 2:
            selected = independent[:cap]
            reason = "independent_scopes"
        elif independent:
            reason = "parallel_minimum_not_met"

    workers = []
    collaboration_by_scope = {
        participant["scope_id"]: participant
        for participant in (collaboration_plan or {}).get("participants", [])
    }
    for index, scope in enumerate(selected):
        worker = {
            "id": f"worker-{index + 1}",
            "scope_id": scope["id"],
            "paths": list(scope["paths"]),
            "role": _role(scope, disagreement=disagreement, mechanical=mechanical),
            "deadline_ms": deadline_ms,
            "recursive_spawn": False,
        }
        if scope["id"] in collaboration_by_scope:
            worker["peer_profile"] = collaboration_by_scope[scope["id"]]["profile"]
            worker["collaboration"] = deepcopy(collaboration_by_scope[scope["id"]])
        if scope.get("packet") is not None:
            worker["packet"] = deepcopy(scope["packet"])
        workers.append(worker)

    reviewer = None
    if reviewer_requested:
        reviewer = {
            "role": "expert",
            "packet": {
                "requirements": deepcopy(request.get("requirements", "")),
                "diff": deepcopy(request.get("diff", "")),
                "raw_evidence": deepcopy(request.get("raw_evidence", [])),
            },
            "recursive_spawn": False,
        }

    result = {
        "version": 1,
        "task_id": request.get("task_id", "task"),
        "decision_reason": reason,
        "worker_count": len(workers),
        "workers": workers,
        "reviewer": reviewer,
        "stop_conditions": list(STOP_CONDITIONS),
        "caps": {
            "scope_count": len(scopes),
            "concurrency": concurrency,
            "hard_worker_cap": 3,
        }
        if collaboration_requested
        else {
            "scope_count": len(scopes),
            "concurrency": concurrency,
            "hard_worker_cap": 3,
        },
    }
    if collaboration_plan is not None:
        result["collaboration_plan"] = collaboration_plan
    return result
