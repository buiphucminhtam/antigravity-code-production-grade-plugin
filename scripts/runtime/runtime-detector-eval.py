#!/usr/bin/env python3
"""Evaluate the RLG gate's dev-server detector against real data on this machine.

Plan: docs/adr/ADR-010-runtime-lifecycle-guard.md

Why this exists: the P2 gate condition was "run observe mode for a week, then
check the detector does not misfire". Waiting is not the only way to get that
evidence — the machine already holds a week's worth (and more) of real command
history, and the projects' own package.json files say authoritatively which
scripts start something long-lived. This measures against both, today.

Two corpora, deliberately independent of the detector's pattern list:

  A. ~/.zsh_history          — what the user actually types. Used for the
                               FALSE POSITIVE picture (how noisy is the gate?).
  B. */package.json scripts  — the user's own declarations of what each script
                               runs. Used for the FALSE NEGATIVE picture (what
                               does the gate miss?). The label comes from the
                               RESOLVED command, never from the typed form, so
                               it cannot simply agree with the detector by
                               construction.

The pattern list is read out of the gate script itself rather than copied, so
this report can never drift from what actually runs.

Usage:  python3 scripts/runtime/runtime-detector-eval.py [--limit N] [--json]
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GATE = REPO / "scripts" / "lite" / "runtime-pretool-gate.sh"
RESOLVE_RE: re.Pattern | None = None


# ── read the detector's own pattern list ─────────────────────────────────────


def load_patterns() -> list[str]:
    """Parse the `for pat in \\ ... do` block out of the gate script."""
    text = GATE.read_text()
    m = re.search(r"for pat in \\\n(.*?)\ndo\n", text, re.S)
    if not m:
        print(
            "FATAL: cannot locate the pattern list in the gate script", file=sys.stderr
        )
        sys.exit(2)
    body = m.group(1)
    pats = re.findall(r"'([^']+)'", body)
    if len(pats) < 10:
        print(
            f"FATAL: only found {len(pats)} patterns — extraction looks wrong",
            file=sys.stderr,
        )
        sys.exit(2)
    return pats


def load_resolve_regex() -> re.Pattern:
    """Pull the gate's own npm-run resolution regex out of the script.

    Extracted rather than re-typed for the same reason as the pattern list: a
    mirror that drifts from the original measures something that is not running.
    """
    text = GATE.read_text()
    m = re.search(r"grep -qE '\((.*?)\)' ", text, re.S)
    if not m:
        print(
            "FATAL: cannot locate the resolve regex in the gate script", file=sys.stderr
        )
        sys.exit(2)
    body = m.group(1).replace("[[:space:]]", r"\s")
    return re.compile(body, re.I)


def detect(cmd: str, patterns: list[str], scripts: dict | None = None) -> str | None:
    """Mirror of the gate's decision, on the typed command.

    Three stages, same order as the hook: literal patterns → trailing `&` →
    resolve `npm run <name>` through package.json.
    """
    for p in patterns:
        if p in cmd:
            return p
    if re.search(r"\s&\s*$", cmd):
        return "background-&"
    if scripts is not None:
        m = re.search(r"(?:npm|pnpm|yarn)\s+run\s+([\w:.-]+)", cmd)
        if m:
            name = m.group(1)
            value = str(scripts.get(name, ""))
            # The gate matches against `grep -o` output, which still carries the
            # surrounding quotes ("name": "value") — patterns like `vitest"`
            # depend on them. Reconstruct that exact shape or the mirror lies.
            probe = f'"{name}": "{value}"'
            if value and RESOLVE_RE.search(probe):
                return f"npm-run:{name}"
    return None


# ── corpus A: real shell history ─────────────────────────────────────────────


def load_history() -> list[str]:
    path = Path.home() / ".zsh_history"
    if not path.is_file():
        return []
    raw = path.read_text(errors="replace").splitlines()
    out = []
    for line in raw:
        # tolerate zsh extended format even though this machine does not use it
        line = re.sub(r"^: \d+:\d+;", "", line).strip()
        if line:
            out.append(line)
    return out


# ── corpus B: package.json scripts, labelled by the RESOLVED command ─────────

# Programs that do not return until interrupted. Independent of the gate list:
# this describes runtime behaviour, not typed syntax.
# NOTE ON \b: `vite` must not match inside `vitest`. The first version of this
# oracle used a bare `vite` alternative and mislabelled every `vitest run` as a
# long-running server — the exact substring bug the detector itself had. Keeping
# the boundary explicit here, because a measuring instrument that shares the bug
# it is measuring cannot detect it.
LONG_RUNNING = re.compile(
    r"(?:^|[\s;&|])(?:"
    r"vite\b(?!\s+build)|next\s+dev|nuxt\s+dev|webpack(?:-dev-)?serve|ng\s+serve|"
    r"react-scripts\s+start|astro\s+dev|remix\s+dev|nodemon|tsx\s+watch|ts-node-dev|"
    r"http\.server|live-server|serve\b|storybook|expo\s+start|flutter\s+run|"
    r"concurrently|electron\s|tauri\s+dev|uvicorn|gunicorn|flask\s+run|rails\s+s\b|"
    r"php\s+-S|docker\s+compose\s+up|watchexec|chokidar|turbo\s+run\s+dev"
    r")",
    re.I,
)
# Watch-mode runners are long-running only in watch mode. Bare `jest` and
# `vitest run` both exit on their own; only `vitest` (no subcommand) watches.
WATCH_MODE = re.compile(r"(?:vitest\b(?!\s+run)|--watch\b|\b-w\b|jest\s+--watch)", re.I)
PYTHON_SERVER = re.compile(r"python[0-9.]*\s+\S*main\.py|manage\.py\s+runserver", re.I)


def is_long_running(resolved: str) -> bool:
    if LONG_RUNNING.search(resolved) or PYTHON_SERVER.search(resolved):
        return True
    return bool(WATCH_MODE.search(resolved))


def resolve_cross_package(cmd: str, project_dir: str, depth: int = 0) -> str:
    """Follow `cd <subdir> && npm run X` into that subdir's own package.json.

    `dev:cli -> cd src/cli && npm run dev -> tsup --watch` is long-running, but
    stopping at the project's own package.json makes it look inert and scores a
    correct detection as a false positive. Verified by hand on two projects
    before adding this.
    """
    if depth >= 2:
        return ""
    out = ""
    for m in re.finditer(
        r"cd\s+([\w./-]+)\s*&&\s*(?:npm|pnpm|yarn)\s+run\s+([\w:.-]+)", cmd
    ):
        subdir, target = m.group(1), m.group(2)
        pj = os.path.join(project_dir, subdir, "package.json")
        if not os.path.isfile(pj):
            continue
        try:
            sub = json.load(open(pj)).get("scripts") or {}
        except Exception:
            continue
        val = str(sub.get(target, ""))
        if val:
            out += (
                " ;; "
                + val
                + resolve_cross_package(
                    val, os.path.join(project_dir, subdir), depth + 1
                )
            )
    return out


def resolve_script(scripts: dict, name: str, depth: int = 0) -> str:
    """Follow `npm run X` delegation inside the same package.json.

    Without this, `dev:cli -> cd src/cli && npm run dev` looks inert and the
    oracle scores a correct detection as a false positive. One level of
    indirection is common enough in these projects to change the verdict.
    """
    cmd = str(scripts.get(name, ""))
    if depth >= 3:
        return cmd
    expanded = cmd
    for m in re.finditer(r"(?:npm|pnpm|yarn)\s+run\s+([\w:.-]+)", cmd):
        target = m.group(1)
        if target in scripts and target != name:
            expanded += " ;; " + resolve_script(scripts, target, depth + 1)
    return expanded


def load_package_scripts() -> list[dict]:
    rows = []
    for pj in sorted(glob.glob(os.path.expanduser("~/GitHub/*/package.json"))):
        try:
            data = json.load(open(pj))
        except Exception:
            continue
        project = os.path.basename(os.path.dirname(pj))
        scripts = data.get("scripts") or {}
        project_dir = os.path.dirname(pj)
        for name, cmd in scripts.items():
            resolved = resolve_script(scripts, name)
            resolved += resolve_cross_package(resolved, project_dir)
            rows.append(
                {
                    "_scripts": scripts,
                    "project": project,
                    "script": name,
                    "resolved": str(cmd),
                    "resolved_deep": resolved,
                    "typed": f"npm run {name}",
                    "label_long_running": is_long_running(resolved),
                }
            )
    return rows


# ── report ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--limit", type=int, default=12, help="examples to print per section"
    )
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    global RESOLVE_RE
    patterns = load_patterns()
    RESOLVE_RE = load_resolve_regex()
    history = load_history()
    scripts = load_package_scripts()

    # ── A. false-positive picture on real typed commands ─────────────────────
    uniq = sorted(set(history))
    hits = [(c, detect(c, patterns)) for c in uniq]
    matched = [(c, p) for c, p in hits if p]

    # ── B. confusion matrix on package.json scripts ──────────────────────────
    tp = fp = tn = fn = 0
    fns, fps = [], []
    for r in scripts:
        predicted = detect(r["typed"], patterns, r["_scripts"]) is not None
        actual = r["label_long_running"]
        if predicted and actual:
            tp += 1
        elif predicted and not actual:
            fp += 1
            fps.append(r)
        elif not predicted and actual:
            fn += 1
            fns.append(r)
        else:
            tn += 1

    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0

    if args.json:
        print(
            json.dumps(
                {
                    "patterns": len(patterns),
                    "history_total": len(history),
                    "history_unique": len(uniq),
                    "history_matched": len(matched),
                    "history_match_rate": round(len(matched) / len(uniq), 4)
                    if uniq
                    else 0,
                    "scripts_total": len(scripts),
                    "tp": tp,
                    "fp": fp,
                    "tn": tn,
                    "fn": fn,
                    "precision": round(prec, 3),
                    "recall": round(rec, 3),
                    "false_negatives": [
                        {k: r[k] for k in ("project", "typed", "resolved")} for r in fns
                    ],
                },
                indent=2,
            )
        )
        return 0

    print("━━ RLG detector evaluation ━━")
    print(f"patterns in gate: {len(patterns)}")
    print()
    print("── A. Real typed commands (~/.zsh_history) — noise check")
    print(f"   total lines      : {len(history)}")
    print(f"   unique commands  : {len(uniq)}")
    print(
        f"   flagged by gate  : {len(matched)}  ({len(matched) / len(uniq) * 100:.2f}% of unique)"
    )
    print()
    print("   what got flagged (top patterns):")
    counts: dict[str, int] = {}
    for _, p in matched:
        counts[p] = counts.get(p, 0) + 1
    for p, n in sorted(counts.items(), key=lambda x: -x[1])[: args.limit]:
        print(f"     {n:5}  {p}")
    print()
    print("   sample flagged commands:")
    for c, p in matched[: args.limit]:
        print(f"     [{p}] {c[:90]}")

    print()
    print("── B. package.json scripts — labelled by RESOLVED command")
    print(f"   scripts examined : {len(scripts)}")
    print(f"   TP {tp}   FP {fp}   TN {tn}   FN {fn}")
    print(f"   precision {prec:.2f}   recall {rec:.2f}")
    if fns:
        print()
        print("   MISSED (long-running but gate would not flag the typed form):")
        for r in fns:
            print(f"     {r['project']:22} {r['typed']:28} -> {r['resolved'][:60]}")
    if fps:
        print()
        print("   OVER-FLAGGED (gate flags it, but it terminates on its own):")
        for r in fps[: args.limit]:
            print(f"     {r['project']:22} {r['typed']:28} -> {r['resolved'][:60]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
