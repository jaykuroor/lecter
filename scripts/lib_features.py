"""Shared helpers for docs/features.json (used by next.py, feature.py, evidence.py, the hooks)."""
import fnmatch, json, os, re, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
FEATURES = DOCS / "features.json"
STATUSES = ("todo", "in_progress", "done", "blocked")
# Shared files every feature may touch; never counted as overlap (lockfiles are regenerated on main).
SHARED_PATHS = ("Cargo.lock", "ui/pnpm-lock.yaml", "CHANGELOG.md", "docs/*", "**/CLAUDE.md")


def load(path=None):
    return json.loads(Path(path or FEATURES).read_text(encoding="utf-8"))


def save(data):
    # Atomic write so a killed session never leaves half a file.
    fd, tmp = tempfile.mkstemp(dir=DOCS, prefix=".features.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, FEATURES)


def by_id(data):
    return {f["id"]: f for f in data["features"]}


def keys_file():
    return Path(os.environ.get("LECTER_KEYS_FILE") or Path.home() / ".config" / "lecter-dev" / "keys.env")


def unmet_needs(f):
    """Environment prerequisites a feature declares in `needs` that this machine lacks.
    live-keys: Jay's keys file exists (scripts/live.sh loads it for the child command only)."""
    have = {"live-keys": keys_file().is_file()}
    return [n for n in f.get("needs", []) if not have.get(n, False)]


# ---------- milestones and gates ----------

def milestones(data):
    return data.get("milestones") or sorted({f["milestone"] for f in data["features"]})


def milestone_complete(data, ms):
    """A milestone is complete when every non-spike feature in it is done (spikes never hold a gate)."""
    fs = [f for f in data["features"] if f["milestone"] == ms and f["kind"] != "spike"]
    return bool(fs) and all(f["status"] == "done" for f in fs)


def open_gate(data):
    """The first milestone that is complete but whose gate Jay hasn't passed yet, or None."""
    for ms in milestones(data)[:-1]:
        if ms in data.get("gates", {}):
            continue
        return ms if milestone_complete(data, ms) else None
    return None


def gate_allows(data, f):
    """Features of a milestone become ready only after every earlier milestone's gate is passed."""
    order = milestones(data)
    i = order.index(f["milestone"]) if f["milestone"] in order else 0
    return all(m in data.get("gates", {}) for m in order[:i])


def ready(data):
    """Features whose dependencies are done, whose needs are met and whose milestone gate is open."""
    idx = by_id(data)
    out = []
    for f in sorted(data["features"], key=lambda x: x["priority"]):
        if (f["status"] == "todo" and all(idx[d]["status"] == "done" for d in f["depends_on"])
                and not unmet_needs(f) and gate_allows(data, f)):
            out.append(f)
    return out


def pick(data):
    """The feature a build session should work on: resume in_progress first."""
    doing = [f for f in data["features"] if f["status"] == "in_progress"]
    if doing:
        return sorted(doing, key=lambda x: x["priority"])[0]
    r = ready(data)
    return r[0] if r else None


# ---------- owned paths ----------

def _prefix(glob):
    """Literal directory prefix of a glob (up to the first wildcard)."""
    m = re.search(r"[*?\[]", glob)
    return glob if m is None else glob[:m.start()]


def globs_overlap(a, b):
    if any(fnmatch.fnmatch(a, s) or fnmatch.fnmatch(b, s) for s in SHARED_PATHS):
        return False
    pa, pb = _prefix(a), _prefix(b)
    if pa == a and pb == b:
        return a == b
    if pa == a:
        return fnmatch.fnmatch(a, b) or a.startswith(pb)
    if pb == b:
        return fnmatch.fnmatch(b, a) or b.startswith(pa)
    return pa.startswith(pb) or pb.startswith(pa)


def overlaps(f, g):
    return [(a, b) for a in f.get("paths", []) for b in g.get("paths", []) if globs_overlap(a, b)]


def parallel_safe(data, running_ids):
    """Ready features whose owned paths overlap no running feature (orchestrator, LECTER_PARALLEL=2)."""
    idx = by_id(data)
    running = [idx[r] for r in running_ids if r in idx]
    return [f for f in ready(data) if not any(overlaps(f, r) for r in running)]


def protected_allowed(data, rel):
    """True if an in-progress feature lists `rel` (or a glob matching it) under `protected`."""
    for f in data["features"]:
        if f["status"] == "in_progress" and any(fnmatch.fnmatch(rel, g) for g in f.get("protected", [])):
            return True
    return False


# ---------- summaries ----------

def counts(data):
    c = {s: 0 for s in STATUSES}
    for f in data["features"]:
        c[f["status"]] += 1
    return c


def milestone_line(data):
    ms = {}
    for f in data["features"]:
        d, t = ms.get(f["milestone"], (0, 0))
        ms[f["milestone"]] = (d + (f["status"] == "done"), t + 1)
    order = milestones(data)
    return "  ".join(f"{m} {ms[m][0]}/{ms[m][1]}" for m in order if m in ms)


def checklist(data, ms):
    """Jay's 5-10 minute hands-on checklist for a milestone gate, from the features' `try` lines."""
    items = [f"{f['id']}: {f['try']}" for f in data["features"] if f["milestone"] == ms and f.get("try")]
    return items[:12]
