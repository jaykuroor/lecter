"""Tests of budgets.sh on shared VM runners (F-181, D-225; 14-quality.md#performance-budgets): with
--ci the real-app cold_open_ms, rss_300_slides_mb and idle_rss_mb print REPORT with the measured
value and never fail, on every OS, and so does the macOS mocked-core keystroke check; without --ci
they gate against their targets, and the Linux keystroke check still gates at 8 ms with the x1.5
rule. Run on tests/perf/budgets.json itself, its measurement scripts swapped for scripted values,
so the real entries and targets are what is checked."""

import json
import re
import unittest

from test_budgets import FIXED, HERE, TIMED, Run

OSES = ("linux", "darwin", "win32")
VM_REPORT = ("cold_open_ms", "rss_300_slides_mb", "idle_rss_mb")
# Far over every target in budgets.json, on every OS.
OVER = {"cold_open_ms": [[5000, 5100, 4900, 5000, 5000]], "rss_300_slides_mb": [9999], "idle_rss_mb": [8888],
        "idle_cpu_pct": [9], "ttft_overhead_ms": [900]}


def listed(*ids: str, **overrides: dict) -> list[dict]:
    """The entries `ids` of tests/perf/budgets.json, measured by the scripted fixture instead."""
    by = {b["id"]: b for b in json.loads((HERE / "budgets.json").read_text())["budgets"]}
    out = []
    for bid in ids:
        e = {**by[bid], "script": FIXED, **overrides.get(bid, {})}
        if "quick" in e and bid not in overrides:
            e.pop("quick")
        out.append(e)
    return out


def scripted(**by_id) -> dict:
    return {"PERF_FIXTURE_VALUES": json.dumps(by_id)}


class RealAppMemoryAndColdOpenReportOnCi(unittest.TestCase):
    """Criterion 1: REPORT with the value under --ci on every OS; a gate without it."""

    def test_under_ci_each_reports_its_measured_value_and_exits_zero_on_every_os(self):
        for os_name in OSES:
            with self.subTest(os=os_name):
                run = Run(listed(*VM_REPORT), env=scripted(**OVER))
                r = run("--ci", "--os", os_name)
                self.assertEqual((r.returncode, run.calls()), (0, 1), r.stdout)
                self.assertRegex(r.stdout, r"(?m)^REPORT cold_open_ms 5000 \(median of 5000 5100 4900 5000 5000\) ")
                self.assertRegex(r.stdout, r"(?m)^REPORT rss_300_slides_mb 9999 / \d+ \(real app under --ci: reported, never fails; it gates locally\)$")
                self.assertRegex(r.stdout, r"(?m)^REPORT idle_rss_mb 8888 / \d+ \(real app under --ci: reported, never fails; it gates locally\)$")
                self.assertRegex(r.stdout, r"(?m)^PERF OK$")
                self.assertNotRegex(r.stdout, r"(?m)^(PASS|FAIL) ")
                e = run.entries()
                self.assertEqual({b: e[b]["status"] for b in VM_REPORT}, dict.fromkeys(VM_REPORT, "report"))
                self.assertEqual((e["rss_300_slides_mb"]["values"], e["idle_rss_mb"]["values"]), ([9999], [8888]))

    def test_the_ci_environment_variable_turns_it_on_too(self):
        run = Run(listed("rss_300_slides_mb"), env=scripted(**OVER))
        run.env["CI"] = "true"
        r = run("--os", "darwin")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^REPORT rss_300_slides_mb 9999 / 390 ")

    def test_without_ci_each_gates_against_its_target(self):
        # Linux: cold open against the maintainer's machine (local 490), memory against per_os.
        run = Run(listed(*VM_REPORT), env=scripted(**OVER))
        r = run("--os", "linux")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^FAIL cold_open_ms 5000 \(median of 5000 5100 4900 5000 5000\) / 490$")
        self.assertRegex(r.stdout, r"(?m)^FAIL rss_300_slides_mb 9999 / 500$")
        self.assertRegex(r.stdout, r"(?m)^FAIL idle_rss_mb 8888 / 460$")
        self.assertRegex(r.stdout, r"(?m)^PERF FAILED$")
        # Under the targets they pass, at x1 (memory is exact): one MB over fails.
        for rss, idle, code in ((499.9, 459.9, 0), (500, 459, 1), (499, 460, 1)):
            with self.subTest(rss=rss, idle=idle):
                fine = scripted(cold_open_ms=[[480, 300, 900, 470, 489]], rss_300_slides_mb=[rss], idle_rss_mb=[idle])
                r = Run(listed(*VM_REPORT), env=fine)("--os", "linux")
                self.assertEqual(r.returncode, code, r.stdout)
                self.assertRegex(r.stdout, r"(?m)^PASS cold_open_ms 480 ")
        # macOS and Windows: memory gates against their per-OS targets.
        for os_name, rss, idle in (("darwin", 390, 90), ("win32", 170, 90)):
            with self.subTest(os=os_name):
                run = Run(listed("rss_300_slides_mb", "idle_rss_mb"), env=scripted(**OVER))
                r = run("--os", os_name)
                self.assertEqual(r.returncode, 1, r.stdout)
                self.assertRegex(r.stdout, rf"(?m)^FAIL rss_300_slides_mb 9999 / {rss}$")
                self.assertRegex(r.stdout, rf"(?m)^FAIL idle_rss_mb 8888 / {idle}$")

    def test_the_other_real_app_budgets_still_gate_under_ci(self):
        run = Run(listed("idle_cpu_pct", "ttft_overhead_ms", "rss_300_slides_mb"), env=scripted(**OVER))
        r = run("--ci", "--os", "linux")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^FAIL idle_cpu_pct 9 / 0\.5$")
        self.assertRegex(r.stdout, r"(?m)^FAIL ttft_overhead_ms 900, 900 / 30 \(20 x1\.5 CI allowance\)$")
        self.assertRegex(r.stdout, r"(?m)^REPORT rss_300_slides_mb 9999 ")


