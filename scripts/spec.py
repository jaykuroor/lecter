#!/usr/bin/env python3
"""Print only the spec you need, to save context.

  scripts/spec.py 06-ai-harness.md#web-search-configuration   one section
  scripts/spec.py 06-ai-harness.md                            whole file
  scripts/spec.py F-060                                       every section a feature cites
  scripts/spec.py --toc                                       headings of all spec files
  scripts/spec.py --check                                     verify every features.json ref resolves
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "spec"
FEATURES = ROOT / "docs" / "features.json"
HEAD = re.compile(r"^(#{1,6})\s+(.*)$")


def slug(text: str) -> str:
    s = text.strip().lower()
    s = re.sub(r"[^\w\- ]", "", s, flags=re.UNICODE)
    return s.replace(" ", "-")


def sections(path: Path):
    """Yield (level, slug, start, end) for each heading, skipping fenced code."""
    lines = path.read_text(encoding="utf-8").splitlines()
    heads, fence = [], False
    for i, line in enumerate(lines):
        if line.startswith("```"):
            fence = not fence
        m = None if fence else HEAD.match(line)
        if m:
            heads.append((len(m.group(1)), slug(m.group(2)), i))
    out = []
    for n, (lvl, sl, start) in enumerate(heads):
        end = len(lines)
        for lvl2, _, s2 in heads[n + 1:]:
            if lvl2 <= lvl:
                end = s2
                break
        out.append((lvl, sl, start, end))
    return lines, out


def resolve(ref: str):
    """Return the text for 'file.md' or 'file.md#anchor', or None."""
    name, _, anchor = ref.partition("#")
    path = SPEC / name
    if not path.is_file():
        return None
    lines, secs = sections(path)
    if not anchor:
        return "\n".join(lines)
    exact = [s for s in secs if s[1] == anchor]
    loose = [s for s in secs if s[1].startswith(anchor)]
    hit = (exact or loose or [None])[0]
    if hit is None:
        return None
    _, _, start, end = hit
    return "\n".join(lines[start:end]).rstrip()


def features():
    return json.loads(FEATURES.read_text(encoding="utf-8"))["features"]


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    if argv[0] == "--toc":
        for p in sorted(SPEC.glob("*.md")):
            _, secs = sections(p)
            print(p.name)
            for lvl, sl, _, _ in secs[1:]:
                print("  " * (lvl - 1) + f"#{sl}")
        return 0
    if argv[0] == "--check":
        bad = [(f["id"], r) for f in features() for r in f["spec"] if resolve(r) is None]
        for fid, r in bad:
            print(f"UNRESOLVED {fid}: {r}")
        print("SPEC REFS OK" if not bad else f"{len(bad)} unresolved")
        return 1 if bad else 0
    refs = []
    for a in argv:
        if re.fullmatch(r"F-\d{3}", a):
            f = next((x for x in features() if x["id"] == a), None)
            if not f:
                print(f"no feature {a}", file=sys.stderr)
                return 1
            refs += f["spec"]
        else:
            refs.append(a)
    rc = 0
    for r in dict.fromkeys(refs):
        text = resolve(r)
        if text is None:
            print(f"!! cannot resolve {r} (try scripts/spec.py --toc)", file=sys.stderr)
            rc = 1
            continue
        print(f"<!-- {r} -->\n{text}\n")
    return rc


if __name__ == "__main__":
    import signal
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # quiet when piped into head
    sys.exit(main(sys.argv[1:]))
