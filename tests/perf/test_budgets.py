"""Tests of tests/perf/budgets.sh (F-025): the budgets file matches the spec table, and the gate
behaves as 14-quality.md#performance-budgets says: a breach exits non-zero (a deliberately slowed
measurement makes it fail), timing budgets get x1.5 and one re-measure under --ci, memory, size and
token budgets are exact, and budgets without a measurement print PENDING and fail once their
milestone is done. Run by budgets.sh itself before it measures (and alone with --self-test)."""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BUDGETS_SH = HERE / "budgets.sh"
SPEC = ROOT / "docs" / "spec" / "14-quality.md"
TIMED = "tests/perf/fixtures/timed_work.py"
FIXED = "tests/perf/fixtures/fixed.py"


def spec_rows() -> dict[str, str]:
    """The id -> target cells of the spec's budget table."""
    text = SPEC.read_text(encoding="utf-8")
    section = text.split("## Performance budgets", 1)[1].split("\n## ", 1)[0]
    rows = {}
    for line in section.splitlines():
        m = re.match(r"\|\s*`([a-z0-9_]+)`\s*\|\s*([^|]+)\|", line)
        if m:
            rows[m.group(1)] = m.group(2).strip()
    return rows


def targets(sid: str, cell: str) -> list[tuple[str, str, float]]:
    """(suffix, cmp, value) for each target in a spec cell: one (`p99 < 8 ms`, `≤ 2,500`), or for
    installer_mb one per format ("`.deb` ≤ 25 MB, ..., AppImage ≤ 110 MB")."""
    if sid == "installer_mb":
        found = re.finditer(r"(?:`\.(\w+)`|(AppImage))\s*≤\s*([\d.]+)", cell)
        return [((m.group(1) or m.group(2)).lower(), "le", float(m.group(3))) for m in found]
    m = re.search(r"([<≤])\s*([\d,]+(?:\.\d+)?)", cell)
    return [("", "lt" if m.group(1) == "<" else "le", float(m.group(2).replace(",", "")))]


class Run:
    """budgets.sh on a budgets file of our own, with its own report and features files."""

    def __init__(self, budgets: list[dict], done: list[str] = (), env: dict | None = None):
        self.dir = tempfile.mkdtemp(prefix="lecter-perf-test-")
        self.budgets = Path(self.dir, "budgets.json")
        self.budgets.write_text(json.dumps({"budgets": budgets}))
        features = [{"id": "F-900", "milestone": "M0.5", "status": "done" if "M0.5" in done else "todo"},
                    {"id": "F-901", "milestone": "M4", "status": "done" if "M4" in done else "todo"}]
        self.features = Path(self.dir, "features.json")
        self.features.write_text(json.dumps({"features": features}))
        self.report = Path(self.dir, "report.json")
        self.env = {**os.environ, "PERF_FIXTURE_COUNTER": str(Path(self.dir, "calls")), **(env or {})}
        self.env.pop("CI", None)
        self.env["LECTER_PERF_SELFTEST"] = "0"

    def __call__(self, *args: str) -> subprocess.CompletedProcess:
        cmd = ["bash", str(BUDGETS_SH), "--budgets", str(self.budgets), "--features", str(self.features),
               "--report", str(self.report), "--logs", self.dir, *args]
        return subprocess.run(cmd, cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=120)

    def entries(self) -> dict[str, dict]:
        return {e["id"]: e for e in json.loads(self.report.read_text())["budgets"]}

    def calls(self) -> int:
        p = Path(self.dir, "calls")
        return int(p.read_text()) if p.exists() else 0


def timing(bid="work_ms", budget=100, script=TIMED, **kw) -> dict:
    return {"id": bid, "budget": budget, "cmp": "lt", "unit": "ms", "kind": "timing", "from": "M0.5", "script": script, **kw}


def fixed(bid, budget, kind="memory", cmp="lt", **kw) -> dict:
    return {"id": bid, "budget": budget, "cmp": cmp, "unit": "MB", "kind": kind, "from": "M0.5", "script": FIXED, **kw}


