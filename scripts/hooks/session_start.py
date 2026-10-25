#!/usr/bin/env python3
"""SessionStart: put the build state and the next feature into context (zero tool calls),
and remember HEAD so the Stop hook can tell what this session did."""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2]).resolve()
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
sid = data.get("session_id", "unknown")
head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or "none"
state = ROOT / ".loop" / "sessions"
state.mkdir(parents=True, exist_ok=True)
(state / sid).write_text(head)
out = subprocess.run([sys.executable, str(ROOT / "scripts" / "next.py"), "--brief"], cwd=ROOT / "scripts",
                     capture_output=True, text=True)
print(out.stdout.strip())
if out.returncode == 5:
    print("\nMILESTONE GATE: dispatch nothing. Show the maintainer the checklist above (python3 scripts/feature.py gate) "
          "and wait for their go; they record it with `python3 scripts/feature.py gate <M> --pass`.")
if any(os.environ.get(k) for k in ("GEMINI_API_KEY", "OPENAI_API_KEY", "LECTER_LIVE_TESTS")):
    print("\nWARNING: a provider key or LECTER_LIVE_TESTS is set in this session's environment. Tell the maintainer: keys belong "
          "only in ~/.config/lecter-dev/keys.env, loaded by scripts/live.sh (docs/TESTING.md#live-keys).")
if os.environ.get("LECTER_PLANNING") == "1":
    print("\nPLANNING SESSION: spec and features.json may be changed (see PROMPT.plan.md).")
