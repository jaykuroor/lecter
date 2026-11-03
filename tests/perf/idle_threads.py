"""CPU time of the app's processes and their threads, for the idle attribution (F-180, D-161).

    idle_threads.py snapshot <app executable>   one JSON object: {"os", "now_ms", "procs": [...]}

Each process: pid, ppid, name, cpu_ns (user + system, the whole process, ended threads included)
and threads: [{"tid", "name", "cpu_ns"}] (Linux /proc/<pid>/task, macOS proc_pidinfo
PROC_PIDTHREADINFO, Windows Toolhelp + GetThreadTimes + GetThreadDescription). A thread list
that the OS refuses comes back empty, with the reason in "threads_error".

The group is the one process running <app executable>, its descendants and, on macOS, the WebKit
XPC services it uses (their parent is launchd, so they are found by the pid they are charged to,
as F-025's procs.py does). The idle flow (tests/e2e/flows/idle-cpu/) calls this every sample and
does the arithmetic; the pure parts here (`group`, the struct layouts) are what
ui/test/idle-threads.test.ts checks through `--selftest`.
"""

from __future__ import annotations

import ctypes
import json
import os
import re
import struct
import sys
import time
from pathlib import Path

WEBKIT_XPC = re.compile(r"^com\.apple\.WebKit\.")


def proc(pid: int, ppid: int, name: str, start_ms: float, path: str = "", responsible: int = 0) -> dict:
    return {"pid": pid, "ppid": ppid, "name": name, "start_ms": start_ms, "path": path,
            "responsible": responsible, "cpu_ns": 0, "threads": [], "threads_error": ""}


def same_path(a: str, b: str) -> bool:
    norm = os.path.normcase if os.name == "nt" else (lambda p: p)
    try:
        return norm(os.path.realpath(a)) == norm(os.path.realpath(b))
    except OSError:
        return False


def adopted(p: dict, app: dict, live: set[int]) -> bool:
    """macOS: a WebKit XPC service (parent launchd) working for the app: charged to the app, or to
    whatever the app is charged to (a test runner), or charged to nobody known."""
    if p["responsible"] == app["pid"]:
        return True
    if not (p["ppid"] == 1 and WEBKIT_XPC.match(p["name"])):
        return False
    shared = app["responsible"] > 1 and p["responsible"] == app["responsible"]
    unclaimed = p["responsible"] in (0, 1, p["pid"]) or p["responsible"] not in live
    return shared or unclaimed


def group(procs: list[dict], exe: str, same=same_path) -> list[dict]:
    """The app process for `exe` (exactly one), then its descendants and adopted services. A child
    must not have started before its parent (pids are reused)."""
    apps = [p for p in procs if p["path"] and same(p["path"], exe)]
    if len(apps) != 1:
        raise RuntimeError(f"expected one process running {exe}, found {len(apps)}")
    app = apps[0]
    live = {p["pid"] for p in procs}
    out, seen, todo = [app], {app["pid"]}, [app]
    while todo:
        parent = todo.pop()
        for p in procs:
            if p["pid"] in seen or p["start_ms"] < parent["start_ms"]:
                continue
            if p["ppid"] == parent["pid"] or (parent is app and adopted(p, app, live)):
                seen.add(p["pid"])
                out.append(p)
                todo.append(p)
    return out


# --- Linux: /proc ---------------------------------------------------------------------------


def linux_stat(text: str) -> tuple[str, list[str]]:
    """The command name and the fields after it (fields[0] is field 3, state)."""
    return text[text.index("(") + 1 : text.rindex(")")], text[text.rindex(")") + 2 :].split()


class Linux:
    def __init__(self, root: str = "/proc"):
        self.root = Path(root)
        self.hz = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100

    def _read(self, *parts: str) -> str | None:
        try:
            return self.root.joinpath(*parts).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

    def _cpu(self, f: list[str]) -> int:
        return (int(f[11]) + int(f[12])) * 1_000_000_000 // self.hz

    def snapshot(self) -> list[dict]:
        uptime = float((self._read("uptime") or "0").split()[0])
        now = time.time() * 1000
        out = []
        for d in self.root.iterdir():
            if not d.name.isdigit():
                continue
            stat = self._read(d.name, "stat")
            if stat is None:
                continue
            name, f = linux_stat(stat)
            try:
                path = os.readlink(d / "exe").removesuffix(" (deleted)")
            except OSError:
                path = ""
            p = proc(int(d.name), int(f[1]), name, now - (uptime - int(f[19]) / self.hz) * 1000, path)
            p["cpu_ns"] = self._cpu(f)
            out.append(p)
        return out

    def fill(self, procs: list[dict]) -> None:
        for p in procs:
            task = self.root / str(p["pid"]) / "task"
            try:
                tids = sorted(task.iterdir(), key=lambda t: int(t.name))
            except OSError as e:
                p["threads_error"] = str(e)
                continue
            for tid in tids:
                stat = self._read(str(p["pid"]), "task", tid.name, "stat")
                if stat:
                    name, f = linux_stat(stat)
                    p["threads"].append({"tid": int(tid.name), "name": name, "cpu_ns": self._cpu(f)})


