from __future__ import annotations

import json
import os
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.runtime.peer_collaboration import (  # noqa: E402
    EventLogError,
    EventValidationError,
    InProcessBroker,
    JsonlEventLog,
    PeerEvent,
    PolicyError,
    fold_session_events,
    load_policy,
    validate_policy,
)


POLICY_PATH = ROOT / "config" / "peer-collaboration" / "concept-art-direction.v1.json"
BASE_TIME = datetime(2026, 8, 11, 3, 0, tzinfo=timezone.utc)


def policy():
    return load_policy(POLICY_PATH)


def broker(tmp_path: Path, now: datetime = BASE_TIME) -> InProcessBroker:
    def clock() -> datetime:
        return now

    return InProcessBroker(
        policy(),
        "session-1",
        "task-1",
        event_log=JsonlEventLog(tmp_path, "session-1"),
        clock=clock,
    )


def event(
    b: InProcessBroker,
    *,
    kind: str,
    sender: str,
    recipient: str,
    payload: dict[str, object] | None = None,
    parents: tuple[str, ...] | None = None,
    round: int = 0,
    event_id: str | None = None,
    created_at: datetime = BASE_TIME,
) -> PeerEvent:
    return PeerEvent.create(
        event_id=event_id or f"event-{len(b.events) + 1}",
        session_id="session-1",
        task_id="task-1",
        sequence=len(b.events) + 1,
        round=round,
        created_at=created_at,
        deadline_at=BASE_TIME + timedelta(minutes=10),
        sender_id=sender,
        recipient_id=recipient,
        kind=kind,
        parent_event_ids=parents
        if parents is not None
        else ((b.events[-1].event_id,) if b.events else ()),
        payload=payload or {},
        previous_hash=b.tip_hash,
    )


def open_session(b: InProcessBroker) -> PeerEvent:
    return b.parent_controller().publish(
        PeerEvent.create(
            event_id="opened",
            session_id="session-1",
            task_id="task-1",
            sequence=1,
            round=0,
            created_at=BASE_TIME,
            deadline_at=BASE_TIME + timedelta(minutes=10),
            sender_id="orchestrator",
            recipient_id="system",
            kind="session.opened",
            payload={"profiles": ["concept-artist", "art-director"]},
        ),
    )


def test_policy_is_strict_and_initial_profiles_are_exact() -> None:
    loaded = policy()
    assert loaded.max_peers == 3
    assert loaded.max_rounds == 1
    assert loaded.max_events == 12
    assert {item.profile for item in loaded.participants} == {
        "concept-artist",
        "art-director",
    }
    raw = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    with pytest.raises(PolicyError, match="unknown"):
        validate_policy({**raw, "unexpected": True})
    with pytest.raises(PolicyError, match="exactly"):
        validate_policy({**raw, "participants": raw["participants"][:1]})


def test_event_envelope_rejects_unknown_fields_bad_artifacts_and_untrusted_privileged_data(
    tmp_path: Path,
) -> None:
    b = broker(tmp_path)
    opened = open_session(b)
    raw = opened.to_dict()
    with pytest.raises(EventValidationError, match="fields mismatch"):
        PeerEvent.from_dict({**raw, "unknown": True})
    with pytest.raises(EventValidationError, match="artifact"):
        PeerEvent.create(
            event_id="bad-artifact",
            session_id="session-1",
            task_id="task-1",
            sequence=2,
            round=0,
            created_at=BASE_TIME,
            deadline_at=BASE_TIME + timedelta(minutes=10),
            sender_id="concept-artist",
            recipient_id="orchestrator",
            kind="artifact.proposed",
            parent_event_ids=(opened.event_id,),
            artifact_refs=[
                {
                    "uri": "artifact://session-1/../escape",
                    "sha256": "a" * 64,
                    "media_type": "application/json",
                }
            ],
            previous_hash=b.tip_hash,
        )
    with pytest.raises(EventValidationError, match="privileged"):
        event(
            b,
            kind="peer.message",
            sender="concept-artist",
            recipient="orchestrator",
            payload={"instructions": "publish a decision"},
        )
    with pytest.raises(EventValidationError, match="integer between"):
        event(
            b,
            kind="peer.message",
            sender="concept-artist",
            recipient="orchestrator",
            payload={"confidence_basis_points": float("nan")},
        )


