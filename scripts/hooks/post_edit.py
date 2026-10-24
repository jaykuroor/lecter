#!/usr/bin/env python3
"""PostToolUse after Edit/Write: format the file, and push back on context bloat.

Formatting is silent. Size warnings exit 2 so the agent sees them (the edit already happened).
"""
import json, os, shutil, subprocess, sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import checkout_root, resolve  # noqa: E402
LIMITS = {  # file → (max lines in the part that is always read, what to do)
    "AGENTS.md": (160, "AGENTS.md is loaded every session. Move detail into a folder CLAUDE.md or a skill."),
    "CLAUDE.md": (60, "Root CLAUDE.md should only import AGENTS.md and add Claude-specific notes."),
}


def fmt(p: Path, root: Path):
    s = p.suffix
    if s == ".rs" and shutil.which("rustfmt"):
        subprocess.run(["rustfmt", "--edition", "2024", "--quiet", str(p)], capture_output=True)
    elif s in (".ts", ".tsx", ".js", ".jsx", ".json", ".css") and "node_modules" not in p.parts:
        biome = root / "ui" / "node_modules" / ".bin" / ("biome.cmd" if os.name == "nt" else "biome")
        if biome.exists():
            subprocess.run([str(biome), "format", "--write", str(p)], capture_output=True, cwd=root / "ui")


def warn(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    ti = data.get("tool_input", {}) or {}
    raw = ti.get("file_path")
    if not raw:
        return 0
    p = resolve(raw, data.get("cwd"))
    root = checkout_root(p)
    if root is None or not p.exists():
        return 0
    fmt(p, root)
    rel = p.relative_to(root).as_posix()
    text = p.read_text(encoding="utf-8", errors="replace")
    n = text.count("\n")
    if rel in LIMITS and n > LIMITS[rel][0]:
        warn(f"{rel} is {n} lines (limit {LIMITS[rel][0]}). {LIMITS[rel][1]}")
    if rel == "docs/PROGRESS.md":
        head = text.split("<!-- LOG -->", 1)[0].count("\n")
        if head > 45:
            warn(f"PROGRESS.md 'Current state' is {head} lines (limit 40). Rewrite it shorter; history goes in the log.")
        if text.count("\n### ") > 60:
            warn("PROGRESS.md log has over 60 entries. The garden session archives old ones; leave it, but keep entries short.")
    if p.name == "CLAUDE.md" and rel != "CLAUDE.md":
        learned = text.split("## Learned", 1)[1] if "## Learned" in text else ""
        if learned.count("\n- ") > 25:
            warn(f"{rel} 'Learned' has over 25 entries. Merge or delete stale ones (keep only what prevents a repeat mistake).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