# --- macOS: libproc -------------------------------------------------------------------------

PROC_PIDTBSDINFO = 3  # struct proc_bsdinfo, 136 bytes
BSDINFO_SIZE = 136
PROC_PIDTHREADINFO = 5  # struct proc_threadinfo, 112 bytes
THREADINFO_SIZE = 112
PROC_PIDLISTTHREADS = 6  # uint64 thread handles
RUSAGE_INFO_V2 = 2  # struct rusage_info_v2: ri_user_time at 16, ri_system_time at 24 (mach time)


def mac_bsdinfo(buf: bytes) -> tuple[int, int, str, float]:
    """(pid, ppid, name, start epoch ms) from a struct proc_bsdinfo: pbi_pid at 12, pbi_ppid at 16,
    pbi_comm[16] at 48, pbi_name[32] at 64, pbi_start_tvsec and pbi_start_tvusec at 120 and 128."""
    pid, ppid = struct.unpack_from("<II", buf, 12)
    comm = buf[48:64].split(b"\0", 1)[0].decode("utf-8", "replace")
    name = buf[64:96].split(b"\0", 1)[0].decode("utf-8", "replace") or comm
    sec, usec = struct.unpack_from("<QQ", buf, 120)
    return pid, ppid, name, sec * 1000 + usec / 1000


def mac_threadinfo(buf: bytes) -> tuple[int, str]:
    """(user + system ns, name) from a struct proc_threadinfo: pth_user_time and pth_system_time
    (uint64 ns) at 0 and 8, eight int32 fields, then pth_name[64] at 48."""
    user, system = struct.unpack_from("<QQ", buf, 0)
    return user + system, buf[48:112].split(b"\0", 1)[0].decode("utf-8", "replace")


def mac_rusage_cpu(buf: bytes, numer: int, denom: int) -> int:
    """User + system time in ns from a struct rusage_info_v2 (mach absolute time units)."""
    user, system = struct.unpack_from("<QQ", buf, 16)
    return (user + system) * numer // denom


