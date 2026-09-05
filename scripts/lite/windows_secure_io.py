#!/usr/bin/env python3
"""Handle-anchored atomic file publication for native Windows runtimes."""

from __future__ import annotations

import os
import stat
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path


def _is_reparse(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )


def _lexical_target(root: Path, target: Path) -> tuple[Path, Path]:
    root_lexical = Path(os.path.abspath(root))
    target_lexical = Path(os.path.abspath(target))
    try:
        target_lexical.relative_to(root_lexical)
    except ValueError as error:
        raise ValueError(
            "Windows atomic-write target must stay inside its root"
        ) from error
    return root_lexical, target_lexical


def _safe_basename(value: str) -> str:
    if (
        not value
        or value in {".", ".."}
        or "\0" in value
        or any(separator in value for separator in ("/", "\\", ":"))
        or value.rstrip(" .") != value
    ):
        raise ValueError("Windows atomic-write target must use a safe basename")
    stem = value.split(".", 1)[0].upper()
    reserved = {"CON", "PRN", "AUX", "NUL"} | {
        f"{prefix}{index}" for prefix in ("COM", "LPT") for index in range(1, 10)
    }
    if stem in reserved:
        raise ValueError("Windows atomic-write target uses a reserved basename")
    return value


def _close_windows_handle(handle: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL
    if not close_handle(handle):
        raise ctypes.WinError(ctypes.get_last_error())


@contextmanager
def locked_directory_chain(root: Path, directory: Path) -> Iterator[list[int] | None]:
    """Pin every directory node from the trusted root through the target parent."""

    if os.name != "nt":
        yield None
        return

    import ctypes
    from ctypes import wintypes

    class FileAttributeTagInfo(ctypes.Structure):
        _fields_ = [
            ("file_attributes", wintypes.DWORD),
            ("reparse_tag", wintypes.DWORD),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create_file.restype = wintypes.HANDLE
    get_information = kernel32.GetFileInformationByHandleEx
    get_information.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    get_information.restype = wintypes.BOOL
    file_read_attributes = 0x0080
    file_traverse = 0x0020
    file_share_read = 0x00000001
    open_existing = 3
    file_attribute_directory = 0x00000010
    file_attribute_reparse_point = 0x00000400
    file_flag_backup_semantics = 0x02000000
    file_flag_open_reparse_point = 0x00200000
    file_attribute_tag_info = 9
    invalid_handle = wintypes.HANDLE(-1).value

    root_lexical = Path(os.path.abspath(root))
    directory_lexical = Path(os.path.abspath(directory))
    try:
        relative = directory_lexical.relative_to(root_lexical)
    except ValueError as error:
        raise ValueError(
            "Windows atomic-write directory must stay inside its root"
        ) from error
    candidates = [root_lexical]
    current = root_lexical
    for component in relative.parts:
        current /= component
        candidates.append(current)

    handles: list[int] = []
    try:
        for candidate in candidates:
            handle = create_file(
                str(candidate),
                file_read_attributes | file_traverse,
                file_share_read,
                None,
                open_existing,
                file_flag_backup_semantics | file_flag_open_reparse_point,
                None,
            )
            if handle == invalid_handle:
                raise ctypes.WinError(ctypes.get_last_error())
            handles.append(handle)
            attributes = FileAttributeTagInfo()
            if not get_information(
                handle,
                file_attribute_tag_info,
                ctypes.byref(attributes),
                ctypes.sizeof(attributes),
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            if not attributes.file_attributes & file_attribute_directory or (
                attributes.file_attributes & file_attribute_reparse_point
            ):
                raise ValueError(
                    "Windows atomic-write directory chain contains a reparse point"
                )
        yield handles
    finally:
        for handle in reversed(handles):
            _close_windows_handle(handle)


def _open_publication_directory(directory: Path) -> int:
    """Reopen the temp-anchored parent for in-directory replacement."""

    import ctypes
    from ctypes import wintypes

    class FileAttributeTagInfo(ctypes.Structure):
        _fields_ = [
            ("file_attributes", wintypes.DWORD),
            ("reparse_tag", wintypes.DWORD),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create_file.restype = wintypes.HANDLE
    get_information = kernel32.GetFileInformationByHandleEx
    get_information.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    get_information.restype = wintypes.BOOL

    file_read_attributes = 0x0080
    file_traverse = 0x0020
    file_share_read = 0x00000001
    file_share_write = 0x00000002
    open_existing = 3
    file_attribute_directory = 0x00000010
    file_attribute_reparse_point = 0x00000400
    file_flag_backup_semantics = 0x02000000
    file_flag_open_reparse_point = 0x00200000
    file_attribute_tag_info = 9
    invalid_handle = wintypes.HANDLE(-1).value

    handle = create_file(
        str(directory),
        file_read_attributes | file_traverse,
        file_share_read | file_share_write,
        None,
        open_existing,
        file_flag_backup_semantics | file_flag_open_reparse_point,
        None,
    )
    if handle == invalid_handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        attributes = FileAttributeTagInfo()
        if not get_information(
            handle,
            file_attribute_tag_info,
            ctypes.byref(attributes),
            ctypes.sizeof(attributes),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if not attributes.file_attributes & file_attribute_directory or (
            attributes.file_attributes & file_attribute_reparse_point
        ):
            raise ValueError("Windows publication directory is not a plain directory")
        return handle
    except BaseException:
        _close_windows_handle(handle)
        raise


def _create_temporary_file(directory: Path, name: str) -> tuple[int, Path]:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create_file.restype = wintypes.HANDLE
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [wintypes.HANDLE]
    close_handle.restype = wintypes.BOOL

    generic_read = 0x80000000
    generic_write = 0x40000000
    delete_access = 0x00010000
    file_share_read = 0x00000001
    create_new = 1
    file_attribute_normal = 0x00000080
    file_flag_open_reparse_point = 0x00200000
    error_file_exists = {80, 183}
    invalid_handle = wintypes.HANDLE(-1).value

    for _ in range(100):
        temporary = directory / f".{name}.{next(tempfile._get_candidate_names())}.tmp"
        handle = create_file(
            str(temporary),
            generic_read | generic_write | delete_access,
            file_share_read,
            None,
            create_new,
            file_attribute_normal | file_flag_open_reparse_point,
            None,
        )
        if handle == invalid_handle:
            error = ctypes.get_last_error()
            if error in error_file_exists:
                continue
            raise ctypes.WinError(error)
        try:
            descriptor = msvcrt.open_osfhandle(
                handle,
                os.O_RDWR | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOINHERIT", 0),
            )
        except BaseException:
            close_handle(handle)
            raise
        return descriptor, temporary
    raise FileExistsError("could not allocate a unique Windows temporary file")


def _open_windows_lock_file(path: Path) -> int:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create_file.restype = wintypes.HANDLE

    generic_read = 0x80000000
    generic_write = 0x40000000
    file_share_read = 0x00000001
    file_share_write = 0x00000002
    open_always = 4
    file_attribute_normal = 0x00000080
    file_flag_open_reparse_point = 0x00200000
    invalid_handle = wintypes.HANDLE(-1).value

    handle = create_file(
        str(path),
        generic_read | generic_write,
        file_share_read | file_share_write,
        None,
        open_always,
        file_attribute_normal | file_flag_open_reparse_point,
        None,
    )
    if handle == invalid_handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return msvcrt.open_osfhandle(
            handle,
            os.O_RDWR | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOINHERIT", 0),
        )
    except BaseException:
        _close_windows_handle(handle)
        raise


def open_anchored_lock_file(
    root: Path,
    directory: Path,
    path: Path,
    *,
    before_open: Callable[[], None] | None = None,
    after_open: Callable[[], None] | None = None,
) -> int:
    """Create or open a lock while its parent is pinned, then retain a child anchor."""

    if os.name != "nt":
        raise OSError("anchored lock files are only available on Windows")
    root_lexical, path_lexical = _lexical_target(root, path)
    directory_lexical = Path(os.path.abspath(directory))
    if path_lexical.parent != directory_lexical:
        raise ValueError("Windows lock file must be a direct child of its directory")
    _safe_basename(path_lexical.name)

    descriptor = -1
    try:
        with locked_directory_chain(root_lexical, directory_lexical) as handles:
            if not handles:
                raise OSError("Windows directory handles are unavailable")
            if before_open is not None:
                before_open()
            descriptor = _open_windows_lock_file(path_lexical)
            opened = os.fstat(descriptor)
            current = path_lexical.lstat()
            if (
                not stat.S_ISREG(opened.st_mode)
                or not stat.S_ISREG(current.st_mode)
                or opened.st_nlink != 1
                or current.st_nlink != 1
                or _is_reparse(opened)
                or _is_reparse(current)
                or (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino)
            ):
                raise OSError("Windows lock file is not a private regular file")
        if after_open is not None:
            after_open()
        return descriptor
    except BaseException:
        if descriptor >= 0:
            os.close(descriptor)
        raise


def _rename_open_file(descriptor: int, directory_handle: int, target_name: str) -> None:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    class FileRenameInfo(ctypes.Structure):
        _fields_ = [
            ("replace_if_exists", wintypes.DWORD),
            ("root_directory", wintypes.HANDLE),
            ("file_name_length", wintypes.DWORD),
            ("file_name", wintypes.WCHAR * 1),
        ]

    class IoStatusValue(ctypes.Union):
        _fields_ = [("status", wintypes.LONG), ("pointer", wintypes.LPVOID)]

    class IoStatusBlock(ctypes.Structure):
        _anonymous_ = ("value",)
        _fields_ = [("value", IoStatusValue), ("information", ctypes.c_size_t)]

    name = _safe_basename(target_name)
    encoded_name = name.encode("utf-16-le")
    name_offset = FileRenameInfo.file_name.offset
    buffer = ctypes.create_string_buffer(
        name_offset + len(encoded_name) + ctypes.sizeof(wintypes.WCHAR)
    )
    rename_info = ctypes.cast(buffer, ctypes.POINTER(FileRenameInfo)).contents
    rename_info.replace_if_exists = 1
    rename_info.root_directory = directory_handle
    rename_info.file_name_length = len(encoded_name)
    ctypes.memmove(
        ctypes.addressof(buffer) + name_offset, encoded_name, len(encoded_name)
    )

    ntdll = ctypes.WinDLL("ntdll")
    set_information = ntdll.NtSetInformationFile
    set_information.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(IoStatusBlock),
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.c_int,
    ]
    set_information.restype = wintypes.LONG
    status_block = IoStatusBlock()
    status = set_information(
        msvcrt.get_osfhandle(descriptor),
        ctypes.byref(status_block),
        buffer,
        len(buffer),
        10,
    )
    if status != 0:
        to_dos_error = ntdll.RtlNtStatusToDosError
        to_dos_error.argtypes = [wintypes.LONG]
        to_dos_error.restype = wintypes.ULONG
        raise ctypes.WinError(to_dos_error(status))


def _dispose_open_file(descriptor: int) -> None:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    class FileDispositionInfo(ctypes.Structure):
        _fields_ = [("delete_file", wintypes.BOOL)]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    set_information = kernel32.SetFileInformationByHandle
    set_information.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    set_information.restype = wintypes.BOOL
    disposition = FileDispositionInfo(True)
    if not set_information(
        msvcrt.get_osfhandle(descriptor),
        4,
        ctypes.byref(disposition),
        ctypes.sizeof(disposition),
    ):
        raise ctypes.WinError(ctypes.get_last_error())


def atomic_write_bytes(
    root: Path,
    target: Path,
    payload: bytes,
    *,
    after_guard: Callable[[], None] | None = None,
    after_anchor: Callable[[], None] | None = None,
    after_publish: Callable[[], None] | None = None,
) -> None:
    """Publish bytes below ``root`` without a path-redirection window on Windows."""

    if os.name != "nt":
        raise OSError("handle-anchored atomic_write_bytes is only available on Windows")
    root_lexical, target_lexical = _lexical_target(root, target)
    _safe_basename(target_lexical.name)
    with locked_directory_chain(
        root_lexical, target_lexical.parent
    ) as directory_handles:
        if not directory_handles:
            raise OSError("Windows directory handles are unavailable")
        try:
            current = target_lexical.lstat()
        except FileNotFoundError:
            pass
        else:
            if not stat.S_ISREG(current.st_mode) or _is_reparse(current):
                raise OSError("Windows atomic-write target is not a regular file")
        if after_guard is not None:
            after_guard()

        descriptor, _temporary = _create_temporary_file(
            target_lexical.parent, target_lexical.name
        )
        published = False
        publication_directory_handle: int | None = None
        try:
            opened = os.fstat(descriptor)
            if not stat.S_ISREG(opened.st_mode) or _is_reparse(opened):
                raise OSError("Windows atomic-write temporary file is unsafe")
            remaining = memoryview(payload)
            while remaining:
                written = os.write(descriptor, remaining)
                if written <= 0:
                    raise OSError("Windows atomic write made no progress")
                remaining = remaining[written:]
            os.fsync(descriptor)
            strict_parent_handle = directory_handles.pop()
            _close_windows_handle(strict_parent_handle)
            publication_directory_handle = _open_publication_directory(
                target_lexical.parent
            )
            if after_anchor is not None:
                after_anchor()
            _rename_open_file(
                descriptor, publication_directory_handle, target_lexical.name
            )
            published = True
            if after_publish is not None:
                after_publish()
            final = os.fstat(descriptor)
            replaced = target_lexical.lstat()
            if (
                not stat.S_ISREG(final.st_mode)
                or not stat.S_ISREG(replaced.st_mode)
                or _is_reparse(final)
                or _is_reparse(replaced)
                or (replaced.st_dev, replaced.st_ino) != (final.st_dev, final.st_ino)
                or final.st_size != len(payload)
            ):
                raise OSError("Windows atomic-write target is unsafe after publication")
        except BaseException as error:
            if not published:
                try:
                    _dispose_open_file(descriptor)
                except OSError as cleanup_error:
                    error.add_note(
                        f"Windows temporary-file cleanup also failed: {cleanup_error}"
                    )
            raise
        finally:
            if publication_directory_handle is not None:
                _close_windows_handle(publication_directory_handle)
            os.close(descriptor)
        if not published:
            raise OSError("Windows atomic write did not publish the target")
