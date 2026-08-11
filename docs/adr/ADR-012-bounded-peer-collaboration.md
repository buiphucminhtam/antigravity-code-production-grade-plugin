# ADR-012: Bounded Peer Collaboration

**Status:** Accepted
**Date:** 2026-08-11

## Context

Forgewright has ordered specialist handoffs and parent-controlled parallel
dispatch, but some design questions benefit from a short review by the next
discipline. Unbounded peer chat would blur authority, make evidence difficult
to audit, and invite shared-state or prompt-injection failures. The repository
therefore needs a concrete host trust boundary and a deterministic fallback when
that host capability is unavailable.

## Decision

Adopt **bounded, read-only advisory peer collaboration** as an opt-in pipeline
capability. The parent/orchestrator is the broker, policy owner, observer, and
final arbiter. Participants receive immutable artifact references and return
typed event mappings through a parent-mediated in-process runtime. They do not
write files, call tools, spawn peers, merge work, or change policy. Peer and
retrieved content is untrusted data and must be evaluated as evidence, never
executed as instruction.

The implemented host boundary is `TrustedParentHostAdapter`, gated by an
out-of-band `TrustedHostCapability`. Both are same-process parent TCB objects;
neither may be serialized, manifest-loaded, or supplied by a peer. Participant
callbacks receive only the JSON-compatible mapping produced by
`ParticipantAssignment.to_dict()`. They never
receive `InProcessBroker`, `ParentController`, `ParticipantChannel`, another
callable, or a capability. The runner privately publishes returned untrusted
mappings through the participant-bound channel after validation.

The parent must record finite hard limits before opening a session:

- participant count;
- feedback rounds;
- total events;
- bytes transferred or accepted;
- wall-clock deadline.

These are enforcement boundaries, not task goals. The protocol defines no token,
cost, or goal quota and does not permit recursive spawn. The strict
`concept-art-direction/v1` repo-owned profile supplies the limits; the activation
cannot provide an arbitrary policy path or override them.

The first route is deliberately narrow:

```text
validated Concept Packet -> Art Director feedback -> parent decision
```

It is opt-in through `PIPELINE_CONTEXT.collaboration.mode:
bounded-advisory`, uses at most two participants and one feedback round, and is
skipped for ordinary Concept Artist or Art Director tasks. Concept Artist owns
concepts and the Concept Packet. Art Director owns Style DNA and its gates. The
parent decides whether feedback changes the accepted direction.

Version 1 uses a serial, thread-safe `InProcessBroker` and a parent-owned,
fsync'd, hash-chained JSONL log at
`.forgewright/collaboration/<session>/events.jsonl`. Artifact content is not
embedded; events carry strict `artifact://` URI, digest, media type, and optional
schema metadata.

Adapter callbacks share the policy deadline and run on daemon threads so the
runner does not wait indefinitely. Python cannot portably kill a timed-out
thread. Trusted adapter implementations must therefore be cancellation-aware
and implement `cancel(reason)`; cancellation is best-effort and late callback
results are discarded. The runtime must not claim callbacks are fully killable.

Unknown or malformed events, unsupported or missing capability, stale artifact
refs, limit/deadline breach, or unresolved disagreement requires explicit
`parent-serial` fallback. Without a parent serial executor, execution records
`parent-serial-required` and returns nonzero; it never invokes an untrusted peer
provider as fallback.

## Typed exchange

The parent accepts only events with the fields defined by
`schemas/peer-collaboration-event.v1.schema.json`:

```text
schema_version, event_id, session_id, task_id, sequence, round, created_at,
deadline_at, sender_id, recipient_id, kind, parent_event_ids, payload,
artifact_refs, content_hash
```

The initial event vocabulary is `session.opened`, `assignment.sent`,
`peer.message`, `artifact.proposed`, `finding.reported`, `blocker.reported`,
`decision.requested`, `decision.issued`, `session.closed`, and
`policy.rejected`. An artifact reference identifies a
parent-approved immutable artifact by artifact-store URI, digest, and media/type
metadata; the parent tracks byte size for enforcement.

## Consequences

### Positive

- Short cross-discipline reviews can improve handoffs without creating a second
  orchestrator.
- Parent observation, typed events, artifact refs, and hard bounds make the
  exchange auditable and deterministic.
- In-process delivery and referenced artifacts keep the common path bounded.
- Serial fallback preserves progress when a host or participant cannot safely
  support the capability.

### Negative

- The parent must validate artifacts, enforce limits, and arbitrate disagreement.
- `TrustedParentHostAdapter` is TCB code and must implement cooperative
  cancellation because a timed-out Python thread cannot be forcibly terminated.
- A failed or unsupported peer attempt adds a small amount of routing state even
  though the serial handoff remains the completion path.
- A reference-based exchange requires an artifact store or equivalent immutable
  local representation for large content.

## Explicitly out of scope

- peer writes or a shared mutable workspace;
- peer tool calls or merge/release authority;
- passing broker/controller/channel/callable/capability objects to peers;
- direct free-chat, alternate peer transport, remote webhooks, or a distributed broker;
- consensus, quorum, automatic policy changes, or recursive peer spawning;
- treating trusted-adapter output as trusted peer data.

The normative contract is
[`skills/_shared/protocols/peer-collaboration.md`](../../skills/_shared/protocols/peer-collaboration.md).
