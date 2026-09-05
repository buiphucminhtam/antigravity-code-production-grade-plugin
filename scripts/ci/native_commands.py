"""Resolve fixed local verifier commands without invoking a command shell.

Windows requires explicit npm/npx entrypoints and the active Python runtime;
POSIX keeps the declared argv unchanged. No command arguments are rewritten.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import sys
from typing import Mapping

WINDOWS = sys.platform == "win32"


def native_argv(argv: list[str]) -> list[str]:
    if not argv or not all(isinstance(arg, str) and arg for arg in argv):
        raise ValueError("verifier argv must be non-empty strings")
    if not WINDOWS or Path(argv[0]).is_absolute():
        return list(argv)
    name = argv[0].lower()
    if name in {"python", "python3"}:
        return [sys.executable, *argv[1:]]
    if name in {"npm", "npx"}:
        shim = shutil.which(name)
        node = shutil.which("node")
        if shim and node:
            entry = (
                Path(shim).parent / "node_modules" / "npm" / "bin" / f"{name}-cli.js"
            )
            if entry.is_file():
                return [node, str(entry), *argv[1:]]
        raise FileNotFoundError(f"native {name} CLI entrypoint is unavailable")
    if name == "bash":
        for key in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(key)
            if base:
                entry = Path(base) / "Git" / "bin" / "bash.exe"
                if entry.is_file():
                    return [str(entry), *argv[1:]]
    executable = shutil.which(argv[0])
    if not executable:
        raise FileNotFoundError(f"required verifier executable unavailable: {argv[0]}")
    return [executable, *argv[1:]]


def native_environment(base: Mapping[str, str] | None = None) -> dict[str, str]:
    environment = dict(os.environ if base is None else base)
    environment["PATH"] = (
        str(Path(sys.executable).parent) + os.pathsep + environment.get("PATH", "")
    )
    if WINDOWS:
        try:
            bash_directory = str(Path(native_argv(["bash"])[0]).parent)
        except FileNotFoundError:
            bash_directory = ""
        if bash_directory:
            environment["PATH"] += os.pathsep + bash_directory
    environment["PYTHONIOENCODING"] = "utf-8"
    environment["PYTHONUTF8"] = "1"
    return environment
