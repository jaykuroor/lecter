#!/usr/bin/env python3
"""Orientation for a build session, in as few tokens as possible.

  scripts/next.py                 state + the one feature to build now (full card)
  scripts/next.py --brief         same, shorter (used by the SessionStart hook)
  scripts/next.py --list          every feature, one line each
  scripts/next.py --ready         features ready to start (dependencies done, gate open, needs met)
  scripts/next.py --ready --beside F-0NN[,F-0MM]   ready features whose owned paths don't overlap those
Exit codes: 0 normal; 3 all done; 4 everything left is blocked or waiting; 5 a milestone gate is open (Jay tries the app).
"""
import re, sys
from lib_features import DOCS, load, pick, ready, counts, milestone_line, by_id, open_gate, parallel_safe, unmet_needs, checklist

MARK = "<!-- LOG -->"


def progress_head():
    p = DOCS / "PROGRESS.md"
    if not p.exists():
        return "(no docs/PROGRESS.md)"
    head = p.read_text(encoding="utf-8").split(MARK, 1)[0].strip()
    return "\n".join(l for l in head.splitlines() if l.strip() and not l.startswith(("<!--", "# ")))


def open_questions():
    p = DOCS / "QUESTIONS.md"
    return re.findall(r"^## (Q-\d+ · open[^\n]*)", p.read_text(encoding="utf-8"), re.M) if p.exists() else []


def recent_decisions(n=6):
    p = DOCS / "DECISIONS.md"
    return re.findall(r"^## (D-\d+ · [^\n]*)", p.read_text(encoding="utf-8"), re.M)[-n:] if p.exists() else []


def card(f, idx):
    out = [f"### {f['id']} · {f['title']}  [{f['milestone']} · {f['kind']} · {f['status']}]"]
    deps = ", ".join(f"{d}({idx[d]['status']})" for d in f["depends_on"]) or "none"
    out.append(f"Depends on: {deps}")
    out.append("Spec: " + "  ".join(f["spec"]) + f"   → scripts/spec.py {f['id']}")
    out.append("Owned paths: " + "  ".join(f["paths"]))
    proof = ("each needs a reproducible measurement" if f["kind"] == "spike"
             else "each needs a test that fails before and passes after")
    out.append(f"Acceptance ({proof}):")
    out += [f"  {i}. {a}" for i, a in enumerate(f["acceptance"], 1)]
    out.append("Verify: " + " ; ".join(f["verify"]))
    out.append("Evidence (.evidence/" + f["id"] + "/): " + "  ".join(f["evidence"]))
    if f.get("reviews"):
        out.append("Reviews: reviewer + " + ", ".join(f"{r}-reviewer" for r in f["reviews"]))
    if f.get("protected"):
        out.append("May edit protected: " + "  ".join(f["protected"]))
    if f.get("needs"):
        out.append("Needs: " + ", ".join(f["needs"]) + ("  (live: run provider calls only via scripts/live.sh)" if "live-keys" in f["needs"] else ""))
    if f.get("ask_jay_first"):
        out.append("Ask Jay before building: " + f["ask_jay_first"])
    if f.get("notes"):
        out.append(f"Notes from earlier sessions: {f['notes']}")
    return "\n".join(out)


def main(argv):
    data = load()
    idx = by_id(data)
    if "--list" in argv:
        for f in sorted(data["features"], key=lambda x: x["priority"]):
            print(f"{f['id']} {f['milestone']:<4} {f['status']:<11} {f['title']}")
        return 0
    if "--ready" in argv:
        if "--beside" in argv:
            running = argv[argv.index("--beside") + 1].split(",")
            fs = parallel_safe(data, running)
        else:
            fs = ready(data)
        for f in fs:
            print(f"{f['id']} {f['milestone']} {f['title']}")
        return 0

    c = counts(data)
    print("== Lecter build state ==")
    print(f"Features: {c['done']} done, {c['in_progress']} in progress, {c['todo']} todo, {c['blocked']} blocked   |   {milestone_line(data)}")
    print(progress_head())
    qs = open_questions()
    if qs:
        print(f"Open questions for Jay ({len(qs)}): " + " | ".join(qs[:5]))
    ds = recent_decisions(4 if "--brief" in argv else 8)
    if ds:
        print("Recent decisions: " + " | ".join(ds))
    f = pick(data)
    print()
    if f is not None and f["status"] == "in_progress":
        print("== RESUME (in progress) ==")
        print(card(f, idx))
        return 0
    gate = open_gate(data)
    if gate:
        print(f"MILESTONE GATE {gate}: stop building. Jay tries the app first (python3 scripts/feature.py gate).")
        for line in checklist(data, gate)[:6]:
            print(f"  - {line}")
        return 5
    if f is None:
        if c["todo"] == 0 and c["blocked"] == 0:
            print("ALL DONE: every feature is done. Run a final full verify and stop.")
            return 3
        print("ALL REMAINING BLOCKED OR WAITING: nothing is ready. Write what you need in docs/QUESTIONS.md and stop.")
        waiting = [x["id"] for x in data["features"] if x["status"] == "todo" and unmet_needs(x)]
        if waiting:
            print(f"  Waiting on live keys (~/.config/lecter-dev/keys.env): {', '.join(waiting)}")
        for x in [x for x in data["features"] if x["status"] == "blocked"][:10]:
            print(f"  {x['id']} {x['title']}: {x.get('notes', '')}")
        return 4
    print("== NEXT ==")
    print(card(f, idx))
    return 0


if __name__ == "__main__":
    import signal
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # quiet when piped into head
    sys.exit(main(sys.argv[1:]))
