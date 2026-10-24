"""Tests for scripts/check_tests.py, the test-weakening lint."""
import json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import check_tests  # noqa: E402

RS = """pub fn add(a: i32, b: i32) -> i32 { a + b }
#[cfg(test)]
mod tests {
    #[test]
    fn adds() { assert_eq!(super::add(1, 2), 3); }
    #[test]
    fn adds_negative() { assert_eq!(super::add(-1, -2), -3); }
}
"""
TS = "import { test, expect } from '@playwright/test';\ntest('opens', async () => { expect(1).toBe(1); });\n"
BUDGETS = {"budgets": [{"id": "keystroke_p99_ms", "budget": 8, "kind": "timing"}]}


def sh(cwd, *args):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(f"{args} failed ({r.returncode}): {r.stderr.strip()}")
    return r.stdout


class Lint(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="lecter-tests-lint-"))
        sh(self.root, "git", "init", "-q", "-b", "main")
        sh(self.root, "git", "config", "user.email", "t@example.com")
        sh(self.root, "git", "config", "user.name", "t")
        sh(self.root, "git", "config", "commit.gpgsign", "false")  # hermetic: no signing agent in the sandbox
        self.write("crates/core/src/lib.rs", RS)
        self.write("ui/e2e/open.spec.ts", TS)
        self.write("tests/perf/budgets.json", json.dumps(BUDGETS))
        self.write("crates/core/src/snapshots/core__parse.snap", "---\nsource: x\n---\nblock\n")
        self.write("docs/DECISIONS.md", "# Decisions\n\n## D-040 · Raise keystroke budget\n2026-10-24 · Jay · active\n")
        self.commit("base")
        self.base = sh(self.root, "git", "rev-parse", "HEAD").strip()
        sh(self.root, "git", "switch", "-q", "-c", "feat/F-099-x")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self, msg):
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-q", "-m", msg)

    def problems(self):
        return check_tests.check(self.root, check_tests.find_base(self.root, None))

    def test_clean_change_with_new_test_passes(self):
        self.write("crates/core/src/lib.rs", RS.replace("    #[test]\n    fn adds()", "    #[test]\n    fn adds_zero() { assert_eq!(super::add(0, 0), 0); }\n    #[test]\n    fn adds()"))
        self.write("ui/e2e/new.spec.ts", TS)
        self.commit("F-099: more tests")
        self.assertEqual(self.problems(), [])

    def test_removed_test_function_is_flagged(self):
        self.write("crates/core/src/lib.rs", RS.replace("    #[test]\n    fn adds_negative() { assert_eq!(super::add(-1, -2), -3); }\n", ""))
        self.assertTrue(any("test function(s) removed" in p for p in self.problems()))

    def test_removed_test_with_trailer_passes(self):
        self.write("crates/core/src/lib.rs", RS.replace("    #[test]\n    fn adds_negative() { assert_eq!(super::add(-1, -2), -3); }\n", ""))
        self.commit("F-099: merge duplicate test\n\nTest-Removed: crates/core/src/lib.rs::adds_negative - duplicate of adds")
        self.assertEqual(self.problems(), [])

    def test_ignore_attribute_is_flagged(self):
        self.write("crates/core/src/lib.rs", RS.replace("    #[test]\n    fn adds()", "    #[test]\n    #[ignore]\n    fn adds()"))
        self.assertTrue(any("#[ignore]" in p for p in self.problems()))

    def test_iterator_skip_in_rust_is_not_flagged(self):
        self.write("crates/core/src/lib.rs", RS + "pub fn tail(v: &[i32]) -> Vec<i32> { v.iter().skip(1).copied().collect() }\n")
        self.assertEqual(self.problems(), [])

    def test_skip_and_only_in_playwright_are_flagged(self):
        self.write("ui/e2e/open.spec.ts", TS.replace("test('opens'", "test.skip('opens'"))
        self.assertTrue(any(".skip" in p for p in self.problems()))
        self.write("ui/e2e/open.spec.ts", TS.replace("test('opens'", "test.only('opens'"))
        self.assertTrue(any(".only" in p for p in self.problems()))

    def test_deleted_test_file_is_flagged(self):
        (self.root / "ui/e2e/open.spec.ts").unlink()
        self.assertTrue(any("test file deleted" in p for p in self.problems()))

    def test_loosened_budget_is_flagged_unless_jay_decided(self):
        self.write("tests/perf/budgets.json", json.dumps({"budgets": [{"id": "keystroke_p99_ms", "budget": 12, "kind": "timing"}]}))
        self.assertTrue(any("loosened keystroke_p99_ms" in p for p in self.problems()))
        self.commit("chore: budget\n\nBudget-Changed: keystroke_p99_ms - D-040")
        self.assertEqual(self.problems(), [])

    def test_tightened_budget_passes(self):
        self.write("tests/perf/budgets.json", json.dumps({"budgets": [{"id": "keystroke_p99_ms", "budget": 6, "kind": "timing"}]}))
        self.assertEqual(self.problems(), [])

    def test_changed_snapshot_is_flagged(self):
        self.write("crates/core/src/snapshots/core__parse.snap", "---\nsource: x\n---\nother\n")
        self.assertTrue(any("existing snapshot changed" in p for p in self.problems()))

    def test_test_retries_are_flagged(self):
        self.write("ui/playwright.config.ts", "export default { retries: 0 };\n")
        self.commit("F-099: config")
        self.write("ui/playwright.config.ts", "export default { retries: 2 };\n")
        self.assertTrue(any("retries" in p for p in self.problems()))

    def test_uses_feature_base_when_in_progress(self):
        self.write("docs/features.json", json.dumps({"features": [{"id": "F-099", "status": "in_progress", "base": self.base}]}))
        self.commit("chore: start")
        self.assertEqual(check_tests.find_base(self.root, None), self.base)


if __name__ == "__main__":
    unittest.main()