class Mac:
    def __init__(self):
        c = ctypes
        self.lib = c.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        for fn, args in (("proc_listallpids", [c.c_void_p, c.c_int]),
                         ("proc_pidinfo", [c.c_int, c.c_int, c.c_uint64, c.c_void_p, c.c_int]),
                         ("proc_pidpath", [c.c_int, c.c_void_p, c.c_uint32]),
                         ("proc_pid_rusage", [c.c_int, c.c_int, c.c_void_p])):
            getattr(self.lib, fn).argtypes, getattr(self.lib, fn).restype = args, c.c_int
        self.responsible = getattr(self.lib, "responsibility_get_pid_responsible_for_pid", None)
        if self.responsible is not None:
            self.responsible.restype, self.responsible.argtypes = c.c_int, [c.c_int]

        class Timebase(c.Structure):
            _fields_ = [("numer", c.c_uint32), ("denom", c.c_uint32)]

        tb = Timebase()
        self.lib.mach_timebase_info(c.byref(tb))
        self.numer, self.denom = tb.numer or 1, tb.denom or 1

    def snapshot(self) -> list[dict]:
        n = self.lib.proc_listallpids(None, 0)
        pids = (ctypes.c_int * (n + 256))()
        n = self.lib.proc_listallpids(pids, ctypes.sizeof(pids))
        info = ctypes.create_string_buffer(BSDINFO_SIZE)
        path = ctypes.create_string_buffer(4096)
        out = []
        for pid in (pids[i] for i in range(max(n, 0)) if pids[i] > 0):
            if self.lib.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, BSDINFO_SIZE) != BSDINFO_SIZE:
                continue
            _, ppid, name, start = mac_bsdinfo(info.raw)
            k = self.lib.proc_pidpath(pid, path, ctypes.sizeof(path))
            exe = path.raw[:k].decode("utf-8", "replace") if k > 0 else ""
            owner = self.responsible(pid) if self.responsible is not None else 0
            out.append(proc(pid, ppid, os.path.basename(exe) if exe else name, start, exe, owner))
        return out

    def fill(self, procs: list[dict]) -> None:
        ru = ctypes.create_string_buffer(512)
        ti = ctypes.create_string_buffer(THREADINFO_SIZE)
        for p in procs:
            if self.lib.proc_pid_rusage(p["pid"], RUSAGE_INFO_V2, ru) == 0:
                p["cpu_ns"] = mac_rusage_cpu(ru.raw, self.numer, self.denom)
            handles = (ctypes.c_uint64 * 4096)()
            size = self.lib.proc_pidinfo(p["pid"], PROC_PIDLISTTHREADS, 0, handles, ctypes.sizeof(handles))
            if size <= 0:
                p["threads_error"] = f"PROC_PIDLISTTHREADS refused (errno {ctypes.get_errno()})"
                continue
            for i in range(size // 8):
                if self.lib.proc_pidinfo(p["pid"], PROC_PIDTHREADINFO, handles[i], ti, THREADINFO_SIZE) == THREADINFO_SIZE:
                    ns, name = mac_threadinfo(ti.raw)
                    p["threads"].append({"tid": handles[i], "name": name or "(unnamed)", "cpu_ns": ns})


# --- Windows: Toolhelp, GetProcessTimes, GetThreadTimes -------------------------------------

FILETIME_EPOCH_MS = 11_644_473_600_000  # 1601-01-01 to 1970-01-01


class Win:
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    THREAD_QUERY_LIMITED_INFORMATION = 0x0800

    def __init__(self):
        from ctypes import wintypes as w

        self.w = w
        self.k32 = ctypes.WinDLL("kernel32", use_last_error=True)

        class Proc32(ctypes.Structure):
            _fields_ = [("dwSize", w.DWORD), ("cntUsage", w.DWORD), ("th32ProcessID", w.DWORD),
                        ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", w.DWORD), ("cntThreads", w.DWORD),
                        ("th32ParentProcessID", w.DWORD), ("pcPriClassBase", w.LONG), ("dwFlags", w.DWORD),
                        ("szExeFile", w.WCHAR * 260)]

        class Thread32(ctypes.Structure):
            _fields_ = [("dwSize", w.DWORD), ("cntUsage", w.DWORD), ("th32ThreadID", w.DWORD),
                        ("th32OwnerProcessID", w.DWORD), ("tpBasePri", w.LONG), ("tpDeltaPri", w.LONG),
                        ("dwFlags", w.DWORD)]

        self.Proc32, self.Thread32 = Proc32, Thread32
        k, P = self.k32, ctypes.POINTER
        for fn, args, res in (("CreateToolhelp32Snapshot", [w.DWORD, w.DWORD], w.HANDLE),
                              ("Process32FirstW", [w.HANDLE, P(Proc32)], w.BOOL),
                              ("Process32NextW", [w.HANDLE, P(Proc32)], w.BOOL),
                              ("Thread32First", [w.HANDLE, P(Thread32)], w.BOOL),
                              ("Thread32Next", [w.HANDLE, P(Thread32)], w.BOOL),
                              ("OpenProcess", [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
                              ("OpenThread", [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
                              ("GetProcessTimes", [w.HANDLE] + [P(w.FILETIME)] * 4, w.BOOL),
                              ("GetThreadTimes", [w.HANDLE] + [P(w.FILETIME)] * 4, w.BOOL),
                              ("QueryFullProcessImageNameW", [w.HANDLE, w.DWORD, w.LPWSTR, P(w.DWORD)], w.BOOL),
                              ("LocalFree", [ctypes.c_void_p], ctypes.c_void_p),
                              ("CloseHandle", [w.HANDLE], w.BOOL)):
            getattr(k, fn).argtypes, getattr(k, fn).restype = args, res
        self.describe = getattr(k, "GetThreadDescription", None)
        if self.describe is not None:
            self.describe.argtypes, self.describe.restype = [w.HANDLE, P(ctypes.c_void_p)], ctypes.c_long

    def _times(self, fn, h) -> tuple[float, int] | None:
        ft = [self.w.FILETIME() for _ in range(4)]
        if not fn(h, *[ctypes.byref(x) for x in ft]):
            return None
        val = [(x.dwHighDateTime << 32) | x.dwLowDateTime for x in ft]
        return val[0] / 10_000 - FILETIME_EPOCH_MS, (val[2] + val[3]) * 100

    def _toolhelp(self, flag: int):
        snap = self.k32.CreateToolhelp32Snapshot(flag, 0)
        if not snap or snap == ctypes.c_void_p(-1).value:
            raise RuntimeError(f"CreateToolhelp32Snapshot failed ({ctypes.get_last_error()})")
        return snap

    def snapshot(self) -> list[dict]:
        snap = self._toolhelp(0x2)  # TH32CS_SNAPPROCESS
        e = self.Proc32()
        e.dwSize = ctypes.sizeof(self.Proc32)
        out = []
        ok = self.k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            h = self.k32.OpenProcess(self.PROCESS_QUERY_LIMITED_INFORMATION, False, e.th32ProcessID) if e.th32ProcessID else None
            if h:
                times = self._times(self.k32.GetProcessTimes, h)
                buf = ctypes.create_unicode_buffer(32768)
                size = self.w.DWORD(len(buf))
                path = buf.value if self.k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)) else ""
                self.k32.CloseHandle(h)
                if times:
                    p = proc(e.th32ProcessID, e.th32ParentProcessID, e.szExeFile, times[0], path)
                    p["cpu_ns"] = times[1]
                    out.append(p)
            ok = self.k32.Process32NextW(snap, ctypes.byref(e))
        self.k32.CloseHandle(snap)
        return out

    def _name(self, h) -> str:
        if self.describe is None:
            return ""
        ptr = ctypes.c_void_p()
        if self.describe(h, ctypes.byref(ptr)) < 0 or not ptr.value:
            return ""
        name = ctypes.wstring_at(ptr.value)
        self.k32.LocalFree(ptr)
        return name

    def fill(self, procs: list[dict]) -> None:
        by = {p["pid"]: p for p in procs}
        snap = self._toolhelp(0x4)  # TH32CS_SNAPTHREAD: every thread in the system
        t = self.Thread32()
        t.dwSize = ctypes.sizeof(self.Thread32)
        ok = self.k32.Thread32First(snap, ctypes.byref(t))
        while ok:
            p = by.get(t.th32OwnerProcessID)
            if p is not None:
                h = self.k32.OpenThread(self.THREAD_QUERY_LIMITED_INFORMATION, False, t.th32ThreadID)
                if h:
                    times = self._times(self.k32.GetThreadTimes, h)
                    if times:
                        p["threads"].append({"tid": t.th32ThreadID, "name": self._name(h) or "(unnamed)", "cpu_ns": times[1]})
                    self.k32.CloseHandle(h)
            ok = self.k32.Thread32Next(snap, ctypes.byref(t))
        self.k32.CloseHandle(snap)


def reader():
    if sys.platform.startswith("linux"):
        return Linux()
    if sys.platform == "darwin":
        return Mac()
    if sys.platform == "win32":
        return Win()
    raise RuntimeError(f"no process reader for {sys.platform}")


def snapshot(exe: str) -> dict:
    r = reader()
    procs = group(r.snapshot(), exe)
    r.fill(procs)
    return {"os": sys.platform, "now_ms": time.time() * 1000, "procs": procs}


def selftest() -> dict:
    """The pure parts on fixed inputs, for ui/test/idle-threads.test.ts (the struct layouts and
    the grouping, which the real readers can only exercise on their own OS)."""
    bsd = bytearray(BSDINFO_SIZE)
    struct.pack_into("<II", bsd, 12, 4321, 1)
    bsd[48:56] = b"WebCont\0"
    bsd[64:93] = b"com.apple.WebKit.WebContent\0\0"
    struct.pack_into("<QQ", bsd, 120, 1_700_000_000, 250_000)
    th = bytearray(THREADINFO_SIZE)
    struct.pack_into("<QQ", th, 0, 3_000_000, 500_000)
    th[48:66] = b"JavaScriptCore\0xyz"
    ru = bytearray(64)
    struct.pack_into("<QQ", ru, 16, 300, 200)
    procs = [
        proc(10, 1, "lecter-app", 1000.0, "/app/lecter-app", 99),
        proc(11, 10, "WebKitWebProcess", 1001.0, "/usr/lib/WebKitWebProcess"),
        proc(12, 11, "child", 1002.0),
        proc(13, 10, "reused-pid", 900.0),  # started before its parent: a reused pid
        proc(14, 1, "com.apple.WebKit.Networking", 1003.0, "", 10),
        proc(15, 1, "com.apple.WebKit.GPU", 1004.0, "", 99),
        proc(16, 1, "com.apple.WebKit.WebContent", 1005.0, "", 77),  # charged to another live app
        proc(77, 1, "other-app", 10.0, "/other/app"),
        proc(18, 1, "unrelated", 1006.0, "", 0),
    ]
    picked = group(procs, "/app/lecter-app", same=lambda a, b: a == b)
    return {
        "bsdinfo": list(mac_bsdinfo(bytes(bsd))),
        "threadinfo": list(mac_threadinfo(bytes(th))),
        "rusage_ns": mac_rusage_cpu(bytes(ru), 125, 3),
        "linux_stat": list(linux_stat("42 (Web (Content)) S 7 0 0")),
        "group": [p["pid"] for p in picked],
    }


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "snapshot":
        print(json.dumps(snapshot(argv[1])))
        return 0
    if argv == ["--selftest"]:
        print(json.dumps(selftest()))
        return 0
    print(__doc__.split("\n\n")[1], file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except RuntimeError as e:
        print(f"idle_threads.py: {e}", file=sys.stderr)
        sys.exit(1)
