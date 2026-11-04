"""The app's processes on Linux, macOS and Windows, for the real-app budgets (14-quality.md#performance-budgets).

    procs.py snapshot <app executable>      one JSON object: the app and its webview processes
    procs.py wait-gone <pid>... [--timeout S]  exits 0 once none of the pids is alive (1 on timeout)

The app is the one process whose executable is <app executable>; the group adds its descendants
and, on macOS, the WebKit XPC services it is responsible for (their parent is launchd). A
process's role is `webview` when its name is the platform webview's (WebKit*, com.apple.WebKit.*,
msedgewebview2.exe) and `app` otherwise. Memory (D-161): every process, Lecter's own included,
counts its proportional share, because shared WebKit and system libraries would otherwise be
counted once per process: Linux PSS (smaps_rollup), macOS phys_footprint, Windows private working
set; the RSS of all is an information line. CPU is user + system time in ns; start is epoch ms.
Each platform's reader is a class with the same `snapshot` method; the pure parts (`group`,
`counted`, the struct layouts) are what tests/perf/test_procs.py checks.
"""

from __future__ import annotations

import ctypes
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import idle_threads  # noqa: E402  (tests/perf/idle_threads.py: F-180's process group)

WEBVIEW = re.compile(r"WebKit|msedgewebview2", re.IGNORECASE)


@dataclass
class Proc:
    pid: int
    ppid: int
    name: str
    start_ms: float
    path: str = ""
    responsible: int = 0  # macOS: the pid this process's resources are charged to (0: unknown)
    rss: int = 0  # bytes
    share: int | None = None  # bytes: PSS / phys_footprint / private working set (None: unreadable)
    cpu_ns: int = 0
    threads: list[dict] = field(default_factory=list)  # Linux: {"tid", "name", "cpu_ns"} per thread
    role: str = ""
    counted: int = 0  # bytes this process adds to the budget


def same_path(a: str, b: str) -> bool:
    return idle_threads.same_path(a, b)


def group(procs: list[Proc], exe: str) -> list[Proc]:
    """The app process for `exe` (exactly one), then its descendants and, on macOS, the WebKit XPC
    services it uses: F-180's grouping (tests/perf/idle_threads.py `group`), so the memory and the
    idle CPU measure the same processes. A child must not have started before its parent."""
    by = {p.pid: p for p in procs}
    picked = idle_threads.group([asdict(p) for p in procs], exe, same=lambda a, b: same_path(a, b))
    out = [by[d["pid"]] for d in picked]
    for p in out:
        p.role = "webview" if WEBVIEW.search(p.name) else "app"
    return out


def counted(p: Proc) -> int:
    """What a process adds to the memory budget (D-161): its proportional share, Lecter's own
    processes and the webview's alike (Linux PSS, macOS phys_footprint, Windows private working
    set). RSS would count the WebKit and system libraries the processes share once per process."""
    if p.share is None:
        raise RuntimeError(f"{p.name}[{p.pid}]: its memory share is unreadable")
    return p.share


# --- Linux: /proc ---------------------------------------------------------------------------


