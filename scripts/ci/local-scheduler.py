#!/usr/bin/env python3
"""Install optional OS-native schedules for Forgewright local CI.

No daemon is installed. The OS scheduler invokes the canonical local CI entrypoint.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import platform
import plistlib
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO_ID = hashlib.sha256(str(ROOT).encode()).hexdigest()[:10]
LOCAL_CI = ROOT / "scripts" / "ci" / "local-ci.py"


def _command(mode: str) -> list[str]:
    return [sys.executable, str(LOCAL_CI), mode]


def _mac_paths() -> tuple[Path, Path, Path]:
    base = Path.home() / "Library" / "LaunchAgents"
    return (
        base / f"com.forgewright.{REPO_ID}.quick.plist",
        base / f"com.forgewright.{REPO_ID}.reindex.plist",
        base / f"com.forgewright.{REPO_ID}.deps.plist",
    )


def _mac_install() -> None:
    quick, reindex, deps = _mac_paths()
    quick.parent.mkdir(parents=True, exist_ok=True)
    configs = (
        (quick, "quick", {"Hour": 9, "Minute": 0}),
        (reindex, "reindex", {"Hour": 19, "Minute": 0}),
        (deps, "deps", {"Weekday": 1, "Hour": 10, "Minute": 0}),
    )
    for path, mode, calendar in configs:
        payload = {
            "Label": f"com.forgewright.{REPO_ID}.{mode}",
            "ProgramArguments": _command(mode),
            "WorkingDirectory": str(ROOT),
            "StartCalendarInterval": calendar,
            "RunAtLoad": False,
            "StandardOutPath": str(
                Path.home() / ".forgewright" / f"local-ci-{REPO_ID}-{mode}.log"
            ),
            "StandardErrorPath": str(
                Path.home() / ".forgewright" / f"local-ci-{REPO_ID}-{mode}.err.log"
            ),
        }
        path.write_bytes(plistlib.dumps(payload))
        subprocess.run(
            ["launchctl", "bootout", f"gui/{os.getuid()}", str(path)],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(path)], check=True
        )
        print(f"installed {path}")


def _mac_uninstall() -> None:
    for path in _mac_paths():
        if path.exists():
            subprocess.run(
                ["launchctl", "bootout", f"gui/{os.getuid()}", str(path)], check=False
            )
            path.unlink()
            print(f"removed {path}")


def _linux_dir() -> Path:
    return Path.home() / ".config" / "systemd" / "user"


def _linux_install() -> None:
    directory = _linux_dir()
    directory.mkdir(parents=True, exist_ok=True)
    for mode, calendar in (
        ("quick", "daily"),
        ("reindex", "*-*-* 19:00:00"),
        ("deps", "Mon *-*-* 10:00:00"),
    ):
        stem = f"forgewright-{REPO_ID}-{mode}"
        service = directory / f"{stem}.service"
        timer = directory / f"{stem}.timer"
        service.write_text(
            "[Unit]\nDescription=Forgewright local CI\n[Service]\nType=oneshot\n"
            f"WorkingDirectory={ROOT}\nExecStart={shlex.join(_command(mode))}\n",
            encoding="utf-8",
        )
        timer.write_text(
            "[Unit]\nDescription=Schedule Forgewright local CI\n[Timer]\n"
            f"OnCalendar={calendar}\nPersistent=true\n[Install]\nWantedBy=timers.target\n",
            encoding="utf-8",
        )
        subprocess.run(
            ["systemctl", "--user", "enable", "--now", timer.name], check=True
        )
        print(f"installed {timer}")


def _linux_uninstall() -> None:
    directory = _linux_dir()
    for mode in ("quick", "reindex", "deps"):
        stem = f"forgewright-{REPO_ID}-{mode}"
        subprocess.run(
            ["systemctl", "--user", "disable", "--now", f"{stem}.timer"], check=False
        )
        for suffix in ("service", "timer"):
            path = directory / f"{stem}.{suffix}"
            if path.exists():
                path.unlink()
                print(f"removed {path}")
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)


def _windows_install() -> None:
    for mode, schedule in (
        ("quick", ["/SC", "DAILY", "/ST", "09:00"]),
        ("reindex", ["/SC", "DAILY", "/ST", "19:00"]),
        ("deps", ["/SC", "WEEKLY", "/D", "MON", "/ST", "10:00"]),
    ):
        name = f"Forgewright-{REPO_ID}-{mode}"
        command = subprocess.list2cmdline(_command(mode))
        subprocess.run(
            ["schtasks", "/Create", "/F", "/TN", name, "/TR", command, *schedule],
            check=True,
        )
        print(f"installed scheduled task {name}")


def _windows_uninstall() -> None:
    for mode in ("quick", "reindex", "deps"):
        name = f"Forgewright-{REPO_ID}-{mode}"
        subprocess.run(["schtasks", "/Delete", "/F", "/TN", name], check=False)


def _dry_run_plan(system: str, action: str) -> None:
    print(f"scheduler dry-run: platform={system} action={action} repo={ROOT}")
    if action == "uninstall":
        print("would remove the repo-scoped quick/reindex/deps schedules")
        return
    print(f"daily quick: {subprocess.list2cmdline(_command('quick'))}")
    print(f"daily reindex: {subprocess.list2cmdline(_command('reindex'))}")
    print(f"weekly deps: {subprocess.list2cmdline(_command('deps'))}")
    if system == "Darwin":
        print("backend: launchd user LaunchAgents")
    elif system == "Linux":
        print("backend: systemd --user timers")
    elif system == "Windows":
        print("backend: Windows Task Scheduler")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Manage OS-native schedules for Forgewright local CI"
    )
    parser.add_argument("action", choices=("install", "uninstall"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    system = platform.system()
    if args.dry_run:
        _dry_run_plan(system, args.action)
        return 0
    if system == "Darwin":
        _mac_install() if args.action == "install" else _mac_uninstall()
    elif system == "Linux":
        _linux_install() if args.action == "install" else _linux_uninstall()
    elif system == "Windows":
        _windows_install() if args.action == "install" else _windows_uninstall()
    else:
        raise SystemExit(f"unsupported scheduler platform: {system}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
