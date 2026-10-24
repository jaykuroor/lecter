#!/usr/bin/env python3
"""PreToolUse guard. Exit 2 blocks the tool call and shows the reason to the agent.

Blocks, for file edits:
  docs/spec/**            the spec is read-only (planning sessions: LECTER_PLANNING=1)
  docs/features.json      use scripts/feature.py
  shared state files      (PROGRESS, DECISIONS, QUESTIONS, CHANGELOG, README) from inside a builder worktree
  protected checks        (PROTECTED below) unless the in-progress feature lists the file under `protected`;
                          new files are fine (docs/spec/14-quality.md#protected-checks)
  kit files               .claude/settings*.json, scripts/hooks/**, the lint scripts (Jay only: LECTER_KIT_EDIT=1)
  anything outside the project, secret files (.env, *.pem, *.key) and Jay's live keys file
Blocks, for shell commands:
  git push (unless LECTER_ALLOW_PUSH=1), any force push, history rewrites, mass deletes, find -delete,
  --no-verify, writes to features.json, the spec or protected files through the shell, cargo/pnpm/npm add
  (use scripts/add_dep.py), reading the live keys file (only scripts/live.sh may), publishing packages.
"""
import json, os, re, sys, tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import checkout_root, resolve  # noqa: E402

PROTECTED = (  # existing files only; creating new tests and snapshots is always fine
    "scripts/verify.sh", "tests/perf/budgets.json", "tests/corpus/thresholds.json", ".github/workflows/*",
    "deny.toml", "clippy.toml", ".clippy.toml", "crates/*/clippy.toml", "crates/*/.clippy.toml", "rustfmt.toml", "rust-toolchain.toml", "ui/biome.json", "ui/biome.jsonc",
    "ui/playwright.config.ts", "tests/e2e/wdio.conf.ts", "ui/knip.json", "ui/.jscpd.json", "ui/tsconfig.json",
    "*.snap", "*/__snapshots__/*", "tests/visual/baselines/*",
)
KIT_FILES = (".claude/settings*", "scripts/hooks/*", "scripts/check_*.py", "scripts/lib_git.py", "scripts/secret_scan.sh",
             "scripts/deps_preapproved.txt", ".gitleaks.toml", "scripts/tests/*", "scripts/live.sh", ".claude/agents/*")
KEYS = re.compile(r"lecter-dev|keys\.env|LECTER_KEYS_FILE")


def _match(rel, globs):
    import fnmatch
    return any(fnmatch.fnmatch(rel, g) for g in globs)


def protected_ok(root, rel):
    """An in-progress feature in this checkout's features.json lists the file under `protected`."""
    try:
        sys.path.insert(0, str(root / "scripts"))
        from lib_features import load, protected_allowed
        return protected_allowed(load(root / "docs" / "features.json"), rel)
    except Exception:
        return False

SHARED_STATE = {"docs/PROGRESS.md", "docs/DECISIONS.md", "docs/QUESTIONS.md", "CHANGELOG.md", "README.md"}
PLANNING = os.environ.get("LECTER_PLANNING") == "1"
KIT_EDIT = os.environ.get("LECTER_KIT_EDIT") == "1"


def block(msg):
    print(f"BLOCKED by scripts/hooks/guard.py: {msg}", file=sys.stderr)
    sys.exit(2)


def check_path(raw, cwd=None):
    p = resolve(raw, cwd)
    root = checkout_root(p)
    if root is None:
        # Scratch files in the temp dir and the agent's own ~/.claude files are fine.
        allowed = [Path(tempfile.gettempdir()).resolve(), (Path.home() / ".claude").resolve()]
        if any(p.is_relative_to(a) for a in allowed):
            return
        block(f"{raw} is outside the project.")
    rel = p.relative_to(root).as_posix()  # same rules in the main tree and in every worktree
    if KEYS.search(str(p)):
        block("Jay's live keys are never read or written by agents. Live commands run through scripts/live.sh.")
    if re.search(r"(^|/)\.env(\.|$)|\.(pem|key|p12)$", rel):
        block("secret files are off limits.")
    if rel == "docs/features.json":
        block("edit features through scripts/feature.py (start/done/block/note).")
    if rel.startswith("docs/spec/") and not PLANNING:
        block("the spec is read-only in build sessions. If it is wrong or silent, add a question to "
              "docs/QUESTIONS.md and record your working assumption in docs/DECISIONS.md.")
    if (root / ".git").is_file() and rel in SHARED_STATE:  # inside a git worktree = a builder
        block(f"{rel} is written only by the orchestrator in the main checkout. Put this in your final report.")
    if _match(rel, KIT_FILES) and not KIT_EDIT:
        block("guardrail files are Jay's. Propose the change in docs/QUESTIONS.md.")
    if _match(rel, PROTECTED) and p.exists() and not KIT_EDIT and not protected_ok(root, rel):
        block(f"{rel} is a protected check. Make the code meet it; if it can't be met as specified, report "
              "IMPOSSIBLE with evidence (docs/spec/14-quality.md#when-the-criteria-cant-be-met). New tests and new "
              "snapshot files are fine; a changed snapshot needs a Snapshot-Changed trailer the reviewer accepts.")


