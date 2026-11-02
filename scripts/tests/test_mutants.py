"""Tests for scripts/mutants.py (mutation testing on changed lines). The tools themselves are faked."""
import json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import mutants  # noqa: E402


def sh(cwd, *args):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(f"{args} failed: {r.stderr}")
    return r.stdout


class Pure(unittest.TestCase):
    def test_changed_ranges_from_zero_context_diff(self):
        diff = ("+++ b/ui/src/a.ts\n@@ -3,0 +4,2 @@\n+x\n+y\n@@ -9 +11 @@\n-a\n+b\n"
                "+++ b/ui/src/b.ts\n@@ -5,2 +4,0 @@\n-gone\n-gone\n")
        self.assertEqual(mutants.changed_ranges(diff), {"ui/src/a.ts": [(4, 5), (11, 11)]})

    def test_equivalent_needs_same_file_and_mutation(self):
        eq = [("crates/core/src/lib.rs", "- replace >  with >= in clamp_pages - at 2000 both give 2000")]
        self.assertTrue(mutants.excused("crates/core/src/lib.rs", "replace > with >= in clamp_pages", eq))
        self.assertFalse(mutants.excused("crates/core/src/lib.rs", "replace > with == in clamp_pages", eq))
        self.assertFalse(mutants.excused("crates/ai/src/lib.rs", "replace > with >= in clamp_pages", eq))


