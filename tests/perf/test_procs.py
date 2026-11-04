"""Tests of the real-app process reader (tests/perf/app/procs.py) and result collector
(tests/perf/app/collect.py), F-025 criterion 6 (D-161): every process, Lecter's own included,
counts its share (Linux PSS, macOS phys_footprint, Windows private working set); the
group is the app, its descendants and on macOS the WebKit services it is responsible for. The
Linux reader runs on a fake /proc; the macOS and Windows struct layouts are checked on packed
bytes laid out as their headers declare them (the CI dispatch run checks them on the real OS)."""

import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "app"))
import collect  # noqa: E402
import procs  # noqa: E402
from procs import Proc  # noqa: E402

APP = "/opt/lecter/lecter-app"


def proc(pid, ppid, name, start=1000.0, path="", responsible=0, rss=0, share=None) -> Proc:
    return Proc(pid, ppid, name, start, path, responsible, rss, share)


class Group(unittest.TestCase):
    def setUp(self):
        self.same = procs.same_path
        procs.same_path = lambda a, b: a == b  # the paths here don't exist on disk

    def tearDown(self):
        procs.same_path = self.same

    def test_the_app_its_descendants_and_what_it_is_responsible_for(self):
        ps = [proc(1, 0, "launchd", 0), proc(10, 1, "lecter-app", 1000, APP), proc(11, 10, "WebKitWebProcess", 1100),
              proc(12, 11, "helper", 1200), proc(20, 1, "com.apple.WebKit.WebContent", 1300, responsible=10),
              proc(30, 1, "com.apple.WebKit.WebContent", 1300, responsible=40), proc(40, 1, "Safari", 50)]
        g = procs.group(ps, APP)
        self.assertEqual([p.pid for p in g][0], 10)
        self.assertEqual(sorted(p.pid for p in g), [10, 11, 12, 20])
        self.assertEqual({p.pid: p.role for p in g}, {10: "app", 11: "webview", 12: "app", 20: "webview"})

    def test_macos_webkit_services_nobody_else_claims_are_adopted_if_started_after_the_app(self):
        # The responsible-pid lookup may name nobody (0), launchd, the service itself or a gone pid.
        ps = [proc(1, 0, "launchd", 0), proc(10, 1, "lecter-app", 1000, APP), proc(40, 1, "Safari", 50),
              proc(21, 1, "com.apple.WebKit.WebContent", 1100), proc(22, 1, "com.apple.WebKit.Networking", 1100, responsible=1),
              proc(23, 1, "com.apple.WebKit.GPU", 1100, responsible=23), proc(24, 1, "com.apple.WebKit.WebContent", 1100, responsible=77),
              proc(25, 1, "com.apple.WebKit.WebContent", 999),  # started before the app
              proc(26, 1, "com.apple.WebKit.WebContent", 1100, responsible=40),  # Safari's
              proc(27, 1, "mdworker", 1100), proc(28, 5, "com.apple.WebKit.WebContent", 1100)]  # not launchd's
        self.assertEqual(sorted(p.pid for p in procs.group(ps, APP)), [10, 21, 22, 23, 24])

    def test_macos_webkit_services_charged_to_the_apps_own_responsible_process_are_adopted(self):
        # CI run 41705588536: the app and its services were all charged to the launcher (915).
        ps = [proc(1, 0, "launchd", 0), proc(915, 1, "Runner.Worker", 10), proc(900, 915, "node", 20),
              proc(10, 900, "lecter-app", 1000, APP, responsible=915),
              proc(21, 1, "com.apple.WebKit.WebContent", 1186, responsible=915),
              proc(22, 1, "com.apple.WebKit.Networking", 1212, responsible=915),
              proc(23, 1, "com.apple.WebKit.WebContent", 900, responsible=915),  # an earlier launch's
              proc(24, 1, "mdworker", 1100, responsible=915)]  # not a WebKit service
        self.assertEqual(sorted(p.pid for p in procs.group(ps, APP)), [10, 21, 22])

    def test_a_reused_pid_older_than_its_parent_is_not_a_child(self):
        ps = [proc(10, 1, "lecter-app.exe", 1000, APP), proc(11, 10, "msedgewebview2.exe", 999),
              proc(12, 10, "msedgewebview2.exe", 1001)]
        self.assertEqual([p.pid for p in procs.group(ps, APP)], [10, 12])

    def test_none_or_two_app_processes_is_an_error(self):
        with self.assertRaisesRegex(RuntimeError, "found 0"):
            procs.group([proc(10, 1, "other", path="/bin/other")], APP)
        with self.assertRaisesRegex(RuntimeError, "found 2"):
            procs.group([proc(10, 1, "a", path=APP), proc(11, 1, "b", path=APP)], APP)

    def test_every_process_counts_its_share_lecters_own_included(self):
        # D-161: Lecter's processes count their share too, not their RSS (which double-counts the
        # pages they share with the web processes).
        app = proc(10, 1, "lecter-app", rss=100, share=60)
        app.role = "app"
        web = proc(11, 10, "WebKitWebProcess", rss=300, share=120)
        web.role = "webview"
        self.assertEqual((procs.counted(app), procs.counted(web)), (60, 120))
        for p in (app, web):
            p.share = None
            with self.assertRaisesRegex(RuntimeError, "unreadable"):
                procs.counted(p)

    def test_the_group_is_the_one_the_idle_cpu_measure_uses(self):
        # The memory and F-180's idle CPU (tests/perf/idle_threads.py) measure the same processes.
        ps = [proc(1, 0, "launchd", 0), proc(10, 1, "lecter-app", 1000, APP, responsible=915),
              proc(11, 10, "WebKitWebProcess", 1100), proc(13, 10, "reused", 900),
              proc(21, 1, "com.apple.WebKit.WebContent", 1186, responsible=915), proc(40, 1, "Safari", 50),
              proc(26, 1, "com.apple.WebKit.WebContent", 1100, responsible=40)]
        ours = [p.pid for p in procs.group(ps, APP)]
        theirs = [d["pid"] for d in procs.idle_threads.group([procs.asdict(p) for p in ps], APP, same=lambda a, b: a == b)]
        self.assertEqual(ours, theirs)
        self.assertEqual(sorted(ours), [10, 11, 21])


