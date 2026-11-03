"""Tests of tests/perf/budgets.sh's per-OS and real-app rules (F-025 criteria 1, 2, 6 and 7;
14-quality.md#performance-budgets, D-146, D-152, D-155, D-156): memory and cold_open_ms targets
per OS, an OS without a target prints REPORT, the real-app keystroke and cold-open values print
REPORT under --ci (the mocked-core quick check gates instead) and gate without it, cold_open_ms
gates the median of 5 launches at x1 against the maintainer's local target."""

import json
import re
import unittest

from test_budgets import FIXED, HERE, TIMED, Run, spec_rows

# The CI runner's cold-open target on Linux: median 973 + 10 %, rounded up to the next 10 ms (D-152).
COLD_OPEN_CI_LINUX = 1080
# The maintainer's machine: the F-179 harness median of 442 ms + 10 %, rounded up (D-155, D-156).
COLD_OPEN_LOCAL_LINUX = 490


def target_from(measured: float, step: int) -> int:
    """First measurement + 10 %, rounded up to the next `step` (D-146 MB, D-152 ms)."""
    return int(-(-round(measured * 1.1, 6) // step) * step)


def budget(bid="b_mb", value=100, kind="memory", script=FIXED, **kw) -> dict:
    return {"id": bid, "budget": value, "cmp": "lt", "unit": "x", "kind": kind, "from": "M0.5", "script": script, **kw}


def values(**by_id) -> dict:
    return {"PERF_FIXTURE_VALUES": json.dumps(by_id)}


class BudgetsFilePerOs(unittest.TestCase):
    def setUp(self):
        self.listed = {b["id"]: b for b in json.loads((HERE / "budgets.json").read_text())["budgets"]}

    def test_memory_and_cold_open_have_per_os_targets_with_the_linux_ones_from_the_spec(self):
        rows = spec_rows()
        for bid, linux in (("idle_rss_mb", 460), ("rss_300_slides_mb", 500)):
            with self.subTest(budget=bid):
                self.assertRegex(rows[bid], rf"Linux < {linux} MB")
                self.assertEqual(self.listed[bid]["per_os"]["linux"], linux)
                # D-139's PSS measurements give the same targets by the spec's rule.
        self.assertEqual((target_from(414.6, 10), target_from(450.7, 10)), (460, 500))
        cold = self.listed["cold_open_ms"]
        self.assertEqual(cold["per_os"]["linux"], COLD_OPEN_CI_LINUX)
        self.assertEqual(target_from(973, 10), COLD_OPEN_CI_LINUX)
        self.assertEqual(cold["local"], {"linux": COLD_OPEN_LOCAL_LINUX})
        self.assertEqual(target_from(442, 10), COLD_OPEN_LOCAL_LINUX)
        self.assertEqual((cold["median_of"], cold["budget"]), (5, 400))
        for bid in ("idle_rss_mb", "rss_300_slides_mb", "cold_open_ms"):
            with self.subTest(budget=bid):
                self.assertLessEqual(set(self.listed[bid]["per_os"]), {"linux", "darwin", "win32"})
                for os_name, t in self.listed[bid]["per_os"].items():
                    self.assertEqual(t % 10, 0, f"{os_name}: targets are rounded up to the next 10")

    def test_keystroke_and_cold_open_report_under_ci_and_nothing_else_does(self):
        self.assertEqual({k for k, b in self.listed.items() if b.get("on_ci") == "report"}, {"keystroke_p99_ms", "cold_open_ms"})
        self.assertEqual(self.listed["keystroke_p99_ms"]["quick"], "tests/perf/measure/keystroke_mock.py")
        self.assertNotIn("quick", self.listed["cold_open_ms"])


class PerOsGate(unittest.TestCase):
    def test_the_target_is_this_oss_and_an_os_without_one_reports_and_passes(self):
        b = [budget(per_os={"linux": 460, "darwin": 300})]
        for os_name, v, code, status in (("linux", 459, 0, "pass"), ("linux", 460, 1, "fail"), ("darwin", 301, 1, "fail"),
                                         ("darwin", 299, 0, "pass"), ("win32", 9999, 0, "report")):
            with self.subTest(os=os_name, value=v):
                run = Run(b, env=values(b_mb=[v]))
                r = run("--os", os_name, "--ci")
                self.assertEqual(r.returncode, code, r.stdout)
                self.assertEqual(run.entries()["b_mb"]["status"], status)
        r = Run(b, env=values(b_mb=[9999]))("--os", "win32")
        self.assertRegex(r.stdout, r"(?m)^REPORT b_mb 9999 \(no win32 target in per_os yet\)$")
        self.assertRegex(r.stdout, r"(?m)^PERF OK$")
        r = Run(b, env=values(b_mb=[459]))("--os", "linux")
        self.assertRegex(r.stdout, r"(?m)^PASS b_mb 459 / 460$")

    def test_per_os_memory_is_exact_under_ci(self):
        run = Run([budget(per_os={"linux": 460})], env=values(b_mb=[460.01]))
        r = run("--os", "linux", "--ci")
        self.assertEqual((r.returncode, run.calls()), (1, 1), r.stdout)
        self.assertEqual(run.entries()["b_mb"]["limit"], 460)

    def test_bad_per_os_tables_are_usage_errors(self):
        for table in ({"plan9": 1}, {"linux": 0}, {"linux": "460"}, [460]):
            with self.subTest(table=table):
                self.assertEqual(Run([budget(per_os=table)])().returncode, 2)
        self.assertEqual(Run([budget(on_ci="skip")])().returncode, 2)
        self.assertEqual(Run([budget(median_of=0)])().returncode, 2)
        self.assertEqual(Run([budget(local={"darwin": -1})])().returncode, 2)


class RealAppReportsOnCi(unittest.TestCase):
    """keystroke_p99_ms: the real-app value REPORTs under --ci and the quick check gates (D-146)."""

    def keystroke(self) -> list[dict]:
        return [budget("k_ms", 8, kind="timing", script=FIXED, quick=TIMED, on_ci="report")]

    def test_under_ci_a_slow_real_app_value_reports_and_the_quick_check_gates(self):
        run = Run(self.keystroke(), env=values(k_ms=[40]))
        r = run("--ci")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^REPORT k_ms 40 / 8 \(real app under --ci: reported, never fails; the quick check gates\)$")
        self.assertRegex(r.stdout, r"(?m)^PASS k_ms \d+(?:\.\d+)? / 12 \(8 x1\.5 CI allowance\)  \[quick check ")
        # A deliberately slowed quick check fails, measured twice under --ci.
        slow = Run(self.keystroke(), env={**values(k_ms=[1]), "PERF_FIXTURE_DELAY_MS": "250"})
        r = slow("--ci")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^REPORT k_ms 1 / 8 ")
        self.assertRegex(r.stdout, r"(?m)^FAIL k_ms \d{3,}(?:\.\d+)?, \d{3,}(?:\.\d+)? / 12 ")
        report = json.loads(slow.report.read_text())["budgets"]
        self.assertEqual([(e["source"], e["status"]) for e in report], [("script", "report"), ("quick", "fail")])
        self.assertTrue(all(v >= 250 for v in report[1]["values"]), report[1]["values"])

    def test_without_ci_the_real_app_value_gates_at_x1_and_the_quick_check_does_not_run(self):
        for v, code, status in ((7.9, 0, "PASS"), (8.5, 1, "FAIL")):
            with self.subTest(value=v):
                run = Run(self.keystroke(), env={**values(k_ms=[v]), "PERF_FIXTURE_DELAY_MS": "250"})
                r = run()
                self.assertEqual(r.returncode, code, r.stdout)
                self.assertEqual(re.findall(r"(?m)^\w+ k_ms .*$", r.stdout), [f"{status} k_ms {v} / 8"])

    def test_quick_runs_only_the_quick_check(self):
        run = Run(self.keystroke(), env={**values(k_ms=[40]), "PERF_FIXTURE_DELAY_MS": "250"})
        r = run("--quick")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^FAIL k_ms \d{3,}(?:\.\d+)? / 8$")
        self.assertNotIn("REPORT", r.stdout)


class ColdOpen(unittest.TestCase):
    """cold_open_ms: the median of 5 gated at x1 against the local target, REPORT under --ci."""

    def cold(self, **kw) -> list[dict]:
        return [budget("c_ms", 400, kind="timing", on_ci="report", median_of=5,
                       per_os={"linux": COLD_OPEN_CI_LINUX}, local={"linux": COLD_OPEN_LOCAL_LINUX}, **kw)]

    def test_locally_the_median_of_5_gates_at_x1_against_the_local_target(self):
        cases = (([489, 900, 300, 480, 470], 0, "pass"), ([490, 900, 300, 495, 470], 1, "fail"),
                 ([491, 491, 491, 491, 491], 1, "fail"))
        for samples, code, status in cases:
            with self.subTest(samples=samples):
                run = Run(self.cold(), env=values(c_ms=[samples]))
                r = run("--os", "linux")
                self.assertEqual((r.returncode, run.calls()), (code, 1), r.stdout)
                e = run.entries()["c_ms"]
                self.assertEqual((e["status"], e["limit"], e["samples"]), (status, COLD_OPEN_LOCAL_LINUX, [samples]))
        r = Run(self.cold(), env=values(c_ms=[[489, 900, 300, 480, 470]]))("--os", "linux")
        self.assertRegex(r.stdout, r"(?m)^PASS c_ms 480 \(median of 489 900 300 480 470\) / 490$")

    def test_under_ci_it_reports_even_over_the_ci_runner_target_and_is_not_re_measured(self):
        run = Run(self.cold(), env=values(c_ms=[[5000, 5000, 5000, 5000, 5000]]))
        r = run("--ci", "--os", "linux")
        self.assertEqual((r.returncode, run.calls()), (0, 1), r.stdout)
        self.assertRegex(r.stdout, r"(?m)^REPORT c_ms 5000 \(median of 5000 5000 5000 5000 5000\) / 1080 \(real app under --ci: reported, never fails; it gates locally\)$")

    def test_an_os_without_a_local_target_reports(self):
        run = Run(self.cold(), env=values(c_ms=[[5000, 5000, 5000, 5000, 5000]]))
        r = run("--os", "darwin")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^REPORT c_ms 5000 \(median of .*\) \(no darwin target in local yet\)$")

    def test_fewer_than_5_launches_or_a_single_value_is_no_measurement(self):
        for given in ([[400, 410, 420, 430]], [400]):
            with self.subTest(given=given):
                run = Run(self.cold(), env=values(c_ms=given))
                r = run("--os", "linux")
                self.assertEqual(r.returncode, 1, r.stdout)
                self.assertRegex(r.stdout, r"(?m)^FAIL c_ms \(no measurement: needs the median of 5, got (4 samples|no samples)")


class BundleCountsAllJs(unittest.TestCase):
    """ui_main_chunk_kb_gz counts the entry and every chunk, lazy ones too, each gzipped."""

    def test_the_sum_of_every_js_file_gzipped_on_its_own(self):
        import random
        import sys
        import tempfile
        import zlib
        from pathlib import Path

        sys.path.insert(0, str(HERE / "measure"))
        import bundle  # noqa: PLC0415

        dist = Path(tempfile.mkdtemp(prefix="lecter-dist-"))
        (dist / "assets" / "lazy").mkdir(parents=True)
        (dist / "index.html").write_text('<script type="module" crossorigin src="/assets/index-a.js"></script>')
        rnd = random.Random(7)
        files = {"assets/index-a.js": 3000, "assets/editor-b.js": 9000, "assets/lazy/c.mjs": 500}
        expected = 0
        for rel, n in files.items():
            data = bytes(rnd.randrange(256) for _ in range(n))  # incompressible: gzip adds a header
            (dist / rel).write_bytes(data)
            c = zlib.compressobj(6, zlib.DEFLATED, 31)
            expected += len(c.compress(data) + c.flush())
        (dist / "assets" / "style.css").write_text("body{}" * 1000)  # not JavaScript
        kb, detail = bundle.measured(dist)
        self.assertAlmostEqual(kb, expected / 1000, places=6)
        self.assertGreater(kb, 12.5)  # all three, not the entry's ~3 KB alone
        self.assertIn("3 JS files", detail)
        self.assertIn("entry index-a.js", detail)
        (dist / "index.html").write_text("<p>no module</p>")
        with self.assertRaisesRegex(RuntimeError, "expected one entry module"):
            bundle.measured(dist)


if __name__ == "__main__":
    unittest.main()