BASH_RULES = [
    (r"\bgit\s+push\b.*(--tags|--follow-tags|\brefs/tags/|\s+v\d+\.\d+)", "tags and releases are Jay's."),
    (r"\bgit\s+tag\b", "tags and releases are Jay's."),
    (r"\bgit\s+add\b.*(\s-f\b|--force)", "force-adding ignored files is blocked (it is how private files leak)."),
    (r"\bgit\s+add\b.*tests/corpus/private", "tests/corpus/private is confidential and never committed."),
    (r"\b(cp|mv|ln|rsync|install)\b[^|;&]*tests/corpus/private\S*\s+(?!\S*tests/corpus/private)\S+", "private corpus files never leave tests/corpus/private."),
    (r"\bgit\s+push\b.*(--force|-f\b|--force-with-lease)", "force pushes are never allowed."),
    (r"\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.|restore\s+\.)", "this discards work. Commit or stash instead."),
    (r"\bgit\s+(rebase|filter-branch|filter-repo)\b", "no history rewrites."),
    (r"--no-verify\b", "do not bypass hooks."),
    (r"\brm\s+-[a-z]*r[a-z]*f?\s+(/|~|\.|\*|docs|crates|ui|app|scripts)(\s|/?$)", "mass delete blocked. Delete specific files."),
    (r"(>|tee\s|sed\s+-i[^|]*)\s*\S*docs/features\.json", "use scripts/feature.py."),
    (r"\b(cargo|npm|pnpm)\s+publish\b", "no publishing."),
    (r"curl[^|]*\|\s*(ba)?sh", "no piping downloads into a shell."),
    (r"\b(cargo\s+add|pnpm(\s+-C\s+\S+)?\s+add|npm\s+(i|install|add)\b|yarn\s+add)", "add dependencies with scripts/add_dep.py (docs/spec/01-architecture.md#dependency-policy)."),
    (r"\bfind\b.*\s(-delete|-exec\s+(rm|unlink|shred))\b", "find -delete / -exec rm is blocked. Delete specific files."),
    (r"\bgit\s+commit\b.*(\s-a\b|--all\b).*--amend|\bgit\s+commit\b.*--amend", "no amending: add a new commit."),
]
WRITE_TARGETS = [  # regexes whose group 1 is a path the command writes
    r"(?:^|[^<>&0-9])>>?\s*([^\s;&|]+)", r"\btee\s+(?:-a\s+)?([^\s;&|]+)", r"\bsed\s+-i\S*\s+(?:'[^']*'|\"[^\"]*\"|\S+)\s+([^\s;&|]+)",
    r"\b(?:cp|mv|install|ln)\s+(?:-\S+\s+)*\S+\s+([^\s;&|]+)", r"\b(?:rm|truncate|shred|unlink)\s+(?:-\S+\s+)*([^\s;&|]+)",
    r"\bgit\s+(?:checkout|restore)\s+.*?--\s+([^\s;&|]+)",
]


def normalise(cmd):
    # Commit messages may mention "git push"; global options like `git -C dir` must not hide a subcommand.
    cmd = re.sub(r"""(-m|--message)(\s+|=)("(?:[^"\\]|\\.)*"|'[^']*')""", r"\1 MSG", cmd)
    return re.sub(r"\bgit(\s+(-C|-c|--git-dir|--work-tree)(\s+|=)\S+)+", "git", cmd)


def check_bash(cmd, cwd=None):
    cmd = normalise(cmd)
    if re.search(r"\bgit\s+push\b", cmd) and os.environ.get("LECTER_ALLOW_PUSH") != "1":
        block("pushing is off until Jay sets LECTER_ALLOW_PUSH=1. Commit locally.")
    for pat, msg in BASH_RULES:
        if re.search(pat, cmd):
            block(msg)
    if not PLANNING and re.search(r"(>|sed\s+-i[^|]*|tee\s)\s*\S*docs/spec/", cmd):
        block("the spec is read-only in build sessions.")
    if KEYS.search(cmd) and not re.match(r"\s*scripts/live\.sh\s", cmd):
        block("Jay's live keys are never read by agents. Live commands run through scripts/live.sh F-0NN -- <cmd>.")
    if not KIT_EDIT:
        root = checkout_root(Path(cwd or os.getcwd()).resolve()) or Path(os.getcwd())
        for rx in WRITE_TARGETS:
            for m in re.finditer(rx, cmd):
                target = m.group(1).strip("'\"")
                try:
                    rel = resolve(target, cwd).relative_to(root).as_posix()
                except ValueError:
                    continue
                if _match(rel, KIT_FILES):
                    block(f"{rel} is a guardrail file (Jay's).")
                if _match(rel, PROTECTED) and (root / rel).exists() and not protected_ok(root, rel):
                    block(f"{rel} is a protected check; shell writes to it are blocked too (docs/spec/14-quality.md#protected-checks).")


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    tool = data.get("tool_name", "")
    ti = data.get("tool_input", {}) or {}
    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        raw = ti.get("file_path") or ti.get("notebook_path")
        if raw:
            check_path(raw, data.get("cwd"))
    elif tool == "Bash":
        check_bash(ti.get("command", ""), data.get("cwd"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
