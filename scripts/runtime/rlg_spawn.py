#!/usr/bin/env python3
"""Session-detaching launcher for the Runtime Lifecycle Guard.

Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md  (P1 — SPAWN)

macOS ships no `setsid(1)`, so this stands in for it. The launched command must
become its own process-group leader: that is what makes the whole tree
reclaimable later by a single `kill -TERM -<pgid>` instead of hunting children
one by one.

    python3 rlg_spawn.py --log FILE [--cwd DIR] [--env K=V]... -- cmd [args...]

Execution model: setsid() → redirect stdio to FILE → execvp(). Because the
final step is exec and not fork, the PID the caller backgrounded stays the PID
of the real process, and pgid == pid. Nothing here kills anything.
"""

from __future__ import annotations

import argparse
import os
import sys


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="rlg_spawn.py", add_help=True)
    parser.add_argument("--log", required=True, help="file for combined stdout+stderr")
    parser.add_argument("--cwd", help="working directory for the command")
    parser.add_argument(
        "--env",
        action="append",
        default=[],
        metavar="K=V",
        help="extra environment variable (repeatable)",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)

    cmd = args.command
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    if not cmd:
        print("rlg_spawn: no command given", file=sys.stderr)
        return 2

    # Detach into a new session/process group. Fails harmlessly if we are
    # somehow already a group leader — running the command still beats
    # refusing to start it, we just lose group-kill granularity.
    try:
        os.setsid()
    except OSError:
        pass

    if args.cwd:
        try:
            os.chdir(args.cwd)
        except OSError as exc:
            print(f"rlg_spawn: cannot chdir to {args.cwd}: {exc}", file=sys.stderr)
            return 2

    for pair in args.env:
        key, sep, val = pair.partition("=")
        if sep and key:
            os.environ[key] = val

    try:
        log_fd = os.open(args.log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    except OSError as exc:
        print(f"rlg_spawn: cannot open log {args.log}: {exc}", file=sys.stderr)
        return 2

    try:
        null_fd = os.open(os.devnull, os.O_RDONLY)
        os.dup2(null_fd, 0)
        os.close(null_fd)
    except OSError:
        pass

    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)
    if log_fd > 2:
        os.close(log_fd)

    try:
        os.execvp(cmd[0], cmd)
    except OSError as exc:
        # stderr is the log file by now, so this lands where the caller looks.
        print(f"rlg_spawn: cannot exec {cmd[0]}: {exc}", file=sys.stderr)
        return 127
    return 0  # unreachable


if __name__ == "__main__":
    sys.exit(main())
