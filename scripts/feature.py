#!/usr/bin/env python3
"""The only way to change docs/features.json.

  scripts/feature.py show F-033
  scripts/feature.py start F-033 [--parallel]    todo → in_progress; records the base commit (--parallel: orchestrator only)
  scripts/feature.py done F-033                  runs scripts/verify.sh and the evidence check first; refuses if either fails
  scripts/feature.py block F-033 "needs Q-004"   blocked, with the reason in notes
  scripts/feature.py unblock F-033               blocked → todo
  scripts/feature.py note F-033 "text"           append a short note (≤ 300 characters) for the next session
  scripts/feature.py gate [M1] [--pass]          show the open milestone gate and the maintainer's checklist; --pass records their go
  scripts/feature.py add '<json>'                planning sessions only (LECTER_PLANNING=1)
  scripts/feature.py set F-033 <field> '<json>'  planning only; todo/blocked features
  scripts/feature.py validate                    schema check (verify.sh lint stage)
  scripts/feature.py summary
Build sessions change only status and notes. Acceptance criteria are never edited here by builders.
"""
import datetime, json, os, subprocess, sys
from lib_features import ROOT, load, save, by_id, counts, milestone_line, milestones, open_gate, checklist

REQUIRED = {"id", "milestone", "kind", "title", "spec", "depends_on", "acceptance", "verify", "paths", "evidence"}
SETTABLE = ("title", "spec", "depends_on", "acceptance", "verify", "priority", "needs", "paths", "evidence",
            "reviews", "protected", "try", "ask_maintainer_first")
EVIDENCE_KINDS = ("screenshot:", "log:", "harness:", "perf")


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def problems(data):
    out, idx = [], by_id(data)
    ms = milestones(data)
    for f in data["features"]:
        fid = f.get("id", "?")
        miss = REQUIRED - f.keys()
        if miss:
            out.append(f"{fid}: missing {sorted(miss)}")
            continue
        if not 2 <= len(f["acceptance"]) <= 8:
            out.append(f"{fid}: {len(f['acceptance'])} criteria (keep 2-8; split the feature)")
        if not f["paths"]:
            out.append(f"{fid}: no owned paths")
        if not f["evidence"] or any(not e.startswith(EVIDENCE_KINDS) for e in f["evidence"]):
            out.append(f"{fid}: evidence items must start with {EVIDENCE_KINDS}")
        if f["milestone"] not in ms:
            out.append(f"{fid}: unknown milestone {f['milestone']}")
        if f["status"] not in ("todo", "in_progress", "done", "blocked"):
            out.append(f"{fid}: bad status {f['status']}")
        for d in f["depends_on"]:
            if d not in idx:
                out.append(f"{fid}: unknown dependency {d}")
            elif ms.index(idx[d]["milestone"]) > ms.index(f["milestone"]):
                out.append(f"{fid}: depends on later-milestone {d}")
    seen, stack = set(), set()

    def cyc(i):
        if i in stack:
            return True
        if i in seen or i not in idx:
            return False
        seen.add(i); stack.add(i)
        r = any(cyc(d) for d in idx[i]["depends_on"])
        stack.discard(i)
        return r
    out += [f"{i}: dependency cycle" for i in idx if cyc(i)]
    return out


