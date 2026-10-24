"""Tests for scripts/check_private.py and the private-corpus .gitignore rule (bug: the builder's
symlink tests/corpus/private was staged because the ignore rule only matched directories)."""
import os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KIT / "scripts"))
import check_private  # noqa: E402

PROSE = ("Students who write their own questions next to the slides remember more of the lecture a week later. "
         "The effect is strongest when the question is answered in the same place it was asked, so the answer "
         "stays attached to the line that caused the confusion. Reviewing those questions before the exam turns "
         "them into a short, personal revision list that covers exactly the gaps that matter.")


def sh(cwd, *args):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(f"{args} failed ({r.returncode}): {r.stderr.strip()}")
    return r.stdout


class Repo:
    def __init__(self, gitignore=None):
        self.tmp = Path(tempfile.mkdtemp(prefix="lecter-private-test-"))
        self.root = self.tmp / "repo"
        self.root.mkdir()
        sh(self.root, "git", "init", "-q", "-b", "main")
        sh(self.root, "git", "config", "user.email", "t@example.com")
        sh(self.root, "git", "config", "user.name", "t")
        sh(self.root, "git", "config", "commit.gpgsign", "false")  # hermetic: no signing agent in the sandbox
        (self.root / ".gitignore").write_text(gitignore if gitignore is not None
                                              else (KIT / ".gitignore").read_text())
        (self.root / "tests" / "corpus").mkdir(parents=True)
        # The main checkout's private folder, which a builder worktree links to.
        self.vault = self.tmp / "main-checkout" / "tests" / "corpus" / "private"
        (self.vault / "inbox").mkdir(parents=True)
        (self.vault / "expected").mkdir()
        (self.vault / "inbox" / "week03-secret-slides.pdf").write_bytes(b"%PDF-1.4 not really a pdf")
        (self.vault / "expected" / "P-01.md").write_text(PROSE)

    def link_private(self):
        os.symlink(self.vault, self.root / "tests" / "corpus" / "private")

    def stage_all(self):
        sh(self.root, "git", "add", "-A")
        return sh(self.root, "git", "diff", "--cached", "--name-only").split()

    def check(self):
        return check_private.check(self.root)[0]

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class PrivateCorpusTests(unittest.TestCase):
    def setUp(self):
        self.r = Repo()

    def tearDown(self):
        self.r.close()

    def test_symlinked_private_folder_is_not_staged_by_add_all(self):
        self.r.link_private()
        staged = self.r.stage_all()
        self.assertNotIn("tests/corpus/private", staged)
        self.assertFalse(any(p.startswith("tests/corpus/private") for p in staged))

    def test_old_trailing_slash_rule_did_stage_the_symlink(self):
        old = Repo(gitignore="tests/corpus/private/\n")
        try:
            old.link_private()
            self.assertIn("tests/corpus/private", old.stage_all())  # the bug this kit fixes
        finally:
            old.close()

    def test_force_added_symlink_is_flagged(self):
        self.r.link_private()
        sh(self.r.root, "git", "add", "-f", "tests/corpus/private")
        self.assertTrue(any("tracked private path: tests/corpus/private" == p for p in self.r.check()))

    def test_tracked_symlink_elsewhere_pointing_into_private_is_flagged(self):
        self.r.link_private()
        os.symlink("../tests/corpus/private/expected/P-01.md", self.r.root / "docs-link.md")
        sh(self.r.root, "git", "add", "docs-link.md")
        self.assertTrue(any("symlink into the private corpus" in p for p in self.r.check()))

    def test_clean_repo_passes(self):
        self.r.link_private()
        (self.r.root / "notes.md").write_text("# Notes\nP-01 CER 4.1% on the dense-text set.\n")
        self.r.stage_all()
        self.assertEqual(self.r.check(), [])

    def test_verbatim_copy_with_changed_case_and_spacing_is_flagged(self):
        self.r.link_private()
        copied = PROSE[40:300].upper().replace(" ", "\n  ")
        (self.r.root / "fixture.md").write_text("# Fixture\n\n" + copied + "\n")
        self.r.stage_all()
        self.assertTrue(any("copied from a private file" in p for p in self.r.check()))

    def test_short_overlap_is_not_flagged(self):
        self.r.link_private()
        (self.r.root / "fixture.md").write_text("Quote: " + PROSE[0:100] + "\n")
        self.r.stage_all()
        self.assertEqual(self.r.check(), [])

    def test_private_file_name_is_flagged(self):
        self.r.link_private()
        (self.r.root / "log.md").write_text("parsed week03-secret-slides in 2 s\n")
        self.r.stage_all()
        self.assertTrue(any("names a private file" in p for p in self.r.check()))

    def test_byte_copy_of_private_document_is_flagged(self):
        self.r.link_private()
        fx = self.r.root / "tests" / "fixtures"
        fx.mkdir(parents=True)
        shutil.copy(self.r.vault / "inbox" / "week03-secret-slides.pdf", fx / "sample.pdf")
        self.r.stage_all()
        self.assertTrue(any("copy of a private file" in p for p in self.r.check()))


if __name__ == "__main__":
    unittest.main()


class SandboxPlaceholderTests(unittest.TestCase):
    """The Claude Code sandbox mounts empty placeholders over protected paths during a session;
    inside the sandbox they are devices and `git add -A` refuses them (dry run, 2026-10-24)."""

    def test_placeholders_are_ignored_but_kit_files_are_not(self):
        r = Repo()
        try:
            for p in [".bashrc", ".gitconfig", ".mcp.json", ".vscode", ".claude/commands",
                      ".claude/hooks", ".claude/settings.local.json", ".claude/routines"]:
                (r.root / p).parent.mkdir(parents=True, exist_ok=True)
                (r.root / p).write_text("")
            for p in [".claude/settings.json", ".claude/agents/builder.md", ".claude/skills/verify/SKILL.md"]:
                (r.root / p).parent.mkdir(parents=True, exist_ok=True)
                (r.root / p).write_text("kit")
            staged = r.stage_all()
            self.assertEqual(sorted(s for s in staged if s != ".gitignore"),
                             [".claude/agents/builder.md", ".claude/settings.json", ".claude/skills/verify/SKILL.md"])
        finally:
            r.close()
