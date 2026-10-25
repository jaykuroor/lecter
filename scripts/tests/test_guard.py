"""Tests for scripts/hooks/guard.py: protected checks, dependency adds, live keys, deletes."""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[2]


class Guard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="lecter-guard-"))
        shutil.copytree(KIT / "scripts", cls.root / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
        (cls.root / "docs").mkdir()
        feats = {"milestones": ["M0.5"], "gates": {}, "features": [
            {"id": "F-025", "milestone": "M0.5", "kind": "feature", "status": "in_progress", "depends_on": [], "priority": 1,
             "protected": ["tests/perf/budgets.json"]}]}
        (cls.root / "docs" / "features.json").write_text(json.dumps(feats))
        for rel in ("scripts/verify.sh", "tests/perf/budgets.json", "tests/corpus/thresholds.json", "crates/core/src/snapshots/a.snap"):
            (cls.root / rel).parent.mkdir(parents=True, exist_ok=True)
            (cls.root / rel).touch()
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=cls.root, check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def run_guard(self, tool, **ti):
        env = {**os.environ, "CLAUDE_PROJECT_DIR": str(self.root)}
        for k in ("LECTER_KIT_EDIT", "LECTER_PLANNING", "LECTER_ALLOW_PUSH"):
            env.pop(k, None)
        r = subprocess.run([sys.executable, str(self.root / "scripts/hooks/guard.py")], input=json.dumps(
            {"tool_name": tool, "tool_input": ti, "cwd": str(self.root)}), capture_output=True, text=True, env=env)
        return r.returncode

    def edit(self, rel):
        return self.run_guard("Edit", file_path=str(self.root / rel))

    def bash(self, cmd):
        return self.run_guard("Bash", command=cmd)

    def test_verify_cache_is_off_limits(self):
        self.assertEqual(self.bash("mkdir -p .git/lecter-verify-cache && echo lint > .git/lecter-verify-cache/k.lint"), 2)
        self.assertEqual(self.bash("ls $(git rev-parse --git-common-dir)/lecter-verify-cache"), 2)
        self.assertEqual(self.run_guard("Write", file_path=str(self.root / ".git/lecter-verify-cache/k.lint"), content="lint"), 2)
        self.assertEqual(self.bash("scripts/verify.sh --quick --no-cache"), 0)

    def test_protected_file_edit_blocked(self):
        self.assertEqual(self.edit("scripts/verify.sh"), 2)
        self.assertEqual(self.edit("tests/corpus/thresholds.json"), 2)
        self.assertEqual(self.edit("crates/core/src/snapshots/a.snap"), 2)

    def test_protected_file_listed_by_in_progress_feature_allowed(self):
        self.assertEqual(self.edit("tests/perf/budgets.json"), 0)

    def test_new_tests_and_snapshots_allowed(self):
        self.assertEqual(self.edit("crates/core/src/snapshots/new.snap"), 0)
        self.assertEqual(self.edit("crates/core/tests/journal.rs"), 0)

    def test_shell_writes_to_protected_blocked(self):
        self.assertEqual(self.bash("sed -i 's/8/12/' tests/corpus/thresholds.json"), 2)
        self.assertEqual(self.bash("echo x > scripts/verify.sh"), 2)
        self.assertEqual(self.bash("cat scripts/verify.sh"), 0)
        self.assertEqual(self.bash("scripts/verify.sh --quick 2>&1 | tail -5"), 0)

    def test_kit_files_blocked(self):
        self.assertEqual(self.edit("scripts/check_tests.py"), 2)
        self.assertEqual(self.bash("echo pass > scripts/check_private.py"), 2)
        self.assertEqual(self.edit("scripts/add_dep.py"), 2)  # its package age check is a security control

    def test_dependency_adds_blocked(self):
        for cmd in ("cargo add serde -p lecter-core", "pnpm -C ui add lodash", "npm install left-pad"):
            self.assertEqual(self.bash(cmd), 2, cmd)
        self.assertEqual(self.bash("python3 scripts/add_dep.py rust serde -p lecter-core"), 0)

    def test_live_keys(self):
        self.assertEqual(self.bash("cat ~/.config/lecter-dev/keys.env"), 2)
        self.assertEqual(self.bash("python3 -c 'print(open(\"keys.env\").read())'"), 2)
        self.assertEqual(self.run_guard("Edit", file_path=str(Path.home() / ".config/lecter-dev/keys.env")), 2)
        self.assertEqual(self.bash("scripts/live.sh F-002 -- python3 spikes/vision/run.py"), 0)

    def test_deletes(self):
        self.assertEqual(self.bash("find . -name '*.rs' -delete"), 2)
        self.assertEqual(self.bash("find crates -type f -exec rm {} +"), 2)
        self.assertEqual(self.bash("find crates -name '*.rs'"), 0)


if __name__ == "__main__":
    unittest.main()