def git(*a):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    cmd, rest = argv[0], argv[1:]
    data = load()
    idx = by_id(data)

    if cmd == "summary":
        print(f"{counts(data)} | {milestone_line(data)}")
        return 0
    if cmd == "validate":
        p = problems(data)
        print("\n".join(p) if p else f"FEATURES OK ({len(data['features'])})")
        return 1 if p else 0
    if cmd == "gate":
        ms = next((a for a in rest if not a.startswith("--")), None) or open_gate(data)
        if not ms:
            print("No milestone gate is open.")
            return 0
        if "--pass" in rest:
            if ms != open_gate(data):
                die(f"{ms} is not the open gate (open: {open_gate(data)}).")
            data.setdefault("gates", {})[ms] = f"passed {datetime.date.today().isoformat()}"
            save(data)
            print(f"gate {ms} passed")
            return 0
        print(f"MILESTONE GATE {ms}: every feature is merged. The maintainer tries the app before the next milestone starts.")
        print("Run scripts/dev.sh, then (5-10 minutes):")
        for line in checklist(data, ms) or ["(no hands-on items: check scripts/verify.sh --full and CI)"]:
            print(f"  [ ] {line}")
        print("The maintainer's notes become features via PROMPT.plan.md; then: python3 scripts/feature.py gate " + ms + " --pass")
        return 0

    if cmd == "add":
        if os.environ.get("LECTER_PLANNING") != "1":
            die("add is for planning sessions only (scripts/loop.sh plan sets LECTER_PLANNING=1).")
        f = json.loads(rest[0])
        if f["id"] in idx:
            die(f"{f['id']} exists")
        f.setdefault("status", "todo")
        f.setdefault("notes", "")
        f.setdefault("priority", max(x["priority"] for x in data["features"]) + 1)
        data["features"].append(f)
        p = problems(data)
        if p:
            die("\n".join(p))
        save(data)
        print(f"added {f['id']}")
        return 0

    if not rest or rest[0] not in idx:
        die(f"unknown feature: {rest[0] if rest else '(none)'}")
    f = idx[rest[0]]

    if cmd == "set":
        if os.environ.get("LECTER_PLANNING") != "1":
            die("set is for planning sessions only (LECTER_PLANNING=1).")
        if len(rest) < 3:
            die("usage: feature.py set F-0NN <field> '<json value>'")
        field, value = rest[1], json.loads(rest[2])
        if field not in SETTABLE:
            die(f"field {field} can't be set (settable: {', '.join(SETTABLE)})")
        if f["status"] in ("done", "in_progress"):
            die("done or in-progress features are never edited; add a new feature that depends on it.")
        f[field] = value
        p = problems(data)
        if p:
            die("\n".join(p))
        save(data)
        print(f"{f['id']}.{field} updated")
        return 0
    if cmd == "show":
        print(json.dumps(f, indent=1, ensure_ascii=False))
        return 0
    if cmd == "start":
        open_deps = [d for d in f["depends_on"] if idx[d]["status"] != "done"]
        if open_deps:
            die(f"dependencies not done: {open_deps}")
        others = [x["id"] for x in data["features"] if x["status"] == "in_progress" and x["id"] != f["id"]]
        if others and "--parallel" not in rest:
            die(f"finish or block {others} first: one feature at a time.")
        f["status"] = "in_progress"
        f["base"] = git("rev-parse", "HEAD") or None  # the test-weakening lint compares against this
    elif cmd == "done":
        if f["status"] != "in_progress":
            die("only an in_progress feature can be marked done.")
        if os.environ.get("LECTER_SKIP_VERIFY") != "1":
            r = subprocess.run(["bash", str(ROOT / "scripts" / "verify.sh")], cwd=ROOT)  # same checks as CI
            if r.returncode != 0:
                die("verify.sh failed: the feature stays in_progress. Fix it, or block it with a reason.")
            r = subprocess.run([sys.executable, str(ROOT / "scripts" / "evidence.py"), "check", f["id"]], cwd=ROOT)
            if r.returncode != 0:
                die("evidence is missing: the feature stays in_progress (docs/spec/14-quality.md#evidence).")
        f["status"] = "done"
    elif cmd == "block":
        if len(rest) < 2:
            die('give a reason: feature.py block F-0xx "needs Q-00y because …"')
        f["status"] = "blocked"
        f["notes"] = (f["notes"] + " | " if f["notes"] else "") + "BLOCKED: " + rest[1]
    elif cmd == "unblock":
        f["status"] = "todo"
    elif cmd == "note":
        if len(rest) < 2:
            die("give the note text")
        note = rest[1].strip()
        if len(note) > 300:
            die("keep notes under 300 characters; put detail in PROGRESS.md or DECISIONS.md.")
        f["notes"] = (f["notes"] + " | " if f["notes"] else "") + note
    else:
        die(f"unknown command {cmd}")
    save(data)
    print(f"{f['id']} → {f['status']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