class BudgetsFileMatchesSpec(unittest.TestCase):
    def test_every_spec_budget_is_listed_with_its_target_kind_and_milestone(self):
        data = json.loads((HERE / "budgets.json").read_text())["budgets"]
        listed = {b["id"]: b for b in data}
        # Milestones the spec states; the walking skeleton (M0.5) for the rest, except the two
        # whose cards make them hold later (F-051 crash_loss_ms, F-057 parse_100_pages_ms: M2).
        stated = {"tier1_p95_ms": "M4", "uncached_tokens_a_p95": "M3", "installer_mb": "M0.5",
                  "crash_loss_ms": "M2", "parse_100_pages_ms": "M2"}
        kinds = {"ms": "timing", "MB": "memory"}
        rows = spec_rows()
        self.assertEqual(len(rows), 12)
        for sid, cell in rows.items():
            for suffix, cmp, value in targets(sid, cell):
                bid = f"{sid}.{suffix}" if suffix else sid
                with self.subTest(budget=bid):
                    self.assertIn(bid, listed)
                    b = listed[bid]
                    self.assertEqual((b["cmp"], b["budget"]), (cmp, value))
                    self.assertEqual(b["from"], stated.get(sid, "M0.5"))
                    if sid.endswith("_ms"):
                        self.assertEqual(b["kind"], "timing")
                    elif sid == "installer_mb" or sid.endswith("_kb_gz"):
                        self.assertEqual(b["kind"], "size")
                    elif sid.endswith("_mb"):
                        self.assertEqual(b["kind"], kinds["MB"])
        # The installer row alone holds five targets.
        self.assertEqual(sorted(k for k in listed if k.startswith("installer_mb.")),
                         ["installer_mb.appimage", "installer_mb.deb", "installer_mb.dmg", "installer_mb.exe", "installer_mb.rpm"])
        self.assertEqual((listed["uncached_tokens_a_p95"]["kind"], listed["idle_cpu_pct"]["budget"]), ("tokens", 0.5))
        self.assertEqual(len(listed), 16)

    def test_the_seven_criterion_budgets_have_a_measurement_and_the_rest_are_pending(self):
        listed = {b["id"]: b for b in json.loads((HERE / "budgets.json").read_text())["budgets"]}
        measured = {"keystroke_p99_ms", "cold_open_ms", "idle_rss_mb", "rss_300_slides_mb", "idle_cpu_pct",
                    "ttft_overhead_ms", "ui_main_chunk_kb_gz"}
        for bid, b in listed.items():
            with self.subTest(budget=bid):
                if bid in measured:
                    self.assertTrue((ROOT / b["script"]).is_file())
                    self.assertNotIn("job", b)
                elif bid.startswith("installer_mb."):
                    self.assertEqual(b["job"], "nightly")
                else:
                    self.assertNotIn("script", b)
        # The six real-app budgets are measured on the real app; the bundle by vite build.
        self.assertEqual({listed[b]["script"] for b in measured - {"ui_main_chunk_kb_gz"}}, {"tests/perf/app/run.sh"})


