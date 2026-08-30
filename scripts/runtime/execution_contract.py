"""Provider-neutral execution controls for bounded agent dispatch.

Planning may use deep reasoning, but execution receives an immutable contract.
The contract binds scope, acceptance, non-goals, replan triggers, and phase-aware
routing. Runtime helpers add adaptive time/output caps and deterministic
progress checks without claiming control over provider-private reasoning tokens.
"""

from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from typing import Any, Iterable, Mapping


class ExecutionContractError(ValueError):
    """Raised when an execution contract is malformed or has drifted."""


CONTRACT_VERSION = 1
MAX_OBJECTIVE_CHARS = 4_096
MAX_LIST_ITEMS = 32
MAX_ITEM_CHARS = 512
REPLAN_TRIGGERS = (
    "material_assumption_invalidated",
    "acceptance_unreachable",
    "material_risk_discovered",
    "same_blocker_twice",
    "user_scope_change",
)
TASK_CLASS_BY_SIZE = {
    "small": "quick",
    "medium": "standard",
    "large": "deep",
}
ADAPTIVE_CAPS = {
    "quick": {"deadline_ms": 15_000, "max_result_chars": 8_192},
    "standard": {"deadline_ms": 30_000, "max_result_chars": 16_384},
    "deep": {"deadline_ms": 60_000, "max_result_chars": 32_768},
}
ROLE_REASONING = {
    "scout": "low",
    "builder": "medium",
    "expert": "high",
}
BLOCKER_PATTERN = re.compile(
    r"(?im)\bblocker(?:_|-)?id\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._-]{0,127})"
)
FINDING_PATTERN = re.compile(
    r"(?im)\bfinding(?:_|-)?id\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._-]{0,127})"
)


def _bounded_text(value: Any, field: str, *, max_chars: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ExecutionContractError(f"{field} must be a non-empty string")
    normalized = value.strip()
    if len(normalized) > max_chars:
        raise ExecutionContractError(f"{field} exceeds {max_chars} characters")
    return normalized


def _bounded_text_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list):
        raise ExecutionContractError(f"{field} must be an array")
    if len(value) > MAX_LIST_ITEMS:
        raise ExecutionContractError(f"{field} exceeds {MAX_LIST_ITEMS} items")
    return [
        _bounded_text(item, f"{field}[{index}]", max_chars=MAX_ITEM_CHARS)
        for index, item in enumerate(value)
    ]


def resolve_task_class(request: Mapping[str, Any]) -> str:
    explicit = request.get("task_class")
    if explicit is not None:
        if explicit not in ADAPTIVE_CAPS:
            raise ExecutionContractError(
                "task_class must be one of quick, standard, or deep"
            )
        return str(explicit)
    return TASK_CLASS_BY_SIZE.get(str(request.get("task_size", "medium")), "standard")


def routing_for(role: str, *, phase: str) -> dict[str, str]:
    if phase == "audit":
        return {"phase": "audit", "tier": "expert", "reasoning_effort": "high"}
    if phase not in {"planning", "execution"} or role not in ROLE_REASONING:
        raise ExecutionContractError(f"unsupported phase/role routing: {phase}/{role}")
    return {
        "phase": phase,
        "tier": role,
        "reasoning_effort": ROLE_REASONING[role],
    }


def adaptive_execution_caps(
    task_class: str, requested_deadline_ms: int, requested_max_result_chars: int
) -> dict[str, int]:
    if task_class not in ADAPTIVE_CAPS:
        raise ExecutionContractError(f"unsupported task class: {task_class}")
    for field, value in (
        ("deadline_ms", requested_deadline_ms),
        ("max_result_chars", requested_max_result_chars),
    ):
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ExecutionContractError(f"{field} must be a positive integer")
    profile = ADAPTIVE_CAPS[task_class]
    return {
        "deadline_ms": min(requested_deadline_ms, profile["deadline_ms"]),
        "max_result_chars": min(
            requested_max_result_chars, profile["max_result_chars"]
        ),
    }