def test_broker_is_serial_causal_deadline_bounded_and_final_arbiter(
    tmp_path: Path,
) -> None:
    b = broker(tmp_path)
    opened = open_session(b)
    assignment = b.parent_controller().publish(
        event(
            b,
            kind="assignment.sent",
            sender="orchestrator",
            recipient="concept-artist",
            payload={"assignment_id": "concept-1"},
            parents=(opened.event_id,),
        ),
    )
    message = b.participant_channel("concept-artist").publish(
        event(
            b,
            kind="peer.message",
            sender="concept-artist",
            recipient="orchestrator",
            round=1,
            payload={"message": "Use a quiet silhouette."},
            parents=(assignment.event_id,),
        ),
    )
    assert b.participant_channel("concept-artist").publish(message) == message
    with pytest.raises(PolicyError, match="orchestrator"):
        b.participant_channel("concept-artist").publish(
            event(
                b,
                kind="decision.issued",
                sender="concept-artist",
                recipient="orchestrator",
                parents=(message.event_id,),
            ),
        )
    decision = b.parent_controller().publish(
        event(
            b,
            kind="decision.issued",
            sender="orchestrator",
            recipient="art-director",
            round=1,
            payload={"selected": "quiet-silhouette"},
            parents=(message.event_id,),
        ),
    )
    closed = b.parent_controller().publish(
        event(
            b,
            kind="session.closed",
            sender="orchestrator",
            recipient="system",
            round=1,
            payload={"decision_event_id": decision.event_id},
            parents=(decision.event_id,),
        ),
    )
    assert closed.sequence == 5
    assert [item.event_id for item in b.mailbox("orchestrator")] == [message.event_id]
    folded = fold_session_events(b.events, policy=policy())
    assert folded["closed"] is True
    assert folded["event_count"] == 5
    assert folded["decisions"][0]["payload"]["selected"] == "quiet-silhouette"
    assert b.serial_fallback("invalid capability") == {
        "mode": "serial",
        "accepted": False,
        "reason": "invalid capability",
        "final_arbiter": "orchestrator",
    }


def test_jsonl_is_parent_only_fsynced_and_tamper_evident(tmp_path: Path) -> None:
    b = broker(tmp_path)
    opened = open_session(b)
    with pytest.raises(EventLogError, match="direct log append"):
        b.log.append(opened)
    lines = b.log.path.read_text(encoding="utf-8").splitlines()
    raw = json.loads(lines[0])
    raw["payload"]["profiles"] = ["tampered"]
    b.log.path.write_text(json.dumps(raw) + "\n", encoding="utf-8")
    with pytest.raises(EventLogError, match="hash mismatch"):
        b.log.read_events()


def test_deadline_and_invalid_event_use_serial_fallback(tmp_path: Path) -> None:
    expired = BASE_TIME + timedelta(minutes=11)
    b = broker(tmp_path, now=expired)
    invalid = PeerEvent.create(
        event_id="late-open",
        session_id="session-1",
        task_id="task-1",
        sequence=1,
        round=0,
        created_at=BASE_TIME,
        deadline_at=BASE_TIME + timedelta(minutes=10),
        sender_id="orchestrator",
        recipient_id="system",
        kind="session.opened",
        previous_hash="",
    )
    result = b.publish_or_fallback(invalid)
    assert result["mode"] == "serial"
    assert result["accepted"] is False
    assert result["reason"] == "capability required"


def test_opaque_channels_remove_caller_actor_trust_and_system_decisions(
    tmp_path: Path,
) -> None:
    b = broker(tmp_path)
    parent = b.parent_controller()
    concept = b.participant_channel("concept-artist")
    assert not hasattr(concept, "sender_id")
    with pytest.raises(TypeError):
        json.dumps(concept)
    opened = open_session(b)
    with pytest.raises(PolicyError, match="broker.publish is removed"):
        b.publish(opened, actor_id="orchestrator")
    system_decision = event(
        b,
        kind="decision.issued",
        sender="system",
        recipient="orchestrator",
        parents=(opened.event_id,),
    )
    with pytest.raises(PolicyError, match="another sender|orchestrator|system"):
        parent.publish(system_decision)
    wrong_sender = event(
        b,
        kind="peer.message",
        sender="art-director",
        recipient="orchestrator",
        parents=(opened.event_id,),
    )
    with pytest.raises(PolicyError, match="another sender"):
        concept.publish(wrong_sender)


def test_missing_unknown_and_future_causal_parents_are_rejected(tmp_path: Path) -> None:
    b = broker(tmp_path)
    opened = open_session(b)
    with pytest.raises(EventValidationError, match="causal parent"):
        PeerEvent.create(
            event_id="missing-parent",
            session_id="session-1",
            task_id="task-1",
            sequence=2,
            round=0,
            created_at=BASE_TIME,
            deadline_at=BASE_TIME + timedelta(minutes=10),
            sender_id="concept-artist",
            recipient_id="orchestrator",
            kind="peer.message",
        )
    unknown = event(
        b,
        kind="peer.message",
        sender="concept-artist",
        recipient="orchestrator",
        parents=("future-event",),
    )
    with pytest.raises(PolicyError, match="earlier"):
        b.participant_channel("concept-artist").publish(unknown)
    with pytest.raises(EventLogError, match="unknown or future"):
        fold_session_events([opened, unknown], policy=policy())