class Run(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="lecter-mutants-"))
        for a in (("init", "-q", "-b", "main"), ("config", "user.email", "t@example.com"), ("config", "user.name", "t"),
                  ("config", "commit.gpgsign", "false")):
            sh(self.root, "git", *a)
        (self.root / "Cargo.toml").write_text("[workspace]\n")
        (self.root / "docs").mkdir()
        (self.root / "docs" / "features.json").write_text('{"features": []}')
        (self.root / "lib.rs").write_text("fn a() {}\n")
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-q", "-m", "base")
        self.base = sh(self.root, "git", "rev-parse", "HEAD").strip()
        (self.root / "lib.rs").write_text("fn a() {}\nfn big(n: u32) -> bool { n > 100 }\n")
        sh(self.root, "git", "commit", "-qam", "F-099: big")
        self.patches = [mock.patch.object(mutants, "ROOT", self.root),
                        mock.patch.object(mutants, "OUT", self.root / ".verify" / "mutants")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def fake_cargo(self, listed, missed=(), caught=(), stop_after=None):
        def run_capped(cmd, seconds, cwd, env=None):
            out = self.root / ".verify" / "mutants" / "mutants.out"
            out.mkdir(parents=True, exist_ok=True)
            done = listed if stop_after is None else listed[:stop_after]
            (out / "missed.txt").write_text("".join(f"{m}\n" for m in missed if m in done))
            (out / "caught.txt").write_text("".join(f"{m}\n" for m in done if m not in missed))
            return 0 if stop_after is None else None
        real_run = subprocess.run

        def lister(cmd, *a, **k):  # fake `cargo mutants --list`; git still runs for real
            if cmd[0] == "cargo":
                return subprocess.CompletedProcess(cmd, 0, "".join(f"{m}\n" for m in listed), "")
            return real_run(cmd, *a, **k)
        return [mock.patch.object(mutants, "run_capped", side_effect=run_capped),
                mock.patch.object(mutants.subprocess, "run", side_effect=lister),
                mock.patch.object(mutants.shutil, "which", return_value="/bin/cargo-mutants")]

    def main(self, *args, **fake):
        ps = self.fake_cargo(**fake)
        for p in ps:
            p.start()
        try:
            return mutants.main(["--base", self.base, *args])
        finally:
            for p in ps:
                p.stop()

    def test_survivor_fails_and_is_listed(self):
        m = ["lib.rs:2:30: replace > with >= in big", "lib.rs:2:28: replace big -> bool with true"]
        self.assertEqual(self.main(listed=m, missed=[m[0]]), 1)
        self.assertEqual((self.root / ".verify/mutants/survivors.txt").read_text(), "lib.rs:2: replace > with >= in big\n")

    def test_all_killed_passes(self):
        self.assertEqual(self.main(listed=["lib.rs:2:30: replace > with >= in big"]), 0)

    def test_equivalent_trailer_passes(self):
        sh(self.root, "git", "commit", "-q", "--allow-empty", "-m",
           "F-099: note\n\nMutant-Equivalent: lib.rs - replace > with >= in big - n is never 100 (spec: pages > 100)")
        m = ["lib.rs:2:30: replace > with >= in big"]
        self.assertEqual(self.main(listed=m, missed=m), 0)

    def test_cap_reports_untested_but_passes(self):
        m = [f"lib.rs:2:{i}: m{i} in big" for i in range(4)]
        with mock.patch("builtins.print") as out:
            self.assertEqual(self.main(listed=m, stop_after=1), 0)
        self.assertIn("CAPPED", " ".join(str(c) for c in out.call_args_list))

    def test_merge_in_progress_skips(self):
        (self.root / ".git" / "MERGE_HEAD").write_text(self.base + "\n")
        with mock.patch.object(mutants, "rust_survivors", side_effect=AssertionError("ran")):
            self.assertEqual(mutants.main(["--base", self.base]), 0)

    def test_stryker_config_skips_tsconfig_rewrite(self):
        # TypeScript 7 has no JS API: Stryker crashes if its tsconfig rewrite finds the real ui/tsconfig.json.
        ui = KIT / "ui"
        if not (ui / "package.json").exists():
            self.skipTest("no ui/ yet")
        cfg = json.loads((ui / "stryker.config.json").read_text())
        self.assertIn("tsconfigFile", cfg)
        self.assertNotEqual(cfg["tsconfigFile"], "tsconfig.json")
        self.assertFalse((ui / cfg["tsconfigFile"]).exists())
        self.assertEqual(cfg["testRunner"], "vitest")

    def test_stryker_runs_on_changed_ui_lines_and_reads_report(self):
        (self.root / "ui" / "node_modules" / "@stryker-mutator" / "core").mkdir(parents=True)
        (self.root / "ui" / "tsconfig.json").write_text('{"include": ["src"]}\n')
        (self.root / "ui" / "src").mkdir()
        (self.root / "ui" / "src" / "a.ts").write_text("export const big = (n: number) => n > 100;\n")
        sh(self.root, "git", "add", "ui/src", "ui/tsconfig.json")
        sh(self.root, "git", "commit", "-q", "-m", "F-099: ui big")
        seen = []

        def stryker(cmd, seconds, cwd, env=None):
            seen.append(cmd)
            report = self.root / "ui" / "reports" / "mutation" / "mutation.json"
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(json.dumps({"files": {"src/a.ts": {"mutants": [
                {"status": "Killed", "mutatorName": "EqualityOperator", "replacement": "n >= 100",
                 "location": {"start": {"line": 1}}},
                {"status": "Survived", "mutatorName": "BooleanLiteral", "replacement": "true",
                 "location": {"start": {"line": 1}}}]}}}))
        with mock.patch.object(mutants, "run_capped", side_effect=stryker):
            surv, total, tested = mutants.ui_survivors(self.base, 60, False)
        self.assertEqual(seen[0][seen[0].index("--mutate") + 1], "src/a.ts:1-1")
        self.assertEqual((surv, total, tested), ([("ui/src/a.ts", 1, "BooleanLiteral -> true")], 2, 2))

    def test_full_mode_writes_score_and_never_fails(self):
        m = ["lib.rs:2:30: a in big", "lib.rs:2:28: b in big"]
        ps = self.fake_cargo(listed=m, missed=[m[0]])
        for p in ps:
            p.start()
        try:
            self.assertEqual(mutants.main(["--full"]), 0)
        finally:
            for p in ps:
                p.stop()
        self.assertEqual(json.loads((self.root / ".verify/mutants/score.json").read_text())["score"], 50.0)


if __name__ == "__main__":
    unittest.main()