def _canonical_digest(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def lock_execution_contract(
    request: Mapping[str, Any], workers: Iterable[Mapping[str, Any]]
) -> dict[str, Any]:
    if "execution_contract" in request:
        raise ExecutionContractError(
            "caller-supplied execution_contract is forbidden; the parent locks it"
        )
    objective = _bounded_text(
        request.get("requirements"), "requirements", max_chars=MAX_OBJECTIVE_CHARS
    )
    acceptance = _bounded_text_list(
        request.get("acceptance_criteria", [objective]), "acceptance_criteria"
    )
    if not acceptance:
        raise ExecutionContractError("acceptance_criteria must not be empty")
    out_of_scope = _bounded_text_list(request.get("out_of_scope", []), "out_of_scope")
    scope_ids = [
        _bounded_text(worker.get("scope_id"), "scope_id", max_chars=MAX_ITEM_CHARS)
        for worker in workers
    ]
    task_class = resolve_task_class(request)
    planning_role = "expert" if task_class == "deep" else "builder"
    core: dict[str, Any] = {
        "version": CONTRACT_VERSION,
        "status": "locked",
        "task_class": task_class,
        "objective": objective,
        "acceptance_criteria": acceptance,
        "scope_ids": scope_ids,
        "out_of_scope": out_of_scope,
        "replan_triggers": list(REPLAN_TRIGGERS),
        "phase_policy": {
            "planning": routing_for(planning_role, phase="planning"),
            "execution": {"reasoning_by_tier": deepcopy(ROLE_REASONING)},
            "audit": routing_for("expert", phase="audit"),
        },
    }
    return {**core, "digest": _canonical_digest(core)}


def verify_locked_contract(contract: Any) -> dict[str, Any]:
    if not isinstance(contract, dict):
        raise ExecutionContractError("execution contract is missing")
    if (
        contract.get("version") != CONTRACT_VERSION
        or contract.get("status") != "locked"
    ):
        raise ExecutionContractError(
            "execution contract is not a locked version 1 contract"
        )
    digest = contract.get("digest")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ExecutionContractError("plan lock digest is malformed")
    core = {key: deepcopy(value) for key, value in contract.items() if key != "digest"}
    if _canonical_digest(core) != digest:
        raise ExecutionContractError("plan lock digest mismatch")
    return contract


def assess_worker_progress(results: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    stop_reasons: list[str] = []
    finding_owners: dict[str, str] = {}
    blocker_owners: dict[str, str] = {}
    for result in results:
        worker_id = str(result.get("id", "unknown"))
        if result.get("exit_code") != 0:
            stop_reasons.append(
                f"worker_failed:{worker_id}:{result.get('exit_code', 'unknown')}"
            )
            continue
        stdout = str(result.get("stdout", ""))
        stderr = str(result.get("stderr", ""))
        combined = f"{stdout}\n{stderr}".strip()
        if not combined:
            stop_reasons.append(f"no_material_progress:{worker_id}")
            continue
        for finding_id in {
            match.casefold() for match in FINDING_PATTERN.findall(combined)
        }:
            previous_owner = finding_owners.get(finding_id)
            if previous_owner is not None:
                stop_reasons.append(f"duplicate_findings:{previous_owner},{worker_id}")
            else:
                finding_owners[finding_id] = worker_id
        for blocker_id in {
            match.casefold() for match in BLOCKER_PATTERN.findall(combined)
        }:
            previous_owner = blocker_owners.get(blocker_id)
            if previous_owner is not None:
                stop_reasons.append(
                    f"same_blocker_twice:{blocker_id}:{previous_owner},{worker_id}"
                )
            else:
                blocker_owners[blocker_id] = worker_id
    return {
        "status": "failed" if stop_reasons else "passed",
        "stop_reasons": stop_reasons,
    }


def summarize_execution_metrics(
    contract: Mapping[str, Any],
    results: Iterable[Mapping[str, Any]],
    progress: Mapping[str, Any],
) -> dict[str, Any]:
    verified = verify_locked_contract(dict(contract))
    records = list(results)
    durations = [
        int(record.get("duration_ms", 0))
        for record in records
        if isinstance(record.get("duration_ms", 0), int)
        and not isinstance(record.get("duration_ms", 0), bool)
        and int(record.get("duration_ms", 0)) >= 0
    ]
    output_chars = sum(
        len(str(record.get("stdout", ""))) + len(str(record.get("stderr", "")))
        for record in records
    )
    stop_reasons = progress.get("stop_reasons", [])
    if not isinstance(stop_reasons, list):
        raise ExecutionContractError("progress.stop_reasons must be an array")
    return {
        "plan_digest": verified["digest"],
        "task_class": verified["task_class"],
        "worker_count": len(records),
        "successful_workers": sum(record.get("exit_code") == 0 for record in records),
        "duration_ms_total": sum(durations),
        "duration_ms_max": max(durations, default=0),
        "output_chars_total": output_chars,
        "progress_status": progress.get("status"),
        "stop_reason_count": len(stop_reasons),
    }
