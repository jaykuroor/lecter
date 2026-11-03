"""Tests for e2e_app_gate.py: the e2e-app (<os>) check passes only when all of its OS's shards passed (D-154)."""
import io, json, sys, unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import e2e_app_gate as gate  # noqa: E402


def jobs(*pairs):
    return [json.dumps({"name": n, "conclusion": c}) for n, c in pairs]


OTHERS = [("lint", "success"), ("e2e-app (ubuntu-24.04)", None), ("test (macos-15)", "failure")]


class Verdict(unittest.TestCase):
    def test_passes_when_every_shard_of_the_os_succeeded(self):
        lines = jobs(*OTHERS, ("e2e-app-shard (ubuntu-24.04, 1)", "success"), ("e2e-app-shard (ubuntu-24.04, 2)", "success"),
                     ("e2e-app-shard (macos-15, 1)", "failure"))
        ok, report = gate.verdict(lines, "ubuntu-24.04", 2)
        self.assertTrue(ok)
        self.assertEqual(report, ["e2e-app-shard (ubuntu-24.04, 1): success", "e2e-app-shard (ubuntu-24.04, 2): success"])

    def test_another_os_failing_does_not_fail_this_one_but_its_own_does(self):
        lines = jobs(("e2e-app-shard (ubuntu-24.04, 1)", "success"), ("e2e-app-shard (macos-15, 1)", "failure"))
        self.assertTrue(gate.verdict(lines, "ubuntu-24.04", 1)[0])
        ok, report = gate.verdict(lines, "macos-15", 1)
        self.assertFalse(ok)
        self.assertEqual(report, ["e2e-app-shard (macos-15, 1): failure"])

    def test_missing_skipped_cancelled_or_unfinished_shards_fail(self):
        for state in ("skipped", "cancelled", "timed_out", None):
            lines = jobs(("e2e-app-shard (windows-2025, 1)", "success"), ("e2e-app-shard (windows-2025, 2)", state))
            ok, report = gate.verdict(lines, "windows-2025", 2)
            self.assertFalse(ok, state)
            self.assertEqual(report[1], f"e2e-app-shard (windows-2025, 2): {state or 'unfinished'}")
        ok, report = gate.verdict(jobs(("e2e-app-shard (windows-2025, 1)", "success")), "windows-2025", 2)
        self.assertFalse(ok)
        self.assertEqual(report[1], "e2e-app-shard (windows-2025, 2): missing")
        self.assertFalse(gate.verdict([], "windows-2025", 1)[0])

    def test_more_shards_than_the_gate_expects_fail(self):
        lines = jobs(("e2e-app-shard (ubuntu-24.04, 1)", "success"), ("e2e-app-shard (ubuntu-24.04, 2)", "success"))
        ok, report = gate.verdict(lines, "ubuntu-24.04", 1)
        self.assertFalse(ok)
        self.assertIn("unexpected shards for ubuntu-24.04: [2]", report[-1])

    def test_names_must_match_exactly(self):
        lines = jobs(("e2e-app-shard (ubuntu-24.04-arm, 1)", "success"), ("e2e-app-shard (ubuntu-24.04, 1) x", "success"))
        self.assertEqual(gate.verdict(lines, "ubuntu-24.04", 1), (False, ["e2e-app-shard (ubuntu-24.04, 1): missing"]))


class Main(unittest.TestCase):
    def run_main(self, argv, stdin):
        out = io.StringIO()
        with mock.patch.object(sys, "stdin", io.StringIO(stdin)), redirect_stdout(out):
            code = gate.main(argv)
        return code, out.getvalue()

    def test_exit_codes_and_usage(self):
        ok = "\n".join(jobs(("e2e-app-shard (macos-15, 1)", "success"))) + "\n\n"
        self.assertEqual(self.run_main(["g", "macos-15", "1"], ok), (0, "e2e-app-shard (macos-15, 1): success\ne2e-app (macos-15): every shard passed\n"))
        code, text = self.run_main(["g", "macos-15", "2"], ok)
        self.assertEqual(code, 1)
        self.assertTrue(text.endswith("e2e-app (macos-15): FAILED\n"))
        with redirect_stdout(io.StringIO()), mock.patch.object(sys, "stderr", io.StringIO()):
            for bad in (["g"], ["g", "macos-15", "0"], ["g", "macos-15", "x"]):
                self.assertEqual(gate.main(bad), 2)


if __name__ == "__main__":
    unittest.main()
