#!/usr/bin/env python3
"""Stop hook.

Always: commits made since the session started must pass the secret scan (scripts/secret_scan.sh).
With LECTER_STRICT=1 (scripts/loop.sh sets it), a session may also end only when:
  - the working tree is clean (work committed), and
  - if it committed anything, docs/PROGRESS.md changed in those commits.
Exit 2 sends the reason back and the agent keeps working; stop_hook_active prevents loops.
"""
import json, os, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2]).resolve()


def git(*a):
    # rstrip only: porcelain lines start with a meaningful space
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.rstrip()


def secrets(start):
    head = git("rev-parse", "HEAD").strip()
    if not head or head == start or not shutil.which("gitleaks"):
        return None
    r = subprocess.run(["bash", str(ROOT / "scripts" / "secret_scan.sh"), "--since", start or "none"], cwd=ROOT,
                       capture_output=True, text=True)
    return None if r.returncode == 0 else (r.stdout + r.stderr)[-1500:]


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    if data.get("stop_hook_active"):
        return 0
    start_file = ROOT / ".loop" / "sessions" / data.get("session_id", "unknown")
    start = start_file.read_text().strip() if start_file.exists() else ""
    found = secrets(start)
    if found:
        print("A commit from this session contains what looks like a secret. Do not push. Tell Jay which file and "
              "commit (he rotates the secret and rewrites the commit).\n" + found, file=sys.stderr)
        return 2
    if os.environ.get("LECTER_STRICT") != "1":
        return 0
    dirty = [l for l in git("status", "--porcelain").splitlines() if not l[3:].startswith((".loop/", ".verify/"))]
    if dirty:
        print("Before stopping: finish the handoff (handoff skill), then commit. Uncommitted: "
              + ", ".join(l[3:] for l in dirty[:8]), file=sys.stderr)
        return 2
    head = git("rev-parse", "HEAD").strip()
    if start and start != "none" and head != start:
        changed = git("diff", "--name-only", f"{start}..{head}").splitlines()
        if "docs/PROGRESS.md" not in changed:
            print("You committed work but did not update docs/PROGRESS.md (Current state + one log entry). "
                  "Do that with the handoff skill and commit.", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
