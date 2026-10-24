"""Shared helpers for the hooks: find which checkout (main tree or a git worktree) a path is in."""
import os
from pathlib import Path

MAIN = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2]).resolve()


def _main_git_dir():
    g = MAIN / ".git"
    if g.is_file():  # the session itself runs inside a worktree
        txt = g.read_text().strip()
        if txt.startswith("gitdir:"):
            # <main>/.git/worktrees/<name> → <main>/.git
            return Path(txt[7:].strip()).resolve().parents[1]
    return g.resolve()


def checkout_root(path: Path):
    """Return the root of the checkout that contains `path` if it belongs to this repository
    (the main tree or one of its worktrees); otherwise None."""
    main_git = _main_git_dir()
    for d in [path, *path.parents]:
        g = d / ".git"
        if g.is_dir():
            return d if g.resolve() == main_git else None
        if g.is_file():
            txt = g.read_text(errors="replace").strip()
            if txt.startswith("gitdir:"):
                gd = Path(txt[7:].strip())
                gd = (gd if gd.is_absolute() else d / gd).resolve()
                if main_git in gd.parents or gd == main_git:
                    return d
            return None
    # No .git found (e.g. before `git init`): fall back to the project folder.
    try:
        path.relative_to(MAIN)
        return MAIN
    except ValueError:
        return None


def resolve(raw: str, cwd: str | None = None) -> Path:
    p = Path(raw)
    base = Path(cwd) if cwd else MAIN
    return (p if p.is_absolute() else base / p).resolve()