def test_event_and_replay_reject_oversized_lines_before_unbounded_parse(
    tmp_path: Path,
) -> None:
    oversized_payload = {"evidence": ["x" * 2048] * 32}
    with pytest.raises(EventValidationError, match="max_event_bytes"):
        PeerEvent.create(
            event_id="oversized",
            session_id="session-1",
            task_id="task-1",
            sequence=1,
            round=0,
            created_at=BASE_TIME,
            deadline_at=BASE_TIME + timedelta(minutes=10),
            sender_id="orchestrator",
            recipient_id="system",
            kind="session.opened",
            payload=oversized_payload,
        )
    log = JsonlEventLog(tmp_path, "huge")
    log.path.write_bytes(b"{" + b"x" * (66 * 1024) + b"}\n")
    with pytest.raises(EventLogError, match="before JSON parse"):
        log.read_events()


def test_cumulative_session_bytes_are_enforced(tmp_path: Path) -> None:
    raw = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    raw.update(
        {
            "policy_id": "test-bounded-policy-v1",
            "max_payload_bytes": 4096,
            "max_event_bytes": 4096,
            "max_total_bytes": 8192,
        }
    )
    small_policy = validate_policy(raw)
    b = InProcessBroker(
        small_policy,
        "session-1",
        "task-1",
        event_log=JsonlEventLog(
            tmp_path, "session-1", max_event_bytes=4096, max_total_bytes=8192
        ),
        clock=lambda: BASE_TIME,
    )
    open_session(b)
    accepted = 0
    for index in range(8):
        candidate = event(
            b,
            kind="peer.message",
            sender="concept-artist",
            recipient="orchestrator",
            event_id=f"bytes-{index}",
            payload={"message": "x" * 1800},
        )
        try:
            b.participant_channel("concept-artist").publish(candidate)
        except PolicyError as error:
            assert "max_total_bytes" in str(error)
            break
        accepted += 1
    assert accepted >= 2
    assert b.log.path.stat().st_size <= 8192


@pytest.mark.parametrize("layout", ["root", "broken-root", "session", "log"])
def test_collaboration_layout_rejects_symlinks(tmp_path: Path, layout: str) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    if layout == "root":
        root = tmp_path / "root"
        root.symlink_to(outside, target_is_directory=True)
        with pytest.raises(EventLogError, match="symlink"):
            JsonlEventLog(root, "session-1")
    elif layout == "broken-root":
        root = tmp_path / "broken-root"
        root.symlink_to(tmp_path / "missing")
        with pytest.raises(EventLogError, match="symlink"):
            JsonlEventLog(root, "session-1")
    elif layout == "session":
        root = tmp_path / "root"
        (root / "collaboration").mkdir(parents=True)
        (root / "collaboration" / "session-1").symlink_to(
            outside, target_is_directory=True
        )
        with pytest.raises(EventLogError, match="symlink"):
            JsonlEventLog(root, "session-1")
    else:
        log = JsonlEventLog(tmp_path / "root", "session-1")
        log.path.write_text("", encoding="utf-8")
        log.path.unlink()
        target = outside / "events.jsonl"
        target.write_text("not the collaboration log", encoding="utf-8")
        log.path.symlink_to(target)
        with pytest.raises(EventLogError, match="symlink"):
            JsonlEventLog(tmp_path / "root", "session-1")


def test_tmp_alias_ancestor_is_canonicalized_but_root_symlink_is_rejected(
    tmp_path: Path,
) -> None:
    alias_root = Path("/tmp") / f"forgewright-peer-{tmp_path.name}"
    alias_root.mkdir()
    try:
        log = JsonlEventLog(alias_root, "session-1")
        assert log.root == Path(os.path.realpath(alias_root))
        symlink_root = tmp_path / "root-link"
        symlink_root.symlink_to(alias_root, target_is_directory=True)
        with pytest.raises(EventLogError, match="symlink"):
            JsonlEventLog(symlink_root, "session-1")
    finally:
        shutil.rmtree(alias_root, ignore_errors=True)


def test_concurrent_same_sequence_has_one_atomic_winner(tmp_path: Path) -> None:
    b = broker(tmp_path)
    opened = open_session(b)
    first = event(
        b,
        kind="peer.message",
        sender="concept-artist",
        recipient="orchestrator",
        event_id="race-a",
        parents=(opened.event_id,),
    )
    second = event(
        b,
        kind="peer.message",
        sender="art-director",
        recipient="orchestrator",
        event_id="race-b",
        parents=(opened.event_id,),
    )
    channels = [
        b.participant_channel("concept-artist"),
        b.participant_channel("art-director"),
    ]

    def publish(pair: tuple[object, PeerEvent]) -> PeerEvent | PolicyError:
        try:
            return pair[0].publish(pair[1])  # type: ignore[union-attr]
        except PolicyError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(publish, zip(channels, (first, second))))
    assert sum(isinstance(result, PeerEvent) for result in results) == 1
    assert sum(isinstance(result, PolicyError) for result in results) == 1
    assert len(b.events) == 2