class Linux:
    def __init__(self, root: str = "/proc"):
        self.root = Path(root)
        self.hz = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
        self.readlink = os.readlink  # the tests' fake /proc replaces it (no symlinks needed)

    def _read(self, *parts: str) -> str | None:
        try:
            return self.root.joinpath(*parts).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

    @staticmethod
    def _stat(text: str) -> tuple[str, list[str]]:
        """The command name and the fields after it (fields[0] is field 3, state)."""
        return text[text.index("(") + 1 : text.rindex(")")], text[text.rindex(")") + 2 :].split()

    def _kb(self, text: str | None, key: str) -> int | None:
        m = re.search(rf"^{key}:\s+(\d+) kB$", text or "", re.M)
        return int(m.group(1)) * 1024 if m else None

    def snapshot(self) -> list[Proc]:
        uptime = float((self._read("uptime") or "0").split()[0])
        now = time.time() * 1000
        out = []
        for d in self.root.iterdir():
            if not d.name.isdigit():
                continue
            stat = self._read(d.name, "stat")
            if stat is None:
                continue
            name, f = self._stat(stat)
            try:
                path = str(self.readlink(d / "exe")).removesuffix(" (deleted)")
            except OSError:
                path = ""
            p = Proc(int(d.name), int(f[1]), name, now - (uptime - int(f[19]) / self.hz) * 1000, path)
            p.cpu_ns = (int(f[11]) + int(f[12])) * 1_000_000_000 // self.hz
            out.append(p)
        return out

    def fill(self, procs: list[Proc]) -> None:
        """Memory and threads, read only for the group (smaps_rollup walks the page tables)."""
        for p in procs:
            p.rss = self._kb(self._read(str(p.pid), "status"), "VmRSS") or 0
            p.share = self._kb(self._read(str(p.pid), "smaps_rollup"), "Pss")
            task = self.root / str(p.pid) / "task"
            for tid in sorted(task.iterdir(), key=lambda t: int(t.name)) if task.is_dir() else []:
                stat = self._read(str(p.pid), "task", tid.name, "stat")
                if stat:
                    name, f = self._stat(stat)
                    p.threads.append({"tid": int(tid.name), "name": name, "cpu_ns": (int(f[11]) + int(f[12])) * 1_000_000_000 // self.hz})


# --- macOS: libproc -------------------------------------------------------------------------

PROC_PIDTBSDINFO = 3  # struct proc_bsdinfo, 136 bytes
BSDINFO_SIZE = 136
RUSAGE_INFO_V2 = 2  # struct rusage_info_v2, 160 bytes; ri_phys_footprint at 72
RUSAGE_FOOTPRINT_AT = 72


def mac_bsdinfo(buf: bytes) -> tuple[int, int, str, float]:
    """(pid, ppid, name, start epoch ms) from a struct proc_bsdinfo: 12 uint32 (pbi_pid at 12,
    pbi_ppid at 16), pbi_comm[16] at 48, pbi_name[32] at 64, then pbi_start_tvsec and
    pbi_start_tvusec (uint64) at 120 and 128."""
    import struct

    pid, ppid = struct.unpack_from("<II", buf, 12)
    comm = buf[48:64].split(b"\0", 1)[0].decode("utf-8", "replace")
    name = buf[64:96].split(b"\0", 1)[0].decode("utf-8", "replace") or comm
    sec, usec = struct.unpack_from("<QQ", buf, 120)
    return pid, ppid, name, sec * 1000 + usec / 1000


def mac_footprint(buf: bytes) -> int:
    import struct

    return struct.unpack_from("<Q", buf, RUSAGE_FOOTPRINT_AT)[0]


def ps_time_ns(text: str) -> int:
    """`ps -o time` ([[dd-]hh:]mm:ss.cc) in ns."""
    days, _, rest = text.strip().rpartition("-")
    parts = [float(x) for x in rest.split(":")]
    seconds = 0.0
    for x in parts:
        seconds = seconds * 60 + x
    return round((seconds + (int(days) * 86400 if days else 0)) * 1e9)


class Mac:
    def __init__(self):
        self.lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        c = ctypes
        for fn, args in (("proc_listallpids", [c.c_void_p, c.c_int]),
                         ("proc_pidinfo", [c.c_int, c.c_int, c.c_uint64, c.c_void_p, c.c_int]),
                         ("proc_pidpath", [c.c_int, c.c_void_p, c.c_uint32]),
                         ("proc_pid_rusage", [c.c_int, c.c_int, c.c_void_p])):
            getattr(self.lib, fn).argtypes, getattr(self.lib, fn).restype = args, c.c_int
        self.responsible = getattr(self.lib, "responsibility_get_pid_responsible_for_pid", None)
        if self.responsible is not None:
            self.responsible.restype = ctypes.c_int
            self.responsible.argtypes = [ctypes.c_int]

    def _pids(self) -> list[int]:
        n = self.lib.proc_listallpids(None, 0)
        buf = (ctypes.c_int * (n + 256))()
        n = self.lib.proc_listallpids(buf, ctypes.sizeof(buf))
        return [buf[i] for i in range(max(n, 0)) if buf[i] > 0]

    def snapshot(self) -> list[Proc]:
        out = []
        info = ctypes.create_string_buffer(BSDINFO_SIZE)
        path = ctypes.create_string_buffer(4096)
        for pid in self._pids():
            if self.lib.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, BSDINFO_SIZE) != BSDINFO_SIZE:
                continue  # gone, or not ours
            _, ppid, name, start = mac_bsdinfo(info.raw)
            n = self.lib.proc_pidpath(pid, path, ctypes.sizeof(path))
            p = Proc(pid, ppid, name, start, path.raw[:n].decode("utf-8", "replace") if n > 0 else "")
            if p.path:
                p.name = os.path.basename(p.path)
            p.responsible = self.responsible(pid) if self.responsible is not None else 0
            out.append(p)
        return out

    def fill(self, procs: list[Proc]) -> None:
        ru = ctypes.create_string_buffer(512)
        for p in procs:
            if self.lib.proc_pid_rusage(p.pid, RUSAGE_INFO_V2, ru) == 0:
                p.share = mac_footprint(ru.raw)
        ps = subprocess.run(["ps", "-o", "pid=,rss=,time=", "-p", ",".join(str(p.pid) for p in procs)],
                            capture_output=True, text=True, check=False).stdout
        by = {p.pid: p for p in procs}
        for row in ps.splitlines():
            cols = row.split()
            if len(cols) == 3 and int(cols[0]) in by:
                by[int(cols[0])].rss = int(cols[1]) * 1024
                by[int(cols[0])].cpu_ns = ps_time_ns(cols[2])


# --- Windows: Toolhelp, GetProcessTimes, GetProcessMemoryInfo -------------------------------

FILETIME_EPOCH_MS = 11_644_473_600_000  # 1601-01-01 to 1970-01-01


def filetime_ms(ticks_100ns: int) -> float:
    return ticks_100ns / 10_000 - FILETIME_EPOCH_MS


class Win:
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    PROCESS_VM_READ = 0x0010

    def __init__(self):
        from ctypes import wintypes as w

        self.w = w
        self.k32 = ctypes.WinDLL("kernel32", use_last_error=True)

        class Entry(ctypes.Structure):
            _fields_ = [("dwSize", w.DWORD), ("cntUsage", w.DWORD), ("th32ProcessID", w.DWORD),
                        ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", w.DWORD), ("cntThreads", w.DWORD),
                        ("th32ParentProcessID", w.DWORD), ("pcPriClassBase", w.LONG), ("dwFlags", w.DWORD),
                        ("szExeFile", w.WCHAR * 260)]

        class Counters(ctypes.Structure):  # PROCESS_MEMORY_COUNTERS_EX2
            _fields_ = [("cb", w.DWORD), ("PageFaultCount", w.DWORD)] + [
                (n, ctypes.c_size_t) for n in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                                               "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage",
                                               "PagefileUsage", "PeakPagefileUsage", "PrivateUsage",
                                               "PrivateWorkingSetSize", "SharedCommitUsage")]

        self.Entry, self.Counters = Entry, Counters
        k, P = self.k32, ctypes.POINTER
        for fn, args, res in (("CreateToolhelp32Snapshot", [w.DWORD, w.DWORD], w.HANDLE),
                              ("Process32FirstW", [w.HANDLE, P(Entry)], w.BOOL),
                              ("Process32NextW", [w.HANDLE, P(Entry)], w.BOOL),
                              ("OpenProcess", [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
                              ("GetProcessTimes", [w.HANDLE] + [P(w.FILETIME)] * 4, w.BOOL),
                              ("QueryFullProcessImageNameW", [w.HANDLE, w.DWORD, w.LPWSTR, P(w.DWORD)], w.BOOL),
                              ("K32GetProcessMemoryInfo", [w.HANDLE, P(Counters), w.DWORD], w.BOOL),
                              ("CloseHandle", [w.HANDLE], w.BOOL)):
            getattr(k, fn).argtypes, getattr(k, fn).restype = args, res

    def _open(self, pid: int, extra: int = 0):
        return self.k32.OpenProcess(self.PROCESS_QUERY_LIMITED_INFORMATION | extra, False, pid)

    def _times(self, h) -> tuple[float, int] | None:
        ft = [self.w.FILETIME() for _ in range(4)]
        if not self.k32.GetProcessTimes(h, *[ctypes.byref(x) for x in ft]):
            return None
        val = [(x.dwHighDateTime << 32) | x.dwLowDateTime for x in ft]
        return filetime_ms(val[0]), (val[2] + val[3]) * 100  # creation; kernel + user in ns

    def snapshot(self) -> list[Proc]:
        snap = self.k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
        if not snap or snap == ctypes.c_void_p(-1).value:
            raise RuntimeError(f"CreateToolhelp32Snapshot failed ({ctypes.get_last_error()})")
        entry = self.Entry()
        entry.dwSize = ctypes.sizeof(self.Entry)
        out = []
        ok = self.k32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            pid = entry.th32ProcessID
            h = self._open(pid) if pid else None
            if h:
                times = self._times(h)
                buf = ctypes.create_unicode_buffer(32768)
                size = self.w.DWORD(len(buf))
                path = buf.value if self.k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)) else ""
                self.k32.CloseHandle(h)
                if times:
                    p = Proc(pid, entry.th32ParentProcessID, entry.szExeFile, times[0], path)
                    p.cpu_ns = times[1]
                    out.append(p)
            ok = self.k32.Process32NextW(snap, ctypes.byref(entry))
        self.k32.CloseHandle(snap)
        return out

    def fill(self, procs: list[Proc]) -> None:
        for p in procs:
            h = self._open(p.pid, self.PROCESS_VM_READ)
            if not h:
                continue
            c = self.Counters()
            c.cb = ctypes.sizeof(self.Counters)
            if self.k32.K32GetProcessMemoryInfo(h, ctypes.byref(c), c.cb):
                p.rss, p.share = c.WorkingSetSize, c.PrivateWorkingSetSize
            times = self._times(h)
            if times:
                p.cpu_ns = times[1]
            self.k32.CloseHandle(h)