class MacosMockedKeystrokeReportsOnCi(unittest.TestCase):
    """Criterion 3: the mocked-core quick check REPORTs under --ci on macOS; Linux gates it at 8 ms
    with the x1.5 rule (one re-measure, fails only when both are over 12 ms)."""

    def keystroke(self) -> list[dict]:
        return listed("keystroke_p99_ms", keystroke_p99_ms={"quick": TIMED})

    def slowed(self, ms: int, slow_runs: int = 1000) -> Run:
        env = {**scripted(keystroke_p99_ms=[3]), "PERF_FIXTURE_DELAY_MS": str(ms), "PERF_FIXTURE_SLOW_RUNS": str(slow_runs)}
        return Run(self.keystroke(), env=env)

    def test_on_macos_a_slow_quick_check_reports_and_passes(self):
        run = self.slowed(250)
        r = run("--ci", "--os", "darwin")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^REPORT keystroke_p99_ms 3 / 8 \(real app under --ci: reported, never fails; it gates locally\)$")
        self.assertRegex(r.stdout, r"(?m)^REPORT keystroke_p99_ms \d{3,}(?:\.\d+)? / 8 \(mocked-core quick check under --ci on darwin: reported, never fails; it gates on linux and win32\)$")
        report = json.loads(run.report.read_text())["budgets"]
        self.assertEqual([(e["source"], e["status"]) for e in report], [("script", "report"), ("quick", "report")])
        self.assertEqual(len(report[1]["values"]), 1)  # reported, so not measured again

    def test_with_quick_and_ci_on_macos_it_reports_too(self):
        r = self.slowed(250)("--quick", "--ci", "--os", "darwin")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^REPORT keystroke_p99_ms \d{3,}(?:\.\d+)? / 8 \(mocked-core quick check under --ci on darwin")

    def test_on_linux_the_quick_check_gates_at_8_ms_x1_5(self):
        for args in (("--ci",), ("--quick", "--ci")):
            with self.subTest(args=args):
                run = self.slowed(250)
                r = run(*args, "--os", "linux")
                self.assertEqual(r.returncode, 1, r.stdout)
                self.assertRegex(r.stdout, r"(?m)^FAIL keystroke_p99_ms \d{3,}(?:\.\d+)?, \d{3,}(?:\.\d+)? / 12 \(8 x1\.5 CI allowance\)")
        # Over x1.5 once, then under: it passes and keeps both values.
        run = self.slowed(250, slow_runs=1)
        r = run("--quick", "--ci", "--os", "linux")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^PASS keystroke_p99_ms \d{3,}(?:\.\d+)?, \d+(?:\.\d+)? / 12 \(8 x1\.5 CI allowance\)")

    def test_without_ci_on_macos_the_quick_check_gates(self):
        r = self.slowed(250)("--quick", "--os", "darwin")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertEqual(re.findall(r"(?m)^REPORT .*$", r.stdout), [])


if __name__ == "__main__":
    unittest.main()