class Gate(unittest.TestCase):
    def test_a_deliberately_slowed_measurement_fails_the_gate(self):
        fast = Run([timing()])
        r = fast()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"(?m)^PASS work_ms \d+\.\d+ / 100$")
        self.assertRegex(r.stdout, r"(?m)^PERF OK$")
        slow = Run([timing()], env={"PERF_FIXTURE_DELAY_MS": "250"})
        r = slow()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"(?m)^FAIL work_ms \d{3,}\.\d+ / 100$")
        self.assertRegex(r.stdout, r"(?m)^PERF FAILED$")
        entry = slow.entries()["work_ms"]
        self.assertEqual(entry["status"], "fail")
        self.assertGreaterEqual(entry["values"][0], 250)

    def test_under_ci_a_slowed_timing_is_measured_twice_and_fails_when_both_are_over(self):
        run = Run([timing()], env={"PERF_FIXTURE_DELAY_MS": "250"})
        r = run("--ci")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(run.calls(), 2)
        entry = run.entries()["work_ms"]
        self.assertEqual((entry["status"], entry["limit"], len(entry["values"])), ("fail", 150, 2))
        self.assertTrue(all(v >= 250 for v in entry["values"]), entry["values"])  # a slow runner may sleep longer
        self.assertRegex(r.stdout, r"(?m)^FAIL work_ms \d{3,}\.\d+, \d{3,}\.\d+ / 150 \(100 x1\.5 CI allowance\)$")

    def test_ci_env_turns_on_the_ci_rule(self):
        run = Run([timing()], env={"PERF_FIXTURE_DELAY_MS": "250"})
        run.env["CI"] = "true"
        r = run()
        self.assertEqual((r.returncode, run.calls()), (1, 2), r.stdout)

    def test_under_ci_a_timing_over_once_then_under_passes_and_keeps_both_values(self):
        run = Run([timing()], env={"PERF_FIXTURE_DELAY_MS": "250", "PERF_FIXTURE_SLOW_RUNS": "1"})
        r = run("--ci")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        values = run.entries()["work_ms"]["values"]
        self.assertEqual(len(values), 2)
        self.assertGreaterEqual(values[0], 250)
        self.assertLess(values[1], 150)

    def test_ci_allowance_is_one_and_a_half_times_the_budget_with_no_remeasure_under_it(self):
        values = json.dumps({"t_ms": [120], "u_ms": [150]})
        run = Run([fixed("t_ms", 100, kind="timing"), fixed("u_ms", 100, kind="timing")], env={"PERF_FIXTURE_VALUES": values})
        r = run("--ci")
        self.assertEqual(r.returncode, 1, r.stdout)
        e = run.entries()
        self.assertEqual((e["t_ms"]["status"], e["t_ms"]["values"]), ("pass", [120]))
        self.assertEqual((e["u_ms"]["status"], e["u_ms"]["values"]), ("fail", [150, 150]))
        self.assertEqual(run.calls(), 2)  # one run for both, then a re-measure of u_ms only
        local = Run([fixed("t_ms", 100, kind="timing")], env={"PERF_FIXTURE_VALUES": values})
        self.assertEqual(local().returncode, 1)  # x1 without --ci

    def test_memory_size_and_token_budgets_are_exact_even_under_ci(self):
        values = json.dumps({"m": [151, 100], "s": [250.01], "k": [2500]})
        run = Run([fixed("m", 150), fixed("s", 250, kind="size", cmp="le"), fixed("k", 2500, kind="tokens", cmp="le")],
                  env={"PERF_FIXTURE_VALUES": values})
        r = run("--ci")
        self.assertEqual(r.returncode, 1, r.stdout)
        e = run.entries()
        self.assertEqual([e[k]["status"] for k in ("m", "s", "k")], ["fail", "fail", "pass"])
        self.assertEqual((e["m"]["values"], e["m"]["limit"]), ([151], 150))
        self.assertEqual(run.calls(), 1)

    def test_lt_fails_at_the_budget_and_le_passes_at_it(self):
        values = json.dumps({"a": [8], "b": [8]})
        run = Run([fixed("a", 8, kind="timing"), fixed("b", 8, kind="size", cmp="le")], env={"PERF_FIXTURE_VALUES": values})
        r = run()
        self.assertEqual(r.returncode, 1)
        self.assertEqual({k: v["status"] for k, v in run.entries().items()}, {"a": "fail", "b": "pass"})
        self.assertRegex(r.stdout, r"(?m)^FAIL a 8 / 8$")
        self.assertRegex(r.stdout, r"(?m)^PASS b 8 / 8$")

    def test_a_script_that_measures_nothing_or_crashes_fails(self):
        run = Run([fixed("gone", 10), fixed("there", 10)], env={"PERF_FIXTURE_VALUES": json.dumps({"there": [1]})})
        r = run()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(run.entries()["gone"]["status"], "fail")
        self.assertRegex(r.stdout, r"(?m)^FAIL gone \(no measurement")
        crash = Run([fixed("there", 10)], env={"PERF_FIXTURE_VALUES": json.dumps({"there": [1]}), "PERF_FIXTURE_EXIT": "3"})
        r = crash()
        self.assertEqual(r.returncode, 1)
        self.assertRegex(r.stdout, r"(?m)^FAIL there .*exit 3")