def reader():
    if sys.platform.startswith("linux"):
        return Linux()
    if sys.platform == "darwin":
        return Mac()
    if sys.platform == "win32":
        return Win()
    raise RuntimeError(f"no process reader for {sys.platform}")


def snapshot(exe: str, r=None) -> dict:
    r = r or reader()
    every = r.snapshot()
    procs = group(every, exe)
    r.fill(procs)
    for p in procs:
        p.counted = counted(p)
    mine = {p.pid for p in procs}
    # Webview-named processes left out of the group, so a measurement that misses one says why.
    others = [{"pid": p.pid, "ppid": p.ppid, "name": p.name, "responsible": p.responsible,
               "after_app_ms": round(p.start_ms - procs[0].start_ms)}
              for p in every if p.pid not in mine and WEBVIEW.search(p.name)]
    return {"os": sys.platform, "now_ms": time.time() * 1000, "procs": [asdict(p) for p in procs], "others": others}


def alive(pids: set[int], r=None) -> set[int]:
    return {p.pid for p in (r or reader()).snapshot()} & pids


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "snapshot":
        print(json.dumps(snapshot(argv[1])))
        return 0
    if argv and argv[0] == "wait-gone":
        timeout = 30.0
        if "--timeout" in argv:
            i = argv.index("--timeout")
            timeout = float(argv[i + 1])
            argv = argv[:i] + argv[i + 2 :]
        pids = {int(x) for x in argv[1:]}
        deadline = time.monotonic() + timeout
        r = reader()
        while (left := alive(pids, r)) and time.monotonic() < deadline:
            time.sleep(0.2)  # a deadline poll, not a sync: the OS has no "process ended" event for others' pids
        if left:
            print(f"still alive after {timeout:.0f} s: {sorted(left)}", file=sys.stderr)
            return 1
        return 0
    print(__doc__.split("\n\n")[0], file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except RuntimeError as e:
        print(f"procs.py: {e}", file=sys.stderr)
        sys.exit(1)
