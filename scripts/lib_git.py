"""Git helpers shared by the lint scripts: the base a change is measured against, and commit trailers."""
import re, subprocess, sys
from pathlib import Path


def git(root, *args, check=False):
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr)
    return r


def find_base(root, explicit=None):
    """--base; else the `base` that `feature.py start` recorded for the in-progress feature; else the
    merge-base with main on another branch; else HEAD's first parent; else None (nothing to compare)."""
    if explicit:
        return explicit
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from lib_features import load
        for f in load(Path(root) / "docs" / "features.json")["features"]:
            b = f.get("base")
            if f["status"] == "in_progress" and b and git(root, "merge-base", "--is-ancestor", b, "HEAD").returncode == 0:
                return b
    except Exception:
        pass
    branch = git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch not in ("main", "HEAD") and git(root, "rev-parse", "--verify", "-q", "main").returncode == 0:
        mb = git(root, "merge-base", "main", "HEAD").stdout.strip()
        if mb:
            return mb
    if git(root, "rev-parse", "--verify", "-q", "HEAD^1").returncode == 0:
        return "HEAD^1"
    return None


def trailers(root, base, names):
    """{name: [(value, rest)]} from commit messages in base..HEAD (and base..MERGE_HEAD during a merge)."""
    msgs = git(root, "log", "--format=%B", f"{base}..HEAD").stdout
    if git(root, "rev-parse", "-q", "--verify", "MERGE_HEAD").returncode == 0:
        msgs += git(root, "log", "--format=%B", f"{base}..MERGE_HEAD").stdout
    out = {n: [] for n in names}
    rx = re.compile(r"^(" + "|".join(map(re.escape, names)) + r"):\s*(\S+)\s*(.*)$")
    for line in msgs.splitlines():
        m = rx.match(line.strip())
        if m:
            out[m.group(1)].append((m.group(2), m.group(3)))
    return out


def maintainer_decision(root, did):
    """True when docs/DECISIONS.md has `## D-0NN · …` whose next line names the maintainer as the decider."""
    p = Path(root) / "docs" / "DECISIONS.md"
    if not p.exists():
        return False
    m = re.search(rf"^## {re.escape(did)} ·.*\n(.*)$", p.read_text(encoding="utf-8"), re.M)
    return bool(m and ("maintainer" in m.group(1).lower()))


def old_text(root, base, path):
    r = git(root, "show", f"{base}:{path}")
    return r.stdout if r.returncode == 0 else None