class Pending(unittest.TestCase):
    def test_a_budget_without_a_measurement_is_pending_until_its_milestone_is_done(self):
        b = [{"id": "later_ms", "budget": 100, "cmp": "lt", "unit": "ms", "kind": "timing", "from": "M4"}]
        before = Run(b, done=["M0.5"])
        r = before()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^PENDING later_ms \(no measurement yet; gates from M4\)$")
        after = Run(b, done=["M0.5", "M4"])
        r = after()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^PENDING later_ms .*M4 is done")
        self.assertEqual(after.entries()["later_ms"]["status"], "fail")
        # A milestone is done only when all its features are: one feature left keeps it pending,
        # wherever it sits in the file.
        for order in (["done", "todo"], ["todo", "done"]):
            with self.subTest(order=order):
                half = Run(b, done=["M0.5", "M4"])
                feats = [{"id": f"F-91{i}", "milestone": "M4", "status": s} for i, s in enumerate(order)]
                half.features.write_text(json.dumps({"features": feats}))
                self.assertEqual(half().returncode, 0)

    def test_quick_runs_the_quick_checks_and_still_gates_pending_budgets(self):
        b = [timing("slow_ms", script=TIMED), timing("q_ms", quick=TIMED, script=FIXED),
             {"id": "p_ms", "budget": 1, "cmp": "lt", "unit": "ms", "kind": "timing", "from": "M0.5"}]
        run = Run(b, done=["M0.5"])
        r = run("--quick")
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertRegex(r.stdout, r"(?m)^SKIP slow_ms \(not in --quick\)$")
        self.assertRegex(r.stdout, r"(?m)^PASS q_ms \d")
        self.assertRegex(r.stdout, r"(?m)^PENDING p_ms .*M0\.5 is done")

    def test_nightly_budgets_run_only_with_nightly_or_only(self):
        b = [fixed("n_mb", 25, kind="size", cmp="le", job="nightly")]
        run = Run(b, env={"PERF_FIXTURE_VALUES": json.dumps({"n_mb": [30]})})
        r = run()
        self.assertEqual((r.returncode, run.calls()), (0, 0), r.stdout)
        self.assertRegex(r.stdout, r"(?m)^NIGHTLY n_mb \(measured in the nightly run\)$")
        self.assertEqual(run("--nightly").returncode, 1)
        self.assertEqual(run("--only", "n_mb").returncode, 1)


class FixtureLecture(unittest.TestCase):
    def test_the_generator_writes_the_mocked_cores_fixture_lecture(self):
        sys.path.insert(0, str(ROOT / "tests" / "fixtures" / "lectures"))
        from gen_lecture import fixture_lecture  # noqa: PLC0415

        text = fixture_lecture(200)
        # The mocked-core check (ui/e2e/buffer-perf.spec.ts) reports its 200-slide fixture as
        # 111622 characters; the same text is what the real app is measured on.
        self.assertEqual(len(text), 111622)
        lines = text.split("\n")
        self.assertEqual(lines[:8], ["---", "lecter: 1", "lecture: 7", "title: Synthetic Fixture", "slides:",
                                     "  - slides/07-fixture.pdf", "---", ""])
        self.assertEqual(sum(1 for t in lines if t.startswith("::: {.slide ")), 200)
        # Slide 2 (worked by hand): topic 2 % 6 = Covariance, 3 + 2 % 3 = 5 blocks, sentence and math (2 + 1) % 5 and % 4,,
        # math on odd blocks, a gloss g-3dde (2 x 7919).
        s2 = text.split('::: {.slide #s2 n=2 src="A2" title="Covariance 2"}\n', 1)[1].split("\n::: {.slide #s3", 1)[0]
        self.assertIn(r"[Try a small example with two dice before reading the proof $P(A\mid B)=\frac{P(A\cap B)}{P(B)}$]{#s2b1}", s2)
        self.assertIn("{#s2b5}", s2)
        self.assertNotIn("{#s2b6", s2)
        self.assertIn("::: {.gloss #g-3dde kind=steps key=s anchor=s2b1 by=ai}", s2)
        self.assertIn("::: {.note #n-00c8 anchor=s200b2}", text)
        self.assertIn("{#s9b2 .flag}", text)  # (9 + 2) % 11 == 0
        self.assertEqual(len(fixture_lecture(300).split("::: {.slide ")), 301)


class Usage(unittest.TestCase):
    def test_bad_arguments_and_bad_budget_files_exit_2(self):
        run = Run([timing()])
        self.assertEqual(run("--only", "no_such_id").returncode, 2)
        self.assertEqual(run("--frobnicate").returncode, 2)
        for bad in ({"id": "x", "budget": "8", "cmp": "lt", "unit": "ms", "kind": "timing", "from": "M0.5"},
                    {"id": "x", "budget": 8, "cmp": "lte", "unit": "ms", "kind": "timing", "from": "M0.5"},
                    {"id": "x", "budget": 8, "cmp": "lt", "unit": "ms", "kind": "speed", "from": "M0.5"},
                    {"id": "x", "budget": 8, "cmp": "lt", "unit": "ms", "kind": "timing", "from": "soon"},
                    timing(script="tests/perf/no_such_script.py")):
            with self.subTest(entry=bad):
                r = Run([bad])()
                self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        dup = Run([timing(), timing()])()
        self.assertEqual(dup.returncode, 2)


if __name__ == "__main__":
    unittest.main()
