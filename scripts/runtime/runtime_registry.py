#!/usr/bin/env python3
"""Registry engine for the Runtime Lifecycle Guard (RLG).

Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md

The registry is an append-only JSONL log at $RLG_HOME/leases.jsonl. Each line is
one event; the *state* of a lease is the fold of its events (last event wins).
Append-only means a crashed writer can never corrupt prior records, and the file
doubles as an audit trail of everything the guard ever opened or closed.

Event record (schema_version "1"):
    lease_id, ts, event(open|close), project, session_id, role, pid, pgid,
    port, cmd, log, ttl_sec, policy(reap|keep), reason

HARD INVARIANT: this module never signals, kills, or otherwise touches a
process. It only reads liveness via os.kill(pid, 0). Reaping is P2.

Called by runtime-lease.sh; not intended to be used directly.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "1"
VALID_EVENTS = ("open", "close")
VALID_POLICIES = ("reap", "keep")


# ── paths ────────────────────────────────────────────────────────────────────


def rlg_home() -> Path:
    env = os.environ.get("FORGEWRIGHT_RLG_HOME")
    if env:
        return Path(env)
    return Path.home() / ".forgewright" / "runtime"


def leases_path() -> Path:
    return rlg_home() / "leases.jsonl"


# ── io ───────────────────────────────────────────────────────────────────────


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(ts: str) -> float | None:
    try:
        return (
            datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
            .replace(tzinfo=timezone.utc)
            .timestamp()
        )
    except (ValueError, TypeError):
        return None


def append_event(rec: dict) -> None:
    """Append one event. Single write() of a newline-terminated line so a
    concurrent writer can never interleave a partial record."""
    path = leases_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line)
        fh.flush()
        os.fsync(fh.fileno())


def read_events() -> list[dict]:
    path = leases_path()
    if not path.is_file():
        return []
    out: list[dict] = []
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for lineno, raw in enumerate(fh, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError:
                # A torn or hand-edited line must not take the whole registry
                # down — skip it and keep going.
                print(
                    f"[rlg] warn: skipping malformed registry line {lineno}",
                    file=sys.stderr,
                )
                continue
            if isinstance(rec, dict) and rec.get("lease_id"):
                out.append(rec)
    return out


# ── state fold ───────────────────────────────────────────────────────────────


def pid_alive(pid) -> bool:
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Exists but owned by another user — alive for our purposes.
        return True
    except OSError:
        return False


def fold(events: list[dict]) -> dict[str, dict]:
    """Fold the event log into current lease state, in file order."""
    leases: dict[str, dict] = {}
    for rec in events:
        lid = rec["lease_id"]
        cur = leases.setdefault(lid, {})
        # 'open' seeds the record; later events overlay non-null fields only,
        # so a bare close event never erases the lease's identity.
        for key, val in rec.items():
            if val is not None or key not in cur:
                cur[key] = val
        cur["state"] = "open" if rec.get("event") == "open" else "closed"
    return leases


def annotate(lease: dict) -> dict:
    """Attach derived, non-persisted fields."""
    lease = dict(lease)
    alive = pid_alive(lease.get("pid")) if lease.get("pid") else False
    lease["alive"] = alive

    if lease.get("state") == "open" and not alive:
        lease["health"] = "dead"  # process gone, registry still says open
    elif lease.get("state") == "open":
        ttl = lease.get("ttl_sec")
        started = parse_ts(lease.get("ts", ""))
        if ttl and started and (time.time() - started) > float(ttl):
            lease["health"] = "expired"
        else:
            lease["health"] = "live"
    else:
        lease["health"] = "closed"

    started = parse_ts(lease.get("ts", ""))
    lease["age_sec"] = int(time.time() - started) if started else None
    return lease


def select(
    leases: dict[str, dict],
    state: str = "open",
    session: str | None = None,
    project: str | None = None,
) -> list[dict]:
    out = []
    for lease in leases.values():
        if state != "all" and lease.get("state") != state:
            continue
        if session and lease.get("session_id") != session:
            continue
        if project and lease.get("project") != project:
            continue
        out.append(annotate(lease))
    out.sort(key=lambda x: (x.get("ts") or "", x.get("lease_id") or ""))
    return out


# ── commands ─────────────────────────────────────────────────────────────────


def cmd_append(args) -> int:
    if args.event not in VALID_EVENTS:
        print(f"[rlg] error: invalid event {args.event!r}", file=sys.stderr)
        return 2
    if args.policy and args.policy not in VALID_POLICIES:
        print(f"[rlg] error: invalid policy {args.policy!r}", file=sys.stderr)
        return 2

    rec = {
        "schema_version": SCHEMA_VERSION,
        "lease_id": args.lease_id,
        "ts": now_utc(),
        "event": args.event,
        "project": args.project,
        "session_id": args.session,
        "role": args.role,
        "pid": args.pid,
        "pgid": args.pgid,
        "port": args.port,
        "cmd": args.cmd,
        "log": args.log,
        "ttl_sec": args.ttl,
        "policy": args.policy,
        "reason": args.reason,
    }
    append_event(rec)
    print(args.lease_id)
    return 0


def _fmt_table(rows: list[dict]) -> str:
    if not rows:
        return "(none)"
    hdr = f"{'LEASE':<21} {'STATE':<7} {'HEALTH':<8} {'ROLE':<12} {'PORT':<6} {'PID':<8} {'AGE':<8} PROJECT"
    lines = [hdr, "-" * len(hdr)]
    for r in rows:
        age = r.get("age_sec")
        age_s = (
            f"{age}s"
            if age is not None and age < 120
            else (f"{age // 60}m" if age is not None else "-")
        )
        proj = r.get("project") or "-"
        home = str(Path.home())
        if proj.startswith(home):
            proj = "~" + proj[len(home) :]
        lines.append(
            f"{(r.get('lease_id') or '-'):<21} "
            f"{(r.get('state') or '-'):<7} "
            f"{(r.get('health') or '-'):<8} "
            f"{(r.get('role') or '-'):<12} "
            f"{str(r.get('port') or '-'):<6} "
            f"{str(r.get('pid') or '-'):<8} "
            f"{age_s:<8} "
            f"{proj}"
        )
    return "\n".join(lines)


def cmd_list(args) -> int:
    rows = select(fold(read_events()), args.state, args.session, args.project)
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    else:
        print(_fmt_table(rows))
    return 0


def cmd_status(args) -> int:
    leases = fold(read_events())
    rows = select(leases, "all", args.session, args.project)
    counts = {"open": 0, "closed": 0, "live": 0, "dead": 0, "expired": 0, "keep": 0}
    for r in rows:
        counts[r["state"]] = counts.get(r["state"], 0) + 1
        if r["state"] == "open":
            counts[r["health"]] = counts.get(r["health"], 0) + 1
            if r.get("policy") == "keep":
                counts["keep"] += 1

    if args.json:
        print(json.dumps(counts, indent=2))
    else:
        print(
            f"open: {counts['open']}  (live: {counts['live']}, "
            f"dead: {counts['dead']}, expired: {counts['expired']}, "
            f"keep: {counts['keep']})"
        )
        print(f"closed: {counts['closed']}")
        print(f"registry: {leases_path()}")

    # Exit 0 always — status is informational and must never break a caller.
    return 0


def cmd_prune(args) -> int:
    """Close registry records whose process is already gone.

    This reconciles the registry with reality. It does NOT kill anything —
    by definition every pruned lease's process is already dead.
    """
    rows = select(fold(read_events()), "open", args.session, args.project)
    dead = [r for r in rows if r["health"] == "dead"]

    if not dead:
        print("nothing to prune (0 dead leases)")
        return 0

    for r in dead:
        label = f"{r['lease_id']} pid={r.get('pid')} port={r.get('port')} role={r.get('role')}"
        if args.dry_run:
            print(f"WOULD PRUNE {label}")
            continue
        append_event(
            {
                "schema_version": SCHEMA_VERSION,
                "lease_id": r["lease_id"],
                "ts": now_utc(),
                "event": "close",
                "reason": "pruned-dead-process",
            }
        )
        print(f"PRUNED {label}")

    print(f"{'would prune' if args.dry_run else 'pruned'}: {len(dead)}")
    return 0


def cmd_ports(args) -> int:
    """Emit `port<TAB>lease_id` for every open lease — consumed by the
    inventory classifier and (later) the P1 gate."""
    for r in select(fold(read_events()), "open"):
        if r.get("port"):
            print(f"{r['port']}\t{r['lease_id']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="runtime_registry.py", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    ap = sub.add_parser("append", help="append one lease event")
    ap.add_argument("--lease-id", required=True)
    ap.add_argument("--event", required=True, choices=VALID_EVENTS)
    ap.add_argument("--project")
    ap.add_argument("--session")
    ap.add_argument("--role")
    ap.add_argument("--pid", type=int)
    ap.add_argument("--pgid", type=int)
    ap.add_argument("--port", type=int)
    ap.add_argument("--cmd")
    ap.add_argument("--log")
    ap.add_argument("--ttl", type=int)
    ap.add_argument("--policy", choices=VALID_POLICIES)
    ap.add_argument("--reason")
    ap.set_defaults(func=cmd_append)

    lp = sub.add_parser("list", help="list leases")
    lp.add_argument("--state", default="open", choices=("open", "closed", "all"))
    lp.add_argument("--session")
    lp.add_argument("--project")
    lp.add_argument("--json", action="store_true")
    lp.set_defaults(func=cmd_list)

    sp = sub.add_parser("status", help="summary counts")
    sp.add_argument("--session")
    sp.add_argument("--project")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_status)

    pp = sub.add_parser("prune", help="close leases whose process is dead")
    pp.add_argument("--session")
    pp.add_argument("--project")
    pp.add_argument("--dry-run", action="store_true")
    pp.set_defaults(func=cmd_prune)

    op = sub.add_parser("ports", help="open-lease ports, tab separated")
    op.set_defaults(func=cmd_ports)

    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