class FakeProc:
    """A /proc with the files the Linux reader reads."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="lecter-fakeproc-"))
        (self.root / "uptime").write_text("1000.00 50.00\n")
        self.exe_dir = self.root / "bin"
        self.exe_dir.mkdir()

    def add(self, pid, ppid, comm, start_ticks, utime, stime, rss_kb, pss_kb, exe, threads=()):
        d = self.root / str(pid)
        (d / "task").mkdir(parents=True)
        rest = ["S", str(ppid)] + ["0"] * 9 + [str(utime), str(stime)] + ["0"] * 6 + [str(start_ticks)] + ["0"] * 20
        (d / "stat").write_text(f"{pid} ({comm}) {' '.join(rest)}\n")
        (d / "status").write_text(f"Name:\t{comm}\nVmRSS:\t{rss_kb} kB\nThreads:\t1\n")
        (d / "smaps_rollup").write_text(f"00400000-ffffffff ---p 00000000 00:00 0 [rollup]\nRss:  {rss_kb} kB\nPss:  {pss_kb} kB\n")
        target = self.exe_dir / exe
        target.touch()
        (d / "exe").write_text(str(target))  # the link target; the test reads it in place of readlink
        for tid, name, u in threads:
            (d / "task" / str(tid)).mkdir()
            trest = ["S", str(ppid)] + ["0"] * 9 + [str(u), "0"] + ["0"] * 27
            (d / "task" / str(tid) / "stat").write_text(f"{tid} ({name}) {' '.join(trest)}\n")
        return str(target)


class LinuxReader(unittest.TestCase):
    def test_reads_tree_memory_cpu_threads_and_start_from_proc(self):
        fake = FakeProc()
        app = fake.add(10, 1, "lecter-app", 90_000, 150, 50, 200_000, 120_000, "lecter-app", [(10, "main", 150), (13, "tokio-rt", 7)])
        fake.add(11, 10, "WebKitWebProces", 90_100, 1000, 0, 300_000, 180_000, "WebKitWebProcess")
        fake.add(12, 1, "lecter-app", 1, 0, 0, 1, 1, "other-lecter")  # same name, another executable
        r = procs.Linux(str(fake.root))
        r.readlink = lambda p: Path(p).read_text()
        r.hz = 100
        snap = procs.snapshot(app, r)
        by = {p["pid"]: p for p in snap["procs"]}
        self.assertEqual(sorted(by), [10, 11])
        self.assertEqual((by[10]["role"], by[10]["rss"], by[10]["share"], by[10]["counted"]), ("app", 204_800_000, 122_880_000, 122_880_000))
        self.assertEqual((by[11]["role"], by[11]["counted"]), ("webview", 184_320_000))
        self.assertEqual((by[10]["cpu_ns"], by[11]["cpu_ns"]), (2_000_000_000, 10_000_000_000))
        self.assertEqual(by[10]["threads"], [{"tid": 10, "name": "main", "cpu_ns": 1_500_000_000},
                                             {"tid": 13, "name": "tokio-rt", "cpu_ns": 70_000_000}])
        # Started 900 s after boot, 100 s before "now" (uptime 1000 s): within the run's clock.
        self.assertAlmostEqual(snap["now_ms"] - by[10]["start_ms"], 100_000, delta=1000)
        self.assertAlmostEqual(by[11]["start_ms"] - by[10]["start_ms"], 1000, delta=1)
        self.assertEqual(procs.alive({10, 11, 99}, r), {10, 11})


class MacAndWindowsLayouts(unittest.TestCase):
    def test_proc_bsdinfo_fields_at_their_offsets(self):
        buf = bytearray(procs.BSDINFO_SIZE)
        struct.pack_into("<12I", buf, 0, 0, 2, 0, 4242, 1, 501, 20, 501, 20, 501, 20, 0)
        buf[48:56] = b"lecter-a"
        buf[64:91] = b"com.apple.WebKit.WebContent"
        struct.pack_into("<QQ", buf, 120, 1_793_000_000, 250_000)
        self.assertEqual(procs.mac_bsdinfo(bytes(buf)), (4242, 1, "com.apple.WebKit.WebContent", 1_793_000_000_250.0))
        buf[64:96] = bytes(32)
        self.assertEqual(procs.mac_bsdinfo(bytes(buf))[2], "lecter-a")

    def test_rusage_v2_phys_footprint_after_eight_counters(self):
        buf = bytearray(160)
        struct.pack_into("<16x8Q", buf, 0, 1, 2, 3, 4, 5, 6, 7, 123_456_789)
        self.assertEqual(procs.mac_footprint(bytes(buf)), 123_456_789)

    def test_ps_cpu_time_and_windows_filetime(self):
        self.assertEqual(procs.ps_time_ns("0:01.25"), 1_250_000_000)
        self.assertEqual(procs.ps_time_ns("12:00.00"), 720_000_000_000)
        self.assertEqual(procs.ps_time_ns("1:00:00.50"), 3_600_500_000_000)
        self.assertEqual(procs.ps_time_ns("2-00:00:01.00"), 172_801_000_000_000)
        self.assertEqual(procs.filetime_ms(116_444_736_000_000_000), 0)
        self.assertAlmostEqual(procs.filetime_ms(116_444_736_000_000_000 + 12_345_670), 1234.567, delta=0.01)


class Collect(unittest.TestCase):
    def test_one_line_per_id_samples_for_several_and_an_error_for_none(self):
        lines = ['{"id": "cold_open_ms", "value": 480, "detail": "run 1"}', "not json",
                 '{"id": "cold_open_ms", "value": 470.5, "detail": "run 2"}', '{"id": "idle_rss_mb", "value": 400, "detail": "d"}',
                 '{"id": "idle_cpu_pct", "error": "x"}', '{"id": "other", "value": 1}']
        out = {r["id"]: r for r in collect.collect(lines, ["cold_open_ms", "idle_rss_mb", "idle_cpu_pct"])}
        self.assertEqual(out["cold_open_ms"], {"id": "cold_open_ms", "samples": [480, 470.5], "details": ["run 1", "run 2"]})
        self.assertEqual(out["idle_rss_mb"], {"id": "idle_rss_mb", "value": 400, "detail": "d"})
        self.assertIn("measured nothing", out["idle_cpu_pct"]["error"])
        self.assertEqual(len(out), 3)


if __name__ == "__main__":
    unittest.main()