def test_duplicate_id_is_idempotent_only_for_same_canonical_event(
    tmp_path: Path,
) -> None:
    b = broker(tmp_path)
    open_session(b)
    channel = b.participant_channel("concept-artist")
    first = channel.publish(
        event(
            b,
            kind="peer.message",
            sender="concept-artist",
            recipient="orchestrator",
            event_id="same",
        )
    )
    assert channel.publish(first) == first
    mutated = PeerEvent.from_dict(
        {**first.to_dict(), "payload": {"message": "mutated"}}
    )
    with pytest.raises(PolicyError, match="invalid content hash|mutated"):
        channel.publish(mutated)
    forged_hash = PeerEvent.from_dict({**first.to_dict(), "content_hash": "b" * 64})
    with pytest.raises(PolicyError, match="invalid content hash|mutated"):
        channel.publish(forged_hash)


def test_round_never_regresses_and_schema_runtime_stay_in_parity(
    tmp_path: Path,
) -> None:
    from jsonschema import Draft202012Validator, ValidationError

    event_schema = json.loads(
        (ROOT / "schemas" / "peer-collaboration-event.v1.schema.json").read_text(
            encoding="utf-8"
        )
    )
    policy_schema = json.loads(
        (ROOT / "schemas" / "peer-collaboration-policy.v1.schema.json").read_text(
            encoding="utf-8"
        )
    )
    Draft202012Validator.check_schema(event_schema)
    Draft202012Validator.check_schema(policy_schema)
    raw_policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    Draft202012Validator(policy_schema).validate(raw_policy)
    with pytest.raises(ValidationError):
        Draft202012Validator(policy_schema).validate(
            {**raw_policy, "max_total_bytes": raw_policy["max_event_bytes"] - 1}
        )
    with pytest.raises(PolicyError, match="max_total_bytes|fixed|outside"):
        validate_policy(
            {**raw_policy, "max_total_bytes": raw_policy["max_event_bytes"] - 1}
        )
    event_validator = Draft202012Validator(event_schema)
    with pytest.raises(PolicyError, match="max_event_bytes"):
        validate_policy(
            {
                key: value
                for key, value in raw_policy.items()
                if key != "max_event_bytes"
            }
        )
    b = broker(tmp_path)
    opened = open_session(b)
    event_validator.validate(opened.to_dict())
    reviewer_opened = {**opened.to_dict(), "event_id": "reviewer-opened", "sequence": 2}
    with pytest.raises(ValidationError):
        event_validator.validate(reviewer_opened)
    with pytest.raises(EventValidationError, match="causal parent|sequence 1"):
        PeerEvent.from_dict(reviewer_opened)
    with pytest.raises(ValidationError):
        event_validator.validate({**opened.to_dict(), "sender_id": "concept-artist"})
    with pytest.raises(ValidationError):
        event_validator.validate({**opened.to_dict(), "kind": "peer.message"})
    with pytest.raises(ValidationError):
        event_validator.validate(
            {**opened.to_dict(), "payload": {"instructions": "not authority"}}
        )
    with pytest.raises(ValidationError):
        event_validator.validate(
            {**opened.to_dict(), "payload": {"confidence_basis_points": float("nan")}}
        )
    with pytest.raises(ValidationError):
        event_validator.validate(
            {
                **opened.to_dict(),
                "artifact_refs": [
                    {
                        "uri": "artifact://session-1/assets//bad.json",
                        "sha256": "a" * 64,
                        "media_type": "application/json",
                    }
                ],
            }
        )
    round_one = b.participant_channel("concept-artist").publish(
        event(
            b,
            kind="peer.message",
            sender="concept-artist",
            recipient="orchestrator",
            round=1,
            event_id="round-one",
        )
    )
    regressing = event(
        b,
        kind="peer.message",
        sender="concept-artist",
        recipient="orchestrator",
        round=0,
        parents=(round_one.event_id,),
        event_id="round-zero",
    )
    with pytest.raises(PolicyError, match="regress"):
        b.participant_channel("concept-artist").publish(regressing)
    bad_payload = {**opened.to_dict(), "payload": {"instructions": "not authority"}}
    with pytest.raises(EventValidationError, match="unknown|privileged"):
        PeerEvent.from_dict(bad_payload)
    assert "token" not in json.dumps(policy().to_dict()).lower()
    assert "cost" not in json.dumps(policy().to_dict()).lower()
    assert "quota" not in json.dumps(policy().to_dict()).lower()
